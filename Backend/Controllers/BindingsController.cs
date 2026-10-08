using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using RoadBimBackend.Data;
using RoadBimBackend.Models;
using RoadBimBackend.Services;

namespace RoadBimBackend.Controllers
{
    public class RebindRequest
    {
        public long IfcModelId { get; set; }
        public List<RebindRow> Bindings { get; set; } = new();
    }

    public class RebindRow
    {
        /// <summary>Either the progress row's database id…</summary>
        public int? LayerProgressId { get; set; }
        /// <summary>…or its business key, which is what the client naturally holds.</summary>
        public int? ChainageId { get; set; }
        public string? LayerCode { get; set; }

        public string IfcElementGlobalId { get; set; } = string.Empty;
        public string? SourceRef { get; set; }
        public string? SourceRefKind { get; set; }
        public string Strategy { get; set; } = "guid";
        public string? Confidence { get; set; }
        public int? SegmentIndex { get; set; }
    }

    /// <summary>
    /// Persisted progress-to-element bindings.
    ///
    /// The resolver itself stays in the browser: group expansion, segment clustering and
    /// direction scoring are subtle enough that a second C# implementation would drift from
    /// the first. This endpoint stores the answer and validates it — the composite foreign
    /// key on ProgressIfcBindings makes a binding to a non-existent element impossible to
    /// write even if a client sends one.
    /// </summary>
    [ApiController]
    [Authorize]
    public class BindingsController : ControllerBase
    {
        private readonly RoadDbContext _db;
        private readonly ProjectAccessService _access;

        public BindingsController(RoadDbContext db, ProjectAccessService access)
        {
            _db = db;
            _access = access;
        }

        [HttpGet("api/projects/{idOrCode}/bindings")]
        public async Task<IActionResult> Get(string idOrCode, [FromQuery] long? ifcModelId)
        {
            var access = await _access.ResolveAsync(User, idOrCode);
            if (access is null) return NotFound();

            // A project now holds one active model PER PACKAGE, so there is no single
            // "the active model" to fall back to. With several, the caller has to say which.
            long? modelId = ifcModelId;
            if (modelId is null)
            {
                var activeIds = await _db.IfcModels
                    .Where(m => m.ProjectId == access.Project.Id && m.IsActive)
                    .Select(m => m.Id)
                    .Take(2)
                    .ToListAsync();

                if (activeIds.Count == 0)
                    return Ok(new { ifcModelId = (long?)null, bindings = Array.Empty<object>() });
                if (activeIds.Count > 1)
                    return BadRequest(new { message = "This project has an active model in more than one package. Name the one you want with ?ifcModelId=." });

                modelId = activeIds[0];
            }

            // Guard the model belongs to this project — never trust the query string
            var owningPackageId = await _db.IfcModels
                .Where(m => m.Id == modelId && m.ProjectId == access.Project.Id)
                .Select(m => (int?)m.PackageId)
                .FirstOrDefaultAsync();
            if (owningPackageId is null) return NotFound();

            var rows = await _db.ProgressIfcBindings
                .Where(b => b.IfcModelId == modelId
                         && b.LayerProgress!.PackageId == owningPackageId
                         && b.LayerProgress.SupersededAt == null)
                .Include(b => b.LayerProgress).ThenInclude(p => p!.Chainage)
                .Include(b => b.LayerProgress).ThenInclude(p => p!.Layer)
                .Select(b => new
                {
                    layerProgressId = b.LayerProgressId,
                    key = b.LayerProgress!.SourceRowKey,
                    chainageId = b.LayerProgress.Chainage!.SourceChainageId ?? b.LayerProgress.ChainageId,
                    layerCode = b.LayerProgress.Layer!.Code,
                    ifcElementGlobalId = b.IfcElementGlobalId,
                    sourceRef = b.SourceRef,
                    sourceRefKind = b.SourceRefKind,
                    strategy = b.Strategy,
                    confidence = b.Confidence,
                    segmentIndex = b.SegmentIndex,
                    boundAt = b.BoundAt,
                })
                .ToListAsync();

            return Ok(new { ifcModelId = modelId, bindings = rows });
        }

