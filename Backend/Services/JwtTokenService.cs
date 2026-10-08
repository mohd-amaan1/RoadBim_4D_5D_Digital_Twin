using System;
using System.Collections.Generic;
using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using Microsoft.Extensions.Configuration;
using Microsoft.IdentityModel.Tokens;
using RoadBimBackend.Models;

namespace RoadBimBackend.Services
{
    public class JwtOptions
    {
        public string Issuer { get; set; } = "roadbim";
        public string Audience { get; set; } = "roadbim-client";
        public string SigningKey { get; set; } = string.Empty;
        public int AccessTokenMinutes { get; set; } = 480;
    }

    public class JwtTokenService
    {
        public const string TokenVersionClaim = "tv";

        private readonly JwtOptions _options;

        public JwtTokenService(IConfiguration configuration)
        {
            _options = new JwtOptions();
            configuration.GetSection("Jwt").Bind(_options);

            if (string.IsNullOrWhiteSpace(_options.SigningKey) || _options.SigningKey.Length < 32)
            {
                // A weak or missing key would make every token forgeable, so refuse to start
                // rather than silently accepting one. Development gets a generated key that
                // is stable for the process lifetime; production must configure its own.
                throw new InvalidOperationException(
                    "Jwt:SigningKey is missing or shorter than 32 characters. Set it in " +
                    "appsettings.json or the JWT__SIGNINGKEY environment variable.");
            }
        }

        public JwtOptions Options => _options;

        public SecurityKey SecurityKey =>
            new SymmetricSecurityKey(Encoding.UTF8.GetBytes(_options.SigningKey));

        /// <summary>
        /// Issues an access token. Project membership is deliberately NOT baked into the
        /// token — it is looked up per request, so revoking access takes effect immediately
        /// instead of when the token expires.
        /// </summary>
        public (string token, DateTime expiresAt) CreateAccessToken(User user)
        {
            var expires = DateTime.UtcNow.AddMinutes(_options.AccessTokenMinutes);

            var claims = new List<Claim>
            {
                new(JwtRegisteredClaimNames.Sub, user.Id.ToString()),
                new(JwtRegisteredClaimNames.Email, user.Email),
                new(JwtRegisteredClaimNames.Jti, Guid.NewGuid().ToString("N")),
                new(ClaimTypes.NameIdentifier, user.Id.ToString()),
                new(ClaimTypes.Name, user.DisplayName),
                new(TokenVersionClaim, user.TokenVersion.ToString()),
            };

            if (user.IsSystemAdmin) claims.Add(new Claim(ClaimTypes.Role, "SystemAdmin"));

            var creds = new SigningCredentials(SecurityKey, SecurityAlgorithms.HmacSha256);

            var jwt = new JwtSecurityToken(
                issuer: _options.Issuer,
                audience: _options.Audience,
                claims: claims,
                notBefore: DateTime.UtcNow,
                expires: expires,
                signingCredentials: creds);

            return (new JwtSecurityTokenHandler().WriteToken(jwt), expires);
        }

        /// <summary>Development fallback so a fresh clone starts without configuration.</summary>
        public static string GenerateDevelopmentKey()
        {
            var bytes = RandomNumberGenerator.GetBytes(48);
            return Convert.ToBase64String(bytes);
        }
    }
}
