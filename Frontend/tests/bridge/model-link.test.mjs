// The model link: the geometry mapper against the register, the pier numbering, the module
// copies, and the counts the dashboard shares with the tracker's legend.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { T, ALIAS, register, module6, plb2, evaluated, alignment } from './fixtures.mjs';

const agreement = (model, reg, map) => {
  let same = 0; const diff = [];
  for (const el of model.elements) {
    const ks = reg.gidToKeys.get(el.gid); if (!ks) continue;
    const want = map.relabel([...ks][0]); const got = map.keys.get(el.id)?.key;
    if (want === got) same++; else diff.push(`${[...ks][0]}: geometry says ${got}`);
  }
  return { same, diff };
};

test('the geometry mapper reproduces the register on the module it was made from', async () => {
  const [model, reg] = await Promise.all([module6(), register()]);
  const map = T.automap.automap(model, { register: reg, alias: ALIAS });
  assert.deepEqual(map.numbering.piers, [26, 30]);
  assert.equal(map.numbering.shift, 0);
  assert.equal(map.numbering.fitsBridge, true);
  assert.deepEqual(agreement(model, reg, map), { same: 289, diff: [] });
});

test('Bridge plb 2: two modules, keyed, numbered inside the bridge', async () => {
  const [model, reg] = await Promise.all([plb2(), register()]);
  assert.equal(model.elements.length, 791);
  const map = T.automap.automap(model, { register: reg, alias: ALIAS });
  const nb = map.numbering;
  assert.deepEqual(nb.register, [26, 34], 'the register numbers it past the bridge');
  assert.deepEqual(nb.piers, [22, 30], 'drawn at the nearest whole-module run');
  assert.equal(nb.auto, true);
  assert.equal(nb.fitsBridge, false);
  assert.deepEqual(nb.starts, [6, 10, 14, 18, 22]);
  assert.deepEqual(map.armLog.map((a) => a.slabs), [6, 34, 34, 18, 18, 34, 34, 6, 6, 34, 34, 18, 18, 34, 34, 6]);
  assert.deepEqual(agreement(model, reg, map), { same: 289, diff: [] });

  const link = T.automap.linkWithGeometry(model, reg, {}, map);
  const via = {}; for (const v of link.how.values()) via[v] = (via[v] || 0) + 1;
  assert.deepEqual(via, { register: 289, geometry: 188, 'geometry (provisional)': 80 });
  assert.equal(link.coverage.disagree.length, 0);
  const why = {}; for (const e of link.coverage.modelNoKey) why[e.noKeyReason.split(':')[0]] = (why[e.noKeyReason.split(':')[0]] || 0) + 1;
  assert.deepEqual(why, { 'Lower pylon piece': 94, 'Stay cable': 124, 'Context element': 9, 'Upper pylon': 6, 'Ground surface': 1 });
});

test('numbered the other way: still consistent, ends swapped', async () => {
  const [model, reg] = await Promise.all([plb2(), register()]);
  const fwd = T.automap.automap(model, { register: reg, alias: ALIAS });
  const rev = T.automap.automap(model, { register: reg, alias: ALIAS, numbering: { first: 22, reversed: true } });
  assert.deepEqual(agreement(model, reg, rev), { same: 289, diff: [] });
  assert.equal(fwd.piers[0].n, 30);
  assert.equal(rev.piers[0].n, 22);
  // mirroring twice is the identity, arms and side-span marks included
  for (const k of ['P23-KS-S09a-O', 'P24-BP-S18-M', 'P22-BP-S03-E', 'P27-WELL-L05', 'P30-WELL-CAP']) {
    assert.equal(T.automap.relabelKey(T.automap.relabelKey(k, (n) => 52 - n, true, ALIAS), (n) => 52 - n, true, ALIAS), k);
  }
});

