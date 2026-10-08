using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace RoadBimBackend.Migrations
{
    /// <summary>
    /// Phase 1 — packages.
    ///
    /// A project is now let as several contract packages, and every road row belongs to one.
    /// Rows keep <c>ProjectId</c> as well, so the project-wide map still reads every package
    /// in a single indexed pass rather than joining through <c>Packages</c>.
    ///
    /// This migration is written by hand rather than left as scaffolded, because the
    /// scaffold adds <c>PackageId</c> with <c>DEFAULT 0</c> and then points a foreign key at
    /// <c>Packages</c> — on a database with any existing data that fails outright, since no
    /// package has id 0. The order below is the one that works on a populated database:
    ///
    ///   1. create <c>Packages</c>
    ///   2. give every existing project one, so there is something to point at
    ///   3. add the columns NULLABLE
    ///   4. backfill them from each row's own project
    ///   5. only then make them NOT NULL and attach the foreign keys
    ///
    /// Every uniqueness constraint that moves from project scope to package scope survives
    /// the backfill: all of a project's existing rows land in the same package, so a pair
    /// that was unique per project is still unique per package.
    /// </summary>
    public partial class Phase1Packages : Migration
    {
        /// <summary>The tables that gain a package, in dependency-safe order.</summary>
        private static readonly string[] ScopedTables =
        {
            "RoadChainages", "RoadLayers", "LayerProgress",
            "SiteHotspots", "ProjectMetrics", "IfcModels", "ImportBatches",
        };

        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // ---- 1. the packages table -------------------------------------------------
            migrationBuilder.CreateTable(
                name: "Packages",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    ProjectId = table.Column<int>(type: "integer", nullable: false),
                    Code = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    Name = table.Column<string>(type: "character varying(300)", maxLength: 300, nullable: false),
                    Description = table.Column<string>(type: "text", nullable: true),
                    ContractorName = table.Column<string>(type: "character varying(300)", maxLength: 300, nullable: false),
                    ContractNo = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: true),
                    ChainageFromM = table.Column<int>(type: "integer", nullable: true),
                    ChainageToM = table.Column<int>(type: "integer", nullable: true),
                    InspectionNoticeHours = table.Column<int>(type: "integer", nullable: false),
                    Status = table.Column<string>(type: "text", nullable: false),
                    SortOrder = table.Column<int>(type: "integer", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    CreatedByUserId = table.Column<int>(type: "integer", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Packages", x => x.Id);
                    table.CheckConstraint("CK_Packages_Status", "\"Status\" IN ('planned','active','suspended','completed')");
                    table.ForeignKey(
                        name: "FK_Packages_Projects_ProjectId",
                        column: x => x.ProjectId,
                        principalTable: "Projects",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_Packages_ProjectId_Code",
                table: "Packages",
                columns: new[] { "ProjectId", "Code" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_Packages_ProjectId_SortOrder",
                table: "Packages",
                columns: new[] { "ProjectId", "SortOrder" });

            // ---- 2. one package per existing project -----------------------------------
            // Contractor is left blank rather than invented. The package screen asks for it
            // on the next edit; a made-up name would read as fact.
            migrationBuilder.Sql("""
                INSERT INTO "Packages"
                    ("ProjectId", "Code", "Name", "Description", "ContractorName",
                     "InspectionNoticeHours", "Status", "SortOrder", "CreatedAt", "UpdatedAt")
                SELECT p."Id", 'main', 'Main package',
                       'Created by the packages migration so this project''s existing road data has a package to belong to.',
                       '', 24, 'active', 0, now(), now()
                  FROM "Projects" p
                 WHERE NOT EXISTS (SELECT 1 FROM "Packages" k WHERE k."ProjectId" = p."Id");
                """);

            // ---- 3. the columns, nullable for now --------------------------------------
            foreach (var table in ScopedTables)
            {
                migrationBuilder.AddColumn<int>(
                    name: "PackageId",
                    table: table,
                    type: "integer",
                    nullable: true);
            }

            // ---- 4. backfill from each row's own project -------------------------------
            foreach (var table in ScopedTables)
            {
                migrationBuilder.Sql($"""
                    UPDATE "{table}" t
                       SET "PackageId" = k."Id"
                      FROM "Packages" k
                     WHERE k."ProjectId" = t."ProjectId"
                       AND k."Code" = 'main'
                       AND t."PackageId" IS NULL;
                    """);
            }

            // ---- 5. now they can be required -------------------------------------------
            foreach (var table in ScopedTables)
            {
                migrationBuilder.AlterColumn<int>(
                    name: "PackageId",
                    table: table,
                    type: "integer",
                    nullable: false,
                    oldClrType: typeof(int),
                    oldType: "integer",
                    oldNullable: true);
            }

            // ---- 6. uniqueness moves from project scope to package scope ----------------
            migrationBuilder.DropIndex(name: "IX_RoadLayers_ProjectId_Code", table: "RoadLayers");
            migrationBuilder.DropIndex(name: "IX_RoadChainages_ProjectId_SourceChainageId", table: "RoadChainages");
            migrationBuilder.DropIndex(name: "IX_ProjectMetrics_ProjectId_ImportBatchId", table: "ProjectMetrics");
            migrationBuilder.DropIndex(name: "IX_ImportBatches_ProjectId_ContentSha256", table: "ImportBatches");
            migrationBuilder.DropIndex(name: "IX_IfcModels_ProjectId_ContentSha256", table: "IfcModels");
            migrationBuilder.DropIndex(name: "IX_IfcModels_ProjectId_Version", table: "IfcModels");
            migrationBuilder.DropIndex(name: "UX_IfcModels_ActivePerProject", table: "IfcModels");

            migrationBuilder.CreateIndex(
                name: "IX_RoadChainages_PackageId",
                table: "RoadChainages",
                column: "PackageId");

            migrationBuilder.CreateIndex(
                name: "IX_RoadChainages_PackageId_SourceChainageId",
                table: "RoadChainages",
                columns: new[] { "PackageId", "SourceChainageId" },
                unique: true,
                filter: "\"SourceChainageId\" IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_RoadLayers_PackageId_Code",
                table: "RoadLayers",
                columns: new[] { "PackageId", "Code" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_RoadLayers_ProjectId",
                table: "RoadLayers",
                column: "ProjectId");

            migrationBuilder.CreateIndex(
                name: "IX_LayerProgress_PackageId_SupersededAt",
                table: "LayerProgress",
                columns: new[] { "PackageId", "SupersededAt" });

            migrationBuilder.CreateIndex(
                name: "IX_SiteHotspots_PackageId",
                table: "SiteHotspots",
                column: "PackageId");

            migrationBuilder.CreateIndex(
                name: "IX_ProjectMetrics_PackageId_ImportBatchId",
                table: "ProjectMetrics",
                columns: new[] { "PackageId", "ImportBatchId" },
                unique: true,
                filter: "\"ImportBatchId\" IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_ProjectMetrics_ProjectId",
                table: "ProjectMetrics",
                column: "ProjectId");

            migrationBuilder.CreateIndex(
                name: "IX_IfcModels_PackageId_ContentSha256",
                table: "IfcModels",
                columns: new[] { "PackageId", "ContentSha256" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_IfcModels_PackageId_Version",
                table: "IfcModels",
                columns: new[] { "PackageId", "Version" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_IfcModels_ProjectId",
                table: "IfcModels",
                column: "ProjectId");

            // One active model per PACKAGE now, so a project shows several at once — which is
            // what puts every package on the same map.
            migrationBuilder.CreateIndex(
                name: "UX_IfcModels_ActivePerPackage",
                table: "IfcModels",
                column: "PackageId",
                unique: true,
                filter: "\"IsActive\"");

            migrationBuilder.CreateIndex(
                name: "IX_ImportBatches_PackageId_ContentSha256",
                table: "ImportBatches",
                columns: new[] { "PackageId", "ContentSha256" });

            migrationBuilder.CreateIndex(
                name: "IX_ImportBatches_PackageId_StartedAt",
                table: "ImportBatches",
                columns: new[] { "PackageId", "StartedAt" });

            // ---- 7. the foreign keys, last, on a fully populated column -----------------
            foreach (var table in ScopedTables)
            {
                migrationBuilder.AddForeignKey(
                    name: $"FK_{table}_Packages_PackageId",
                    table: table,
                    column: "PackageId",
                    principalTable: "Packages",
                    principalColumn: "Id",
                    onDelete: ReferentialAction.Cascade);
            }
        }

        protected override void Down(MigrationBuilder migrationBuilder)
        {
            foreach (var table in ScopedTables)
            {
                migrationBuilder.DropForeignKey(name: $"FK_{table}_Packages_PackageId", table: table);
            }

            migrationBuilder.DropIndex(name: "IX_RoadChainages_PackageId", table: "RoadChainages");
            migrationBuilder.DropIndex(name: "IX_RoadChainages_PackageId_SourceChainageId", table: "RoadChainages");
            migrationBuilder.DropIndex(name: "IX_RoadLayers_PackageId_Code", table: "RoadLayers");
            migrationBuilder.DropIndex(name: "IX_RoadLayers_ProjectId", table: "RoadLayers");
            migrationBuilder.DropIndex(name: "IX_LayerProgress_PackageId_SupersededAt", table: "LayerProgress");
            migrationBuilder.DropIndex(name: "IX_SiteHotspots_PackageId", table: "SiteHotspots");
            migrationBuilder.DropIndex(name: "IX_ProjectMetrics_PackageId_ImportBatchId", table: "ProjectMetrics");
            migrationBuilder.DropIndex(name: "IX_ProjectMetrics_ProjectId", table: "ProjectMetrics");
            migrationBuilder.DropIndex(name: "IX_IfcModels_PackageId_ContentSha256", table: "IfcModels");
            migrationBuilder.DropIndex(name: "IX_IfcModels_PackageId_Version", table: "IfcModels");
            migrationBuilder.DropIndex(name: "IX_IfcModels_ProjectId", table: "IfcModels");
            migrationBuilder.DropIndex(name: "UX_IfcModels_ActivePerPackage", table: "IfcModels");
            migrationBuilder.DropIndex(name: "IX_ImportBatches_PackageId_ContentSha256", table: "ImportBatches");
            migrationBuilder.DropIndex(name: "IX_ImportBatches_PackageId_StartedAt", table: "ImportBatches");

            migrationBuilder.DropTable(name: "Packages");

            foreach (var table in ScopedTables)
            {
                migrationBuilder.DropColumn(name: "PackageId", table: table);
            }

            migrationBuilder.CreateIndex(
                name: "IX_RoadLayers_ProjectId_Code",
                table: "RoadLayers",
                columns: new[] { "ProjectId", "Code" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_RoadChainages_ProjectId_SourceChainageId",
                table: "RoadChainages",
                columns: new[] { "ProjectId", "SourceChainageId" },
                unique: true,
                filter: "\"SourceChainageId\" IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_ProjectMetrics_ProjectId_ImportBatchId",
                table: "ProjectMetrics",
                columns: new[] { "ProjectId", "ImportBatchId" },
                unique: true,
                filter: "\"ImportBatchId\" IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_ImportBatches_ProjectId_ContentSha256",
                table: "ImportBatches",
                columns: new[] { "ProjectId", "ContentSha256" });

            migrationBuilder.CreateIndex(
                name: "IX_IfcModels_ProjectId_ContentSha256",
                table: "IfcModels",
                columns: new[] { "ProjectId", "ContentSha256" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_IfcModels_ProjectId_Version",
                table: "IfcModels",
                columns: new[] { "ProjectId", "Version" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "UX_IfcModels_ActivePerProject",
                table: "IfcModels",
                column: "ProjectId",
                unique: true,
                filter: "\"IsActive\"");
        }
    }
}
