using System;
using System.Linq;
using System.Linq.Expressions;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using RoadBimBackend.Data;
using RoadBimBackend.Models;
using RoadBimBackend.Services;

namespace RoadBimBackend.Controllers
{
    public record CreatePackageRequest(
        string Name,
        string? Code,
        string? ContractorName,
        string? ContractNo,
        string? Description,
        int? ChainageFromM,
        int? ChainageToM,
        int? InspectionNoticeHours,
        string? Module = null);

    public record UpdatePackageRequest(
        string? Name,
        string? ContractorName,
        string? ContractNo,
        string? Description,
        int? ChainageFromM,
        int? ChainageToM,
        int? InspectionNoticeHours,
        string? Status,
        int? SortOrder,
        string? Module = null);

    /// <summary>
    /// Packages are the unit road data belongs to; a project is the unit people belong to.
    /// So every route here resolves membership through the owning project and then filters
    /// rows by package — the permission and the filter are never applied to different scopes.
    ///
    /// A package the caller cannot see returns 404 rather than 403, matching
    /// <see cref="ProjectsController"/>: the two answers are indistinguishable on purpose.
    /// </summary>
    [ApiController]
    [Authorize]
    public class PackagesController : ControllerBase
    {
        private readonly RoadDbContext _db;
        private readonly ProjectAccessService _access;

        public PackagesController(RoadDbContext db, ProjectAccessService access)
        {
            _db = db;
            _access = access;
        }

        /// <summary>
        /// Every package in a project, with the counts that tell you whether it is ready to
        /// draw — a package with no chainages and no model contributes nothing to the map,
        /// and that is worth seeing before you go looking for the reason.
        /// </summary>
        [HttpGet("api/projects/{idOrCode}/packages")]
        public async Task<IActionResult> List(string idOrCode)
        {
            var access = await _access.ResolveAsync(User, idOrCode);
            if (access is null) return NotFound();

            var rows = await _db.Packages
                .Where(p => p.ProjectId == access.Project.Id)
                .OrderBy(p => p.SortOrder).ThenBy(p => p.Code)
                .Select(SummarySelector(_db))
                .ToListAsync();

            return Ok(rows);
        }

        [HttpGet("api/packages/{idOrPath}")]
        public async Task<IActionResult> Get(string idOrPath)
        {
            var access = await _access.ResolvePackageAsync(User, idOrPath);
            if (access is null) return NotFound();

            var p = access.Package;

            var activeModel = await _db.IfcModels
                .Where(m => m.PackageId == p.Id && m.IsActive)
                .Select(m => new
                {
                    m.Id, m.Version, m.OriginalFileName, m.SchemaName, m.LengthUnit,
                    m.SiteLatitude, m.SiteLongitude, m.SiteElevationM,
                    m.ElementCount, m.CorridorLengthM, m.CorridorWidthM, m.UploadedAt,
                })
                .FirstOrDefaultAsync();

            var lastImport = await _db.ImportBatches
                .Where(b => b.PackageId == p.Id)
                .OrderByDescending(b => b.StartedAt)
                .Select(b => new
                {
                    b.Id, b.Status, b.Mode, b.StartedAt, b.CompletedAt,
                    b.RowsInserted, b.RowsUpdated, b.RowsUnchanged,
                })
                .FirstOrDefaultAsync();

            return Ok(new
            {
                id = p.Id,
                projectId = p.ProjectId,
                projectCode = access.Project.Code,
                projectName = access.Project.Name,
                code = p.Code,
                name = p.Name,
                description = p.Description,
                contractorName = p.ContractorName,
                contractNo = p.ContractNo,
                chainageFromM = p.ChainageFromM,
                chainageToM = p.ChainageToM,
                inspectionNoticeHours = p.InspectionNoticeHours,
                status = p.Status,
                module = p.Module,
                sortOrder = p.SortOrder,
                createdAt = p.CreatedAt,
                updatedAt = p.UpdatedAt,
                role = access.Role.ToString(),
                activeModel,
                lastImport,
            });
        }

