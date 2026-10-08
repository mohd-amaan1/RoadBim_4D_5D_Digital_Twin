using System;
using System.Collections.Generic;

namespace RoadBimBackend.Models
{
    /// <summary>
    /// The tenancy boundary. Every road, layer, progress row, model and import hangs off
    /// a project, and all uniqueness is scoped to it — which is what lets one project use
    /// "BC" for the base course while another uses it for the bituminous wearing course.
    /// </summary>
    public class Project
    {
        public int Id { get; set; }

        /// <summary>URL-safe slug, unique platform-wide.</summary>
        public string Code { get; set; } = string.Empty;

        public string Name { get; set; } = string.Empty;
        public string? Description { get; set; }

        /// <summary>
        /// Which end of the model is chainage zero: 'auto' | 'ascending' | 'descending'.
        /// 'auto' keeps the resolver's own inference (GlobalId anchors, then IfcSite, then
        /// ascending); the other two settle it explicitly when the sources disagree.
        /// </summary>
        public string ChainageDirection { get; set; } = "auto";

        /// <summary>Free-form client / contract details. Stored as jsonb.</summary>
        public string Metadata { get; set; } = "{}";

        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
        public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
        public int? CreatedByUserId { get; set; }

        public List<ProjectMember> Members { get; set; } = new();
        public List<Package> Packages { get; set; } = new();
        public List<IfcModel> IfcModels { get; set; } = new();
        public List<ImportBatch> ImportBatches { get; set; } = new();
    }

    /// <summary>
    /// A contract package — CW1-1, CW1-2 — and the unit every piece of road data now hangs
    /// off. A project is let as several packages, each with its own contractor, its own
    /// stretch of chainage, its own workbooks and its own IFC model.
    ///
    /// Rows keep <c>ProjectId</c> alongside <c>PackageId</c> rather than reaching it through
    /// a join. That denormalisation is what lets the project map draw every package at once
    /// with a single indexed read, which is the whole point of splitting them up.
    /// </summary>
    public class Package
    {
        public int Id { get; set; }

        public int ProjectId { get; set; }
        public Project? Project { get; set; }

        /// <summary>Contract code — 'CW1-1'. Unique within the project, not platform-wide.</summary>
        public string Code { get; set; } = string.Empty;

        public string Name { get; set; } = string.Empty;
        public string? Description { get; set; }

        /// <summary>
        /// Captured once here rather than on every RFI. A package is let to one contractor;
        /// asking again on each inspection request is data entry with no extra information in it.
        /// </summary>
        public string ContractorName { get; set; } = string.Empty;

        public string? ContractNo { get; set; }

        /// <summary>Extent along the alignment, in metres. Advisory — the chainage rows are authoritative.</summary>
        public int? ChainageFromM { get; set; }
        public int? ChainageToM { get; set; }

        /// <summary>
        /// Contractual notice for an inspection. Phase 2 computes an RFI's due date from
        /// submission plus this, which is what makes "overdue" a contract fact rather than
        /// an opinion.
        /// </summary>
        public int InspectionNoticeHours { get; set; } = 24;

        /// <summary>planned | active | suspended | completed</summary>
        public string Status { get; set; } = PackageStatus.Active;

        /// <summary>
        /// Null for a road package. A named module (see <see cref="PackageModule"/>) puts the
        /// package on its own data path — the Palashbari bridge tracker reads four uploads,
        /// not chainages and layers.
        /// </summary>
        public string? Module { get; set; }

        public int SortOrder { get; set; }

        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
        public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
        public int? CreatedByUserId { get; set; }

        public List<IfcModel> IfcModels { get; set; } = new();
    }

    public static class PackageStatus
    {
        public const string Planned = "planned";
        public const string Active = "active";
        public const string Suspended = "suspended";
        public const string Completed = "completed";

        public static readonly string[] All = { Planned, Active, Suspended, Completed };
    }

    public class IfcModel
    {
        public long Id { get; set; }

        public int ProjectId { get; set; }
        public Project? Project { get; set; }

        public int PackageId { get; set; }
        public Package? Package { get; set; }

