// Section 12 acceptance tests, run against whichever IPC is loaded (written for IPC-34).
import { masterSegments } from './keys.js';

const near = (a, b, tol = 0.005) => Math.abs(a - b) <= tol;

export function acceptanceTests(ipc, ev) {
  const T = [];
  const t = (group, name, expected, actual, pass) => T.push({ group, name, expected, actual, pass: !!pass });
  if (!ipc) return T;
  const E = ipc.elements;
  const els = [...E.values()];
  const issues = ev.issues;
  const has = (pred) => issues.some(pred);

  t('Counts', 'Data rows parsed in Schedule 4', '1,152', ipc.rows.length.toLocaleString('en-IN'), ipc.rows.length === 1152);
  const wells = els.filter((e) => e.type === 'WELL' && e.hasRfi && !e.reversed);
  const steining = wells.reduce((s, e) => s + e.net, 0);
  t('Counts', 'Well lifts Cast & sunk', '505', String(wells.length), wells.length === 505);
  t('Counts', 'Net well steining', '1,289.47 m', steining.toFixed(2) + ' m', near(steining, 1289.47, 0.01));
  const rev = els.filter((e) => e.type === 'WELL' && e.reversed);
  t('Counts', 'Reversed well-lift keys (P12, P14)', '16', `${rev.length} (${[...new Set(rev.map((e) => e.unit))].join(', ') || 'none'})`, rev.length === 16 && rev.every((e) => e.unit === 'P12' || e.unit === 'P14'));
  const l20 = E.get('P9-WELL-L20');
  t('Counts', 'P9-WELL-L20 correction', '1.75 m', l20 ? l20.net.toFixed(3) + ' m' : 'missing', l20 && near(l20.net, 1.75));
  const segs = els.filter((e) => e.type === 'SEG' && e.hasRfi);
  const cable = segs.filter((e) => e.cableMark || e.cable);
  const master = masterSegments();
  t('Counts', 'Segments cast in yard', '496', String(segs.length), segs.length === 496);
  t('Counts', 'of which © anchor segments', '189', String(cable.length), cable.length === 189);
  const outside = segs.filter((e) => !master.has(e.key));
  t('Counts', 'Segment IDs inside the 1,116 master list', 'all', outside.length ? `${outside.length} outside: ${outside.slice(0, 4).map((e) => e.key).join(', ')}` : 'all', outside.length === 0);
  const plugs = els.filter((e) => e.type === 'PLUG' && e.hasRfi).length, caps = els.filter((e) => e.type === 'CAP' && e.hasRfi).length;
  t('Counts', 'Bottom plugs / well caps', '10 / 9', `${plugs} / ${caps}`, plugs === 10 && caps === 9);
  const lp = ipc.rows.filter((r) => r.codes.includes('403.a'));
  const lpSum = lp.reduce((s, r) => s + r.qty, 0);
  const p25 = lp.find((r) => r.key === 'P25-LPYL-L02');
  t('Counts', 'Lower-pylon rows and total', '31 rows, 72.284 m', `${lp.length} rows, ${lpSum.toFixed(3)} m`, lp.length === 31 && near(lpSum, 72.284));
  t('Counts', 'P25 lower pylon 2nd lift', '−3.140 m', p25 ? p25.qty.toFixed(3) + ' m' : 'missing', p25 && near(p25.qty, -3.14));

  for (const k of ['P25-BP-S04a-O', 'P15-BP-S09-O']) t('RFI not raised', k, 'red', ev.notRaised.has(k) ? 'red' : 'not flagged', ev.notRaised.has(k));

  const rowOf = (key) => ipc.rows.find((r) => r.key === key);
  t('Issues', 'P25 lower pylon 2nd lift: negative with RFIs', 'High', has((i) => i.code === 'H1' && i.keys.includes('P25-LPYL-L02')) ? 'found' : 'not found', has((i) => i.code === 'H1' && i.keys.includes('P25-LPYL-L02')));
  t('Issues', 'P25 2nd-lift formula points at other rows', 'Medium', has((i) => i.code === 'M1' && i.keys.includes('P25-LPYL-L02')) ? 'found' : 'not found', has((i) => i.code === 'M1' && i.keys.includes('P25-LPYL-L02')));
  t('Issues', 'P19 lower pylon 1st lift outside the SUM range', 'High', has((i) => i.code === 'H2' && i.keys.includes('P19-LPYL-L01')) ? 'found' : 'not found', has((i) => i.code === 'H2' && i.keys.includes('P19-LPYL-L01')));
  t('Issues', 'P12(A)-WELL-L12 and P13-WELL-L12 share a chain', 'High', has((i) => i.code === 'H3' && i.keys.includes('P12(A)-WELL-L12') && i.keys.includes('P13-WELL-L12')) ? 'found' : 'not found', has((i) => i.code === 'H3' && i.keys.includes('P12(A)-WELL-L12') && i.keys.includes('P13-WELL-L12')));
  t('Issues', 'Plain P12 cutting edge after write-off', 'High', has((i) => i.code === 'H4' && i.keys.includes('P12-WELL-CE')) ? 'found' : 'not found', has((i) => i.code === 'H4' && i.keys.includes('P12-WELL-CE')));
  const m2 = (id) => has((i) => i.code === 'M2' && i.title.startsWith(id));
  t('Issues', 'Sur/295 on P6 L03 and P24 L03', 'Medium', m2('Sur/295') ? 'found' : 'not found', m2('Sur/295'));
  t('Issues', 'MB/943 on P8-KS-S18-M and P9-KS-S01-O', 'Medium', m2('MB/943') ? 'found' : 'not found', m2('MB/943'));
  t('Issues', 'Sur/3062 on P25-BP-S32a-O and P9-BP-S18a-O', 'Medium', m2('Sur/3062') ? 'found' : 'not found', m2('Sur/3062'));
  const fut = ['MB/602', 'MB/603'].filter((id) => has((i) => i.code === 'M3' && i.title.startsWith(id)));
  t('Issues', 'MB/602 and MB/603 dated in the future', 'Medium', fut.length ? fut.join(', ') : 'not found', fut.length === 2);
  const seq = ['Sur/228', 'Sur/1842'].filter((id) => has((i) => i.code === 'M4' && i.title.startsWith(id + ' ')));
  t('Issues', 'Sur/228 and Sur/1842 break the sequence', 'Medium', seq.length ? seq.join(', ') : 'not found', seq.length === 2);
  t('Issues', 'P8-KS-S16-M© has no 408.c', 'Medium', has((i) => i.code === 'M6' && i.keys.includes('P8-KS-S16-M')) ? 'found' : 'not found', has((i) => i.code === 'M6' && i.keys.includes('P8-KS-S16-M')));
  const p22 = issues.find((i) => i.code === 'M7' && i.title.startsWith('P22 '));
  t('Issues', 'P22 well deeper than the 50.55 m design', 'Medium', p22 ? p22.detail.match(/totals ([\d.]+) m/)?.[1] + ' m' : 'not found', !!p22);
  const m1 = issues.filter((i) => i.code === 'M1').length;
  t('Issues', 'Formulas pointing at other elements\' rows', 'at least 2', String(m1), m1 >= 2);
  void rowOf;
  return T;
}
