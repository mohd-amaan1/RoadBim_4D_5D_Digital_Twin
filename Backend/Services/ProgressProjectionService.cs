using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Microsoft.EntityFrameworkCore;
using RoadBimBackend.Data;
using RoadBimBackend.Models;

namespace RoadBimBackend.Services
{
    /// <summary>
    /// Turns inspections into the rows the map already knows how to colour.
    ///
    /// This is the whole point of the RFI work. Everything downstream — the resolver, the
    /// per-element tint, the plan map, the heatmap, the KPIs — keeps running unchanged;
    /// only the author of <c>LayerProgress.Status</c> changes, from an Excel column to a
    /// verdict recorded on site.
    ///
    /// Three rules decide what gets written:
    ///
    ///   1. **A range expands.** An RFI names a stretch of chainage, so it writes one row
    ///      per chainage it covers. Without this an RFI spanning three chainages would
    ///      paint them as a single block and the map would lose the resolution it has.
    ///
    ///   2. **A missing component means the whole cross-section.** An RFI with no layer
    ///      offers everything at that chainage, which is how a field engineer is actually
    ///      given a stretch of road. It then writes a row per layer.
    ///
    ///   3. **Worst case wins per cell.** A chainage-layer covered by several RFIs takes
    ///      the least-finished of them. One rejected layer must not be hidden by a passed
    ///      one sitting on the same cell.
    ///
    /// Cost, planned dates, design thickness and the GlobalId binding are never touched
    /// here — those belong to the workbook, and an inspection has nothing to say about them.
    /// </summary>
    public class ProgressProjectionService
    {
        private readonly RoadDbContext _db;

        public ProgressProjectionService(RoadDbContext db) => _db = db;

        public sealed record Result(int RowsWritten, int ChainagesTouched, int LayersTouched);

        /// <summary>
        /// Recomputes every chainage-layer cell the given RFI covers, from ALL live RFIs
        /// covering those cells — not just this one. Recomputing from the full set is what
        /// makes the projection idempotent: running it twice, or after a rejection, lands
        /// on the same answer rather than layering one verdict over another.
        /// </summary>
        public async Task<Result> ProjectForRfiAsync(Rfi rfi)
        {
            var chainages = await CoveredChainagesAsync(rfi);
            if (chainages.Count == 0) return new Result(0, 0, 0);

            var layers = await CoveredLayersAsync(rfi);
            if (layers.Count == 0) return new Result(0, chainages.Count, 0);

            // Every live RFI on this package, so a cell's status reflects everything that
            // has been said about it rather than only the request just inspected.
            var siblings = await _db.Rfis
                .Where(r => r.PackageId == rfi.PackageId && r.Status != RfiStatus.Cancelled)
                .ToListAsync();

            var existing = await _db.LayerProgresses
                .Where(p => p.PackageId == rfi.PackageId)
                .ToDictionaryAsync(p => (p.ChainageId, p.LayerId));

            var written = 0;
            var now = DateTime.UtcNow;

            foreach (var chainage in chainages)
            {
                foreach (var layer in layers)
                {
                    // An RFI covers this cell when its range overlaps the chainage, and it
                    // either names this layer or names none at all.
                    //
                    // Half-open on purpose. Adjacent partitions SHARE an endpoint — km 0–1
                    // is followed by km 1–2 — so an inclusive test would have an RFI on the
                    // first chainage also claim the second, and the map would paint a block
                    // instead of a chainage.
                    var covering = siblings.Where(r =>
                        r.ChainageFromM < chainage.ChainageEnd
                        && r.ChainageToM > chainage.ChainageStart
                        && (r.LayerId is null || r.LayerId == layer.Id)).ToList();

                    if (covering.Count == 0) continue;

                    var status = RfiService.MapStatusFor(covering);

                    // The RFI that most recently settled this cell, for traceability from a
                    // coloured element back to the request that coloured it.
                    var deciding = covering
                        .OrderByDescending(r => r.InspectedAt ?? r.SubmittedAt ?? r.CreatedAt)
                        .First();

                    if (!existing.TryGetValue((chainage.Id, layer.Id), out var row))
                    {
                        // No workbook row for this cell. Created with zero cost rather than
                        // invented figures — an inspection knows the status, not the money.
                        row = new LayerProgress
                        {
                            ProjectId = rfi.ProjectId,
                            PackageId = rfi.PackageId,
                            ChainageId = chainage.Id,
                            LayerId = layer.Id,
                        };
                        _db.LayerProgresses.Add(row);
                        existing[(chainage.Id, layer.Id)] = row;
                    }

                    row.Status = status;
                    row.ProgressPercent = PercentFor(status);
                    row.Source = ProgressSource.Rfi;
                    row.SourceRfiId = deciding.Id;
                    row.UpdatedBy = "RFI inspection";
                    row.UpdatedAt = now;
                    // A cell an inspection has spoken about is live, whatever a previous
                    // replace-mode import decided about it.
                    row.SupersededAt = null;
                    written++;
                }
            }

            await _db.SaveChangesAsync();
            return new Result(written, chainages.Count, layers.Count);
        }

