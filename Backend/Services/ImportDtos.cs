using System;
using System.Collections.Generic;

namespace RoadBimBackend.Services
{
    /// <summary>
    /// The payload the client sends after running the Phase 1 parser and Phase 2 resolver.
    ///
    /// Parsing, normalisation and binding stay in one implementation (the browser's), and
    /// the server owns identity, transactions and authorization. The alternative — porting
    /// the xlsx reader and the resolver to C# — would create a second implementation of
    /// subtle logic that is guaranteed to drift from the first.
    ///
    /// The original workbooks are uploaded alongside this payload and archived, so the
    /// server never has to take the client's word for what was in them.
    /// </summary>
    public class ImportPayloadDto
    {
        public string Mode { get; set; } = "incremental";
        public List<ImportFileDto> Files { get; set; } = new();
        public List<ChainageDto> Chainages { get; set; } = new();
        public List<LayerDto> Layers { get; set; } = new();
        public List<ProgressDto> Progress { get; set; } = new();
        public MetricsDto? Metrics { get; set; }
        public List<IssueDto> Issues { get; set; } = new();
        public string? Summary { get; set; }
    }

    public class ImportFileDto
    {
        public string FileName { get; set; } = string.Empty;
        public string SheetName { get; set; } = string.Empty;
        public string SheetKind { get; set; } = "UNKNOWN";
        public int RowCount { get; set; }
        public string? ContentSha256 { get; set; }
        public long ByteSize { get; set; }
    }

    public class ChainageDto
    {
        public int? Id { get; set; }
        public int? RowNumber { get; set; }
        public double? ChainageStart { get; set; }
        public double? ChainageEnd { get; set; }
        public string? KmLabel { get; set; }
        public string? SectionName { get; set; }
        public double? Latitude { get; set; }
        public double? Longitude { get; set; }
        public double? ElevationM { get; set; }
        public string? TerrainType { get; set; }
        public int? SortOrder { get; set; }
    }

    public class LayerDto
    {
        public int? Id { get; set; }
        public string Code { get; set; } = string.Empty;
        public string? LayerName { get; set; }
        public int? CatalogueThicknessMm { get; set; }
        public string? MaterialType { get; set; }
        public string? DefaultColorHex { get; set; }
        public int? SortOrder { get; set; }
    }

    public class ProgressDto
    {
        public string? Key { get; set; }
        public int ChainageId { get; set; }
        public string LayerCode { get; set; } = string.Empty;
        public int? RowNumber { get; set; }

        /// <summary>The workbook LayerId cell, kept so a re-resolve can match on it.</summary>
        public string? IfcRef { get; set; }

        public string? Status { get; set; }
        public string? RawStatus { get; set; }
        public double? ProgressPercent { get; set; }

        public DateTime? PlannedStartDate { get; set; }
        public DateTime? PlannedEndDate { get; set; }
        public DateTime? ActualStartDate { get; set; }
        public DateTime? ActualEndDate { get; set; }

        public decimal? BudgetCost { get; set; }
        public decimal? ActualCost { get; set; }
        public decimal? CostVariance { get; set; }
        public int? DelayDays { get; set; }

        public int? DesignThicknessMm { get; set; }
        public string? LevelColorHex { get; set; }
        public string? UpdatedBy { get; set; }

        /// <summary>Bindings resolved by the client for this row, if a model was loaded.</summary>
        public List<BindingDto> Bindings { get; set; } = new();
    }

    public class BindingDto
    {
        public string IfcElementGlobalId { get; set; } = string.Empty;
        public string? SourceRef { get; set; }
        public string? SourceRefKind { get; set; }
        public string Strategy { get; set; } = "guid";
        public string? Confidence { get; set; }
        public int? SegmentIndex { get; set; }
    }

    public class MetricsDto
    {
        public double? TotalKmTarget { get; set; }
        public double? TotalKmCompleted { get; set; }
        public double? OverallProgressPercent { get; set; }
        public double? Spi { get; set; }
        public double? Cpi { get; set; }
        public decimal? TotalBudgetCost { get; set; }
        public decimal? TotalActualCost { get; set; }
        public int? DelayedSectionsCount { get; set; }
        public DateTime? CalculatedAt { get; set; }
    }

    public class IssueDto
    {
        public string Level { get; set; } = "info";
        public string Code { get; set; } = string.Empty;
        public string Message { get; set; } = string.Empty;
        public string? Sheet { get; set; }
        public int? Row { get; set; }
        public string? Field { get; set; }
    }

    // ---------------------------------------------------------------- results

    public class ImportResultDto
    {
        public long BatchId { get; set; }
        public string Status { get; set; } = "running";
        public string Mode { get; set; } = "incremental";
        public bool AlreadyImported { get; set; }
        public int RowsInserted { get; set; }
        public int RowsUpdated { get; set; }
        public int RowsUnchanged { get; set; }
        public int RowsRejected { get; set; }
        public int RowsSuperseded { get; set; }
        public int BindingsWritten { get; set; }
        public int ErrorCount { get; set; }
        public int WarningCount { get; set; }
        public string? FailureMessage { get; set; }
        public DateTime StartedAt { get; set; }
        public DateTime? CompletedAt { get; set; }
    }

    // ---------------------------------------------------------------- IFC upload

    public class IfcModelMetadataDto
    {
        public string? SchemaName { get; set; }
        public string? LengthUnit { get; set; }
        public double? SiteLatitude { get; set; }
        public double? SiteLongitude { get; set; }
        public double? SiteElevationM { get; set; }
        public int ElementCount { get; set; }
        public double? CorridorLengthM { get; set; }
        public double? CorridorWidthM { get; set; }

        public List<IfcElementDto> Elements { get; set; } = new();
        public List<IfcGroupDto> Groups { get; set; } = new();
        public List<IfcSegmentDto> Segments { get; set; } = new();
        public List<IfcModelLayerDto> Layers { get; set; } = new();
    }

    public class IfcElementDto
    {
        public string GlobalId { get; set; } = string.Empty;
        public int ExpressId { get; set; }
        public string? Name { get; set; }
        public string? IfcType { get; set; }
        public string? LayerName { get; set; }
        public string? LayerCode { get; set; }
        public int? SegmentIndex { get; set; }
        public double[]? BboxMin { get; set; }
        public double[]? BboxMax { get; set; }
    }

    public class IfcGroupDto
    {
        public string GlobalId { get; set; } = string.Empty;
        public string? Name { get; set; }
        public string? IfcType { get; set; }
        public List<string> MemberGlobalIds { get; set; } = new();
    }

    public class IfcSegmentDto
    {
        public int SegmentIndex { get; set; }
        public double StartM { get; set; }
        public double EndM { get; set; }
        public double CentreM { get; set; }
        public int ElementCount { get; set; }
    }

    public class IfcModelLayerDto
    {
        public string LayerName { get; set; } = string.Empty;
        public string? LayerCode { get; set; }
        public decimal ThicknessMm { get; set; }
        public string? MaterialType { get; set; }
        public int SortOrder { get; set; }
    }
}
