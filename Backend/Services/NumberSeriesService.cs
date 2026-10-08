using System;
using System.Linq;
using System.Threading.Tasks;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Npgsql;
using RoadBimBackend.Data;
using RoadBimBackend.Models;

namespace RoadBimBackend.Services
{
    /// <summary>
    /// Mints document numbers like <c>RFI/28082026/CW1-1/18</c>.
    ///
    /// Ported from the MoRTM platform, and the one part worth porting closely is how the
    /// counter advances: a single <c>UPDATE … RETURNING</c> on the series row, run on the
    /// caller's own connection inside the caller's transaction. A read-then-write would
    /// hand two simultaneous raises the same number, and running it on a separate
    /// connection would escape the transaction — so a rolled-back raise would burn a
    /// number and leave a gap in the register.
    /// </summary>
    public class NumberSeriesService
    {
        private readonly RoadDbContext _db;

        public NumberSeriesService(RoadDbContext db) => _db = db;

        /// <summary>
        /// Advances the counter and returns the next number. Must be called inside the same
        /// transaction as the insert that consumes it.
        /// </summary>
        public async Task<string> NextAsync(string entityType, Package package)
        {
            var series = await FindOrCreateAsync(entityType, package);

            // Increment and read in ONE statement, so the row lock serialises concurrent
            // raises. Executed as a bare DbCommand rather than through EF: EF composes a
            // SELECT around raw SQL the moment it is enumerated, and UPDATE … RETURNING is
            // not composable — it throws at runtime.
            const string sql = """
                update "NumberSeries"
                   set "CurrentSeq" = case when
                           ("ResetCycle" = 'daily'
                                and ("LastResetOn" is null or "LastResetOn"::date < current_date))
                        or ("ResetCycle" = 'monthly'
                                and ("LastResetOn" is null
                                     or date_trunc('month', "LastResetOn")
                                      < date_trunc('month', current_date::timestamp)))
                        or ("ResetCycle" = 'yearly'
                                and ("LastResetOn" is null
                                     or extract(year from "LastResetOn")
                                      < extract(year from current_date)))
                       then 1 else "CurrentSeq" + 1 end,
                       "LastResetOn" = current_date
                 where "Id" = @p0
                returning "CurrentSeq"
                """;

            var connection = _db.Database.GetDbConnection();
            await _db.Database.OpenConnectionAsync();

            await using var command = connection.CreateCommand();
            command.CommandText = sql;
            command.Transaction = _db.Database.CurrentTransaction?.GetDbTransaction();
            command.Parameters.Add(new NpgsqlParameter("p0", series.Id));

            var seq = (long)(await command.ExecuteScalarAsync()
                ?? throw new InvalidOperationException(
                    $"Number series {series.Id} vanished mid-transaction."));

            return Format(series, package.Code, seq, DateTime.UtcNow);
        }

        /// <summary>
        /// What the next number would look like, without consuming it.
        ///
        /// The form shows this so a raiser knows what they are about to create — but it is
        /// a preview, not a reservation. Two people looking at the same preview both get a
        /// real, different number when they submit.
        /// </summary>
        public async Task<string> PreviewAsync(string entityType, Package package)
        {
            var series = await FindAsync(entityType, package.Id, package.ProjectId);
            if (series is null)
            {
                // Nothing minted yet for this package, so the first number is what a fresh
                // series would produce.
                var provisional = DefaultSeries(entityType, package);
                return Format(provisional, package.Code, 1, DateTime.UtcNow);
            }
            return Format(series, package.Code, series.CurrentSeq + 1, DateTime.UtcNow);
        }

        /// <summary>A package-level series wins over a project-level fallback.</summary>
        private async Task<NumberSeries?> FindAsync(string entityType, int packageId, int projectId) =>
            await _db.NumberSeries
                .Where(s => s.EntityType == entityType && s.IsActive
                            && (s.PackageId == packageId
                                || (s.PackageId == null && s.ProjectId == projectId)))
                .OrderBy(s => s.PackageId == null)   // package scope first
                .FirstOrDefaultAsync();

        /// <summary>
        /// Packages are created through the API and nobody configures numbering by hand, so
        /// the series is created on first use rather than making the first raise fail.
        ///
        /// Creation has to be atomic, not read-then-insert. The very first raises against a
        /// new package are exactly the ones most likely to arrive together, and a plain
        /// `if (missing) insert` loses that race: every caller sees nothing, every caller
        /// inserts, and all but one dies on the unique index. `ON CONFLICT … DO UPDATE`
        /// makes the insert idempotent and still return the row, so whoever loses the race
        /// simply gets the series the winner created.
        /// </summary>
        private async Task<NumberSeries> FindOrCreateAsync(string entityType, Package package)
        {
            var found = await FindAsync(entityType, package.Id, package.ProjectId);
            if (found is not null) return found;

            var seed = DefaultSeries(entityType, package);

            // DO UPDATE rather than DO NOTHING: on conflict, DO NOTHING returns no row at
            // all, so there would be nothing to read back.
            const string sql = """
                insert into "NumberSeries"
                    ("EntityType", "PackageId", "ProjectId", "Prefix", "Pattern",
                     "SeqPadding", "ResetCycle", "CurrentSeq", "IsActive", "CreatedAt")
                values (@p0, @p1, @p2, @p3, @p4, @p5, @p6, 0, true, now())
                on conflict ("EntityType", "PackageId") where "PackageId" is not null and "IsActive"
                do update set "EntityType" = excluded."EntityType"
                returning "Id"
                """;

            var connection = _db.Database.GetDbConnection();
            await _db.Database.OpenConnectionAsync();

            await using var command = connection.CreateCommand();
            command.CommandText = sql;
            command.Transaction = _db.Database.CurrentTransaction?.GetDbTransaction();
            command.Parameters.Add(new NpgsqlParameter("p0", seed.EntityType));
            command.Parameters.Add(new NpgsqlParameter("p1", seed.PackageId!.Value));
            command.Parameters.Add(new NpgsqlParameter("p2", seed.ProjectId!.Value));
            command.Parameters.Add(new NpgsqlParameter("p3", seed.Prefix));
            command.Parameters.Add(new NpgsqlParameter("p4", seed.Pattern));
            command.Parameters.Add(new NpgsqlParameter("p5", seed.SeqPadding));
            command.Parameters.Add(new NpgsqlParameter("p6", seed.ResetCycle));

            var id = (int)(await command.ExecuteScalarAsync()
                ?? throw new InvalidOperationException("Could not create a number series."));

            seed.Id = id;
            return seed;
        }

        private static NumberSeries DefaultSeries(string entityType, Package package) => new()
        {
            EntityType = entityType,
            PackageId = package.Id,
            ProjectId = package.ProjectId,
            Prefix = entityType.ToUpperInvariant(),
            Pattern = "{PREFIX}/{DDMMYYYY}/{PACKAGE}/{SEQ}",
            SeqPadding = 2,
            ResetCycle = NumberSeriesReset.Never,
            CurrentSeq = 0,
            IsActive = true,
        };

        private static string Format(NumberSeries series, string packageCode, long seq, DateTime now) =>
            series.Pattern
                .Replace("{PREFIX}", series.Prefix)
                .Replace("{DDMMYYYY}", now.ToString("ddMMyyyy"))
                .Replace("{YYYY}", now.ToString("yyyy"))
                .Replace("{YY}", now.ToString("yy"))
                .Replace("{MM}", now.ToString("MM"))
                .Replace("{PACKAGE}", packageCode)
                .Replace("{SEQ}", seq.ToString().PadLeft(Math.Clamp(series.SeqPadding, 1, 10), '0'));
    }
}
