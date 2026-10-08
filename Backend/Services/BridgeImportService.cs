using System;
using System.Collections.Generic;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;
using Microsoft.EntityFrameworkCore;
using RoadBimBackend.Data;
using RoadBimBackend.Models;

namespace RoadBimBackend.Services
{
    /// <summary>
    /// A bridge register as the browser parsed it: one sheet, one row per activity.
    ///
    /// Parsing stays in the browser for the same reason the road workbooks do — one
    /// implementation of the column matching and approval aliases, not two that drift. The
    /// original .xlsx travels alongside and is archived, so the server never has to take
    /// the client's word for what the file contained.
    /// </summary>
    public class BridgeImportPayloadDto
    {
        public string FileName { get; set; } = string.Empty;
        public string SheetName { get; set; } = string.Empty;
        public string? ContentSha256 { get; set; }
        public List<BridgeItemDto> Items { get; set; } = new();
        public List<IssueDto> Issues { get; set; } = new();
        public string? Summary { get; set; }
    }

    public class BridgeItemDto
    {
        public string Key { get; set; } = string.Empty;
        public int? RowNumber { get; set; }

        public string? ItemNo { get; set; }
        public string? Description { get; set; }
        public string? Uom { get; set; }
        public string? Location { get; set; }
        public double? ExecutedQuantity { get; set; }
        public string? RfiRefs { get; set; }
        public string? RfiDates { get; set; }
        public string? BillNo { get; set; }
        public string? Remarks { get; set; }

        public string? IfcGlobalId { get; set; }
        public string? ApprovalText { get; set; }

        /// <summary>approved | rejected | pending, as the browser normalised it.</summary>
        public string? Approval { get; set; }
    }

    /// <summary>Where the uploaded workbook was archived, and the hash that identifies it.</summary>
    public sealed record ArchivedWorkbook(string Sha256, long ByteSize, string StoragePath);

    /// <summary>
    /// Persists a bridge register for one package.
    ///
    /// The sheet is the whole register, so an import REPLACES the package's rows: every row
    /// present is upserted on its key, and every row no longer listed is soft-retired. It
    /// keeps the two guarantees the road importer makes:
    ///
    ///   Idempotent — rows match on their key, and a row whose every field is unchanged is
    ///   counted and not written, so re-importing the same sheet reports "0 inserted,
    ///   0 updated, N unchanged".
    ///
    ///   Atomic — the batch header commits first as 'running' so a crash leaves a visible
    ///   failed batch, then everything else commits or rolls back together.
    ///
    /// Batches, files and issues reuse the road import tables, so a bridge import shows up
    /// in the same history as any other.
    /// </summary>
    public class BridgeImportService
    {
        public const string SheetKind = "BRIDGE_ITEMS";

        private const int MaxKeyLength = 600;

        private readonly RoadDbContext _db;

        public BridgeImportService(RoadDbContext db) => _db = db;

        public async Task<ImportResultDto> ImportAsync(
            Package package, BridgeImportPayloadDto payload, ArchivedWorkbook? workbook,
            int? userId, bool force)
        {
            var contentHash = workbook?.Sha256 ?? payload.ContentSha256 ?? HashPayload(payload);

            // --- idempotency: the same file as the package's CURRENT register ------------
            //
            // Compared against the latest bridge import only, not any earlier one. Importing
            // A, then B, then A again must put A back; matching A against the history would
            // answer "already imported" and leave B's rows standing.
            if (!force)
            {
                var latest = await _db.ImportBatches
                    .Where(b => b.PackageId == package.Id
                             && b.Status == ImportStatus.Succeeded
                             && b.Files.Any(f => f.SheetKind == SheetKind))
                    .OrderByDescending(b => b.StartedAt)
                    .FirstOrDefaultAsync();

                if (latest is not null && latest.ContentSha256 == contentHash)
                    return ProjectImportService.ToResult(latest, alreadyImported: true);
            }

            // --- batch header, committed on its own so a crash leaves a trace -------------
            var batch = new ImportBatch
            {
                ProjectId = package.ProjectId,
                PackageId = package.Id,
                Mode = ImportMode.Replace,
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

                _db.ImportBatchFiles.Add(new ImportBatchFile
                {
                    ImportBatchId = batch.Id,
                    FileName = string.IsNullOrWhiteSpace(payload.FileName) ? "bridge-register.xlsx" : payload.FileName,
                    SheetName = payload.SheetName ?? string.Empty,
                    SheetKind = SheetKind,
                    RowCount = payload.Items.Count,
                    ContentSha256 = workbook?.Sha256 ?? payload.ContentSha256 ?? string.Empty,
                    ByteSize = workbook?.ByteSize ?? 0,
                    StoragePath = workbook?.StoragePath,
                });

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

                await UpsertItemsAsync(package, batch, payload);

                batch.Status = ImportStatus.Succeeded;
                batch.CompletedAt = DateTime.UtcNow;
                await _db.SaveChangesAsync();
                await tx.CommitAsync();

                return ProjectImportService.ToResult(batch, alreadyImported: false);
            }
            catch (Exception ex)
            {
                // The transaction rolled back; the failure is recorded on the header, which
                // lives outside it.
                _db.ChangeTracker.Clear();
                var failed = await _db.ImportBatches.FindAsync(batch.Id);
                if (failed is not null)
                {
                    failed.Status = ImportStatus.Failed;
                    failed.CompletedAt = DateTime.UtcNow;
                    failed.FailureMessage = Truncate(ex.Message, 1000);
                    await _db.SaveChangesAsync();
                    return ProjectImportService.ToResult(failed, alreadyImported: false);
                }
                throw;
            }
        }

