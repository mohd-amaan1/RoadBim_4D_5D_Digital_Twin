import * as THREE from 'three';
import { Viewer, setStyleRoot } from './viewer.js';
import { parseIFC } from './ifc.js';
import { parseIPC, stageAt } from './ipc.js';
import { parseRegister } from './register.js';
import { evaluate, DEFAULT_CONFIG } from './engine.js';
import { decodeKey, TYPE_NAMES, moduleOfPier, moduleOfSegment, roleIndex, roleOf, pierNo } from './keys.js';
import { planScene, mergeConfig } from './plan.js';
import { publishTrackerSummary, summarise, signatureOf } from './summary.js';
import { exportRegister, exportIssuesCSV, exportScreenshot, STATE_LABEL, keySort } from './exporter.js';
import { acceptanceTests } from './selftest.js';
import { emptyState } from './backendStore.js';
import { MARKUP } from './markup.js';
import { parseAlignment, chainages, pointAt } from './kml.js';
import { $, setDomRoot, esc, fmtDate, fmtDateTime, fmtNum, bytes, dayNum, isoFromDay, todayISO, pad2 } from './util.js';

/**
 * Mounts the tracker into `root` and returns the function that takes it down again.
 *
 * The body below is the standalone tracker's app.js, kept at its original indentation so
 * it diffs line for line against that source. What changed is only where it meets the
 * outside world: it renders into `root` instead of the page, stores through the RoadBIM
 * backend (`store`) instead of the claude.ai artifact, and every listener or timer it hangs
 * on document, window or <html> is released on unmount.
 */
