// What the tracker draws and how each drawn element is keyed — without drawing anything.
//
// Split out of app.js's buildScene so the RoadBIM dashboard can count exactly what the
// tracker's legend counts: the same model, register and settings give the same keys here
// whether a viewer is open or not. buildScene adds only what needs a screen — where each
// module sits on the alignment (the matrices) — on top of this.
import { decodeKey, moduleOfPier, moduleOfSegment, roleIndex } from './keys.js';
import { DEFAULT_CONFIG } from './engine.js';
import { automap, linkWithGeometry, modelledModules } from './automap.js';
import { pad2 } from './util.js';

/** Stored settings over the defaults, as the tracker has always merged them on start. */
export function mergeConfig(cfg) {
  const D = structuredClone(DEFAULT_CONFIG);
  if (!cfg) return D;
  const byId = new Map((cfg.rules || []).map((r) => [r.id, r]));
  return {
    ...D, ...cfg,
    rules: D.rules.map((r) => ({ ...r, ...(byId.has(r.id) ? { enabled: byId.get(r.id).enabled, params: byId.get(r.id).params ?? r.params } : {}) })),
    checks: { ...D.checks, ...(cfg.checks || {}) },
    levels: { ...D.levels, ...(cfg.levels || {}) },
    map: { ...D.map, ...(cfg.map || {}) },
    model: { ...D.model, ...(cfg.model || {}) },
  };
}

/** A key moved `delta` piers along the bridge (4 per module), or null past either end. */
export function renumberKey(k0, delta, alias = {}) {
  if (!delta) return k0;
  const d = decodeKey(k0);
  if (!d.pier) return null;
  const n = d.pier + delta;
  if (n < 6 || n > 30) return null;
  if (d.type === 'SEG') return `P${n}-${d.arm}-S${pad2(d.seg)}${d.a ? 'a' : ''}-${d.fam}`;
  return (alias[`P${n}`] || `P${n}`) + k0.slice(d.unit.length);
}

/** The modelled piers (plan position and cap level), and the module copies are made of. */
export function templateInfo(tLink, model) {
  const acc = new Map();
  for (const [key, els] of tLink.keyToEls) {
    const d = decodeKey(key);
    if (!d.pier || !['WELL', 'CAP', 'CE', 'PLUG'].includes(d.type)) continue;
    for (const e of els) {
      const b = e.geometry?.boundingBox; if (!b) continue;
      const a = acc.get(d.pier) || { x: 0, z: 0, n: 0, top: -Infinity };
      a.x += (b.min.x + b.max.x) / 2; a.z += (b.min.z + b.max.z) / 2; a.n++;
      if (d.type === 'CAP') a.top = Math.max(a.top, b.max.y);
      acc.set(d.pier, a);
    }
  }
  const piers = [...acc].map(([n, a]) => ({ n, x: a.x / a.n, z: a.z / a.n, capTop: a.top })).sort((p, q) => p.n - q.n);
  const mid = piers.find((p) => roleIndex(p.n) === 2) || piers.find((p) => roleIndex(p.n) !== 0) || piers[0];
  let m0 = mid ? moduleOfPier(mid.n) : 1;
  // An IFC may hold several whole modules. Copies are made of one of them: the one the
  // register vouches for most, since its keys were checked by hand rather than inferred.
  const modelled = modelledModules(piers.map((p) => p.n));
  if (modelled.length) {
    const vouched = (m) => {
      const lo = 6 + (m - 1) * 4; let n = 0;
      for (const [id, via] of tLink.how || []) if (via === 'register') { const p = decodeKey(tLink.elToKey.get(id)).pier; if (p >= lo && p <= lo + 4) n++; }
      return n;
    };
    m0 = modelled.reduce((a, b) => (vouched(b) > vouched(a) ? b : a));
  }
  let caps = piers.map((p) => p.capTop).filter(Number.isFinite);
  if (!caps.length) caps = model.elements.filter((e) => /well\s*cap/i.test(e.name) && e.geometry).map((e) => e.geometry.boundingBox.max.y);
  const capTop = caps.length ? caps.reduce((a, b) => a + b) / caps.length : null;
  return { piers, m0, n0: 6 + (m0 - 1) * 4, capTop, modelled };
}

/**
 * Everything buildScene decides before it places anything: the keys, which modules are
 * drawn, which element goes into which module, and the link the engine evaluates.
 *
 * Each item says where it is to be placed — `placeM` (its module's fit) or `wholeFit`
 * (the fit over the whole IFC) — and buildScene turns that into a matrix.
 */
