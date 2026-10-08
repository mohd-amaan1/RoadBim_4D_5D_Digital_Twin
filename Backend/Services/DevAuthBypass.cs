using System;
using System.Collections.Generic;
using System.Linq;
using System.Security.Claims;
using System.Text.Encodings.Web;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Authentication;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using RoadBimBackend.Data;
using RoadBimBackend.Models;

namespace RoadBimBackend.Services
{
    /// <summary>
    /// TEMPORARY SHARED ACCESS — sign-in turned off.
    ///
    /// Switched on with <c>Auth:Disabled = true</c> (or <c>AUTH__DISABLED=true</c>). While it
    /// is on, every request is authenticated as one shared system-administrator identity, so
    /// anybody who can reach the URL sees every project and package and can change all of it.
    ///
    /// It works by supplying an IDENTITY rather than by removing the checks. Nothing else in
    /// the codebase changes: <see cref="ProjectAccessService"/> still resolves access the same
    /// way, controllers keep their <c>[Authorize]</c>, and writes that need a user id — who
    /// raised an RFI, who recorded an inspection, who imported a batch — still get a real
    /// <see cref="User"/> row to point at. Stripping the attributes instead would have left
    /// <c>UserIdOf</c> returning null and broken every one of those.
    ///
    /// Consequences worth knowing while it is on:
    ///   * Everyone is the same person, so the RFI separation of duties does not apply —
    ///     the same session can raise, inspect and approve one request.
    ///   * Bearer tokens are ignored: this scheme is the default, so a real sign-in no longer
    ///     decides who you are.
    ///
    /// Turn it off by setting <c>Auth:Disabled</c> back to false and restarting.
    /// </summary>
    public sealed class DevAuthBypass
    {
        public const string SchemeName = "SharedAccessBypass";

        /// <summary>Fallback account, only created when the database has no users at all.</summary>
        public const string FallbackEmail = "shared-access@local";

        public bool Enabled { get; init; }

        public int UserId { get; private set; }
        public string Email { get; private set; } = string.Empty;
        public string DisplayName { get; private set; } = string.Empty;

        /// <summary>Enabled AND an identity has been resolved. The handler refuses without both.</summary>
        public bool Ready => Enabled && UserId > 0;

        public void Adopt(User user)
        {
            UserId = user.Id;
            Email = user.Email;
            DisplayName = user.DisplayName;
        }

        /// <summary>
        /// The account every anonymous request runs as.
        ///
        /// An existing system administrator is preferred — that is the person whose projects
        /// are being shared, so records created during the session are attributed to them
        /// rather than to a stranger the team has never heard of. Only a database with no
        /// users at all gets a new account, and it is given an unusable random password so it
        /// cannot also become a way in through the ordinary login.
        /// </summary>
        public static User EnsureUser(RoadDbContext db)
        {
            var existing =
                db.Users.Where(u => u.IsSystemAdmin && u.IsActive).OrderBy(u => u.Id).FirstOrDefault()
                ?? db.Users.Where(u => u.IsActive).OrderBy(u => u.Id).FirstOrDefault();

            if (existing is not null) return existing;

            var user = new User
            {
                Email = FallbackEmail,
                DisplayName = "Shared access",
                PasswordHash = BCrypt.Net.BCrypt.HashPassword(Guid.NewGuid().ToString("N")),
                IsSystemAdmin = true,
                IsActive = true,
            };

            db.Users.Add(user);
            db.SaveChanges();
            return user;
        }
    }

    /// <summary>
    /// Authenticates every request as <see cref="DevAuthBypass"/>'s shared identity.
    ///
    /// The claims are exactly the ones <see cref="JwtTokenService"/> issues and the rest of
    /// the code reads — subject, display name, email and the SystemAdmin role — so no
    /// controller or service can tell the difference between this and a signed-in superuser.
    /// </summary>
    public sealed class DevAuthBypassHandler : AuthenticationHandler<AuthenticationSchemeOptions>
    {
        private readonly DevAuthBypass _bypass;

        public DevAuthBypassHandler(
            IOptionsMonitor<AuthenticationSchemeOptions> options,
            ILoggerFactory logger,
            UrlEncoder encoder,
            DevAuthBypass bypass)
            : base(options, logger, encoder)
        {
            _bypass = bypass;
        }

        protected override Task<AuthenticateResult> HandleAuthenticateAsync()
        {
            // Not ready means the startup lookup never ran — usually the database was
            // unreachable. Answering 401 is right: pretending to be somebody whose id we do
            // not have would fail later, deeper, and less clearly.
            if (!_bypass.Ready) return Task.FromResult(AuthenticateResult.NoResult());

            var claims = new List<Claim>
            {
                new(ClaimTypes.NameIdentifier, _bypass.UserId.ToString()),
                new(ClaimTypes.Name, _bypass.DisplayName),
                new(ClaimTypes.Email, _bypass.Email),
                new(ClaimTypes.Role, "SystemAdmin"),
            };

            var identity = new ClaimsIdentity(claims, Scheme.Name);
            var ticket = new AuthenticationTicket(new ClaimsPrincipal(identity), Scheme.Name);
            return Task.FromResult(AuthenticateResult.Success(ticket));
        }
    }
}
