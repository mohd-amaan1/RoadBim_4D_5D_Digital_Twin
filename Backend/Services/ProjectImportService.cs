using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using Microsoft.EntityFrameworkCore;
using RoadBimBackend.Data;
using RoadBimBackend.Models;

namespace RoadBimBackend.Services
{
    /// <summary>
    /// Persists a validated import.
    ///
    /// Two guarantees shape everything here:
    ///
    ///   Idempotent — every write matches on a stable business key, never a generated id,
    ///   so re-importing the same workbook updates in place. Rows whose every field already
    ///   matches are counted as unchanged and not written at all, which is what makes
    ///   "0 inserted, 0 updated, 12 unchanged" an honest answer rather than a hopeful one.
    ///
    ///   Atomic — the batch header is committed first as 'running' so a crash is visible,
    ///   then everything else commits or rolls back together. A failed import can never
    ///   leave half the rows updated.
    /// </summary>
    public class ProjectImportService
    {
        private readonly RoadDbContext _db;

        public ProjectImportService(RoadDbContext db) => _db = db;

        public async Task<ImportResultDto> ImportAsync(
            Package package, ImportPayloadDto payload, int? userId, bool force)
        {
            var mode = payload.Mode == ImportMode.Replace ? ImportMode.Replace : ImportMode.Incremental;
            var contentHash = ComputeBatchHash(payload);

            // --- layer 1 idempotency: the same files, already imported successfully -----
            if (!force)
            {
                var previous = await _db.ImportBatches
                    .Where(b => b.PackageId == package.Id
                             && b.ContentSha256 == contentHash
                             && b.Status == ImportStatus.Succeeded)
                    .OrderByDescending(b => b.StartedAt)
                    .FirstOrDefaultAsync();

                if (previous is not null)
                    return ToResult(previous, alreadyImported: true);
            }

            // --- batch header, committed on its own so a crash leaves a trace -----------
            var batch = new ImportBatch
            {
                ProjectId = package.ProjectId,
                PackageId = package.Id,
                Mode = mode,
                Status = ImportStatus.Running,
                ContentSha256 = contentHash,
                ImportedByUserId = userId,
                StartedAt = DateTime.UtcNow,
                Summary = string.IsNullOrWhiteSpace(payload.Summary) ? "{}" : payload.Summary!,
                ErrorCount = payload.Issues.Count(i => i.Level == "error"),
                WarningCount = payload.Issues.Count(i => i.Level == "warning"),
            };
            _db.ImportBatches.Add(batch);
            await _db.SaveChangesAsync();

            try
            {
                await using var tx = await _db.Database.BeginTransactionAsync();

                WriteFiles(batch, payload);
                WriteIssues(batch, payload);

                var layerIdByCode = await UpsertLayersAsync(package, batch, payload);
                var chainageIdBySourceId = await UpsertChainagesAsync(package, batch, payload);
                var progressByKey = await UpsertProgressAsync(
                    package, batch, payload, layerIdByCode, chainageIdBySourceId);

                if (mode == ImportMode.Replace)
                    await SupersedeUntouchedAsync(package, batch, progressByKey.Values);

                await UpsertBindingsAsync(package, batch, payload, progressByKey);
                await UpsertMetricsAsync(package, batch, payload);

                batch.Status = ImportStatus.Succeeded;
                batch.CompletedAt = DateTime.UtcNow;
                await _db.SaveChangesAsync();
                await tx.CommitAsync();

                return ToResult(batch, alreadyImported: false);
            }
            catch (Exception ex)
            {
                // The transaction has rolled back; record the failure on the batch header,
                // which lives outside it.
                _db.ChangeTracker.Clear();
                var failed = await _db.ImportBatches.FindAsync(batch.Id);
                if (failed is not null)
                {
                    failed.Status = ImportStatus.Failed;
                    failed.CompletedAt = DateTime.UtcNow;
                    failed.FailureMessage = Truncate(ex.Message, 1000);
                    await _db.SaveChangesAsync();
                    return ToResult(failed, alreadyImported: false);
                }
                throw;
            }
        }

