using Microsoft.EntityFrameworkCore;
using RoadBimBackend.Controllers;
using RoadBimBackend.Models;

namespace RoadBimBackend.Data
{
    public class RoadDbContext : DbContext
    {
        public RoadDbContext(DbContextOptions<RoadDbContext> options) : base(options) { }

        // --- existing ---
        public DbSet<RoadChainage> RoadChainages => Set<RoadChainage>();
        public DbSet<RoadLayer> RoadLayers => Set<RoadLayer>();
        public DbSet<LayerProgress> LayerProgresses => Set<LayerProgress>();
        public DbSet<SiteHotspot> SiteHotspots => Set<SiteHotspot>();
        public DbSet<ProjectMetrics> ProjectMetrics => Set<ProjectMetrics>();

        // --- identity & tenancy ---
        public DbSet<User> Users => Set<User>();
        public DbSet<Project> Projects => Set<Project>();
        public DbSet<Package> Packages => Set<Package>();
        public DbSet<ProjectMember> ProjectMembers => Set<ProjectMember>();

        // --- IFC model facts ---
        public DbSet<IfcModel> IfcModels => Set<IfcModel>();
        public DbSet<IfcElement> IfcElements => Set<IfcElement>();
        public DbSet<IfcGroup> IfcGroups => Set<IfcGroup>();
        public DbSet<IfcGroupMember> IfcGroupMembers => Set<IfcGroupMember>();
        public DbSet<IfcSegment> IfcSegments => Set<IfcSegment>();
        public DbSet<IfcModelLayer> IfcModelLayers => Set<IfcModelLayer>();

        // --- requests for inspection ---
        public DbSet<Rfi> Rfis => Set<Rfi>();
        public DbSet<RfiEvent> RfiEvents => Set<RfiEvent>();
        public DbSet<RfiInspection> RfiInspections => Set<RfiInspection>();
        public DbSet<RfiAttachment> RfiAttachments => Set<RfiAttachment>();
        public DbSet<NumberSeries> NumberSeries => Set<NumberSeries>();

        // --- imports & bindings ---
        public DbSet<ImportBatch> ImportBatches => Set<ImportBatch>();
        public DbSet<ImportBatchFile> ImportBatchFiles => Set<ImportBatchFile>();
        public DbSet<ImportIssue> ImportIssues => Set<ImportIssue>();
        public DbSet<ProgressIfcBinding> ProgressIfcBindings => Set<ProgressIfcBinding>();

        // --- bridge registers ---
        public DbSet<BridgeItem> BridgeItems => Set<BridgeItem>();
        public DbSet<BridgeTrackerFile> BridgeTrackerFiles => Set<BridgeTrackerFile>();
        public DbSet<BridgeTrackerConfig> BridgeTrackerConfigs => Set<BridgeTrackerConfig>();

        protected override void OnModelCreating(ModelBuilder modelBuilder)
        {
            base.OnModelCreating(modelBuilder);

            // Table names kept as they already exist on the live database
            modelBuilder.Entity<LayerProgress>().ToTable("LayerProgress");
            modelBuilder.Entity<RoadChainage>().ToTable("RoadChainages");
            modelBuilder.Entity<RoadLayer>().ToTable("RoadLayers");
            modelBuilder.Entity<SiteHotspot>().ToTable("SiteHotspots");
            modelBuilder.Entity<ProjectMetrics>().ToTable("ProjectMetrics");

            ConfigureIdentity(modelBuilder);
            ConfigurePackages(modelBuilder);
            ConfigureRfi(modelBuilder);
            ConfigureProjectScoping(modelBuilder);
            ConfigureIfcModel(modelBuilder);
            ConfigureImports(modelBuilder);
            ConfigureBridges(modelBuilder);
            ConfigureBridgeTracker(modelBuilder);

            // Keyless result shape for sp_get_chainage_layer_details().
            // ToView(null) keeps it unmapped so no table is generated for it.
            modelBuilder.Entity<ChainageLayerSpDto>().HasNoKey().ToView(null);
        }

        // ------------------------------------------------------------------ //