        /// <summary>
        /// Progress means ACCEPTED work, so only an approved or passed cell counts.
        ///
        /// A chainage is inspected or it is not — there is no half-inspected layer — so this
        /// is deliberately 0 or 100 and the roll-up produces the percentage across cells.
        /// That is a truer number than an estimate typed into a sheet, and it needs no extra
        /// input from anybody.
        /// </summary>
        private static double PercentFor(string status) => status switch
        {
            "Completed" => 100,
            _ => 0,
        };

        /// <summary>
        /// Every chainage the RFI's range overlaps. Overlap rather than containment: an RFI
        /// stated as 7.2–7.8 km genuinely covers part of the 7.0–8.0 partition.
        ///
        /// The comparison is half-open — <c>start &lt; toM</c> and <c>end &gt; fromM</c> —
        /// because consecutive partitions share a boundary. km 0–1 is followed by km 1–2,
        /// so an inclusive test makes an RFI on the first also cover the second, and every
        /// chainage in a package ends up the same colour.
        /// </summary>
        private async Task<List<RoadChainage>> CoveredChainagesAsync(Rfi rfi) =>
            await _db.RoadChainages
                .Where(c => c.PackageId == rfi.PackageId
                         && c.ChainageStart < rfi.ChainageToM
                         && c.ChainageEnd > rfi.ChainageFromM)
                .OrderBy(c => c.ChainageStart)
                .ToListAsync();

        /// <summary>
        /// The layers the RFI speaks for: the one it names, or all of them when it names
        /// none — which is the "whole cross-section" case.
        /// </summary>
        private async Task<List<RoadLayer>> CoveredLayersAsync(Rfi rfi)
        {
            var all = _db.RoadLayers.Where(l => l.PackageId == rfi.PackageId);
            if (rfi.LayerId is int id) all = all.Where(l => l.Id == id);
            return await all.OrderBy(l => l.SortOrder).ToListAsync();
        }

