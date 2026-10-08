using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace RoadBimBackend.Migrations
{
    /// <inheritdoc />
    public partial class FieldEngineerDesignation : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<bool>(
                name: "IsFieldEngineer",
                table: "ProjectMembers",
                type: "boolean",
                nullable: false,
                defaultValue: false);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "IsFieldEngineer",
                table: "ProjectMembers");
        }
    }
}