        private static void ConfigureIdentity(ModelBuilder b)
        {
            b.Entity<User>(e =>
            {
                e.ToTable("Users");
                e.HasIndex(u => u.Email).IsUnique();
                e.Property(u => u.Email).IsRequired();
                e.Property(u => u.PasswordHash).IsRequired();
            });

            b.Entity<ProjectMember>(e =>
            {
                e.ToTable("ProjectMembers");
                // One membership row per (project, user) — the authorization lookup key
                e.HasIndex(m => new { m.ProjectId, m.UserId }).IsUnique();
                e.HasIndex(m => m.UserId);

                e.HasOne(m => m.Project).WithMany(p => p.Members)
                    .HasForeignKey(m => m.ProjectId).OnDelete(DeleteBehavior.Cascade);
                e.HasOne(m => m.User).WithMany(u => u.Memberships)
                    .HasForeignKey(m => m.UserId).OnDelete(DeleteBehavior.Cascade);

                // Stored as text so the value stays readable in psql
                e.Property(m => m.Role).HasConversion<string>().HasMaxLength(32);
            });
        }

        /// <summary>
        /// The package layer. Every road table below carries both <c>ProjectId</c> and
        /// <c>PackageId</c>: the package is the tenancy unit that uniqueness is scoped to,
        /// while the project id stays denormalised so the project-wide map reads every
        /// package in one indexed pass instead of joining through packages.
        /// </summary>
        private static void ConfigurePackages(ModelBuilder b)
        {
            b.Entity<Package>(e =>
            {
                e.ToTable("Packages");
                e.HasOne(p => p.Project).WithMany(p => p.Packages)
                    .HasForeignKey(p => p.ProjectId).OnDelete(DeleteBehavior.Cascade);

                // Scoped to the project, NOT platform-wide: 'CW1-1' is a contract code that
                // repeats across unrelated projects.
                e.HasIndex(p => new { p.ProjectId, p.Code }).IsUnique();
                e.HasIndex(p => new { p.ProjectId, p.SortOrder });

                e.Property(p => p.Code).IsRequired().HasMaxLength(64);
                e.Property(p => p.Name).IsRequired().HasMaxLength(300);
                e.Property(p => p.ContractorName).HasMaxLength(300);
                e.Property(p => p.ContractNo).HasMaxLength(120);

                e.Property(p => p.Module).HasMaxLength(64);

                e.ToTable(t =>
                {
                    t.HasCheckConstraint(
                        "CK_Packages_Status",
                        "\"Status\" IN ('planned','active','suspended','completed')");
                    t.HasCheckConstraint(
                        "CK_Packages_Module",
                        "\"Module\" IS NULL OR \"Module\" IN ('palashbari-tracker')");
                });
            });
        }

