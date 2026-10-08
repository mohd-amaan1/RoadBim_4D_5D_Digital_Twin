using System;
using System.Collections.Generic;
using System.Linq;
using RoadBimBackend.Models;

namespace RoadBimBackend.Services
{
    /// <summary>
    /// The RFI state machine and the derived facts every screen reads.
    ///
    /// ```
    /// draft ──submit──> submitted ──inspect──> inspected ──approve──> approved
    ///   │                   │                      │
    ///   │                   │                      └──reject──> rejected ──inspect──> inspected
    ///   └────────cancel─────┘
    /// ```
    ///
    /// Assignment is not a state. An engineer can be attached at any point before the
    /// verdict, and doing so does not move the record — which is why there is no
    /// "acknowledged" step here as there is in the platform this is ported from.
    ///
    /// Inspection and approval land in phase 3; the transitions are defined now so the
    /// register and the detail view can already draw the whole rail rather than a stub.
    /// </summary>
    public static class RfiService
    {
        /// <summary>Legal starting states per verb, and who is allowed to do it.</summary>
        private static readonly Dictionary<string, string[]> LegalFrom = new()
        {
            ["edit"] = new[] { RfiStatus.Draft },
            ["submit"] = new[] { RfiStatus.Draft },
            ["assign"] = new[] { RfiStatus.Draft, RfiStatus.Submitted, RfiStatus.Rejected },
            ["inspect"] = new[] { RfiStatus.Submitted, RfiStatus.Rejected },
            ["approve"] = new[] { RfiStatus.Inspected },
            ["reject"] = new[] { RfiStatus.Inspected },
            ["cancel"] = new[] { RfiStatus.Draft, RfiStatus.Submitted },
        };

        public static bool Can(string action, string status) =>
            LegalFrom.TryGetValue(action, out var from) && from.Contains(status);

        /// <summary>
        /// Who the caller is, as far as one RFI is concerned. Everything the duty rules need
        /// and nothing else, so the same answer can be computed for an API call and for the
        /// list of buttons the detail screen draws.
        /// </summary>
        public sealed record Actor(
            int? UserId,
            ProjectRole Role,
            bool IsFieldEngineer,
            bool IsSuperuser);

        /// <summary>
        /// Separation of duties on one request.
        ///
        /// Three different people, on purpose:
        ///
        ///   * whoever RAISES the work offers it, and later signs off the verdict;
        ///   * the FIELD ENGINEER assigned to it is the only person who may inspect it;
        ///   * nobody inspects work they offered themselves.
        ///
        /// A field engineer cannot raise, either — otherwise the same person could offer
        /// work and then pass it, which is the exact thing this control exists to prevent.
        ///
        /// A superuser bypasses all of it. That is a deliberate hole for a one-person
        /// project where the same account has to walk the whole flow, and it is recorded on
        /// the account rather than smuggled in by giving somebody two memberships.
        ///
        /// Returns null when allowed, or the reason to show the caller.
        /// </summary>
        public static string? RefuseByDuty(string action, Rfi rfi, Actor actor)
        {
            if (actor.IsSuperuser) return null;
            if (actor.UserId is null) return "Sign in again — the request carries no usable identity.";

            var me = actor.UserId.Value;

            return action switch
            {
                "submit" or "edit" or "cancel" when actor.IsFieldEngineer =>
                    "Field engineers inspect work, they do not offer it. Ask whoever is raising "
                    + "requests on this package to raise it.",

                // Ordered from the most fundamental objection outwards, so the reason given
                // is the real one. Telling a project manager to "reassign it" would send
                // them to fix something that was never the problem — they could not inspect
                // this record however it was assigned.
                "inspect" when !actor.IsFieldEngineer =>
                    "Only a field engineer can record an inspection.",

                "inspect" when rfi.AssignedToUserId is null =>
                    "Nobody is assigned to inspect this yet. Assign a field engineer first.",

                "inspect" when rfi.AssignedToUserId != me =>
                    "This is assigned to another engineer. Reassign it before inspecting.",

                "inspect" when rfi.RaisedByUserId == me =>
                    "You raised this request, so you cannot inspect it yourself.",

                "approve" or "reject" when rfi.RaisedByUserId != me =>
                    "Only the person who raised this request can sign the verdict off.",

                _ => null,
            };
        }

        /// <summary>
        /// Every verb the caller may use on this record right now — status and duty rules
        /// applied together, so the screen offers no button the server would refuse.
        /// </summary>
        public static List<string> AllowedActions(Rfi rfi, Actor actor)
        {
            var verbs = new[] { "edit", "submit", "assign", "inspect", "approve", "reject", "cancel" };
            var canWrite = actor.IsSuperuser || actor.Role >= ProjectRole.Contributor;

            return verbs
                .Where(a => canWrite)
                .Where(a => Can(a, rfi.Status))
                .Where(a => RefuseByDuty(a, rfi, actor) is null)
                .ToList();
        }

