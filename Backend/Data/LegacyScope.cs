using System.Linq;
using RoadBimBackend.Models;

namespace RoadBimBackend.Data
{
    /// <summary>
    /// The endpoints that predate project scoping — RoadProgress, Analytics, SiteHotspots,
    /// the old Excel upload and the AI assistant — query the tables directly with no notion
    /// of a project.
    ///
    /// Rather than leave them able to read across every tenant, they are pinned to the
    /// seeded demo project. They keep working exactly as before while the new
    /// project-scoped API carries real data, and they cannot reach anyone else's rows.
    ///
    /// New code should use ProjectAccessService instead of anything here.
    ///
    /// The demo project may not exist (it was deleted from this deployment). Then the ids
    /// are -1: every legacy query matches nothing, and nothing recreates the project.
    /// </summary>
    public static class LegacyScope
    {
        private static int? _cachedId;
        private static int? _cachedPackageId;

        public static int DefaultProjectId(RoadDbContext context)
        {
            if (_cachedId is not null) return _cachedId.Value;

            var id = context.Projects
                .Where(p => p.Code == DatabaseSeeder.DefaultProjectCode)
                .Select(p => (int?)p.Id)
                .FirstOrDefault();

            if (id is null) return -1; // not cached: a restored demo project is picked up
            _cachedId = id;
            return _cachedId.Value;
        }

        /// <summary>
        /// The package legacy writes land in. Reads do not need it — they filter on
        /// ProjectId, which every row still carries — but an insert does, because
        /// PackageId is required and foreign-keyed.
        /// </summary>
        public static int DefaultPackageId(RoadDbContext context)
        {
            if (_cachedPackageId is not null) return _cachedPackageId.Value;

            var projectId = DefaultProjectId(context);
            if (projectId < 0) return -1;
            var id = context.Packages
                .Where(k => k.ProjectId == projectId)
                .OrderBy(k => k.SortOrder).ThenBy(k => k.Id)
                .Select(k => (int?)k.Id)
                .FirstOrDefault();

            if (id is null) return -1;
            _cachedPackageId = id;
            return _cachedPackageId.Value;
        }

        public static IQueryable<RoadChainage> LegacyChainages(this RoadDbContext c) =>
            c.RoadChainages.Where(x => x.ProjectId == DefaultProjectId(c));

        public static IQueryable<RoadLayer> LegacyLayers(this RoadDbContext c) =>
            c.RoadLayers.Where(x => x.ProjectId == DefaultProjectId(c));

        public static IQueryable<LayerProgress> LegacyProgress(this RoadDbContext c) =>
            c.LayerProgresses.Where(x => x.ProjectId == DefaultProjectId(c) && x.SupersededAt == null);

        public static IQueryable<SiteHotspot> LegacyHotspots(this RoadDbContext c) =>
            c.SiteHotspots.Where(x => x.ProjectId == DefaultProjectId(c));

        public static IQueryable<Models.ProjectMetrics> LegacyMetrics(this RoadDbContext c) =>
            c.ProjectMetrics.Where(x => x.ProjectId == DefaultProjectId(c));
    }
}
