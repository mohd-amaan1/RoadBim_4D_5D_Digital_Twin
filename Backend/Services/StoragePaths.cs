using System.IO;
using Microsoft.AspNetCore.Hosting;

namespace RoadBimBackend.Services
{
    /// <summary>
    /// Uploaded files live on disk; only their path and hash go in the database. A relative
    /// setting is resolved against the content root so the location does not depend on the
    /// working directory the process happened to start in.
    /// </summary>
    public static class StoragePaths
    {
        public static string Resolve(string? configured, IWebHostEnvironment env, string fallbackLeaf)
        {
            var value = string.IsNullOrWhiteSpace(configured)
                ? Path.Combine("Storage", fallbackLeaf)
                : configured;

            return Path.IsPathRooted(value)
                ? value
                : Path.GetFullPath(Path.Combine(env.ContentRootPath, value));
        }
    }
}
