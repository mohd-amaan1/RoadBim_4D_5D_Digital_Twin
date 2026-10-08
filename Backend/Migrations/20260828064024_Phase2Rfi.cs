using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace RoadBimBackend.Migrations
{
    /// <inheritdoc />
    public partial class Phase2Rfi : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "NumberSeries",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    EntityType = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    PackageId = table.Column<int>(type: "integer", nullable: true),
                    ProjectId = table.Column<int>(type: "integer", nullable: true),
                    Prefix = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    Pattern = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                    SeqPadding = table.Column<int>(type: "integer", nullable: false),
                    ResetCycle = table.Column<string>(type: "text", nullable: false),
                    CurrentSeq = table.Column<long>(type: "bigint", nullable: false),
                    LastResetOn = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    IsActive = table.Column<bool>(type: "boolean", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_NumberSeries", x => x.Id);
                    table.CheckConstraint("CK_NumberSeries_ResetCycle", "\"ResetCycle\" IN ('never','daily','monthly','yearly')");
                    table.ForeignKey(
                        name: "FK_NumberSeries_Packages_PackageId",
                        column: x => x.PackageId,
                        principalTable: "Packages",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_NumberSeries_Projects_ProjectId",
                        column: x => x.ProjectId,
                        principalTable: "Projects",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "Rfis",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    ProjectId = table.Column<int>(type: "integer", nullable: false),
                    PackageId = table.Column<int>(type: "integer", nullable: false),
                    RfiNo = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    Title = table.Column<string>(type: "character varying(300)", maxLength: 300, nullable: false),
                    Description = table.Column<string>(type: "text", nullable: true),
                    LayerId = table.Column<int>(type: "integer", nullable: true),
                    ComponentRef = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    SubComponentRef = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    Quantity = table.Column<double>(type: "double precision", nullable: true),
                    ChainageFromId = table.Column<int>(type: "integer", nullable: false),
                    ChainageToId = table.Column<int>(type: "integer", nullable: false),
                    ChainageFromM = table.Column<double>(type: "double precision", nullable: false),
                    ChainageToM = table.Column<double>(type: "double precision", nullable: false),
                    LocationText = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    Side = table.Column<string>(type: "text", nullable: false),
                    RaisedByUserId = table.Column<int>(type: "integer", nullable: true),
                    AssignedToUserId = table.Column<int>(type: "integer", nullable: true),
                    Status = table.Column<string>(type: "text", nullable: false),
                    Outcome = table.Column<string>(type: "text", nullable: true),
                    SubmittedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    RequiredInspectionAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    DueAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    InspectedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    InspectedByUserId = table.Column<int>(type: "integer", nullable: true),
                    ApprovedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    ApprovedByUserId = table.Column<int>(type: "integer", nullable: true),
                    CancelledAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Rfis", x => x.Id);
                    table.CheckConstraint("CK_Rfis_ChainageOrder", "\"ChainageToM\" >= \"ChainageFromM\"");
                    table.CheckConstraint("CK_Rfis_Outcome", "\"Outcome\" IS NULL OR \"Outcome\" IN ('pass','fail')");
                    table.CheckConstraint("CK_Rfis_Side", "\"Side\" IN ('LHS','RHS','both','na')");
                    table.CheckConstraint("CK_Rfis_Status", "\"Status\" IN ('draft','submitted','inspected','approved','rejected','cancelled')");
                    table.ForeignKey(
                        name: "FK_Rfis_Packages_PackageId",
                        column: x => x.PackageId,
                        principalTable: "Packages",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_Rfis_Projects_ProjectId",
                        column: x => x.ProjectId,
                        principalTable: "Projects",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_Rfis_RoadChainages_ChainageFromId",
                        column: x => x.ChainageFromId,
                        principalTable: "RoadChainages",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_Rfis_RoadChainages_ChainageToId",
                        column: x => x.ChainageToId,
                        principalTable: "RoadChainages",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_Rfis_RoadLayers_LayerId",
                        column: x => x.LayerId,
                        principalTable: "RoadLayers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                    table.ForeignKey(
                        name: "FK_Rfis_Users_AssignedToUserId",
                        column: x => x.AssignedToUserId,
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                    table.ForeignKey(
                        name: "FK_Rfis_Users_RaisedByUserId",
                        column: x => x.RaisedByUserId,
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                });

            migrationBuilder.CreateTable(
                name: "RfiEvents",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    RfiId = table.Column<long>(type: "bigint", nullable: false),
                    EventType = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    FromStatus = table.Column<string>(type: "text", nullable: true),
                    ToStatus = table.Column<string>(type: "text", nullable: true),
                    ActorUserId = table.Column<int>(type: "integer", nullable: true),
                    Comment = table.Column<string>(type: "text", nullable: true),
                    OccurredAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_RfiEvents", x => x.Id);
                    table.ForeignKey(
                        name: "FK_RfiEvents_Rfis_RfiId",
                        column: x => x.RfiId,
                        principalTable: "Rfis",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_RfiEvents_Users_ActorUserId",
                        column: x => x.ActorUserId,
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                });

            migrationBuilder.CreateIndex(
                name: "IX_NumberSeries_EntityType_PackageId",
                table: "NumberSeries",
                columns: new[] { "EntityType", "PackageId" },
                unique: true,
                filter: "\"PackageId\" IS NOT NULL AND \"IsActive\"");

            migrationBuilder.CreateIndex(
                name: "IX_NumberSeries_PackageId",
                table: "NumberSeries",
                column: "PackageId");

            migrationBuilder.CreateIndex(
                name: "IX_NumberSeries_ProjectId",
                table: "NumberSeries",
                column: "ProjectId");

            migrationBuilder.CreateIndex(
                name: "IX_RfiEvents_ActorUserId",
                table: "RfiEvents",
                column: "ActorUserId");

            migrationBuilder.CreateIndex(
                name: "IX_RfiEvents_RfiId_OccurredAt",
                table: "RfiEvents",
                columns: new[] { "RfiId", "OccurredAt" });

            migrationBuilder.CreateIndex(
                name: "IX_Rfis_AssignedToUserId",
                table: "Rfis",
                column: "AssignedToUserId",
                filter: "\"CancelledAt\" IS NULL");

            migrationBuilder.CreateIndex(
                name: "IX_Rfis_ChainageFromId",
                table: "Rfis",
                column: "ChainageFromId");

            migrationBuilder.CreateIndex(
                name: "IX_Rfis_ChainageToId",
                table: "Rfis",
                column: "ChainageToId");

            migrationBuilder.CreateIndex(
                name: "IX_Rfis_LayerId",
                table: "Rfis",
                column: "LayerId");

            migrationBuilder.CreateIndex(
                name: "IX_Rfis_PackageId_ChainageFromM_ChainageToM",
                table: "Rfis",
                columns: new[] { "PackageId", "ChainageFromM", "ChainageToM" });

            migrationBuilder.CreateIndex(
                name: "IX_Rfis_PackageId_RfiNo",
                table: "Rfis",
                columns: new[] { "PackageId", "RfiNo" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_Rfis_PackageId_Status",
                table: "Rfis",
                columns: new[] { "PackageId", "Status" });

            migrationBuilder.CreateIndex(
                name: "IX_Rfis_ProjectId_Status",
                table: "Rfis",
                columns: new[] { "ProjectId", "Status" });

            migrationBuilder.CreateIndex(
                name: "IX_Rfis_RaisedByUserId",
                table: "Rfis",
                column: "RaisedByUserId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "NumberSeries");

            migrationBuilder.DropTable(
                name: "RfiEvents");

            migrationBuilder.DropTable(
                name: "Rfis");
        }
    }
}
