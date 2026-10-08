using System;
using System.Collections.Generic;

namespace RoadBimBackend.Models
{
    /// <summary>
    /// RFI means **Request for Inspection**: the contractor notifies the engineer that work
    /// is ready to be checked before it is covered up or built over.
    ///
    /// From phase 3 this is the only source of build status. The map is coloured by what an
    /// inspection found, never by a figure typed into a spreadsheet — so a green chainage
    /// means someone stood on it and passed it.
    /// </summary>
    public static class RfiStatus
    {
        /// <summary>Editable. Carries no number that anyone outside has seen.</summary>
        public const string Draft = "draft";

        /// <summary>Raised. The clock against the package's notice period starts here.</summary>
        public const string Submitted = "submitted";

        /// <summary>A visit happened and recorded a verdict. Phase 3.</summary>
        public const string Inspected = "inspected";

        /// <summary>A second person signed the verdict off. Phase 3.</summary>
        public const string Approved = "approved";

        /// <summary>Refused. Stays refused until a later visit passes. Phase 3.</summary>
        public const string Rejected = "rejected";

        /// <summary>Withdrawn before inspection. Kept, never deleted.</summary>
        public const string Cancelled = "cancelled";

        public static readonly string[] All =
            { Draft, Submitted, Inspected, Approved, Rejected, Cancelled };

        /// <summary>Nothing further can happen to these.</summary>
        public static bool IsClosed(string status) =>
            status is Approved or Cancelled;
    }

    /// <summary>The inspecting engineer's verdict on a visit. Independent of status.</summary>
    public static class RfiOutcome
    {
        public const string Pass = "pass";
        public const string Fail = "fail";
        public static readonly string[] All = { Pass, Fail };
    }

    public static class RfiSide
    {
        public const string Lhs = "LHS";
        public const string Rhs = "RHS";
        public const string Both = "both";
        public const string NotApplicable = "na";
        public static readonly string[] All = { Lhs, Rhs, Both, NotApplicable };
    }

    /// <summary>
    /// One request for inspection, against one package and one stretch of chainage.
    /// </summary>
    public class Rfi
    {
        public long Id { get; set; }

        public int ProjectId { get; set; }
        public Project? Project { get; set; }

        public int PackageId { get; set; }
        public Package? Package { get; set; }

        /// <summary>
        /// Minted inside the raise transaction, never before: a number that appears on a
        /// draft and then changes is a number somebody has already written down.
        /// Format comes from <see cref="NumberSeries"/> — RFI/28082026/CW1-1/18.
        /// </summary>
        public string RfiNo { get; set; } = string.Empty;

        public string Title { get; set; } = string.Empty;
        public string? Description { get; set; }

        // ---- what work -------------------------------------------------------

        /// <summary>
        /// The pavement layer being offered, from the package's own catalogue. Optional: an
        /// RFI that names no layer offers the whole cross-section at that chainage, which is
        /// how a field engineer is usually given a complete stretch.
        ///
        /// This is what the projection writes progress against, so it decides which layers
        /// change colour on the map. Nothing else does.
        /// </summary>
        public int? LayerId { get; set; }
        public RoadLayer? Layer { get; set; }

        /// <summary>
        /// BOQ bill item and sub-item — free text, and deliberately inert.
        ///
        /// There is no bill of quantities in this system yet. These carry whatever
        /// reference the contract uses so the shape of a priced RFI is visible, and so
        /// wiring a real BOQ in later is a matter of replacing free text with a lookup
        /// rather than adding fields to a live table. They bind to nothing, drive nothing,
        /// and are never read by the projection: a BOQ line is a commercial fact, and what
        /// the map draws is a physical one.
        /// </summary>
        public string? ComponentRef { get; set; }
        public string? SubComponentRef { get; set; }

        /// <summary>Optional. The chainage range already states the extent of the work.</summary>
        public double? Quantity { get; set; }

        // ---- where -----------------------------------------------------------

        /// <summary>
        /// The chainage rows this RFI covers, inclusive. These are FOREIGN KEYS, not loose
        /// metres: chainages are fixed by the model and the workbook, so an RFI can only
        /// ever name partitions that exist. That is also what lets phase 3 colour the map
        /// without inventing a second matching strategy — the chainage is already the
        /// resolver's own key.
        /// </summary>
        public int ChainageFromId { get; set; }
        public RoadChainage? ChainageFrom { get; set; }

