// Logic engine: "RFI not raised" rules (8a), data-issue checks (8b), visual states (7).
import { segKey, famOf, roleIndex, armsOf, masterSegments, pierNo, decodeKey } from './keys.js';
import { formulaRowRefs } from './ipc.js';
import { dayNum, median, pad2, todayISO } from './util.js';

// Editable in Settings. Each rule can be switched off; params are read by the code below.
export const DEFAULT_CONFIG = {
  version: 1,
  rules: [
    { id: 'R1', enabled: true, name: 'Well lifts in order', text: 'If lift n of a well has an RFI, lifts 0 to n−1 of that well must have one.' },
    { id: 'R2', enabled: true, name: 'Bottom plug after all lifts', text: 'If the bottom plug has an RFI, every modelled lift of that well must have one.' },
    { id: 'R3', enabled: true, name: 'Well cap after bottom plug', text: 'If the well cap has an RFI, the bottom plug must have one.' },
    { id: 'R4', enabled: true, name: 'Lower pylon in order', text: 'If lower-pylon lift n has an RFI, the starter to lift n−1 and the well cap must have one.' },
    { id: 'R5', enabled: true, name: 'Curb after cutting edge placed', text: 'If the well curb has an RFI, the cutting edge must have 401.b and 401.c.', params: { requireStages: ['401.b', '401.c'] } },
    { id: 'R6', enabled: true, name: 'Segment casting runs', text: 'Within a casting run, if S(k) is cast every earlier segment of the run must be cast.', params: { runs: { O: [[1, 8], [9, 21], [22, 34]], M: [[1, 7], [8, 18]], E: [[1, 6]] } } },
    { id: 'R7', enabled: true, name: 'Segment erection in pairs', text: 'An erected segment needs its twin on the other arm, all earlier segments on both arms, its 406.a and the pier table.' },
    { id: 'R8', enabled: true, name: 'Stressing needs erection', text: '408.d / 409.b / 407.d / 407.e / 409.a / 409.c need 406.b of the same segment.', params: { needs: { '408.d': '406.b', '409.b': '406.b', '407.d': '406.b', '407.e': '406.b', '409.a': '406.b', '409.c': '406.b' } } },
    { id: 'R9', enabled: true, name: 'Pier table needs full-height lower pylon', text: 'A pier table needs the lower pylon at full height and the well cap.', params: { fullHeight: { E: 21.624, M: 21.624, O: 21.324 }, tolerance: 0.01 } },
  ],
  checks: {
    writtenOffUnits: ['P12', 'P14'], writtenOffAfter: '2025-11-30',
    sequenceDays: 45, neighbourCount: 3, ipcLagDays: 60, minSegmentChain: 3,
    wellDesignDepth: { E: 50.55, M: 54.05, O: 54.05 }, depthTolerance: 0.01,
  },
  // Reduced levels from the general arrangement drawings (m). The model's well-cap top is tied to wellCapTop.
  levels: { wellCapTop: 39.05, hfl: 49.4, deckTop: 66.124, bankGround: 48.0 },
  // Chainage of P6 along the uploaded alignment (m). Estimated from where the approach embankments stop.
  map: { p6Chainage: 5425 },
  // Modules drawn from the one-module test model; null = only the module the register maps.
  model: { showModules: null, unitAlias: { P12: 'P12(A)', P14: 'P14(N)' } },
};

const built = (el) => !!el && el.hasRfi && !el.reversed;
const fmtQ = (x) => Math.round(x * 1000) / 1000;

