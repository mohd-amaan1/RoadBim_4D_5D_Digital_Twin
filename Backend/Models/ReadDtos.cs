using System;

namespace RoadBimBackend.Models
{
    /// <summary>
    /// Row shapes shared by the project-wide and package-scoped read endpoints.
    ///
    /// These exist as real types rather than anonymous objects for one reason: the two
    /// controllers must return *identical* shapes, because the client merges a project read
    /// and a package read without caring which it got. Anonymous types cannot be returned
    /// from a shared method, and routing them through a helper that takes a
    /// <c>DbContext</c> is worse — EF cannot translate a method call inside
    /// <c>Select</c> into SQL, and the query fails at runtime rather than at build.
    ///
    /// Serialised camelCase by the MVC defaults, matching what the client already reads.
    /// </summary>
    public class ChainageRowDto
    {
        /// <summary>The workbook's own Id where there is one, else the database id.</summary>
        public int Id { get; set; }
        public int DbId { get; set; }
        public int PackageId { get; set; }
        public double ChainageStart { get; set; }
        public double ChainageEnd { get; set; }
        public string KmLabel { get; set; } = string.Empty;
        public string SectionName { get; set; } = string.Empty;
        public double Latitude { get; set; }
        public double Longitude { get; set; }
        public double ElevationM { get; set; }
        public string TerrainType { get; set; } = string.Empty;
        public int? SortOrder { get; set; }
    }

    public class LayerRowDto
    {
        public int Id { get; set; }
        public int PackageId { get; set; }
        public string Code { get; set; } = string.Empty;
        public string LayerName { get; set; } = string.Empty;
        public int CatalogueThicknessMm { get; set; }
        public string MaterialType { get; set; } = string.Empty;
        public string DefaultColorHex { get; set; } = string.Empty;
        public int SortOrder { get; set; }
    }

    /// <summary>
    /// Progress in the shape the client's importer produces, so a restored session is the
    /// same object a fresh import built.
    /// </summary>
    public class ProgressRowDto
    {
        public int Id { get; set; }
        public string? Key { get; set; }
        public int PackageId { get; set; }
        public int ChainageId { get; set; }
        public int ChainageDbId { get; set; }
        public string LayerCode { get; set; } = string.Empty;
        public string LayerNameInSheet { get; set; } = string.Empty;
        public string? IfcRef { get; set; }
        public string Status { get; set; } = string.Empty;
        public string? RawStatus { get; set; }
        public double ProgressPercent { get; set; }
        public DateTime PlannedStartDate { get; set; }
        public DateTime PlannedEndDate { get; set; }
        public DateTime? ActualStartDate { get; set; }
        public DateTime? ActualEndDate { get; set; }
        public decimal BudgetCost { get; set; }
        public decimal ActualCost { get; set; }
        public decimal CostVariance { get; set; }
        public int DelayDays { get; set; }
        public int? ExcelDesignThicknessMm { get; set; }
        public string? LevelColorHex { get; set; }
        public string UpdatedBy { get; set; } = string.Empty;
        public DateTime UpdatedAt { get; set; }
        public DateTime? SupersededAt { get; set; }

        /// <summary>none | rfi — who authored the live status. `rfi` means inspection-verified.</summary>
        public string Source { get; set; } = string.Empty;
        public long? SourceRfiId { get; set; }
    }

    /// <summary>Just enough of a model to say whether a package can be drawn.</summary>
    public class ActiveModelBriefDto
    {
        public long Id { get; set; }
        public string OriginalFileName { get; set; } = string.Empty;
        public int Version { get; set; }
        public int ElementCount { get; set; }
    }

    /// <summary>
    /// The package card. Carries the counts that answer "why is this package not on the
    /// map" before anyone has to go looking.
    /// </summary>
    public class PackageSummaryDto
    {
        public int Id { get; set; }
        public int ProjectId { get; set; }
        public string Code { get; set; } = string.Empty;
        public string Name { get; set; } = string.Empty;
        public string? Description { get; set; }
        public string ContractorName { get; set; } = string.Empty;
        public string? ContractNo { get; set; }
        public int? ChainageFromM { get; set; }
        public int? ChainageToM { get; set; }
        public int InspectionNoticeHours { get; set; }
        public string Status { get; set; } = string.Empty;
        public string? Module { get; set; }
        public int SortOrder { get; set; }
        public DateTime UpdatedAt { get; set; }

        public int ChainageCount { get; set; }
        public int LayerCount { get; set; }
        public int ProgressCount { get; set; }
        public ActiveModelBriefDto? ActiveModel { get; set; }
    }
}