        public int Version { get; set; }
        public string OriginalFileName { get; set; } = string.Empty;

        /// <summary>Path on disk. The IFC bytes are never stored in the database.</summary>
        public string StoragePath { get; set; } = string.Empty;

        /// <summary>Identity of the file; re-uploading the same bytes is a no-op.</summary>
        public string ContentSha256 { get; set; } = string.Empty;
        public long ByteSize { get; set; }

        public string? SchemaName { get; set; }
        public string? LengthUnit { get; set; }
        public double? SiteLatitude { get; set; }
        public double? SiteLongitude { get; set; }
        public double? SiteElevationM { get; set; }
        public int ElementCount { get; set; }
        public double? CorridorLengthM { get; set; }
        public double? CorridorWidthM { get; set; }

        /// <summary>At most one active model per project, enforced by a partial index.</summary>
        public bool IsActive { get; set; } = true;

        public DateTime UploadedAt { get; set; } = DateTime.UtcNow;
        public int? UploadedByUserId { get; set; }

        public List<IfcElement> Elements { get; set; } = new();
        public List<IfcGroup> Groups { get; set; } = new();
        public List<IfcSegment> Segments { get; set; } = new();
        public List<IfcModelLayer> ModelLayers { get; set; } = new();
    }

    /// <summary>
    /// What the parser read out of the file. Extraction, not computation — nothing here is
    /// derived from other database rows.
    /// </summary>
    public class IfcElement
    {
        public long Id { get; set; }

        public long IfcModelId { get; set; }
        public IfcModel? IfcModel { get; set; }

        /// <summary>22-character IFC GUID. Stable across re-exports; the binding key.</summary>
        public string GlobalId { get; set; } = string.Empty;

        /// <summary>IFC line number. Advisory only — it changes when a model is re-exported.</summary>
        public int ExpressId { get; set; }

        public string? Name { get; set; }
        public string? IfcType { get; set; }
        public string? LayerName { get; set; }
        public string? LayerCode { get; set; }
        public int? SegmentIndex { get; set; }

        public double? BboxMinX { get; set; }
        public double? BboxMinY { get; set; }
        public double? BboxMinZ { get; set; }
        public double? BboxMaxX { get; set; }
        public double? BboxMaxY { get; set; }
        public double? BboxMaxZ { get; set; }

        public List<IfcGroupMember> GroupMemberships { get; set; } = new();
    }

    /// <summary>
    /// Revit model groups. A progress row addresses a multi-element layer through one of
    /// these — the surface course is two lane slabs per segment.
    /// </summary>
    public class IfcGroup
    {
        public long Id { get; set; }

        public long IfcModelId { get; set; }
        public IfcModel? IfcModel { get; set; }

        public string GlobalId { get; set; } = string.Empty;
        public string? Name { get; set; }
        public string? IfcType { get; set; }

        public List<IfcGroupMember> Members { get; set; } = new();
    }

    public class IfcGroupMember
    {
        public long IfcGroupId { get; set; }
        public IfcGroup? IfcGroup { get; set; }

        public long IfcElementId { get; set; }
        public IfcElement? IfcElement { get; set; }
    }

    /// <summary>Construction segments recovered by clustering element centres along the alignment.</summary>
    public class IfcSegment
    {
        public long Id { get; set; }

        public long IfcModelId { get; set; }
        public IfcModel? IfcModel { get; set; }

        public int SegmentIndex { get; set; }
        public double StartM { get; set; }
        public double EndM { get; set; }
        public double CentreM { get; set; }
        public int ElementCount { get; set; }
    }

    /// <summary>
    /// IfcMaterialLayerSet thicknesses. This is the winning input to the thickness
    /// precedence rule — the model outranks both the sheet override and the catalogue.
    /// </summary>
    public class IfcModelLayer
    {
        public long Id { get; set; }

        public long IfcModelId { get; set; }
        public IfcModel? IfcModel { get; set; }

        public string LayerName { get; set; } = string.Empty;
        public string? LayerCode { get; set; }
        public decimal ThicknessMm { get; set; }
        public string? MaterialType { get; set; }
        public int SortOrder { get; set; }
    }
}
