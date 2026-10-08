using System;
using System.Linq;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using RoadBimBackend.Data;
using RoadBimBackend.Models;
using RoadBimBackend.Services;

namespace RoadBimBackend.Controllers
{
    public record RegisterRequest(string Email, string Password, string DisplayName);
    public record LoginRequest(string Email, string Password);
    public record ChangePasswordRequest(string CurrentPassword, string NewPassword);

    [ApiController]
    [Route("api/auth")]
    public class AuthController : ControllerBase
    {
        private readonly RoadDbContext _db;
        private readonly JwtTokenService _jwt;
        private readonly DevAuthBypass _sharedAccess;

        public AuthController(RoadDbContext db, JwtTokenService jwt, DevAuthBypass sharedAccess)
        {
            _db = db;
            _jwt = jwt;
            _sharedAccess = sharedAccess;
        }

        /// <summary>
        /// The first account to register becomes the system administrator, so a fresh
        /// deployment is usable without a seeded password. Every later registration is an
        /// ordinary user with no project access until someone adds them to one.
        /// </summary>
        [AllowAnonymous]
        [HttpPost("register")]
        public async Task<IActionResult> Register([FromBody] RegisterRequest request)
        {
            var email = (request.Email ?? string.Empty).Trim().ToLowerInvariant();

            if (email.Length == 0 || !email.Contains('@'))
                return BadRequest(new { message = "A valid email address is required." });
            if ((request.Password ?? string.Empty).Length < 8)
                return BadRequest(new { message = "Password must be at least 8 characters." });
            if (await _db.Users.AnyAsync(u => u.Email == email))
                return Conflict(new { message = "An account with that email already exists." });

            var isFirstUser = !await _db.Users.AnyAsync();

            var user = new User
            {
                Email = email,
                DisplayName = string.IsNullOrWhiteSpace(request.DisplayName) ? email : request.DisplayName.Trim(),
                PasswordHash = BCrypt.Net.BCrypt.HashPassword(request.Password),
                IsSystemAdmin = isFirstUser,
            };

            _db.Users.Add(user);
            await _db.SaveChangesAsync();

            return Ok(IssueToken(user));
        }

        [AllowAnonymous]
        [HttpPost("login")]
        public async Task<IActionResult> Login([FromBody] LoginRequest request)
        {
            var email = (request.Email ?? string.Empty).Trim().ToLowerInvariant();
            var user = await _db.Users.FirstOrDefaultAsync(u => u.Email == email);

            // One message for both "no such user" and "wrong password", so the endpoint
            // cannot be used to find out which addresses have accounts.
            if (user is null || !user.IsActive ||
                !BCrypt.Net.BCrypt.Verify(request.Password ?? string.Empty, user.PasswordHash))
            {
                return Unauthorized(new { message = "Email or password is incorrect." });
            }

            user.LastLoginAt = DateTime.UtcNow;
            await _db.SaveChangesAsync();

            return Ok(IssueToken(user));
        }

        [Authorize]
        [HttpGet("me")]
        public async Task<IActionResult> Me()
        {
            var userId = ProjectAccessService.UserIdOf(User);
            var user = await _db.Users.FindAsync(userId);
            if (user is null) return Unauthorized();

            var memberships = await _db.ProjectMembers
                .Where(m => m.UserId == user.Id)
                .Include(m => m.Project)
                .Select(m => new
                {
                    projectId = m.ProjectId,
                    code = m.Project!.Code,
                    name = m.Project.Name,
                    role = m.Role.ToString(),
                })
                .ToListAsync();

            return Ok(new
            {
                id = user.Id,
                email = user.Email,
                displayName = user.DisplayName,
                isSystemAdmin = user.IsSystemAdmin,
                projects = memberships,

                // Lets the client discover the mode instead of being configured for it
                // separately — one switch on the server, and the UI follows. It is also what
                // puts the warning on screen, so nobody forgets sign-in is off.
                authDisabled = _sharedAccess.Enabled,
            });
        }

        [Authorize]
        [HttpPost("change-password")]
        public async Task<IActionResult> ChangePassword([FromBody] ChangePasswordRequest request)
        {
            var userId = ProjectAccessService.UserIdOf(User);
            var user = await _db.Users.FindAsync(userId);
            if (user is null) return Unauthorized();

            if (!BCrypt.Net.BCrypt.Verify(request.CurrentPassword ?? string.Empty, user.PasswordHash))
                return BadRequest(new { message = "Current password is incorrect." });
            if ((request.NewPassword ?? string.Empty).Length < 8)
                return BadRequest(new { message = "New password must be at least 8 characters." });

            user.PasswordHash = BCrypt.Net.BCrypt.HashPassword(request.NewPassword);
            // Invalidates every token issued before this moment
            user.TokenVersion++;
            await _db.SaveChangesAsync();

            return Ok(IssueToken(user));
        }

        private object IssueToken(User user)
        {
            var (token, expiresAt) = _jwt.CreateAccessToken(user);
            return new
            {
                token,
                expiresAt,
                user = new
                {
                    id = user.Id,
                    email = user.Email,
                    displayName = user.DisplayName,
                    isSystemAdmin = user.IsSystemAdmin,
                },
            };
        }
    }
}
