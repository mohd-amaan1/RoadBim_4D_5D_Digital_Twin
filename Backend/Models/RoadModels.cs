using System;
using System.Collections.Generic;

namespace RoadBimBackend.Models
{
    public class RoadChainage
    {
        public int Id { get; set; }

        public int ProjectId { get; set; }
        public Project? Project { get; set; }

        public int PackageId { get; set; }
        public Package? Package { get; set; }

        /// <summary>The Id column of the source workbook — the import idempotency key.</summary>
        public int? SourceChainageId { get; set; }
        public int? SourceRowNumber { get; set; }

        /// <summary>Position along the alignment, independent of Id.</summary>
        public int? SortOrder { get; set; }
        public long? LastImportBatchId { get; set; }

        public double ChainageStart { get; set; }
        public double ChainageEnd { get; set; }
        public string KmLabel { get; set; } = string.Empty;
        public string SectionName { get; set; } = string.Empty;
        public double Latitude { get; set; }
        public double Longitude { get; set; }
        public double Elevation { get; set; }
        public string TerrainType { get; set; } = "Cut & Fill";

        public List<LayerProgress> LayerProgresses { get; set; } = new();
        public List<SiteHotspot> SiteHotspots { get; set; } = new();
    }

    public class RoadLayer
    {
        public int Id { get; set; }

        public int ProjectId { get; set; }
        public Project? Project { get; set; }

        public int PackageId { get; set; }
        public Package? Package { get; set; }

        public int? SourceLayerId { get; set; }
        public long? LastImportBatchId { get; set; }

        public string LayerName { get; set; } = string.Empty;
        public string Code { get; set; } = string.Empty;
        public int ThicknessMm { get; set; }
        public string MaterialType { get; set; } = string.Empty;
        public string DefaultColorHex { get; set; } = "#64748B";
        public int SortOrder { get; set; }
    }

    public class LayerProgress
    {
        public int Id { get; set; }

        public int ProjectId { get; set; }
        public Project? Project { get; set; }

        public int PackageId { get; set; }
        public Package? Package { get; set; }

        public int ChainageId { get; set; }
        public RoadChainage? Chainage { get; set; }

        public int LayerId { get; set; }
        public RoadLayer? Layer { get; set; }

        public string Status { get; set; } = "Not Started"; // Completed, In-Progress, Delayed, Not Started
        public double ProgressPercent { get; set; }

        // Per-chainage level overrides consumed by sp_get_chainage_layer_details
        public int? DesignThicknessMm { get; set; }
        public double? TopLevelMeters { get; set; }
        public double? BaseLevelMeters { get; set; }
        public string? LevelColorHex { get; set; }

        public DateTime PlannedStartDate { get; set; }
        public DateTime PlannedEndDate { get; set; }
        public DateTime? ActualStartDate { get; set; }
        public DateTime? ActualEndDate { get; set; }
        public decimal BudgetCost { get; set; }
        public decimal ActualCost { get; set; }
        public decimal CostVariance { get; set; }
        public int DelayDays { get; set; }
        public string UpdatedBy { get; set; } = "System";
        public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;

        // --- import provenance -------------------------------------------------
        /// <summary>The importer's row key, e.g. "1:SUB".</summary>
        public string? SourceRowKey { get; set; }
        public int? SourceRowNumber { get; set; }

        /// <summary>The status exactly as the sheet spelled it, before normalisation.</summary>
        public string? SourceStatusText { get; set; }

        /// <summary>
        /// The raw LayerId cell from the workbook — an IFC GlobalId naming either an element
        /// or a model group.
        ///
        /// The resolved answer lives in ProgressIfcBindings, but this is the *input* that
        /// produced it, and it has to survive on its own: a project whose workbooks were
        /// imported before any model exists has no bindings yet, and without this column a
        /// later re-resolve would have nothing to match on and would fall back to matching
        /// by position for every row.
        /// </summary>
        public string? SourceIfcRef { get; set; }

        public long? FirstImportBatchId { get; set; }
        public long? LastImportBatchId { get; set; }

        /// <summary>
        /// Soft-delete marker used by replace-mode imports. Nothing an import does removes
        /// a row; reads filter on this being null.
        /// </summary>
        public DateTime? SupersededAt { get; set; }