        /// <summary>
        /// Requests for inspection.
        ///
        /// The chainage columns are real foreign keys rather than loose metres. Chainages
        /// are fixed by the model and the workbook, so an RFI can only ever name partitions
        /// that exist — which is also what lets the map colour itself without a second
        /// matching strategy, since the chainage is already the resolver's own key.
        /// </summary>
        private static void ConfigureRfi(ModelBuilder b)
        {
            b.Entity<Rfi>(e =>
            {
                e.ToTable("Rfis");

                e.HasOne(x => x.Project).WithMany()
                    .HasForeignKey(x => x.ProjectId).OnDelete(DeleteBehavior.Cascade);
                e.HasOne(x => x.Package).WithMany()
                    .HasForeignKey(x => x.PackageId).OnDelete(DeleteBehavior.Cascade);

                // Restrict, not cascade: re-importing a workbook must never silently delete
                // inspection requests because a chainage row was replaced.
                e.HasOne(x => x.ChainageFrom).WithMany()
                    .HasForeignKey(x => x.ChainageFromId).OnDelete(DeleteBehavior.Restrict);
                e.HasOne(x => x.ChainageTo).WithMany()
                    .HasForeignKey(x => x.ChainageToId).OnDelete(DeleteBehavior.Restrict);
                e.HasOne(x => x.Layer).WithMany()
                    .HasForeignKey(x => x.LayerId).OnDelete(DeleteBehavior.SetNull);

                e.HasOne(x => x.RaisedByUser).WithMany()
                    .HasForeignKey(x => x.RaisedByUserId).OnDelete(DeleteBehavior.SetNull);
                e.HasOne(x => x.AssignedToUser).WithMany()
                    .HasForeignKey(x => x.AssignedToUserId).OnDelete(DeleteBehavior.SetNull);
                e.HasOne(x => x.InspectedByUser).WithMany()
                    .HasForeignKey(x => x.InspectedByUserId).OnDelete(DeleteBehavior.SetNull);
                e.HasOne(x => x.ApprovedByUser).WithMany()
                    .HasForeignKey(x => x.ApprovedByUserId).OnDelete(DeleteBehavior.SetNull);

                // The number is unique within its package, which is the scope its series
                // counts in — two packages both reach /01.
                e.HasIndex(x => new { x.PackageId, x.RfiNo }).IsUnique();
                e.HasIndex(x => new { x.PackageId, x.Status });
                e.HasIndex(x => new { x.ProjectId, x.Status });
                // The register's overlap filter and phase 3's projection both read this way.
                e.HasIndex(x => new { x.PackageId, x.ChainageFromM, x.ChainageToM });
                e.HasIndex(x => x.AssignedToUserId).HasFilter("\"CancelledAt\" IS NULL");

                e.Property(x => x.RfiNo).IsRequired().HasMaxLength(64);
                e.Property(x => x.Title).IsRequired().HasMaxLength(300);
                e.Property(x => x.ComponentRef).HasMaxLength(200);
                e.Property(x => x.SubComponentRef).HasMaxLength(200);
                e.Property(x => x.LocationText).HasMaxLength(500);

                e.ToTable(t =>
                {
                    t.HasCheckConstraint("CK_Rfis_Status",
                        "\"Status\" IN ('draft','submitted','inspected','approved','rejected','cancelled')");
                    t.HasCheckConstraint("CK_Rfis_Outcome",
                        "\"Outcome\" IS NULL OR \"Outcome\" IN ('pass','fail')");
                    t.HasCheckConstraint("CK_Rfis_Side",
                        "\"Side\" IN ('LHS','RHS','both','na')");
                    // A range that runs backwards is a data-entry slip, not a valid RFI.
                    t.HasCheckConstraint("CK_Rfis_ChainageOrder",
                        "\"ChainageToM\" >= \"ChainageFromM\"");
                });
            });

            b.Entity<RfiEvent>(e =>
            {
                e.ToTable("RfiEvents");
                e.HasOne(x => x.Rfi).WithMany(r => r.Events)
                    .HasForeignKey(x => x.RfiId).OnDelete(DeleteBehavior.Cascade);
                e.HasOne(x => x.ActorUser).WithMany()
                    .HasForeignKey(x => x.ActorUserId).OnDelete(DeleteBehavior.SetNull);
                e.HasIndex(x => new { x.RfiId, x.OccurredAt });
                e.Property(x => x.EventType).IsRequired().HasMaxLength(40);
            });

            b.Entity<RfiInspection>(e =>
            {
                e.ToTable("RfiInspections");
                e.HasOne(x => x.Rfi).WithMany()
                    .HasForeignKey(x => x.RfiId).OnDelete(DeleteBehavior.Cascade);
                e.HasOne(x => x.InspectedByUser).WithMany()
                    .HasForeignKey(x => x.InspectedByUserId).OnDelete(DeleteBehavior.Restrict);

                // Visit 2 exists because visit 1 failed. The pair is the re-inspection
                // history, so it must be unique and must never be overwritten.
                e.HasIndex(x => new { x.RfiId, x.VisitNo }).IsUnique();
                e.HasIndex(x => new { x.InspectedByUserId, x.InspectedAt });

                e.ToTable(t =>
                {
                    t.HasCheckConstraint("CK_RfiInspections_Outcome",
                        "\"Outcome\" IN ('pass','fail')");
                    t.HasCheckConstraint("CK_RfiInspections_Source",
                        "\"Source\" IN ('web','mobile')");
                });
            });

            b.Entity<RfiAttachment>(e =>
            {
                e.ToTable("RfiAttachments");
                e.HasOne(x => x.Rfi).WithMany()
                    .HasForeignKey(x => x.RfiId).OnDelete(DeleteBehavior.Cascade);
                e.HasOne(x => x.RfiInspection).WithMany(i => i.Attachments)
                    .HasForeignKey(x => x.RfiInspectionId).OnDelete(DeleteBehavior.Cascade);
                e.HasOne(x => x.UploadedByUser).WithMany()
                    .HasForeignKey(x => x.UploadedByUserId).OnDelete(DeleteBehavior.SetNull);

                e.HasIndex(x => x.RfiId);
                e.HasIndex(x => x.RfiInspectionId);
                e.Property(x => x.FileName).IsRequired().HasMaxLength(300);
                e.Property(x => x.ContentType).HasMaxLength(120);
            });

            b.Entity<NumberSeries>(e =>
            {
                e.ToTable("NumberSeries");
                e.HasOne(x => x.Package).WithMany()
                    .HasForeignKey(x => x.PackageId).OnDelete(DeleteBehavior.Cascade);
                e.HasOne(x => x.Project).WithMany()
                    .HasForeignKey(x => x.ProjectId).OnDelete(DeleteBehavior.Cascade);

                // One active series per (type, package) — two would hand out two sequences.
                e.HasIndex(x => new { x.EntityType, x.PackageId })
                    .IsUnique()
                    .HasFilter("\"PackageId\" IS NOT NULL AND \"IsActive\"");

                e.Property(x => x.EntityType).IsRequired().HasMaxLength(32);
                e.Property(x => x.Prefix).IsRequired().HasMaxLength(16);
                e.Property(x => x.Pattern).IsRequired().HasMaxLength(120);

                e.ToTable(t => t.HasCheckConstraint("CK_NumberSeries_ResetCycle",
                    "\"ResetCycle\" IN ('never','daily','monthly','yearly')"));
            });
        }