export function mountTracker(root, { store }) {
root.innerHTML = MARKUP;
setDomRoot(root);
setStyleRoot(root);
const disposers = [];
const listen = (target, type, fn, opts) => {
  target.addEventListener?.(type, fn, opts);
  disposers.push(() => target.removeEventListener?.(type, fn, opts));
};

// ------------------------------------------------------------------ state
const PREF_KEY = 'rfi3d.prefs';
const loadPrefs = () => { try { return JSON.parse(localStorage.getItem(PREF_KEY) || '{}'); } catch { return {}; } };
const S = {
  store: null, state: emptyState(), config: structuredClone(DEFAULT_CONFIG), names: {},
  model: null, register: null, link: null, ipc: null, ipcCache: new Map(), ev: null, viewIpc: null,
  items: [], itemById: new Map(), context: null, place: null,
  selKey: null, selIds: new Set(), selUnmapped: null,
  hidden: new Set(), isolate: null, hits: null, hitLabel: '',
  filter: { piers: new Set(), modules: new Set(), types: new Set(), states: new Set(), ipcs: new Set(), from: '', to: '' },
  t4d: { on: false, day: 0, min: 0, max: 0, mode: 'replay', playing: null, newKeys: new Set(), newNote: '' },
  section: null, right: null, leftOpen: false, treeOpen: new Set(['m']), colors: {},
  prefs: { colourBy: 'none', ghostYard: false, showReversed: false, showEdges: true, legendCollapsed: window.innerWidth < 900 || window.innerHeight < 700, outlineSev: 'hm', waterLevel: 'cap', mapOn: true, ...loadPrefs() },
  busy: false, tests: null,
};
const savePrefs = () => { try { localStorage.setItem(PREF_KEY, JSON.stringify(S.prefs)); } catch { /* per-viewer convenience only */ } };

const ICON = {
  home: '<path d="M3 11 12 4l9 7M6 9.5V20h12V9.5"/>',
  orbit: '<ellipse cx="12" cy="12" rx="9" ry="4"/><path d="M12 3v2M12 19v2"/><circle cx="12" cy="12" r="1.6"/>',
  pan: '<path d="M12 3v18M3 12h18M12 3l-2.5 2.5M12 3l2.5 2.5M12 21l-2.5-2.5M12 21l2.5-2.5M3 12l2.5-2.5M3 12l2.5 2.5M21 12l-2.5-2.5M21 12l-2.5 2.5"/>',
  fit: '<path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/><rect x="8.5" y="8.5" width="7" height="7"/>',
  section: '<path d="M12 3 20 7.5v9L12 21l-8-4.5v-9z"/><path d="M4 7.5 12 12l8-4.5M12 12v9" stroke-dasharray="2 2"/>',
  measure: '<path d="M3 17 17 3l4 4L7 21z"/><path d="m7 13 2 2M10 10l2 2M13 7l2 2"/>',
  tree: '<path d="M4 5h6M4 5v14M4 12h6M4 19h6M14 5h6M14 12h6M14 19h6"/>',
  props: '<rect x="4" y="3" width="16" height="18" rx="1.5"/><path d="M8 8h8M8 12h8M8 16h5"/>',
  filters: '<path d="M4 5h16l-6 7.5V19l-4 2v-8.5z"/>',
  issues: '<path d="M12 3 2.5 20h19z"/><path d="M12 10v4.5M12 17.2v.3"/>',
  t4d: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3.5 2"/>',
  upload: '<path d="M12 16V4M7 9l5-5 5 5M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/>',
  export: '<path d="M12 4v12M7 11l5 5 5-5M4 20h16"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M4.2 5.6l2.1 2.1M17.7 16.3l2.1 2.1M2.5 12h3M18.5 12h3M4.2 18.4l2.1-2.1M17.7 7.7l2.1-2.1"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  eye: '<path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z"/><circle cx="12" cy="12" r="2.8"/>',
  eyeOff: '<path d="M3 3l18 18M10.6 6.1A10 10 0 0 1 12 6c6.4 0 10 6 10 6a17 17 0 0 1-3.2 3.9M6.3 7.8C3.8 9.5 2 12 2 12s3.6 6.5 10 6.5c1.5 0 2.9-.3 4.1-.8"/>',
  chev: '<path d="m9 6 6 6-6 6"/>',
  chevD: '<path d="m6 9 6 6 6-6"/>',
  play: '<path d="M8 5v14l11-7z" fill="currentColor"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  png: '<rect x="3" y="5" width="18" height="14" rx="1.5"/><circle cx="9" cy="10" r="1.6"/><path d="m21 16-5-5-8 8"/>',
  xlsx: '<rect x="4" y="3" width="16" height="18" rx="1.5"/><path d="M4 9h16M4 15h16M10 3v18"/>',
  csv: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4M9 13h6M9 17h6"/>',
};
const svg = (name, size = 18) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[name]}</svg>`;

const STATES = ['built', 'yard', 'notYet', 'notRaised', 'reversed'];
const STAGE_COLORS = { Fabricated: '#C9B79C', Placed: '#B89F7A', 'Shutter & scaffold': '#A38660', 'Cast & sunk': '#8FA5BD', Cast: '#93AE8C', 'Cast in yard': '#D2BE93', Erected: '#6FA37F', Stressed: '#4F8E6C', 'Stay stressed': '#3F7F87', Grouted: '#3A6E5A', 'Deck complete': '#2F5E4C', 'Stay final': '#355E7D', 'Continuity PT': '#27485F', Billed: '#B0A7A0' };
const mix = (a, b, t) => { const p = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)); const x = p(a), y = p(b); return '#' + x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, '0')).join(''); };
const SEQ = ['#DDE7F0', '#2A5A86'];
const SEQ_DATE = ['#EFE4C9', '#1E6A73'];

// ------------------------------------------------------------------ viewer
const stage = $('#stage');
const viewer = new Viewer({
  canvas: $('#c3d'), cubeCanvas: $('#cube'), labelLayer: $('#labels'),
  onPick: (id) => pickElement(id),
  onDoublePick: (id) => zoomToElement(id),
  onHover: (id, e) => hover(id, e),
  onMeasure: () => {},
});
$('#cubeHome').addEventListener('click', () => viewer.home());

function readColors() {
  const g = (n) => getComputedStyle(root).getPropertyValue(n).trim();
  S.colors = { concrete: g('--m-concrete'), edge: g('--m-edge'), wire: g('--m-wire'), notyet: g('--m-notyet'), red: g('--s-red'), amber: g('--s-amber'), reversed: g('--s-reversed'), select: g('--m-select'), nw: g('--s-new') };
}
readColors();
const onTheme = () => { readColors(); applyLooks(); if (S.model) buildScene({ keepItems: true }); };
listen(matchMedia('(prefers-color-scheme: dark)'), 'change', onTheme);
const themeObserver = new MutationObserver(onTheme);
themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
disposers.push(() => themeObserver.disconnect());

// ------------------------------------------------------------------ helpers
const toastEl = $('#toast');
let toastT = null;
function toast(msg, ms = 3600) { toastEl.textContent = msg; toastEl.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => (toastEl.hidden = true), ms); }
function progress(label, frac) {
  const p = $('#progress');
  if (label === null) { p.hidden = true; return; }
  p.hidden = false; $('#progLabel').textContent = label; $('#progBar').style.width = Math.round((frac || 0) * 100) + '%';
}
const who = (id) => (!id ? '' : String(id).startsWith('setup') ? 'initial setup' : S.names[id] || 'a team member');
const modelKeys = () => (S.link ? [...S.link.keyToEls.keys()] : []);
const SEV_SETS = { hm: ['High', 'Medium'], hml: ['High', 'Medium', 'Low'], all: ['High', 'Medium', 'Low', 'Info'] };
const SEV_LABEL = { hm: 'High & Medium', hml: 'High, Medium & Low', all: 'all severities' };
const issueKeys = () => {
  const allow = new Set(SEV_SETS[S.prefs.outlineSev] || SEV_SETS.hm);
  const s = new Set();
  if (S.ev) for (const [k, list] of S.ev.issuesByKey) if (list.some((i) => allow.has(i.sev) && i.scope !== 'sheet')) s.add(k);
  return s;
};
let ISSUE_KEYS = new Set();

function pierModule(unit) {
  const n = pierNo(unit);
  if (roleIndex(n) !== 0) return moduleOfPier(n);
  const inModel = S.modelPiers || new Set();
  if (inModel.has(n + 1)) return moduleOfPier(n + 1);
  if (inModel.has(n - 1)) return moduleOfPier(n - 1);
  return moduleOfPier(n);
}

// ------------------------------------------------------------------ evaluation + looks
function recompute() {
  S.ev = evaluate({ ipc: S.ipc, model: S.model, link: S.link, config: S.config });
  publish();
  ISSUE_KEYS = issueKeys();
  if (S.ipc) {
    const today = dayNum(todayISO());
    // future-dated RFIs are data errors (flagged M3); keep them off the timeline
    const days = S.ipc.rows.flatMap((r) => r.dates.map(dayNum)).filter((d) => Number.isFinite(d) && d <= today);
    S.t4d.min = days.length ? days.reduce((a, b) => Math.min(a, b)) : today;
    S.t4d.max = days.length ? days.reduce((a, b) => Math.max(a, b)) : today;
    if (!S.t4d.day || S.t4d.day > S.t4d.max || S.t4d.day < S.t4d.min) S.t4d.day = S.t4d.max;
    // approximate reversal day: last RFI date among rows billed in the reversal row's IPC
    const billMax = new Map();
    for (const r of S.ipc.rows) if (r.bill && r.closeDate) billMax.set(r.bill, Math.max(billMax.get(r.bill) || 0, dayNum(r.closeDate)));
    S.revDay = (el) => { const d = el.reversalRows.map((r) => billMax.get(r.bill)).filter(Boolean); return d.length ? Math.max(...d) : S.t4d.max; };
  }
  computeNew();
}

// Only the team's current IPC is published: an older month picked in the top bar is a
// private look back, not what the dashboard should report.
function publish() {
  if (S.dead || !S.store?.packageId || !S.ipc) return;
  const current = S.state.activeIpc || [...S.state.ipcs].sort((a, b) => b.at - a.at)[0]?.asset;
  if (S.viewIpc !== current) return;
  try {
    publishTrackerSummary(S.store.packageId, signatureOf(S.state, S.config),
      summarise({ state: S.state, ipc: S.ipc, ev: S.ev, link: S.link, map: S.map, place: S.place, model: S.model }));
  } catch (err) { console.warn('Tracker summary not published:', err); }
}

function computeNew() {
  S.t4d.newKeys = new Set(); S.t4d.newNote = '';
  if (!S.ipc) return;
  const list = [...S.state.ipcs].sort((a, b) => a.at - b.at);
  const i = list.findIndex((x) => x.asset === S.viewIpc);
  const prev = i > 0 ? S.ipcCache.get(list[i - 1].asset) : null;
  if (prev) {
    for (const el of S.ipc.elements.values()) if (el.hasRfi && !el.reversed && !prev.elements.get(el.key)?.hasRfi) S.t4d.newKeys.add(el.key);
    S.t4d.newNote = `compared with ${prev.bill || list[i - 1].name}`;
  } else {
    for (const el of S.ipc.elements.values()) if (el.hasRfi && !el.reversed && el.bills.includes(S.ipc.bill)) S.t4d.newKeys.add(el.key);
    S.t4d.newNote = `billed in ${S.ipc.bill || 'this IPC'}; no earlier upload to compare with`;
  }
}

function state4d(key) {
  const el = S.ipc?.elements.get(key);
  if (!el) return 'notYet';
  const d = S.t4d.day;
  if (el.reversed && d >= S.revDay(el)) return 'reversed';
  const st = stageAt(el, d);
  if (st.rank < 0) return 'notYet';
  if (el.type === 'SEG' && st.rank <= 10) return 'yard';
  return 'built';
}

function currentState(key) {
  if (!key) return 'noKey';
  if (S.t4d.on && S.t4d.mode === 'replay') return state4d(key);
  const s = S.ev.states.get(key) || 'notYet';
  if (S.t4d.on && s === 'notRaised') return S.ipc?.elements.get(key)?.hasRfi ? 'built' : 'notYet';
  return s;
}

function passes(key, state) {
  if (S.hits) return !!key && S.hits.has(key);
  if (S.isolate) {
    if (S.isolate === 'issue') { if (!key || !ISSUE_KEYS.has(key)) return false; }
    else if (state !== S.isolate) return false;
  }
  const f = S.filter;
  const any = f.piers.size || f.modules.size || f.types.size || f.states.size || f.ipcs.size || f.from || f.to;
  if (!any) return true;
  if (!key) return false;
  const d = decodeKey(key);
  const el = S.ipc?.elements.get(key);
  if (f.piers.size && !f.piers.has(d.unit)) return false;
  if (f.modules.size && !f.modules.has(String(d.type === 'SEG' ? d.module : pierModule(d.unit)))) return false;
  if (f.types.size && !f.types.has(d.type)) return false;
  if (f.states.size && !f.states.has(state)) return false;
  if (f.ipcs.size && !(el && el.bills.some((b) => f.ipcs.has(b)))) return false;
  if (f.from && !(el?.statusDate && el.statusDate >= f.from)) return false;
  if (f.to && !(el?.statusDate && el.statusDate <= f.to)) return false;
  return true;
}

function colourFor(key) {
  const C = S.colors, mode = S.prefs.colourBy;
  if (mode === 'none' || !S.ipc) return C.concrete;
  const el = S.ipc.elements.get(key);
  if (!el) return C.concrete;
  if (mode === 'stage') return STAGE_COLORS[el.status] || C.concrete;
  if (mode === 'ipc') {
    const n = parseInt(String(el.ipc).replace(/\D/g, ''), 10);
    const r = S.scaleIpc; if (!Number.isFinite(n) || !r) return C.concrete;
    return mix(SEQ[0], SEQ[1], r.max > r.min ? (n - r.min) / (r.max - r.min) : 1);
  }
  if (mode === 'date') {
    const r = S.scaleDate; if (!el.statusDate || !r) return C.concrete;
    return mix(SEQ_DATE[0], SEQ_DATE[1], r.max > r.min ? (dayNum(el.statusDate) - r.min) / (r.max - r.min) : 1);
  }
  return C.concrete;
}
function computeScales() {
  S.scaleIpc = S.scaleDate = null;
  if (!S.ipc) return;
  const keys = modelKeys().map((k) => S.ipc.elements.get(k)).filter((e) => e?.hasRfi);
  const ns = keys.map((e) => parseInt(String(e.ipc).replace(/\D/g, ''), 10)).filter(Number.isFinite);
  const ds = keys.map((e) => dayNum(e.statusDate)).filter(Number.isFinite);
  if (ns.length) S.scaleIpc = { min: Math.min(...ns), max: Math.max(...ns) };
  if (ds.length) S.scaleDate = { min: Math.min(...ds), max: Math.max(...ds) };
}

function lookOf(id) {
  if (S.hidden.has(id)) return { hidden: true };
  const C = S.colors;
  const key = S.link?.elToKey.get(id) || null;
  const state = currentState(key);
  const selected = S.selIds.has(id) || S.selUnmapped === id;
  if (selected) return { fill: 'solid', color: C.select, edge: C.edge, edgeOpacity: 0.9 };
  if (!passes(key, state)) return { fill: 'ghost', color: C.wire, opacity: 0.02, edge: C.wire, edgeOpacity: 0.1, dim: true };
  const edges = S.prefs.showEdges ? C.edge : null;
  let L;
  if (S.t4d.on && S.t4d.mode === 'new') {
    if (key && S.t4d.newKeys.has(key)) return { fill: 'solid', color: C.nw, edge: C.edge, edgeOpacity: 0.5 };
  }
  switch (state) {
    case 'built': L = { fill: 'solid', color: colourFor(key), edge: edges, edgeOpacity: 0.3 }; break;
    case 'yard': L = S.prefs.ghostYard ? { fill: 'ghost', color: C.amber, opacity: 0.26, edge: C.amber, edgeOpacity: 0.85 } : { fill: 'solid', color: colourFor(key), edge: edges, edgeOpacity: 0.3 }; break;
    case 'notRaised': L = { fill: 'solid', color: C.red, edge: '#6b1a1a', edgeOpacity: 0.55 }; break;
    case 'reversed': L = S.prefs.showReversed ? { fill: 'none', edge: C.reversed, edgeOpacity: 0.95 } : { hidden: true }; break;
    case 'noKey': L = { fill: 'ghost', color: C.wire, opacity: 0.02, edge: C.wire, edgeOpacity: 0.22 }; break;
    default: L = { fill: 'ghost', color: C.notyet, opacity: 0.015, edge: C.notyet, edgeOpacity: 0.5 };
  }
  if (key && !S.t4d.on && ISSUE_KEYS.has(key) && state !== 'notRaised' && !L.hidden) { L.edge = C.amber; L.edgeOpacity = 1; }
  if (S.t4d.on && S.t4d.mode === 'new' && !L.hidden && state !== 'notYet') { L = { ...L, fill: 'ghost', color: L.color || C.concrete, opacity: 0.18 }; }
  return L;
}

function applyLooks() {
  if (!S.model) return;
  const dim = new Set();
  viewer.applyLooks((id) => { const L = lookOf(id); if (L.dim) dim.add(id); return L; });
  viewer.setDimmed(dim);
}

// ------------------------------------------------------------------ top bar
function renderTop() {
  const sel = $('#ipcSel');
  const list = [...S.state.ipcs].sort((a, b) => b.at - a.at);
  sel.innerHTML = list.length ? list.map((x, i) => `<option value="${esc(x.asset)}" ${x.asset === S.viewIpc ? 'selected' : ''}>${esc(x.bill || x.name)}${i === 0 ? ' (latest)' : ''}</option>`).join('') : '<option>No IPC yet</option>';
  sel.disabled = list.length < 2;
  const cur = list.find((x) => x.asset === S.viewIpc);
  $('#ipcMeta').textContent = cur ? `${S.ipc?.period || cur.period || ''} · uploaded ${fmtDate(new Date(cur.at).toISOString().slice(0, 10))}${cur.by ? ' by ' + who(cur.by) : ''}` : '';
  const piers = [...new Set(modelKeys().map((k) => decodeKey(k).pier).filter(Boolean))].sort((a, b) => a - b);
  const mods = S.place?.modules || [];
  const contiguous = mods.length > 2 && mods.every((m, i) => i === 0 || m.m === mods[i - 1].m + 1);
  const modText = mods.length > 2 && contiguous ? `modules ${mods[0].m}–${mods[mods.length - 1].m} (P${mods[0].n0}–P${mods[mods.length - 1].n0 + 4})` : mods.length > 1 ? 'modules ' + mods.map((m) => `${m.m} (P${m.n0}–P${m.n0 + 4})`).join(', ') : piers.length ? `P${piers[0]}–P${piers[piers.length - 1]}` : '';
  $('#sub').textContent = S.model ? `Model ${S.model.fileName} · ${modText} · ${S.items.length.toLocaleString('en-IN')} elements${S.store?.shared ? '' : ' · saved in this browser'}` : 'RFI tracker · Schedule 4';
  renderChips();
}

function renderChips() {
  const c = S.ev?.counts || {};
  const chip = (id, sw, label, n, pressed) => `<button class="chip" data-chip="${id}" aria-pressed="${pressed ? 'true' : 'false'}"><span class="sw ${sw}"></span>${label} <b>${(n ?? 0).toLocaleString('en-IN')}</b></button>`;
  $('#chips').innerHTML = [
    chip('built', 'built', 'Built', c.built, S.isolate === 'built'),
    chip('yard', 'yard', 'Cast in yard', c.yard, S.isolate === 'yard'),
    chip('notYet', 'notYet', 'Not yet', c.notYet, S.isolate === 'notYet'),
    chip('notRaised', 'notRaised', 'RFI not raised', S.ev?.notRaised.size, S.isolate === 'notRaised'),
    chip('issue', 'issue', 'Data issues', S.ev?.issues.length, S.isolate === 'issue'),
    chip('noModel', 'noModel', 'No model element', c.noModel, false),
  ].join('');
}
$('#chips').addEventListener('click', (e) => {
  const b = e.target.closest('[data-chip]'); if (!b) return;
  const id = b.dataset.chip;
  if (id === 'noModel') { openRight('issues', 'nomodel'); return; }
  if (id === 'issue' || id === 'notRaised') openRight('issues', id === 'notRaised' ? 'red' : 'High');
  S.isolate = S.isolate === id ? null : id;
  S.hits = null;
  renderChips(); applyLooks(); renderLegend();
  if (S.isolate) toast(`Showing ${b.textContent.replace(/\s\d[\d,]*$/, '').trim().toLowerCase()} only. Click the chip again to show everything.`);
});

$('#ipcSel').addEventListener('change', async (e) => { await activateIpc(e.target.value); });

// ------------------------------------------------------------------ search
const q = $('#q'), qres = $('#qres');
function searchKeys(text) {
  const t = text.trim();
  if (!t) return null;
  const all = new Set([...modelKeys(), ...(S.ipc ? S.ipc.elements.keys() : [])]);
  const m = t.match(/^(?:mpsb\s*\/\s*)?(str|sur|mb)\s*\/\s*0*(\d+)$/i);
  const onlyNum = t.match(/^0*(\d{2,})$/);
  if ((m || onlyNum) && S.ipc) {
    const hits = new Map();
    for (const el of S.ipc.elements.values()) for (const x of el.chain) {
      const ok = m ? x.series.toLowerCase() === m[1].toLowerCase() && x.num === +m[2] : x.num === +onlyNum[1];
      if (ok) hits.set(el.key, x.raw);
    }
    const series = m ? { str: 'Str', sur: 'Sur', mb: 'MB' }[m[1].toLowerCase()] : '';
    const label = m ? `MPSB/${series}/${+m[2]}` : `RFI number ${+onlyNum[1]}`;
    return { kind: 'rfi', label, keys: [...hits.keys()].sort(keySort) };
  }
  const low = t.toLowerCase();
  return { kind: 'key', label: `“${t}”`, keys: [...all].filter((k) => k.toLowerCase().includes(low)).sort(keySort) };
}
function renderSearch() {
  const r = searchKeys(q.value);
  if (!r) { qres.hidden = true; return; }
  const inModel = r.keys.filter((k) => S.link?.keyToEls.has(k)).length;
  qres.innerHTML = `<div class="head">${r.keys.length} element${r.keys.length === 1 ? '' : 's'} ${r.kind === 'rfi' ? 'carry ' : 'match '}${esc(r.label)} · ${inModel} in the model${r.keys.length ? ' · Enter to highlight all' : ''}</div>` +
    r.keys.slice(0, 60).map((k) => `<button data-k="${esc(k)}"><span class="mono">${esc(k)}</span><span class="note">${S.link?.keyToEls.has(k) ? STATE_LABEL[S.ev.states.get(k)] : 'not in model'}</span></button>`).join('') +
    (r.keys.length > 60 ? `<div class="head">and ${r.keys.length - 60} more</div>` : '');
  qres.hidden = false;
}
q.addEventListener('input', renderSearch);
q.addEventListener('focus', renderSearch);
q.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { q.value = ''; qres.hidden = true; clearHits(); q.blur(); }
  if (e.key === 'Enter') {
    const r = searchKeys(q.value); if (!r) return;
    S.hits = new Set(r.keys); S.hitLabel = r.label; S.isolate = null;
    qres.hidden = true; renderChips(); applyLooks();
    const ids = r.keys.flatMap((k) => (S.link?.keyToEls.get(k) || []).map((x) => x.id));
    if (ids.length) viewer.fit(ids);
    toast(`${r.keys.length} element${r.keys.length === 1 ? '' : 's'} for ${r.label}; ${new Set(ids).size ? r.keys.filter((k) => S.link?.keyToEls.has(k)).length : 0} in the model. Press Esc in the search box to clear.`);
  }
});
qres.addEventListener('click', (e) => { const b = e.target.closest('[data-k]'); if (b) { qres.hidden = true; select(b.dataset.k); } });
listen(document, 'click', (e) => { if (!e.target.closest('.search')) qres.hidden = true; });
function clearHits() { if (S.hits) { S.hits = null; applyLooks(); } }

// ------------------------------------------------------------------ selection
function hover(id, e) {
  const tag = $('#hoverTag');
  if (!id || !e) { tag.hidden = true; return; }
  if (String(id).startsWith('proxy:')) {
    const k = id.slice(6), r = stage.getBoundingClientRect();
    tag.textContent = `${k} · RFI not raised · not modelled, approximate position`;
    tag.style.left = e.clientX - r.left + 'px'; tag.style.top = e.clientY - r.top + 'px'; tag.hidden = false;
    return;
  }
  const key = S.link?.elToKey.get(id);
  const it = S.itemById.get(id);
  tag.textContent = key ? `${key} · ${STATE_LABEL[currentState(key)]}` : `${it?.name || 'Element'} · no key`;
  const r = stage.getBoundingClientRect();
  tag.style.left = e.clientX - r.left + 'px'; tag.style.top = e.clientY - r.top + 'px';
  tag.hidden = false;
}
function pickElement(id) {
  if (!id) { if (S.selKey || S.selUnmapped) { S.selKey = null; S.selIds = new Set(); S.selUnmapped = null; applyLooks(); renderTreeSel(); if (S.right === 'props') renderRight(); } return; }
  if (String(id).startsWith('proxy:')) { select(id.slice(6), { zoom: false }); return; }
  const key = S.link?.elToKey.get(id);
  if (key) select(key, { zoom: false });
  else { S.selKey = null; S.selIds = new Set(); S.selUnmapped = id; applyLooks(); openRight('props'); }
}
// Double left-click: select the element and fit the view to it.
function zoomToElement(id) {
  if (String(id).startsWith('proxy:')) { const k = id.slice(6); select(k, { zoom: false }); viewer.fitMarker(id); return; }
  const key = S.link?.elToKey.get(id);
  if (key) { select(key, { zoom: false }); viewer.fit([id]); return; }
  S.selKey = null; S.selIds = new Set(); S.selUnmapped = id; applyLooks(); openRight('props'); viewer.fit([id]);
}
function select(key, { zoom = true } = {}) {
  S.selKey = key; S.selUnmapped = null;
  S.selIds = new Set((S.link?.keyToEls.get(key) || []).map((e) => e.id));
  applyLooks(); openRight('props'); renderTreeSel(true);
  if (zoom && S.selIds.size) viewer.fit([...S.selIds]);
  else if (zoom && S.markerKeys?.has(key)) { viewer.fitMarker('proxy:' + key); toast(`${key} isn't modelled. The red block shows its approximate position.`); }
  else if (zoom) toast(`${key} has no model element.`);
}

