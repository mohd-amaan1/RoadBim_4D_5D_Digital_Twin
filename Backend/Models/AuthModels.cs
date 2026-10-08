using System;
using System.Collections.Generic;

namespace RoadBimBackend.Models
{
    /// <summary>
    /// Project roles, ordered least to most privileged. Comparison is by the numeric
    /// value, so a policy check is "does the member's role reach the required one".
    /// </summary>
    public enum ProjectRole
    {
        Viewer = 0,      // read everything in the project
        Contributor = 1, // import data, upload models, edit progress
        Owner = 2        // the above plus membership management and deletion
    }

    public class User
    {
        public int Id { get; set; }

        /// <summary>Lower-cased on write; the login identity.</summary>
        public string Email { get; set; } = string.Empty;

        public string DisplayName { get; set; } = string.Empty;

        /// <summary>BCrypt hash. The plaintext is never stored or logged.</summary>
        public string PasswordHash { get; set; } = string.Empty;

        /// <summary>
        /// Platform-level flag, separate from project roles. A system admin can see and
        /// administer every project; ordinary users only reach projects they are a member of.
        /// </summary>
        public bool IsSystemAdmin { get; set; }

        public bool IsActive { get; set; } = true;

        /// <summary>
        /// Bumped on password change or forced sign-out. Tokens carry the value they were
        /// issued with, so raising it invalidates every token already in the wild.
        /// </summary>
        public int TokenVersion { get; set; }

        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
        public DateTime? LastLoginAt { get; set; }

        public List<ProjectMember> Memberships { get; set; } = new();
    }

    /// <summary>
    /// Membership is the authorization boundary: no row here, no access to the project,
    /// regardless of what a request claims.
    /// </summary>
    public class ProjectMember
    {
        public int Id { get; set; }

        public int ProjectId { get; set; }
        public Project? Project { get; set; }

        public int UserId { get; set; }
        public User? User { get; set; }

        public ProjectRole Role { get; set; } = ProjectRole.Viewer;

        /// <summary>
        /// Whether this member inspects work on site.
        ///
        /// A separate axis from <see cref="Role"/>. Role says how much of the project you
        /// may change; this says what job you do on it, and the two do not line up — an
        /// Owner may run the contract from an office and never inspect anything, while a
        /// field engineer needs only Contributor rights yet is the sole person allowed to
        /// record a verdict.
        ///
        /// Scoped to the membership rather than the account, because the same person can be
        /// the field engineer on one contract and the one raising requests on another.
        /// </summary>
        public bool IsFieldEngineer { get; set; }

        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
        public int? InvitedByUserId { get; set; }
    }
}
