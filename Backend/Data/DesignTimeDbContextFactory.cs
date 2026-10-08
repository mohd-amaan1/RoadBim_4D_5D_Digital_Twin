using System;
using System.IO;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;
using Microsoft.Extensions.Configuration;

namespace RoadBimBackend.Data
{
    /// <summary>
    /// Lets `dotnet ef` build a context without starting the web host, which would
    /// otherwise demand a JWT signing key and a reachable database just to generate a
    /// migration file.
    /// </summary>
    public class DesignTimeDbContextFactory : IDesignTimeDbContextFactory<RoadDbContext>
    {
        public RoadDbContext CreateDbContext(string[] args)
        {
            var configuration = new ConfigurationBuilder()
                .SetBasePath(Directory.GetCurrentDirectory())
                .AddJsonFile("appsettings.json", optional: true)
                .AddEnvironmentVariables()
                .Build();

            var connectionString = configuration.GetConnectionString("DefaultConnection")
                ?? "Host=localhost;Port=5432;Database=roadbimtwindb;Username=postgres;Password=post125";

            var options = new DbContextOptionsBuilder<RoadDbContext>()
                .UseNpgsql(connectionString)
                .Options;

            return new RoadDbContext(options);
        }
    }
}