// ------------------------------------------------------------------ panels
function openRight(which, focus) {
  S.right = which; S.rightFocus = focus || null;
  renderRight(); renderToolbar();
}
function panelShell(title, body, flush = false) {
  return `<header><h2>${title}</h2><button class="iconbtn" data-close title="Close" aria-label="Close">${svg('close', 16)}</button></header><div class="body${flush ? ' flush' : ''}">${body}</div>`;
}
const right = $('#right');
right.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) { S.right = null; right.hidden = true; renderToolbar(); } });
function renderRight() {
  const w = S.right;
  if (!w) { right.hidden = true; return; }
  right.hidden = false;
  if (w === 'props') right.innerHTML = panelShell('Properties', propsHTML());
  else if (w === 'issues') { right.innerHTML = panelShell('Issues', issuesHTML(), true); if (S.rightFocus) { const d = right.querySelector(`[data-grp="${S.rightFocus}"]`); if (d) { d.open = true; d.scrollIntoView({ block: 'start' }); } } }
  else if (w === 'filters') right.innerHTML = panelShell('Filters', filtersHTML());
  else if (w === 'settings') right.innerHTML = panelShell('Settings', settingsHTML());
  else if (w === 'export') right.innerHTML = panelShell('Export', exportHTML());
}

// ---- properties
function stateLabel(key) { const s = currentState(key); return `<span class="pill"><span class="sw ${s}"></span>${STATE_LABEL[s]}</span>`; }
function propsHTML() {
  if (S.selUnmapped) {
    const it = S.itemById.get(S.selUnmapped);
    if (!it) return '<p class="note">That element is no longer in the model.</p>';
    const props = S.model.props(it.base);
    return `<div class="prop-head"><div class="key">${esc(it.name || it.cls)}</div><span class="pill"><span class="sw noKey"></span>No Element_Key</span></div>
      <p class="note">This model element isn't in the mapping register and has no ${esc(S.config.link?.propName || 'RFI_Key')} property, so RFIs can't reach it.</p>
      <dl class="kv"><dt>IFC GlobalId</dt><dd class="mono">${esc(it.gid)}</dd><dt>IFC class</dt><dd>${esc(it.cls)}</dd><dt>Revit ElementId</dt><dd class="mono">${esc(it.tag)}</dd>${it.copy ? `<dt>Shown as</dt><dd>Copy of the test module for module ${it.module}</dd>` : ''}</dl>
      ${ifcPropsHTML(props)}`;
  }
  const key = S.selKey;
  if (!key) return `<p class="note">Click an element in the model, the model browser or the Issues list to see its RFIs. Double-click an element to zoom to it. Left drag orbits, right drag pans and the scroll wheel zooms.</p>`;
  const d = decodeKey(key);
  const el = S.ipc?.elements.get(key);
  const els = S.link?.keyToEls.get(key) || [];
  const nr = S.ev.notRaised.get(key);
  const issues = S.ev.issuesByKey.get(key) || [];
  const reg = S.register?.byKey.get(key);
  let h = `<div class="prop-head"><div class="key">${esc(key)}${d.cable ? ' ©' : ''}</div><div class="row">${stateLabel(key)}${ISSUE_KEYS.has(key) ? '<span class="pill"><span class="sw issue"></span>Data issue</span>' : ''}</div></div>`;
  if (nr) h += `<div class="warnbox"><b>RFI not raised${nr.missingStage ? ` (${esc(nr.missingStage)})` : ''}.</b> ${nr.reasons.map((r) => `${esc(r.text)} <span class="note">[${r.rule}]</span>`).join('<br>')}</div>`;
  h += `<div class="sec"><h3>Element</h3><dl class="kv">
    <dt>Type</dt><dd>${esc(TYPE_NAMES[d.type] || d.type)}</dd>
    <dt>Pier</dt><dd>${esc(d.unit || '–')}${d.pier ? ` · ${esc(roleOf(d.pier))}` : ''}</dd>
    <dt>Module</dt><dd>${d.type === 'SEG' ? d.module : d.unit ? pierModule(d.unit) : '–'}</dd>
    ${d.type === 'SEG' ? `<dt>Arm</dt><dd>${d.arm === 'KS' ? 'KS · Kaita Sidhi' : 'BP · Bathan Pam'}${d.a ? ' · side span' : ''}</dd><dt>Segment</dt><dd>S${String(d.seg).padStart(2, '0')}${d.cable ? ' · stay-cable anchor ©' : ''}</dd>` : ''}
    ${d.lift !== undefined && d.lift !== null ? `<dt>Lift</dt><dd>${d.lift === 0 ? (d.type === 'WELL' ? 'Well curb (lift 0)' : 'Starter (lift 0)') : 'Lift ' + d.lift}</dd>` : ''}
    <dt>IFC GlobalId</dt><dd class="mono">${els.length ? els.map((e) => esc(e.gid)).join('<br>') : '<span class="note">No model element</span>'}</dd>
    ${els.length ? `<dt>IFC class</dt><dd>${esc([...new Set(els.map((e) => e.cls))].join(', '))}</dd><dt>Revit element</dt><dd>${esc(els.map((e) => e.name).join('; '))}</dd>` : ''}
    ${els.some((e) => e.copy) ? `<dt>Shown as</dt><dd>A copy of the test module's element, drawn for module ${els[0].module}. The GlobalId is the original element's.</dd>` : ''}
    ${!els.length && S.markerKeys?.has(key) ? '<dt>Shown as</dt><dd>Red block at the approximate position (from pier chainage and segment or lift number)</dd>' : ''}
    ${reg?.meta?.Notes ? `<dt>Register note</dt><dd>${esc(reg.meta.Notes)}</dd>` : ''}
  </dl></div>`;
  if (el) {
    h += `<div class="sec"><h3>Status</h3><dl class="kv">
      <dt>Status</dt><dd>${esc(el.status)}${el.statusCode ? ` <span class="note">(${esc(el.statusCode)})</span>` : ''}</dd>
      <dt>Status date</dt><dd>${fmtDate(el.statusDate)}</dd>
      <dt>IPC</dt><dd>${esc(el.ipc || '–')}${el.bills.length > 1 ? ` <span class="note">(rows in ${esc(el.bills.join(', '))})</span>` : ''}</dd>
      <dt>Quantity</dt><dd class="num">${fmtNum(el.net)} ${esc(el.rows[0]?.uom || '')}${el.correction ? ` <span class="note">net of a correction (${el.rows.map((r) => fmtNum(r.qty)).join(' + ')})</span>` : ''}${el.reversed ? ' <span class="note">reversed</span>' : ''}</dd>
      <dt>Source rows</dt><dd><span class="mono">${el.sourceRows.join(', ')}</span> <span class="note">in Schedule 4</span></dd>
    </dl></div>`;
    h += `<div class="sec"><h3>RFI chain</h3><div class="tablewrap"><table class="t"><thead><tr><th>#</th><th>RFI No.</th><th>Series</th><th>Date</th><th>Row</th></tr></thead><tbody>${el.chain.map((x) => `<tr><td class="num">${x.pos}</td><td class="mono">${esc(x.raw)}</td><td>${esc(x.series)}</td><td class="num">${fmtDate(x.date)}</td><td class="num">${x.row}</td></tr>`).join('') || '<tr><td colspan="5" class="note">No RFIs on these rows.</td></tr>'}</tbody></table></div></div>`;
  } else if (S.ipc) h += `<div class="sec"><p class="note">No row in ${esc(S.ipc.bill || 'this IPC')} mentions ${esc(key)}.</p></div>`;
  if (issues.length) h += `<div class="sec"><h3>Issues for this element</h3>${issues.map((i) => `<div class="issuebox" style="margin-bottom:6px"><b>${esc(i.sev)} · ${esc(i.title)}</b><br>${esc(i.detail)}</div>`).join('')}</div>`;
  if (els.length === 1) h += ifcPropsHTML(S.model.props(els[0].base));
  return h;
}
function ifcPropsHTML(props) {
  if (!props.length) return '';
  return `<div class="sec"><details><summary class="note" style="cursor:pointer">IFC properties (${props.length})</summary><div class="tablewrap" style="margin-top:6px"><table class="t"><tbody>${props.map((p) => `<tr><td class="note">${esc(p.pset)}</td><td>${esc(p.name)}</td><td>${esc(p.value)}</td></tr>`).join('')}</tbody></table></div></details></div>`;
}

// ---- issues
function noKeyReasons(list) {
  const why = new Map();
  for (const it of list) { const r = it.base?.noKeyReason || 'No key'; why.set(r, (why.get(r) || 0) + 1); }
  return [...why].sort((a, b) => b[1] - a[1]).map(([r, n]) => `${n} · ${esc(r)}`).join('<br>');
}
function numberingNotice(item) {
  const nb = S.map?.numbering;
  if (!nb?.auto || !nb.register || nb.fitsBridge) return '';
  return item('Medium', `Pier numbers assumed: ${runText(nb.piers[0], nb.piers[1])}`, `The register numbers this model ${runText(nb.register[0], nb.register[1])}, past the end of the bridge at P30. Confirm which piers it covers in Settings → Piers in this IFC.`, 'data-none');
}
function issuesHTML() {
  if (!S.ev) return '<div class="body"><p class="note">Nothing loaded yet.</p></div>';
  const inModel = (k) => S.link?.keyToEls.has(k);
  const item = (sev, t1, t2, data) => `<li><button ${data}><span class="sev ${sev}"></span><span><span class="t1">${t1}</span><div class="t2">${t2}</div></span></button></li>`;
  const cap = (arr, n, fn) => arr.slice(0, n).map(fn).join('') + (arr.length > n ? `<li class="more note">and ${arr.length - n} more (export the register for the full list)</li>` : '');
  let h = '';
  const red = [...S.ev.notRaised.values()].sort((a, b) => keySort(a.key, b.key));
  h += `<details class="grp" data-grp="red" ${red.length ? 'open' : ''}><summary><span class="sw notRaised"></span>RFI not raised<span class="count">${red.length}</span></summary><ul class="ilist">${cap(red, 300, (r) => item('Red', `<span class="mono">${esc(r.key)}</span>${r.missingStage ? ` · missing ${esc(r.missingStage)}` : ''} ${inModel(r.key) ? '' : '<span class="note">· not modelled</span>'}`, esc(r.reasons[0].text), `data-k="${esc(r.key)}"`))}</ul></details>`;
  for (const sev of ['High', 'Medium', 'Low', 'Info']) {
    const list = S.ev.issues.filter((i) => i.sev === sev);
    h += `<details class="grp" data-grp="${sev}" ${sev === 'High' && list.length ? 'open' : ''}><summary><span class="sev ${sev}" style="height:14px"></span>${sev}<span class="count">${list.length}</span></summary><ul class="ilist">${cap(list, 300, (i) => item(sev, esc(i.title), esc(i.detail), `data-issue="${i.id}"`))}</ul></details>`;
  }
  const nm = [...S.ev.noModel].sort((a, b) => keySort(a.key, b.key));
  h += `<details class="grp" data-grp="nomodel"><summary><span class="sw noModel"></span>RFIs without model element<span class="count">${nm.length}</span></summary><ul class="ilist">${cap(nm, 300, (el) => item('Info', `<span class="mono">${esc(el.key)}</span>`, `${esc(el.status)} · ${fmtDate(el.statusDate)} · ${esc(el.ipc)}`, `data-k="${esc(el.key)}"`))}</ul></details>`;
  const un = S.ipc?.unlinked || [];
  h += `<details class="grp" data-grp="unlinked"><summary><span class="sev Low" style="height:14px"></span>Unlinked rows<span class="count">${un.length}</span></summary><ul class="ilist">${cap(un, 200, (r) => item('Low', `Row ${r.row} · ${esc(r.codes.join(' / '))}`, `“${esc(r.text || '(empty)')}” · ${esc(r.reason)} · qty ${fmtNum(r.qty)}`, 'data-none'))}</ul></details>`;
  const cov = S.link?.coverage;
  if (cov) {
    h += `<details class="grp" data-grp="coverage"><summary><span class="sw noKey"></span>Mapping coverage<span class="count">${cov.modelNoKey.length + cov.gidsNotFound.length}</span></summary><div style="padding:0 12px 10px" class="note">
      ${S.link.keyToEls.size} keys linked to ${[...S.link.keyToEls.values()].reduce((s, a) => s + a.length, 0)} model elements.</div>
      <ul class="ilist">
      ${numberingNotice(item)}
      ${item('Low', `Model elements with no key · ${cov.modelNoKey.length}`, noKeyReasons(cov.modelNoKey), 'data-cov="nokey"')}
      ${cov.modelNoKey.slice(0, 200).map((e) => `<li><button data-el="${e.id}" style="padding-left:25px"><span></span><span class="t2">${esc(e.name || e.cls)} <span class="mono">${esc(e.gid)}</span></span></button></li>`).join('')}
      ${item(cov.gidsNotFound.length ? 'Medium' : 'Info', `Register GUIDs not found in the IFC · ${cov.gidsNotFound.length}`, 'Revit issues a new GUID when an element is re-created. Update these rows in the register.', 'data-none')}
      ${cov.gidsNotFound.slice(0, 100).map((g) => `<li><button data-k="${esc(g.keys[0])}" style="padding-left:25px"><span></span><span class="t2"><span class="mono">${esc(g.gid)}</span> · ${esc(g.keys.join(', '))}</span></button></li>`).join('')}
      ${cov.disagree?.length ? item('Medium', `Register and geometry disagree · ${cov.disagree.length}`, 'The register key wins. ' + cov.disagree.slice(0, 5).map((d) => `${d.linked} (geometry: ${d.geometry})`).join('; '), 'data-none') : ''}
      ${cov.conflicts.length ? item('High', `GUIDs listed under two keys · ${cov.conflicts.length}`, cov.conflicts.slice(0, 5).map((c) => `${c.gid}: ${c.keys.join(', ')}`).join('; '), 'data-none') : ''}
      ${item('Info', `Register keys with no model element · ${cov.keysNoModel.length}`, 'Expected for piers that aren\'t modelled yet.', 'data-none')}
      </ul></details>`;
  }
  return h;
}
right.addEventListener('click', (e) => {
  const k = e.target.closest('[data-k]');
  if (k) { select(k.dataset.k); return; }
  const i = e.target.closest('[data-issue]');
  if (i) {
    const is = S.ev.issues.find((x) => x.id === i.dataset.issue);
    const keys = is.keys.filter((x) => S.link?.keyToEls.has(x));
    if (is.keys.length === 1 || !keys.length) { select(is.keys[0]); openRight('issues'); return; }
    S.hits = new Set(is.keys); S.hitLabel = is.title; applyLooks(); viewer.fit(keys.flatMap((x) => S.link.keyToEls.get(x).map((y) => y.id)));
    toast(`Highlighting ${is.keys.length} elements. Press Esc to clear.`);
    return;
  }
  const el = e.target.closest('[data-el]');
  if (el) { const id = el.dataset.el; S.selUnmapped = id; S.selKey = null; S.selIds = new Set(); applyLooks(); viewer.fit([id]); openRight('props'); }
});