        public int ChainageToId { get; set; }
        public RoadChainage? ChainageTo { get; set; }

        /// <summary>Denormalised from the chainage rows, for range filters and display.</summary>
        public double ChainageFromM { get; set; }
        public double ChainageToM { get; set; }

        public string? LocationText { get; set; }

        /// <summary>LHS | RHS | both | na</summary>
        public string Side { get; set; } = RfiSide.NotApplicable;

        // ---- routing ---------------------------------------------------------

        public int? RaisedByUserId { get; set; }
        public User? RaisedByUser { get; set; }

        /// <summary>
        /// The engineer expected to inspect. Set from the register or the detail view, not
        /// a module of its own. Null means nobody has picked it up yet.
        /// </summary>
        public int? AssignedToUserId { get; set; }
        public User? AssignedToUser { get; set; }

        // ---- lifecycle -------------------------------------------------------

        public string Status { get; set; } = RfiStatus.Draft;

        /// <summary>pass | fail on the latest visit. Written in phase 3.</summary>
        public string? Outcome { get; set; }

        public DateTime? SubmittedAt { get; set; }

        /// <summary>The slot the contractor asked for, if they stated one.</summary>
        public DateTime? RequiredInspectionAt { get; set; }

        /// <summary>
        /// From the contract: submission plus the package's notice period, unless the
        /// raiser named a slot. Computed once on submit and stored, so "overdue" cannot
        /// drift when someone edits the package later.
        /// </summary>
        public DateTime? DueAt { get; set; }

        public DateTime? InspectedAt { get; set; }
        public int? InspectedByUserId { get; set; }
        public User? InspectedByUser { get; set; }
        public DateTime? ApprovedAt { get; set; }
        public int? ApprovedByUserId { get; set; }
        public User? ApprovedByUser { get; set; }
        public DateTime? CancelledAt { get; set; }

        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
        public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;

        public List<RfiEvent> Events { get; set; } = new();
    }

    /// <summary>
    /// Append-only audit of everything that happened to an RFI. The detail view's timeline
    /// renders straight from this, so what the screen shows and what the record says cannot
    /// come apart.
    /// </summary>
    public class RfiEvent
    {
        public long Id { get; set; }

        public long RfiId { get; set; }
        public Rfi? Rfi { get; set; }

        /// <summary>created | submitted | assigned | inspected | approved | rejected | cancelled</summary>
        public string EventType { get; set; } = string.Empty;

        public string? FromStatus { get; set; }
        public string? ToStatus { get; set; }

        public int? ActorUserId { get; set; }
        public User? ActorUser { get; set; }

        public string? Comment { get; set; }

        public DateTime OccurredAt { get; set; } = DateTime.UtcNow;
    }

    /// <summary>
    /// Document numbering, ported from the MoRTM platform.
    ///
    /// A number like RFI/28082026/CW1-1/18 is a PATTERN — prefix, date part, package code,
    /// padded counter with a reset cycle — not a bare sequence. People read meaning into
    /// it, so the format is configuration rather than a hardcoded string in a controller.
    /// </summary>
    public class NumberSeries
    {
        public int Id { get; set; }

        /// <summary>rfi, today. Other document types can share the mechanism later.</summary>
        public string EntityType { get; set; } = "rfi";

        /// <summary>A package-level series wins over a project-level fallback.</summary>
        public int? PackageId { get; set; }
        public Package? Package { get; set; }

        public int? ProjectId { get; set; }
        public Project? Project { get; set; }

        public string Prefix { get; set; } = "RFI";

        /// <summary>Tokens: {PREFIX} {DDMMYYYY} {YYYY} {YY} {MM} {PACKAGE} {SEQ}.</summary>
        public string Pattern { get; set; } = "{PREFIX}/{DDMMYYYY}/{PACKAGE}/{SEQ}";

        public int SeqPadding { get; set; } = 2;

        /// <summary>never | daily | monthly | yearly</summary>
        public string ResetCycle { get; set; } = "never";

        public long CurrentSeq { get; set; }
        public DateTime? LastResetOn { get; set; }

        public bool IsActive { get; set; } = true;
        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    }

    public static class NumberSeriesReset
    {
        public const string Never = "never";
        public const string Daily = "daily";
        public const string Monthly = "monthly";
        public const string Yearly = "yearly";
        public static readonly string[] All = { Never, Daily, Monthly, Yearly };
    }
}
