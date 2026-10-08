import { STATUS_COLORS, UNBOUND_COLOR } from '../../utils/roadTextures.js';

/**
 * The words and colours every RFI screen speaks.
 *
 * Kept in one file because the register chip, the detail rail and the map legend must
 * agree — three separate colour tables is how a record reads amber in one place and red
 * in another.
 *
 * The map palette is the one already used by the 3D viewer and the plan view
 * (`roadTextures.STATUS_COLORS`), so an RFI's colour here is literally the colour its
 * chainage takes on the map once phase 3 lands.
 */

/** The four stages a person acts on, plus the two terminal ones. */
export const STAGES = [
  { key: 'draft', label: 'Draft', hint: 'Not raised yet. Still editable.' },
  { key: 'pending_inspection', label: 'Pending inspection', hint: 'Raised and waiting on an engineer.' },
  { key: 'overdue', label: 'Overdue', hint: 'Past the notice period agreed in the contract.' },
  { key: 'inspected', label: 'Inspected', hint: 'A visit recorded a verdict.' },
  { key: 'approved', label: 'Approved', hint: 'Signed off. Counts as built.' },
  { key: 'rejected', label: 'Rejected', hint: 'Refused. Stays refused until a later visit passes.' },
  { key: 'cancelled', label: 'Cancelled', hint: 'Withdrawn before inspection.' },
];

export const STAGE_LABEL = Object.fromEntries(STAGES.map((s) => [s.key, s.label]));

/**
 * `tone` maps onto the existing chip tones in index.css; `dot` is the literal colour, and
 * for the three stages that drive the map it is the exact hex the chainage will be painted.
 */
export const STAGE_STYLE = {
  draft: { tone: undefined, dot: UNBOUND_COLOR },
  pending_inspection: { tone: 'active', dot: STATUS_COLORS['In-Progress'] },
  overdue: { tone: 'late', dot: STATUS_COLORS['In-Progress'] },
  inspected: { tone: 'accent', dot: STATUS_COLORS['In-Progress'] },
  approved: { tone: 'ok', dot: STATUS_COLORS.Completed },
  rejected: { tone: 'late', dot: STATUS_COLORS.Delayed },
  cancelled: { tone: undefined, dot: STATUS_COLORS['Not Started'] },
};

/**
 * The four stages the detail rail draws, in order.
 *
 * These are milestones, not statuses: "Inspection due" is the same status as "Raised" with
 * a clock against it, which is exactly why the rail and the status vocabulary are separate.
 */
export const RAIL = [
  { key: 'raised', label: 'Raised' },
  { key: 'due', label: 'Inspection due' },
  { key: 'inspected', label: 'Inspected' },
  { key: 'approved', label: 'RFI approved' },
];

/**
 * Where a record sits on the rail: which milestones are done, which is current, which are
 * still ahead. A rejected RFI sits AT 'inspected' rather than past it — the visit happened,
 * the sign-off did not.
 */
export function railState(card) {
  const done = new Set();
  let current = 'raised';

  if (card.submittedAt) { done.add('raised'); current = 'due'; }
  if (card.inspectedAt) { done.add('due'); done.add('inspected'); current = 'approved'; }
  if (card.status === 'inspected') current = 'inspected';
  if (card.status === 'rejected') current = 'inspected';
  if (card.approvedAt) { done.add('approved'); current = 'approved'; }

  return { done, current };
}

export const SIDE_LABEL = {
  LHS: 'Left-hand side',
  RHS: 'Right-hand side',
  both: 'Both sides',
  na: 'Not applicable',
};

/** `km 7+200` from metres — how chainage is spoken on site. */
export function station(metres) {
  if (metres === null || metres === undefined || Number.isNaN(metres)) return '—';
  const km = Math.floor(metres / 1000);
  const rem = metres - km * 1000;
  return `${km}+${String(Math.round(rem)).padStart(3, '0')}`;
}

/** Short, human relative time. Absolute dates are kept for anything contractual. */
export function ago(iso) {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return null;

  const seconds = Math.round((Date.now() - then) / 1000);
  const future = seconds < 0;
  const s = Math.abs(seconds);

  const units = [
    [60, 'second'], [60, 'minute'], [24, 'hour'], [7, 'day'], [4.35, 'week'], [12, 'month'],
  ];
  let value = s;
  let unit = 'second';
  for (const [step, name] of units) {
    if (value < step) { unit = name; break; }
    value = value / step;
    unit = name;
  }
  const n = Math.max(1, Math.round(value));
  const plural = n === 1 ? '' : 's';
  return future ? `in ${n} ${unit}${plural}` : `${n} ${unit}${plural} ago`;
}

export function formatDateTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString(undefined, {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}