        private static void ConfigureProjectScoping(ModelBuilder b)
        {
            b.Entity<Project>(e =>
            {
                e.ToTable("Projects");
                e.HasIndex(p => p.Code).IsUnique();
                e.Property(p => p.Code).IsRequired();
                e.Property(p => p.Name).IsRequired();
                e.Property(p => p.Metadata).HasColumnType("jsonb").HasDefaultValue("{}");
                e.ToTable(t => t.HasCheckConstraint(
                    "CK_Projects_ChainageDirection",
                    "\"ChainageDirection\" IN ('auto','ascending','descending')"));
            });

            b.Entity<RoadChainage>(e =>
            {
                e.HasOne(c => c.Project).WithMany()
                    .HasForeignKey(c => c.ProjectId).OnDelete(DeleteBehavior.Cascade);
                e.HasOne(c => c.Package).WithMany()
                    .HasForeignKey(c => c.PackageId).OnDelete(DeleteBehavior.Cascade);
                // Import idempotency key: the workbook's own Id, scoped to the PACKAGE.
                // Two packages each import a Road_chainage sheet numbered 1..n; scoping this
                // to the project would make the second import collide with the first.
                e.HasIndex(c => new { c.PackageId, c.SourceChainageId })
                    .IsUnique()
                    .HasFilter("\"SourceChainageId\" IS NOT NULL");
                e.HasIndex(c => c.ProjectId);
                e.HasIndex(c => c.PackageId);
            });

            b.Entity<RoadLayer>(e =>
            {
                e.HasOne(l => l.Project).WithMany()
                    .HasForeignKey(l => l.ProjectId).OnDelete(DeleteBehavior.Cascade);
                e.HasOne(l => l.Package).WithMany()
                    .HasForeignKey(l => l.PackageId).OnDelete(DeleteBehavior.Cascade);
                // Scoped to the package, NOT the project and certainly not global: "BC" is
                // the base course under one contract and the bituminous wearing course under
                // another, and the same project can let both.
                e.HasIndex(l => new { l.PackageId, l.Code }).IsUnique();
                e.HasIndex(l => l.ProjectId);
            });

            b.Entity<LayerProgress>(e =>
            {
                e.HasOne(p => p.Project).WithMany()
                    .HasForeignKey(p => p.ProjectId).OnDelete(DeleteBehavior.Cascade);
                e.HasOne(p => p.Package).WithMany()
                    .HasForeignKey(p => p.PackageId).OnDelete(DeleteBehavior.Cascade);
                e.HasOne(p => p.Chainage).WithMany(c => c.LayerProgresses)
                    .HasForeignKey(p => p.ChainageId).OnDelete(DeleteBehavior.Cascade);
                e.HasOne(p => p.Layer).WithMany()
                    .HasForeignKey(p => p.LayerId).OnDelete(DeleteBehavior.Cascade);

                // The central idempotency key — Phase 1's (ChainageId, LayerCode) natural
                // key expressed against the resolved foreign keys.
                e.HasIndex(p => new { p.ProjectId, p.ChainageId, p.LayerId }).IsUnique();
                e.HasIndex(p => new { p.ProjectId, p.SupersededAt });
                e.HasIndex(p => new { p.PackageId, p.SupersededAt });
                e.Property(p => p.Source).HasMaxLength(16);
                e.ToTable(t => t.HasCheckConstraint("CK_LayerProgress_Source",
                    "\"Source\" IN ('none','rfi')"));
            });

            b.Entity<SiteHotspot>(e =>
            {
                e.HasOne(h => h.Project).WithMany()
                    .HasForeignKey(h => h.ProjectId).OnDelete(DeleteBehavior.Cascade);
                e.HasOne(h => h.Package).WithMany()
                    .HasForeignKey(h => h.PackageId).OnDelete(DeleteBehavior.Cascade);
                e.HasOne(h => h.Chainage).WithMany(c => c.SiteHotspots)
                    .HasForeignKey(h => h.ChainageId).OnDelete(DeleteBehavior.Cascade);
                e.HasIndex(h => h.ProjectId);
                e.HasIndex(h => h.PackageId);
            });

            b.Entity<ProjectMetrics>(e =>
            {
                e.HasOne(m => m.Project).WithMany()
                    .HasForeignKey(m => m.ProjectId).OnDelete(DeleteBehavior.Cascade);
                e.HasOne(m => m.Package).WithMany()
                    .HasForeignKey(m => m.PackageId).OnDelete(DeleteBehavior.Cascade);
                // Cost figures are stated per package — one contract, one budget — so the
                // batch that produced them is unique within the package, not the project.
                e.HasIndex(m => new { m.PackageId, m.ImportBatchId })
                    .IsUnique()
                    .HasFilter("\"ImportBatchId\" IS NOT NULL");
                e.HasIndex(m => m.ProjectId);
            });
        }