        // ------------------------------------------------------------------ files

        private void WriteFiles(ImportBatch batch, ImportPayloadDto payload)
        {
            foreach (var f in payload.Files)
            {
                _db.ImportBatchFiles.Add(new ImportBatchFile
                {
                    ImportBatchId = batch.Id,
                    FileName = f.FileName,
                    SheetName = f.SheetName,
                    SheetKind = f.SheetKind,
                    RowCount = f.RowCount,
                    ContentSha256 = f.ContentSha256 ?? string.Empty,
                    ByteSize = f.ByteSize,
                });
            }
        }

        private void WriteIssues(ImportBatch batch, ImportPayloadDto payload)
        {
            foreach (var i in payload.Issues)
            {
                _db.ImportIssues.Add(new ImportIssue
                {
                    ImportBatchId = batch.Id,
                    Level = i.Level is "error" or "warning" or "info" ? i.Level : "info",
                    Code = Truncate(i.Code, 200),
                    Message = Truncate(i.Message, 2000),
                    SheetName = i.Sheet,
                    RowNumber = i.Row,
                    FieldName = i.Field,
                });
            }
        }

        // ------------------------------------------------------------------ layers

        private async Task<Dictionary<string, int>> UpsertLayersAsync(
            Package package, ImportBatch batch, ImportPayloadDto payload)
        {
            var existing = await _db.RoadLayers
                .Where(l => l.PackageId == package.Id)
                .ToDictionaryAsync(l => l.Code);

            foreach (var dto in payload.Layers)
            {
                var code = (dto.Code ?? string.Empty).Trim().ToUpperInvariant();
                if (code.Length == 0) { batch.RowsRejected++; continue; }

                if (!existing.TryGetValue(code, out var row))
                {
                    row = new RoadLayer
                    {
                        ProjectId = package.ProjectId,
                        PackageId = package.Id,
                        Code = code,
                    };
                    _db.RoadLayers.Add(row);
                    existing[code] = row;
                    batch.RowsInserted++;
                }
                else if (IsLayerUnchanged(row, dto))
                {
                    batch.RowsUnchanged++;
                    continue;
                }
                else
                {
                    batch.RowsUpdated++;
                }

                row.LayerName = dto.LayerName ?? code;
                row.ThicknessMm = dto.CatalogueThicknessMm ?? 0;
                row.MaterialType = dto.MaterialType ?? string.Empty;
                row.DefaultColorHex = dto.DefaultColorHex ?? "#64748B";
                row.SortOrder = dto.SortOrder ?? 0;
                row.SourceLayerId = dto.Id;
                row.LastImportBatchId = batch.Id;
            }

            await _db.SaveChangesAsync();
            return existing.ToDictionary(kv => kv.Key, kv => kv.Value.Id);
        }

        private static bool IsLayerUnchanged(RoadLayer row, LayerDto dto) =>
            row.LayerName == (dto.LayerName ?? row.Code)
            && row.ThicknessMm == (dto.CatalogueThicknessMm ?? 0)
            && row.MaterialType == (dto.MaterialType ?? string.Empty)
            && row.DefaultColorHex == (dto.DefaultColorHex ?? "#64748B")
            && row.SortOrder == (dto.SortOrder ?? 0);

        // --------------------------------------------------------------- chainages

