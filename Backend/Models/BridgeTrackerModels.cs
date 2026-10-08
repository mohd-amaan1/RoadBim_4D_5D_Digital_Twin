using System;

namespace RoadBimBackend.Models
{
    /// <summary>
    /// What a package is, beyond being a road package. Null is the ordinary case: chainages,
    /// layers and progress workbooks. A named module switches the package onto a different
    /// data path and a different screen.
    /// </summary>
    public static class PackageModule
    {
        /// <summary>
        /// The Palashbari–Sualkuchi extradosed bridge RFI tracker: an IFC model, a mapping
        /// register, the monthly IPC workbooks and an alignment, read in the browser.
        /// </summary>
        public const string PalashbariTracker = "palashbari-tracker";

        public static readonly string[] All = { PalashbariTracker };

        /// <summary>Null for blank; the canonical value for a known module; otherwise null too.</summary>
        public static string? Normalise(string? value)
        {
            var v = (value ?? string.Empty).Trim().ToLowerInvariant();
            return Array.IndexOf(All, v) >= 0 ? v : null;
        }
    }

    /// <summary>The four uploads the tracker is built from.</summary>
    public static class BridgeTrackerFileKind
    {
        /// <summary>The Revit IFC export. Replaced when the model is revised.</summary>
        public const string Ifc = "ifc";

        /// <summary>The Element_Register workbook: Element_Key ↔ IFC_GlobalId.</summary>
        public const string Register = "register";

        /// <summary>A monthly IPC measurement workbook. Kept as history, never replaced.</summary>
        public const string Ipc = "ipc";

        /// <summary>
        /// The alignment, already reduced in the browser from the KMZ to a compact local
        /// frame (JSON). A 20 MB KML becomes about 1 MB, and only that is ever read back.
        /// </summary>
        public const string Alignment = "alignment";

        public static readonly string[] All = { Ifc, Register, Ipc, Alignment };
    }

    /// <summary>
    /// One upload to a tracker package. The bytes live on disk under their own hash; this
    /// row is the pointer, the provenance and, for an IPC, the bill it carries.
    ///
    /// The model, register and alignment each have one current file: uploading a new one
    /// supersedes the old, which stays on disk and in this table. IPC workbooks are never
    /// superseded — each month is kept, so the tracker can compare one bill with the last.
    /// </summary>
    public class BridgeTrackerFile
    {
        public long Id { get; set; }

        public int ProjectId { get; set; }
        public Project? Project { get; set; }

        public int PackageId { get; set; }
        public Package? Package { get; set; }

        /// <summary>ifc | register | ipc | alignment — see <see cref="BridgeTrackerFileKind"/>.</summary>
        public string Kind { get; set; } = string.Empty;

        public string OriginalFileName { get; set; } = string.Empty;
        public string ContentSha256 { get; set; } = string.Empty;
        public long ByteSize { get; set; }

        /// <summary>Path on disk. The bytes are never stored in the database.</summary>
        public string StoragePath { get; set; } = string.Empty;

        /// <summary>"IPC - 34", read from Schedule 4 in the browser. IPC files only.</summary>
        public string? Bill { get; set; }

        /// <summary>"1st Jul'26 to 31st Jul'26", as the sheet writes it. IPC files only.</summary>
        public string? Period { get; set; }

        public DateTime UploadedAt { get; set; } = DateTime.UtcNow;
        public int? UploadedByUserId { get; set; }
        public User? UploadedBy { get; set; }

        /// <summary>Set when a newer file of the same kind replaced this one. Never set on an IPC.</summary>
        public DateTime? SupersededAt { get; set; }
    }

    /// <summary>
    /// The tracker's per-package settings, and which IPC the team is looking at. One row per
    /// package, created on first write.
    /// </summary>
    public class BridgeTrackerConfig
    {
        public int PackageId { get; set; }
        public Package? Package { get; set; }

        /// <summary>
        /// The tracker's settings document — rules switched on or off, thresholds, the P6
        /// chainage, which modules to draw. Opaque to the server: the browser owns its shape.
        /// </summary>
        public string ConfigJson { get; set; } = "{}";

        /// <summary>
        /// The IPC that is "current". Usually the latest upload; null until one is uploaded.
        /// A reference, not a cascade: deleting the file clears this rather than the row.
        /// </summary>
        public long? ActiveIpcFileId { get; set; }
        public BridgeTrackerFile? ActiveIpcFile { get; set; }

        public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
        public int? UpdatedByUserId { get; set; }
    }
}