        /// <summary>
        /// none | rfi — whether an inspection has spoken about this cell yet.
        ///
        /// <c>none</c> means no verdict exists, so <see cref="Status"/> stays "Not Started"
        /// and the map draws the cell as un-offered. Only an inspection moves it to
        /// <c>rfi</c>. An import never can: a spreadsheet cell records somebody's intention,
        /// and the map is supposed to show what was actually built and checked.
        /// </summary>
        public string Source { get; set; } = ProgressSource.None;

        /// <summary>The inspection that last set the status, when Source is 'rfi'.</summary>
        public long? SourceRfiId { get; set; }

        /// <summary>
        /// What the workbook claimed. Kept for comparison, never drawn on the map.
        ///
        /// This is the PLAN. Holding it beside the inspected status is what makes
        /// plan-versus-actual possible, and lets the import report where the sheet and the
        /// site disagree rather than one silently overwriting the other.
        /// </summary>
        public string? BaselineStatus { get; set; }

        public double? BaselineProgressPercent { get; set; }

        public List<ProgressIfcBinding> Bindings { get; set; } = new();
    }

    public class SiteHotspot
    {
        public int Id { get; set; }

        public int ProjectId { get; set; }
        public Project? Project { get; set; }

        public int PackageId { get; set; }
        public Package? Package { get; set; }

        public int ChainageId { get; set; }
        public RoadChainage? Chainage { get; set; }

        public string Title { get; set; } = string.Empty;
        public string Description { get; set; } = string.Empty;
        public string Category { get; set; } = "Photo360"; // Photo360, DroneInspection, QualityIssue
        public string ImageUrl { get; set; } = string.Empty;
        public DateTime InspectionDate { get; set; } = DateTime.UtcNow;
        public string InspectorName { get; set; } = string.Empty;
        public string Status { get; set; } = "Open";
    }

    public class ProjectMetrics
    {
        public int Id { get; set; }

        public int ProjectId { get; set; }
        public Project? Project { get; set; }

        public int PackageId { get; set; }
        public Package? Package { get; set; }

        public long? ImportBatchId { get; set; }

        /// <summary>
        /// True means "this is what the source workbook claimed at import time" — an audit
        /// record, never the figure the dashboard shows. Live KPIs stay computed from the
        /// progress rows so the two can never drift apart.
        /// </summary>
        public bool IsSourceSnapshot { get; set; } = true;

        public double TotalKmTarget { get; set; } = 100.0;
        public double TotalKmCompleted { get; set; }
        public double OverallProgressPercent { get; set; }
        public double SchedulePerformanceIndex { get; set; }
        public double CostPerformanceIndex { get; set; }
        public decimal TotalBudgetCost { get; set; }
        public decimal TotalActualCost { get; set; }
        public int DelayedSectionsCount { get; set; }
        public DateTime CalculatedAt { get; set; } = DateTime.UtcNow;
    }

    // DTO Models
    public class ExecutiveSummaryDto
    {
        public double TotalKmTarget { get; set; } = 100.0;
        public double TotalKmCompleted { get; set; }
        public double OverallProgressPercent { get; set; }
        public double SPI { get; set; } // Schedule Performance Index
        public double CPI { get; set; } // Cost Performance Index
        public decimal TotalBudgetSpent { get; set; }
        public decimal TotalBudgetPlan { get; set; }
        public decimal EarnedValue { get; set; }
        public decimal CostVariance { get; set; }
        public int DelayedSectionsCount { get; set; }
        public List<LayerBreakdownDto> LayerBreakdown { get; set; } = new();
        public List<SCurvePointDto> SCurve { get; set; } = new();
    }

    public class LayerBreakdownDto
    {
        public string LayerName { get; set; } = string.Empty;
        public string Code { get; set; } = string.Empty;
        public int ThicknessMm { get; set; }
        public double ProgressPercent { get; set; }
        public int CompletedKm { get; set; }
        public int InProgressKm { get; set; }
        public int DelayedKm { get; set; }
    }

    public class SCurvePointDto
    {
        public string Month { get; set; } = string.Empty;
        public double PlannedProgress { get; set; }
        public double ActualProgress { get; set; }
    }

    public class AIQueryRequest
    {
        public string Question { get; set; } = string.Empty;
    }

    public class AIQueryResponse
    {
        public string Answer { get; set; } = string.Empty;
        public List<string> RelatedChainages { get; set; } = new();
        public string SuggestedAction { get; set; } = string.Empty;
    }
}
