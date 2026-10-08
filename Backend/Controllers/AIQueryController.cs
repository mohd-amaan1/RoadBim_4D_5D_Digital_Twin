using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using RoadBimBackend.Models;
using RoadBimBackend.Services;

namespace RoadBimBackend.Controllers
{
    [ApiController]
    [Authorize]
    [Route("api/[controller]")]
    public class AIQueryController : ControllerBase
    {
        private readonly AIQueryService _aiService;

        public AIQueryController(AIQueryService aiService)
        {
            _aiService = aiService;
        }

        [HttpPost("ask")]
        public IActionResult AskAI([FromBody] AIQueryRequest request)
        {
            if (string.IsNullOrWhiteSpace(request.Question))
                return BadRequest("Question cannot be empty.");

            var response = _aiService.ProcessNaturalLanguageQuery(request.Question);
            return Ok(response);
        }
    }
}
