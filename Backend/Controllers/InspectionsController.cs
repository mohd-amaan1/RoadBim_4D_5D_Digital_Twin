using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using RoadBimBackend.Data;
using RoadBimBackend.Models;
using RoadBimBackend.Services;

namespace RoadBimBackend.Controllers
{
    public record DecideRfiRequest(string? Remarks);

    /// <summary>
    /// Recording inspections, and the sign-off that follows.
    ///
    /// This is where the map gets its colour. An inspection writes a visit, mirrors its
    /// verdict onto the RFI header, then re-projects every chainage-layer cell the request
    /// covers into <c>LayerProgress</c> — the same rows the resolver and the plan map have
    /// always read. Nothing downstream had to change to make that work.
    /// </summary>
    [ApiController]
    [Authorize]
    public class InspectionsController : ControllerBase
    {
        private readonly RoadDbContext _db;
        private readonly ProjectAccessService _access;
        private readonly ProgressProjectionService _projection;
        private readonly string _photoRoot;

        /// <summary>Real site photos off a phone are large; anything past this is a mistake.</summary>
        private const long MaxPhotoBytes = 25L * 1024 * 1024;

        private static readonly HashSet<string> AllowedTypes = new(StringComparer.OrdinalIgnoreCase)
        { "image/jpeg", "image/png", "image/webp", "image/heic", "image/heif" };

        public InspectionsController(
            RoadDbContext db, ProjectAccessService access, ProgressProjectionService projection,
            IConfiguration config, IWebHostEnvironment env)
        {
            _db = db;
            _access = access;
            _projection = projection;
            _photoRoot = StoragePaths.Resolve(config["Storage:RfiPhotoRoot"], env, "rfi-photos");
        }

        /// <summary>
        /// Records a visit: the verdict, what was seen, and where the device was.
        ///
        /// Photos ride on the same multipart request rather than a second call, because a
        /// verdict saved without its evidence is the state nobody wants to be left in.
        /// </summary>
        [HttpPost("api/rfis/{id:long}/inspections")]
        [RequestSizeLimit(120L * 1024 * 1024)]
        public async Task<IActionResult> Record(
            long id,
            [FromForm] string outcome,
            [FromForm] string? remarks,
            [FromForm] double? deviceLatitude,
            [FromForm] double? deviceLongitude,
            [FromForm] double? locationAccuracyM,
            [FromForm] IFormFileCollection? photos)
        {
            var found = await LoadAsync(id);
            if (found is null) return NotFound();
            var (access, rfi) = found.Value;
            if (!access.Can(ProjectRole.Contributor)) return Forbid();

            if (RfiService.Refuse("inspect", rfi.Status) is string why)
                return Conflict(new { message = why });

            // Only the assigned field engineer, and never the person who offered the work.
            var actor = access.ActorFor(ProjectAccessService.UserIdOf(User));
            if (RfiService.RefuseByDuty("inspect", rfi, actor) is string duty)
                return Conflict(new { message = duty });

            var verdict = (outcome ?? string.Empty).Trim().ToLowerInvariant();
            if (!RfiOutcome.All.Contains(verdict))
                return BadRequest(new { message = "Outcome must be pass or fail." });

            // A refusal that says nothing is not a refusal anyone can act on.
            if (verdict == RfiOutcome.Fail && string.IsNullOrWhiteSpace(remarks))
                return BadRequest(new { message = "Say why the work was refused — a failed inspection needs remarks." });

            foreach (var photo in photos ?? (IFormFileCollection)new FormFileCollection())
            {
                if (photo.Length > MaxPhotoBytes)
                    return BadRequest(new { message = $"{photo.FileName} is larger than 25 MB." });
                if (!AllowedTypes.Contains(photo.ContentType))
                    return BadRequest(new { message = $"{photo.FileName} is not an image." });
            }

            var userId = ProjectAccessService.UserIdOf(User)!.Value;
            var now = DateTime.UtcNow;

            await using var tx = await _db.Database.BeginTransactionAsync();

            var visitNo = 1 + (await _db.RfiInspections
                .Where(i => i.RfiId == rfi.Id)
                .Select(i => (int?)i.VisitNo)
                .MaxAsync() ?? 0);

            var inspection = new RfiInspection
            {
                RfiId = rfi.Id,
                VisitNo = visitNo,
                InspectedByUserId = userId,
                InspectedAt = now,
                Outcome = verdict,
                Remarks = remarks?.Trim(),
                DeviceLatitude = deviceLatitude,
                DeviceLongitude = deviceLongitude,
                LocationAccuracyM = locationAccuracyM,
                Source = "web",
                CreatedAt = now,
            };
            _db.RfiInspections.Add(inspection);
            await _db.SaveChangesAsync();

            var saved = await StorePhotosAsync(rfi, inspection, photos, userId);

            // The header mirrors the LATEST visit — the register reads the header, and it
            // must not have to open every visit to know where a record stands.
            var from = rfi.Status;
            rfi.Status = RfiStatus.Inspected;
            rfi.Outcome = verdict;
            rfi.InspectedAt = now;
            rfi.InspectedByUserId = userId;
            rfi.UpdatedAt = now;

            _db.RfiEvents.Add(new RfiEvent
            {
                RfiId = rfi.Id,
                EventType = "inspected",
                FromStatus = from,
                ToStatus = RfiStatus.Inspected,
                ActorUserId = userId,
                Comment = $"Visit {visitNo} — {verdict}{(saved > 0 ? $", {saved} photo(s)" : "")}."
                          + (string.IsNullOrWhiteSpace(remarks) ? "" : $" {remarks.Trim()}"),
                OccurredAt = now,
            });
            await _db.SaveChangesAsync();

            // The colour change, in the same transaction as the verdict that caused it.
            var projected = await _projection.ProjectForRfiAsync(rfi);
            var bound = await _projection.RebindAsync(rfi);

            await tx.CommitAsync();

            return Ok(new
            {
                inspectionId = inspection.Id,
                visitNo,
                rfiStatus = rfi.Status,
                outcome = rfi.Outcome,
                photos = saved,
                progressRowsWritten = projected.RowsWritten,
                chainagesTouched = projected.ChainagesTouched,
                layersTouched = projected.LayersTouched,
                bindingsWritten = bound,
            });
        }