export function runRules(ipc, modelKeys, config) {
  const E = ipc.elements;
  const on = Object.fromEntries(config.rules.map((r) => [r.id, r.enabled !== false]));
  const par = Object.fromEntries(config.rules.map((r) => [r.id, r.params || {}]));
  const out = new Map(); // key -> {key, missingStage?, reasons:[{rule,text,evidence}]}
  const flag = (key, rule, text, evidence, missingStage = null) => {
    if (!out.has(key)) out.set(key, { key, reasons: [], missingStage: null });
    const o = out.get(key);
    if (missingStage) o.missingStage = o.missingStage ? o.missingStage + ', ' + missingStage : missingStage;
    if (!o.reasons.some((r) => r.rule === rule && r.text === text)) o.reasons.push({ rule, text, evidence });
  };
  const byUnit = new Map();
  for (const el of E.values()) {
    if (!el.unit) continue;
    if (!byUnit.has(el.unit)) byUnit.set(el.unit, []);
    byUnit.get(el.unit).push(el);
  }
  const els = [...E.values()];

  // R1 well lifts
  if (on.R1) for (const [unit, list] of byUnit) {
    const lifts = list.filter((e) => e.type === 'WELL' && built(e));
    if (!lifts.length) continue;
    const top = lifts.reduce((a, b) => (b.lift > a.lift ? b : a));
    for (let k = 0; k < top.lift; k++) {
      const key = `${unit}-WELL-L${pad2(k)}`;
      if (!built(E.get(key))) flag(key, 'R1', `${top.key} has an RFI, so this lift must have one.`, [top.key]);
    }
  }
  // R2 plug needs every modelled lift
  if (on.R2) for (const el of els) {
    if (el.type !== 'PLUG' || !built(el)) continue;
    const re = new RegExp(`^${el.unit.replace(/[()]/g, '\\$&')}-WELL-L\\d{2}$`);
    for (const k of modelKeys) if (re.test(k) && !built(E.get(k))) flag(k, 'R2', `${el.key} has an RFI, so every modelled lift of the well must have one.`, [el.key]);
  }
  // R3 cap needs plug
  if (on.R3) for (const el of els) {
    if (el.type !== 'CAP' || !built(el)) continue;
    const k = `${el.unit}-WELL-PLUG`;
    if (!built(E.get(k))) flag(k, 'R3', `${el.key} has an RFI, so the bottom plug must have one.`, [el.key]);
  }
  // R4 lower pylon
  if (on.R4) for (const [unit, list] of byUnit) {
    const lifts = list.filter((e) => e.type === 'LPYL' && built(e));
    if (!lifts.length) continue;
    const top = lifts.reduce((a, b) => (b.lift > a.lift ? b : a));
    for (let k = 0; k < top.lift; k++) {
      const key = `${unit}-LPYL-L${pad2(k)}`;
      if (!built(E.get(key))) flag(key, 'R4', `${top.key} has an RFI, so this lift must have one.`, [top.key]);
    }
    const cap = `${unit}-WELL-CAP`;
    if (!built(E.get(cap))) flag(cap, 'R4', `The lower pylon has started (${top.key}), so the well cap must have an RFI.`, [top.key]);
  }
  // R5 curb needs cutting edge placed and scaffolded
  if (on.R5) for (const el of els) {
    if (el.type !== 'WELL' || el.lift !== 0 || !built(el)) continue;
    const ceKey = `${el.unit}-WELL-CE`;
    const ce = E.get(ceKey);
    const need = par.R5.requireStages || ['401.b', '401.c'];
    const have = new Set();
    if (ce) for (const r of ce.rows) if (r.rfis.length) r.codes.forEach((c) => have.add(c));
    const missing = need.filter((c) => !have.has(c));
    if (missing.length) flag(ceKey, 'R5', `${el.key} (curb) has an RFI, so the cutting edge needs ${missing.join(' and ')}.`, [el.key], missing.join(', '));
  }
  // R6 casting runs
  if (on.R6) {
    const runs = par.R6.runs || {};
    const groups = new Map();
    for (const el of els) {
      if (el.type !== 'SEG' || !built(el)) continue;
      if (el.fam === 'E' && el.a) continue; // S01a-E diaphragm is outside the runs
      const g = `${el.pier}|${el.arm}`;
      if (!groups.has(g)) groups.set(g, { pier: el.pier, arm: el.arm, fam: el.fam, cast: new Map() });
      groups.get(g).cast.set(el.seg, el.key);
    }
    for (const g of groups.values()) {
      for (const [s, e] of runs[g.fam] || []) {
        let top = 0;
        for (let k = s; k <= e; k++) if (g.cast.has(k)) top = k;
        for (let k = s; k < top; k++) {
          if (g.cast.has(k)) continue;
          const key = segKey(g.pier, g.arm, k);
          if (!built(E.get(key))) flag(key, 'R6', `${g.cast.get(top)} is cast, and segments in run S${pad2(s)}–S${pad2(e)} are match-cast in order.`, [g.cast.get(top)]);
        }
      }
    }
  }
  // R7 erection in pairs (406.b)
  if (on.R7) {
    const erected = (key) => { const el = E.get(key); return !!el && !el.reversed && el.rows.some((r) => r.rfis.length && r.codes.includes('406.b')); };
    for (const el of els) {
      if (el.type !== 'SEG' || !erected(el.key)) continue;
      const arms = armsOf(el.pier);
      const other = arms.find((a) => a !== el.arm);
      const diaphragm = el.fam === 'E' && el.a;
      if (other) {
        const twin = segKey(el.pier, other, el.seg, diaphragm);
        if (!erected(twin)) flag(twin, 'R7', `${el.key} is erected; segments go up in pairs.`, [el.key], '406.b');
      }
      if (!diaphragm) for (const arm of arms) for (let k = 1; k < el.seg; k++) {
        const key = segKey(el.pier, arm, k);
        if (!erected(key)) flag(key, 'R7', `${el.key} is erected, so S01–S${pad2(el.seg - 1)} on both arms must be erected.`, [el.key], '406.b');
      }
      if (!el.codes.has('406.a')) flag(el.key, 'R7', 'Erected without a casting RFI (406.a).', [el.key], '406.a');
      if (roleIndex(el.pier) !== 0) {
        const pt = `P${el.pier}-PT`;
        if (!built(E.get(pt))) flag(pt, 'R7', `${el.key} is erected, so the pier table must have an RFI.`, [el.key]);
      }
    }
  }
  // R8 later stages need erection
  if (on.R8) {
    const needs = par.R8.needs || {};
    for (const el of els) {
      if (el.type !== 'SEG' || el.reversed) continue;
      const have = new Set();
      el.rows.forEach((r) => r.rfis.length && r.codes.forEach((c) => have.add(c)));
      for (const [code, need] of Object.entries(needs)) {
        if (have.has(code) && !have.has(need)) flag(el.key, 'R8', `${code} is billed, which needs ${need} first.`, [el.key], need);
      }
    }
  }
  // R9 pier table
  if (on.R9) {
    const fh = par.R9.fullHeight || {};
    const tol = par.R9.tolerance ?? 0.01;
    for (const el of els) {
      if (el.type !== 'PT' || !built(el)) continue;
      const lp = els.filter((e) => e.unit === el.unit && e.type === 'LPYL' && built(e));
      const h = lp.reduce((s, e) => s + e.net, 0);
      const need = fh[el.fam] ?? 21.624;
      if (h < need - tol) {
        const next = `${el.unit}-LPYL-L${pad2(lp.length ? Math.max(...lp.map((e) => e.lift)) + 1 : 0)}`;
        flag(next, 'R9', `${el.key} has an RFI but the lower pylon is only ${h.toFixed(3)} m of ${need} m.`, [el.key]);
      }
      const cap = `${el.unit}-WELL-CAP`;
      if (!built(E.get(cap))) flag(cap, 'R9', `${el.key} has an RFI, so the well cap must have one.`, [el.key]);
    }
  }
  return out;
}

