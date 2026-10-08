// Keys model elements from their geometry, and decides which piers the model shows.
//
// A port of work/map_register.ps1 — the offline script that filled the register's
// IFC_GlobalId column — generalised from one five-pier module to any run of whole modules,
// and run in the browser on every load, so a re-exported model links without anyone
// leaving the tracker. It is deterministic and takes milliseconds; nothing is stored.
//
// What it knows, as the script did:
//   piers   = the well caps, in order along the bridge
//   wells   = "Well lift" / "Double well lift" columns, ranked by bottom level within a
//             pier → L00 (the curb) upwards. Provisional: the model slices every well into
//             uniform lifts, while the RFIs record the lifts as cast (0.35–3.63 m).
//   deck    = the slabs, split into cantilever arms at gaps over 1 m (stitches and pier
//             tables), numbered outward from the pier the arm hangs from.
// Everything else gets a reason instead of a key.
import { segKey, famOf, armsOf, segCount, decodeKey } from './keys.js';
import { pad2 } from './util.js';

const ARM_GAP_M = 1.0;
const FIRST = 6, LAST = 30; // P6 Palashbari … P30 Sualkuchi

const family = (el) => String(el.name || '').split(':')[1]?.trim() || '';
const isCap = (el) => /well\s*cap/i.test(el.name || '');
const isLift = (el) => /^(double\s+)?well\s+lift$/i.test(family(el));
const isSlab = (el) => el.cls === 'IFCSLAB';

function reasonFor(el) {
  const n = String(el.name || '');
  if (/^upper\s*pylon/i.test(n)) return 'Upper pylon: no register key yet (405.a is future work)';
  if (/rectangular-column|^pylon|^ej pylon|^lower pylon/i.test(n)) return 'Lower pylon piece: the model split (3 m / 4 m) does not match the RFI lift heights; re-split in Revit';
  if (/cable/i.test(n)) return 'Stay cable: no BOQ item gives a cable its own status';
  if (/toposolid|ground level/i.test(n)) return 'Ground surface: context, not a billed element';
  if (/girder|generic models/i.test(n)) return 'Context element: not a billed element';
  return 'No matching register element type';
}

/** Every first pier a run of `count` piers can start at, keeping EJ piers at both ends. */
export function pierRunStarts(count) {
  const out = [];
  for (let first = FIRST; first + count - 1 <= LAST; first += 4) out.push(first);
  return out;
}

/**
 * Relabels a key under the model's pier numbering: n → n' (shift, optionally mirrored).
 * Mirroring swaps the arms (KS faces lower numbers, BP higher), and segKey recomputes the
 * side-span "a" — EJ–Outer–Middle–Outer–EJ is symmetric, so families are unchanged.
 */
export function relabelKey(key, mapPier, reversed, alias = {}) {
  const d = decodeKey(key);
  if (!d.pier) return null;
  const n = mapPier(d.pier);
  if (!Number.isFinite(n) || n < FIRST || n > LAST) return null;
  if (d.type === 'SEG') {
    const arm = reversed ? (d.arm === 'KS' ? 'BP' : 'KS') : d.arm;
    if (!armsOf(n).includes(arm)) return null;
    return segKey(n, arm, d.seg, d.fam === 'E' && d.a);
  }
  return (alias[`P${n}`] || `P${n}`) + key.slice(d.unit.length);
}

/**
 * Maps a parsed model. `register` anchors the numbering where it keys well caps; `numbering`
 * ({ first, reversed } or null for automatic) says which piers the model is.
 */
