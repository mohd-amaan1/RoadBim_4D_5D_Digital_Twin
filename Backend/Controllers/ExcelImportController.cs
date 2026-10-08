using Microsoft.AspNetCore.Authorization;
using System.IO;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using RoadBimBackend.Services;

namespace RoadBimBackend.Controllers
{
    [ApiController]
    [Authorize]
    [Route("api/[controller]")]
    public class ExcelImportController : ControllerBase
    {
        private readonly ExcelParserService _excelService;

        public ExcelImportController(ExcelParserService excelService)
        {
            _excelService = excelService;
        }

        [HttpPost("upload")]
        public IActionResult UploadExcel(IFormFile file)
        {
            if (file == null || file.Length == 0)
                return BadRequest("No Excel file uploaded.");

            using var stream = file.OpenReadStream();
            int updatedCount = _excelService.ParseAndIngestExcel(stream);

            return Ok(new
            {
                Success = true,
                Message = $"Successfully ingested Excel progress sheet. Updated {updatedCount} road layer segments.",
                UpdatedSegments = updatedCount
            });
        }
    }
}
