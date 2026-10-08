using System;
using System.IO;
using System.Linq;
using ClosedXML.Excel;
using RoadBimBackend.Data;
using RoadBimBackend.Models;

namespace RoadBimBackend.Services
{
    public class ExcelParserService
    {
        private readonly RoadDbContext _context;

        public ExcelParserService(RoadDbContext context)
        {
            _context = context;
        }

        public int ParseAndIngestExcel(Stream fileStream)
        {
            using var workbook = new XLWorkbook(fileStream);
            var worksheet = workbook.Worksheets.First();
            var rows = worksheet.RangeUsed().RowsUsed().Skip(1); // Skip Header

            int updatedCount = 0;

            foreach (var row in rows)
            {
                try
                {
                    double startKm = row.Cell(1).GetValue<double>();
                    double endKm = row.Cell(2).GetValue<double>();
                    string layerCode = row.Cell(3).GetValue<string>().Trim().ToUpper();
                    string status = row.Cell(4).GetValue<string>().Trim();
                    double progress = row.Cell(5).GetValue<double>();

                    var chainage = _context.LegacyChainages()
                        .FirstOrDefault(c => c.ChainageStart <= startKm && c.ChainageEnd >= endKm);

                    var layer = _context.LegacyLayers()
                        .FirstOrDefault(l => l.Code == layerCode || l.LayerName.ToUpper().Contains(layerCode));

                    if (chainage != null && layer != null)
                    {
                        var prog = _context.LegacyProgress()
                            .FirstOrDefault(p => p.ChainageId == chainage.Id && p.LayerId == layer.Id);

                        if (prog != null)
                        {
                            prog.Status = status;
                            prog.ProgressPercent = progress;
                            prog.UpdatedAt = DateTime.UtcNow;
                            prog.UpdatedBy = "Excel Batch Upload";
                            updatedCount++;
                        }
                    }
                }
                catch
                {
                    // Skip malformed rows safely
                }
            }

            _context.SaveChanges();
            return updatedCount;
        }
    }
}
