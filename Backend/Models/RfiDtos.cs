using System;
using System.Collections.Generic;

namespace RoadBimBackend.Models
{
    /// <summary>
    /// One selectable chainage on the raise form.
    ///
    /// The form offers a LIST, never two number boxes. Chainages are fixed by the model and
    /// the workbook — the app can partition and colour them but cannot invent one — so a
    /// typed value could land between two partitions where nothing can be tinted.
    /// </summary>
    public class ChainageOptionDto
    {
        /// <summary>Database id. This is what the RFI stores.</summary>
        public int Id { get; set; }

        /// <summary>The workbook's own number, for display alongside the label.</summary>
        public int? SourceId { get; set; }

        public double StartM { get; set; }
        public double EndM { get; set; }

        /// <summary>`km 7+200 – 7+800` — built server-side so every screen reads alike.</summary>
        public string Label { get; set; } = string.Empty;

        public string? SectionName { get; set; }
        public double? Latitude { get; set; }
        public double? Longitude { get; set; }

        /// <summary>excel | ifc — where this partition came from.</summary>
        public string Source { get; set; } = "excel";
    }

    /// <summary>
    /// A pavement layer the package carries — the thing an RFI can be raised against, and
    /// the thing the map colours. Not to be confused with the BOQ component fields, which
    /// are free text and inert.
    /// </summary>
    public class LayerOptionDto
    {
        public int Id { get; set; }
        public string Code { get; set; } = string.Empty;
        public string Name { get; set; } = string.Empty;
        public int SortOrder { get; set; }
    }

    /// <summary>Everything the raise form needs, in one request.</summary>
    public class RfiFormOptionsDto
    {
        public int PackageId { get; set; }
        public string PackageCode { get; set; } = string.Empty;
        public string PackageName { get; set; } = string.Empty;

        /// <summary>Filled from the package, read-only on the form.</summary>
        public string ContractorName { get; set; } = string.Empty;

        /// <summary>What the next number will look like. A preview, not a reservation.</summary>
        public string NextRfiNo { get; set; } = string.Empty;

        public int InspectionNoticeHours { get; set; }

        public List<ChainageOptionDto> Chainages { get; set; } = new();
        /// <summary>The pavement layers an RFI can be raised against.</summary>
        public List<LayerOptionDto> Layers { get; set; } = new();
        public List<RfiEngineerDto> Engineers { get; set; } = new();
    }

    /// <summary>A project member who can be assigned an inspection.</summary>
    public class RfiEngineerDto
    {
        public int UserId { get; set; }
        public string DisplayName { get; set; } = string.Empty;
        public string Email { get; set; } = string.Empty;
        public string Role { get; set; } = string.Empty;

        /// <summary>Workload hint shown beside the name in the picker.</summary>
        public int OpenAssignedCount { get; set; }
    }

    /// <summary>The register card.</summary>
    public class RfiCardDto
    {
        public long Id { get; set; }
        public string RfiNo { get; set; } = string.Empty;
        public string Title { get; set; } = string.Empty;

        public int ProjectId { get; set; }
        public string ProjectCode { get; set; } = string.Empty;
        public int PackageId { get; set; }
        public string PackageCode { get; set; } = string.Empty;
        public string PackageName { get; set; } = string.Empty;
        public string ContractorName { get; set; } = string.Empty;

        public string Status { get; set; } = string.Empty;

        /// <summary>Render as given — do not rebuild it client-side.</summary>
        public string StatusLabel { get; set; } = string.Empty;

        /// <summary>The chip's machine-readable half, and what the Status filter sends back.</summary>
        public string StageKey { get; set; } = string.Empty;
        public string? Outcome { get; set; }

        /// <summary>The pavement layer, or null for the whole cross-section.</summary>
        public string? LayerCode { get; set; }
        public string? LayerName { get; set; }

        /// <summary>BOQ references. Display only — they bind to nothing.</summary>
        public string? ComponentRef { get; set; }
        public string? SubComponentRef { get; set; }
        public double? Quantity { get; set; }

        public string ChainageLabel { get; set; } = string.Empty;
        public double ChainageFromM { get; set; }
        public double ChainageToM { get; set; }
        public string? LocationText { get; set; }
        public string Side { get; set; } = string.Empty;

        public string? RaisedByName { get; set; }
        public string? AssignedToName { get; set; }
        public int? AssignedToUserId { get; set; }

        /// <summary>Who actually recorded the latest visit — not necessarily the assignee.</summary>
        public string? InspectedByName { get; set; }
        public string? ApprovedByName { get; set; }

        public DateTime? SubmittedAt { get; set; }
        public DateTime? DueAt { get; set; }
        public DateTime? InspectedAt { get; set; }
        public DateTime? ApprovedAt { get; set; }

        /// <summary>Computed server-side. Never re-derive it from DueAt and the clock.</summary>
        public bool IsOverdue { get; set; }

        public DateTime CreatedAt { get; set; }
    }

    public class RfiEventDto
    {
        public string EventType { get; set; } = string.Empty;
        public string? FromStatus { get; set; }
        public string? ToStatus { get; set; }
        public string? ActorName { get; set; }
        public string? Comment { get; set; }
        public DateTime OccurredAt { get; set; }
    }

    public class RfiDetailDto
    {
        public RfiCardDto Header { get; set; } = new();
        public string? Description { get; set; }
        public DateTime? RequiredInspectionAt { get; set; }
        public DateTime? CancelledAt { get; set; }

        /// <summary>Which verbs the caller may use right now, so the UI offers no dead button.</summary>
        public List<string> AllowedActions { get; set; } = new();

        public List<RfiEventDto> Events { get; set; } = new();

        /// <summary>Where the work is, for the detail map. Null when the chainages carry none.</summary>
        public double? Latitude { get; set; }
        public double? Longitude { get; set; }
    }

    public class RfiListDto
    {
        public List<RfiCardDto> Items { get; set; } = new();
        public int Total { get; set; }
        public int Page { get; set; }
        public int PageSize { get; set; }

        /// <summary>Counts per stage across the WHOLE filtered set, not just this page.</summary>
        public Dictionary<string, int> StageCounts { get; set; } = new();
    }
}
