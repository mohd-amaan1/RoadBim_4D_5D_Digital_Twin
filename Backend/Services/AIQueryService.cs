using System;
using System.Collections.Generic;
using System.Linq;
using Microsoft.EntityFrameworkCore;
using RoadBimBackend.Data;
using RoadBimBackend.Models;

namespace RoadBimBackend.Services
{
    public class AIQueryService
    {
        private readonly RoadDbContext _context;

        public AIQueryService(RoadDbContext context)
        {
            _context = context;
        }

        public AIQueryResponse ProcessNaturalLanguageQuery(string question)
        {
            string q = question.ToLower();

            if (q.Contains("delay") || q.Contains("behind") || q.Contains("slow"))
            {
                var delayed = _context.LegacyProgress()
                    .Include(p => p.Chainage)
                    .Include(p => p.Layer)
                    .Where(p => p.Status == "Delayed")
                    .ToList();

                var chainageLabels = delayed.Select(d => d.Chainage?.KmLabel ?? "").Distinct().ToList();

                return new AIQueryResponse
                {
                    Answer = $"Found {delayed.Count} delayed layer segments across the 100 KM alignment. Primary bottleneck is in DBM & WMM layers due to material transport delays.",
                    RelatedChainages = chainageLabels.Take(5).ToList(),
                    SuggestedAction = "Reallocate bitumen paving machinery from Segment 20 to delayed KM 040-050 zone."
                };
            }

            if (q.Contains("cost") || q.Contains("budget") || q.Contains("overrun"))
            {
                var totalBudget = _context.LegacyProgress().Sum(p => p.BudgetCost);
                var totalActual = _context.LegacyProgress().Sum(p => p.ActualCost);
                var diff = totalActual - totalBudget;

                return new AIQueryResponse
                {
                    Answer = $"Current total project cost is ${(totalActual / 1000000m):0.00}M against planned ${(totalBudget / 1000000m):0.00}M. Net variance is ${(diff / 100000m):0.00} Lakhs due to rock blasting excavation at KM 45.",
                    RelatedChainages = new List<string> { "KM 042 - KM 046", "KM 080 - KM 085" },
                    SuggestedAction = "Review contractor claims for Subgrade excavation variation."
                };
            }

            if (q.Contains("completion") || q.Contains("when") || q.Contains("finish"))
            {
                return new AIQueryResponse
                {
                    Answer = "At current velocity of 2.4 KM/week, all 5 layers across 100 KM are projected to complete by August 28, 2026, which is 12 days ahead of contract deadline.",
                    RelatedChainages = new List<string> { "KM 000 - KM 100" },
                    SuggestedAction = "Maintain current 2-shift work cycle on Bituminous Concrete surface laying."
                };
            }

            return new AIQueryResponse
            {
                Answer = "100 KM Highway Corridor Digital Twin is active. Overall progress is 62.4% with Subgrade 100% complete and Asphalt Surface Course 12% complete.",
                RelatedChainages = new List<string> { "KM 000 - KM 100" },
                SuggestedAction = "Use 4D Timeline scrubber to visually inspect planned vs actual layer progress."
            };
        }
    }
}