        private static void ConfigureIfcModel(ModelBuilder b)
        {
            b.Entity<IfcModel>(e =>
            {
                e.ToTable("IfcModels");
                e.HasOne(m => m.Project).WithMany(p => p.IfcModels)
                    .HasForeignKey(m => m.ProjectId).OnDelete(DeleteBehavior.Cascade);
                e.HasOne(m => m.Package).WithMany(p => p.IfcModels)
                    .HasForeignKey(m => m.PackageId).OnDelete(DeleteBehavior.Cascade);

                e.HasIndex(m => new { m.PackageId, m.Version }).IsUnique();
                // Same bytes uploaded twice is the same model, not a new version — but two
                // packages may legitimately share a corridor file, so this is package-scoped.
                e.HasIndex(m => new { m.PackageId, m.ContentSha256 }).IsUnique();
                // At most one active model per PACKAGE. A project now carries several active
                // models at once — one per package — which is what puts them all on one map.
                e.HasIndex(m => m.PackageId)
                    .IsUnique()
                    .HasFilter("\"IsActive\"")
                    .HasDatabaseName("UX_IfcModels_ActivePerPackage");
                e.HasIndex(m => m.ProjectId);
            });

            b.Entity<IfcElement>(e =>
            {
                e.ToTable("IfcElements");
                e.HasOne(x => x.IfcModel).WithMany(m => m.Elements)
                    .HasForeignKey(x => x.IfcModelId).OnDelete(DeleteBehavior.Cascade);

                // The binding lookup key, and the target of the bindings' composite FK
                e.HasIndex(x => new { x.IfcModelId, x.GlobalId }).IsUnique();
                e.HasIndex(x => new { x.IfcModelId, x.LayerCode });
                e.HasIndex(x => new { x.IfcModelId, x.SegmentIndex });
                e.Property(x => x.GlobalId).IsRequired();
            });

            b.Entity<IfcGroup>(e =>
            {
                e.ToTable("IfcGroups");
                e.HasOne(g => g.IfcModel).WithMany(m => m.Groups)
                    .HasForeignKey(g => g.IfcModelId).OnDelete(DeleteBehavior.Cascade);
                e.HasIndex(g => new { g.IfcModelId, g.GlobalId }).IsUnique();
            });

            b.Entity<IfcGroupMember>(e =>
            {
                e.ToTable("IfcGroupMembers");
                e.HasKey(m => new { m.IfcGroupId, m.IfcElementId });
                e.HasOne(m => m.IfcGroup).WithMany(g => g.Members)
                    .HasForeignKey(m => m.IfcGroupId).OnDelete(DeleteBehavior.Cascade);
                e.HasOne(m => m.IfcElement).WithMany(x => x.GroupMemberships)
                    .HasForeignKey(m => m.IfcElementId).OnDelete(DeleteBehavior.Cascade);
            });

            b.Entity<IfcSegment>(e =>
            {
                e.ToTable("IfcSegments");
                e.HasOne(s => s.IfcModel).WithMany(m => m.Segments)
                    .HasForeignKey(s => s.IfcModelId).OnDelete(DeleteBehavior.Cascade);
                e.HasIndex(s => new { s.IfcModelId, s.SegmentIndex }).IsUnique();
            });

            b.Entity<IfcModelLayer>(e =>
            {
                e.ToTable("IfcModelLayers");
                e.HasOne(l => l.IfcModel).WithMany(m => m.ModelLayers)
                    .HasForeignKey(l => l.IfcModelId).OnDelete(DeleteBehavior.Cascade);
                e.HasIndex(l => new { l.IfcModelId, l.LayerName }).IsUnique();
                e.Property(l => l.ThicknessMm).HasColumnType("numeric(10,2)");
            });
        }