// ---- filters
function filtersHTML() {
  const f = S.filter;
  const keys = modelKeys();
  const units = [...new Set(keys.map((k) => decodeKey(k).unit).filter(Boolean))].sort((a, b) => pierNo(a) - pierNo(b));
  const mods = [...new Set(keys.map((k) => { const d = decodeKey(k); return d.type === 'SEG' ? d.module : d.unit ? pierModule(d.unit) : null; }).filter(Boolean))].sort();
  const types = [...new Set(keys.map((k) => decodeKey(k).type))];
  const bills = [...new Set(keys.flatMap((k) => S.ipc?.elements.get(k)?.bills || []))].sort((a, b) => parseInt(a.replace(/\D/g, '')) - parseInt(b.replace(/\D/g, '')));
  const tg = (set, v, label) => `<button class="tg" data-f="${set}" data-v="${esc(v)}" aria-pressed="${f[set].has(String(v)) ? 'true' : 'false'}">${esc(label)}</button>`;
  return `<p class="note" style="margin-top:0">Elements that don't match are faded. Empty groups match everything.</p>
    <div class="field"><span class="lab">Pier</span><div class="toggles">${units.map((u) => tg('piers', u, u)).join('')}</div></div>
    <div class="field"><span class="lab">Module</span><div class="toggles">${mods.map((m) => tg('modules', m, 'Module ' + m)).join('')}</div></div>
    <div class="field"><span class="lab">Element type</span><div class="toggles">${types.map((t) => tg('types', t, TYPE_NAMES[t] || t)).join('')}</div></div>
    <div class="field"><span class="lab">Status</span><div class="toggles">${STATES.map((s) => tg('states', s, STATE_LABEL[s])).join('')}</div></div>
    <div class="field"><span class="lab">IPC billed in</span><div class="toggles">${bills.map((b) => tg('ipcs', b, b)).join('') || '<span class="note">No IPC loaded</span>'}</div></div>
    <div class="field"><span class="lab">Status date between</span><div class="row"><input type="date" id="fFrom" value="${esc(f.from)}" aria-label="From"><input type="date" id="fTo" value="${esc(f.to)}" aria-label="To"></div></div>
    <div class="row"><button class="btn" data-fclear>Clear filters</button><span class="note" id="fCount"></span></div>`;
}
function filterCount() {
  const n = S.items.filter((e) => { const k = S.link?.elToKey.get(e.id); return passes(k, currentState(k)); }).length;
  const c = $('#fCount'); if (c) c.textContent = `${n} of ${S.items.length} elements match`;
}
right.addEventListener('click', (e) => {
  const b = e.target.closest('[data-f]');
  if (b) { const set = S.filter[b.dataset.f]; const v = b.dataset.v; set.has(v) ? set.delete(v) : set.add(v); b.setAttribute('aria-pressed', set.has(v)); S.hits = null; applyLooks(); filterCount(); renderToolbar(); return; }
  if (e.target.closest('[data-fclear]')) { for (const k of ['piers', 'modules', 'types', 'states', 'ipcs']) S.filter[k].clear(); S.filter.from = S.filter.to = ''; renderRight(); applyLooks(); filterCount(); renderToolbar(); }
});
right.addEventListener('change', (e) => {
  if (e.target.id === 'fFrom' || e.target.id === 'fTo') { S.filter.from = $('#fFrom').value; S.filter.to = $('#fTo').value; applyLooks(); filterCount(); renderToolbar(); }
});

// ---- export
function exportHTML() {
  return `<p class="note" style="margin-top:0">Files are generated from the IPC and model shown now${S.ipc ? ` (${esc(S.ipc.bill)})` : ''}.</p>
    <div style="display:grid;gap:8px">
      <button class="btn" data-exp="xlsx">${svg('xlsx', 16)} Element register (.xlsx)</button>
      <span class="note">One row per model element with status, RFIs and issues, plus an RFI log and an issues sheet. Frozen header, filters and status colours.</span>
      <button class="btn" data-exp="csv">${svg('csv', 16)} Issues (.csv)</button>
      <button class="btn" data-exp="png">${svg('png', 16)} Screenshot of this view (.png)</button>
    </div>`;
}
right.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-exp]'); if (!b) return;
  const ctx = { ipc: S.ipc, link: S.link, ev: S.ev, model: S.model };
  b.disabled = true;
  try {
    const kind = b.dataset.exp;
    const r = kind === 'xlsx' ? await exportRegister(ctx) : kind === 'csv' ? await exportIssuesCSV(ctx) : await exportScreenshot(viewer, S.ipc);
    toast(r === 'declined' ? 'Save cancelled.' : 'Saved.');
  } catch (err) { toast(err.message || 'Export failed.'); } finally { b.disabled = false; }
});

