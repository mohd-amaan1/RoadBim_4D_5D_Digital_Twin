using System;
using System.Collections.Generic;

namespace RoadBimBackend.Models
{
    /// <summary>
    /// One inspection VISIT.
    ///
    /// There can be several per RFI: a rejection sends the work back, and the next visit is
    /// <c>VisitNo + 1</c> on the same record. The failed visit is kept, never replaced —
    /// the history of what was refused and why is the point of the control.
    ///
    /// The RFI header mirrors the LATEST visit's outcome, which is what the register reads.
    /// </summary>
    public class RfiInspection
    {
        public long Id { get; set; }

        public long RfiId { get; set; }
        public Rfi? Rfi { get; set; }

        /// <summary>1, 2, 3… per RFI. The sequence IS the re-inspection history.</summary>
        public int VisitNo { get; set; } = 1;

        public int InspectedByUserId { get; set; }
        public User? InspectedByUser { get; set; }

        public DateTime InspectedAt { get; set; } = DateTime.UtcNow;

        /// <summary>pass | fail — the verdict that decides the colour on the map.</summary>
        public string Outcome { get; set; } = RfiOutcome.Pass;

        public string? Remarks { get; set; }

        /// <summary>
        /// Where the submitting DEVICE was, straight from the browser's geolocation.
        ///
        /// Evidence of presence, and a different fact from where the contractor said the
        /// work is: that comes from the chainage row. Recording both is what lets an
        /// inspection be checked rather than taken on trust.
        /// </summary>
        public double? DeviceLatitude { get; set; }
        public double? DeviceLongitude { get; set; }

        /// <summary>Metres of uncertainty the browser reported. A bad fix stays visible.</summary>
        public double? LocationAccuracyM { get; set; }

        /// <summary>web | mobile</summary>
        public string Source { get; set; } = "web";

        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

        public List<RfiAttachment> Attachments { get; set; } = new();
    }

    /// <summary>
    /// A photo attached to an RFI or to one of its visits.
    ///
    /// Bytes live on disk under Storage/rfi-photos, following the pattern the IFC files
    /// already use; only the path and the identifying hash go in the database. A photo is
    /// evidence, so the same image uploaded twice is stored once and referenced twice.
    /// </summary>
    public class RfiAttachment
    {
        public long Id { get; set; }

        public long RfiId { get; set; }
        public Rfi? Rfi { get; set; }

        /// <summary>Null for an RFI-level photo; set for evidence from a specific visit.</summary>
        public long? RfiInspectionId { get; set; }
        public RfiInspection? RfiInspection { get; set; }

        public string FileName { get; set; } = string.Empty;
        public string ContentType { get; set; } = "image/jpeg";
        public long ByteSize { get; set; }

        /// <summary>Path on disk. The bytes are never stored in the database.</summary>
        public string StoragePath { get; set; } = string.Empty;
        public string ContentSha256 { get; set; } = string.Empty;

        public string? Caption { get; set; }

        public int? UploadedByUserId { get; set; }
        public User? UploadedByUser { get; set; }
        public DateTime UploadedAt { get; set; } = DateTime.UtcNow;
    }

    /// <summary>
    /// Whether a <see cref="LayerProgress"/> row's status has been decided yet.
    ///
    /// There is no "import" value. An import cannot set a live status at all — it writes
    /// the baseline instead — so the only two states a cell can be in are "nobody has
    /// inspected this" and "an inspection said so".
    /// </summary>
    public static class ProgressSource
    {
        /// <summary>No verdict yet. The map draws the cell as un-offered.</summary>
        public const string None = "none";

        /// <summary>An inspection decided it. The only way a cell gets a colour.</summary>
        public const string Rfi = "rfi";

        public static readonly string[] All = { None, Rfi };
    }
}
