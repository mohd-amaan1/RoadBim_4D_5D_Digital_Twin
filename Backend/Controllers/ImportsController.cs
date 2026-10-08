using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
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
    [ApiController]
    [Authorize]
    public class ImportsController : ControllerBase
    {
        private readonly RoadDbContext _db;
        private readonly ProjectAccessService _access;
        private readonly ProjectImportService _import;
        private readonly string _storageRoot;

        public ImportsController(
            RoadDbContext db, ProjectAccessService access,
            ProjectImportService import, IConfiguration config, IWebHostEnvironment env)
        {
            _db = db;
            _access = access;
            _import = import;
            _storageRoot = StoragePaths.Resolve(config["Storage:ImportRoot"], env, "imports");
        }

        /// <summary>
        /// Imports a validated workbook set.
        ///
        /// The request carries both the original .xlsx files (archived for audit) and the
        /// normalised payload the client's parser produced. Keeping parsing on the client
        /// means one implementation of the normalisation rules rather than two that drift;
        /// the server owns identity, transactions and authorization.
        /// </summary>
        [HttpPost("api/packages/{idOrPath}/imports")]
        [RequestSizeLimit(128L * 1024 * 1024)]
        public async Task<IActionResult> Create(
            string idOrPath,
            [FromForm] string payload,
            [FromForm] bool force = false,
            [FromForm] IFormFileCollection? files = null)
        {
            var access = await _access.ResolvePackageAsync(User, idOrPath);
            if (access is null) return NotFound();
            if (!access.Can(ProjectRole.Contributor)) return Forbid();

            if (string.IsNullOrWhiteSpace(payload))
                return BadRequest(new { message = "Import payload is required." });

            ImportPayloadDto? dto;
            try
            {
                dto = JsonSerializer.Deserialize<ImportPayloadDto>(payload,
                    new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
            }
            catch (JsonException ex)
            {
                return BadRequest(new { message = $"Import payload is not valid JSON: {ex.Message}" });
            }

            if (dto is null) return BadRequest(new { message = "Import payload is empty." });

            // Nothing is written while an error stands — the same rule the uploader enforces
            var errors = dto.Issues.Count(i => i.Level == "error");
            if (errors > 0)
                return BadRequest(new { message = $"Import carries {errors} unresolved error(s); fix them and retry." });

            var archived = await ArchiveAsync(access.Package.Id, files);
            foreach (var f in dto.Files)
            {
                if (archived.TryGetValue(f.FileName, out var info))
                {
                    f.ContentSha256 ??= info.sha;
                    f.ByteSize = info.size;
                }
            }

            var result = await _import.ImportAsync(
                access.Package, dto, ProjectAccessService.UserIdOf(User), force);

            // Record where each workbook was archived, once the batch exists
            if (archived.Count > 0 && !result.AlreadyImported)
            {
                var rows = await _db.ImportBatchFiles
                    .Where(f => f.ImportBatchId == result.BatchId).ToListAsync();
                foreach (var row in rows)
                    if (archived.TryGetValue(row.FileName, out var info)) row.StoragePath = info.path;
                await _db.SaveChangesAsync();
            }

            return result.Status == ImportStatus.Failed
                ? StatusCode(500, result)
                : Ok(result);
        }

        private async Task<Dictionary<string, (string sha, long size, string path)>> ArchiveAsync(
            int packageId, IFormFileCollection? files)
        {
            var map = new Dictionary<string, (string, long, string)>(StringComparer.OrdinalIgnoreCase);
            if (files is null || files.Count == 0) return map;

            var dir = Path.Combine(_storageRoot, packageId.ToString());
            Directory.CreateDirectory(dir);

            foreach (var file in files)
            {
                if (file.Length == 0) continue;

                string sha;
                await using (var s = file.OpenReadStream())
                    sha = Convert.ToHexString(await SHA256.HashDataAsync(s)).ToLowerInvariant();

                var ext = Path.GetExtension(file.FileName);
                var path = Path.Combine(dir, $"{sha}{ext}");
                if (!System.IO.File.Exists(path))
                {
                    await using var target = System.IO.File.Create(path);
                    await using var source = file.OpenReadStream();
                    await source.CopyToAsync(target);
                }

                map[Path.GetFileName(file.FileName)] = (sha, file.Length, path);
            }

            return map;
        }

        [HttpGet("api/packages/{idOrPath}/imports")]
        public async Task<IActionResult> ListForPackage(string idOrPath, [FromQuery] int limit = 25)
        {
            var access = await _access.ResolvePackageAsync(User, idOrPath);
            if (access is null) return NotFound();

            return Ok(await BatchQuery(
                _db.ImportBatches.Where(b => b.PackageId == access.Package.Id), limit).ToListAsync());
        }

        [HttpGet("api/projects/{idOrCode}/imports")]
        public async Task<IActionResult> List(string idOrCode, [FromQuery] int limit = 25)
        {
            var access = await _access.ResolveAsync(User, idOrCode);
            if (access is null) return NotFound();

            return Ok(await BatchQuery(
                _db.ImportBatches.Where(b => b.ProjectId == access.Project.Id), limit).ToListAsync());
        }

        private static IQueryable<object> BatchQuery(IQueryable<ImportBatch> source, int limit) =>
            source
                .OrderByDescending(b => b.StartedAt)
                .Take(Math.Clamp(limit, 1, 200))
                .Select(b => (object)new
                {
                    b.Id, b.PackageId, b.Mode, b.Status, b.StartedAt, b.CompletedAt,
                    b.RowsInserted, b.RowsUpdated, b.RowsUnchanged, b.RowsRejected,
                    b.RowsSuperseded, b.BindingsWritten, b.ErrorCount, b.WarningCount,
                    b.FailureMessage,
                    files = b.Files.Select(f => new { f.FileName, f.SheetKind, f.RowCount }).ToList(),
                });

        [HttpGet("api/imports/{batchId:long}")]
        public async Task<IActionResult> Get(long batchId)
        {
            var batch = await _db.ImportBatches.Include(b => b.Files)
                .FirstOrDefaultAsync(b => b.Id == batchId);
            if (batch is null) return NotFound();

            var access = await _access.ResolveAsync(User, batch.ProjectId.ToString());
            if (access is null) return NotFound();

            return Ok(new
            {
                batch.Id, batch.ProjectId, batch.PackageId, batch.Mode, batch.Status, batch.ContentSha256,
                batch.RowsInserted, batch.RowsUpdated, batch.RowsUnchanged, batch.RowsRejected,
                batch.RowsSuperseded, batch.BindingsWritten,
                batch.ErrorCount, batch.WarningCount, batch.FailureMessage,
                batch.StartedAt, batch.CompletedAt,
                files = batch.Files.Select(f => new
                {
                    f.FileName, f.SheetName, f.SheetKind, f.RowCount, f.ContentSha256, f.ByteSize,
                }),
            });
        }

        [HttpGet("api/imports/{batchId:long}/issues")]
        public async Task<IActionResult> Issues(long batchId, [FromQuery] string? level)
        {
            var batch = await _db.ImportBatches.FirstOrDefaultAsync(b => b.Id == batchId);
            if (batch is null) return NotFound();

            var access = await _access.ResolveAsync(User, batch.ProjectId.ToString());
            if (access is null) return NotFound();

            var query = _db.ImportIssues.Where(i => i.ImportBatchId == batchId);
            if (!string.IsNullOrWhiteSpace(level)) query = query.Where(i => i.Level == level);

            var rows = await query
                .OrderBy(i => i.Level).ThenBy(i => i.RowNumber)
                .Select(i => new
                {
                    level = i.Level,
                    code = i.Code,
                    message = i.Message,
                    sheet = i.SheetName,
                    row = i.RowNumber,
                    field = i.FieldName,
                })
                .ToListAsync();

            return Ok(rows);
        }
    }
}
