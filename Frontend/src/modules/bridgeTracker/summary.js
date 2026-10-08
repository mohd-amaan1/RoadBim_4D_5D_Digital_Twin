// The tracker's state reduced to the figures the rest of RoadBIM shows: the legend's
// counts, the issues, the RFIs not raised, and what Schedule 4 says has been built.
//
// Nothing here is new arithmetic. The counts are the engine's own (ev.counts, the numbers
// in the tracker's legend); the progress figures are the same sums the acceptance tests
// check (wells cast and sunk, net steining, segments cast against the 1,116 master list).
import { masterSegments } from './keys.js';

export { publishTrackerSummary } from './summaryStore.js';

const round = (x, dp) => Math.round(x * 10 ** dp) / 10 ** dp;

// Key-order-proof JSON, so two equal settings documents always give the same signature.
function stable(v) {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(',')}}`;
  return JSON.stringify(v ?? null);
}

/** What the figures depend on: the files in use, and the settings that change the counts. */
export function signatureOf(state, config) {
  const active = state.activeIpc || [...(state.ipcs || [])].sort((a, b) => b.at - a.at)[0]?.asset || null;
  const relevant = {
    files: [state.ifc?.asset, state.register?.asset, active],
    rules: (config.rules || []).map((r) => [r.id, r.enabled !== false, r.params || null]),
    checks: config.checks || null,
    model: { showModules: config.model?.showModules ?? null, numbering: config.model?.numbering ?? null, unitAlias: config.model?.unitAlias ?? null },
    link: config.link || null,
  };
  return stable(relevant);
}

const fileInfo = (m) => (m ? { name: m.name, at: m.at, by: m.byName || null } : null);

export function summarise({ state, ipc, ev, link, map, place, model }) {
  const E = ipc ? [...ipc.elements.values()] : [];
  const live = (e) => e.hasRfi && !e.reversed;
  const billed = (e, code) => !e.reversed && e.rows.some((r) => r.rfis.length && r.codes.includes(code));
  const segs = E.filter((e) => e.type === 'SEG');
  const wells = E.filter((e) => e.type === 'WELL' && live(e));
  const sev = { High: 0, Medium: 0, Low: 0, Info: 0 };
  for (const i of ev?.issues || []) sev[i.sev] = (sev[i.sev] || 0) + 1;

  return {
    computedAt: Date.now(),
    files: {
      ifc: fileInfo(state.ifc), register: fileInfo(state.register), alignment: fileInfo(state.context),
      ipc: fileInfo((state.ipcs || []).find((x) => x.asset === state.activeIpc) || [...(state.ipcs || [])].sort((a, b) => b.at - a.at)[0]),
      ipcCount: state.ipcs?.length || 0,
    },
    ipc: ipc ? { bill: ipc.bill || null, period: ipc.period || null, rows: ipc.rows.length, unlinked: ipc.unlinked.length } : null,
    model: model ? {
      elements: model.elements.length,
      keys: link?.keyToEls.size ?? 0,
      noKey: link?.coverage.modelNoKey.length ?? 0,
      modules: place?.modules.map((p) => p.m) || [],
      modelled: place?.modelled || [],
    } : null,
    numbering: map?.numbering ? {
      piers: map.numbering.piers, register: map.numbering.register,
      assumed: !!(map.numbering.auto && map.numbering.register && !map.numbering.fitsBridge),
    } : null,
    // exactly the tracker legend's figures, by the legend's own rules: "RFI not raised"
    // includes the off-model ones (the red stand-in blocks), and "Data issue" counts model
    // keys with a High or Medium issue that is not a sheet-wide one (the default outline)
    counts: ev ? {
      ...ev.counts,
      notRaised: ev.notRaised.size,
      issue: link ? [...link.keyToEls.keys()].filter((k) => (ev.issuesByKey.get(k) || []).some((i) => (i.sev === 'High' || i.sev === 'Medium') && i.scope !== 'sheet')).length : 0,
      noKey: link?.coverage.modelNoKey.length ?? 0,
    } : null,
    issues: ev ? { total: ev.issues.length, bySev: sev } : null,
    notRaised: ev ? [...ev.notRaised.values()].map((r) => ({
      key: r.key, missing: r.missingStage || null, why: r.reasons[0]?.text || '', rule: r.reasons[0]?.rule || '',
      modelled: !!link?.keyToEls.has(r.key),
    })) : [],
    progress: ipc ? {
      segments: {
        total: masterSegments().size,
        cast: segs.filter(live).length,
        erected: segs.filter((e) => billed(e, '406.b')).length,
        stressed: segs.filter((e) => billed(e, '407.d')).length,
        grouted: segs.filter((e) => billed(e, '407.e')).length,
        deck: segs.filter((e) => billed(e, '409.a')).length,
      },
      wells: {
        lifts: wells.length,
        steiningM: round(wells.reduce((s, e) => s + e.net, 0), 2),
        reversedLifts: E.filter((e) => e.type === 'WELL' && e.reversed).length,
        plugs: E.filter((e) => e.type === 'PLUG' && live(e)).length,
        caps: E.filter((e) => e.type === 'CAP' && live(e)).length,
      },
      lowerPylonM: round(E.filter((e) => e.type === 'LPYL' && !e.reversed).reduce((s, e) => s + e.net, 0), 3),
      pierTables: E.filter((e) => e.type === 'PT' && live(e)).length,
    } : null,
  };
}