        /// <summary>
        /// Why a transition was refused, in words the caller can show a person. Returning
        /// the reason rather than a bare false is what lets the API answer 409 with
        /// something actionable instead of "invalid state".
        /// </summary>
        public static string? Refuse(string action, string status) =>
            Can(action, status)
                ? null
                : $"An RFI that is {Humanise(status)} cannot be {PastTense(action)}. "
                  + $"That is only possible from: {string.Join(", ", LegalFrom[action].Select(Humanise))}.";

        /// <summary>Spelled out rather than suffixed — "approveed" is not a word.</summary>
        private static string PastTense(string action) => action switch
        {
            "edit" => "edited",
            "submit" => "raised",
            "assign" => "assigned",
            "inspect" => "inspected",
            "approve" => "approved",
            "reject" => "rejected",
            "cancel" => "cancelled",
            _ => action,
        };

        private static string Humanise(string status) => status switch
        {
            RfiStatus.Draft => "a draft",
            RfiStatus.Submitted => "raised",
            RfiStatus.Inspected => "inspected",
            RfiStatus.Approved => "approved",
            RfiStatus.Rejected => "rejected",
            RfiStatus.Cancelled => "cancelled",
            _ => status,
        };

        /// <summary>
        /// The four stages the register and the detail rail show, collapsed from the status
        /// vocabulary. A different axis from <see cref="RfiStatus"/>: the lifecycle has six
        /// codes because the guards need them, this has five because that is what a person
        /// can act on.
        /// </summary>
        public static string StageKey(Rfi rfi) => rfi.Status switch
        {
            RfiStatus.Draft => "draft",
            RfiStatus.Submitted => IsOverdue(rfi) ? "overdue" : "pending_inspection",
            RfiStatus.Inspected => "inspected",
            RfiStatus.Approved => "approved",
            RfiStatus.Rejected => "rejected",
            RfiStatus.Cancelled => "cancelled",
            _ => rfi.Status,
        };

        /// <summary>
        /// Composed here and rendered as given. Rebuilding it in the browser is how the
        /// register and the detail screen end up disagreeing about the same record.
        /// </summary>
        public static string StatusLabel(Rfi rfi) => rfi.Status switch
        {
            RfiStatus.Draft => "Draft",
            RfiStatus.Submitted => IsOverdue(rfi) ? "Inspection overdue" : "Pending inspection",
            RfiStatus.Inspected => rfi.Outcome switch
            {
                RfiOutcome.Pass => "Inspected — pass",
                RfiOutcome.Fail => "Inspected — fail",
                _ => "Inspected",
            },
            RfiStatus.Approved => "Approved",
            RfiStatus.Rejected => "Rejected",
            RfiStatus.Cancelled => "Cancelled",
            _ => rfi.Status,
        };

        /// <summary>
        /// Computed server-side, never re-derived in the browser from `dueAt` and the
        /// clock — two machines with different clocks would disagree about the same row.
        /// </summary>
        public static bool IsOverdue(Rfi rfi) =>
            rfi.Status == RfiStatus.Submitted
            && rfi.DueAt is not null
            && rfi.DueAt < DateTime.UtcNow;

        /// <summary>
        /// From the contract: the slot the contractor asked for, else submission plus the
        /// package's notice period. Stamped once on submit and stored, so editing the
        /// package later cannot silently make historic RFIs overdue.
        /// </summary>
        public static DateTime DueFrom(DateTime submittedAt, DateTime? requiredAt, Package package) =>
            requiredAt ?? submittedAt.AddHours(Math.Clamp(package.InspectionNoticeHours, 1, 24 * 30));

        /// <summary>
        /// The status a chainage should read on the map, given the RFIs covering it.
        ///
        /// Phase 3 writes this into LayerProgress; it lives here so the register, the map
        /// and the projection can never disagree about what "built" means.
        ///
        /// Worst case wins, deliberately: a chainage with one passed and one rejected layer
        /// is not finished, and showing it green would be the map lying.
        /// </summary>
        public static string MapStatusFor(IEnumerable<Rfi> covering)
        {
            var live = covering.Where(r => r.Status != RfiStatus.Cancelled).ToList();
            if (live.Count == 0) return "Not Started";

            if (live.Any(r => r.Status == RfiStatus.Rejected
                           || (r.Status == RfiStatus.Inspected && r.Outcome == RfiOutcome.Fail)))
                return "Delayed";      // painted red

            if (live.Any(r => r.Status is RfiStatus.Draft or RfiStatus.Submitted))
                return "In-Progress";  // painted amber — offered, not yet checked

            if (live.All(r => r.Status == RfiStatus.Approved
                           || (r.Status == RfiStatus.Inspected && r.Outcome == RfiOutcome.Pass)))
                return "Completed";    // painted green — built

            return "In-Progress";
        }
    }
}