        /// <summary>
        /// Signs a verdict off, or refuses it.
        ///
        /// Separate from recording the inspection, and separate on purpose: the person who
        /// inspected cannot be the person who approves. That separation is the entire reason
        /// this is two steps rather than one.
        /// </summary>
        [HttpPost("api/rfis/{id:long}/decide")]
        public async Task<IActionResult> Decide(long id, [FromQuery] string decision, [FromBody] DecideRfiRequest? body)
        {
            var found = await LoadAsync(id);
            if (found is null) return NotFound();
            var (access, rfi) = found.Value;
            if (!access.Can(ProjectRole.Contributor)) return Forbid();

            var approving = string.Equals(decision, "approve", StringComparison.OrdinalIgnoreCase);
            var rejecting = string.Equals(decision, "reject", StringComparison.OrdinalIgnoreCase);
            if (!approving && !rejecting)
                return BadRequest(new { message = "Decision must be approve or reject." });

            if (RfiService.Refuse(approving ? "approve" : "reject", rfi.Status) is string why)
                return Conflict(new { message = why });

            var userId = ProjectAccessService.UserIdOf(User)!.Value;

            // Sign-off belongs to whoever raised the request. They offered the work, so they
            // are the one accepting the verdict on it — and since a field engineer cannot
            // raise, the inspector can never also be the approver.
            var actor = access.ActorFor(userId);
            if (RfiService.RefuseByDuty(approving ? "approve" : "reject", rfi, actor) is string duty)
                return Conflict(new { message = duty });

            var now = DateTime.UtcNow;
            var from = rfi.Status;

            await using var tx = await _db.Database.BeginTransactionAsync();

            rfi.Status = approving ? RfiStatus.Approved : RfiStatus.Rejected;
            rfi.UpdatedAt = now;
            if (approving)
            {
                rfi.ApprovedAt = now;
                rfi.ApprovedByUserId = userId;
            }

            _db.RfiEvents.Add(new RfiEvent
            {
                RfiId = rfi.Id,
                EventType = approving ? "approved" : "rejected",
                FromStatus = from,
                ToStatus = rfi.Status,
                ActorUserId = userId,
                Comment = body?.Remarks?.Trim(),
                OccurredAt = now,
            });
            await _db.SaveChangesAsync();

            var projected = await _projection.ProjectForRfiAsync(rfi);
            await tx.CommitAsync();

            return Ok(new
            {
                id = rfi.Id,
                status = rfi.Status,
                progressRowsWritten = projected.RowsWritten,
            });
        }