        /// <summary>
        /// Replaces the binding set for one model. Idempotent: sending the same set twice
        /// leaves the same rows, only refreshing strategy and timestamp.
        /// </summary>
        [HttpPut("api/projects/{idOrCode}/bindings")]
        public async Task<IActionResult> Replace(string idOrCode, [FromBody] RebindRequest request)
        {
            var access = await _access.ResolveAsync(User, idOrCode);
            if (access is null) return NotFound();
            if (!access.Can(ProjectRole.Contributor)) return Forbid();

            var model = await _db.IfcModels
                .FirstOrDefaultAsync(m => m.Id == request.IfcModelId && m.ProjectId == access.Project.Id);
            if (model is null) return NotFound(new { message = "Model not found in this project." });

            var knownElements = (await _db.IfcElements
                .Where(e => e.IfcModelId == model.Id)
                .Select(e => e.GlobalId)
                .ToListAsync()).ToHashSet();

            // Scoped to the model's OWN package, not the project.
            //
            // The business key below is (workbook chainage id, layer code), and that pair is
            // only unique within a package — two packages each importing a sheet numbered
            // 1..n and both using "BC" would collide, and ToDictionary would throw on the
            // duplicate. Binding another package's rows to this model would be wrong anyway:
            // its geometry does not contain them.
            var progress = await _db.LayerProgresses
                .Where(p => p.PackageId == model.PackageId && p.SupersededAt == null)
                .Include(p => p.Chainage)
                .Include(p => p.Layer)
                .ToListAsync();

            var byDbId = progress.ToDictionary(p => p.Id);
            var byBusinessKey = progress.ToDictionary(
                p => $"{p.Chainage!.SourceChainageId ?? p.ChainageId}:{p.Layer!.Code}");

            await using var tx = await _db.Database.BeginTransactionAsync();

            var existing = await _db.ProgressIfcBindings
                .Where(b => b.IfcModelId == model.Id)
                .ToListAsync();
            var existingByKey = existing.ToDictionary(b => $"{b.LayerProgressId}:{b.IfcElementGlobalId}");
            var seen = new HashSet<string>();

            int written = 0, rejected = 0;

            foreach (var row in request.Bindings)
            {
                LayerProgress? target = null;
                if (row.LayerProgressId is not null) byDbId.TryGetValue(row.LayerProgressId.Value, out target);
                if (target is null && row.ChainageId is not null && row.LayerCode is not null)
                    byBusinessKey.TryGetValue($"{row.ChainageId}:{row.LayerCode.ToUpperInvariant()}", out target);

                if (target is null || !knownElements.Contains(row.IfcElementGlobalId)) { rejected++; continue; }

                var key = $"{target.Id}:{row.IfcElementGlobalId}";
                seen.Add(key);

                if (!existingByKey.TryGetValue(key, out var binding))
                {
                    binding = new ProgressIfcBinding
                    {
                        LayerProgressId = target.Id,
                        IfcModelId = model.Id,
                        IfcElementGlobalId = row.IfcElementGlobalId,
                    };
                    _db.ProgressIfcBindings.Add(binding);
                    existingByKey[key] = binding;
                }

                binding.SourceRef = row.SourceRef;
                binding.SourceRefKind = row.SourceRefKind;
                binding.Strategy = row.Strategy;
                binding.Confidence = row.Confidence;
                binding.SegmentIndex = row.SegmentIndex;
                binding.BoundAt = DateTime.UtcNow;
                written++;
            }

            // Bindings for this model that the new set does not mention are stale — the
            // resolver produced a different answer, so they are removed. This is a rebind
            // of one model's bindings, never a delete of progress data.
            var removed = existing.Where(b => !seen.Contains($"{b.LayerProgressId}:{b.IfcElementGlobalId}")).ToList();
            _db.ProgressIfcBindings.RemoveRange(removed);

            await _db.SaveChangesAsync();
            await tx.CommitAsync();

            return Ok(new
            {
                ifcModelId = model.Id,
                written,
                removed = removed.Count,
                rejected,
                total = await _db.ProgressIfcBindings.CountAsync(b => b.IfcModelId == model.Id),
            });
        }
    }

    public class UpdateProgressRequest
    {
        public string? Status { get; set; }
        public double? ProgressPercent { get; set; }
        public int? DelayDays { get; set; }
        public decimal? ActualCost { get; set; }
        public DateTime? ActualStartDate { get; set; }
        public DateTime? ActualEndDate { get; set; }
    }

    [ApiController]
    [Authorize]
    [Route("api/progress")]
    public class ProgressRecordsController : ControllerBase
    {
        private static readonly HashSet<string> Statuses =
            new(StringComparer.Ordinal) { "Completed", "In-Progress", "Delayed", "Not Started" };

        private readonly RoadDbContext _db;
        private readonly ProjectAccessService _access;

        public ProgressRecordsController(RoadDbContext db, ProjectAccessService access)
        {
            _db = db;
            _access = access;
        }

        [HttpPut("{id:int}")]
        public async Task<IActionResult> Update(int id, [FromBody] UpdateProgressRequest request)
        {
            var row = await _db.LayerProgresses.FirstOrDefaultAsync(p => p.Id == id);
            if (row is null) return NotFound();

            var access = await _access.ResolveAsync(User, row.ProjectId.ToString());
            if (access is null) return NotFound();
            if (!access.Can(ProjectRole.Contributor)) return Forbid();

            if (request.Status is not null)
            {
                if (!Statuses.Contains(request.Status))
                    return BadRequest(new { message = $"Status must be one of {string.Join(", ", Statuses)}." });
                row.Status = request.Status;
            }
            if (request.ProgressPercent is not null)
                row.ProgressPercent = Math.Clamp(request.ProgressPercent.Value, 0, 100);
            if (request.DelayDays is not null) row.DelayDays = request.DelayDays.Value;
            if (request.ActualCost is not null) row.ActualCost = request.ActualCost.Value;
            if (request.ActualStartDate is not null)
                row.ActualStartDate = DateTime.SpecifyKind(request.ActualStartDate.Value, DateTimeKind.Utc);
            if (request.ActualEndDate is not null)
                row.ActualEndDate = DateTime.SpecifyKind(request.ActualEndDate.Value, DateTimeKind.Utc);

            row.UpdatedBy = User.Identity?.Name ?? "Manual edit";
            row.UpdatedAt = DateTime.UtcNow;

            await _db.SaveChangesAsync();
            return Ok(new { row.Id, row.Status, row.ProgressPercent, row.UpdatedAt });
        }
    }
}