// ---- settings
const runText = (a, b) => `P${a}–P${b}`;
function modelledText() {
  const mods = S.place?.modelled || [];
  if (!mods.length) return 'The IFC holds no whole module.';
  const lo = 6 + (mods[0] - 1) * 4, hi = 10 + (mods[mods.length - 1] - 1) * 4;
  return `The IFC holds ${mods.length === 1 ? 'module' : 'modules'} ${mods.join(' and ')} (${runText(lo, hi)}).`;
}
// Which piers the IFC is. The register's numbering is the starting point; where it would put
// the model past the end of the bridge, the nearest whole-module run inside it is assumed —
// and said so — until someone who knows the model chooses.
function numberingHTML(canEdit) {
  const nb = S.map?.numbering;
  if (!nb) return '';
  const span = nb.count - 1;
  const chosen = S.config.model?.numbering;
  const opts = [`<option value="auto" ${chosen ? '' : 'selected'}>Automatic${nb.auto ? ` (${runText(nb.piers[0], nb.piers[1])})` : ''}</option>`];
  for (const first of nb.starts) for (const rev of [false, true]) {
    const sel = chosen && chosen.first === first && !!chosen.reversed === rev ? 'selected' : '';
    opts.push(`<option value="${first}|${rev ? 1 : 0}" ${sel}>${runText(first, first + span)}${rev ? ', numbered the other way' : ''}</option>`);
  }
  const reg = nb.register ? runText(nb.register[0], nb.register[1]) : null;
  const warn = nb.auto && nb.register && !nb.fitsBridge
    ? `<div class="issuebox" style="margin-top:6px">The register numbers this model ${reg}, but the bridge ends at P30. It is drawn as ${runText(nb.piers[0], nb.piers[1])} — the nearest run of whole modules inside the bridge. Confirm with the modeller which piers this IFC covers, and choose them here.</div>`
    : '';
  return `<div class="field"><label for="pierRun">Piers in this IFC (${nb.count} well caps)</label><select id="pierRun" ${canEdit ? '' : 'disabled'}>${opts.join('')}</select>
    <span class="note">${reg ? `The register numbers it ${reg}. ` : 'No register names its well caps, so it is numbered from P6. '}"Numbered the other way" swaps which end is the lower pier number.</span></div>${warn}`;
}
function settingsHTML() {
  const cfg = S.config, lk = cfg.link || {};
  const canEdit = S.store?.canWrite;
  const tests = S.tests;
  return `
  <div class="sec" style="margin-top:0"><h3>Display</h3>
    <label class="check"><input type="checkbox" data-pref="showEdges" ${S.prefs.showEdges ? 'checked' : ''}> Show edges on solid elements</label>
    <label class="check"><input type="checkbox" data-pref="ghostYard" ${S.prefs.ghostYard ? 'checked' : ''}> Ghost cast-in-yard segments in amber</label>
    <label class="check"><input type="checkbox" data-pref="showReversed" ${S.prefs.showReversed ? 'checked' : ''}> Show reversed elements as dark-red wireframe</label>
    <div class="field" style="margin-top:6px"><label for="outSev">Amber outline for data issues of</label><select id="outSev">
      ${Object.entries(SEV_LABEL).map(([k, v]) => `<option value="${k}" ${(S.prefs.outlineSev || 'hm') === k ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
  </div>
  <div class="sec"><h3>Model link</h3>
    <div class="field"><label for="keySrc">Where keys come from</label><select id="keySrc" ${canEdit ? '' : 'disabled'}>
      <option value="both" ${!['register', 'property', 'geometry'].includes(lk.keySource) ? 'selected' : ''}>Register, then IFC property, then geometry</option>
      <option value="register" ${lk.keySource === 'register' ? 'selected' : ''}>Mapping register only</option>
      <option value="property" ${lk.keySource === 'property' ? 'selected' : ''}>IFC property only</option>
      <option value="geometry" ${lk.keySource === 'geometry' ? 'selected' : ''}>Geometry only (no register)</option></select>
      <span class="note">Geometry keys well caps, well lifts and deck segments from where they sit in the model; well lifts are provisional, since the model slices every well evenly.</span></div>
    <div class="row"><div class="field" style="flex:1"><label for="psetN">Property set</label><input type="text" id="psetN" value="${esc(lk.psetName || 'RFI_Tracker')}" ${canEdit ? '' : 'disabled'}></div>
    <div class="field" style="flex:1"><label for="propN">Property</label><input type="text" id="propN" value="${esc(lk.propName || 'RFI_Key')}" ${canEdit ? '' : 'disabled'}></div></div>
  </div>
  <div class="sec"><h3>Model copies and map</h3>
    ${numberingHTML(canEdit)}
    <p class="note" style="margin-top:10px">${modelledText()} Tick other modules to draw a copy of module ${S.tmpl?.m0 ?? '–'} there, linked to that module's RFIs.</p>
    <div class="toggles">${[1, 2, 3, 4, 5, 6].map((m) => { const on = (S.place?.modules || []).some((p) => p.m === m); const ifc = (S.place?.modelled || []).includes(m); return `<label class="tg" style="display:inline-flex;gap:5px;align-items:center"><input type="checkbox" data-mod="${m}" ${on ? 'checked' : ''} ${ifc || !canEdit ? 'disabled' : ''}>M${m} · P${6 + (m - 1) * 4}–P${10 + (m - 1) * 4}${ifc ? ' (IFC)' : ''}</label>`; }).join('')}</div>
    <div class="field" style="margin-top:10px"><label for="p6ch">Chainage of P6 along the alignment (m)</label><input type="text" inputmode="decimal" id="p6ch" value="${esc(S.config.map?.p6Chainage ?? DEFAULT_CONFIG.map.p6Chainage)}" ${canEdit ? '' : 'disabled'}>
      <span class="note">Other piers follow at 135 / 165 / 165 / 135 m spans. P30 is then at ch ${pierChainage(30).toLocaleString('en-IN')} m.${S.context ? ` The alignment is ${Math.round(chainages(S.context.align).pop()).toLocaleString('en-IN')} m long.` : ''}</span></div>
    ${S.datum ? `<p class="note">Levels: the model's well-cap top is tied to RL +${levels().wellCapTop.toFixed(3)} (model offset ${fmtNum(levels().wellCapTop - S.datum.capY, 3)} m). Edit the RLs in the parameters below.</p>` : ''}
  </div>
  <div class="sec"><h3>RFI-not-raised rules</h3>
    ${cfg.rules.map((r) => `<label class="check"><input type="checkbox" data-rule="${r.id}" ${r.enabled !== false ? 'checked' : ''} ${canEdit ? '' : 'disabled'}><span><b>${r.id} · ${esc(r.name)}</b><small>${esc(r.text)}</small></span></label>`).join('')}
    <details style="margin-top:8px"><summary class="note" style="cursor:pointer">Edit rule and check parameters (JSON)</summary>
      <textarea id="cfgJson" spellcheck="false" ${canEdit ? '' : 'disabled'}>${esc(JSON.stringify({ rules: cfg.rules.map(({ id, params }) => ({ id, params })), checks: cfg.checks, levels: levels(), map: cfg.map, model: cfg.model }, null, 2))}</textarea>
      <div class="row" style="margin-top:6px"><button class="btn primary" data-cfg="save" ${canEdit ? '' : 'disabled'}>Save parameters</button><button class="btn" data-cfg="reset" ${canEdit ? '' : 'disabled'}>Reset to defaults</button><span class="note" id="cfgMsg"></span></div>
    </details>
    ${canEdit ? '' : '<p class="note">Only editors of this tracker can change rules.</p>'}
  </div>
  <div class="sec"><h3>Acceptance tests (build prompt §12, IPC-34)</h3>
    <button class="btn" data-tests>Run tests on ${esc(S.ipc?.bill || 'the loaded IPC')}</button>
    ${tests ? `<p class="note">${tests.filter((x) => x.pass).length} of ${tests.length} pass.</p><div class="tablewrap"><table class="t"><thead><tr><th>Check</th><th>Expected</th><th>Got</th><th></th></tr></thead><tbody>${tests.map((x) => `<tr><td>${esc(x.name)}</td><td class="num">${esc(x.expected)}</td><td class="num">${esc(x.actual)}</td><td class="${x.pass ? 'pass' : 'fail'}">${x.pass ? 'Pass' : 'Fail'}</td></tr>`).join('')}</tbody></table></div>` : ''}
  </div>
  <div class="sec"><h3>Storage</h3><p class="note">${S.store?.shared ? 'Uploads are stored with this tracker and shared with everyone who can open it.' + (S.store.canWrite ? '' : ' You have view access, so uploads are turned off.') : 'Uploads are saved in this browser only. Open the tracker from its claude.ai link to share them with the team.'}</p>
    ${S.model?.warnings?.length ? `<p class="note">Model reader notes: ${esc(S.model.warnings.join('; '))}</p>` : ''}</div>`;
}
right.addEventListener('change', async (e) => {
  const p = e.target.dataset.pref;
  if (p) { S.prefs[p] = e.target.checked; savePrefs(); applyLooks(); renderLegend(); return; }
  if (e.target.id === 'outSev') { S.prefs.outlineSev = e.target.value; savePrefs(); ISSUE_KEYS = issueKeys(); applyLooks(); renderLegend(); return; }
  if (e.target.dataset.mod) {
    const set = new Set((S.place?.modules || []).map((p) => p.m));
    e.target.checked ? set.add(+e.target.dataset.mod) : set.delete(+e.target.dataset.mod);
    S.config.model = { ...S.config.model, showModules: [...set].sort() };
    await saveConfig(true); viewer.home(); return;
  }
  if (e.target.id === 'pierRun') {
    const [first, rev] = e.target.value.split('|');
    S.config.model = { ...S.config.model, numbering: e.target.value === 'auto' ? null : { first: +first, reversed: rev === '1' } };
    await saveConfig(true); viewer.home(); return;
  }
  if (e.target.id === 'p6ch') {
    const v = parseFloat(e.target.value);
    if (!Number.isFinite(v) || v < 0) { toast('Enter the chainage in metres, for example 5425.'); return; }
    S.config.map = { ...S.config.map, p6Chainage: v };
    await saveConfig(true); return;
  }
  const r = e.target.dataset.rule;
  if (r) { S.config.rules.find((x) => x.id === r).enabled = e.target.checked; await saveConfig(); return; }
  if (['keySrc', 'psetN', 'propN'].includes(e.target.id)) {
    S.config.link = { keySource: $('#keySrc').value, psetName: $('#psetN').value.trim() || 'RFI_Tracker', propName: $('#propN').value.trim() || 'RFI_Key' };
    await saveConfig(true);
  }
});
right.addEventListener('click', async (e) => {
  const c = e.target.closest('[data-cfg]');
  if (c) {
    const msg = $('#cfgMsg');
    if (c.dataset.cfg === 'reset') { S.config = { ...structuredClone(DEFAULT_CONFIG), link: S.config.link }; await saveConfig(); renderRight(); return; }
    try {
      const j = JSON.parse($('#cfgJson').value);
      for (const r of j.rules || []) { const t = S.config.rules.find((x) => x.id === r.id); if (t && r.params) t.params = r.params; }
      if (j.checks) S.config.checks = { ...S.config.checks, ...j.checks };
      if (j.levels) S.config.levels = { ...levels(), ...j.levels };
      if (j.map) S.config.map = { ...S.config.map, ...j.map };
      if (j.model) S.config.model = { ...S.config.model, ...j.model };
      await saveConfig(true); msg.textContent = 'Saved.';
    } catch (err) { msg.textContent = 'That JSON has an error: ' + err.message; }
    return;
  }
  if (e.target.closest('[data-tests]')) { S.tests = acceptanceTests(S.ipc, S.ev); renderRight(); }
});
async function saveConfig(relink = false) {
  if (relink) buildScene();
  recompute(); renderAll();
  try { if (S.store?.canWrite) await S.store.saveConfig(S.config); } catch (err) { toast('Settings could not be saved: ' + err.message); }
}

// ------------------------------------------------------------------ model browser
const left = $('#left');
function treeData() {
  const mods = new Map();
  const add = (mod, unit, grp, key, ids) => {
    if (!mods.has(mod)) mods.set(mod, new Map());
    const m = mods.get(mod);
    if (!m.has(unit)) m.set(unit, new Map());
    const u = m.get(unit);
    if (!u.has(grp)) u.set(grp, []);
    u.get(grp).push({ key, ids });
  };
  for (const [key, els] of S.link?.keyToEls || []) {
    const d = decodeKey(key);
    const ids = els.map((e) => e.id);
    if (!d.unit) { add('Other', 'Other', 'Other', key, ids); continue; }
    const grp = { CE: 'Well', WELL: 'Well', PLUG: 'Well', CAP: 'Well', LPYL: 'Lower pylon', PT: 'Pier table', UPYL: 'Upper pylon', SEG: `${d.arm} arm` }[d.type] || 'Other';
    add(pierModule(d.unit), d.unit, grp, key, ids);
  }
  return mods;
}
const GRP_ORDER = ['Well', 'Lower pylon', 'Pier table', 'Upper pylon', 'KS arm', 'BP arm', 'Other'];
function renderTree() {
  if (!S.leftOpen) { left.hidden = true; return; }
  left.hidden = false;
  const mods = treeData();
  const cnt = (keys) => { const b = keys.filter((k) => ['built', 'yard'].includes(currentState(k))).length; return `<span class="cnt" title="with an RFI / total">${b} / ${keys.length}</span>`; };
  const eye = (ids, node) => { const off = ids.length && ids.every((i) => S.hidden.has(i)); return `<button class="eye${off ? ' off' : ''}" data-eye="${node}" title="${off ? 'Show' : 'Hide'}" aria-label="${off ? 'Show' : 'Hide'}">${svg(off ? 'eyeOff' : 'eye', 15)}</button>`; };
  S.treeIds = new Map();
  const node = (id, label, children, keys, ids) => {
    S.treeIds.set(id, ids);
    const open = S.treeOpen.has(id);
    const badge = keys.length ? cnt(keys) : `<span class="cnt">${ids.length}</span>`;
    return `<li><div class="tn"><button class="tw" data-tw="${id}" aria-expanded="${open}" aria-label="Expand">${svg(open ? 'chevD' : 'chev', 13)}</button><button class="lbl" data-tw="${id}">${label}</button>${badge}${eye(ids, id)}</div>${open ? `<ul>${children()}</ul>` : ''}</li>`;
  };
  let html = '<ul class="tree">';
  const modKeys = [...mods.keys()].sort((a, b) => (a === 'Other') - (b === 'Other') || a - b);
  for (const m of modKeys) {
    const units = mods.get(m);
    const mk = [...units.values()].flatMap((g) => [...g.values()].flat());
    html += node(`m${m}`, `<b>Module ${m}</b>`, () => {
      let h = '';
      for (const u of [...units.keys()].sort((a, b) => pierNo(a) - pierNo(b))) {
        const groups = units.get(u);
        const uk = [...groups.values()].flat();
        h += node(`u${u}`, `<span class="mono">${esc(u)}</span><span class="role">${esc(roleOf(pierNo(u)))}</span>`, () => {
          let g2 = '';
          for (const g of [...groups.keys()].sort((a, b) => GRP_ORDER.indexOf(a) - GRP_ORDER.indexOf(b))) {
            const items = groups.get(g).sort((a, b) => keySort(a.key, b.key));
            g2 += node(`g${u}|${g}`, esc(g === 'Well' ? 'Well (lifts)' : g === 'Lower pylon' ? 'Lower pylon (lifts)' : g === 'KS arm' ? 'KS arm · Kaita Sidhi' : g === 'BP arm' ? 'BP arm · Bathan Pam' : g), () => items.map((it) => {
              S.treeIds.set('k' + it.key, it.ids);
              const s = currentState(it.key);
              return `<li><div class="tn leaf-row${S.selKey === it.key ? ' sel' : ''}" data-row="${esc(it.key)}"><span class="tw leaf"></span><button class="lbl" data-sel="${esc(it.key)}"><span class="sw ${s}"></span><span class="mono">${esc(it.key)}</span></button>${eye(it.ids, 'k' + it.key)}</div></li>`;
            }).join(''), items.map((x) => x.key), items.flatMap((x) => x.ids));
          }
          return g2;
        }, uk.map((x) => x.key), uk.flatMap((x) => x.ids));
      }
      return h;
    }, mk.map((x) => x.key), mk.flatMap((x) => x.ids));
  }
  const nok = S.link?.coverage?.modelNoKey || [];
  if (nok.length) html += node('nokey', `<span class="note">Model elements with no key</span>`, () => nok.map((e) => `<li><div class="tn leaf-row"><span class="tw leaf"></span><button class="lbl" data-elsel="${e.id}"><span class="sw noKey"></span>${esc(e.name || e.cls)}</button>${eye([e.id], 'e' + e.id)}</div></li>`).join(''), [], nok.map((e) => e.id));
  nok.forEach((e) => S.treeIds.set('e' + e.id, [e.id]));
  html += '</ul>';
  if (!S.model) html = '<div class="body"><p class="note">Upload an IFC model to see its elements here.</p></div>';
  const scroll = left.querySelector('.body')?.scrollTop || 0;
  left.innerHTML = panelShell('Model browser', html, true);
  left.querySelector('.body').scrollTop = scroll;
}
function renderTreeSel(reveal = false) {
  if (!S.leftOpen) return;
  if (reveal && S.selKey) {
    const d = decodeKey(S.selKey);
    if (d.unit) {
      const grp = { CE: 'Well', WELL: 'Well', PLUG: 'Well', CAP: 'Well', LPYL: 'Lower pylon', PT: 'Pier table', UPYL: 'Upper pylon', SEG: `${d.arm} arm` }[d.type];
      const need = [`m${pierModule(d.unit)}`, `u${d.unit}`, `g${d.unit}|${grp}`];
      if (need.some((n) => !S.treeOpen.has(n))) { need.forEach((n) => S.treeOpen.add(n)); renderTree(); }
    }
  }
  left.querySelectorAll('.tn.sel').forEach((x) => x.classList.remove('sel'));
  const row = S.selKey && left.querySelector(`[data-row="${CSS.escape(S.selKey)}"]`);
  if (row) { row.classList.add('sel'); if (reveal) row.scrollIntoView({ block: 'nearest' }); }
}
left.addEventListener('click', (e) => {
  if (e.target.closest('[data-close]')) { S.leftOpen = false; left.hidden = true; renderToolbar(); return; }
  const ey = e.target.closest('[data-eye]');
  if (ey) { const ids = S.treeIds.get(ey.dataset.eye) || []; const allOff = ids.every((i) => S.hidden.has(i)); ids.forEach((i) => (allOff ? S.hidden.delete(i) : S.hidden.add(i))); applyLooks(); renderTree(); return; }
  const s = e.target.closest('[data-sel]');
  if (s) { select(s.dataset.sel); return; }
  const es = e.target.closest('[data-elsel]');
  if (es) { const id = es.dataset.elsel; S.selUnmapped = id; S.selKey = null; S.selIds = new Set(); applyLooks(); viewer.fit([id]); openRight('props'); return; }
  const tw = e.target.closest('[data-tw]');
  if (tw) { const id = tw.dataset.tw; S.treeOpen.has(id) ? S.treeOpen.delete(id) : S.treeOpen.add(id); renderTree(); }
});

// ------------------------------------------------------------------ legend
const legend = $('#legend');
function renderLegend() {
  const c = S.ev?.counts || {};
  const nok = S.link?.coverage?.modelNoKey.length || 0;
  const iss = modelKeys().filter((k) => ISSUE_KEYS.has(k)).length;
  const li = (sw, label, n, sub = '') => `<li><span class="sw ${sw}"></span><span>${label}${sub ? `<br><small>${sub}</small>` : ''}</span><span class="n">${n ?? 0}</span></li>`;
  const mode = S.prefs.colourBy;
  let scale = '';
  if (mode === 'stage') { const used = new Set(modelKeys().map((k) => S.ipc?.elements.get(k)?.status).filter((s) => s && STAGE_COLORS[s])); scale = `<div class="cats">${[...used].map((s) => `<label><span class="sw" style="background:${STAGE_COLORS[s]}"></span>${esc(s)}</label>`).join('') || '<span class="note">No stages yet</span>'}</div>`; }
  if (mode === 'ipc' && S.scaleIpc) scale = `<div class="scale" style="background:linear-gradient(90deg,${SEQ[0]},${SEQ[1]})"></div><div class="scale-l"><span>IPC-${S.scaleIpc.min}</span><span>IPC-${S.scaleIpc.max}</span></div>`;
  if (mode === 'date' && S.scaleDate) scale = `<div class="scale" style="background:linear-gradient(90deg,${SEQ_DATE[0]},${SEQ_DATE[1]})"></div><div class="scale-l"><span>${fmtDate(isoFromDay(S.scaleDate.min))}</span><span>${fmtDate(isoFromDay(S.scaleDate.max))}</span></div>`;
  const newRow = S.t4d.on && S.t4d.mode === 'new' ? li('new', `New in ${esc(S.ipc?.bill || 'this IPC')}`, modelKeys().filter((k) => S.t4d.newKeys.has(k)).length) : '';
  legend.className = 'legend' + (S.prefs.legendCollapsed ? ' collapsed' : '');
  legend.innerHTML = `<header><span>Legend${S.t4d.on && S.t4d.mode === 'replay' ? ` · as of ${fmtDate(isoFromDay(S.t4d.day))}` : ''}</span><button class="iconbtn" id="legTog" aria-expanded="${!S.prefs.legendCollapsed}" title="${S.prefs.legendCollapsed ? 'Expand' : 'Collapse'} legend" aria-label="Toggle legend">${svg(S.prefs.legendCollapsed ? 'chev' : 'chevD', 14)}</button></header>
  <ul>
    ${newRow}
    ${li('built', 'Built', c.built, S.prefs.colourBy !== 'none' ? 'coloured by ' + (mode === 'ipc' ? 'IPC' : mode === 'date' ? 'RFI date' : 'stage') : 'solid')}
    ${li('yard', 'Cast in yard', c.yard, 'not erected')}
    ${li('notYet', 'Not yet', c.notYet, 'no RFI, not expected yet')}
    ${li('notRaised', 'RFI not raised', (c.notRaised || 0) + (S.markerKeys?.size || 0), S.markerKeys?.size ? `logic says it must exist · ${S.markerKeys.size} off-model, red block at approx. position` : 'logic says it must exist')}
    ${li('issue', 'Data issue', iss, 'amber outline · ' + SEV_LABEL[S.prefs.outlineSev || 'hm'])}
    ${li('reversed', 'Reversed', c.reversed, S.prefs.showReversed ? 'dark-red wireframe' : 'hidden')}
    ${li('noModel', 'No model element', c.noModel, 'listed in Issues')}
    ${nok ? li('noKey', 'Model element with no key', nok) : ''}
  </ul>
  <div class="opts">
    <label>Colour by <select id="colBy"><option value="none">none</option><option value="stage">stage</option><option value="ipc">IPC</option><option value="date">RFI date</option></select></label>
    ${scale}
    <label><input type="checkbox" id="ghostY" ${S.prefs.ghostYard ? 'checked' : ''}> Ghost cast-in-yard (amber)</label>
    <label><input type="checkbox" id="showRev" ${S.prefs.showReversed ? 'checked' : ''}> Show reversed</label>
  </div>
  <div class="opts">
    <label><span class="sw water"></span>Water <select id="waterSel" aria-label="Water level">
      <option value="cap">at well cap top · RL +${levels().wellCapTop.toFixed(3)}</option>
      <option value="hfl">at HFL · RL +${levels().hfl.toFixed(3)}</option>
      <option value="off">off</option></select></label>
    ${S.context ? `<label><input type="checkbox" id="mapOn" ${S.prefs.mapOn !== false ? 'checked' : ''}> Map context (alignment)</label>
    ${S.prefs.mapOn !== false ? `<button class="btn" id="wholeAl" style="justify-self:start;padding:3px 10px">Whole alignment</button><small class="note">P6 at ch ${pierChainage(6).toLocaleString('en-IN')} m, approximate</small>` : ''}` : '<small class="note">Upload a KMZ alignment to place the model on a map.</small>'}
  </div>`;
  $('#waterSel').value = S.prefs.waterLevel || 'cap';
  $('#colBy').value = mode;
}
legend.addEventListener('click', (e) => {
  if (e.target.closest('#legTog')) { S.prefs.legendCollapsed = !S.prefs.legendCollapsed; savePrefs(); renderLegend(); }
  if (e.target.closest('#wholeAl')) viewer.viewAlignment();
});
legend.addEventListener('change', (e) => {
  if (e.target.id === 'waterSel' || e.target.id === 'mapOn') {
    if (e.target.id === 'waterSel') S.prefs.waterLevel = e.target.value; else S.prefs.mapOn = e.target.checked;
    savePrefs(); buildScene({ keepItems: e.target.id === 'waterSel' }); recompute(); renderAll();
    if (e.target.id === 'mapOn') viewer.home();
    return;
  }
  if (e.target.id === 'colBy') S.prefs.colourBy = e.target.value;
  if (e.target.id === 'ghostY') S.prefs.ghostYard = e.target.checked;
  if (e.target.id === 'showRev') S.prefs.showReversed = e.target.checked;
  savePrefs(); applyLooks(); renderLegend();
});

// ------------------------------------------------------------------ toolbar
const TOOLS = [['home', 'Home view (H)'], ['nav', 'Orbit / pan'], ['fit', 'Fit to view (F)'], '|', ['section', 'Section box'], ['measure', 'Measure distance'], '|', ['tree', 'Model browser'], ['props', 'Properties'], ['filters', 'Filters'], ['issues', 'Issues'], ['t4d', '4D timeline'], '|', ['upload', 'Upload files'], ['export', 'Export'], ['settings', 'Settings']];
function renderToolbar() {
  const fAny = S.filter.piers.size || S.filter.modules.size || S.filter.types.size || S.filter.states.size || S.filter.ipcs.size || S.filter.from || S.filter.to;
  const pressed = { nav: viewer.mode === 'pan', section: !!S.section, measure: viewer.measuring, tree: S.leftOpen, props: S.right === 'props', filters: S.right === 'filters' || fAny, issues: S.right === 'issues', t4d: S.t4d.on, export: S.right === 'export', settings: S.right === 'settings' };
  $('#toolbar').innerHTML = TOOLS.map((t) => (t === '|' ? '<span class="sep"></span>' : `<button class="iconbtn" data-tool="${t[0]}" title="${t[0] === 'nav' ? (viewer.mode === 'pan' ? 'Pan (click for orbit)' : 'Orbit (click for pan)') : t[1]}" aria-label="${t[1]}" ${t[0] in pressed ? `aria-pressed="${!!pressed[t[0]]}"` : ''} ${t[0] === 'upload' && S.store && !S.store.canWrite ? 'disabled' : ''}>${svg(t[0] === 'nav' ? (viewer.mode === 'pan' ? 'pan' : 'orbit') : t[0])}</button>`)).join('');
}
$('#toolbar').addEventListener('click', (e) => {
  const b = e.target.closest('[data-tool]'); if (!b) return;
  const t = b.dataset.tool;
  if (t === 'home') viewer.home();
  if (t === 'nav') viewer.setNavMode(viewer.mode === 'pan' ? 'orbit' : 'pan');
  if (t === 'fit') viewer.fit(S.selIds.size ? [...S.selIds] : null);
  if (t === 'section') toggleSection();
  if (t === 'measure') { viewer.setMeasuring(!viewer.measuring); if (viewer.measuring) toast('Click two points on the model to measure. Click the tool again to stop.'); }
  if (t === 'tree') { S.leftOpen = !S.leftOpen; renderTree(); }
  if (['props', 'filters', 'issues', 'export', 'settings'].includes(t)) { if (S.right === t) { S.right = null; right.hidden = true; } else openRight(t); if (t === 'filters') filterCount(); }
  if (t === 't4d') toggle4d();
  if (t === 'upload') openUpload();
  renderToolbar();
});
listen(document, 'keydown', (e) => {
  if (e.target.closest('input, textarea, select')) return;
  if (e.key === 'Escape') { if (viewer.measuring) viewer.setMeasuring(false); S.hits = null; S.isolate = null; S.selKey = null; S.selIds = new Set(); S.selUnmapped = null; applyLooks(); renderChips(); renderToolbar(); if (S.right === 'props') renderRight(); }
  if (e.key === 'h' || e.key === 'H') viewer.home();
  if (e.key === 'f' || e.key === 'F') viewer.fit(S.selIds.size ? [...S.selIds] : null);
});

// ------------------------------------------------------------------ section box
function toggleSection() {
  const box = $('#sectionBox');
  if (S.section) { S.section = null; viewer.setSection(null); box.hidden = true; return; }
  if (!S.model) return;
  S.section = { x: [0, 1], y: [0, 1], z: [0, 1] };
  viewer.setSection(S.section);
  const rr = (ax, label) => `<div class="rr"><span>${label}</span><input type="range" min="0" max="1000" value="0" data-sec="${ax}0" aria-label="${label} start"><input type="range" min="0" max="1000" value="1000" data-sec="${ax}1" aria-label="${label} end"></div>`;
  box.innerHTML = `<div class="row" style="justify-content:space-between"><h2>Section box</h2><button class="iconbtn" data-secclose title="Close" aria-label="Close section box">${svg('close', 16)}</button></div>
    <div class="note">Drag to cut the model away.</div>${rr('z', 'Along')}${rr('x', 'Across')}${rr('y', 'Height')}
    <div class="row" style="margin-top:8px"><button class="btn" data-secreset>Reset</button></div>`;
  box.hidden = false;
}
$('#sectionBox').addEventListener('input', (e) => {
  const s = e.target.dataset.sec; if (!s) return;
  const ax = s[0], i = +s[1];
  S.section[ax][i] = e.target.value / 1000;
  if (S.section[ax][0] > S.section[ax][1] - 0.001) S.section[ax][i] = i ? S.section[ax][0] + 0.001 : S.section[ax][1] - 0.001;
  viewer.setSection(S.section);
});
$('#sectionBox').addEventListener('click', (e) => {
  if (e.target.closest('[data-secclose]')) { toggleSection(); renderToolbar(); }
  if (e.target.closest('[data-secreset]')) { S.section = null; toggleSection(); }
});

// ------------------------------------------------------------------ 4D
function toggle4d() {
  const tl = $('#timeline');
  if (S.t4d.on) { S.t4d.on = false; clearInterval(S.t4d.playing); S.t4d.playing = null; tl.hidden = true; applyLooks(); renderLegend(); updateMarkers(); return; }
  if (!S.ipc) { toast('Upload an IPC workbook first.'); return; }
  S.t4d.on = true;
  renderTimeline(); tl.hidden = false; applyLooks(); renderLegend(); updateMarkers();
}
function renderTimeline() {
  const t = S.t4d, tl = $('#timeline');
  tl.innerHTML = `<button class="iconbtn" id="tlPlay" title="${t.playing ? 'Pause' : 'Play'}" aria-label="${t.playing ? 'Pause' : 'Play'}" ${t.mode === 'new' ? 'disabled' : ''}>${svg(t.playing ? 'pause' : 'play', 18)}</button>
    <input type="range" id="tlDay" min="${t.min}" max="${t.max}" value="${t.day}" aria-label="RFI date" ${t.mode === 'new' ? 'disabled' : ''}>
    <span class="date" id="tlDate">${fmtDate(isoFromDay(t.day))}</span>
    <div class="modes"><label><input type="radio" name="tlm" value="replay" ${t.mode === 'replay' ? 'checked' : ''}> Replay by RFI date</label>
    <label><input type="radio" name="tlm" value="new" ${t.mode === 'new' ? 'checked' : ''}> What's new in ${esc(S.ipc?.bill || 'this IPC')}</label>
    <span id="tlNote">${t.mode === 'new' ? `${modelKeys().filter((k) => t.newKeys.has(k)).length} in the model · ${t.newKeys.size} in total (${esc(t.newNote)})` : ''}</span></div>`;
}
$('#timeline').addEventListener('input', (e) => { if (e.target.id === 'tlDay') { S.t4d.day = +e.target.value; $('#tlDate').textContent = fmtDate(isoFromDay(S.t4d.day)); applyLooks(); renderLegendCountsSoon(); } });
$('#timeline').addEventListener('change', (e) => { if (e.target.name === 'tlm') { S.t4d.mode = e.target.value; clearInterval(S.t4d.playing); S.t4d.playing = null; renderTimeline(); applyLooks(); renderLegend(); } });
$('#timeline').addEventListener('click', (e) => {
  if (!e.target.closest('#tlPlay')) return;
  const t = S.t4d;
  if (t.playing) { clearInterval(t.playing); t.playing = null; renderTimeline(); return; }
  if (t.day >= t.max) t.day = t.min;
  t.playing = setInterval(() => {
    t.day = Math.min(t.max, t.day + 7);
    const r = $('#tlDay'); if (r) r.value = t.day;
    $('#tlDate').textContent = fmtDate(isoFromDay(t.day));
    applyLooks(); renderLegendCountsSoon();
    if (t.day >= t.max) { clearInterval(t.playing); t.playing = null; renderTimeline(); }
  }, 90);
  renderTimeline();
});
let legT = null;
function renderLegendCountsSoon() {
  clearTimeout(legT);
  legT = setTimeout(() => {
    const c = { built: 0, yard: 0, notYet: 0, notRaised: 0, reversed: 0 };
    for (const k of modelKeys()) c[currentState(k)]++;
    const save = S.ev.counts; S.ev.counts = { ...save, ...c };
    renderLegend(); S.ev.counts = save;
  }, 120);
}

// ------------------------------------------------------------------ upload
const modal = $('#modal');
function openUpload() {
  if (S.store && !S.store.canWrite) { toast('You have view access to this tracker. Ask its owner for edit access to upload.'); return; }
  const st = S.state;
  const cur = (m, extra = '') => (m ? `<b>${esc(m.name)}</b> · ${bytes(m.size)}<br>${extra}uploaded ${fmtDateTime(m.at)}${m.by ? ' by ' + esc(who(m.by)) : ''}` : 'Nothing uploaded yet');
  const latest = [...st.ipcs].sort((a, b) => b.at - a.at);
  modal.innerHTML = `<div class="card" role="dialog" aria-modal="true" aria-labelledby="upT"><header><h2 id="upT">Upload files</h2><button class="iconbtn" data-mclose aria-label="Close">${svg('close', 16)}</button></header><div class="body">
    <div class="drops">
      <div class="drop" data-drop="ifc"><h3>IFC model</h3><div class="note">Upload once, and again when the model is revised.</div><div class="cur">${cur(st.ifc)}</div><button class="btn" data-pick="ifc">${svg('upload', 15)} Choose .ifc</button></div>
      <div class="drop" data-drop="register"><h3>Mapping register</h3><div class="note">Sheet Element_Register with Element_Key and IFC_GlobalId.</div><div class="cur">${cur(st.register)}</div><button class="btn" data-pick="register">${svg('upload', 15)} Choose .xlsx</button></div>
      <div class="drop" data-drop="ipc"><h3>Monthly IPC workbook</h3><div class="note">The latest upload becomes the current state. Only Schedule 4 is read.</div><div class="cur">${latest[0] ? cur(latest[0], `${esc(latest[0].bill || '')} ${esc(latest[0].period || '')}<br>`) : 'Nothing uploaded yet'}</div><button class="btn primary" data-pick="ipc">${svg('upload', 15)} Choose .xlsx</button></div>
      <div class="drop" data-drop="align"><h3>Alignment (map)</h3><div class="note">KMZ or KML of the road alignment. The longest line is used as the alignment.</div><div class="cur">${cur(st.context)}</div><button class="btn" data-pick="align">${svg('upload', 15)} Choose .kmz / .kml</button></div>
    </div>
    <p class="note">${S.store?.shared ? 'Files are stored with this tracker, so everyone who opens it sees the same latest upload.' : 'Files are saved in this browser only.'} You can also drop a file on a box.</p>
    ${latest.length ? `<div class="sec"><h3>IPC uploads</h3><div class="tablewrap"><table class="t"><thead><tr><th>Bill</th><th>Period</th><th>File</th><th>Uploaded</th><th></th></tr></thead><tbody>${latest.map((x) => `<tr><td>${esc(x.bill || '–')}</td><td>${esc(x.period || '–')}</td><td>${esc(x.name)}</td><td>${fmtDateTime(x.at)}${x.by ? '<br><span class="note">' + esc(who(x.by)) + '</span>' : ''}</td><td>${x.asset === S.viewIpc ? '<span class="note">Showing</span>' : `<button class="btn" data-show="${esc(x.asset)}">Show</button>`}</td></tr>`).join('')}</tbody></table></div></div>` : ''}
    <input type="file" id="fileIn" hidden>
  </div></div>`;
  modal.hidden = false;
}
modal.addEventListener('click', async (e) => {
  if (e.target === modal || e.target.closest('[data-mclose]')) { modal.hidden = true; return; }
  const p = e.target.closest('[data-pick]');
  if (p) { const fi = $('#fileIn'); fi.accept = { ifc: '.ifc', align: '.kmz,.kml' }[p.dataset.pick] || '.xlsx,.xlsm'; fi.dataset.kind = p.dataset.pick; fi.value = ''; fi.click(); return; }
  const s = e.target.closest('[data-show]');
  if (s) { modal.hidden = true; await activateIpc(s.dataset.show); }
});
modal.addEventListener('change', (e) => { if (e.target.id === 'fileIn' && e.target.files[0]) handleUpload(e.target.dataset.kind, e.target.files[0]); });
modal.addEventListener('dragover', (e) => { const d = e.target.closest('[data-drop]'); if (d) { e.preventDefault(); d.classList.add('over'); } });
modal.addEventListener('dragleave', (e) => { const d = e.target.closest('[data-drop]'); if (d) d.classList.remove('over'); });
modal.addEventListener('drop', (e) => { const d = e.target.closest('[data-drop]'); if (!d) return; e.preventDefault(); d.classList.remove('over'); const f = e.dataTransfer.files[0]; if (f) handleUpload(d.dataset.drop, f); });

async function handleUpload(kind, file) {
  modal.hidden = true;
  if (S.busy) { toast('Still working on the last file. Try again in a moment.'); return; }
  S.busy = true;
  try {
    const onProgress = (f, label) => progress(`${file.name}: ${label}`, f);
    let parsed;
    if (kind === 'ifc') parsed = await parseIFC(await file.text(), { onProgress, fileName: file.name });
    if (kind === 'register') parsed = parseRegister(await file.arrayBuffer(), file.name);
    if (kind === 'ipc') parsed = await parseIPC(await file.arrayBuffer(), { onProgress, fileName: file.name });
    if (kind === 'align') parsed = await parseAlignment(file, { onProgress });
    progress('Saving ' + file.name, 1);
    const extra = kind === 'ipc' ? { bill: parsed.bill, period: parsed.period } : {};
    const { meta } = kind === 'align' ? await S.store.putJSON(parsed, file.name) : await S.store.putFile(file, kind, extra);
    const st = await S.store.loadState();
    if (kind === 'ipc') { meta.bill = parsed.bill; meta.period = parsed.period; st.ipcs = [...(st.ipcs || []).filter((x) => x.asset !== meta.asset), meta]; st.activeIpc = meta.asset; }
    else if (kind === 'align') st.context = meta;
    else st[kind] = meta;
    await S.store.saveState(st);
    S.state = st;
    if (kind === 'ifc') { S.model = parsed; S.modelAsset = meta.asset; }
    if (kind === 'register') { S.register = parsed; S.registerAsset = meta.asset; }
    if (kind === 'ipc') { S.ipcCache.set(meta.asset, parsed); S.viewIpc = meta.asset; S.ipc = parsed; await ensurePrev(); }
    if (kind === 'align') { S.context = parsed; S.contextAsset = meta.asset; S.prefs.mapOn = true; savePrefs(); }
    buildScene({ keepItems: kind === 'ipc' }); recompute(); computeScales(); renderAll();
    progress(null);
    if (kind === 'ipc') toast(`${parsed.bill || file.name}: ${parsed.rows.length} rows read, ${S.ev.notRaised.size} RFIs not raised, ${S.ev.issues.length} data issues.`, 6000);
    else if (kind === 'align') { toast(`Alignment loaded: ${Math.round(chainages(parsed.align).pop()).toLocaleString('en-IN')} m. P6 is placed at chainage ${pierChainage(6).toLocaleString('en-IN')} m; adjust it in Settings.`, 7000); viewer.viewAlignment(); }
    else { const c = S.link?.coverage; toast(c ? `Linked ${S.link.keyToEls.size} keys. ${c.modelNoKey.length} model elements have no key; ${c.gidsNotFound.length} register GUIDs aren't in the IFC.` : 'Saved.', 6500); openRight('issues', 'coverage'); }
  } catch (err) {
    progress(null);
    console.error(err);
    toast(err.message || 'That file could not be read.', 7000);
  } finally { S.busy = false; }
}

