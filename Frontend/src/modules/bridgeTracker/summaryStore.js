// The latest tracker figures per package, shared by the tracker and the rest of RoadBIM.
//
// Deliberately tiny and free of the tracker's parsers: the project bar and the sidebar
// import it on every page, and must not pull in an IFC reader to show three numbers.
// Each entry carries the signature of the inputs it was computed from (files + settings),
// so a reader can tell a current figure from one an upload has since overtaken.
const cache = new Map(); // packageId -> { sig, summary }
const listeners = new Set();

export function publishTrackerSummary(packageId, sig, summary) {
  cache.set(packageId, { sig, summary });
  for (const fn of listeners) { try { fn(packageId); } catch { /* a reader's problem, not ours */ } }
}

export const cachedTrackerSummary = (packageId) => cache.get(packageId) || null;

export function onTrackerSummary(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