        private async Task<Dictionary<int, int>> UpsertChainagesAsync(
            Package package, ImportBatch batch, ImportPayloadDto payload)
        {
            var existing = await _db.RoadChainages
                .Where(c => c.PackageId == package.Id && c.SourceChainageId != null)
                .ToDictionaryAsync(c => c.SourceChainageId!.Value);

            foreach (var dto in payload.Chainages)
            {
                if (dto.Id is null) { batch.RowsRejected++; continue; }
                var sourceId = dto.Id.Value;

                if (!existing.TryGetValue(sourceId, out var row))
                {
                    row = new RoadChainage
                    {
                        ProjectId = package.ProjectId,
                        PackageId = package.Id,
                        SourceChainageId = sourceId,
                    };
                    _db.RoadChainages.Add(row);
                    existing[sourceId] = row;
                    batch.RowsInserted++;
                }
                else if (IsChainageUnchanged(row, dto))
                {
                    batch.RowsUnchanged++;
                    continue;
                }
                else
                {
                    batch.RowsUpdated++;
                }

                row.ChainageStart = dto.ChainageStart ?? 0;
                row.ChainageEnd = dto.ChainageEnd ?? 0;
                row.KmLabel = dto.KmLabel ?? string.Empty;
                row.SectionName = dto.SectionName ?? string.Empty;
                row.Latitude = dto.Latitude ?? 0;
                row.Longitude = dto.Longitude ?? 0;
                row.Elevation = dto.ElevationM ?? 0;
                row.TerrainType = dto.TerrainType ?? "Cut & Fill";
                row.SortOrder = dto.SortOrder ?? sourceId;
                row.SourceRowNumber = dto.RowNumber;
                row.LastImportBatchId = batch.Id;
            }

            await _db.SaveChangesAsync();
            return existing.ToDictionary(kv => kv.Key, kv => kv.Value.Id);
        }

        private static bool IsChainageUnchanged(RoadChainage row, ChainageDto dto) =>
            NearlyEqual(row.ChainageStart, dto.ChainageStart ?? 0)
            && NearlyEqual(row.ChainageEnd, dto.ChainageEnd ?? 0)
            && row.KmLabel == (dto.KmLabel ?? string.Empty)
            && row.SectionName == (dto.SectionName ?? string.Empty)
            && NearlyEqual(row.Latitude, dto.Latitude ?? 0)
            && NearlyEqual(row.Longitude, dto.Longitude ?? 0)
            && NearlyEqual(row.Elevation, dto.ElevationM ?? 0)
            && row.TerrainType == (dto.TerrainType ?? "Cut & Fill");

        // ---------------------------------------------------------------- progress

