using Microsoft.EntityFrameworkCore;

namespace RoadBimBackend.Data
{
    /// <summary>
    /// PostgreSQL port of the two SQL Server stored procedures that used to live in
    /// Database/Schema.sql. EnsureCreated() only builds tables from the EF model, so the
    /// functions are (re)created here on startup to keep `dotnet run` self-sufficient.
    /// Both statements are idempotent (CREATE OR REPLACE).
    /// </summary>
    public static class PostgresFunctions
    {
        public static void Create(RoadDbContext context)
        {
            context.Database.ExecuteSqlRaw(GetChainageLayerDetailsSql);
            context.Database.ExecuteSqlRaw(UpdateChainageLayerSql);
        }

        // Was: dbo.sp_GetChainageLayerDetails
        private const string GetChainageLayerDetailsSql = @"
CREATE OR REPLACE FUNCTION sp_get_chainage_layer_details(p_chainage_km double precision DEFAULT 42.0)
RETURNS TABLE (
    ""ChainageKm""            double precision,
    ""KmLabel""               text,
    ""SectionName""           text,
    ""BaseTerrainElevation""  double precision,
    ""TerrainType""           text,
    ""LayerId""               integer,
    ""LayerName""             text,
    ""LayerCode""             text,
    ""SortOrder""             integer,
    ""EffectiveThicknessMm""  integer,
    ""MaterialType""          text,
    ""LevelColorHex""         text,
    ""Status""                text,
    ""ProgressPercent""       double precision,
    ""TopLevelMeters""        double precision,
    ""BaseLevelMeters""       double precision
) AS $func$
BEGIN
    RETURN QUERY
    SELECT
        c.""ChainageStart"",
        c.""KmLabel""::text,
        c.""SectionName""::text,
        c.""Elevation"",
        c.""TerrainType""::text,
        l.""Id"",
        l.""LayerName""::text,
        l.""Code""::text,
        l.""SortOrder"",
        COALESCE(lp.""DesignThicknessMm"", l.""ThicknessMm""),
        l.""MaterialType""::text,
        COALESCE(lp.""LevelColorHex"", l.""DefaultColorHex"")::text,
        COALESCE(lp.""Status"", 'In-Progress')::text,
        COALESCE(lp.""ProgressPercent"", 50),
        -- Top RL = terrain elevation + cumulative thickness of this layer and everything below it
        ROUND((c.""Elevation"" + (
            SELECT COALESCE(SUM(COALESCE(lps.""DesignThicknessMm"", ls.""ThicknessMm"")), 0) / 1000.0
            FROM ""RoadLayers"" ls
            INNER JOIN ""LayerProgress"" lps ON lps.""LayerId"" = ls.""Id"" AND lps.""ChainageId"" = c.""Id""
            WHERE ls.""SortOrder"" <= l.""SortOrder""
        ))::numeric, 3)::double precision,
        -- Base RL = terrain elevation + cumulative thickness of the layers strictly below it
        ROUND((c.""Elevation"" + (
            SELECT COALESCE(SUM(COALESCE(lps.""DesignThicknessMm"", ls.""ThicknessMm"")), 0) / 1000.0
            FROM ""RoadLayers"" ls
            INNER JOIN ""LayerProgress"" lps ON lps.""LayerId"" = ls.""Id"" AND lps.""ChainageId"" = c.""Id""
            WHERE ls.""SortOrder"" < l.""SortOrder""
        ))::numeric, 3)::double precision
    FROM ""RoadChainages"" c
    INNER JOIN ""LayerProgress"" lp ON lp.""ChainageId"" = c.""Id""
    INNER JOIN ""RoadLayers"" l    ON l.""Id"" = lp.""LayerId""
    WHERE c.""ChainageStart"" = p_chainage_km
    ORDER BY l.""SortOrder"" DESC;
END;
$func$ LANGUAGE plpgsql;
";

        // Was: dbo.sp_UpdateChainageLayerLevelAndThickness
        private const string UpdateChainageLayerSql = @"
CREATE OR REPLACE FUNCTION sp_update_chainage_layer_level_and_thickness(
    p_chainage_km      double precision,
    p_layer_code       text,
    p_new_thickness_mm integer,
    p_new_color_hex    text DEFAULT NULL
) RETURNS void AS $func$
DECLARE
    v_chainage_id integer;
    v_layer_id    integer;
BEGIN
    SELECT ""Id"" INTO v_chainage_id FROM ""RoadChainages"" WHERE ""ChainageStart"" = p_chainage_km;
    SELECT ""Id"" INTO v_layer_id    FROM ""RoadLayers""    WHERE ""Code"" = p_layer_code;

    IF v_chainage_id IS NOT NULL AND v_layer_id IS NOT NULL THEN
        IF EXISTS (SELECT 1 FROM ""LayerProgress""
                   WHERE ""ChainageId"" = v_chainage_id AND ""LayerId"" = v_layer_id) THEN
            UPDATE ""LayerProgress""
               SET ""DesignThicknessMm"" = p_new_thickness_mm,
                   ""LevelColorHex""     = COALESCE(p_new_color_hex, ""LevelColorHex""),
                   ""UpdatedAt""         = now(),
                   ""UpdatedBy""         = 'UI Stored Procedure Execution'
             WHERE ""ChainageId"" = v_chainage_id AND ""LayerId"" = v_layer_id;
        ELSE
            INSERT INTO ""LayerProgress"" (
                ""ChainageId"", ""LayerId"", ""Status"", ""ProgressPercent"",
                ""DesignThicknessMm"", ""LevelColorHex"",
                ""PlannedStartDate"", ""PlannedEndDate"",
                ""BudgetCost"", ""ActualCost"", ""CostVariance"", ""DelayDays"",
                ""UpdatedBy"", ""UpdatedAt""
            ) VALUES (
                v_chainage_id, v_layer_id, 'In-Progress', 50.0,
                p_new_thickness_mm, p_new_color_hex,
                now(), now() + interval '3 months',
                0, 0, 0, 0,
                'UI Stored Procedure Execution', now()
            );
        END IF;
    END IF;
END;
$func$ LANGUAGE plpgsql;
";
    }
}