        private async Task UpsertItemsAsync(Package package, ImportBatch batch, BridgeImportPayloadDto payload)
        {
            var existing = await _db.BridgeItems
                .Where(b => b.PackageId == package.Id)
                .ToDictionaryAsync(b => b.SourceKey);

            var seen = new HashSet<string>(StringComparer.Ordinal);
            var now = DateTime.UtcNow;

            foreach (var dto in payload.Items)
            {
                var key = Truncate(dto.Key?.Trim(), MaxKeyLength);

                // The browser already makes keys unique. Anything that still collides is
                // rejected and counted rather than allowed to overwrite the row before it.
                if (key.Length == 0 || !seen.Add(key))
                {
                    batch.RowsRejected++;
                    continue;
                }

                var approval = BridgeApproval.Normalise(dto.Approval ?? dto.ApprovalText);
                var guid = Clean(dto.IfcGlobalId);

                if (!existing.TryGetValue(key, out var row))
                {
                    row = new BridgeItem
                    {
                        ProjectId = package.ProjectId,
                        PackageId = package.Id,
                        SourceKey = key,
                        FirstImportBatchId = batch.Id,
                    };
                    _db.BridgeItems.Add(row);
                    existing[key] = row;
                    batch.RowsInserted++;
                }
                else if (IsUnchanged(row, dto, approval, guid))
                {
                    // Its position is refreshed without counting as a change: a row inserted
                    // above it in the sheet has not altered this one.
                    row.SourceRowNumber = dto.RowNumber;

                    if (row.SupersededAt is not null)
                    {
                        // Reviving a retired row changes what is visible, so it is an update.
                        row.SupersededAt = null;
                        row.LastImportBatchId = batch.Id;
                        batch.RowsUpdated++;
                    }
                    else
                    {
                        batch.RowsUnchanged++;
                    }
                    continue;
                }
                else
                {
                    batch.RowsUpdated++;
                }

                row.SourceRowNumber = dto.RowNumber;
                row.ItemNo = Clean(dto.ItemNo);
                row.Description = Clean(dto.Description);
                row.Uom = Clean(dto.Uom);
                row.Location = Clean(dto.Location);
                row.ExecutedQuantity = dto.ExecutedQuantity;
                row.RfiRefs = Clean(dto.RfiRefs);
                row.RfiDates = Clean(dto.RfiDates);
                row.BillNo = Clean(dto.BillNo);
                row.Remarks = Clean(dto.Remarks);
                row.IfcGlobalId = guid;
                row.ApprovalText = Clean(dto.ApprovalText);
                row.Approval = approval;
                row.LastImportBatchId = batch.Id;
                row.UpdatedAt = now;
                row.SupersededAt = null;
            }

            // The sheet is the whole register: a row it no longer lists is retired, softly,
            // so the operation stays reversible and an element's colour history is not lost.
            foreach (var row in existing.Values.Where(r => r.SupersededAt is null && !seen.Contains(r.SourceKey)))
            {
                row.SupersededAt = now;
                row.LastImportBatchId = batch.Id;
                batch.RowsSuperseded++;
            }

            await _db.SaveChangesAsync();
        }

        private static bool IsUnchanged(BridgeItem r, BridgeItemDto d, string approval, string? guid) =>
            r.ItemNo == Clean(d.ItemNo)
            && r.Description == Clean(d.Description)
            && r.Uom == Clean(d.Uom)
            && r.Location == Clean(d.Location)
            && SameNumber(r.ExecutedQuantity, d.ExecutedQuantity)
            && r.RfiRefs == Clean(d.RfiRefs)
            && r.RfiDates == Clean(d.RfiDates)
            && r.BillNo == Clean(d.BillNo)
            && r.Remarks == Clean(d.Remarks)
            && r.IfcGlobalId == guid
            && r.ApprovalText == Clean(d.ApprovalText)
            && r.Approval == approval;

        private static bool SameNumber(double? a, double? b) =>
            a is null ? b is null : b is not null && Math.Abs(a.Value - b.Value) < 1e-9;

        /// <summary>Blank is absent. Case is kept — an IFC GlobalId is case-sensitive.</summary>
        private static string? Clean(string? value) =>
            string.IsNullOrWhiteSpace(value) ? null : value.Trim();

        private static string HashPayload(BridgeImportPayloadDto payload)
        {
            var bytes = SHA256.HashData(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(payload.Items)));
            return Convert.ToHexString(bytes).ToLowerInvariant();
        }

        private static string Truncate(string? s, int max) =>
            string.IsNullOrEmpty(s) ? string.Empty : (s.Length <= max ? s : s[..max]);
    }
}
