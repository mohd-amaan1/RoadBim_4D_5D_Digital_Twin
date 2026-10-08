using System;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using RoadBimBackend.Data;
using RoadBimBackend.Models;
using RoadBimBackend.Services;

namespace RoadBimBackend.Controllers
{
    public record SetActiveIpcRequest(long FileId);

    /// <summary>
    /// Storage for the Palashbari bridge RFI tracker: four kinds of upload and one settings
    /// document per package.
    ///
    /// The server keeps files and says which is current; it does not read them. Schedule 4,
    /// the register and the IFC are parsed in the browser, where the tracker's engine runs,
    /// in about a second. Holding their bytes verbatim means a better parser later re-reads
    /// every past month without anyone uploading anything again.
    ///
    /// Package-scoped and resolved through <see cref="ProjectAccessService"/>, like every
    /// other data route; only a package whose module is the tracker accepts these calls.
    /// </summary>
    [ApiController]
    [Authorize]
    public class BridgeTrackerController : ControllerBase
    {
        private const long MaxUploadBytes = 64L * 1024 * 1024;
        private const int MaxConfigBytes = 1024 * 1024;

        private readonly RoadDbContext _db;
        private readonly ProjectAccessService _access;
        private readonly string _root;

        public BridgeTrackerController(
            RoadDbContext db, ProjectAccessService access, IConfiguration config, IWebHostEnvironment env)
        {
            _db = db;
            _access = access;
            _root = StoragePaths.Resolve(config["Storage:BridgeTrackerRoot"], env, "bridge-tracker");
        }

        /// <summary>
        /// Everything the tracker needs to start: the current model, register and alignment,
        /// every IPC with the one in view, and the settings.
        /// </summary>
        [HttpGet("api/packages/{idOrPath}/bridge-tracker")]
        public async Task<IActionResult> Get(string idOrPath)
        {
            var access = await _access.ResolvePackageAsync(User, idOrPath);
            if (access is null) return NotFound();
            if (NotATracker(access.Package) is { } refusal) return refusal;

            var packageId = access.Package.Id;
            var files = await _db.BridgeTrackerFiles
                .Where(f => f.PackageId == packageId
                         && (f.Kind == BridgeTrackerFileKind.Ipc || f.SupersededAt == null))
                .OrderBy(f => f.UploadedAt).ThenBy(f => f.Id)
                .Select(f => new FileView(f.Id, f.Kind, f.OriginalFileName, f.ByteSize, f.ContentSha256,
                    f.Bill, f.Period, f.UploadedAt, f.UploadedByUserId,
                    f.UploadedBy != null ? f.UploadedBy.DisplayName : null, f.SupersededAt))
                .ToListAsync();

            var config = await _db.BridgeTrackerConfigs.AsNoTracking()
                .FirstOrDefaultAsync(c => c.PackageId == packageId);

            FileView? Current(string kind) => files.LastOrDefault(f => f.Kind == kind);

            return Ok(new
            {
                packageId,
                module = access.Package.Module,
                canWrite = access.Can(ProjectRole.Contributor),
                ifc = Current(BridgeTrackerFileKind.Ifc),
                register = Current(BridgeTrackerFileKind.Register),
                alignment = Current(BridgeTrackerFileKind.Alignment),
                ipcs = files.Where(f => f.Kind == BridgeTrackerFileKind.Ipc).ToList(),
                activeIpcFileId = config?.ActiveIpcFileId,
                config = ParseConfig(config?.ConfigJson),
                configUpdatedAt = config?.UpdatedAt,
            });
        }

