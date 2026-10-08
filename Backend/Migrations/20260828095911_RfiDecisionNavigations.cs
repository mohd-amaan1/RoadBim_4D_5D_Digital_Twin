using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace RoadBimBackend.Migrations
{
    /// <inheritdoc />
    public partial class RfiDecisionNavigations : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateIndex(
                name: "IX_Rfis_ApprovedByUserId",
                table: "Rfis",
                column: "ApprovedByUserId");

            migrationBuilder.CreateIndex(
                name: "IX_Rfis_InspectedByUserId",
                table: "Rfis",
                column: "InspectedByUserId");

            migrationBuilder.AddForeignKey(
                name: "FK_Rfis_Users_ApprovedByUserId",
                table: "Rfis",
                column: "ApprovedByUserId",
                principalTable: "Users",
                principalColumn: "Id",
                onDelete: ReferentialAction.SetNull);

            migrationBuilder.AddForeignKey(
                name: "FK_Rfis_Users_InspectedByUserId",
                table: "Rfis",
                column: "InspectedByUserId",
                principalTable: "Users",
                principalColumn: "Id",
                onDelete: ReferentialAction.SetNull);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_Rfis_Users_ApprovedByUserId",
                table: "Rfis");

            migrationBuilder.DropForeignKey(
                name: "FK_Rfis_Users_InspectedByUserId",
                table: "Rfis");

            migrationBuilder.DropIndex(
                name: "IX_Rfis_ApprovedByUserId",
                table: "Rfis");

            migrationBuilder.DropIndex(
                name: "IX_Rfis_InspectedByUserId",
                table: "Rfis");
        }
    }
}
