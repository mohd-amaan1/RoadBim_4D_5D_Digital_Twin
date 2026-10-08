using Microsoft.AspNetCore.Authorization;
using System.Linq;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using RoadBimBackend.Data;
using RoadBimBackend.Models;

namespace RoadBimBackend.Controllers
{
    [ApiController]
    [Authorize]
    [Route("api/[controller]")]
    public class SiteHotspotsController : ControllerBase
    {
        private readonly RoadDbContext _context;

        public SiteHotspotsController(RoadDbContext context)
        {
            _context = context;
        }

        [HttpGet]
        public IActionResult GetHotspots()
        {
            var hotspots = _context.LegacyHotspots()
                .Include(h => h.Chainage)
                .OrderByDescending(h => h.InspectionDate)
                .ToList();

            return Ok(hotspots);
        }

        /// <summary>
        /// Legacy endpoint. The scope is taken from <see cref="LegacyScope"/> and never from
        /// the request body: letting a caller name its own ProjectId here would have been a
        /// way to write into another tenant, and PackageId is now required as well.
        /// </summary>
        [HttpPost]
        public IActionResult AddHotspot([FromBody] SiteHotspot hotspot)
        {
            hotspot.ProjectId = LegacyScope.DefaultProjectId(_context);
            hotspot.PackageId = LegacyScope.DefaultPackageId(_context);

            // The chainage has to belong to the same scope, or the hotspot would point at
            // another project's stretch of road.
            var chainageIsInScope = _context.LegacyChainages().Any(c => c.Id == hotspot.ChainageId);
            if (!chainageIsInScope)
                return BadRequest(new { message = "That chainage is not part of the demo corridor." });

            _context.SiteHotspots.Add(hotspot);
            _context.SaveChanges();
            return Ok(hotspot);
        }
    }
}
