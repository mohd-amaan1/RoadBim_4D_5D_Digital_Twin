using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using RoadBimBackend.Services;

namespace RoadBimBackend.Controllers
{
    [ApiController]
    [Authorize]
    [Route("api/[controller]")]
    public class AnalyticsController : ControllerBase
    {
        private readonly EVMAnalyticsService _analyticsService;

        public AnalyticsController(EVMAnalyticsService analyticsService)
        {
            _analyticsService = analyticsService;
        }

        [HttpGet("executive-summary")]
        public IActionResult GetExecutiveSummary()
        {
            var summary = _analyticsService.GetExecutiveSummary();
            return Ok(summary);
        }
    }
}
