using System.Security.Claims;
using System.Text;
using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Builder;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.IdentityModel.Tokens;
using Microsoft.OpenApi.Models;
using RoadBimBackend.Data;
using RoadBimBackend.Models;
using RoadBimBackend.Services;

var builder = WebApplication.CreateBuilder(args);

// 1. PostgreSQL
var connectionString = builder.Configuration.GetConnectionString("DefaultConnection")
    ?? "Host=localhost;Port=5432;Database=roadbimtwindb;Username=postgres;Password=post125";

builder.Services.AddDbContext<RoadDbContext>(options => options.UseNpgsql(connectionString));

// 1b. TEMPORARY: sign-in disabled for a shared session. See Services/DevAuthBypass.cs.
//     Every request runs as one shared system administrator, so the whole team sees every
//     project and package without an account. Set Auth:Disabled back to false to restore
//     normal sign-in — nothing else has to change.
var authDisabled = builder.Configuration.GetValue<bool>("Auth:Disabled");
var sharedAccess = new DevAuthBypass { Enabled = authDisabled };
builder.Services.AddSingleton(sharedAccess);

// 2. A signing key is required. Development generates one at startup so a fresh clone
//    runs; it changes per process, which logs everyone out on restart — deliberate, so a
//    throwaway key is never mistaken for a configured one.
//
//    Shared access generates one too. Tokens are not what identifies anybody while it is
//    on, but JwtTokenService is still constructed and still refuses a missing key, so
//    demanding a configured secret here would only block a mode that never uses it.
if (string.IsNullOrWhiteSpace(builder.Configuration["Jwt:SigningKey"]))
{
    if (builder.Environment.IsDevelopment() || authDisabled)
    {
        // appsettings.Development.json normally supplies this; generating one keeps a
        // fresh clone runnable, at the cost of invalidating tokens on every restart.
        builder.Configuration["Jwt:SigningKey"] = JwtTokenService.GenerateDevelopmentKey();
        Console.WriteLine("[Startup] No Jwt:SigningKey configured — generated one for this process. " +
                          "Tokens will not survive a restart; set Jwt:SigningKey in appsettings.Development.json.");
    }
    else
    {
        throw new InvalidOperationException(
            "Jwt:SigningKey must be configured outside Development.\n" +
            "  Running locally?  dotnet run  — Properties/launchSettings.json sets\n" +
            "                    ASPNETCORE_ENVIRONMENT=Development for you.\n" +
            "  Deploying?        set JWT__SIGNINGKEY to a secret of at least 32 characters.");
    }
}

// 3. Application services
builder.Services.AddScoped<EVMAnalyticsService>();
builder.Services.AddScoped<ExcelParserService>();
builder.Services.AddScoped<AIQueryService>();
builder.Services.AddScoped<ProjectAccessService>();
builder.Services.AddScoped<ProjectImportService>();
builder.Services.AddScoped<NumberSeriesService>();
builder.Services.AddScoped<ProgressProjectionService>();
builder.Services.AddScoped<BridgeImportService>();
builder.Services.AddSingleton<JwtTokenService>();

// 4. Authentication
var jwtOptions = new JwtOptions();
builder.Configuration.GetSection("Jwt").Bind(jwtOptions);

// While shared access is on, the bypass is the DEFAULT scheme, which is what makes an
// anonymous request authenticated. JWT stays registered so /api/auth/login keeps working
// and the switch is one line to undo — but a bearer token no longer decides who you are.
var authentication = builder.Services
    .AddAuthentication(authDisabled ? DevAuthBypass.SchemeName : JwtBearerDefaults.AuthenticationScheme);

if (authDisabled)
    authentication.AddScheme<AuthenticationSchemeOptions, DevAuthBypassHandler>(DevAuthBypass.SchemeName, null);

