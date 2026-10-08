// Element key grammar for the Palashbari–Sualkuchi bridge (build prompt sections 2 and 5).
import { pad2 } from './util.js';

export const UNIT = 'P\\d+(?:\\([A-Z]\\))?';
const SEG_RE = new RegExp(`^(${UNIT})-(KS|BP)-S(\\d{2})(a?)-([EOM])(©?)$`);
const UNIT_TEXT_RE = new RegExp(`^(${UNIT})\\s*(?:-\\s*([\\s\\S]*))?$`);
const LIFT_RE = /^(\d+)\s*(?:st|nd|rd|th)\s+lift$/i;

export const ROLE_NAMES = ['EJ pier', 'Outer pylon', 'Middle pylon', 'Outer pylon'];
export const TYPE_NAMES = {
  CE: 'Cutting edge', WELL: 'Well lift', PLUG: 'Bottom plug', CAP: 'Well cap',
  LPYL: 'Lower pylon lift', PT: 'Pier table', UPYL: 'Upper pylon lift', SEG: 'Segment', OTHER: 'Other',
};

export const pierNo = (unit) => parseInt(String(unit).replace(/^P/, ''), 10);
export const roleIndex = (n) => (((n - 6) % 4) + 4) % 4;
export const roleOf = (n) => ROLE_NAMES[roleIndex(n)];
export const famOf = (n) => ['E', 'O', 'M', 'O'][roleIndex(n)];
export const moduleOfPier = (n) => (n <= 6 ? 1 : Math.min(6, Math.ceil((n - 6) / 4)));
export function moduleOfSegment(n, arm) {
  if (roleIndex(n) === 0) return arm === 'KS' ? moduleOfPier(n - 1) : moduleOfPier(n + 1);
  return moduleOfPier(n);
}
export function sideSpanArm(n) {
  const r = roleIndex(n);
  return r === 1 ? 'KS' : r === 3 ? 'BP' : null;
}
export const segCount = (fam) => (fam === 'O' ? 34 : fam === 'M' ? 18 : 6);
export function isCableSeg(fam, s) {
  if (fam === 'O') return s >= 9 && s <= 33 && s % 2 === 1;
  if (fam === 'M') return s >= 8 && s <= 16 && s % 2 === 0;
  return false;
}
export function segKey(n, arm, s, ejDiaphragm = false) {
  const fam = famOf(n);
  if (fam === 'E') return `P${n}-${arm}-S${pad2(s)}${ejDiaphragm ? 'a' : ''}-E`;
  const a = fam === 'O' && sideSpanArm(n) === arm ? 'a' : '';
  return `P${n}-${arm}-S${pad2(s)}${a}-${fam}`;
}
export function armsOf(n) {
  if (n === 6) return ['BP'];
  if (n === 30) return ['KS'];
  return ['KS', 'BP'];
}

// All 1,116 segment IDs, P6–P30.
let master = null;
export function masterSegments() {
  if (master) return master;
  master = new Map();
  for (let n = 6; n <= 30; n++) {
    const fam = famOf(n);
    for (const arm of armsOf(n)) {
      if (fam === 'E') master.set(segKey(n, arm, 1, true), { pier: n, arm, seg: 1, fam, diaphragm: true });
      for (let s = 1; s <= segCount(fam); s++) master.set(segKey(n, arm, s), { pier: n, arm, seg: s, fam, cable: isCableSeg(fam, s) });
    }
  }
  return master;
}

// Decode an Element_Key (from the register or the RFI rows) into its parts.
export function decodeKey(key) {
  const k = String(key || '').trim();
  let m = k.match(SEG_RE);
  if (m) {
    const n = pierNo(m[1]);
    const fam = m[5];
    const seg = +m[3];
    return { key: k.replace('©', ''), type: 'SEG', unit: m[1], pier: n, arm: m[2], seg, a: m[4] === 'a', fam, cable: isCableSeg(fam, seg), module: moduleOfSegment(n, m[2]), role: roleOf(n) };
  }
  m = k.match(new RegExp(`^(${UNIT})-(WELL|LPYL|UPYL|PT)(?:-(CE|PLUG|CAP|REST|L(\\d{2})))?$`));
  if (m) {
    const n = pierNo(m[1]);
    const base = { key: k, unit: m[1], pier: n, module: moduleOfPier(n), role: roleOf(n), fam: famOf(n) };
    const part = m[3];
    if (m[2] === 'WELL') {
      if (part === 'CE') return { ...base, type: 'CE' };
      if (part === 'PLUG') return { ...base, type: 'PLUG' };
      if (part === 'CAP') return { ...base, type: 'CAP' };
      if (m[4] !== undefined) return { ...base, type: 'WELL', lift: +m[4] };
    }
    if (m[2] === 'PT') return { ...base, type: 'PT' };
    if (m[2] === 'LPYL') return { ...base, type: 'LPYL', lift: m[4] !== undefined ? +m[4] : null, rest: part === 'REST' };
    if (m[2] === 'UPYL') return { ...base, type: 'UPYL', lift: m[4] !== undefined ? +m[4] : null, rest: part === 'REST' };
  }
  return { key: k, type: 'OTHER' };
}

