using System;
using System.Linq;
using System.Security.Claims;
using System.Threading.Tasks;
using Microsoft.EntityFrameworkCore;
using RoadBimBackend.Data;
using RoadBimBackend.Models;

namespace RoadBimBackend.Services
{
    /// <summary>
    /// The single place project authorization is decided.
    ///
    /// Every project-scoped endpoint resolves the project through this service rather than
    /// trusting a route parameter, so a caller cannot reach another tenant's data by
    /// guessing an id. Membership is read from the database on each request instead of
    /// being carried in the token, which means revoking someone takes effect at once.
    /// </summary>
    public class ProjectAccessService
    {
        private readonly RoadDbContext _db;

        public ProjectAccessService(RoadDbContext db) => _db = db;

        public static int? UserIdOf(ClaimsPrincipal principal)
        {
            var raw = principal?.FindFirstValue(ClaimTypes.NameIdentifier);
            return int.TryParse(raw, out var id) ? id : null;
        }

        public static bool IsSystemAdmin(ClaimsPrincipal principal) =>
            principal?.IsInRole("SystemAdmin") == true;

        public sealed record Access(
            Project Project, ProjectRole Role, bool ViaSystemAdmin, bool IsFieldEngineer = false)
        {
            public bool Can(ProjectRole required) => ViaSystemAdmin || Role >= required;
        }

        /// <summary>
        /// Resolves a project by numeric id or code and returns the caller's role in it.
        /// Null means "does not exist, or you may not see it" — deliberately the same
        /// answer, so the endpoint cannot be used to probe which project ids exist.
        /// </summary>
        public async Task<Access?> ResolveAsync(ClaimsPrincipal principal, string idOrCode)
        {
            var userId = UserIdOf(principal);
            if (userId is null) return null;

            var query = _db.Projects.AsQueryable();
            var project = int.TryParse(idOrCode, out var numericId)
                ? await query.FirstOrDefaultAsync(p => p.Id == numericId)
                : await query.FirstOrDefaultAsync(p => p.Code == idOrCode);

            if (project is null) return null;

            // A superuser is treated as an Owner everywhere, and as a field engineer too —
            // the point of the flag is that one account can do every job on the project.
            if (IsSystemAdmin(principal))
                return new Access(project, ProjectRole.Owner, true, IsFieldEngineer: true);

            var membership = await _db.ProjectMembers
                .AsNoTracking()
                .FirstOrDefaultAsync(m => m.ProjectId == project.Id && m.UserId == userId);

            return membership is null
                ? null
                : new Access(project, membership.Role, false, membership.IsFieldEngineer);
        }

        /// <summary>Projects the caller may see. A system admin sees all of them.</summary>
        public IQueryable<Project> VisibleProjects(ClaimsPrincipal principal)
        {
            if (IsSystemAdmin(principal)) return _db.Projects;

            var userId = UserIdOf(principal);
            if (userId is null) return _db.Projects.Where(_ => false);

            return _db.Projects.Where(p => _db.ProjectMembers
                .Any(m => m.ProjectId == p.Id && m.UserId == userId));
        }

        /// <summary>
        /// Resolves the project that owns an IFC model, so model-scoped routes are subject
        /// to exactly the same membership check as project-scoped ones.
        /// </summary>
        public async Task<(Access access, IfcModel model)?> ResolveModelAsync(
            ClaimsPrincipal principal, long ifcModelId)
        {
            var model = await _db.IfcModels.FirstOrDefaultAsync(m => m.Id == ifcModelId);
            if (model is null) return null;

            var access = await ResolveAsync(principal, model.ProjectId.ToString());
            return access is null ? null : (access, model);
        }

        /// <summary>
        /// A package plus the caller's role in its project.
        ///
        /// Authorization stays at project level — membership is granted to a project, not a
        /// contract — but every data route resolves through the package, so the row filter
        /// and the permission check can never be applied to different scopes.
        /// </summary>
        public sealed record PackageAccess(
            Package Package, Project Project, ProjectRole Role,
            bool IsFieldEngineer, bool IsSuperuser)
        {
            // A superuser reaches everything. The bypass exists so a single account can walk
            // the whole raise → inspect → approve flow on a project it owns outright.
            public bool Can(ProjectRole required) => IsSuperuser || Role >= required;

            /// <summary>The caller, in the terms the RFI duty rules are written in.</summary>
            public RfiService.Actor ActorFor(int? userId) =>
                new(userId, Role, IsFieldEngineer, IsSuperuser);
        }

        /// <summary>
        /// Resolves a package by numeric id, or by <c>project-code/package-code</c>.
        ///
        /// Null means "does not exist, or you may not see it" — the same deliberate
        /// conflation <see cref="ResolveAsync"/> makes, for the same reason.
        /// </summary>
        public async Task<PackageAccess?> ResolvePackageAsync(
            ClaimsPrincipal principal, string idOrPath)
        {
            if (string.IsNullOrWhiteSpace(idOrPath)) return null;

            Package? package;
            if (int.TryParse(idOrPath, out var numericId))
            {
                package = await _db.Packages.FirstOrDefaultAsync(p => p.Id == numericId);
            }
            else
            {
                var parts = idOrPath.Split('/', 2);
                if (parts.Length != 2) return null;

                package = await _db.Packages
                    .FirstOrDefaultAsync(p => p.Code == parts[1]
                                           && p.Project!.Code == parts[0]);
            }

            if (package is null) return null;

            var access = await ResolveAsync(principal, package.ProjectId.ToString());
            return access is null
                ? null
                : new PackageAccess(
                    package, access.Project, access.Role,
                    access.IsFieldEngineer, access.ViaSystemAdmin);
        }

        /// <summary>Packages the caller may see, across every project they belong to.</summary>
        public IQueryable<Package> VisiblePackages(ClaimsPrincipal principal)
        {
            if (IsSystemAdmin(principal)) return _db.Packages;

            var userId = UserIdOf(principal);
            if (userId is null) return _db.Packages.Where(_ => false);

            return _db.Packages.Where(p => _db.ProjectMembers
                .Any(m => m.ProjectId == p.ProjectId && m.UserId == userId));
        }
    }
}
