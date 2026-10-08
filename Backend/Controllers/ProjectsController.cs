using System;
using System.Linq;
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
    public record CreateProjectRequest(string Name, string? Code, string? Description);
    public record UpdateProjectRequest(string? Name, string? Description, string? ChainageDirection);
    public record AddMemberRequest(string Email, string Role, bool? IsFieldEngineer);

    /// <summary>
    /// Every route here resolves the project through <see cref="ProjectAccessService"/>
    /// rather than trusting the id in the URL, so a caller cannot reach another tenant's
    /// data by guessing. A project the caller is not a member of returns 404, not 403 —
    /// the two are indistinguishable on purpose.
    /// </summary>
    [ApiController]
    [Authorize]
    [Route("api/projects")]
    public class ProjectsController : ControllerBase
    {
        private readonly RoadDbContext _db;
        private readonly ProjectAccessService _access;

        public ProjectsController(RoadDbContext db, ProjectAccessService access)
        {
            _db = db;
            _access = access;
        }

        [HttpGet]
        public async Task<IActionResult> List()
        {
            var userId = ProjectAccessService.UserIdOf(User);

            // A system administrator reaches every project without a membership row, so the
            // role subquery finds nothing and the card renders with no role at all. Falling
            // back to Owner matches what ProjectAccessService actually grants them — and it
            // is what stops every project looking role-less while sign-in is disabled.
            var roleWithoutMembership = ProjectAccessService.IsSystemAdmin(User) ? "Owner" : null;

            var projects = await _access.VisibleProjects(User)
                .OrderBy(p => p.Name)
                .Select(p => new
                {
                    id = p.Id,
                    code = p.Code,
                    name = p.Name,
                    description = p.Description,
                    chainageDirection = p.ChainageDirection,
                    updatedAt = p.UpdatedAt,
                    role = _db.ProjectMembers
                        .Where(m => m.ProjectId == p.Id && m.UserId == userId)
                        .Select(m => m.Role.ToString())
                        .FirstOrDefault() ?? roleWithoutMembership,
                    chainageCount = _db.RoadChainages.Count(c => c.ProjectId == p.Id),
                    layerCount = _db.RoadLayers.Count(l => l.ProjectId == p.Id),
                    progressCount = _db.LayerProgresses
                        .Count(x => x.ProjectId == p.Id && x.SupersededAt == null),
                    packageCount = _db.Packages.Count(k => k.ProjectId == p.Id),
                    // A project now holds one active model per package, so this is a count
                    // rather than the single model it used to be.
                    activeModelCount = _db.IfcModels.Count(m => m.ProjectId == p.Id && m.IsActive),
                })
                .ToListAsync();

            return Ok(projects);
        }

        [HttpGet("{idOrCode}")]
        public async Task<IActionResult> Get(string idOrCode)
        {
            var access = await _access.ResolveAsync(User, idOrCode);
            if (access is null) return NotFound();

            var p = access.Project;

            // Every package's active model, not one of them. The map draws them together,
            // so returning the first would silently hide the rest.
            var activeModels = await _db.IfcModels
                .Where(m => m.ProjectId == p.Id && m.IsActive)
                .OrderBy(m => m.PackageId)
                .Select(m => new
                {
                    m.Id, m.PackageId, m.Version, m.OriginalFileName, m.SchemaName, m.LengthUnit,
                    m.SiteLatitude, m.SiteLongitude, m.SiteElevationM,
                    m.ElementCount, m.CorridorLengthM, m.CorridorWidthM, m.UploadedAt,
                })
                .ToListAsync();

            var packages = await _db.Packages
                .Where(k => k.ProjectId == p.Id)
                .OrderBy(k => k.SortOrder).ThenBy(k => k.Code)
                .Select(k => new
                {
                    id = k.Id, code = k.Code, name = k.Name,
                    contractorName = k.ContractorName, status = k.Status,
                    chainageFromM = k.ChainageFromM, chainageToM = k.ChainageToM,
                    inspectionNoticeHours = k.InspectionNoticeHours,
                })
                .ToListAsync();

            var lastImport = await _db.ImportBatches
                .Where(b => b.ProjectId == p.Id)
                .OrderByDescending(b => b.StartedAt)
                .Select(b => new { b.Id, b.Status, b.Mode, b.StartedAt, b.CompletedAt,
                                   b.RowsInserted, b.RowsUpdated, b.RowsUnchanged })
                .FirstOrDefaultAsync();

            return Ok(new
            {
                id = p.Id,
                code = p.Code,
                name = p.Name,
                description = p.Description,
                chainageDirection = p.ChainageDirection,
                createdAt = p.CreatedAt,
                updatedAt = p.UpdatedAt,
                role = access.Role.ToString(),
                packages,
                activeModels,
                lastImport,
            });
        }

        [HttpPost]
        public async Task<IActionResult> Create([FromBody] CreateProjectRequest request)
        {
            var userId = ProjectAccessService.UserIdOf(User);
            if (userId is null) return Unauthorized();

            var name = (request.Name ?? string.Empty).Trim();
            if (name.Length == 0) return BadRequest(new { message = "Project name is required." });

            var code = Slugify(string.IsNullOrWhiteSpace(request.Code) ? name : request.Code!);
            if (await _db.Projects.AnyAsync(p => p.Code == code))
                return Conflict(new { message = $"A project with code '{code}' already exists." });

            var project = new Project
            {
                Code = code,
                Name = name,
                Description = request.Description,
                CreatedByUserId = userId,
            };
            _db.Projects.Add(project);
            await _db.SaveChangesAsync();

            // The creator owns it; without this row they would immediately lose access
            _db.ProjectMembers.Add(new ProjectMember
            {
                ProjectId = project.Id,
                UserId = userId.Value,
                Role = ProjectRole.Owner,
            });
            await _db.SaveChangesAsync();

            // Road data belongs to a package, so a project with none has nowhere to import
            // into. One is created here and renamed later, rather than making the first
            // import fail on a project that looks ready.
            var package = DatabaseSeeder.EnsureDefaultPackage(_db, project);

            return CreatedAtAction(nameof(Get), new { idOrCode = project.Code },
                new
                {
                    id = project.Id,
                    code = project.Code,
                    name = project.Name,
                    role = "Owner",
                    defaultPackage = new { package.Id, package.Code, package.Name },
                });
        }

        [HttpPatch("{idOrCode}")]
        public async Task<IActionResult> Update(string idOrCode, [FromBody] UpdateProjectRequest request)
        {
            var access = await _access.ResolveAsync(User, idOrCode);
            if (access is null) return NotFound();
            if (!access.Can(ProjectRole.Owner))
                return Forbid();

            var p = access.Project;
            if (!string.IsNullOrWhiteSpace(request.Name)) p.Name = request.Name.Trim();
            if (request.Description is not null) p.Description = request.Description;

            if (!string.IsNullOrWhiteSpace(request.ChainageDirection))
            {
                var dir = request.ChainageDirection.Trim().ToLowerInvariant();
                if (dir is not ("auto" or "ascending" or "descending"))
                    return BadRequest(new { message = "ChainageDirection must be auto, ascending or descending." });
                p.ChainageDirection = dir;
            }

            p.UpdatedAt = DateTime.UtcNow;
            await _db.SaveChangesAsync();

            return Ok(new { id = p.Id, code = p.Code, name = p.Name, chainageDirection = p.ChainageDirection });
        }

        // ------------------------------------------------------------- membership

        [HttpGet("{idOrCode}/members")]
        public async Task<IActionResult> Members(string idOrCode)
        {
            var access = await _access.ResolveAsync(User, idOrCode);
            if (access is null) return NotFound();

            var members = await _db.ProjectMembers
                .Where(m => m.ProjectId == access.Project.Id)
                .Include(m => m.User)
                .Select(m => new
                {
                    userId = m.UserId,
                    email = m.User!.Email,
                    displayName = m.User.DisplayName,
                    role = m.Role.ToString(),
                    isFieldEngineer = m.IsFieldEngineer,
                    isSuperuser = m.User.IsSystemAdmin,
                    since = m.CreatedAt,
                })
                .ToListAsync();

            return Ok(members);
        }

        [HttpPost("{idOrCode}/members")]
        public async Task<IActionResult> AddMember(string idOrCode, [FromBody] AddMemberRequest request)
        {
            var access = await _access.ResolveAsync(User, idOrCode);
            if (access is null) return NotFound();
            if (!access.Can(ProjectRole.Owner)) return Forbid();

            if (!Enum.TryParse<ProjectRole>(request.Role, ignoreCase: true, out var role))
                return BadRequest(new { message = "Role must be Viewer, Contributor or Owner." });

            var email = (request.Email ?? string.Empty).Trim().ToLowerInvariant();
            var user = await _db.Users.FirstOrDefaultAsync(u => u.Email == email);
            if (user is null) return NotFound(new { message = "No account with that email." });

            var existing = await _db.ProjectMembers
                .FirstOrDefaultAsync(m => m.ProjectId == access.Project.Id && m.UserId == user.Id);

            if (existing is not null)
            {
                existing.Role = role;
                // Omitted means "leave it as it is" — re-inviting somebody to change their
                // role should not quietly strip their field-engineer designation.
                if (request.IsFieldEngineer is bool fe) existing.IsFieldEngineer = fe;
            }
            else
            {
                _db.ProjectMembers.Add(new ProjectMember
                {
                    ProjectId = access.Project.Id,
                    UserId = user.Id,
                    Role = role,
                    IsFieldEngineer = request.IsFieldEngineer ?? false,
                    InvitedByUserId = ProjectAccessService.UserIdOf(User),
                });
            }

            await _db.SaveChangesAsync();
            return Ok(new
            {
                userId = user.Id,
                email = user.Email,
                role = role.ToString(),
                isFieldEngineer = request.IsFieldEngineer ?? existing?.IsFieldEngineer ?? false,
            });
        }

        [HttpDelete("{idOrCode}/members/{userId:int}")]
        public async Task<IActionResult> RemoveMember(string idOrCode, int userId)
        {
            var access = await _access.ResolveAsync(User, idOrCode);
            if (access is null) return NotFound();
            if (!access.Can(ProjectRole.Owner)) return Forbid();

            var member = await _db.ProjectMembers
                .FirstOrDefaultAsync(m => m.ProjectId == access.Project.Id && m.UserId == userId);
            if (member is null) return NotFound();

            // Removing the last owner would leave the project unadministrable
            if (member.Role == ProjectRole.Owner)
            {
                var owners = await _db.ProjectMembers
                    .CountAsync(m => m.ProjectId == access.Project.Id && m.Role == ProjectRole.Owner);
                if (owners <= 1)
                    return BadRequest(new { message = "A project must keep at least one owner." });
            }

            _db.ProjectMembers.Remove(member);
            await _db.SaveChangesAsync();
            return NoContent();
        }

        // ------------------------------------------------------------------ data

        /// <summary>
        /// Every chainage in the project, across all of its packages, each row tagged with
        /// the package it belongs to. This is what puts every package on one map: the client
        /// reads the project once rather than fanning out per package and stitching.
        /// </summary>
        [HttpGet("{idOrCode}/chainages")]
        public async Task<IActionResult> Chainages(string idOrCode)
        {
            var access = await _access.ResolveAsync(User, idOrCode);
            if (access is null) return NotFound();

            return Ok(await PackagesController.ChainageQuery(_db.RoadChainages
                .Where(c => c.ProjectId == access.Project.Id)).ToListAsync());
        }

        [HttpGet("{idOrCode}/layers")]
        public async Task<IActionResult> Layers(string idOrCode)
        {
            var access = await _access.ResolveAsync(User, idOrCode);
            if (access is null) return NotFound();

            return Ok(await PackagesController.LayerQuery(_db.RoadLayers
                .Where(l => l.ProjectId == access.Project.Id)).ToListAsync());
        }

        /// <summary>
        /// Progress rows in the shape the client's importer produces, so the restored state
        /// is byte-for-byte the same object the in-memory import built.
        /// </summary>
        [HttpGet("{idOrCode}/progress")]
        public async Task<IActionResult> Progress(string idOrCode, [FromQuery] bool includeSuperseded = false)
        {
            var access = await _access.ResolveAsync(User, idOrCode);
            if (access is null) return NotFound();

            var query = _db.LayerProgresses
                .Where(p => p.ProjectId == access.Project.Id);
            if (!includeSuperseded) query = query.Where(p => p.SupersededAt == null);

            return Ok(await PackagesController.ProgressQuery(query).ToListAsync());
        }

        private static string Slugify(string input)
        {
            var lowered = input.Trim().ToLowerInvariant();
            var slug = Regex.Replace(lowered, @"[^a-z0-9]+", "-").Trim('-');
            return slug.Length == 0 ? $"project-{Guid.NewGuid():N}"[..20] : slug[..Math.Min(slug.Length, 60)];
        }
    }
}