export function planScene({ model, register, config }) {
  const alias = config.model?.unitAlias || {};
  // Keys: the register's, relabelled to the pier numbering in Settings; then the IFC
  // property; then the geometry (automap.js) for whatever is still unkeyed.
  const map = automap(model, { register, numbering: config.model?.numbering || null, alias });
  const tLink = linkWithGeometry(model, register, config.link || {}, map);
  const T = templateInfo(tLink, model);
  const modelled = T.modelled.length ? T.modelled : [T.m0];
  const want = (config.model?.showModules || modelled).map(Number).filter((m) => m >= 1 && m <= 6);
  const modules = [...new Set([...modelled, ...want])].sort((a, b) => a - b);
  const places = modules.map((m) => {
    const real = modelled.includes(m);
    return { m, real, delta: real ? 0 : (m - T.m0) * 4, n0: 6 + (m - 1) * 4 };
  });

  // which pier each element belongs to
  const pierOf = new Map();
  for (const el of model.elements) {
    const k0 = tLink.elToKey.get(el.id);
    const d0 = k0 ? decodeKey(k0) : null;
    if (d0?.type === 'SEG') { pierOf.set(el.id, { pier: d0.pier, seg: true, arm: d0.arm }); continue; }
    let pn = d0?.pier ?? null;
    if (!pn && el.geometry && map?.ok) {
      // along the bridge, to the nearest well cap: cables and pylon pieces sit far from the
      // pier's centre in plan but still belong to it
      const b = el.geometry.boundingBox, u = (b.min[map.axis] + b.max[map.axis]) / 2;
      pn = map.piers.reduce((p, q) => (Math.abs(q.u - u) < Math.abs(p.u - u) ? q : p)).n;
    }
    if (!pn && el.geometry) {
      const b = el.geometry.boundingBox, cx = (b.min.x + b.max.x) / 2, cz = (b.min.z + b.max.z) / 2;
      let bd = 60;
      for (const p of T.piers) { const dd = Math.hypot(p.x - cx, p.z - cz); if (dd < bd) { bd = dd; pn = p.n; } }
    }
    pierOf.set(el.id, { pier: pn, seg: false });
  }
  const ground = (el) => /toposolid|ground level/i.test(el.name || '');
  const inTemplate = (el) => {
    const po = pierOf.get(el.id);
    if (!po || po.pier == null || ground(el)) return false;
    if (po.seg) return moduleOfSegment(po.pier, po.arm) === T.m0;
    return po.pier >= T.n0 && po.pier <= T.n0 + 4;
  };

  const items = [];
  const add = (P, el, placing) => {
    const po = pierOf.get(el.id);
    const module = P.real ? (po?.seg ? moduleOfSegment(po.pier, po.arm) : po?.pier ? moduleOfPier(po.pier) : P.m) : P.m;
    items.push({ id: `${P.m}:${el.id}`, base: el, module, copy: P.delta !== 0, delta: P.delta, gid: el.gid, cls: el.cls, name: el.name, tag: el.tag, geometry: el.geometry, ...placing });
  };
  // Each IFC element goes with its own module's fit. A shared EJ pier goes with the first
  // modelled module that has it; ground and anything placed by no pier, with the whole-model fit.
  const realM = new Set(places.filter((p) => p.real).map((p) => p.m));
  const moduleFor = (po) => {
    if (!po || po.pier == null) return null;
    if (po.seg) return moduleOfSegment(po.pier, po.arm);
    for (let m = 1; m <= 6; m++) { const lo = 6 + (m - 1) * 4; if (po.pier >= lo && po.pier <= lo + 4 && realM.has(m)) return m; }
    return moduleOfPier(po.pier);
  };
  const ifcPlace = places.find((p) => p.real);
  if (ifcPlace) for (const el of model.elements) {
    const m = ground(el) ? null : moduleFor(pierOf.get(el.id));
    add(ifcPlace, el, realM.has(m) ? { placeM: m } : { placeM: ifcPlace.m, wholeFit: true });
  }
  // An EJ pier is shared by the modules either side of it, so its substructure is drawn
  // once: by the IFC if the IFC has it, else by the first copy to reach it.
  const drawn = new Set(T.piers.map((p) => p.n));
  for (const P of places.filter((p) => !p.real)) {
    for (const el of model.elements) {
      if (!inTemplate(el)) continue;
      const po = pierOf.get(el.id);
      if (!po.seg && drawn.has(po.pier + P.delta)) continue;
      add(P, el, { placeM: P.m });
    }
    for (let k = 0; k <= 4; k++) drawn.add(P.n0 + k);
  }

  // link: every drawn item's key, copies renumbered to their module
  const keyToEls = new Map(), elToKey = new Map();
  for (const it of items) {
    const k0 = tLink.elToKey.get(it.base.id); if (!k0) continue;
    const k = renumberKey(k0, it.delta, alias); if (!k) continue;
    elToKey.set(it.id, k);
    if (!keyToEls.has(k)) keyToEls.set(k, []);
    keyToEls.get(k).push(it);
  }
  const link = {
    keyToEls, elToKey, template: tLink,
    coverage: {
      keysNoModel: register ? [...register.byKey.keys()].filter((k) => !keyToEls.has(k)) : [],
      modelNoKey: items.filter((it) => !elToKey.has(it.id)),
      gidsNotFound: tLink.coverage?.gidsNotFound || [], conflicts: tLink.coverage?.conflicts || [],
      disagree: tLink.coverage?.disagree || [],
    },
  };
  return { map, tLink, T, modelled, modules, places, items, link };
}