function liftFromText(t) {
  if (/^(well\s*curb|starter)$/i.test(t)) return 0;
  const m = t.match(LIFT_RE);
  return m ? +m[1] : null;
}

// Turn one Schedule 4 row (item codes + column J text) into an element key, or a reason it can't be keyed.
export function keyFromRow(codes, text) {
  const t = String(text ?? '').replace(/\r/g, '').trim();
  const first = codes[0] || '';
  const item = first.slice(0, 3);
  const fail = (reason) => ({ ok: false, reason });
  if (!t) return fail('Column J is empty');

  if (/^40[6-9]$/.test(item)) {
    const compact = t.replace(/\s+/g, '');
    const m = compact.match(SEG_RE);
    if (!m) return fail('Not a segment ID');
    const d = decodeKey(compact);
    return { ok: true, ...d, cableMark: m[6] === '©' };
  }

  const um = t.match(UNIT_TEXT_RE);
  if (!um) return fail('No pier label at the start of the text');
  const unit = um[1];
  const rest = (um[2] || '').trim();
  const n = pierNo(unit);
  const base = { unit, pier: n, module: moduleOfPier(n), role: roleOf(n), fam: famOf(n) };

  if (item === '401') {
    if (rest) return fail('Cutting-edge rows must name the pier only');
    return { ok: true, ...base, type: 'CE', key: `${unit}-WELL-CE` };
  }
  if (first === '402.a') {
    const lift = liftFromText(rest);
    if (lift === null) return fail('Lift text not recognised');
    return { ok: true, ...base, type: 'WELL', lift, key: `${unit}-WELL-L${pad2(lift)}` };
  }
  if (first === '402.b') {
    if (!/bottom\s*plug/i.test(rest)) return fail('Expected "Bottom Plugging"');
    return { ok: true, ...base, type: 'PLUG', key: `${unit}-WELL-PLUG` };
  }
  if (first === '402.c') {
    if (!/well\s*cap/i.test(rest)) return fail('Expected "Well Cap"');
    return { ok: true, ...base, type: 'CAP', key: `${unit}-WELL-CAP` };
  }
  if (first === '403.a') {
    const m = rest.match(/^(?:lower\s*pylon|ej\s*pier|pier)\s*-\s*(.+)$/i);
    const lift = m ? liftFromText(m[1].trim()) : null;
    if (lift === null) return fail('Lower-pylon lift text not recognised');
    return { ok: true, ...base, type: 'LPYL', lift, key: `${unit}-LPYL-L${pad2(lift)}` };
  }
  if (first === '404.a') {
    if (!/pier\s*table/i.test(rest)) return fail('Expected "Pier Table"');
    return { ok: true, ...base, type: 'PT', key: `${unit}-PT` };
  }
  if (first === '405.a') {
    const m = rest.match(/^upper\s*pylon\s*-\s*(.+)$/i);
    const lift = m ? liftFromText(m[1].trim()) : null;
    if (lift === null) return fail('Upper-pylon lift text not recognised');
    return { ok: true, ...base, type: 'UPYL', lift, key: `${unit}-UPYL-L${pad2(lift)}` };
  }
  return fail(`Item ${first} is not linked to model elements`);
}

// Lifecycle stages per element type (section 6). [rank, label]
export const STAGES = {
  CE: { '401.a': [1, 'Fabricated'], '401.b': [2, 'Placed'], '401.c': [3, 'Shutter & scaffold'] },
  WELL: { '402.a': [1, 'Cast & sunk'] },
  PLUG: { '402.b': [1, 'Cast'] },
  CAP: { '402.c': [1, 'Cast'] },
  LPYL: { '403.a': [1, 'Cast'] },
  PT: { '404.a': [1, 'Cast'] },
  UPYL: { '405.a': [1, 'Cast'] },
  SEG: {
    '406.a': [10, 'Cast in yard'], '407.c': [10, 'Cast in yard'], '408.c': [10, 'Cast in yard'],
    '406.b': [20, 'Erected'], '407.d': [30, 'Stressed'], '408.d': [32, 'Stay stressed'], '407.e': [40, 'Grouted'],
    '409.a': [50, 'Deck complete'], '409.b': [55, 'Stay final'], '409.c': [60, 'Continuity PT'],
  },
};
export const YARD_CODES = new Set(['406.a', '407.c', '408.c']);