        /// <summary>
        /// Stores one upload. A model, register or alignment replaces the current one of its
        /// kind; an IPC joins the history and becomes the one in view.
        ///
        /// Uploading bytes that are already stored as the same kind writes nothing new: the
        /// existing file is made current again (or, for an IPC, put back in view) and the
        /// response says so with <c>alreadyStored</c>.
        /// </summary>
        [HttpPost("api/packages/{idOrPath}/bridge-tracker/files")]
        [RequestSizeLimit(MaxUploadBytes)]
        [RequestFormLimits(MultipartBodyLengthLimit = MaxUploadBytes)]
        public async Task<IActionResult> Upload(
            string idOrPath,
            [FromForm] string kind,
            [FromForm] string? bill,
            [FromForm] string? period,
            IFormFile? file)
        {
            var access = await _access.ResolvePackageAsync(User, idOrPath);
            if (access is null) return NotFound();
            if (NotATracker(access.Package) is { } refusal) return refusal;
            if (!access.Can(ProjectRole.Contributor)) return Forbid();

            var k = (kind ?? string.Empty).Trim().ToLowerInvariant();
            if (!BridgeTrackerFileKind.All.Contains(k))
                return BadRequest(new { message = $"Kind must be one of: {string.Join(", ", BridgeTrackerFileKind.All)}." });

            if (file is null || file.Length == 0)
                return BadRequest(new { message = "Choose a file to upload." });

            var package = access.Package;
            var dir = Path.Combine(_root, package.Id.ToString());
            Directory.CreateDirectory(dir);

            // One pass: hash while writing to a scratch file, keeping the head for the sniff.
            var scratch = Path.Combine(dir, $".upload-{Guid.NewGuid():N}");
            string sha;
            byte[] head;
            try
            {
                using var hasher = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
                var headBuffer = new MemoryStream();
                await using (var target = System.IO.File.Create(scratch))
                await using (var source = file.OpenReadStream())
                {
                    var buffer = new byte[81920];
                    int read;
                    while ((read = await source.ReadAsync(buffer)) > 0)
                    {
                        hasher.AppendData(buffer, 0, read);
                        if (headBuffer.Length < 1024)
                            headBuffer.Write(buffer, 0, (int)Math.Min(read, 1024 - headBuffer.Length));
                        await target.WriteAsync(buffer.AsMemory(0, read));
                    }
                }
                sha = Convert.ToHexString(hasher.GetHashAndReset()).ToLowerInvariant();
                head = headBuffer.ToArray();

                var problem = k == BridgeTrackerFileKind.Alignment
                    ? await CheckAlignmentAsync(scratch)
                    : CheckSignature(k, head, file.FileName);
                if (problem is not null)
                {
                    System.IO.File.Delete(scratch);
                    return BadRequest(new { message = problem });
                }
            }
            catch
            {
                if (System.IO.File.Exists(scratch)) System.IO.File.Delete(scratch);
                throw;
            }

            var userId = ProjectAccessService.UserIdOf(User);
            var now = DateTime.UtcNow;

            var existing = await _db.BridgeTrackerFiles
                .FirstOrDefaultAsync(f => f.PackageId == package.Id && f.Kind == k && f.ContentSha256 == sha);

            await using var tx = await _db.Database.BeginTransactionAsync();

            BridgeTrackerFile row;
            if (existing is not null)
            {
                System.IO.File.Delete(scratch);
                row = existing;
                // The browser may have read the bill better this time; never blank a known one.
                if (k == BridgeTrackerFileKind.Ipc)
                {
                    row.Bill = Clip(bill, 64) ?? row.Bill;
                    row.Period = Clip(period, 200) ?? row.Period;
                }
            }
            else
            {
                var path = Path.Combine(dir, $"{sha}{ExtensionFor(k, file.FileName)}");
                if (System.IO.File.Exists(path)) System.IO.File.Delete(scratch);
                else System.IO.File.Move(scratch, path);

                row = new BridgeTrackerFile
                {
                    ProjectId = package.ProjectId,
                    PackageId = package.Id,
                    Kind = k,
                    OriginalFileName = Clip(Path.GetFileName(file.FileName), 400) ?? k,
                    ContentSha256 = sha,
                    ByteSize = file.Length,
                    StoragePath = path,
                    Bill = k == BridgeTrackerFileKind.Ipc ? Clip(bill, 64) : null,
                    Period = k == BridgeTrackerFileKind.Ipc ? Clip(period, 200) : null,
                    UploadedAt = now,
                    UploadedByUserId = userId,
                };
                _db.BridgeTrackerFiles.Add(row);
            }

            if (k == BridgeTrackerFileKind.Ipc)
            {
                await _db.SaveChangesAsync();
                var config = await ConfigFor(package.Id);
                config.ActiveIpcFileId = row.Id;
                config.UpdatedAt = now;
                config.UpdatedByUserId = userId;
            }
            else
            {
                // One current file per kind: this one, and every other of its kind retired.
                row.SupersededAt = null;
                var others = await _db.BridgeTrackerFiles
                    .Where(f => f.PackageId == package.Id && f.Kind == k && f.SupersededAt == null && f.Id != row.Id)
                    .ToListAsync();
                foreach (var other in others) other.SupersededAt = now;
            }

            await _db.SaveChangesAsync();
            await tx.CommitAsync();

            var uploader = row.UploadedByUserId is int uid
                ? await _db.Users.Where(u => u.Id == uid).Select(u => u.DisplayName).FirstOrDefaultAsync()
                : null;

            return Ok(new
            {
                alreadyStored = existing is not null,
                file = new FileView(row.Id, row.Kind, row.OriginalFileName, row.ByteSize, row.ContentSha256,
                    row.Bill, row.Period, row.UploadedAt, row.UploadedByUserId, uploader, row.SupersededAt),
            });
        }