// ------------------------------------------------------------------ scene: model copies, map context, water
// The IFC holds one or more whole modules. Each other module chosen in Settings gets a
// copy of one of them (the template), keyed by renumbering the template's keys (pier n ->
// n + 4 per module), and placed either on the KMZ alignment (by pier chainage) or in a
// straight line.
const SPAN = [135, 165, 165, 135]; // pier of role r to the next pier (EJ, outer, middle, outer)
const MODULE_LEN = 600;
const levels = () => ({ ...DEFAULT_CONFIG.levels, ...(S.config.levels || {}) });
function pierChainage(n) {
  let c = +(S.config.map?.p6Chainage ?? DEFAULT_CONFIG.map.p6Chainage);
  for (let k = 6; k < n; k++) c += SPAN[roleIndex(k)];
  return c;
}
function rigidFit(src, dst) {
  const n = src.length;
  const ms = [0, 0], mt = [0, 0];
  for (let i = 0; i < n; i++) { ms[0] += src[i][0] / n; ms[1] += src[i][1] / n; mt[0] += dst[i][0] / n; mt[1] += dst[i][1] / n; }
  let dot = 0, cross = 0;
  for (let i = 0; i < n; i++) {
    const a0 = src[i][0] - ms[0], a1 = src[i][1] - ms[1], b0 = dst[i][0] - mt[0], b1 = dst[i][1] - mt[1];
    dot += a0 * b0 + a1 * b1; cross += a0 * b1 - a1 * b0;
  }
  const th = Math.atan2(cross, dot), c = Math.cos(th), s = Math.sin(th);
  const M = new THREE.Matrix4().makeRotationY(-th);
  M.setPosition(mt[0] - (c * ms[0] - s * ms[1]), 0, mt[1] - (s * ms[0] + c * ms[1]));
  return M;
}
function contextFrame() {
  const ctx = S.context && S.prefs.mapOn !== false ? S.context : null;
  if (!ctx) return null;
  const ch = chainages(ctx.align);
  const T = S.tmpl;
  const o = pointAt(ctx.align, ch, pierChainage((T?.n0 ?? 6) + 2));
  const toS = (e, n) => [e - o.e, -(n - o.n)];
  const at = (c) => { const q = pointAt(ctx.align, ch, c); return toS(q.e, q.n); };
  return { ctx, ch, toS, at, length: ch[ch.length - 1] };
}
function rectAlong(F, c0, c1, half) {
  const a = F.at(c0), b = F.at(c1);
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  const nx = -(b[1] - a[1]) / L, nz = (b[0] - a[0]) / L;
  return [[a[0] + nx * half, a[1] + nz * half], [b[0] + nx * half, b[1] + nz * half], [b[0] - nx * half, b[1] - nz * half], [a[0] - nx * half, a[1] - nz * half]];
}