export function automap(model, { register = null, numbering = null, alias = {} } = {}) {
  const els = model.elements.filter((e) => e.geometry?.boundingBox);
  const box = (e) => e.geometry.boundingBox;
  const caps = els.filter(isCap);
  const empty = (why) => ({ ok: false, why, keys: new Map(), reasons: new Map(), piers: [], numbering: null });
  if (caps.length < 2) return empty('The model needs at least two well caps to find its piers.');

  // the bridge runs along whichever horizontal axis the caps spread over
  const spread = (k) => { const v = caps.map((e) => (box(e).min[k] + box(e).max[k]) / 2); return Math.max(...v) - Math.min(...v); };
  const ax = spread('x') >= spread('z') ? 'x' : 'z';
  const u = (e) => (box(e).min[ax] + box(e).max[ax]) / 2;
  caps.sort((a, b) => u(a) - u(b));
  const count = caps.length;

  // ---- numbering as the register has it: anchor on the caps it names
  const anchors = [];
  if (register) caps.forEach((c, i) => {
    for (const k of register.gidToKeys.get(c.gid) || []) { const d = decodeKey(k); if (d.type === 'CAP') anchors.push({ i, n: d.pier }); }
  });
  let step = 1, n0 = FIRST, source = 'default';
  if (anchors.length >= 2) {
    const [a, b] = [anchors[0], anchors[anchors.length - 1]];
    step = Math.sign((b.n - a.n) / (b.i - a.i)) || 1;
    n0 = a.n - step * a.i;
    source = 'register';
  } else if (anchors.length === 1) { n0 = anchors[0].n - anchors[0].i; source = 'register'; }
  const baseOf = (i) => n0 + step * i; // label the register implies for cap i
  const baseLo = Math.min(baseOf(0), baseOf(count - 1)), baseHi = Math.max(baseOf(0), baseOf(count - 1));

  // ---- which piers the model is: chosen, or the nearest whole-module run inside the bridge
  const starts = pierRunStarts(count);
  if (!starts.length) return empty(`The model has ${count} piers, more than the bridge.`);
  let first, reversed, auto = false;
  if (numbering && starts.includes(numbering.first)) { first = numbering.first; reversed = !!numbering.reversed; }
  else {
    auto = true; reversed = false;
    first = starts.reduce((best, s) => (Math.abs(s - baseLo) < Math.abs(best - baseLo) ? s : best), starts[0]);
  }
  // register label → drawn label
  const mapPier = (n) => (reversed ? baseLo + baseHi - n : n) + (first - baseLo);
  const pierOfCap = (i) => mapPier(baseOf(i));
  const piers = caps.map((c, i) => ({ n: pierOfCap(i), u: u(c), capId: c.id }));
  // numbers rise towards +u or -u; BP is the arm on the rising side
  const rising = Math.sign(piers[count - 1].n - piers[0].n) || 1;

  const unit = (n) => alias[`P${n}`] || `P${n}`;
  const keys = new Map(), reasons = new Map();
  const put = (el, key, link) => keys.set(el.id, { key, link });
  const nearest = (x) => piers.reduce((p, q) => (Math.abs(q.u - x) < Math.abs(p.u - x) ? q : p));

  caps.forEach((c, i) => put(c, `${unit(pierOfCap(i))}-WELL-CAP`, 'exact'));

  // wells: rank by bottom level within each pier
  const lifts = new Map();
  for (const e of els.filter(isLift)) { const p = nearest(u(e)).n; if (!lifts.has(p)) lifts.set(p, []); lifts.get(p).push(e); }
  for (const [p, list] of lifts) {
    list.sort((a, b) => box(a).min.y - box(b).min.y);
    list.forEach((e, k) => put(e, `${unit(p)}-WELL-L${pad2(k)}`, 'provisional: slice rank, not as-built lift'));
  }

  // deck: arms split at gaps, numbered outward from the nearest pier
  const lo = (e) => box(e).min[ax], hi = (e) => box(e).max[ax];
  const slabs = els.filter(isSlab).sort((a, b) => lo(a) - lo(b));
  const arms = [];
  for (const s of slabs) {
    const cur = arms[arms.length - 1];
    if (cur && lo(s) - cur.hi <= ARM_GAP_M) { cur.list.push(s); cur.hi = Math.max(cur.hi, hi(s)); }
    else arms.push({ list: [s], lo: lo(s), hi: hi(s) });
  }
  const armLog = [];
  for (const a of arms) {
    const p = piers.reduce((best, q) => (Math.min(Math.abs(q.u - a.lo), Math.abs(q.u - a.hi)) < Math.min(Math.abs(best.u - a.lo), Math.abs(best.u - a.hi)) ? q : best));
    const side = Math.sign((a.lo + a.hi) / 2 - p.u);
    const arm = side === rising ? 'BP' : 'KS';
    const fam = famOf(p.n);
    const ordered = [...a.list].sort((x, y) => Math.abs(u(x) - p.u) - Math.abs(u(y) - p.u));
    armLog.push({ pier: p.n, arm, slabs: ordered.length });
    ordered.forEach((e, k) => {
      const s = k + 1;
      if (!armsOf(p.n).includes(arm)) reasons.set(e.id, `P${p.n} has no ${arm} arm (it is an end pier)`);
      else if (s > segCount(fam)) reasons.set(e.id, `P${p.n}-${arm} has ${segCount(fam)} segments; this is slab ${s}`);
      else put(e, segKey(p.n, arm, s), 'exact');
    });
  }

  for (const e of els) if (!keys.has(e.id) && !reasons.has(e.id)) reasons.set(e.id, reasonFor(e));
  for (const e of model.elements) if (!e.geometry?.boundingBox && !keys.has(e.id)) reasons.set(e.id, 'No geometry');

  const lowN = Math.min(piers[0].n, piers[count - 1].n), highN = Math.max(piers[0].n, piers[count - 1].n);
  return {
    ok: true, keys, reasons, piers, axis: ax, armLog,
    numbering: {
      source, auto, reversed, first, piers: [lowN, highN],
      register: source === 'register' ? [baseLo, baseHi] : null,
      shift: first - baseLo,
      fitsBridge: baseLo >= FIRST && baseHi <= LAST,
      starts, count,
    },
    mapPier, relabel: (key) => relabelKey(key, mapPier, reversed, alias),
  };
}