        /// <summary>
        /// The stored bytes. Content-addressed, so a file never changes under its id and the
        /// browser may keep it — the 1 MB IPC workbooks are re-read on every visit otherwise.
        /// </summary>
        [HttpGet("api/bridge-tracker/files/{id:long}/content")]
        public async Task<IActionResult> Content(long id)
        {
            var row = await _db.BridgeTrackerFiles.AsNoTracking().FirstOrDefaultAsync(f => f.Id == id);
            if (row is null) return NotFound();

            var access = await _access.ResolvePackageAsync(User, row.PackageId.ToString());
            if (access is null) return NotFound();

            if (!System.IO.File.Exists(row.StoragePath))
                return NotFound(new { message = "The stored file is missing from disk." });

            var etag = $"\"{row.ContentSha256}\"";
            Response.Headers.CacheControl = "private, max-age=31536000, immutable";
            Response.Headers.ETag = etag;
            if (Request.Headers.IfNoneMatch.ToString() == etag) return StatusCode(StatusCodes.Status304NotModified);

            var stream = System.IO.File.OpenRead(row.StoragePath);
            return File(stream, ContentTypeFor(row.Kind), row.OriginalFileName);
        }

        /// <summary>Replaces the tracker's settings document. The browser owns its shape.</summary>
        [HttpPut("api/packages/{idOrPath}/bridge-tracker/config")]
        [RequestSizeLimit(MaxConfigBytes)]
        public async Task<IActionResult> SaveConfig(string idOrPath, [FromBody] JsonElement body)
        {
            var access = await _access.ResolvePackageAsync(User, idOrPath);
            if (access is null) return NotFound();
            if (NotATracker(access.Package) is { } refusal) return refusal;
            if (!access.Can(ProjectRole.Contributor)) return Forbid();

            if (body.ValueKind != JsonValueKind.Object)
                return BadRequest(new { message = "Settings must be a JSON object." });

            var config = await ConfigFor(access.Package.Id);
            config.ConfigJson = body.GetRawText();
            config.UpdatedAt = DateTime.UtcNow;
            config.UpdatedByUserId = ProjectAccessService.UserIdOf(User);
            await _db.SaveChangesAsync();

            return Ok(new { updatedAt = config.UpdatedAt });
        }

        /// <summary>Puts an earlier IPC back in view for everyone on the package.</summary>
        [HttpPut("api/packages/{idOrPath}/bridge-tracker/active-ipc")]
        public async Task<IActionResult> SetActiveIpc(string idOrPath, [FromBody] SetActiveIpcRequest request)
        {
            var access = await _access.ResolvePackageAsync(User, idOrPath);
            if (access is null) return NotFound();
            if (NotATracker(access.Package) is { } refusal) return refusal;
            if (!access.Can(ProjectRole.Contributor)) return Forbid();

            var isIpc = await _db.BridgeTrackerFiles.AnyAsync(f =>
                f.Id == request.FileId && f.PackageId == access.Package.Id && f.Kind == BridgeTrackerFileKind.Ipc);
            if (!isIpc) return BadRequest(new { message = "That file is not an IPC workbook of this package." });

            var config = await ConfigFor(access.Package.Id);
            config.ActiveIpcFileId = request.FileId;
            config.UpdatedAt = DateTime.UtcNow;
            config.UpdatedByUserId = ProjectAccessService.UserIdOf(User);
            await _db.SaveChangesAsync();

            return Ok(new { activeIpcFileId = config.ActiveIpcFileId });
        }

