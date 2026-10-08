using System;
using System.Collections.Generic;

namespace RoadBimBackend.Models
{
    public static class ImportMode
    {
        public const string Incremental = "incremental";
        public const string Replace = "replace";
    }

    public static class ImportStatus
    {
        public const string Running = "running";
        public const string Succeeded = "succeeded";
        public const string Failed = "failed";
    }

    /// <summary>
    /// One row per import attempt. Written and committed as 'running' before any data is
    /// touched, so a crash leaves a visible failed batch rather than silence.
    /// </summary>
    public class ImportBatch
    {
        public long Id { get; set; }

        public int ProjectId { get; set; }
        public Project? Project { get; set; }

        /// <summary>Which package's workbooks these were. An import never spans two.</summary>
        public int PackageId { get; set; }
        public Package? Package { get; set; }

        public string Mode { get; set; } = ImportMode.Incremental;
        public string Status { get; set; } = ImportStatus.Running;

        /// <summary>Hash over the sorted set of member-file hashes — the file-level idempotency key.</summary>
        public string ContentSha256 { get; set; } = string.Empty;

        public int RowsInserted { get; set; }
        public int RowsUpdated { get; set; }

        /// <summary>
        /// Deliberately separate from RowsUpdated: re-importing an identical workbook must
        /// report "0 updated, N unchanged", which is the visible proof of idempotency.
        /// </summary>
        public int RowsUnchanged { get; set; }
        public int RowsRejected { get; set; }
        public int RowsSuperseded { get; set; }
        public int BindingsWritten { get; set; }

        public int ErrorCount { get; set; }
        public int WarningCount { get; set; }

        public DateTime StartedAt { get; set; } = DateTime.UtcNow;
        public DateTime? CompletedAt { get; set; }
        public int? ImportedByUserId { get; set; }
        public string? FailureMessage { get; set; }

        /// <summary>The client-side validation counts, stored verbatim as jsonb.</summary>
        public string Summary { get; set; } = "{}";

        public List<ImportBatchFile> Files { get; set; } = new();
        public List<ImportIssue> Issues { get; set; } = new();
    }

    public class ImportBatchFile
    {
        public long Id { get; set; }

        public long ImportBatchId { get; set; }
        public ImportBatch? ImportBatch { get; set; }

        public string FileName { get; set; } = string.Empty;
        public string SheetName { get; set; } = string.Empty;

        /// <summary>CHAINAGES | LAYERS | PROGRESS | METRICS | LEGACY_PROGRESS | UNKNOWN</summary>
        public string SheetKind { get; set; } = "UNKNOWN";

        public int RowCount { get; set; }
        public string ContentSha256 { get; set; } = string.Empty;
        public long ByteSize { get; set; }

        /// <summary>Where the original workbook was archived, if it was uploaded.</summary>
        public string? StoragePath { get; set; }
    }

    /// <summary>
    /// One row per validator message, so the Phase 1/2 report survives a refresh instead of
    /// living only in React state.
    /// </summary>
    public class ImportIssue
    {
        public long Id { get; set; }

        public long ImportBatchId { get; set; }
        public ImportBatch? ImportBatch { get; set; }

        /// <summary>error | warning | info</summary>
        public string Level { get; set; } = "info";

        public string Code { get; set; } = string.Empty;
        public string Message { get; set; } = string.Empty;
        public string? SheetName { get; set; }
        public int? RowNumber { get; set; }
        public string? FieldName { get; set; }
    }

    public static class BindingStrategy
    {
        public const string Guid = "guid";
        public const string Group = "group";
        public const string Position = "position";
        public const string Name = "name";
    }

    /// <summary>
    /// One row per (progress record, bound element). A group match therefore writes one row
    /// per member, which is exactly what per-element tinting needs.
    /// </summary>
    public class ProgressIfcBinding
    {
        public long Id { get; set; }

        public int LayerProgressId { get; set; }
        public LayerProgress? LayerProgress { get; set; }

        public long IfcModelId { get; set; }
        public IfcModel? IfcModel { get; set; }

        /// <summary>The element actually bound.</summary>
        public string IfcElementGlobalId { get; set; } = string.Empty;

        /// <summary>The LayerId cell that produced the match — an element or a group GUID.</summary>
        public string? SourceRef { get; set; }

        /// <summary>element | group | none</summary>
        public string? SourceRefKind { get; set; }

        /// <summary>guid | group | position | name</summary>
        public string Strategy { get; set; } = BindingStrategy.Guid;

        /// <summary>exact | high | medium</summary>
        public string? Confidence { get; set; }

        public int? SegmentIndex { get; set; }

        public DateTime BoundAt { get; set; } = DateTime.UtcNow;
        public long? BoundByBatchId { get; set; }
    }
}
