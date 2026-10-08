using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace RoadBimBackend.Migrations
{
    /// <inheritdoc />
    public partial class BridgeItems : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "BridgeItems",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    ProjectId = table.Column<int>(type: "integer", nullable: false),
                    PackageId = table.Column<int>(type: "integer", nullable: false),
                    SourceKey = table.Column<string>(type: "character varying(600)", maxLength: 600, nullable: false),
                    SourceRowNumber = table.Column<int>(type: "integer", nullable: true),
                    ItemNo = table.Column<string>(type: "text", nullable: true),
                    Description = table.Column<string>(type: "text", nullable: true),
                    Uom = table.Column<string>(type: "text", nullable: true),
                    Location = table.Column<string>(type: "text", nullable: true),
                    ExecutedQuantity = table.Column<double>(type: "double precision", nullable: true),
                    RfiRefs = table.Column<string>(type: "text", nullable: true),
                    RfiDates = table.Column<string>(type: "text", nullable: true),
                    BillNo = table.Column<string>(type: "text", nullable: true),
                    Remarks = table.Column<string>(type: "text", nullable: true),
                    IfcGlobalId = table.Column<string>(type: "text", nullable: true),
                    ApprovalText = table.Column<string>(type: "text", nullable: true),
                    Approval = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    FirstImportBatchId = table.Column<long>(type: "bigint", nullable: true),
                    LastImportBatchId = table.Column<long>(type: "bigint", nullable: true),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    SupersededAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_BridgeItems", x => x.Id);
                    table.CheckConstraint("CK_BridgeItems_Approval", "\"Approval\" IN ('approved','rejected','pending')");
                    table.ForeignKey(
                        name: "FK_BridgeItems_Packages_PackageId",
                        column: x => x.PackageId,
                        principalTable: "Packages",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_BridgeItems_Projects_ProjectId",
                        column: x => x.ProjectId,
                        principalTable: "Projects",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_BridgeItems_PackageId_IfcGlobalId",
                table: "BridgeItems",
                columns: new[] { "PackageId", "IfcGlobalId" });

            migrationBuilder.CreateIndex(
                name: "IX_BridgeItems_PackageId_SourceKey",
                table: "BridgeItems",
                columns: new[] { "PackageId", "SourceKey" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_BridgeItems_PackageId_SupersededAt",
                table: "BridgeItems",
                columns: new[] { "PackageId", "SupersededAt" });

            migrationBuilder.CreateIndex(
                name: "IX_BridgeItems_ProjectId",
                table: "BridgeItems",
                column: "ProjectId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "BridgeItems");
        }
    }
}
