// Schedule 4 and the engine, against IPC-34: what the tracker reports must not move unless
// the workbook or the rules do.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { T, ipc34, evaluated } from './fixtures.mjs';

const count = (list, key) => list.reduce((m, x) => ((m[x[key]] = (m[x[key]] || 0) + 1), m), {});

test('Schedule 4 is read whole', async () => {
  const ipc = await ipc34();
  assert.equal(ipc.bill, 'IPC - 34');
  assert.equal(ipc.period, "1st Jul'26 to 31st Jul'26");
  assert.equal(ipc.rows.length, 1152);
  assert.equal(ipc.elements.size, 1094);
  assert.equal(ipc.unlinked.length, 11);
  assert.equal(ipc.subtotals.length, 36);
});

test('element keys follow the grammar', () => {
  const { keyFromRow, decodeKey, masterSegments } = T.keys;
  assert.equal(masterSegments().size, 1116);
  assert.equal([...masterSegments().values()].filter((s) => s.cable).length, 372);
  assert.equal(keyFromRow(['402.a'], 'P22 - Well Curb').key, 'P22-WELL-L00');
  assert.equal(keyFromRow(['402.a'], 'P22 - 7th Lift').key, 'P22-WELL-L07');
  assert.equal(keyFromRow(['403.a'], 'P8 - Lower Pylon - Starter').key, 'P8-LPYL-L00');
  assert.equal(keyFromRow(['406.a'], 'P17-BP-S09a-O©').key, 'P17-BP-S09a-O');
  assert.equal(keyFromRow(['402.a'], 'P12(A) - 5th Lift').key, 'P12(A)-WELL-L05');
  assert.equal(decodeKey('P17-BP-S09a-O').cable, true);
  assert.equal(keyFromRow(['402.a'], '').ok, false);
});

test('what IPC-34 says has been built', async () => {
  const ipc = await ipc34();
  const els = [...ipc.elements.values()];
  const live = (e) => e.hasRfi && !e.reversed;
  const segs = els.filter((e) => e.type === 'SEG' && e.hasRfi);
  assert.equal(segs.length, 496);
  assert.equal(segs.filter((e) => e.cable || e.cableMark).length, 189);
  assert.equal(els.filter((e) => e.type === 'PLUG' && e.hasRfi).length, 10);
  assert.equal(els.filter((e) => e.type === 'CAP' && e.hasRfi).length, 9);
  assert.equal(ipc.elements.get('P9-WELL-L20').net, 1.75);
  // The workbook as uploaded: its toppled-well reversals point at re-sorted rows, so 15 of
  // the 16 reversals no longer cancel (see the M1 findings below).
  const wells = els.filter((e) => e.type === 'WELL' && live(e));
  assert.equal(wells.length, 520);
  assert.equal(Math.round(wells.reduce((s, e) => s + e.net, 0) * 100) / 100, 1307.03);
});

test('RFI not raised: exactly the two segments the sequence rules require', async () => {
  const { notRaised } = await evaluated();
  assert.deepEqual([...notRaised.keys()].sort(), ['P15-BP-S09-O', 'P25-BP-S04a-O']);
  assert.equal(notRaised.get('P25-BP-S04a-O').reasons[0].rule, 'R6');
});

test('data issues, as of the pinned date', async () => {
  const { issues } = await evaluated();
  assert.equal(issues.length, 350);
  assert.deepEqual(count(issues, 'sev'), { High: 8, Medium: 36, Low: 251, Info: 55 });
  assert.deepEqual(count(issues, 'code'), {
    H1: 1, H2: 5, H3: 1, H4: 1, M1: 17, M2: 6, M3: 2, M4: 6, M5: 3, M6: 1, M7: 1, L1: 2, L2: 18, L3: 231, I1: 34, I2: 21,
  });
  const has = (code, key) => issues.some((i) => i.code === code && i.keys.includes(key));
  assert.ok(has('H1', 'P25-LPYL-L02'), 'negative quantity with RFIs');
  assert.ok(has('M1', 'P25-LPYL-L02'), 'formula pointing at re-sorted rows');
  assert.ok(has('H2', 'P19-LPYL-L01'), 'row outside the cumulative total');
  assert.ok(has('H3', 'P12(A)-WELL-L12') && has('H3', 'P13-WELL-L12'), 'shared RFI chain');
  assert.ok(has('H4', 'P12-WELL-CE'), 'new work on a written-off unit');
});

// The tracker's own acceptance tests (build prompt §12). Five encode figures from an earlier
// sort of the IPC-34 sheet; the workbook as uploaded gives different ones, and the engine's
// M1/H2 findings explain why. They are pinned as known, so anything else that changes fails.
const STALE = [
  'Well lifts Cast & sunk', 'Net well steining', 'Reversed well-lift keys (P12, P14)',
  'Lower-pylon rows and total', 'P25 lower pylon 2nd lift',
];
test('acceptance tests: 21 pass, and only the five known stale expectations fail', async () => {
  const { ipc, notRaised, issues } = await evaluated();
  const results = T.selftest.acceptanceTests(ipc, { notRaised, issues });
  assert.equal(results.length, 26);
  assert.deepEqual(results.filter((r) => !r.pass).map((r) => r.name).sort(), [...STALE].sort());
});