        /// <summary>
        /// Bridge registers. Package-scoped like the road tables, with ProjectId kept beside
        /// PackageId for the same reason: the project map reads every package in one pass.
        /// </summary>
        private static void ConfigureBridges(ModelBuilder b)
        {
            b.Entity<BridgeItem>(e =>
            {
                e.ToTable("BridgeItems");

                e.HasOne(x => x.Project).WithMany()
                    .HasForeignKey(x => x.ProjectId).OnDelete(DeleteBehavior.Cascade);
                e.HasOne(x => x.Package).WithMany()
                    .HasForeignKey(x => x.PackageId).OnDelete(DeleteBehavior.Cascade);

                // The import's idempotency key, scoped to the package: two bridges each have
                // a "P8 - 5th Lift", and they are not the same row.
                e.HasIndex(x => new { x.PackageId, x.SourceKey }).IsUnique();
                // The lookup the model tint makes: which rows speak for this element.
                e.HasIndex(x => new { x.PackageId, x.IfcGlobalId });
                e.HasIndex(x => new { x.PackageId, x.SupersededAt });

                e.Property(x => x.SourceKey).IsRequired().HasMaxLength(600);
                e.Property(x => x.Approval).IsRequired().HasMaxLength(16);

                e.ToTable(t => t.HasCheckConstraint("CK_BridgeItems_Approval",
                    "\"Approval\" IN ('approved','rejected','pending')"));
            });
        }

        private static void ConfigureBridgeTracker(ModelBuilder b)
        {
            b.Entity<BridgeTrackerFile>(e =>
            {
                e.ToTable("BridgeTrackerFiles");

                e.HasOne(x => x.Project).WithMany()
                    .HasForeignKey(x => x.ProjectId).OnDelete(DeleteBehavior.Cascade);
                e.HasOne(x => x.Package).WithMany()
                    .HasForeignKey(x => x.PackageId).OnDelete(DeleteBehavior.Cascade);
                e.HasOne(x => x.UploadedBy).WithMany()
                    .HasForeignKey(x => x.UploadedByUserId).OnDelete(DeleteBehavior.SetNull);

                // The same bytes uploaded again as the same kind are one file, not two.
                e.HasIndex(x => new { x.PackageId, x.Kind, x.ContentSha256 }).IsUnique();
                // "The current model", "every IPC": both are this lookup.
                e.HasIndex(x => new { x.PackageId, x.Kind, x.SupersededAt });

                e.Property(x => x.Kind).IsRequired().HasMaxLength(16);
                e.Property(x => x.OriginalFileName).IsRequired().HasMaxLength(400);
                e.Property(x => x.ContentSha256).IsRequired().HasMaxLength(64);
                e.Property(x => x.StoragePath).IsRequired().HasMaxLength(1000);
                e.Property(x => x.Bill).HasMaxLength(64);
                e.Property(x => x.Period).HasMaxLength(200);

                e.ToTable(t => t.HasCheckConstraint("CK_BridgeTrackerFiles_Kind",
                    "\"Kind\" IN ('ifc','register','ipc','alignment')"));
            });

            b.Entity<BridgeTrackerConfig>(e =>
            {
                e.ToTable("BridgeTrackerConfigs");
                e.HasKey(x => x.PackageId);

                e.HasOne(x => x.Package).WithOne()
                    .HasForeignKey<BridgeTrackerConfig>(x => x.PackageId).OnDelete(DeleteBehavior.Cascade);
                e.HasOne(x => x.ActiveIpcFile).WithMany()
                    .HasForeignKey(x => x.ActiveIpcFileId).OnDelete(DeleteBehavior.SetNull);

                e.Property(x => x.ConfigJson).HasColumnType("jsonb").HasDefaultValue("{}");
            });
        }

