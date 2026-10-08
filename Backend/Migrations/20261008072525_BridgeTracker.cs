using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace RoadBimBackend.Migrations
{
    /// <inheritdoc />
    public partial class BridgeTracker : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "Module",
                table: "Packages",
                type: "character varying(64)",
                maxLength: 64,
                nullable: true);

            migrationBuilder.CreateTable(
                name: "BridgeTrackerFiles",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    ProjectId = table.Column<int>(type: "integer", nullable: false),
                    PackageId = table.Column<int>(type: "integer", nullable: false),
                    Kind = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    OriginalFileName = table.Column<string>(type: "character varying(400)", maxLength: 400, nullable: false),
                    ContentSha256 = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    ByteSize = table.Column<long>(type: "bigint", nullable: false),
                    StoragePath = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: false),
                    Bill = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    Period = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    UploadedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UploadedByUserId = table.Column<int>(type: "integer", nullable: true),
                    SupersededAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_BridgeTrackerFiles", x => x.Id);
                    table.CheckConstraint("CK_BridgeTrackerFiles_Kind", "\"Kind\" IN ('ifc','register','ipc','alignment')");
                    table.ForeignKey(
                        name: "FK_BridgeTrackerFiles_Packages_PackageId",
                        column: x => x.PackageId,
                        principalTable: "Packages",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_BridgeTrackerFiles_Projects_ProjectId",
                        column: x => x.ProjectId,
                        principalTable: "Projects",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_BridgeTrackerFiles_Users_UploadedByUserId",
                        column: x => x.UploadedByUserId,
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                });

            migrationBuilder.CreateTable(
                name: "BridgeTrackerConfigs",
                columns: table => new
                {
                    PackageId = table.Column<int>(type: "integer", nullable: false),
                    ConfigJson = table.Column<string>(type: "jsonb", nullable: false, defaultValue: "{}"),
                    ActiveIpcFileId = table.Column<long>(type: "bigint", nullable: true),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedByUserId = table.Column<int>(type: "integer", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_BridgeTrackerConfigs", x => x.PackageId);
                    table.ForeignKey(
                        name: "FK_BridgeTrackerConfigs_BridgeTrackerFiles_ActiveIpcFileId",
                        column: x => x.ActiveIpcFileId,
                        principalTable: "BridgeTrackerFiles",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                    table.ForeignKey(
                        name: "FK_BridgeTrackerConfigs_Packages_PackageId",
                        column: x => x.PackageId,
                        principalTable: "Packages",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.AddCheckConstraint(
                name: "CK_Packages_Module",
                table: "Packages",
                sql: "\"Module\" IS NULL OR \"Module\" IN ('palashbari-tracker')");

            migrationBuilder.CreateIndex(
                name: "IX_BridgeTrackerConfigs_ActiveIpcFileId",
                table: "BridgeTrackerConfigs",
                column: "ActiveIpcFileId");

            migrationBuilder.CreateIndex(
                name: "IX_BridgeTrackerFiles_PackageId_Kind_ContentSha256",
                table: "BridgeTrackerFiles",
                columns: new[] { "PackageId", "Kind", "ContentSha256" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_BridgeTrackerFiles_PackageId_Kind_SupersededAt",
                table: "BridgeTrackerFiles",
                columns: new[] { "PackageId", "Kind", "SupersededAt" });

            migrationBuilder.CreateIndex(
                name: "IX_BridgeTrackerFiles_ProjectId",
                table: "BridgeTrackerFiles",
                column: "ProjectId");

            migrationBuilder.CreateIndex(
                name: "IX_BridgeTrackerFiles_UploadedByUserId",
                table: "BridgeTrackerFiles",
                column: "UploadedByUserId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "BridgeTrackerConfigs");

            migrationBuilder.DropTable(
                name: "BridgeTrackerFiles");

            migrationBuilder.DropCheckConstraint(
                name: "CK_Packages_Module",
                table: "Packages");

            migrationBuilder.DropColumn(
                name: "Module",
                table: "Packages");
        }
    }
}