        [HttpPost("api/projects/{idOrCode}/packages")]
        public async Task<IActionResult> Create(string idOrCode, [FromBody] CreatePackageRequest request)
        {
            var access = await _access.ResolveAsync(User, idOrCode);
            if (access is null) return NotFound();
            if (!access.Can(ProjectRole.Contributor)) return Forbid();

            var name = (request.Name ?? string.Empty).Trim();
            if (name.Length == 0)
                return BadRequest(new { message = "Package name is required." });

            var contractor = (request.ContractorName ?? string.Empty).Trim();
            if (contractor.Length == 0)
                return BadRequest(new { message = "Contractor is required. A package is let to one contractor, and every RFI raised against it inherits the name from here." });

            var code = Slugify(string.IsNullOrWhiteSpace(request.Code) ? name : request.Code!);
            if (await _db.Packages.AnyAsync(p => p.ProjectId == access.Project.Id && p.Code == code))
                return Conflict(new { message = $"This project already has a package with code '{code}'." });

            if (request.ChainageFromM is int from && request.ChainageToM is int to && to < from)
                return BadRequest(new { message = "Chainage to must not be before chainage from." });

            if (!TryReadModule(request.Module, out var module))
                return BadRequest(new { message = UnknownModuleMessage });

            var nextSort = await _db.Packages
                .Where(p => p.ProjectId == access.Project.Id)
                .Select(p => (int?)p.SortOrder)
                .MaxAsync() ?? -1;

            var package = new Package
            {
                ProjectId = access.Project.Id,
                Code = code,
                Name = name,
                Description = request.Description,
                ContractorName = contractor,
                ContractNo = string.IsNullOrWhiteSpace(request.ContractNo) ? null : request.ContractNo!.Trim(),
                ChainageFromM = request.ChainageFromM,
                ChainageToM = request.ChainageToM,
                InspectionNoticeHours = Math.Clamp(request.InspectionNoticeHours ?? 24, 1, 24 * 30),
                Status = PackageStatus.Active,
                Module = module,
                SortOrder = nextSort + 1,
                CreatedByUserId = ProjectAccessService.UserIdOf(User),
            };

            _db.Packages.Add(package);
            await _db.SaveChangesAsync();

            return CreatedAtAction(nameof(Get), new { idOrPath = package.Id.ToString() },
                new
                {
                    id = package.Id,
                    projectId = package.ProjectId,
                    code = package.Code,
                    name = package.Name,
                    contractorName = package.ContractorName,
                    status = package.Status,
                    module = package.Module,
                });
        }

        [HttpPatch("api/packages/{idOrPath}")]
        public async Task<IActionResult> Update(string idOrPath, [FromBody] UpdatePackageRequest request)
        {
            var access = await _access.ResolvePackageAsync(User, idOrPath);
            if (access is null) return NotFound();
            if (!access.Can(ProjectRole.Contributor)) return Forbid();

            var p = access.Package;

            if (!string.IsNullOrWhiteSpace(request.Name)) p.Name = request.Name.Trim();
            if (!string.IsNullOrWhiteSpace(request.ContractorName)) p.ContractorName = request.ContractorName.Trim();
            if (request.ContractNo is not null)
                p.ContractNo = string.IsNullOrWhiteSpace(request.ContractNo) ? null : request.ContractNo.Trim();
            if (request.Description is not null) p.Description = request.Description;
            if (request.ChainageFromM is not null) p.ChainageFromM = request.ChainageFromM;
            if (request.ChainageToM is not null) p.ChainageToM = request.ChainageToM;
            if (request.InspectionNoticeHours is int hours)
                p.InspectionNoticeHours = Math.Clamp(hours, 1, 24 * 30);
            if (request.SortOrder is int sort) p.SortOrder = sort;

            // Absent leaves it alone; an empty string turns the package back into a road package.
            if (request.Module is not null)
            {
                if (!TryReadModule(request.Module, out var module))
                    return BadRequest(new { message = UnknownModuleMessage });
                p.Module = module;
            }

            if (!string.IsNullOrWhiteSpace(request.Status))
            {
                var status = request.Status.Trim().ToLowerInvariant();
                if (!PackageStatus.All.Contains(status))
                    return BadRequest(new { message = $"Status must be one of: {string.Join(", ", PackageStatus.All)}." });
                p.Status = status;
            }

            if (p.ChainageFromM is int f && p.ChainageToM is int t && t < f)
                return BadRequest(new { message = "Chainage to must not be before chainage from." });

            p.UpdatedAt = DateTime.UtcNow;
            await _db.SaveChangesAsync();

            return Ok(new
            {
                id = p.Id,
                code = p.Code,
                name = p.Name,
                contractorName = p.ContractorName,
                status = p.Status,
                module = p.Module,
                chainageFromM = p.ChainageFromM,
                chainageToM = p.ChainageToM,
                inspectionNoticeHours = p.InspectionNoticeHours,
            });
        }