// ---- red stand-ins for "RFI not raised" elements outside the model ----
function pierPose(n) {
  const T = S.tmpl, F = S.frameF;
  if (F) {
    const c = pierChainage(n), a = F.at(c), b = F.at(c + 5);
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    return { x: a[0], z: a[1], dx: (b[0] - a[0]) / L, dz: (b[1] - a[1]) / L };
  }
  if (!T || T.piers.length < 2 || !S.place) return null;
  const t = S.place.modules.find((p) => p.m === T.m0) || S.place.modules[0];
  const A = new THREE.Vector3(T.piers[0].x, 0, T.piers[0].z).applyMatrix4(t.matrix);
  const B = new THREE.Vector3(T.piers[T.piers.length - 1].x, 0, T.piers[T.piers.length - 1].z).applyMatrix4(t.matrix);
  const L = Math.hypot(B.x - A.x, B.z - A.z) || 1, dx = (B.x - A.x) / L, dz = (B.z - A.z) / L;
  const off = pierChainage(n) - pierChainage(T.piers[0].n);
  return { x: A.x + dx * off, z: A.z + dz * off, dx, dz };
}
const segLen = (d) => (d.fam === 'E' ? (d.a ? 5 : 3.2) : d.seg <= (d.fam === 'O' ? 8 : 7) ? 2.35 : 3.2);
function segOffset(d) {
  if (d.fam === 'E') return d.a ? 2.5 : 7.4 + (d.seg - 1) * 3.2 + 1.6;
  let off = 4.85; // half the pier table
  for (let s = 1; s < d.seg; s++) off += segLen({ ...d, seg: s });
  return off + segLen(d) / 2;
}
function markerFor(key) {
  const d = decodeKey(key);
  if (!d.pier || !S.datum) return null;
  const pose = pierPose(d.pier);
  if (!pose) return null;
  const lv = levels(), capY = S.datum.capY, deckY = S.datum.y(lv.deckTop);
  const depth = d.fam === 'E' ? 50.55 : 54.05, liftH = 2.6;
  let along = 0, w = 13, l = 13, h = 3, y = capY;
  switch (d.type) {
    case 'SEG': along = (d.arm === 'BP' ? 1 : -1) * segOffset(d); l = segLen(d); w = 28; h = 3.6; y = deckY - 1.8; break;
    case 'WELL': y = capY - 3 - depth + (d.lift + 0.5) * liftH; h = liftH; break;
    case 'CE': y = capY - 3 - depth - 0.5; w = l = 14; h = 1; break;
    case 'PLUG': y = capY - 3 - depth + 2; w = l = 11; h = 4; break;
    case 'CAP': y = capY - 1.5; w = l = 16; break;
    case 'LPYL': y = capY + (d.lift ?? 0) * 3 + 1.5; w = 7; l = 5; break;
    case 'PT': y = deckY - 2; w = 28; l = 9.7; h = 4; break;
    case 'UPYL': y = deckY + (d.lift ?? 0) * 4 + 2; w = l = 4; h = 4; break;
    default: return null;
  }
  const geometry = new THREE.BoxGeometry(w, h, l);
  geometry.computeBoundingBox();
  const matrix = new THREE.Matrix4().makeRotationY(Math.atan2(pose.dx, pose.dz));
  matrix.setPosition(pose.x + pose.dx * along, y, pose.z + pose.dz * along);
  return { id: 'proxy:' + key, key, geometry, matrix, label: `${key} · RFI not raised` };
}
function updateMarkers() {
  if (!S.ev || !S.link || S.t4d.on) { viewer.setMarkers([]); return; }
  const list = [];
  for (const key of S.ev.notRaised.keys()) if (!S.link.keyToEls.has(key)) { const m = markerFor(key); if (m) list.push(m); }
  viewer.setMarkers(list);
  S.markerKeys = new Set(list.map((m) => m.key));
}

