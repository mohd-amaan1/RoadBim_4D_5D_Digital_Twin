using System;
using System.Collections.Generic;
using System.Linq;

namespace RoadBimBackend.Data
{
    public static class DatabaseSeeder
    {
        /// <summary>Code of the project the pre-existing demo corridor belongs to.</summary>
        public const string DefaultProjectCode = "default";

        /// <summary>Code of the package every pre-package row was backfilled into.</summary>
        public const string DefaultPackageCode = "main";

        /// <summary>
        /// Every project has at least one package, because every road row needs one. A
        /// project created before packages existed — or through the API, which does not ask
        /// for one — gets this so its data has somewhere to live.
        /// </summary>
        public static Models.Package EnsureDefaultPackage(RoadDbContext context, Models.Project project)
        {
            var existing = context.Packages
                .FirstOrDefault(p => p.ProjectId == project.Id && p.Code == DefaultPackageCode);
            if (existing is not null) return existing;

            // A project may already carry packages under other codes; the first one is then
            // the right home for anything unassigned, and creating "main" beside it would be
            // an empty duplicate.
            var anyExisting = context.Packages
                .Where(p => p.ProjectId == project.Id)
                .OrderBy(p => p.SortOrder).ThenBy(p => p.Id)
                .FirstOrDefault();
            if (anyExisting is not null) return anyExisting;

            var package = new Models.Package
            {
                ProjectId = project.Id,
                Code = DefaultPackageCode,
                Name = "Main package",
                Description = "Created automatically so the project's road data has a package to belong to.",
                ContractorName = string.Empty,
                Status = Models.PackageStatus.Active,
                SortOrder = 0,
            };
            context.Packages.Add(package);
            context.SaveChanges();
            return package;
        }