        /// <summary>Every visit on a request, newest last, with its photos.</summary>
        [HttpGet("api/rfis/{id:long}/inspections")]
        public async Task<IActionResult> List(long id)
        {
            var found = await LoadAsync(id);
            if (found is null) return NotFound();

            var visits = await _db.RfiInspections
                .Where(i => i.RfiId == id)
                .Include(i => i.InspectedByUser)
                .Include(i => i.Attachments)
                .OrderBy(i => i.VisitNo)
                .ToListAsync();

            return Ok(visits.Select(i => new
            {
                id = i.Id,
                visitNo = i.VisitNo,
                inspectedByName = i.InspectedByUser?.DisplayName,
                inspectedBy = i.InspectedByUserId,
                inspectedAt = i.InspectedAt,
                outcome = i.Outcome,
                remarks = i.Remarks,
                deviceLatitude = i.DeviceLatitude,
                deviceLongitude = i.DeviceLongitude,
                locationAccuracyM = i.LocationAccuracyM,
                source = i.Source,
                photos = i.Attachments.OrderBy(a => a.Id).Select(a => new
                {
                    id = a.Id,
                    fileName = a.FileName,
                    contentType = a.ContentType,
                    byteSize = a.ByteSize,
                    uploadedAt = a.UploadedAt,
                    url = $"/api/rfi-photos/{a.Id}",
                }),
            }));
        }

        /// <summary>
        /// Serves a photo. Behind the same membership check as everything else — an
        /// inspection photo is project data, not a public asset.
        /// </summary>
        [HttpGet("api/rfi-photos/{attachmentId:long}")]
        public async Task<IActionResult> Photo(long attachmentId)
        {
            var attachment = await _db.RfiAttachments
                .Include(a => a.Rfi)
                .FirstOrDefaultAsync(a => a.Id == attachmentId);
            if (attachment?.Rfi is null) return NotFound();

            var access = await _access.ResolvePackageAsync(User, attachment.Rfi.PackageId.ToString());
            if (access is null) return NotFound();

            if (!System.IO.File.Exists(attachment.StoragePath))
                return NotFound(new { message = "The stored photo is missing from disk." });

            return PhysicalFile(
                Path.GetFullPath(attachment.StoragePath),
                attachment.ContentType,
                attachment.FileName);
        }

        // ------------------------------------------------------------------ helpers

        /// <summary>
        /// Archives the photos of one visit. Identical bytes are stored once and referenced
        /// twice — a photographer who uploads the same shot to two visits should not double
        /// the disk.
        /// </summary>
        private async Task<int> StorePhotosAsync(
            Rfi rfi, RfiInspection inspection, IFormFileCollection? photos, int userId)
        {
            if (photos is null || photos.Count == 0) return 0;

            var dir = Path.Combine(_photoRoot, rfi.Id.ToString());
            Directory.CreateDirectory(dir);

            var saved = 0;
            foreach (var photo in photos)
            {
                if (photo.Length == 0) continue;

                string sha;
                await using (var stream = photo.OpenReadStream())
                    sha = Convert.ToHexString(await SHA256.HashDataAsync(stream)).ToLowerInvariant();

                var extension = Path.GetExtension(photo.FileName);
                if (string.IsNullOrWhiteSpace(extension)) extension = ".jpg";
                var path = Path.Combine(dir, $"{sha}{extension}");

                if (!System.IO.File.Exists(path))
                {
                    await using var target = System.IO.File.Create(path);
                    await using var source = photo.OpenReadStream();
                    await source.CopyToAsync(target);
                }

                _db.RfiAttachments.Add(new RfiAttachment
                {
                    RfiId = rfi.Id,
                    RfiInspectionId = inspection.Id,
                    FileName = Path.GetFileName(photo.FileName),
                    ContentType = photo.ContentType,
                    ByteSize = photo.Length,
                    StoragePath = path,
                    ContentSha256 = sha,
                    UploadedByUserId = userId,
                    UploadedAt = DateTime.UtcNow,
                });
                saved++;
            }

            await _db.SaveChangesAsync();
            return saved;
        }

        private async Task<(ProjectAccessService.PackageAccess access, Rfi rfi)?> LoadAsync(long id)
        {
            var rfi = await _db.Rfis.FirstOrDefaultAsync(r => r.Id == id);
            if (rfi is null) return null;

            var access = await _access.ResolvePackageAsync(User, rfi.PackageId.ToString());
            return access is null ? null : (access, rfi);
        }
    }
}
