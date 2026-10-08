using System;
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
    /// <summary>
    /// Bridge registers: one workbook per package, one row per activity, coloured onto the
    /// model by IFC GlobalId and Approval.
    ///
    /// Package-scoped like every other data route, and resolved through
    /// <see cref="ProjectAccessService"/> so the id in the URL is never trusted on its own.
    /// </summary>
    [ApiController]
    [Authorize]
    public class BridgeItemsController : ControllerBase
    {
        private readonly RoadDbContext _db;
        private readonly ProjectAccessService _access;
        private readonly BridgeImportService _import;
        private readonly string _archiveRoot;

        public BridgeItemsController(
            RoadDbContext db, ProjectAccessService access, BridgeImportService import,
            IConfiguration config, IWebHostEnvironment env)
        {
            _db = db;
            _access = access;
            _import = import;
            _archiveRoot = StoragePaths.Resolve(config["Storage:ImportRoot"], env, "imports");
        }

        /// <summary>The package's current register, in sheet order.</summary>
        [HttpGet("api/packages/{idOrPath}/bridge-items")]
        public async Task<IActionResult> List(string idOrPath, [FromQuery] bool includeSuperseded = false)
        {
            var access = await _access.ResolvePackageAsync(User, idOrPath);
            if (access is null) return NotFound();

            var query = _db.BridgeItems.Where(b => b.PackageId == access.Package.Id);
            if (!includeSuperseded) query = query.Where(b => b.SupersededAt == null);

            var rows = await query
                .OrderBy(b => b.SourceRowNumber ?? int.MaxValue)
                .ThenBy(b => b.Id)
                .Select(b => new
                {
                    id = b.Id,
                    key = b.SourceKey,
                    rowNumber = b.SourceRowNumber,
                    itemNo = b.ItemNo,
                    description = b.Description,
                    uom = b.Uom,
                    location = b.Location,
                    executedQuantity = b.ExecutedQuantity,
                    rfiRefs = b.RfiRefs,
                    rfiDates = b.RfiDates,
                    billNo = b.BillNo,
                    remarks = b.Remarks,
                    ifcGlobalId = b.IfcGlobalId,
                    approvalText = b.ApprovalText,
                    approval = b.Approval,
                    updatedAt = b.UpdatedAt,
                    supersededAt = b.SupersededAt,
                })
                .ToListAsync();

            return Ok(rows);
        }

        /// <summary>
        /// Imports one bridge register. Replaces the package's rows: what the sheet lists is
        /// upserted, what it no longer lists is soft-retired.
        /// </summary>
        [HttpPost("api/packages/{idOrPath}/bridge-imports")]
        [RequestSizeLimit(64L * 1024 * 1024)]
        public async Task<IActionResult> Import(
            string idOrPath,
            [FromForm] string payload,
            [FromForm] bool force = false,
            IFormFile? file = null)
        {
            var access = await _access.ResolvePackageAsync(User, idOrPath);
            if (access is null) return NotFound();
            if (!access.Can(ProjectRole.Contributor)) return Forbid();

            if (string.IsNullOrWhiteSpace(payload))
                return BadRequest(new { message = "Import payload is required." });

            BridgeImportPayloadDto? dto;
            try
            {
                dto = JsonSerializer.Deserialize<BridgeImportPayloadDto>(payload,
                    new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
            }
            catch (JsonException ex)
            {
                return BadRequest(new { message = $"Import payload is not valid JSON: {ex.Message}" });
            }

            if (dto is null) return BadRequest(new { message = "Import payload is empty." });

            // Nothing is written while an error stands — the same rule the uploader enforces.
            var errors = dto.Issues.Count(i => i.Level == "error");
            if (errors > 0)
                return BadRequest(new { message = $"Import carries {errors} unresolved error(s); fix them and retry." });

            if (dto.Items.Count == 0)
                return BadRequest(new { message = "The workbook has no register rows to import." });

            var archived = await ArchiveAsync(access.Package.Id, file);
            var result = await _import.ImportAsync(
                access.Package, dto, archived, ProjectAccessService.UserIdOf(User), force);

            return result.Status == ImportStatus.Failed ? StatusCode(500, result) : Ok(result);
        }

        /// <summary>
        /// Archives the original workbook under its own hash, beside the road imports. The
        /// same bytes uploaded twice are stored once.
        /// </summary>
        private async Task<ArchivedWorkbook?> ArchiveAsync(int packageId, IFormFile? file)
        {
            if (file is null || file.Length == 0) return null;

            var dir = Path.Combine(_archiveRoot, packageId.ToString());
            Directory.CreateDirectory(dir);

            string sha;
            await using (var stream = file.OpenReadStream())
                sha = Convert.ToHexString(await SHA256.HashDataAsync(stream)).ToLowerInvariant();

            var path = Path.Combine(dir, $"{sha}{Path.GetExtension(file.FileName)}");
            if (!System.IO.File.Exists(path))
            {
                await using var target = System.IO.File.Create(path);
                await using var source = file.OpenReadStream();
                await source.CopyToAsync(target);
            }

            return new ArchivedWorkbook(sha, file.Length, path);
        }
    }
}
