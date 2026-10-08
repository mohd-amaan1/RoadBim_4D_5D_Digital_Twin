using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace RoadBimBackend.Migrations
{
    /// <inheritdoc />
    public partial class Phase3Inspections : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // Every row that exists today came from a workbook, so that is what they are
            // marked as. The default also has to satisfy CK_LayerProgress_Source, which an
            // empty string would violate on the first existing row.
            migrationBuilder.AddColumn<string>(
                name: "Source",
                table: "LayerProgress",
                type: "character varying(16)",
                maxLength: 16,
                nullable: false,
                defaultValue: "import");

            migrationBuilder.AddColumn<long>(
                name: "SourceRfiId",
                table: "LayerProgress",
                type: "bigint",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "RfiInspections",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    RfiId = table.Column<long>(type: "bigint", nullable: false),
                    VisitNo = table.Column<int>(type: "integer", nullable: false),
                    InspectedByUserId = table.Column<int>(type: "integer", nullable: false),
                    InspectedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    Outcome = table.Column<string>(type: "text", nullable: false),
                    Remarks = table.Column<string>(type: "text", nullable: true),
                    DeviceLatitude = table.Column<double>(type: "double precision", nullable: true),
                    DeviceLongitude = table.Column<double>(type: "double precision", nullable: true),
                    LocationAccuracyM = table.Column<double>(type: "double precision", nullable: true),
                    Source = table.Column<string>(type: "text", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_RfiInspections", x => x.Id);
                    table.CheckConstraint("CK_RfiInspections_Outcome", "\"Outcome\" IN ('pass','fail')");
                    table.CheckConstraint("CK_RfiInspections_Source", "\"Source\" IN ('web','mobile')");
                    table.ForeignKey(
                        name: "FK_RfiInspections_Rfis_RfiId",
                        column: x => x.RfiId,
                        principalTable: "Rfis",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_RfiInspections_Users_InspectedByUserId",
                        column: x => x.InspectedByUserId,
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "RfiAttachments",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    RfiId = table.Column<long>(type: "bigint", nullable: false),
                    RfiInspectionId = table.Column<long>(type: "bigint", nullable: true),
                    FileName = table.Column<string>(type: "character varying(300)", maxLength: 300, nullable: false),
                    ContentType = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                    ByteSize = table.Column<long>(type: "bigint", nullable: false),
                    StoragePath = table.Column<string>(type: "text", nullable: false),
                    ContentSha256 = table.Column<string>(type: "text", nullable: false),
                    Caption = table.Column<string>(type: "text", nullable: true),
                    UploadedByUserId = table.Column<int>(type: "integer", nullable: true),
                    UploadedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_RfiAttachments", x => x.Id);
                    table.ForeignKey(
                        name: "FK_RfiAttachments_RfiInspections_RfiInspectionId",
                        column: x => x.RfiInspectionId,
                        principalTable: "RfiInspections",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_RfiAttachments_Rfis_RfiId",
                        column: x => x.RfiId,
                        principalTable: "Rfis",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_RfiAttachments_Users_UploadedByUserId",
                        column: x => x.UploadedByUserId,
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                });

            migrationBuilder.AddCheckConstraint(
                name: "CK_LayerProgress_Source",
                table: "LayerProgress",
                sql: "\"Source\" IN ('import','rfi')");

            migrationBuilder.CreateIndex(
                name: "IX_RfiAttachments_RfiId",
                table: "RfiAttachments",
                column: "RfiId");

            migrationBuilder.CreateIndex(
                name: "IX_RfiAttachments_RfiInspectionId",
                table: "RfiAttachments",
                column: "RfiInspectionId");

            migrationBuilder.CreateIndex(
                name: "IX_RfiAttachments_UploadedByUserId",
                table: "RfiAttachments",
                column: "UploadedByUserId");

            migrationBuilder.CreateIndex(
                name: "IX_RfiInspections_InspectedByUserId_InspectedAt",
                table: "RfiInspections",
                columns: new[] { "InspectedByUserId", "InspectedAt" });

            migrationBuilder.CreateIndex(
                name: "IX_RfiInspections_RfiId_VisitNo",
                table: "RfiInspections",
                columns: new[] { "RfiId", "VisitNo" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "RfiAttachments");

            migrationBuilder.DropTable(
                name: "RfiInspections");

            migrationBuilder.DropCheckConstraint(
                name: "CK_LayerProgress_Source",
                table: "LayerProgress");

            migrationBuilder.DropColumn(
                name: "Source",
                table: "LayerProgress");

            migrationBuilder.DropColumn(
                name: "SourceRfiId",
                table: "LayerProgress");
        }
    }
}