/**
 * The model's link: every element's key, from the register (relabelled to the chosen
 * numbering), the IFC property, or the geometry — in that order unless `keySource` says
 * otherwise. Same shape linkModel returns, plus why each unkeyed element has no key and
 * where the register and the geometry disagree.
 */
export function linkWithGeometry(model, register, settings, map) {
  const source = settings.keySource || 'both'; // both | register | property | geometry
  const pset = settings.psetName || 'RFI_Tracker', prop = settings.propName || 'RFI_Key';
  const keyToEls = new Map(), elToKey = new Map(), how = new Map();
  const conflicts = [], disagree = [];
  if (!model) return { keyToEls, elToKey, conflicts, coverage: null };
  const useRegister = source === 'both' || source === 'register';
  const useProperty = source === 'both' || source === 'property';
  const useGeometry = (source === 'both' || source === 'geometry') && map?.ok;
  const gidSet = new Set(model.elements.map((e) => e.gid));

  for (const el of model.elements) {
    let key = null, via = null;
    if (useRegister && register) {
      const ks = register.gidToKeys.get(el.gid);
      if (ks) {
        const k0 = [...ks][0];
        key = map?.ok ? map.relabel(k0) : k0; via = 'register';
        if (ks.size > 1) conflicts.push({ gid: el.gid, keys: [...ks] });
      }
    }
    if (!key && useProperty) { const v = model.propValue(el, pset, prop); if (v) { key = String(v).trim(); via = 'property'; } }
    const g = useGeometry ? map.keys.get(el.id) : null;
    if (key && g && g.key !== key) disagree.push({ id: el.id, gid: el.gid, name: el.name, linked: key, geometry: g.key });
    if (!key && g) { key = g.key; via = g.link === 'exact' ? 'geometry' : 'geometry (provisional)'; }
    if (!key) continue;
    elToKey.set(el.id, key); how.set(el.id, via);
    if (!keyToEls.has(key)) keyToEls.set(key, []);
    keyToEls.get(key).push(el);
  }
  const reason = (el) => map?.reasons?.get(el.id) || 'No key in the register, no RFI_Key property, and no geometry match';
  return {
    keyToEls, elToKey, conflicts, how,
    coverage: {
      keysNoModel: register ? [...register.byKey.values()].filter((e) => !keyToEls.has(map?.ok ? map.relabel(e.key) : e.key)).map((e) => e.key) : [],
      modelNoKey: model.elements.filter((e) => !elToKey.has(e.id)).map((e) => Object.assign(e, { noKeyReason: reason(e) })),
      gidsNotFound: register ? [...register.gidToKeys.keys()].filter((g) => !gidSet.has(g)).map((g) => ({ gid: g, keys: [...register.gidToKeys.get(g)] })) : [],
      conflicts, disagree,
    },
  };
}

/** Modules the model holds whole: every pier of the module present. */
export function modelledModules(pierNumbers) {
  const have = new Set(pierNumbers), out = [];
  for (let m = 1; m <= 6; m++) { const n0 = FIRST + (m - 1) * 4; if ([0, 1, 2, 3, 4].every((k) => have.has(n0 + k))) out.push(m); }
  return out;
}

