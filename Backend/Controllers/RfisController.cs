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
    public record RaiseRfiRequest(
        string Title,
        string? Description,
        int ChainageFromId,
        int ChainageToId,
        int? LayerId,
        string? ComponentRef,
        string? SubComponentRef,
        double? Quantity,
        string? LocationText,
        string? Side,
        DateTime? RequiredInspectionAt,
        int? AssignedToUserId,
        /// <summary>false creates an editable draft; true raises and submits in one step.</summary>
        bool SubmitNow);

    public record AssignRfiRequest(int? UserId, string? Comment);
    public record CancelRfiRequest(string? Reason);

    /// <summary>
    /// Requests for inspection.
    ///
    /// An RFI belongs to a package and names chainages that already exist, so the register
    /// and the map are reading the same partitions the workbook defined. Every route
    /// resolves through <see cref="ProjectAccessService"/> — the id in the URL is never
    /// trusted on its own.
    /// </summary>
    [ApiController]
    [Authorize]
    public class RfisController : ControllerBase
    {
        private readonly RoadDbContext _db;
        private readonly ProjectAccessService _access;
        private readonly NumberSeriesService _numbers;

        public RfisController(RoadDbContext db, ProjectAccessService access, NumberSeriesService numbers)
        {
            _db = db;
            _access = access;
            _numbers = numbers;
        }

        // ------------------------------------------------------------ form options

        /// <summary>
        /// Everything the raise form needs: the fixed chainage partitions to choose from,
        /// the package's layer catalogue, who can be assigned, and a preview of the number.
        ///
        /// Chainages come from the imported workbook where there is one, and fall back to
        /// the segments the IFC loader recovered by clustering — so a package with a model
        /// but no chainage sheet can still raise an RFI against a real partition.
        /// </summary>
        [HttpGet("api/packages/{idOrPath}/rfi-form-options")]
        public async Task<IActionResult> FormOptions(string idOrPath)
        {
            var access = await _access.ResolvePackageAsync(User, idOrPath);
            if (access is null) return NotFound();

            var pkg = access.Package;

            var chainages = await _db.RoadChainages
                .Where(c => c.PackageId == pkg.Id)
                .OrderBy(c => c.SortOrder ?? c.SourceChainageId ?? c.Id)
                .Select(c => new ChainageOptionDto
                {
                    Id = c.Id,
                    SourceId = c.SourceChainageId,
                    StartM = c.ChainageStart,
                    EndM = c.ChainageEnd,
                    Label = c.KmLabel,
                    SectionName = c.SectionName,
                    Latitude = c.Latitude == 0 ? null : c.Latitude,
                    Longitude = c.Longitude == 0 ? null : c.Longitude,
                    Source = "excel",
                })
                .ToListAsync();

            // A label the workbook did not supply is built from the metres, so the dropdown
            // never shows a blank row.
            foreach (var c in chainages)
                if (string.IsNullOrWhiteSpace(c.Label)) c.Label = ChainageLabel(c.StartM, c.EndM);

            if (chainages.Count == 0)
                chainages = await IfcSegmentOptionsAsync(pkg.Id);

            var packageLayers = await _db.RoadLayers
                .Where(l => l.PackageId == pkg.Id)
                .OrderBy(l => l.SortOrder)
                .Select(l => new LayerOptionDto
                {
                    Id = l.Id,
                    Code = l.Code,
                    Name = l.LayerName,
                    SortOrder = l.SortOrder,
                })
                .ToListAsync();

            return Ok(new RfiFormOptionsDto
            {
                PackageId = pkg.Id,
                PackageCode = pkg.Code,
                PackageName = pkg.Name,
                ContractorName = pkg.ContractorName,
                InspectionNoticeHours = pkg.InspectionNoticeHours,
                NextRfiNo = await _numbers.PreviewAsync("rfi", pkg),
                Chainages = chainages,
                Layers = packageLayers,
                Engineers = await EngineersAsync(pkg.ProjectId),
            });
        }

        /// <summary>
        /// Segments recovered from the model's geometry, used when no chainage sheet has
        /// been imported. They are real partitions — the loader clusters element centres
        /// along the alignment — just not surveyed ones, so they carry no coordinates.
        /// </summary>
        private async Task<List<ChainageOptionDto>> IfcSegmentOptionsAsync(int packageId)
        {
            var model = await _db.IfcModels
                .FirstOrDefaultAsync(m => m.PackageId == packageId && m.IsActive);
            if (model is null) return new List<ChainageOptionDto>();

            return await _db.IfcSegments
                .Where(s => s.IfcModelId == model.Id)
                .OrderBy(s => s.SegmentIndex)
                .Select(s => new ChainageOptionDto
                {
                    // Negative ids mark a segment that has no chainage row behind it, so the
                    // client cannot mistake one for a database key it can store.
                    Id = -(s.SegmentIndex + 1),
                    SourceId = s.SegmentIndex,
                    StartM = s.StartM,
                    EndM = s.EndM,
                    Label = ChainageLabel(s.StartM, s.EndM),
                    SectionName = $"Model segment {s.SegmentIndex}",
                    Source = "ifc",
                })
                .ToListAsync();
        }

        /// <summary>
        /// Only field engineers are offered. Assigning anybody else would produce a record
        /// nobody is permitted to inspect, which reads as a broken screen rather than a
        /// rule being applied.
        /// </summary>
        private async Task<List<RfiEngineerDto>> EngineersAsync(int projectId) =>
            await _db.ProjectMembers
                .Where(m => m.ProjectId == projectId && m.IsFieldEngineer)
                .Include(m => m.User)
                .OrderBy(m => m.User!.DisplayName)
                .Select(m => new RfiEngineerDto
                {
                    UserId = m.UserId,
                    DisplayName = m.User!.DisplayName,
                    Email = m.User.Email,
                    Role = m.Role.ToString(),
                    OpenAssignedCount = _db.Rfis.Count(r =>
                        r.AssignedToUserId == m.UserId
                        && r.Status != RfiStatus.Approved
                        && r.Status != RfiStatus.Cancelled),
                })
                .ToListAsync();

        // ------------------------------------------------------------------ raise

        [HttpPost("api/packages/{idOrPath}/rfis")]
        public async Task<IActionResult> Raise(string idOrPath, [FromBody] RaiseRfiRequest request)
        {
            var access = await _access.ResolvePackageAsync(User, idOrPath);
            if (access is null) return NotFound();
            if (!access.Can(ProjectRole.Contributor)) return Forbid();

            var pkg = access.Package;
            var userId = ProjectAccessService.UserIdOf(User);

            // A field engineer inspects work; they do not offer it. Letting the same person
            // do both would put the offer and the verdict in one pair of hands, which is
            // the thing this whole separation exists to prevent.
            if (!access.IsSuperuser && access.IsFieldEngineer)
                return Conflict(new
                {
                    message = "Field engineers inspect work, they do not raise requests for it. "
                              + "Ask whoever raises requests on this package.",
                });

            var title = (request.Title ?? string.Empty).Trim();
            if (title.Length == 0)
                return BadRequest(new { message = "Describe the work being offered." });

            // Both ends must be real chainages of THIS package. Checking both against the
            // package is what stops an RFI naming a sibling package's stretch of road.
            var from = await _db.RoadChainages
                .FirstOrDefaultAsync(c => c.Id == request.ChainageFromId && c.PackageId == pkg.Id);
            var to = await _db.RoadChainages
                .FirstOrDefaultAsync(c => c.Id == request.ChainageToId && c.PackageId == pkg.Id);

            if (from is null || to is null)
                return BadRequest(new { message = "Choose the chainage range from this package's own chainages." });

            if (to.ChainageEnd < from.ChainageStart)
                return BadRequest(new { message = "Chainage to is before chainage from." });

            if (request.LayerId is int layerId
                && !await _db.RoadLayers.AnyAsync(l => l.Id == layerId && l.PackageId == pkg.Id))
                return BadRequest(new { message = "That layer does not belong to this package." });

            var side = (request.Side ?? RfiSide.NotApplicable).Trim();
            if (!RfiSide.All.Contains(side))
                return BadRequest(new { message = $"Side must be one of: {string.Join(", ", RfiSide.All)}." });

            if (request.AssignedToUserId is int assignee
                && await AssignmentProblemAsync(pkg.ProjectId, assignee) is string problem)
                return BadRequest(new { message = problem });

            var now = DateTime.UtcNow;
            var rfi = new Rfi
            {
                ProjectId = pkg.ProjectId,
                PackageId = pkg.Id,
                Title = title,
                Description = request.Description?.Trim(),
                LayerId = request.LayerId,
                ComponentRef = request.ComponentRef?.Trim(),
                SubComponentRef = request.SubComponentRef?.Trim(),
                Quantity = request.Quantity,
                ChainageFromId = from.Id,
                ChainageToId = to.Id,
                ChainageFromM = from.ChainageStart,
                ChainageToM = to.ChainageEnd,
                LocationText = request.LocationText?.Trim(),
                Side = side,
                RaisedByUserId = userId,
                AssignedToUserId = request.AssignedToUserId,
                RequiredInspectionAt = ToUtc(request.RequiredInspectionAt),
                Status = RfiStatus.Draft,
                CreatedAt = now,
                UpdatedAt = now,
            };

            // The number is minted inside the transaction that inserts the row, so a raise
            // that rolls back takes its number with it and leaves no gap in the register.
            await using var tx = await _db.Database.BeginTransactionAsync();

            if (request.SubmitNow)
            {
                rfi.Status = RfiStatus.Submitted;
                rfi.SubmittedAt = now;
                rfi.DueAt = RfiService.DueFrom(now, rfi.RequiredInspectionAt, pkg);
                rfi.RfiNo = await _numbers.NextAsync("rfi", pkg);
            }
            else
            {
                // A draft carries a provisional number so the form can show one, but it is
                // not minted from the series until submit — a number people have written
                // down must never change underneath them.
                rfi.RfiNo = $"DRAFT-{Guid.NewGuid().ToString("N")[..8].ToUpperInvariant()}";
            }

            _db.Rfis.Add(rfi);
            await _db.SaveChangesAsync();

            _db.RfiEvents.Add(new RfiEvent
            {
                RfiId = rfi.Id,
                EventType = request.SubmitNow ? "submitted" : "created",
                ToStatus = rfi.Status,
                ActorUserId = userId,
                OccurredAt = now,
            });
            if (rfi.AssignedToUserId is not null)
            {
                _db.RfiEvents.Add(new RfiEvent
                {
                    RfiId = rfi.Id,
                    EventType = "assigned",
                    ActorUserId = userId,
                    Comment = "Assigned when raised.",
                    OccurredAt = now,
                });
            }
            await _db.SaveChangesAsync();
            await tx.CommitAsync();

            return CreatedAtAction(nameof(Get), new { id = rfi.Id },
                new { id = rfi.Id, rfiNo = rfi.RfiNo, status = rfi.Status, dueAt = rfi.DueAt });
        }

        // ----------------------------------------------------------------- register

        /// <summary>
        /// The register. Scoped to a project so every package's requests sit in one list,
        /// which is how a resident engineer actually works.
        /// </summary>
        [HttpGet("api/projects/{idOrCode}/rfis")]
        public async Task<IActionResult> List(
            string idOrCode,
            [FromQuery] int? packageId,
            [FromQuery] string? stage,
            [FromQuery] int? assignedToUserId,
            [FromQuery] bool assignedToMe = false,
            [FromQuery] bool raisedByMe = false,
            [FromQuery] bool overdueOnly = false,
            [FromQuery] int? layerId = null,
            [FromQuery] string? search = null,
            [FromQuery] DateTime? dateFrom = null,
            [FromQuery] DateTime? dateTo = null,
            [FromQuery] double? chainageFromM = null,
            [FromQuery] double? chainageToM = null,
            [FromQuery] int page = 1,
            [FromQuery] int pageSize = 25)
        {
            var access = await _access.ResolveAsync(User, idOrCode);
            if (access is null) return NotFound();

            var me = ProjectAccessService.UserIdOf(User);
            var query = _db.Rfis.Where(r => r.ProjectId == access.Project.Id);

            if (packageId is int pid) query = query.Where(r => r.PackageId == pid);
            if (layerId is int lid) query = query.Where(r => r.LayerId == lid);
            if (assignedToUserId is int aid) query = query.Where(r => r.AssignedToUserId == aid);
            if (assignedToMe) query = query.Where(r => r.AssignedToUserId == me);
            if (raisedByMe) query = query.Where(r => r.RaisedByUserId == me);
            if (dateFrom is not null) query = query.Where(r => r.CreatedAt >= dateFrom);
            if (dateTo is not null) query = query.Where(r => r.CreatedAt <= dateTo);

            // OVERLAP, not containment: a search for 7.0–7.5 km finds an RFI spanning
            // 7.2–7.8, because that RFI genuinely covers part of what was asked about.
            if (chainageFromM is double cf) query = query.Where(r => r.ChainageToM >= cf);
            if (chainageToM is double ct) query = query.Where(r => r.ChainageFromM <= ct);

            if (!string.IsNullOrWhiteSpace(search))
            {
                var term = $"%{search.Trim()}%";
                query = query.Where(r =>
                    EF.Functions.ILike(r.RfiNo, term)
                    || EF.Functions.ILike(r.Title, term)
                    || (r.ComponentRef != null && EF.Functions.ILike(r.ComponentRef, term))
                    || (r.LocationText != null && EF.Functions.ILike(r.LocationText, term)));
            }

            var now = DateTime.UtcNow;
            if (overdueOnly)
                query = query.Where(r => r.Status == RfiStatus.Submitted && r.DueAt != null && r.DueAt < now);

            // Stage is a display bucket, so it is translated back into the status terms the
            // column actually holds rather than stored twice.
            query = stage switch
            {
                "draft" => query.Where(r => r.Status == RfiStatus.Draft),
                "pending_inspection" => query.Where(r => r.Status == RfiStatus.Submitted
                                                      && (r.DueAt == null || r.DueAt >= now)),
                "overdue" => query.Where(r => r.Status == RfiStatus.Submitted
                                           && r.DueAt != null && r.DueAt < now),
                "inspected" => query.Where(r => r.Status == RfiStatus.Inspected),
                "approved" => query.Where(r => r.Status == RfiStatus.Approved),
                "rejected" => query.Where(r => r.Status == RfiStatus.Rejected),
                "cancelled" => query.Where(r => r.Status == RfiStatus.Cancelled),
                _ => query,
            };

            var total = await query.CountAsync();

            // Counted across the whole filtered set, not the page, so the tabs do not change
            // meaning as you page through.
            var counts = await query
                .GroupBy(r => r.Status)
                .Select(g => new { Status = g.Key, Count = g.Count() })
                .ToListAsync();

            var rows = await query
                .OrderByDescending(r => r.CreatedAt)
                .Skip(Math.Max(0, page - 1) * Math.Clamp(pageSize, 1, 200))
                .Take(Math.Clamp(pageSize, 1, 200))
                .Include(r => r.Package)
                .Include(r => r.Layer)
                .Include(r => r.RaisedByUser)
                .Include(r => r.AssignedToUser)
                .Include(r => r.InspectedByUser)
                .Include(r => r.ApprovedByUser)
                .Include(r => r.ChainageFrom)
                .Include(r => r.ChainageTo)
                .ToListAsync();

            return Ok(new RfiListDto
            {
                Items = rows.Select(ToCard).ToList(),
                Total = total,
                Page = Math.Max(1, page),
                PageSize = Math.Clamp(pageSize, 1, 200),
                StageCounts = counts.ToDictionary(c => c.Status, c => c.Count),
            });
        }

        // ------------------------------------------------------------------- detail

        [HttpGet("api/rfis/{id:long}")]
        public async Task<IActionResult> Get(long id)
        {
            var found = await LoadAsync(id);
            if (found is null) return NotFound();
            var (access, rfi) = found.Value;

            var events = await _db.RfiEvents
                .Where(e => e.RfiId == id)
                .Include(e => e.ActorUser)
                .OrderBy(e => e.OccurredAt).ThenBy(e => e.Id)
                .Select(e => new RfiEventDto
                {
                    EventType = e.EventType,
                    FromStatus = e.FromStatus,
                    ToStatus = e.ToStatus,
                    ActorName = e.ActorUser == null ? null : e.ActorUser.DisplayName,
                    Comment = e.Comment,
                    OccurredAt = e.OccurredAt,
                })
                .ToListAsync();

            // Status AND duty together, so the screen never offers a button the server
            // would refuse — and never hides one it would allow.
            var actions = RfiService.AllowedActions(
                rfi, access.ActorFor(ProjectAccessService.UserIdOf(User)));

            // The work's own position, so the detail map has something to pin. Taken from
            // the chainage rows, which is where the surveyed coordinates live.
            double? lat = rfi.ChainageFrom?.Latitude is > 0 ? rfi.ChainageFrom.Latitude : null;
            double? lng = rfi.ChainageFrom?.Longitude is > 0 ? rfi.ChainageFrom.Longitude : null;

            return Ok(new RfiDetailDto
            {
                Header = ToCard(rfi),
                Description = rfi.Description,
                RequiredInspectionAt = rfi.RequiredInspectionAt,
                CancelledAt = rfi.CancelledAt,
                AllowedActions = actions,
                Events = events,
                Latitude = lat,
                Longitude = lng,
            });
        }

        // ------------------------------------------------------------- transitions

        /// <summary>Raises a draft. This is where the real number is minted.</summary>
        [HttpPost("api/rfis/{id:long}/submit")]
        public async Task<IActionResult> Submit(long id)
        {
            var found = await LoadAsync(id);
            if (found is null) return NotFound();
            var (access, rfi) = found.Value;
            if (!access.Can(ProjectRole.Contributor)) return Forbid();

            if (RfiService.Refuse("submit", rfi.Status) is string why)
                return Conflict(new { message = why });
            if (RfiService.RefuseByDuty("submit", rfi, access.ActorFor(ProjectAccessService.UserIdOf(User))) is string duty)
                return Conflict(new { message = duty });

            var now = DateTime.UtcNow;
            await using var tx = await _db.Database.BeginTransactionAsync();

            rfi.RfiNo = await _numbers.NextAsync("rfi", access.Package);
            rfi.Status = RfiStatus.Submitted;
            rfi.SubmittedAt = now;
            rfi.DueAt = RfiService.DueFrom(now, rfi.RequiredInspectionAt, access.Package);
            rfi.UpdatedAt = now;

            _db.RfiEvents.Add(new RfiEvent
            {
                RfiId = rfi.Id,
                EventType = "submitted",
                FromStatus = RfiStatus.Draft,
                ToStatus = RfiStatus.Submitted,
                ActorUserId = ProjectAccessService.UserIdOf(User),
                OccurredAt = now,
            });

            await _db.SaveChangesAsync();
            await tx.CommitAsync();

            return Ok(new { id = rfi.Id, rfiNo = rfi.RfiNo, status = rfi.Status, dueAt = rfi.DueAt });
        }

        /// <summary>
        /// Attaches or clears the engineer expected to inspect. Deliberately a single
        /// endpoint on the record rather than a module: assignment is one field, and
        /// passing a null user id un-assigns.
        /// </summary>
        [HttpPost("api/rfis/{id:long}/assign")]
        public async Task<IActionResult> Assign(long id, [FromBody] AssignRfiRequest request)
        {
            var found = await LoadAsync(id);
            if (found is null) return NotFound();
            var (access, rfi) = found.Value;
            if (!access.Can(ProjectRole.Contributor)) return Forbid();

            if (RfiService.Refuse("assign", rfi.Status) is string why)
                return Conflict(new { message = why });

            if (request.UserId is int uid
                && await AssignmentProblemAsync(rfi.ProjectId, uid) is string problem)
                return BadRequest(new { message = problem });

            var previous = rfi.AssignedToUserId;
            rfi.AssignedToUserId = request.UserId;
            rfi.UpdatedAt = DateTime.UtcNow;

            _db.RfiEvents.Add(new RfiEvent
            {
                RfiId = rfi.Id,
                EventType = request.UserId is null ? "unassigned" : "assigned",
                ActorUserId = ProjectAccessService.UserIdOf(User),
                Comment = request.Comment?.Trim(),
                OccurredAt = DateTime.UtcNow,
            });

            await _db.SaveChangesAsync();

            var name = request.UserId is null
                ? null
                : await _db.Users.Where(u => u.Id == request.UserId).Select(u => u.DisplayName).FirstOrDefaultAsync();

            return Ok(new { id = rfi.Id, assignedToUserId = rfi.AssignedToUserId, assignedToName = name, previous });
        }

        /// <summary>Withdraws a request. The record is kept, never deleted.</summary>
        [HttpPost("api/rfis/{id:long}/cancel")]
        public async Task<IActionResult> Cancel(long id, [FromBody] CancelRfiRequest? request)
        {
            var found = await LoadAsync(id);
            if (found is null) return NotFound();
            var (access, rfi) = found.Value;
            if (!access.Can(ProjectRole.Contributor)) return Forbid();

            if (RfiService.Refuse("cancel", rfi.Status) is string why)
                return Conflict(new { message = why });
            if (RfiService.RefuseByDuty("cancel", rfi, access.ActorFor(ProjectAccessService.UserIdOf(User))) is string duty)
                return Conflict(new { message = duty });

            var now = DateTime.UtcNow;
            var from = rfi.Status;
            rfi.Status = RfiStatus.Cancelled;
            rfi.CancelledAt = now;
            rfi.UpdatedAt = now;

            _db.RfiEvents.Add(new RfiEvent
            {
                RfiId = rfi.Id,
                EventType = "cancelled",
                FromStatus = from,
                ToStatus = RfiStatus.Cancelled,
                ActorUserId = ProjectAccessService.UserIdOf(User),
                Comment = request?.Reason?.Trim(),
                OccurredAt = now,
            });

            await _db.SaveChangesAsync();
            return Ok(new { id = rfi.Id, status = rfi.Status });
        }

        /// <summary>
        /// Why this person cannot be assigned, or null if they can. Null means allowed, so
        /// the caller reads as "if there is a problem, say it".
        /// </summary>
        private async Task<string?> AssignmentProblemAsync(int projectId, int userId)
        {
            var member = await _db.ProjectMembers
                .FirstOrDefaultAsync(m => m.ProjectId == projectId && m.UserId == userId);

            if (member is null) return "That person is not a member of this project.";

            // A superuser can inspect regardless, so they are assignable without the flag.
            var isSuper = await _db.Users
                .Where(u => u.Id == userId).Select(u => u.IsSystemAdmin).FirstOrDefaultAsync();

            return member.IsFieldEngineer || isSuper
                ? null
                : "Only a field engineer can be assigned an inspection. "
                  + "Mark them as one in the project's members first.";
        }

        // ------------------------------------------------------------------ helpers

        /// <summary>
        /// Loads an RFI and the caller's access to its project in one place, so no route can
        /// forget the membership check.
        /// </summary>
        private async Task<(ProjectAccessService.PackageAccess access, Rfi rfi)?> LoadAsync(long id)
        {
            var rfi = await _db.Rfis
                .Include(r => r.Package)
                .Include(r => r.Layer)
                .Include(r => r.RaisedByUser)
                .Include(r => r.AssignedToUser)
                .Include(r => r.InspectedByUser)
                .Include(r => r.ApprovedByUser)
                .Include(r => r.ChainageFrom)
                .Include(r => r.ChainageTo)
                .FirstOrDefaultAsync(r => r.Id == id);
            if (rfi is null) return null;

            var access = await _access.ResolvePackageAsync(User, rfi.PackageId.ToString());
            return access is null ? null : (access, rfi);
        }

        private static RfiCardDto ToCard(Rfi r) => new()
        {
            Id = r.Id,
            RfiNo = r.RfiNo,
            Title = r.Title,
            ProjectId = r.ProjectId,
            PackageId = r.PackageId,
            PackageCode = r.Package?.Code ?? string.Empty,
            PackageName = r.Package?.Name ?? string.Empty,
            ContractorName = r.Package?.ContractorName ?? string.Empty,
            Status = r.Status,
            StatusLabel = RfiService.StatusLabel(r),
            StageKey = RfiService.StageKey(r),
            Outcome = r.Outcome,
            LayerCode = r.Layer?.Code,
            LayerName = r.Layer?.LayerName,
            ComponentRef = r.ComponentRef,
            SubComponentRef = r.SubComponentRef,
            Quantity = r.Quantity,
            ChainageLabel = ChainageLabel(r.ChainageFromM, r.ChainageToM),
            ChainageFromM = r.ChainageFromM,
            ChainageToM = r.ChainageToM,
            LocationText = r.LocationText,
            Side = r.Side,
            RaisedByName = r.RaisedByUser?.DisplayName,
            AssignedToName = r.AssignedToUser?.DisplayName,
            AssignedToUserId = r.AssignedToUserId,
            InspectedByName = r.InspectedByUser?.DisplayName,
            ApprovedByName = r.ApprovedByUser?.DisplayName,
            SubmittedAt = r.SubmittedAt,
            DueAt = r.DueAt,
            InspectedAt = r.InspectedAt,
            ApprovedAt = r.ApprovedAt,
            IsOverdue = RfiService.IsOverdue(r),
            CreatedAt = r.CreatedAt,
        };

        /// <summary>
        /// `km 7+200 – 7+800`. Chainage is spoken in kilometres-plus-metres on every road
        /// job, so the register reads the way a site instruction does.
        /// </summary>
        private static string ChainageLabel(double fromM, double toM) =>
            $"km {Station(fromM)} – {Station(toM)}";

        private static string Station(double metres)
        {
            var km = (int)Math.Floor(metres / 1000.0);
            var rem = metres - (km * 1000.0);
            return $"{km}+{rem:000}";
        }

        private static DateTime? ToUtc(DateTime? value) =>
            value is null ? null : DateTime.SpecifyKind(value.Value.ToUniversalTime(), DateTimeKind.Utc);
    }
}
