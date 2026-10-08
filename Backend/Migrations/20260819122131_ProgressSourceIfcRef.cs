using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace RoadBimBackend.Migrations
{
    /// <summary>
    /// Stores the raw `LayerId` cell from the workbook alongside each progress row.
    ///
    /// The *resolved* answer lives in ProgressIfcBindings, but that only exists once a model
    /// has been uploaded. A project whose workbooks were imported first has no bindings yet,
    /// and without the original reference a later re-resolve has no GlobalId to match on —
    /// every row falls back to matching by position, silently downgrading twelve exact
    /// matches to twelve approximate ones.
    ///
    /// Written as idempotent SQL for the same reason as the first migration: it has to be
    /// safe to re-run against a database that may already be partly migrated.
    /// </summary>
    public partial class ProgressSourceIfcRef : Migration
    {
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(@"
ALTER TABLE ""LayerProgress"" ADD COLUMN IF NOT EXISTS ""SourceIfcRef"" text NULL;
");
        }

        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(@"
ALTER TABLE ""LayerProgress"" DROP COLUMN IF EXISTS ""SourceIfcRef"";
");
        }
    }
}