        private async Task<Dictionary<string, LayerProgress>> UpsertProgressAsync(
            Package package, ImportBatch batch, ImportPayloadDto payload,
            Dictionary<string, int> layerIdByCode, Dictionary<int, int> chainageIdBySourceId)
        {
            var existing = await _db.LayerProgresses
                .Where(p => p.PackageId == package.Id)
                .ToDictionaryAsync(p => $"{p.ChainageId}:{p.LayerId}");

            var touched = new Dictionary<string, LayerProgress>();

            foreach (var dto in payload.Progress)
            {
                var code = (dto.LayerCode ?? string.Empty).Trim().ToUpperInvariant();

                if (!chainageIdBySourceId.TryGetValue(dto.ChainageId, out var chainageId)
                    || !layerIdByCode.TryGetValue(code, out var layerId))
                {
                    // Referential integrity is the client validator's job; anything that slips
                    // through is rejected rather than silently attached to the wrong parent.
                    batch.RowsRejected++;
                    continue;
                }

                var dbKey = $"{chainageId}:{layerId}";
                var isNew = !existing.TryGetValue(dbKey, out var row);

                if (isNew)
                {
                    row = new LayerProgress
                    {
                        ProjectId = package.ProjectId,
                        PackageId = package.Id,
                        ChainageId = chainageId,
                        LayerId = layerId,
                        FirstImportBatchId = batch.Id,
                        // Un-inspected until somebody says otherwise. The workbook cannot
                        // colour a cell, so a freshly imported row starts blank on the map.
                        Status = "Not Started",
                        ProgressPercent = 0,
                        Source = ProgressSource.None,
                    };
                    _db.LayerProgresses.Add(row);
                    existing[dbKey] = row;
                    batch.RowsInserted++;
                }
                else if (IsProgressUnchanged(row!, dto))
                {
                    // Reviving a row a previous replace-mode import superseded still counts
                    // as an update, because its visibility changes.
                    if (row!.SupersededAt is not null)
                    {
                        row.SupersededAt = null;
                        row.LastImportBatchId = batch.Id;
                        batch.RowsUpdated++;
                    }
                    else
                    {
                        batch.RowsUnchanged++;
                    }
                    touched[dto.Key ?? dbKey] = row;
                    continue;
                }
                else
                {
                    batch.RowsUpdated++;
                }

                // ---- status is never imported ------------------------------------------
                //
                // The sheet's status is the PLAN, and the plan is not what the map shows.
                // A cell is coloured only once somebody has stood on the work and recorded
                // a verdict, so an import writes the baseline and leaves the live status
                // alone — whether or not an inspection has happened yet.
                //
                // Where the two disagree the difference is reported, which is the whole
                // value of keeping the baseline: plan-versus-site becomes visible instead
                // of being settled by whoever wrote last.
                var sheetStatus = NormaliseStatus(dto.Status);
                row!.BaselineStatus = sheetStatus;
                row.BaselineProgressPercent = Clamp(dto.ProgressPercent ?? 0, 0, 100);

                if (row.Source == ProgressSource.Rfi && row.Status != sheetStatus)
                {
                    _db.ImportIssues.Add(new ImportIssue
                    {
                        ImportBatchId = batch.Id,
                        Level = "info",
                        Code = "progress.plan-differs-from-site",
                        Message =
                            $"Chainage {dto.ChainageId} {code}: the sheet plans "
                            + $"\"{sheetStatus}\", the inspection found \"{row.Status}\".",
                        SheetName = "Layer progress",
                        RowNumber = dto.RowNumber,
                        FieldName = "Status",
                    });
                }

                // ---- everything below still belongs to the workbook -------------------
                // Cost, the plan, the design thickness and the GlobalId binding are facts
                // an inspection has nothing to say about.
                row.PlannedStartDate = ToUtc(dto.PlannedStartDate) ?? default;
                row.PlannedEndDate = ToUtc(dto.PlannedEndDate) ?? default;
                row.ActualStartDate = ToUtc(dto.ActualStartDate);
                row.ActualEndDate = ToUtc(dto.ActualEndDate);
                row.BudgetCost = dto.BudgetCost ?? 0;
                row.ActualCost = dto.ActualCost ?? 0;
                row.CostVariance = dto.CostVariance ?? 0;
                row.DelayDays = dto.DelayDays ?? 0;
                row.DesignThicknessMm = dto.DesignThicknessMm;
                row.LevelColorHex = dto.LevelColorHex;
                row.UpdatedBy = dto.UpdatedBy ?? "Excel import";
                row.UpdatedAt = DateTime.UtcNow;
                row.SourceRowKey = dto.Key;
                row.SourceRowNumber = dto.RowNumber;
                row.SourceStatusText = dto.RawStatus;
            row.SourceIfcRef = dto.IfcRef;
                row.LastImportBatchId = batch.Id;
                row.SupersededAt = null;

                touched[dto.Key ?? dbKey] = row;
            }

            await _db.SaveChangesAsync();
            return touched;
        }

        /// <summary>
        /// Whether re-importing this row would change anything.
        ///
        /// Compared against the BASELINE, not the live status — the live status belongs to
        /// inspections and an import never touches it, so including it here would report
        /// every re-import as an update and destroy the one thing that makes
        /// "0 inserted, 0 updated, 12 unchanged" worth printing.
        /// </summary>
        private static bool IsProgressUnchanged(LayerProgress row, ProgressDto dto) =>
            row.BaselineStatus == NormaliseStatus(dto.Status)
            && NearlyEqual(row.BaselineProgressPercent ?? -1, Clamp(dto.ProgressPercent ?? 0, 0, 100))
            && row.PlannedStartDate == (ToUtc(dto.PlannedStartDate) ?? default)
            && row.PlannedEndDate == (ToUtc(dto.PlannedEndDate) ?? default)
            && row.ActualStartDate == ToUtc(dto.ActualStartDate)
            && row.ActualEndDate == ToUtc(dto.ActualEndDate)
            && row.BudgetCost == (dto.BudgetCost ?? 0)
            && row.ActualCost == (dto.ActualCost ?? 0)
            && row.CostVariance == (dto.CostVariance ?? 0)
            && row.DelayDays == (dto.DelayDays ?? 0)
            && row.DesignThicknessMm == dto.DesignThicknessMm
            && row.LevelColorHex == dto.LevelColorHex
            && row.SourceIfcRef == dto.IfcRef;