function buildScene({ keepItems = false } = {}) {
  if (!S.model) { S.items = []; S.itemById = new Map(); S.link = null; S.place = null; viewer.setContext(null); viewer.setWater(null); S.modelPiers = new Set(); return; }
  const plan = planScene({ model: S.model, register: S.register, config: S.config });
  S.map = plan.map;
  const T = (S.tmpl = plan.T);
  const { modelled } = plan;
  const F = contextFrame();
  S.frameF = F;

  // Placement, one rigid fit per module on that module's five piers: the IFC's own modules
  // in place, every other module chosen in Settings as a copy of the template moved 4 piers
  // per module. Per module, not per model: Revit draws the bridge straight and the river
  // crossing curves, so one fit over two modules (1.2 km) leaves the ends 44 m off the
  // alignment, where a 600 m module stays within a few metres.
  const piersOf = (m) => T.piers.filter((p) => p.n >= 6 + (m - 1) * 4 && p.n <= 10 + (m - 1) * 4);
  const tPiers = piersOf(T.m0);
  const fitTo = (piers, delta) => rigidFit(piers.map((p) => [p.x, p.z]), piers.map((p) => F.at(pierChainage(p.n + delta))));
  const ifcMatrix = F && T.piers.length >= 2 ? fitTo(T.piers, 0) : new THREE.Matrix4();
  const places = plan.places.map((P) => {
    let matrix = ifcMatrix;
    if (P.real && F && piersOf(P.m).length >= 2) matrix = fitTo(piersOf(P.m), 0);
    else if (!P.real && F && tPiers.length >= 2) matrix = fitTo(tPiers, P.delta);
    else if (!P.real && T.piers.length >= 2) {
      const a = T.piers[0], b = T.piers[T.piers.length - 1];
      const L = Math.hypot(b.x - a.x, b.z - a.z) || 1;
      const off = (P.m - T.m0) * MODULE_LEN;
      matrix = new THREE.Matrix4().makeTranslation(((b.x - a.x) / L) * off, 0, ((b.z - a.z) / L) * off);
    }
    return { ...P, matrix };
  });
  S.place = { modules: places, template: T.m0, modelled };
  const matrixOf = new Map(places.map((p) => [p.m, p.matrix]));
  for (const it of plan.items) it.matrix = it.wholeFit ? ifcMatrix : matrixOf.get(it.placeM);
  const items = plan.items;
  S.items = items; S.itemById = new Map(items.map((it) => [it.id, it]));
  S.link = plan.link;
  const keyToEls = S.link.keyToEls;
  S.modelPiers = new Set(modelKeys().map((k) => decodeKey(k).pier).filter(Boolean));
  S.selIds = new Set((S.selKey && keyToEls.get(S.selKey) || []).map((e) => e.id));
  if (!keepItems) viewer.setItems(items);

  // levels: the model's well-cap top is the datum that ties model heights to drawing RLs
  const lv = levels();
  const capY = T.capTop;
  S.datum = capY === null ? null : { capY, rl: (y) => y - capY + lv.wellCapTop, y: (rl) => capY + (rl - lv.wellCapTop) };

  // map context
  if (F && S.datum) {
    const Y = S.datum.y, landY = Y(lv.bankGround), deckY = Y(lv.deckTop);
    const c6 = pierChainage(6), c30 = pierChainage(30);
    const south = [], north = [], deck = [];
    const A = F.ctx.align;
    for (let i = 0; i < F.ch.length; i++) {
      const [x, z] = F.toS(A[2 * i], A[2 * i + 1]);
      if (F.ch[i] < c6) south.push([x, landY + 0.3, z]);
      else if (F.ch[i] > c30) north.push([x, landY + 0.3, z]);
      else deck.push([x, deckY, z]);
    }
    const e6 = F.at(c6), e30 = F.at(c30);
    deck.unshift([e6[0], deckY, e6[1]]); deck.push([e30[0], deckY, e30[1]]);
    // context lines at bank level, except inside the river stretch (those are the bridge corridor's own hatching)
    const river = rectAlong(F, c6 - 100, c30 + 100, 1400);
    const inside = (x, z) => {
      let s = 0;
      for (let k = 0; k < 4; k++) { const [ax, az] = river[k], [bx, bz] = river[(k + 1) % 4]; const cr = (bx - ax) * (z - az) - (bz - az) * (x - ax); if (cr !== 0) { if (s && Math.sign(cr) !== s) return false; s = Math.sign(cr); } }
      return true;
    };
    const L = F.ctx.lines, hs = [];
    for (let i = 0; i < L.length; i += 4) {
      const [x1, z1] = F.toS(L[i], L[i + 1]), [x2, z2] = F.toS(L[i + 2], L[i + 3]);
      if (inside((x1 + x2) / 2, (z1 + z2) / 2)) continue;
      hs.push(x1, landY + 0.2, z1, x2, landY + 0.2, z2);
    }
    const hatch = new Float32Array(hs);
    const piers = [];
    for (let n = 6; n <= 30; n++) {
      const [x, z] = F.at(pierChainage(n));
      piers.push({ x, z, yTop: deckY, yBot: S.datum.capY, label: `P${n}`, major: roleIndex(n) === 0, modelled: places.some((p) => n >= p.n0 && n <= p.n0 + 4) });
    }
    const land = [];
    if (c6 - 150 > 0) land.push({ corners: rectAlong(F, 0, c6 - 150, 1400), y: landY });
    if (c30 + 150 < F.length) land.push({ corners: rectAlong(F, c30 + 150, F.length, 1400), y: landY });
    const lab = (c, off, text, kind, y) => { const a = F.at(Math.max(0, Math.min(F.length, c))), b = F.at(Math.max(0, Math.min(F.length, c + 10))); const Ld = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1; return { text, kind, x: a[0] - ((b[1] - a[1]) / Ld) * off, y, z: a[1] + ((b[0] - a[0]) / Ld) * off }; };
    const labels = [
      lab(c6 - 1200, 0, 'Palashbari · south bank', 'bank', landY + 20),
      lab(c30 + 1200, 0, 'Sualkuchi · north bank', 'bank', landY + 20),
      lab((c6 + c30) / 2, 650, 'Brahmaputra', 'river', S.datum.capY + 4),
    ];
    // north arrow on the south bank
    const base = F.at(Math.max(0, c6 - 700)), ax = base[0] + 420, az = base[1], len = 260, ay = landY + 1;
    const extraLines = [ax, ay, az, ax, ay, az - len, ax, ay, az - len, ax - 40, ay, az - len + 70, ax, ay, az - len, ax + 40, ay, az - len + 70];
    labels.push({ text: 'N', kind: 'bank', x: ax, y: ay + 8, z: az - len - 40 });
    viewer.setContext({ land, lines: hatch, alignParts: [south, north], deck, extraLines, piers, labels });
  } else viewer.setContext(null);

  // water plane
  const wl = S.prefs.waterLevel || 'cap';
  if (wl !== 'off' && S.datum) {
    const rl = wl === 'hfl' ? lv.hfl : lv.wellCapTop;
    const y = S.datum.y(rl);
    let corners;
    if (F) corners = rectAlong(F, pierChainage(6) - 250, pierChainage(30) + 250, 1400);
    else { const b = viewer.bounds; corners = [[b.min.x - 120, b.min.z - 60], [b.max.x + 120, b.min.z - 60], [b.max.x + 120, b.max.z + 60], [b.min.x - 120, b.max.z + 60]]; }
    const t = places.find((p) => p.m === T.m0) || places[0];
    const p0 = T.piers[0] ? new THREE.Vector3(T.piers[0].x + 45, 0, T.piers[0].z).applyMatrix4(t.matrix) : new THREE.Vector3();
    viewer.setWater({ y, corners, opacity: 0.3, label: `${wl === 'hfl' ? 'High flood level' : 'Water at well cap top'} · RL +${rl.toFixed(3)}`, labelAt: [p0.x, p0.z] });
  } else viewer.setWater(null);
}
async function loadIpc(meta) {
  if (S.ipcCache.has(meta.asset)) return S.ipcCache.get(meta.asset);
  const buf = await S.store.getContent(meta);
  const p = await parseIPC(buf, { fileName: meta.name, onProgress: (f, l) => progress(`${meta.bill || meta.name}: ${l}`, f) });
  S.ipcCache.set(meta.asset, p);
  return p;
}
async function ensurePrev() {
  const list = [...S.state.ipcs].sort((a, b) => a.at - b.at);
  const i = list.findIndex((x) => x.asset === S.viewIpc);
  if (i > 0) { try { await loadIpc(list[i - 1]); } catch { /* comparison is optional */ } }
}
async function activateIpc(asset) {
  const meta = S.state.ipcs.find((x) => x.asset === asset);
  if (!meta) return;
  try {
    S.ipc = await loadIpc(meta); S.viewIpc = asset; await ensurePrev();
    recompute(); computeScales(); renderAll(); progress(null);
  } catch (err) { progress(null); toast(err.message); }
}
async function loadFromState(st) {
  S.state = st;
  const ids = [st.ifc?.by, st.register?.by, ...st.ipcs.map((x) => x.by)];
  S.store.names(ids).then((n) => { S.names = { ...S.names, ...n }; renderTop(); });
  let rebuild = false;
  if (st.ifc && st.ifc.asset !== S.modelAsset) {
    const text = await S.store.getContent(st.ifc);
    if (S.dead) return;
    S.model = await parseIFC(text, { fileName: st.ifc.name, onProgress: (f, l) => progress(`${st.ifc.name}: ${l}`, f) });
    S.modelAsset = st.ifc.asset; rebuild = true;
  }
  if (st.register && st.register.asset !== S.registerAsset) {
    progress('Reading ' + st.register.name, 0.5);
    const regBuf = await S.store.getContent(st.register);
    if (S.dead) return;
    S.register = parseRegister(regBuf, st.register.name);
    S.registerAsset = st.register.asset; rebuild = true;
  }
  if (st.context && st.context.asset !== S.contextAsset) {
    progress('Reading ' + st.context.name, 0.6);
    try { S.context = await S.store.getContent(st.context); S.contextAsset = st.context.asset; rebuild = true; } catch (err) { toast(err.message); }
  }
  const latest = [...st.ipcs].sort((a, b) => b.at - a.at)[0];
  const want = st.ipcs.find((x) => x.asset === st.activeIpc) || latest;
  if (want && want.asset !== S.viewIpc) { S.ipc = await loadIpc(want); S.viewIpc = want.asset; await ensurePrev(); }
  if (S.dead) return;
  buildScene({ keepItems: !rebuild && S.items.length > 0 }); recompute(); computeScales(); renderAll(); progress(null);
}

function renderEmpty() {
  const e = $('#empty');
  if (S.model) { e.hidden = true; return; }
  const can = S.store?.canWrite;
  e.innerHTML = `<h2>${can ? 'Upload the bridge model to start' : 'No model has been uploaded yet'}</h2><p>${can ? 'Add the IFC model, the mapping register and the latest IPC workbook. The 3D view then shows which elements have RFIs, which don\'t yet, and which should have one by now.' : 'Ask the tracker\'s owner to upload the IFC model and the monthly IPC workbook.'}</p>${can ? `<button class="btn primary" id="emptyUp">${svg('upload', 15)} Upload files</button>` : ''}`;
  e.hidden = false;
  $('#emptyUp')?.addEventListener('click', openUpload);
}

function renderAll() {
  if (S.dead) return;
  updateMarkers();
  renderTop(); renderLegend(); renderToolbar(); renderEmpty();
  if (S.leftOpen) renderTree();
  if (S.right) renderRight();
  if (S.t4d.on) renderTimeline();
  applyLooks();
}

async function boot() {
  renderToolbar(); renderLegend();
  progress('Connecting to tracker storage', 0.1);
  try { S.store = await store.init(); } catch (err) { progress(null); toast(err.message, 8000); return; }
  const cfg = await S.store.loadConfig();
  if (cfg) S.config = mergeConfig(cfg);
  const st = await S.store.loadState();
  if (S.dead) return;
  progress(null);
  renderToolbar();
  try { await loadFromState(st); } catch (err) { progress(null); console.error(err); toast(err.message, 8000); renderAll(); }
  disposers.push(S.store.watchState(async (fresh) => {
    const changed = fresh.ifc?.asset !== S.state.ifc?.asset || fresh.register?.asset !== S.state.register?.asset || fresh.context?.asset !== S.state.context?.asset || fresh.ipcs.length !== S.state.ipcs.length;
    if (!changed || S.busy) return;
    const latest = [...fresh.ipcs].sort((a, b) => b.at - a.at)[0];
    toast(`A new upload arrived${latest?.bill ? ` (${latest.bill})` : ''}. Updating the view.`);
    S.viewIpc = null;
    try { await loadFromState(fresh); } catch (err) { toast(err.message); }
  }));
}
boot();
window.__rfi = S; // for inspection from the browser console
window.__viewer = viewer;

return function unmount() {
  S.dead = true;
  for (const dispose of disposers.splice(0)) { try { dispose(); } catch { /* already gone */ } }
  clearTimeout(toastT); clearTimeout(legT); clearInterval(S.t4d.playing);
  viewer.dispose();
  if (window.__rfi === S) { delete window.__rfi; delete window.__viewer; }
  root.innerHTML = '';
};
}