        /// <summary>
        /// Binds the rows this RFI touched onto model elements — but only the rows that
        /// have no binding yet.
        ///
        /// The restriction is the whole point. A row imported from the workbook already
        /// carries an exact GlobalId match, and a positional guess laid on top of it does
        /// not refine that answer, it contradicts it: the row then claims two different
        /// stretches of road and the map paints both. That is how one inspected kilometre
        /// turned three chainages into two green blocks.
        ///
        /// So position is used strictly where nothing better exists — rows the projection
        /// itself created, which the workbook never described. That matches the precedence
        /// the resolver already documents: guid, then group, then position, then name.
        /// </summary>
        public async Task<int> RebindAsync(Rfi rfi)
        {
            var model = await _db.IfcModels
                .FirstOrDefaultAsync(m => m.PackageId == rfi.PackageId && m.IsActive);
            if (model is null) return 0;

            var chainages = await CoveredChainagesAsync(rfi);
            var layers = await CoveredLayersAsync(rfi);
            if (chainages.Count == 0 || layers.Count == 0) return 0;

            var ordered = await _db.RoadChainages
                .Where(c => c.PackageId == rfi.PackageId)
                .OrderBy(c => c.ChainageStart)
                .Select(c => c.Id)
                .ToListAsync();

            var elements = await _db.IfcElements
                .Where(e => e.IfcModelId == model.Id)
                .ToListAsync();

            var rows = await _db.LayerProgresses
                .Where(p => p.PackageId == rfi.PackageId && p.Source == ProgressSource.Rfi)
                .ToListAsync();

            // Every row in the package that is already spoken for, so an existing answer is
            // never overwritten — and so the direction below can be read off those answers.
            var boundRowIds = await _db.ProgressIfcBindings
                .Where(b => b.IfcModelId == model.Id)
                .Select(b => b.LayerProgressId)
                .Distinct()
                .ToListAsync();
            var alreadyBound = boundRowIds.ToHashSet();

            var ascending = await DirectionAsync(model, ordered);
            var segmentCount = elements.Count == 0
                ? 0
                : elements.Max(e => e.SegmentIndex ?? 0) + 1;

            var bound = 0;
            foreach (var chainage in chainages)
            {
                var ordinal = ordered.IndexOf(chainage.Id);
                if (ordinal < 0) continue;

                // Chainage need not run the same way as the model's local axis. Where the
                // package already has exact bindings they settle which way round it is;
                // assuming ascending would silently mirror the road.
                var segment = ascending ? ordinal : segmentCount - 1 - ordinal;
                if (segment < 0 || (segmentCount > 0 && segment >= segmentCount)) continue;

                foreach (var layer in layers)
                {
                    var row = rows.FirstOrDefault(p => p.ChainageId == chainage.Id && p.LayerId == layer.Id);
                    if (row is null || alreadyBound.Contains(row.Id)) continue;

                    var matches = elements
                        .Where(e => e.SegmentIndex == segment
                                 && string.Equals(e.LayerCode, layer.Code, StringComparison.OrdinalIgnoreCase))
                        .ToList();
                    if (matches.Count == 0) continue;

                    foreach (var element in matches)
                    {
                        _db.ProgressIfcBindings.Add(new ProgressIfcBinding
                        {
                            LayerProgressId = row.Id,
                            IfcModelId = model.Id,
                            IfcElementGlobalId = element.GlobalId,
                            Strategy = BindingStrategy.Position,
                            Confidence = "medium",
                            SourceRefKind = "none",
                            SegmentIndex = segment,
                            BoundAt = DateTime.UtcNow,
                        });
                        bound++;
                    }

                    // Guards against a second layer in the same pass binding this row again.
                    alreadyBound.Add(row.Id);
                }
            }

            if (bound > 0) await _db.SaveChangesAsync();
            return bound;
        }

        /// <summary>
        /// Whether segment index climbs with chainage, read off the bindings that already
        /// exist rather than assumed.
        ///
        /// Two anchors disagreeing about direction is enough to make the answer arbitrary,
        /// so the majority wins and a tie falls back to ascending — the same conservative
        /// default the browser-side resolver takes.
        /// </summary>
        private async Task<bool> DirectionAsync(IfcModel model, List<int> ordered)
        {
            var anchors = await _db.ProgressIfcBindings
                .Where(b => b.IfcModelId == model.Id
                         && b.SegmentIndex != null
                         && b.Strategy != BindingStrategy.Position)
                .Join(_db.LayerProgresses, b => b.LayerProgressId, p => p.Id,
                      (b, p) => new { p.ChainageId, Segment = b.SegmentIndex!.Value })
                .Distinct()
                .ToListAsync();

            var points = anchors
                .Select(a => new { Ordinal = ordered.IndexOf(a.ChainageId), a.Segment })
                .Where(a => a.Ordinal >= 0)
                .ToList();
            if (points.Count < 2) return true;

            var up = 0;
            var down = 0;
            for (var i = 0; i < points.Count; i++)
                for (var j = i + 1; j < points.Count; j++)
                {
                    var dOrdinal = points[j].Ordinal - points[i].Ordinal;
                    var dSegment = points[j].Segment - points[i].Segment;
                    if (dOrdinal == 0 || dSegment == 0) continue;
                    if (Math.Sign(dOrdinal) == Math.Sign(dSegment)) up++; else down++;
                }

            return down <= up;
        }
    }
}
