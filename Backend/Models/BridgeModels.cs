using System;

namespace RoadBimBackend.Models
{
    /// <summary>
    /// The inspection verdict a bridge register row carries, as far as the model's colour
    /// is concerned.
    ///
    /// Three values, not two: a row can name an element and still have no verdict yet, and
    /// that is a different fact from a refusal. The map draws approved green, rejected red,
    /// and leaves pending elements in their own material — "keep as it is".
    /// </summary>
    public static class BridgeApproval
    {
        public const string Approved = "approved";
        public const string Rejected = "rejected";
        public const string Pending = "pending";

        public static readonly string[] All = { Approved, Rejected, Pending };

        /// <summary>
        /// Anything that is not plainly approved or rejected is pending. The browser does the
        /// generous alias matching and reports what it could not read; this is the last line,
        /// and it only ever errs towards leaving an element uncoloured.
        /// </summary>
        public static string Normalise(string? value) =>
            (value ?? string.Empty).Trim().ToLowerInvariant() switch
            {
                Approved => Approved,
                Rejected => Rejected,
                _ => Pending,
            };
    }

    /// <summary>
    /// One row of a bridge progress register — a well lift, a pylon lift, a precast
    /// segment — as the site keeps it.
    ///
    /// Bridges do not fit the road tables. A road is chainage × pavement layer, and every
    /// row of LayerProgress is one cell of that grid; a bridge register is a flat list of
    /// activities, most of which name no model element at all. Forcing it into chainages
    /// and layers would invent partitions the structure does not have, so it gets a table
    /// of its own that says exactly what the sheet says.
    ///
    /// Only <see cref="IfcGlobalId"/> and <see cref="Approval"/> drive the model. Everything
    /// else is kept so the register can be read back as it was written — the RFI numbers
    /// and bill references are the audit trail behind the colour.
    /// </summary>
    public class BridgeItem
    {
        public int Id { get; set; }

        public int ProjectId { get; set; }
        public Project? Project { get; set; }

        public int PackageId { get; set; }
        public Package? Package { get; set; }

        /// <summary>
        /// The row's identity across re-imports: item number, location and remarks, which is
        /// what distinguishes "P8 - 5th Lift" from "P8 - 6th Lift". Built in the browser, and
        /// suffixed with an occurrence number when two rows would otherwise collide, so a
        /// register with a genuinely repeated line still imports rather than being refused.
        /// </summary>
        public string SourceKey { get; set; } = string.Empty;

        /// <summary>Position in the sheet, refreshed on every import so the order stays true.</summary>
        public int? SourceRowNumber { get; set; }

        public string? ItemNo { get; set; }
        public string? Description { get; set; }
        public string? Uom { get; set; }
        public string? Location { get; set; }
        public double? ExecutedQuantity { get; set; }

        /// <summary>RFI / letter numbers, one per line exactly as the cell listed them.</summary>
        public string? RfiRefs { get; set; }

        /// <summary>The dates beside them, one per line. Text — the sheet writes "8-Jan-25".</summary>
        public string? RfiDates { get; set; }

        public string? BillNo { get; set; }
        public string? Remarks { get; set; }

        /// <summary>
        /// The IFC element (or group) this row speaks for. Null for most rows — a well is
        /// modelled as a handful of columns but executed in twenty lifts, so only the lift
        /// that completes a modelled piece names it.
        /// </summary>
        public string? IfcGlobalId { get; set; }

        /// <summary>The Approval cell verbatim, before normalisation.</summary>
        public string? ApprovalText { get; set; }

        /// <summary>approved | rejected | pending — see <see cref="BridgeApproval"/>.</summary>
        public string Approval { get; set; } = BridgeApproval.Pending;

        public long? FirstImportBatchId { get; set; }
        public long? LastImportBatchId { get; set; }
        public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;

        /// <summary>
        /// Set when a later import no longer lists this row. Soft, like LayerProgress: an
        /// import never deletes, and a row that comes back is revived rather than duplicated.
        /// </summary>
        public DateTime? SupersededAt { get; set; }
    }
}