        private static void ConfigureImports(ModelBuilder b)
        {
            b.Entity<ImportBatch>(e =>
            {
                e.ToTable("ImportBatches");
                e.HasOne(x => x.Project).WithMany(p => p.ImportBatches)
                    .HasForeignKey(x => x.ProjectId).OnDelete(DeleteBehavior.Cascade);
                e.HasOne(x => x.Package).WithMany()
                    .HasForeignKey(x => x.PackageId).OnDelete(DeleteBehavior.Cascade);
                e.HasIndex(x => new { x.ProjectId, x.StartedAt });
                e.HasIndex(x => new { x.PackageId, x.StartedAt });
                // The file-level idempotency lookup: the same workbooks re-uploaded to the
                // same package is a no-op, but to a different package is a real import.
                e.HasIndex(x => new { x.PackageId, x.ContentSha256 });
                e.Property(x => x.Summary).HasColumnType("jsonb").HasDefaultValue("{}");
                e.ToTable(t =>
                {
                    t.HasCheckConstraint("CK_ImportBatches_Mode",
                        "\"Mode\" IN ('incremental','replace')");
                    t.HasCheckConstraint("CK_ImportBatches_Status",
                        "\"Status\" IN ('running','succeeded','failed')");
                });
            });

            b.Entity<ImportBatchFile>(e =>
            {
                e.ToTable("ImportBatchFiles");
                e.HasOne(x => x.ImportBatch).WithMany(x => x.Files)
                    .HasForeignKey(x => x.ImportBatchId).OnDelete(DeleteBehavior.Cascade);
                e.HasIndex(x => new { x.ImportBatchId, x.FileName, x.SheetName }).IsUnique();
            });

            b.Entity<ImportIssue>(e =>
            {
                e.ToTable("ImportIssues");
                e.HasOne(x => x.ImportBatch).WithMany(x => x.Issues)
                    .HasForeignKey(x => x.ImportBatchId).OnDelete(DeleteBehavior.Cascade);
                e.HasIndex(x => new { x.ImportBatchId, x.Level });
                e.ToTable(t => t.HasCheckConstraint("CK_ImportIssues_Level",
                    "\"Level\" IN ('error','warning','info')"));
            });

            b.Entity<ProgressIfcBinding>(e =>
            {
                e.ToTable("ProgressIfcBindings");

                e.HasOne(x => x.LayerProgress).WithMany(p => p.Bindings)
                    .HasForeignKey(x => x.LayerProgressId).OnDelete(DeleteBehavior.Cascade);
                e.HasOne(x => x.IfcModel).WithMany()
                    .HasForeignKey(x => x.IfcModelId).OnDelete(DeleteBehavior.Cascade);

                // Rebinding the same model is idempotent
                e.HasIndex(x => new { x.IfcModelId, x.LayerProgressId, x.IfcElementGlobalId })
                    .IsUnique();
                // The reverse lookup the per-element tint uses
                e.HasIndex(x => new { x.IfcModelId, x.IfcElementGlobalId });

                // Composite FK to IfcElements(IfcModelId, GlobalId): a binding can never
                // point at an element the model does not contain, even if a client sends one.
                e.HasOne<IfcElement>()
                    .WithMany()
                    .HasForeignKey(x => new { x.IfcModelId, x.IfcElementGlobalId })
                    .HasPrincipalKey(x => new { x.IfcModelId, x.GlobalId })
                    .OnDelete(DeleteBehavior.Cascade)
                    .HasConstraintName("FK_ProgressIfcBindings_IfcElements");

                e.ToTable(t =>
                {
                    t.HasCheckConstraint("CK_ProgressIfcBindings_Strategy",
                        "\"Strategy\" IN ('guid','group','position','name')");
                    t.HasCheckConstraint("CK_ProgressIfcBindings_Confidence",
                        "\"Confidence\" IS NULL OR \"Confidence\" IN ('exact','high','medium')");
                    t.HasCheckConstraint("CK_ProgressIfcBindings_SourceRefKind",
                        "\"SourceRefKind\" IS NULL OR \"SourceRefKind\" IN ('element','group','none')");
                });
            });
        }
    }
}