        /// <summary>
        /// Deleting a package takes its chainages, layers, progress, models and imports with
        /// it, so it is Owner-only and refuses while it is the project's last one — a project
        /// with no package has nowhere to put the next import.
        /// </summary>
        [HttpDelete("api/packages/{idOrPath}")]
        public async Task<IActionResult> Delete(string idOrPath)
        {
            var access = await _access.ResolvePackageAsync(User, idOrPath);
            if (access is null) return NotFound();
            if (!access.Can(ProjectRole.Owner)) return Forbid();

            var siblings = await _db.Packages.CountAsync(p => p.ProjectId == access.Package.ProjectId);
            if (siblings <= 1)
                return BadRequest(new { message = "A project must keep at least one package." });

            _db.Packages.Remove(access.Package);
            await _db.SaveChangesAsync();
            return NoContent();
        }

        // ------------------------------------------------------------------ data

        [HttpGet("api/packages/{idOrPath}/chainages")]
        public async Task<IActionResult> Chainages(string idOrPath)
        {
            var access = await _access.ResolvePackageAsync(User, idOrPath);
            if (access is null) return NotFound();

            return Ok(await ChainageQuery(_db.RoadChainages
                .Where(c => c.PackageId == access.Package.Id)).ToListAsync());
        }

        [HttpGet("api/packages/{idOrPath}/layers")]
        public async Task<IActionResult> Layers(string idOrPath)
        {
            var access = await _access.ResolvePackageAsync(User, idOrPath);
            if (access is null) return NotFound();

            return Ok(await LayerQuery(_db.RoadLayers
                .Where(l => l.PackageId == access.Package.Id)).ToListAsync());
        }

        [HttpGet("api/packages/{idOrPath}/progress")]
        public async Task<IActionResult> Progress(string idOrPath, [FromQuery] bool includeSuperseded = false)
        {
            var access = await _access.ResolvePackageAsync(User, idOrPath);
            if (access is null) return NotFound();

            var query = _db.LayerProgresses.Where(p => p.PackageId == access.Package.Id);
            if (!includeSuperseded) query = query.Where(p => p.SupersededAt == null);

            return Ok(await ProgressQuery(query).ToListAsync());
        }

        // ------------------------------------------------------- shared projections

        /// <summary>
        /// The row shapes are shared with <see cref="ProjectsController"/> so a package read
        /// and a project-wide read return identical objects. The client merges them without
        /// caring which endpoint they came from.
        ///
        /// They project into named types through an expression, never through a helper
        /// method that builds the object: EF cannot translate a method call inside
        /// <c>Select</c> into SQL, and that failure surfaces as a 500 at runtime rather than
        /// an error at build.
        /// </summary>
        internal static IQueryable<ChainageRowDto> ChainageQuery(IQueryable<RoadChainage> source) =>
            source
                .OrderBy(c => c.PackageId)
                .ThenBy(c => c.SortOrder ?? c.SourceChainageId ?? c.Id)
                .Select(c => new ChainageRowDto
                {
                    Id = c.SourceChainageId ?? c.Id,
                    DbId = c.Id,
                    PackageId = c.PackageId,
                    ChainageStart = c.ChainageStart,
                    ChainageEnd = c.ChainageEnd,
                    KmLabel = c.KmLabel,
                    SectionName = c.SectionName,
                    Latitude = c.Latitude,
                    Longitude = c.Longitude,
                    ElevationM = c.Elevation,
                    TerrainType = c.TerrainType,
                    SortOrder = c.SortOrder,
                });

        internal static IQueryable<LayerRowDto> LayerQuery(IQueryable<RoadLayer> source) =>
            source
                .OrderBy(l => l.PackageId).ThenBy(l => l.SortOrder)
                .Select(l => new LayerRowDto
                {
                    Id = l.Id,
                    PackageId = l.PackageId,
                    Code = l.Code,
                    LayerName = l.LayerName,
                    CatalogueThicknessMm = l.ThicknessMm,
                    MaterialType = l.MaterialType,
                    DefaultColorHex = l.DefaultColorHex,
                    SortOrder = l.SortOrder,
                });