        // ------------------------------------------------------------------ helpers

        public sealed record FileView(
            long Id, string Kind, string FileName, long ByteSize, string Sha256,
            string? Bill, string? Period, DateTime UploadedAt,
            int? UploadedByUserId, string? UploadedByName, DateTime? SupersededAt);

        private IActionResult? NotATracker(Package package) =>
            package.Module == PackageModule.PalashbariTracker
                ? null
                : Conflict(new
                {
                    message = "This package is not set up as the Palashbari bridge tracker. " +
                              $"Set its module to '{PackageModule.PalashbariTracker}' first.",
                });

        private async Task<BridgeTrackerConfig> ConfigFor(int packageId)
        {
            var config = await _db.BridgeTrackerConfigs.FirstOrDefaultAsync(c => c.PackageId == packageId);
            if (config is not null) return config;

            config = new BridgeTrackerConfig { PackageId = packageId };
            _db.BridgeTrackerConfigs.Add(config);
            return config;
        }

        private static JsonElement? ParseConfig(string? json)
        {
            if (string.IsNullOrWhiteSpace(json)) return null;
            using var doc = JsonDocument.Parse(json);
            return doc.RootElement.Clone();
        }

        /// <summary>
        /// Refuses a file that is plainly the wrong kind before it is stored — a road
        /// workbook dropped on the IFC box, say. The browser parses properly; this only
        /// stops a mislabelled upload from becoming "the current model".
        /// </summary>
        private static string? CheckSignature(string kind, byte[] head, string fileName)
        {
            switch (kind)
            {
                case BridgeTrackerFileKind.Ifc:
                    var text = Encoding.ASCII.GetString(head).TrimStart('﻿', ' ', '\r', '\n', '\t');
                    return text.StartsWith("ISO-10303-21", StringComparison.Ordinal)
                        ? null
                        : $"{fileName} is not an IFC (STEP) file.";

                case BridgeTrackerFileKind.Register:
                case BridgeTrackerFileKind.Ipc:
                    // .xlsx and .xlsm are zip archives.
                    return head.Length >= 2 && head[0] == (byte)'P' && head[1] == (byte)'K'
                        ? null
                        : $"{fileName} is not an .xlsx workbook.";

                default:
                    return null;
            }
        }

        /// <summary>The alignment is the browser's reduction of the KMZ: an object with an "align" array.</summary>
        private static async Task<string?> CheckAlignmentAsync(string path)
        {
            try
            {
                await using var stream = System.IO.File.OpenRead(path);
                using var doc = await JsonDocument.ParseAsync(stream);
                var root = doc.RootElement;
                return root.ValueKind == JsonValueKind.Object
                    && root.TryGetProperty("align", out var align)
                    && align.ValueKind == JsonValueKind.Array
                    && align.GetArrayLength() >= 4
                    ? null
                    : "The alignment has no line in it. Upload the .kmz or .kml from the tracker.";
            }
            catch (JsonException)
            {
                return "The alignment is not valid JSON. Upload the .kmz or .kml from the tracker.";
            }
        }

        private static string ExtensionFor(string kind, string fileName) => kind switch
        {
            BridgeTrackerFileKind.Ifc => ".ifc",
            BridgeTrackerFileKind.Alignment => ".json",
            _ => string.Equals(Path.GetExtension(fileName), ".xlsm", StringComparison.OrdinalIgnoreCase)
                ? ".xlsm"
                : ".xlsx",
        };

        private static string ContentTypeFor(string kind) => kind switch
        {
            BridgeTrackerFileKind.Ifc => "application/x-step",
            BridgeTrackerFileKind.Alignment => "application/json",
            _ => "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        };

        private static string? Clip(string? value, int max)
        {
            var v = value?.Trim();
            if (string.IsNullOrEmpty(v)) return null;
            return v.Length <= max ? v : v[..max];
        }
    }
}