        /// <summary>
        /// Replace mode. Rows the batch did not touch are marked superseded, never deleted,
        /// so the operation is reversible by clearing the marker.
        ///
        /// Rows an inspection owns are exempt. The projection creates cells the workbook
        /// never described — an RFI covering a chainage-layer the sheet has no row for —
        /// and a replace-mode import would otherwise retire real site evidence simply
        /// because the spreadsheet does not mention it.
        /// </summary>
        private async Task SupersedeUntouchedAsync(
            Package package, ImportBatch batch, IEnumerable<LayerProgress> touched)
        {
            var keep = touched.Select(t => t.Id).ToHashSet();

            var stale = await _db.LayerProgresses
                .Where(p => p.PackageId == package.Id
                         && p.SupersededAt == null
                         && p.Source != ProgressSource.Rfi)
                .ToListAsync();

            foreach (var row in stale.Where(r => !keep.Contains(r.Id)))
            {
                row.SupersededAt = DateTime.UtcNow;
                row.LastImportBatchId = batch.Id;
                batch.RowsSuperseded++;
            }

            await _db.SaveChangesAsync();
        }

        // ---------------------------------------------------------------- bindings

        private async Task UpsertBindingsAsync(
            Package package, ImportBatch batch, ImportPayloadDto payload,
            Dictionary<string, LayerProgress> progressByKey)
        {
            var activeModel = await _db.IfcModels
                .FirstOrDefaultAsync(m => m.PackageId == package.Id && m.IsActive);
            if (activeModel is null) return;

            var known = await _db.IfcElements
                .Where(e => e.IfcModelId == activeModel.Id)
                .Select(e => e.GlobalId)
                .ToListAsync();
            var knownSet = known.ToHashSet();

            var progressIds = progressByKey.Values.Select(p => p.Id).ToHashSet();
            var existing = await _db.ProgressIfcBindings
                .Where(b => b.IfcModelId == activeModel.Id && progressIds.Contains(b.LayerProgressId))
                .ToListAsync();
            var existingByKey = existing.ToDictionary(b => $"{b.LayerProgressId}:{b.IfcElementGlobalId}");

            foreach (var dto in payload.Progress)
            {
                if (dto.Bindings.Count == 0) continue;
                if (!progressByKey.TryGetValue(dto.Key ?? string.Empty, out var row)) continue;

                foreach (var bind in dto.Bindings)
                {
                    // The composite FK would reject this anyway; catching it here turns a
                    // constraint violation into a counted rejection.
                    if (!knownSet.Contains(bind.IfcElementGlobalId)) { batch.RowsRejected++; continue; }

                    var key = $"{row.Id}:{bind.IfcElementGlobalId}";
                    if (!existingByKey.TryGetValue(key, out var binding))
                    {
                        binding = new ProgressIfcBinding
                        {
                            LayerProgressId = row.Id,
                            IfcModelId = activeModel.Id,
                            IfcElementGlobalId = bind.IfcElementGlobalId,
                        };
                        _db.ProgressIfcBindings.Add(binding);
                        existingByKey[key] = binding;
                    }

                    binding.SourceRef = bind.SourceRef;
                    binding.SourceRefKind = bind.SourceRefKind;
                    binding.Strategy = bind.Strategy;
                    binding.Confidence = bind.Confidence;
                    binding.SegmentIndex = bind.SegmentIndex;
                    binding.BoundAt = DateTime.UtcNow;
                    binding.BoundByBatchId = batch.Id;
                    batch.BindingsWritten++;
                }
            }

            await _db.SaveChangesAsync();
        }