test('all six modules: every pier once, every segment once', async () => {
  const [model, reg] = await Promise.all([plb2(), register()]);
  const config = T.plan.mergeConfig({ model: { showModules: [1, 2, 3, 4, 5, 6] } });
  const plan = T.plan.planScene({ model, register: reg, config });
  assert.deepEqual(plan.modelled, [5, 6]);
  assert.equal(plan.T.m0, 5, 'copies are made of the module the register vouches for');
  assert.deepEqual(plan.places.map((p) => [p.m, p.real, p.delta]), [[1, false, -16], [2, false, -12], [3, false, -8], [4, false, -4], [5, true, 0], [6, true, 0]]);

  const keys = [...plan.link.keyToEls.keys()];
  const caps = keys.filter((k) => k.endsWith('-WELL-CAP'));
  assert.deepEqual(caps.map((k) => k.replace('-WELL-CAP', '')).sort((a, b) => parseInt(a.slice(1), 10) - parseInt(b.slice(1), 10)),
    ['P6', 'P7', 'P8', 'P9', 'P10', 'P11', 'P12(A)', 'P13', 'P14(N)', 'P15', 'P16', 'P17', 'P18', 'P19', 'P20', 'P21', 'P22', 'P23', 'P24', 'P25', 'P26', 'P27', 'P28', 'P29', 'P30']);
  const segs = keys.filter((k) => /-(KS|BP)-S/.test(k));
  assert.equal(segs.length, 1104, '1,116 less the 12 EJ diaphragm segments, which are not modelled');
  const master = T.keys.masterSegments();
  assert.ok(segs.every((k) => master.has(k)), 'every drawn segment is a real segment ID');
  // drawn once: no key is carried by two items (a duplicated EJ pier would put two caps on one key)
  const doubled = [...plan.link.keyToEls].filter(([, its]) => its.length > 1).map(([k]) => k);
  assert.deepEqual(doubled, []);
  assert.equal(plan.items.length, 2311);
});

test('the counts the dashboard and the legend share', async () => {
  const [model, reg] = await Promise.all([plb2(), register()]);
  const config = T.plan.mergeConfig({ model: { showModules: [1, 2, 3, 4, 5, 6] } });
  const plan = T.plan.planScene({ model, register: reg, config });
  const { ipc } = await evaluated();
  const ev = T.engine.evaluate({ ipc, model, link: plan.link, config });
  const s = T.summary.summarise({ state: { ipcs: [] }, ipc, ev, link: plan.link, map: plan.map, place: { modules: plan.places, modelled: plan.modelled }, model });
  assert.equal(s.counts.built, 492);
  assert.equal(s.counts.yard, 491);
  assert.equal(s.counts.notYet, 644);
  assert.equal(s.counts.notRaised, 2);
  assert.equal(s.counts.reversed, 0);
  assert.equal(s.counts.noModel, 110);
  assert.equal(s.counts.noKey, 682);
  assert.equal(s.numbering.assumed, true);
  assert.deepEqual(s.progress.segments, { total: 1116, cast: 496, erected: 0, stressed: 0, grouted: 0, deck: 0 });
  assert.deepEqual(s.progress.wells, { lifts: 520, steiningM: 1307.03, reversedLifts: 1, plugs: 10, caps: 9 });
});

test('the summary signature changes with what changes the figures, and only that', () => {
  const { signatureOf } = T.summary;
  const state = { ifc: { asset: '4' }, register: { asset: '2' }, activeIpc: '3', ipcs: [{ asset: '3', at: 1 }] };
  const a = T.plan.mergeConfig({ model: { showModules: [5, 6] } });
  const b = JSON.parse(JSON.stringify(a)); b.model = { unitAlias: a.model.unitAlias, showModules: [5, 6], numbering: a.model.numbering }; // same, keys reordered
  assert.equal(signatureOf(state, a), signatureOf(state, b));
  assert.notEqual(signatureOf(state, a), signatureOf(state, T.plan.mergeConfig({ model: { showModules: [1, 5, 6] } })));
  assert.notEqual(signatureOf(state, a), signatureOf({ ...state, activeIpc: '9' }, a));
  assert.equal(signatureOf(state, a), signatureOf(state, { ...a, levels: { ...a.levels, hfl: 50 } }), 'levels move the drawing, not the counts');
});

test('stored settings keep the defaults they do not mention', () => {
  const cfg = T.plan.mergeConfig({ rules: [{ id: 'R6', enabled: false }], map: { p6Chainage: 5500 } });
  assert.equal(cfg.rules.length, 9);
  assert.equal(cfg.rules.find((r) => r.id === 'R6').enabled, false);
  assert.ok(cfg.rules.find((r) => r.id === 'R6').params.runs, 'params survive a stored rule without them');
  assert.equal(cfg.map.p6Chainage, 5500);
  assert.deepEqual(cfg.model.unitAlias, ALIAS);
});

test('the alignment reads the same from the KMZ every time', async () => {
  const a = await alignment();
  assert.equal(a.align.length / 2, 1232);
  assert.ok(a.lines.length > 100000);
  const length = T.kml.chainages(a.align).pop();
  assert.ok(Math.abs(length - 12192) < 1, `alignment is ${length} m`);
});