authentication
    .AddJwtBearer(options =>
    {
        options.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateIssuer = true,
            ValidateAudience = true,
            ValidateLifetime = true,
            ValidateIssuerSigningKey = true,
            ValidIssuer = jwtOptions.Issuer,
            ValidAudience = jwtOptions.Audience,
            IssuerSigningKey = new SymmetricSecurityKey(
                Encoding.UTF8.GetBytes(builder.Configuration["Jwt:SigningKey"]!)),
            ClockSkew = TimeSpan.FromMinutes(1),
        };

        options.Events = new JwtBearerEvents
        {
            // Membership is never carried in the token, but the account's token version is.
            // Checking it here means a password change or a forced sign-out invalidates
            // tokens immediately instead of when they expire.
            OnTokenValidated = async context =>
            {
                var db = context.HttpContext.RequestServices.GetRequiredService<RoadDbContext>();
                var idClaim = context.Principal?.FindFirstValue(ClaimTypes.NameIdentifier);

                if (!int.TryParse(idClaim, out var userId))
                {
                    context.Fail("Token carries no usable subject.");
                    return;
                }

                var user = await db.Users.AsNoTracking().FirstOrDefaultAsync(u => u.Id == userId);
                if (user is null || !user.IsActive)
                {
                    context.Fail("Account is disabled or no longer exists.");
                    return;
                }

                var tv = context.Principal?.FindFirstValue(JwtTokenService.TokenVersionClaim);
                if (!int.TryParse(tv, out var tokenVersion) || tokenVersion != user.TokenVersion)
                    context.Fail("Token has been superseded. Sign in again.");
            },
        };
    });

builder.Services.AddAuthorization();

// 5. Controllers, JSON and Swagger
builder.Services.AddControllers()
    .AddJsonOptions(options =>
    {
        options.JsonSerializerOptions.ReferenceHandler = ReferenceHandler.IgnoreCycles;
        options.JsonSerializerOptions.DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull;
    });

builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen(options =>
{
    options.SwaggerDoc("v1", new OpenApiInfo { Title = "RoadBIM 4D/5D API", Version = "v1" });
    options.AddSecurityDefinition("Bearer", new OpenApiSecurityScheme
    {
        Name = "Authorization",
        Type = SecuritySchemeType.Http,
        Scheme = "bearer",
        BearerFormat = "JWT",
        In = ParameterLocation.Header,
        Description = "Paste the token returned by /api/auth/login.",
    });
    options.AddSecurityRequirement(new OpenApiSecurityRequirement
    {
        {
            new OpenApiSecurityScheme
            {
                Reference = new OpenApiReference { Type = ReferenceType.SecurityScheme, Id = "Bearer" },
            },
            Array.Empty<string>()
        },
    });
});

// 6. CORS. Credentials are carried in the Authorization header, not cookies, so an
//    origin allow-list plus bearer tokens is the boundary.
var allowedOrigins = builder.Configuration.GetSection("Cors:AllowedOrigins").Get<string[]>()
    ?? new[] { "http://localhost:5173", "http://localhost:3000", "http://localhost:4173" };

builder.Services.AddCors(options =>
{
    options.AddPolicy("AllowReactApp", policy => policy
        .WithOrigins(allowedOrigins)
        .AllowAnyHeader()
        .AllowAnyMethod()
        .WithExposedHeaders("Content-Disposition"));
});

var app = builder.Build();

app.UseCors("AllowReactApp");

// 7. Schema migration. EnsureCreated() could never alter the existing tables, so the
//    database is now managed by EF migrations with the pre-existing schema baselined.
using (var scope = app.Services.CreateScope())
{
    var context = scope.ServiceProvider.GetRequiredService<RoadDbContext>();
    try
    {
        context.Database.Migrate();

        // Resolved straight after Migrate and before seeding: the shared identity only needs
        // the Users table, and a seeding hiccup should not be what leaves the whole team
        // locked out of a session that was meant to have no lock on it.
        if (sharedAccess.Enabled)
        {
            sharedAccess.Adopt(DevAuthBypass.EnsureUser(context));
            Console.WriteLine(
                "\n==================================================================\n" +
                "  SIGN-IN IS DISABLED — THIS SERVER IS OPEN TO ANYONE WHO CAN REACH IT\n" +
                "==================================================================\n" +
                $"  Every request runs as: {sharedAccess.DisplayName} <{sharedAccess.Email}>\n" +
                "  with system-administrator rights over EVERY project and package.\n" +
                "  Anyone with the URL can read, import, inspect and delete.\n\n" +
                "  Restore sign-in:  set \"Auth\": { \"Disabled\": false } in\n" +
                "                    appsettings.Development.json and restart.\n" +
                "==================================================================\n");
        }

        PostgresFunctions.Create(context);
        DatabaseSeeder.SeedData(context);
        Console.WriteLine("[Startup] PostgreSQL migrations, functions and seed data verified.");
    }
    catch (Exception ex)
    {
        Console.WriteLine($"[Startup Error] Database init failed: {ex.Message}");
        Console.WriteLine($"[Startup Error] Inner: {ex.InnerException?.Message}");
    }
}

app.UseSwagger();
app.UseSwaggerUI();

app.UseAuthentication();
app.UseAuthorization();
app.MapControllers();

app.Run();