// ---- 8b data-issue checks ----
export function runChecks(ipc, config, now = todayISO()) {
  const cfg = config.checks || {};
  const issues = [];
  const add = (sev, code, title, detail, keys = [], rows = []) => issues.push({ sev, code, title, detail, keys: [...new Set(keys.filter(Boolean))], rows: [...new Set(rows)] });
  const rows = ipc.rows;
  const byRow = new Map(rows.map((r) => [r.row, r]));
  const E = ipc.elements;

  // H1 negative quantity with RFIs
  for (const r of rows) if (r.qty < 0 && r.rfis.length) add('High', 'H1', `Row ${r.row}: negative quantity with RFIs`, `${r.text} is billed at ${r.qty} ${r.uom}${r.formula ? ` by the formula =${r.formula}` : ''}. A negative row that has RFIs is usually a broken formula.`, [r.key], [r.row]);

  // H2 row outside its item block's "Cumulative paid upto this Bill" SUM range.
  // A block's item comes from the rows between the previous subtotal and it: its data
  // rows' item codes, or else the nearest item header (e.g. "403" or "406.a").
  const subRows = ipc.subtotals.map((s) => s.row).sort((a, b) => a - b);
  const headers = ipc.headers || [];
  const blocks = ipc.subtotals.filter((s) => /^Cumulative/i.test(s.label) && s.ranges.length).map((b) => {
    const prev = Math.max(subRows.filter((x) => x < b.row).pop() || 0, b.row > (ipc.tableStart || 0) ? ipc.tableStart || 0 : 0);
    const seg = rows.filter((r) => r.row > prev && r.row < b.row);
    let codes = [...new Set(seg.map((r) => r.codes[0]))];
    if (!codes.length) { const hs = headers.filter((h) => h.row > prev && h.row < b.row); if (hs.length) codes = [hs[hs.length - 1].code]; }
    return { ...b, codes };
  });
  const covers = (bcode, c) => c === bcode || c.startsWith(bcode + '.');
  const outside = new Map(); // block row + code -> rows
  for (const r of rows) {
    if (!r.key) continue;
    for (const c of r.codes) {
      const bl = blocks.filter((b) => b.codes.some((bc) => covers(bc, c)));
      if (!bl.length) continue;
      if (!bl.some((b) => b.ranges.some(([a, z]) => r.row >= a && r.row <= z))) {
        const k = c + '|' + bl.map((b) => b.row).join(',');
        if (!outside.has(k)) outside.set(k, { c, bl, rows: [] });
        outside.get(k).rows.push(r);
        break;
      }
    }
  }
  for (const { c, bl, rows: out } of outside.values()) {
    const where = bl.map((b) => `${b.formula.startsWith('=') ? b.formula : '=' + b.formula} on row ${b.row}`).join(' or ');
    if (out.length <= 5) for (const r of out) add('High', 'H2', `Row ${r.row}: outside the ${c} cumulative total`, `${r.text} (${fmtQ(r.qty)} ${r.uom}) is not inside ${where}, so it isn't counted in the bill.`, [r.key], [r.row]);
    else {
      add('High', 'H2', `${out.length} ${c} rows are outside the cumulative total`, `Rows ${out.slice(0, 12).map((r) => r.row).join(', ')}${out.length > 12 ? '…' : ''} are not inside ${where}, so they aren't counted in the bill. The sheet was probably re-sorted after the totals were written.`, out.map((r) => r.key), out.map((r) => r.row));
      issues[issues.length - 1].scope = 'sheet'; // a sheet-level problem: listed, not outlined on every element
    }
  }

  // H3 one element's full RFI chain also appears on another element
  const rowsWith = new Map();
  for (const r of rows) for (const x of r.rfis) if (x.num && r.key) { if (!rowsWith.has(x.id)) rowsWith.set(x.id, new Set()); rowsWith.get(x.id).add(r); }
  const seenPair = new Set();
  for (const r of rows) {
    const ids = [...new Set(r.rfis.filter((x) => x.num).map((x) => x.id))];
    if (ids.length < 2 || !r.key) continue;
    let cand = null;
    for (const id of ids) { const s = rowsWith.get(id); cand = cand ? new Set([...cand].filter((o) => s.has(o))) : new Set(s); }
    for (const o of cand) {
      if (o.key === r.key) continue;
      const pair = [r.key, o.key].sort().join('|');
      if (seenPair.has(pair)) continue;
      seenPair.add(pair);
      add('High', 'H3', `${r.key} and ${o.key} share an RFI chain`, `Every RFI on ${r.key} (${ids.map((i) => i.replace('MPSB/', '')).join(', ')}) is also quoted on ${o.key}. One piece of work can't close two elements${r.qty > 0 && o.qty > 0 ? ', and both rows are billed' : ''}.`, [r.key, o.key], [r.row, o.row]);
    }
  }

  // H4 new work on a written-off unit label
  const wo = new Set(cfg.writtenOffUnits || []);
  const after = cfg.writtenOffAfter || '2025-11-30';
  for (const r of rows) {
    const u = r.parsed?.unit;
    if (!u || !wo.has(u) || !r.rfis.length) continue;
    const late = r.dates.filter((d) => d > after);
    if (late.length) add('High', 'H4', `Row ${r.row}: new work booked on written-off ${u}`, `${r.text} (${r.codes.join(' / ')}) is dated ${late[0]}, after ${u} was written off on ${after}. Replacement wells use labels like ${u}(A) or ${u}(N).`, [r.key], [r.row]);
  }

  // M1 formula pointing at another element's row
  for (const r of rows) {
    if (!r.formula || !r.key) continue;
    const refs = formulaRowRefs(r.formula).filter((n) => n !== r.row);
    const foreign = refs.map((n) => byRow.get(n)).filter((o) => o && o.key !== r.key);
    const missing = refs.filter((n) => !byRow.get(n));
    if (foreign.length) add('Medium', 'M1', `Row ${r.row}: formula uses another element's row`, `${r.text} is =${r.formula}; ${foreign.map((o) => `F${o.row} is ${o.text}`).join(', ')}. The sheet was probably re-sorted.`, [r.key, ...foreign.map((o) => o.key)], [r.row, ...foreign.map((o) => o.row)]);
    else if (missing.length && refs.length === missing.length) add('Medium', 'M1', `Row ${r.row}: formula points at a non-element row`, `${r.text} is =${r.formula}, which points at row ${missing.join(', ')}.`, [r.key], [r.row]);
  }

  // M2 one RFI number on elements at different piers
  const usage = new Map();
  for (const r of rows) for (const x of r.rfis) {
    if (!x.num || !r.key) continue;
    if (!usage.has(x.id)) usage.set(x.id, new Map());
    usage.get(x.id).set(r.key, { row: r.row, pier: r.parsed.pier });
  }
  for (const [id, m] of usage) {
    const piers = new Set([...m.values()].map((v) => v.pier));
    if (piers.size > 1) add('Medium', 'M2', `${id.replace('MPSB/', '')} is used at ${piers.size} piers`, `${id} appears on ${[...m.keys()].join(', ')}.`, [...m.keys()], [...m.values()].map((v) => v.row));
  }

  // M3 future dates
  const future = new Map();
  for (const r of rows) for (const x of r.rfis) if (x.date && x.date > now) { const k = x.id + '|' + x.date; if (!future.has(k)) future.set(k, { x, keys: [], rowsN: [] }); future.get(k).keys.push(r.key); future.get(k).rowsN.push(r.row); }
  for (const { x, keys, rowsN } of future.values()) add('Medium', 'M3', `${x.id.replace('MPSB/', '')} is dated in the future`, `${x.id} is dated ${x.date}, after today (${now}).`, keys, rowsN);

  // M4 date far from neighbouring numbers in the same series
  const series = new Map();
  for (const r of rows) for (const x of r.rfis) {
    if (!x.num || !x.date) continue;
    const s = x.series;
    if (!series.has(s)) series.set(s, new Map());
    const m = series.get(s);
    if (!m.has(x.num)) m.set(x.num, { num: x.num, id: x.id, dates: new Set(), keys: new Set(), rows: new Set() });
    const o = m.get(x.num);
    o.dates.add(x.date); o.keys.add(r.key); o.rows.add(r.row);
  }
  const nb = cfg.neighbourCount ?? 3, lim = cfg.sequenceDays ?? 45;
  for (const m of series.values()) {
    const list = [...m.values()].sort((a, b) => a.num - b.num).map((o) => ({ ...o, day: median([...o.dates].map(dayNum)) }));
    for (let i = 0; i < list.length; i++) {
      const around = [];
      for (let j = Math.max(0, i - nb); j <= Math.min(list.length - 1, i + nb); j++) if (j !== i) around.push(list[j].day);
      if (around.length < 2) continue;
      const mid = median(around);
      const gap = Math.round(list[i].day - mid);
      if (Math.abs(gap) > lim) add('Medium', 'M4', `${list[i].id.replace('MPSB/', '')} breaks the numbering sequence`, `${list[i].id} is dated ${[...list[i].dates].join(', ')}, ${Math.abs(gap)} days ${gap > 0 ? 'after' : 'before'} the RFIs numbered next to it. Possibly a typo in the date.`, [...list[i].keys], [...list[i].rows]);
    }
  }

  // M5 RFI dated long after the bulk of its IPC
  const perBill = new Map();
  for (const r of rows) if (r.bill && r.closeDate) { if (!perBill.has(r.bill)) perBill.set(r.bill, []); perBill.get(r.bill).push(dayNum(r.closeDate)); }
  const lag = cfg.ipcLagDays ?? 60;
  for (const r of rows) {
    if (!r.bill || !r.closeDate || !perBill.has(r.bill)) continue;
    const list = perBill.get(r.bill);
    if (list.length < 5) continue;
    const mid = median(list);
    const d = dayNum(r.closeDate) - mid;
    if (d > lag) add('Medium', 'M5', `Row ${r.row}: dated ${Math.round(d)} days after most of ${r.bill}`, `${r.text} closes on ${r.closeDate}, while most rows billed in ${r.bill} close around ${new Date(mid * 86400000).toISOString().slice(0, 10)}.`, [r.key], [r.row]);
  }

  // M6 © segment without 408.c
  for (const el of E.values()) if (el.type === 'SEG' && (el.cable || el.cableMark) && el.hasRfi && !el.codes.has('408.c')) add('Medium', 'M6', `${el.key}© billed without 408.c`, `${el.key} is a stay-cable anchor segment, but none of its rows carries 408.c in column B.`, [el.key], el.sourceRows);

  // M7 well depth above design
  const depth = new Map();
  for (const el of E.values()) if (el.type === 'WELL' && !el.reversed) depth.set(el.unit, (depth.get(el.unit) || 0) + el.net);
  for (const [unit, d] of depth) {
    const design = (cfg.wellDesignDepth || {})[famOf(pierNo(unit))];
    if (design && d > design + (cfg.depthTolerance ?? 0.01)) add('Medium', 'M7', `${unit} well billed deeper than design`, `${unit} well steining totals ${d.toFixed(2)} m against the design ${design} m.`, [...E.values()].filter((e) => e.unit === unit && e.type === 'WELL').map((e) => e.key));
  }

  // L1 RFI count vs date count
  for (const r of rows) if (r.rfis.length && r.dateCount && r.dateCount !== r.rfis.length) add('Low', 'L1', `Row ${r.row}: ${r.rfis.length} RFIs but ${r.dateCount} dates`, `${r.text}: the last date was applied to the remaining RFIs.`, [r.key], [r.row]);
  // L1b dates that couldn't be read
  for (const r of rows) if (r.badDates.length) add('Low', 'L1', `Row ${r.row}: date text not recognised`, `${r.text}: "${r.badDates.join('", "')}" is not a date format the tracker reads.`, [r.key], [r.row]);
  // L2 thin segment chains
  const minC = cfg.minSegmentChain ?? 3;
  for (const el of E.values()) if (el.type === 'SEG' && el.hasRfi) { const n = el.chain.filter((x) => x.num).length; if (n < minC) add('Low', 'L2', `${el.key}: only ${n} RFI${n === 1 ? '' : 's'}`, `A segment chain normally runs MB → Sur → MB (${minC} RFIs).`, [el.key], el.sourceRows); }
  // L3 well lift with all RFIs on one day
  for (const el of E.values()) {
    if (el.type !== 'WELL' || !el.hasRfi || el.reversed) continue;
    const ds = new Set(el.chain.map((x) => x.date).filter(Boolean));
    if (el.chain.length >= 2 && ds.size === 1) add('Low', 'L3', `${el.key}: all RFIs on one day`, `Every RFI for this lift is dated ${[...ds][0]}, so there's no separate sinking evidence.`, [el.key], el.sourceRows);
  }
  // I1 next lift started before previous closed; I2 survey RFI shared by two lifts
  const units = new Map();
  for (const el of E.values()) if (el.type === 'WELL' && el.hasRfi && !el.reversed) { if (!units.has(el.unit)) units.set(el.unit, new Map()); units.get(el.unit).set(el.lift, el); }
  for (const m of units.values()) {
    for (const [lift, el] of m) {
      const prev = m.get(lift - 1);
      if (prev && el.firstRfiDate && prev.statusDate && el.firstRfiDate < prev.statusDate) add('Info', 'I1', `${el.key} started before ${prev.key} closed`, `${el.key} has an RFI on ${el.firstRfiDate}; ${prev.key} closed on ${prev.statusDate}.`, [el.key, prev.key]);
    }
    const sur = new Map();
    for (const el of m.values()) for (const x of el.chain) if (x.series === 'Sur') { if (!sur.has(x.id)) sur.set(x.id, new Set()); sur.get(x.id).add(el.key); }
    for (const [id, ks] of sur) if (ks.size > 1) add('Info', 'I2', `${id.replace('MPSB/', '')} is shared by ${ks.size} lifts`, `The survey RFI ${id} is quoted on ${[...ks].join(', ')}.`, [...ks]);
  }
  // Segment IDs that break the "a" rule
  const master = masterSegments();
  for (const el of E.values()) if (el.type === 'SEG' && !master.has(el.key)) add('Low', 'L4', `${el.key} is not a valid segment ID`, `It isn't one of the 1,116 segment IDs (check the pier, arm, number and where the "a" goes).`, [el.key], el.sourceRows);

  const order = { High: 0, Medium: 1, Low: 2, Info: 3 };
  issues.sort((a, b) => order[a.sev] - order[b.sev] || a.code.localeCompare(b.code));
  issues.forEach((x, i) => (x.id = 'i' + i));
  return issues;
}

