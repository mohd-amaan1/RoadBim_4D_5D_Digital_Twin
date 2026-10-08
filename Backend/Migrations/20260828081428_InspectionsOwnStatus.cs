using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace RoadBimBackend.Migrations
{
    /// <summary>
    /// Inspections become the only thing that colours the map.
    ///
    /// Until now an import could still set a cell's live status, which meant a freshly
    /// imported project showed green and red on the map before anybody had inspected
    /// anything. A spreadsheet cell records somebody's intention; the map is supposed to
    /// show what was actually built and checked, and those are not the same claim.
    ///
    /// So the workbook's status moves to <c>BaselineStatus</c> — kept, not discarded, so
    /// plan-versus-site stays comparable — and every cell's live status resets to
    /// "Not Started" until an inspection says otherwise.
    ///
    /// Written by hand rather than left as scaffolded: the generated version added the new
    /// check constraint while existing rows still held <c>Source = 'import'</c>, which
    /// fails immediately on any populated database.
    /// </summary>
    public partial class InspectionsOwnStatus : Migration
    {
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // The old constraint has to go first — the data migration below writes values
            // it does not permit.
            migrationBuilder.DropCheckConstraint(
                name: "CK_LayerProgress_Source",
                table: "LayerProgress");

            migrationBuilder.AddColumn<string>(
                name: "BaselineStatus",
                table: "LayerProgress",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<double>(
                name: "BaselineProgressPercent",
                table: "LayerProgress",
                type: "double precision",
                nullable: true);

            // Everything the workbook claimed becomes the baseline. Nothing is lost.
            migrationBuilder.Sql("""
                UPDATE "LayerProgress"
                   SET "BaselineStatus" = "Status",
                       "BaselineProgressPercent" = "ProgressPercent"
                 WHERE "BaselineStatus" IS NULL;
                """);

            // Cells nobody has inspected go back to un-offered. Rows already written by an
            // inspection keep the verdict that put them there.
            migrationBuilder.Sql("""
                UPDATE "LayerProgress"
                   SET "Status" = 'Not Started',
                       "ProgressPercent" = 0,
                       "Source" = 'none',
                       "SourceRfiId" = NULL
                 WHERE "Source" <> 'rfi';
                """);

            migrationBuilder.AddCheckConstraint(
                name: "CK_LayerProgress_Source",
                table: "LayerProgress",
                sql: "\"Source\" IN ('none','rfi')");
        }

        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "CK_LayerProgress_Source",
                table: "LayerProgress");

            // Put the workbook's status back where it was.
            migrationBuilder.Sql("""
                UPDATE "LayerProgress"
                   SET "Status" = COALESCE("BaselineStatus", "Status"),
                       "ProgressPercent" = COALESCE("BaselineProgressPercent", "ProgressPercent"),
                       "Source" = 'import'
                 WHERE "Source" = 'none';
                """);

            migrationBuilder.DropColumn(name: "BaselineProgressPercent", table: "LayerProgress");
            migrationBuilder.DropColumn(name: "BaselineStatus", table: "LayerProgress");

            migrationBuilder.AddCheckConstraint(
                name: "CK_LayerProgress_Source",
                table: "LayerProgress",
                sql: "\"Source\" IN ('import','rfi')");
        }
    }
}