        /// <summary>
        /// Fills the demo corridor's data if the demo project exists. It is never created:
        /// the demo project was deleted on purpose (this deployment carries the Palashbari
        /// project only), and recreating it on every start would undo that.
        /// </summary>
        public static void SeedData(RoadDbContext context)
        {
            var defaultProject = context.Projects.FirstOrDefault(p => p.Code == DefaultProjectCode);
            if (defaultProject is null) return;
            var defaultPackage = EnsureDefaultPackage(context, defaultProject);

            if (context.RoadChainages.Any(c => c.PackageId == defaultPackage.Id)) 
            {
                // Ensure ProjectMetrics has at least 1 record if missing
                if (!context.ProjectMetrics.Any(m => m.PackageId == defaultPackage.Id))
                {
                    context.ProjectMetrics.Add(new Models.ProjectMetrics
                    {
                        ProjectId = defaultProject.Id, PackageId = defaultPackage.Id,
                        IsSourceSnapshot = false,
                        TotalKmTarget = 100.0,
                        TotalKmCompleted = 42.0,
                        OverallProgressPercent = 60.4,
                        SchedulePerformanceIndex = 0.96,
                        CostPerformanceIndex = 1.04,
                        TotalBudgetCost = 44200000.00m,
                        TotalActualCost = 40800000.00m,
                        DelayedSectionsCount = 8,
                        CalculatedAt = DateTime.UtcNow
                    });
                    context.SaveChanges();
                }
                return;
            }

            // 1. Seed Road Layers
            var layers = new List<Models.RoadLayer>
            {
                new() { ProjectId = defaultProject.Id, PackageId = defaultPackage.Id, LayerName = "Subgrade Earthwork", Code = "SUB", ThicknessMm = 500, MaterialType = "Compacted Soil / Borrow Material", DefaultColorHex = "#8B5A2B", SortOrder = 1 },
                new() { ProjectId = defaultProject.Id, PackageId = defaultPackage.Id, LayerName = "Granular Sub-Base (GSB)", Code = "GSB", ThicknessMm = 200, MaterialType = "Crushed Stone Aggregate", DefaultColorHex = "#94A3B8", SortOrder = 2 },
                new() { ProjectId = defaultProject.Id, PackageId = defaultPackage.Id, LayerName = "Wet Mix Macadam (WMM)", Code = "WMM", ThicknessMm = 250, MaterialType = "Graded Aggregate & Soil Binder", DefaultColorHex = "#64748B", SortOrder = 3 },
                new() { ProjectId = defaultProject.Id, PackageId = defaultPackage.Id, LayerName = "Dense Bituminous Macadam (DBM)", Code = "DBM", ThicknessMm = 100, MaterialType = "Dense Asphalt Concrete Mixture", DefaultColorHex = "#334155", SortOrder = 4 },
                new() { ProjectId = defaultProject.Id, PackageId = defaultPackage.Id, LayerName = "Bituminous Concrete (BC Surface)", Code = "BC", ThicknessMm = 50, MaterialType = "Wearing Course Asphalt", DefaultColorHex = "#0F172A", SortOrder = 5 }
            };
            context.RoadLayers.AddRange(layers);
            context.SaveChanges();

            // 2. Seed 100 KM Chainages (KM 0 to KM 100)
            var chainages = new List<Models.RoadChainage>();

            double startLat = 28.6139; // Delhi - NCR sample GIS start
            double startLng = 77.2090;

            for (int i = 0; i < 100; i++)
            {
                chainages.Add(new Models.RoadChainage
                {
                    ProjectId = defaultProject.Id, PackageId = defaultPackage.Id,
                    ChainageStart = i,
                    ChainageEnd = i + 1,
                    KmLabel = $"KM {i:000} - KM {i + 1:000}",
                    SectionName = $"Highway Corridor Segment {i + 1}",
                    Latitude = startLat + (i * 0.009),
                    Longitude = startLng + (i * 0.007),
                    Elevation = 120.0 + Math.Sin(i * 0.1) * 15.0,
                    TerrainType = i % 3 == 0 ? "Cut & Fill" : (i % 3 == 1 ? "Embankment" : "Flat Plain")
                });
            }
            context.RoadChainages.AddRange(chainages);
            context.SaveChanges();

            // 3. Seed Layer Progress for every KM and every Layer
            var progressList = new List<Models.LayerProgress>();
            // PostgreSQL 'timestamp with time zone' requires DateTimeKind.Utc via Npgsql
            var startDate = new DateTime(2025, 1, 1, 0, 0, 0, DateTimeKind.Utc);

            foreach (var ch in chainages)
            {
                foreach (var layer in layers)
                {
                    string status;
                    double progress;

                    // Simulated realistic linear construction progress
                    if (ch.ChainageStart < 40)
                    {
                        status = "Completed";
                        progress = 100.0;
                    }
                    else if (ch.ChainageStart < 70)
                    {
                        if (layer.SortOrder <= 2) { status = "Completed"; progress = 100.0; }
                        else if (layer.SortOrder == 3) { status = "In-Progress"; progress = 75.0; }
                        else if (layer.SortOrder == 4 && ch.ChainageStart % 4 == 0) { status = "Delayed"; progress = 20.0; }
                        else { status = "Not Started"; progress = 0.0; }
                    }
                    else if (ch.ChainageStart < 85)
                    {
                        if (layer.SortOrder == 1) { status = "Completed"; progress = 100.0; }
                        else if (layer.SortOrder == 2) { status = "In-Progress"; progress = 50.0; }
                        else { status = "Not Started"; progress = 0.0; }
                    }
                    else
                    {
                        if (layer.SortOrder == 1) { status = "In-Progress"; progress = 30.0; }
                        else { status = "Not Started"; progress = 0.0; }
                    }

                    progressList.Add(new Models.LayerProgress
                    {
                        ProjectId = defaultProject.Id, PackageId = defaultPackage.Id,
                        ChainageId = ch.Id,
                        LayerId = layer.Id,
                        Status = status,
                        ProgressPercent = progress,
                        PlannedStartDate = startDate.AddDays(ch.ChainageStart * 2 + layer.SortOrder * 10),
                        PlannedEndDate = startDate.AddDays(ch.ChainageStart * 2 + layer.SortOrder * 10 + 15),
                        ActualStartDate = status != "Not Started" ? startDate.AddDays(ch.ChainageStart * 2 + layer.SortOrder * 10) : null,
                        ActualEndDate = status == "Completed" ? startDate.AddDays(ch.ChainageStart * 2 + layer.SortOrder * 10 + 14) : null,
                        BudgetCost = (decimal)(layer.ThicknessMm * 150),
                        ActualCost = status == "Delayed" ? (decimal)(layer.ThicknessMm * 190) : (decimal)(layer.ThicknessMm * 145),
                        CostVariance = status == "Delayed" ? (decimal)(layer.ThicknessMm * 40) : (decimal)(-layer.ThicknessMm * 5),
                        DelayDays = status == "Delayed" ? 14 : 0,
                        UpdatedAt = DateTime.UtcNow
                    });
                }
            }

            context.LayerProgresses.AddRange(progressList);

            // 4. Seed Geo-Tagged Site Hotspots
            context.SiteHotspots.AddRange(new List<Models.SiteHotspot>
            {
                new() { ProjectId = defaultProject.Id, PackageId = defaultPackage.Id, ChainageId = 15, Title = "KM 014+500 Subgrade Compaction Test", Category = "Photo360", Description = "Density test passed with 98% compaction factor. Nuclear gauge verified.", ImageUrl = "/samples/site_subgrade.jpg", InspectorName = "Er. Sharma", Status = "Approved" },
                new() { ProjectId = defaultProject.Id, PackageId = defaultPackage.Id, ChainageId = 42, Title = "KM 042+200 DBM Asphalt Laying Delay", Category = "QualityIssue", Description = "Paver break down caused 4-hour bitumen temperature drop. Re-compaction mandated.", ImageUrl = "/samples/site_asphalt.jpg", InspectorName = "Er. Verma", Status = "Action Required" },
                new() { ProjectId = defaultProject.Id, PackageId = defaultPackage.Id, ChainageId = 68, Title = "KM 068+000 Drone Aerial Corridor Survey", Category = "DroneInspection", Description = "High-resolution orthomosaic scan verifying GSB embankment slopes.", ImageUrl = "/samples/site_drone.jpg", InspectorName = "Drone Operator Raj", Status = "Verified" }
            });

            // 5. Seed ProjectMetrics Executive Cache
            context.ProjectMetrics.Add(new Models.ProjectMetrics
            {
                ProjectId = defaultProject.Id, PackageId = defaultPackage.Id,
                IsSourceSnapshot = false,
                TotalKmTarget = 100.0,
                TotalKmCompleted = 42.0,
                OverallProgressPercent = 60.4,
                SchedulePerformanceIndex = 0.96,
                CostPerformanceIndex = 1.04,
                TotalBudgetCost = 44200000.00m,
                TotalActualCost = 40800000.00m,
                DelayedSectionsCount = 8,
                CalculatedAt = DateTime.UtcNow
            });

            context.SaveChanges();
        }
    }
}