        // ----------------------------------------------------------------- metrics

        private async Task UpsertMetricsAsync(Package package, ImportBatch batch, ImportPayloadDto payload)
        {
            if (payload.Metrics is null) return;
            var m = payload.Metrics;

            // A snapshot of what the sheet claimed, tied to the batch that carried it.
            // Never the figure the dashboard shows — those stay computed from the rows.
            _db.ProjectMetrics.Add(new ProjectMetrics
            {
                ProjectId = package.ProjectId,
                PackageId = package.Id,
                ImportBatchId = batch.Id,
                IsSourceSnapshot = true,
                TotalKmTarget = m.TotalKmTarget ?? 0,
                TotalKmCompleted = m.TotalKmCompleted ?? 0,
                OverallProgressPercent = m.OverallProgressPercent ?? 0,
                SchedulePerformanceIndex = m.Spi ?? 0,
                CostPerformanceIndex = m.Cpi ?? 0,
                TotalBudgetCost = m.TotalBudgetCost ?? 0,
                TotalActualCost = m.TotalActualCost ?? 0,
                DelayedSectionsCount = m.DelayedSectionsCount ?? 0,
                CalculatedAt = ToUtc(m.CalculatedAt) ?? DateTime.UtcNow,
            });

            await _db.SaveChangesAsync();
        }

        // ------------------------------------------------------------------ helpers

        /// <summary>
        /// Identity of the whole submission: the sorted member-file hashes, so file order
        /// in the form does not change the result.
        /// </summary>
        private static string ComputeBatchHash(ImportPayloadDto payload)
        {
            var parts = payload.Files
                .Select(f => f.ContentSha256 ?? $"{f.FileName}:{f.RowCount}")
                .OrderBy(s => s, StringComparer.Ordinal);

            var joined = string.Join("|", parts) + "|mode=" + payload.Mode;
            var bytes = System.Security.Cryptography.SHA256.HashData(
                System.Text.Encoding.UTF8.GetBytes(joined));
            return Convert.ToHexString(bytes).ToLowerInvariant();
        }

        private static readonly HashSet<string> ValidStatuses =
            new(StringComparer.Ordinal) { "Completed", "In-Progress", "Delayed", "Not Started" };

        private static string NormaliseStatus(string? raw) =>
            raw is not null && ValidStatuses.Contains(raw) ? raw : "Not Started";

        private static DateTime? ToUtc(DateTime? value) =>
            value is null ? null : DateTime.SpecifyKind(value.Value, DateTimeKind.Utc);

        private static double Clamp(double v, double lo, double hi) => Math.Min(hi, Math.Max(lo, v));

        private static bool NearlyEqual(double a, double b) => Math.Abs(a - b) < 1e-9;

        private static string Truncate(string? s, int max) =>
            string.IsNullOrEmpty(s) ? string.Empty : (s.Length <= max ? s : s[..max]);

        /// <summary>Shared with the bridge importer, so both report a batch the same way.</summary>
        internal static ImportResultDto ToResult(ImportBatch b, bool alreadyImported) => new()
        {
            BatchId = b.Id,
            Status = b.Status,
            Mode = b.Mode,
            AlreadyImported = alreadyImported,
            RowsInserted = b.RowsInserted,
            RowsUpdated = b.RowsUpdated,
            RowsUnchanged = b.RowsUnchanged,
            RowsRejected = b.RowsRejected,
            RowsSuperseded = b.RowsSuperseded,
            BindingsWritten = b.BindingsWritten,
            ErrorCount = b.ErrorCount,
            WarningCount = b.WarningCount,
            FailureMessage = b.FailureMessage,
            StartedAt = b.StartedAt,
            CompletedAt = b.CompletedAt,
        };
    }
}