// Everything the viewer and panels need, from the current IPC + model link.
export function evaluate({ ipc, model, link, config }) {
  const modelKeys = new Set(link ? [...link.keyToEls.keys()] : []);
  const empty = { elements: new Map(), rows: [], subtotals: [], unlinked: [] };
  const data = ipc || empty;
  const notRaised = runRules(data, modelKeys, config);
  const issues = ipc ? runChecks(ipc, config) : [];
  const issuesByKey = new Map();
  for (const is of issues) for (const k of is.keys) { if (!issuesByKey.has(k)) issuesByKey.set(k, []); issuesByKey.get(k).push(is); }

  const stateOf = (key) => {
    const el = data.elements.get(key);
    if (el?.reversed) return 'reversed';
    if (notRaised.has(key)) return 'notRaised';
    if (el?.hasRfi) return el.type === 'SEG' && el.yardOnly ? 'yard' : 'built';
    return 'notYet';
  };
  const states = new Map();
  for (const k of modelKeys) states.set(k, stateOf(k));

  const noModel = [...data.elements.values()].filter((el) => el.hasRfi && !el.reversed && !modelKeys.has(el.key));
  const counts = { built: 0, yard: 0, notYet: 0, notRaised: 0, issue: 0, noModel: noModel.length, reversed: 0 };
  for (const [k, s] of states) { counts[s]++; if (issuesByKey.has(k) && s !== 'notRaised') counts.issue++; }
  return { notRaised, issues, issuesByKey, states, stateOf, noModel, counts, modelKeys };
}

export { decodeKey };
