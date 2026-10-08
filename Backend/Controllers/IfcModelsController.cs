using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text.Json;
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
    [ApiController]
    [Authorize]
    public class IfcModelsController : ControllerBase
    {
        private readonly RoadDbContext _db;
        private readonly ProjectAccessService _access;
        private readonly string _storageRoot;

        public IfcModelsController(
            RoadDbContext db, ProjectAccessService access,
            IConfiguration config, IWebHostEnvironment env)
        {
            _db = db;
            _access = access;
            _storageRoot = StoragePaths.Resolve(config["Storage:IfcRoot"], env, "ifc");
        }

        /// <summary>
        /// Uploads an IFC and the metadata the client's parser extracted from it.
        ///
        /// The file is archived on disk; only its path and identifying hash go in the
        /// database. Element, group, segment and material-layer rows are what make a
        /// binding meaningful without re-parsing the model.
        /// </summary>
        [HttpPost("api/packages/{idOrPath}/ifc-models")]
        [RequestSizeLimit(512L * 1024 * 1024)]
        public async Task<IActionResult> Upload(string idOrPath, IFormFile file, [FromForm] string? metadata)
        {
            var access = await _access.ResolvePackageAsync(User, idOrPath);
            if (access is null) return NotFound();
            if (!access.Can(ProjectRole.Contributor)) return Forbid();

            if (file is null || file.Length == 0)
                return BadRequest(new { message = "No IFC file uploaded." });

            var project = access.Project;
            var package = access.Package;

            // Hash first so an identical re-upload is recognised before anything is written
            string sha;
            await using (var hashStream = file.OpenReadStream())
            {
                sha = Convert.ToHexString(await SHA256.HashDataAsync(hashStream)).ToLowerInvariant();
            }

            var existing = await _db.IfcModels
                .FirstOrDefaultAsync(m => m.PackageId == package.Id && m.ContentSha256 == sha);
            if (existing is not null)
            {
                await SetActiveAsync(package.Id, existing);
                return Ok(Describe(existing, alreadyUploaded: true));
            }

            // Kept under the project directory: two packages sharing a corridor file share
            // the bytes on disk, and each still owns its own row.
            var dir = Path.Combine(_storageRoot, project.Id.ToString());
            Directory.CreateDirectory(dir);
            var storagePath = Path.Combine(dir, $"{sha}.ifc");

            if (!System.IO.File.Exists(storagePath))
            {
                await using var target = System.IO.File.Create(storagePath);
                await using var source = file.OpenReadStream();
                await source.CopyToAsync(target);
            }

            var nextVersion = 1 + await _db.IfcModels
                .Where(m => m.PackageId == package.Id)
                .Select(m => (int?)m.Version)
                .MaxAsync() ?? 1;

            IfcModelMetadataDto? meta = null;
            if (!string.IsNullOrWhiteSpace(metadata))
            {
                try
                {
                    meta = JsonSerializer.Deserialize<IfcModelMetadataDto>(metadata,
                        new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
                }
                catch (JsonException ex)
                {
                    return BadRequest(new { message = $"Model metadata is not valid JSON: {ex.Message}" });
                }
            }

            var model = new IfcModel
            {
                ProjectId = project.Id,
                PackageId = package.Id,
                Version = nextVersion,
                OriginalFileName = Path.GetFileName(file.FileName),
                StoragePath = storagePath,
                ContentSha256 = sha,
                ByteSize = file.Length,
                UploadedByUserId = ProjectAccessService.UserIdOf(User),
                SchemaName = meta?.SchemaName,
                LengthUnit = meta?.LengthUnit,
                SiteLatitude = meta?.SiteLatitude,
                SiteLongitude = meta?.SiteLongitude,
                SiteElevationM = meta?.SiteElevationM,
                ElementCount = meta?.ElementCount ?? 0,
                CorridorLengthM = meta?.CorridorLengthM,
                CorridorWidthM = meta?.CorridorWidthM,
                IsActive = false,
            };

            await using var tx = await _db.Database.BeginTransactionAsync();

            _db.IfcModels.Add(model);
            await _db.SaveChangesAsync();

            if (meta is not null) await WriteModelFactsAsync(model, meta);

            await SetActiveAsync(package.Id, model);
            await tx.CommitAsync();

            return Ok(Describe(model, alreadyUploaded: false));
        }

        private async Task WriteModelFactsAsync(IfcModel model, IfcModelMetadataDto meta)
        {
            var elementIdByGuid = new Dictionary<string, long>();

            foreach (var e in meta.Elements)
            {
                if (string.IsNullOrWhiteSpace(e.GlobalId)) continue;
                var row = new IfcElement
                {
                    IfcModelId = model.Id,
                    GlobalId = e.GlobalId,
                    ExpressId = e.ExpressId,
                    Name = e.Name,
                    IfcType = e.IfcType,
                    LayerName = e.LayerName,
                    LayerCode = e.LayerCode,
                    SegmentIndex = e.SegmentIndex,
                    BboxMinX = e.BboxMin is { Length: 3 } ? e.BboxMin[0] : null,
                    BboxMinY = e.BboxMin is { Length: 3 } ? e.BboxMin[1] : null,
                    BboxMinZ = e.BboxMin is { Length: 3 } ? e.BboxMin[2] : null,
                    BboxMaxX = e.BboxMax is { Length: 3 } ? e.BboxMax[0] : null,
                    BboxMaxY = e.BboxMax is { Length: 3 } ? e.BboxMax[1] : null,
                    BboxMaxZ = e.BboxMax is { Length: 3 } ? e.BboxMax[2] : null,
                };
                _db.IfcElements.Add(row);
            }
            await _db.SaveChangesAsync();

            foreach (var row in _db.IfcElements.Local.Where(x => x.IfcModelId == model.Id))
                elementIdByGuid[row.GlobalId] = row.Id;

            foreach (var g in meta.Groups)
            {
                if (string.IsNullOrWhiteSpace(g.GlobalId)) continue;
                var group = new IfcGroup
                {
                    IfcModelId = model.Id,
                    GlobalId = g.GlobalId,
                    Name = g.Name,
                    IfcType = g.IfcType,
                };
                _db.IfcGroups.Add(group);
                await _db.SaveChangesAsync();

                foreach (var memberGuid in g.MemberGlobalIds.Distinct())
                {
                    if (!elementIdByGuid.TryGetValue(memberGuid, out var elementId)) continue;
                    _db.IfcGroupMembers.Add(new IfcGroupMember
                    {
                        IfcGroupId = group.Id,
                        IfcElementId = elementId,
                    });
                }
            }

            foreach (var s in meta.Segments)
            {
                _db.IfcSegments.Add(new IfcSegment
                {
                    IfcModelId = model.Id,
                    SegmentIndex = s.SegmentIndex,
                    StartM = s.StartM,
                    EndM = s.EndM,
                    CentreM = s.CentreM,
                    ElementCount = s.ElementCount,
                });
            }

            foreach (var l in meta.Layers)
            {
                if (string.IsNullOrWhiteSpace(l.LayerName)) continue;
                _db.IfcModelLayers.Add(new IfcModelLayer
                {
                    IfcModelId = model.Id,
                    LayerName = l.LayerName,
                    LayerCode = l.LayerCode,
                    ThicknessMm = l.ThicknessMm,
                    MaterialType = l.MaterialType,
                    SortOrder = l.SortOrder,
                });
            }

            await _db.SaveChangesAsync();
        }

        /// <summary>
        /// A partial unique index allows only one active model per PACKAGE, so the previous
        /// one has to be cleared in the same transaction. Sibling packages keep theirs —
        /// that is what lets a project show several models on one map.
        /// </summary>
        private async Task SetActiveAsync(int packageId, IfcModel model)
        {
            var others = await _db.IfcModels
                .Where(m => m.PackageId == packageId && m.IsActive && m.Id != model.Id)
                .ToListAsync();
            foreach (var o in others) o.IsActive = false;
            await _db.SaveChangesAsync();

            model.IsActive = true;
            await _db.SaveChangesAsync();
        }

        /// <summary>
        /// Every model in the project, across all of its packages — one active per package.
        /// The viewer loads all of them, which is what draws the whole project on one map.
        /// </summary>
        [HttpGet("api/projects/{idOrCode}/ifc-models")]
        public async Task<IActionResult> List(string idOrCode)
        {
            var access = await _access.ResolveAsync(User, idOrCode);
            if (access is null) return NotFound();

            var models = await _db.IfcModels
                .Where(m => m.ProjectId == access.Project.Id)
                .OrderBy(m => m.PackageId).ThenByDescending(m => m.Version)
                .Select(m => new
                {
                    m.Id, m.PackageId, m.Version, m.OriginalFileName, m.ContentSha256, m.ByteSize,
                    m.SchemaName, m.LengthUnit, m.ElementCount,
                    m.SiteLatitude, m.SiteLongitude, m.SiteElevationM,
                    m.CorridorLengthM, m.CorridorWidthM, m.IsActive, m.UploadedAt,
                })
                .ToListAsync();

            return Ok(models);
        }

        [HttpGet("api/packages/{idOrPath}/ifc-models")]
        public async Task<IActionResult> ListForPackage(string idOrPath)
        {
            var access = await _access.ResolvePackageAsync(User, idOrPath);
            if (access is null) return NotFound();

            var models = await _db.IfcModels
                .Where(m => m.PackageId == access.Package.Id)
                .OrderByDescending(m => m.Version)
                .Select(m => new
                {
                    m.Id, m.PackageId, m.Version, m.OriginalFileName, m.ContentSha256, m.ByteSize,
                    m.SchemaName, m.LengthUnit, m.ElementCount,
                    m.SiteLatitude, m.SiteLongitude, m.SiteElevationM,
                    m.CorridorLengthM, m.CorridorWidthM, m.IsActive, m.UploadedAt,
                })
                .ToListAsync();

            return Ok(models);
        }

        [HttpGet("api/ifc-models/{id:long}/file")]
        public async Task<IActionResult> Download(long id)
        {
            var resolved = await _access.ResolveModelAsync(User, id);
            if (resolved is null) return NotFound();

            var model = resolved.Value.model;
            if (!System.IO.File.Exists(model.StoragePath))
                return NotFound(new { message = "The stored IFC file is missing from disk." });

            var stream = System.IO.File.OpenRead(model.StoragePath);
            return File(stream, "application/octet-stream", model.OriginalFileName);
        }

        [HttpGet("api/ifc-models/{id:long}/elements")]
        public async Task<IActionResult> Elements(long id, [FromQuery] string? layerCode, [FromQuery] int? segment)
        {
            var resolved = await _access.ResolveModelAsync(User, id);
            if (resolved is null) return NotFound();

            var query = _db.IfcElements.Where(e => e.IfcModelId == id);
            if (!string.IsNullOrWhiteSpace(layerCode)) query = query.Where(e => e.LayerCode == layerCode);
            if (segment is not null) query = query.Where(e => e.SegmentIndex == segment);

            var rows = await query
                .OrderBy(e => e.SegmentIndex).ThenBy(e => e.ExpressId)
                .Select(e => new
                {
                    globalId = e.GlobalId,
                    expressId = e.ExpressId,
                    name = e.Name,
                    ifcType = e.IfcType,
                    layerName = e.LayerName,
                    layerCode = e.LayerCode,
                    segmentIndex = e.SegmentIndex,
                })
                .ToListAsync();

            return Ok(rows);
        }

        [HttpGet("api/ifc-models/{id:long}/groups")]
        public async Task<IActionResult> Groups(long id)
        {
            var resolved = await _access.ResolveModelAsync(User, id);
            if (resolved is null) return NotFound();

            var rows = await _db.IfcGroups
                .Where(g => g.IfcModelId == id)
                .Select(g => new
                {
                    globalId = g.GlobalId,
                    name = g.Name,
                    memberGlobalIds = g.Members.Select(m => m.IfcElement!.GlobalId).ToList(),
                })
                .ToListAsync();

            return Ok(rows);
        }

        [HttpGet("api/ifc-models/{id:long}/layers")]
        public async Task<IActionResult> ModelLayers(long id)
        {
            var resolved = await _access.ResolveModelAsync(User, id);
            if (resolved is null) return NotFound();

            var rows = await _db.IfcModelLayers
                .Where(l => l.IfcModelId == id)
                .OrderBy(l => l.SortOrder)
                .Select(l => new
                {
                    layerName = l.LayerName,
                    layerCode = l.LayerCode,
                    thicknessMm = l.ThicknessMm,
                    materialType = l.MaterialType,
                    sortOrder = l.SortOrder,
                })
                .ToListAsync();

            return Ok(rows);
        }

        [HttpGet("api/ifc-models/{id:long}/segments")]
        public async Task<IActionResult> Segments(long id)
        {
            var resolved = await _access.ResolveModelAsync(User, id);
            if (resolved is null) return NotFound();

            var rows = await _db.IfcSegments
                .Where(s => s.IfcModelId == id)
                .OrderBy(s => s.SegmentIndex)
                .Select(s => new { s.SegmentIndex, s.StartM, s.EndM, s.CentreM, s.ElementCount })
                .ToListAsync();

            return Ok(rows);
        }

        private static object Describe(IfcModel m, bool alreadyUploaded) => new
        {
            id = m.Id,
            version = m.Version,
            originalFileName = m.OriginalFileName,
            contentSha256 = m.ContentSha256,
            elementCount = m.ElementCount,
            isActive = true,
            uploadedAt = m.UploadedAt,
            alreadyUploaded,
        };
    }
}