        // No Include() here: the projection already reaches through Chainage and Layer, and
        // an Include alongside a projection is ignored anyway.
        internal static IQueryable<ProgressRowDto> ProgressQuery(IQueryable<LayerProgress> source) =>
            source
                .OrderBy(p => p.PackageId)
                .ThenBy(p => p.Chainage!.SortOrder ?? p.ChainageId)
                .ThenBy(p => p.Layer!.SortOrder)
                .Select(p => new ProgressRowDto
                {
                    Id = p.Id,
                    Key = p.SourceRowKey,
                    PackageId = p.PackageId,
                    ChainageId = p.Chainage!.SourceChainageId ?? p.ChainageId,
                    ChainageDbId = p.ChainageId,
                    LayerCode = p.Layer!.Code,
                    LayerNameInSheet = p.Layer.LayerName,
                    IfcRef = p.SourceIfcRef,
                    Status = p.Status,
                    RawStatus = p.SourceStatusText,
                    ProgressPercent = p.ProgressPercent,
                    PlannedStartDate = p.PlannedStartDate,
                    PlannedEndDate = p.PlannedEndDate,
                    ActualStartDate = p.ActualStartDate,
                    ActualEndDate = p.ActualEndDate,
                    BudgetCost = p.BudgetCost,
                    ActualCost = p.ActualCost,
                    CostVariance = p.CostVariance,
                    DelayDays = p.DelayDays,
                    ExcelDesignThicknessMm = p.DesignThicknessMm,
                    LevelColorHex = p.LevelColorHex,
                    UpdatedBy = p.UpdatedBy,
                    UpdatedAt = p.UpdatedAt,
                    SupersededAt = p.SupersededAt,
                    Source = p.Source,
                    SourceRfiId = p.SourceRfiId,
                });

        /// <summary>
        /// Card shape for the package list, as an expression so the counts run as correlated
        /// subqueries in one round trip rather than a query per package.
        /// </summary>
        private static Expression<Func<Package, PackageSummaryDto>> SummarySelector(RoadDbContext db) =>
            p => new PackageSummaryDto
            {
                Id = p.Id,
                ProjectId = p.ProjectId,
                Code = p.Code,
                Name = p.Name,
                Description = p.Description,
                ContractorName = p.ContractorName,
                ContractNo = p.ContractNo,
                ChainageFromM = p.ChainageFromM,
                ChainageToM = p.ChainageToM,
                InspectionNoticeHours = p.InspectionNoticeHours,
                Status = p.Status,
                Module = p.Module,
                SortOrder = p.SortOrder,
                UpdatedAt = p.UpdatedAt,
                ChainageCount = db.RoadChainages.Count(c => c.PackageId == p.Id),
                LayerCount = db.RoadLayers.Count(l => l.PackageId == p.Id),
                ProgressCount = db.LayerProgresses.Count(x => x.PackageId == p.Id && x.SupersededAt == null),
                ActiveModel = db.IfcModels
                    .Where(m => m.PackageId == p.Id && m.IsActive)
                    .Select(m => new ActiveModelBriefDto
                    {
                        Id = m.Id,
                        OriginalFileName = m.OriginalFileName,
                        Version = m.Version,
                        ElementCount = m.ElementCount,
                    })
                    .FirstOrDefault(),
            };

        private static readonly string UnknownModuleMessage =
            $"Module must be empty (a road package) or one of: {string.Join(", ", PackageModule.All)}.";

        /// <summary>Blank means a road package; anything else must be a module we know.</summary>
        private static bool TryReadModule(string? raw, out string? module)
        {
            module = null;
            if (string.IsNullOrWhiteSpace(raw)) return true;
            module = PackageModule.Normalise(raw);
            return module is not null;
        }

        private static string Slugify(string input)
        {
            var lowered = input.Trim().ToLowerInvariant();
            var slug = Regex.Replace(lowered, @"[^a-z0-9]+", "-").Trim('-');
            return slug.Length == 0
                ? $"package-{Guid.NewGuid():N}"[..20]
                : slug[..Math.Min(slug.Length, 60)];
        }
    }
}
