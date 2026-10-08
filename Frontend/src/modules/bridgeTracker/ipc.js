// Schedule 4 parser (build prompt sections 3c, 4, 5, 6). Needs the SheetJS global XLSX.
import { keyFromRow, STAGES, YARD_CODES } from './keys.js';
import * as XLSX from 'xlsx';
import { parseDateToken, excelSerialToISO, dayNum, tick } from './util.js';

const SUBTOTALS = ['Cumulative paid upto this Bill', 'Paid upto previous Bill', 'To be paid in this Bill'];

function cellText(c) {
  if (!c || c.v === undefined || c.v === null) return '';
  if (c.v instanceof Date) return c.v.toISOString().slice(0, 10);
  return String(c.v);
}

function parseRfi(raw) {
  const t = raw.trim();
  const m = t.match(/^MPSB\s*\/\s*(Str|Sur|MB)\s*\/\s*0*(\d+)\s*$/i);
  if (m) {
    const s = m[1].toLowerCase();
    const series = s === 'str' ? 'Str' : s === 'sur' ? 'Sur' : 'MB';
    return { raw: t, id: `MPSB/${series}/${+m[2]}`, series, num: +m[2] };
  }
  if (/annexure/i.test(t)) return { raw: t, id: t, series: 'Annexure', num: null };
  return { raw: t, id: t.replace(/\s+/g, ' '), series: 'Letter', num: null };
}

function parseDates(c) {
  if (!c || c.v === undefined || c.v === null || c.v === '') return { dates: [], bad: [] };
  if (typeof c.v === 'number') { const d = excelSerialToISO(c.v); return { dates: d ? [d] : [], bad: d ? [] : [String(c.v)] }; }
  if (c.v instanceof Date) return { dates: [c.v.toISOString().slice(0, 10)], bad: [] };
  const toks = String(c.v).split(/\r?\n|,|;|\s{2,}/).map((s) => s.trim()).filter(Boolean);
  const dates = [], bad = [];
  for (const tk of toks) { const d = parseDateToken(tk); if (d) dates.push(d); else bad.push(tk); }
  return { dates, bad };
}

// "=ROUND(SUM(F616:F1176),3)" -> [[616,1176]]
function sumRanges(f) {
  const out = [];
  if (!f) return out;
  const re = /SUM\(\s*\$?F\$?(\d+)\s*:\s*\$?F\$?(\d+)\s*\)/gi;
  let m;
  while ((m = re.exec(f))) out.push([+m[1], +m[2]]);
  return out;
}

export function formulaRowRefs(f) {
  const out = [];
  if (!f) return out;
  const re = /(?:^|[^A-Z$])\$?F\$?(\d+)(?![:\d])/gi;
  let m;
  while ((m = re.exec(f))) out.push(+m[1]);
  return out;
}

export async function parseIPC(buf, { onProgress = () => {}, fileName = '' } = {}) {
  onProgress(0.05, 'Opening workbook');
  await tick();
  const wb = XLSX.read(buf, { type: 'array', cellFormula: true, cellDates: false, cellNF: false, cellStyles: false, sheets: ['Schedule 4'] });
  const ws = wb.Sheets['Schedule 4'];
  if (!ws) throw new Error('This workbook has no sheet named “Schedule 4”. Upload the monthly IPC measurement workbook.');
  const range = XLSX.utils.decode_range(ws['!ref']);
  const at = (r, c) => ws[XLSX.utils.encode_cell({ r, c })];

  let bill = '', period = '', tableStart = 0;
  const rows = [], subtotals = [], unlinked = [], headers = [];
  const total = range.e.r - range.s.r + 1;

  for (let r = range.s.r; r <= range.e.r; r++) {
    if ((r & 255) === 0) { onProgress(0.1 + 0.7 * ((r - range.s.r) / total), 'Reading Schedule 4'); await tick(); }
    const B = cellText(at(r, 1)), C = cellText(at(r, 2));
    const rowNo = r + 1;

    // header cells
    if (!bill && /^\s*Schedule 4 - Main Extradosed Bridge Works/i.test(B)) {
      for (let c = 2; c <= Math.min(range.e.c, 14); c++) {
        const t = cellText(at(r, c));
        const m = t.match(/IPC\s*-\s*\d+/i);
        if (m) { bill = m[0].replace(/\s+/g, ' ').toUpperCase().replace('IPC -', 'IPC -'); break; }
      }
    }
    if (!period) {
      for (let c = 1; c <= Math.min(range.e.c, 14); c++) {
        const t = cellText(at(r, c));
        const m = t.match(/Period of bill\s*:\s*(.+)$/i);
        if (m) { period = m[1].trim(); break; }
      }
    }

    if (!tableStart && /^Item No\.?$/i.test(B.trim())) tableStart = rowNo;
    if (SUBTOTALS.includes(C.trim())) {
      const fc = at(r, 5);
      subtotals.push({ row: rowNo, label: C.trim(), uom: cellText(at(r, 3)), value: fc && typeof fc.v === 'number' ? fc.v : null, formula: fc?.f || '', ranges: sumRanges(fc?.f) });
      continue;
    }

    const codeStr = B.replace(/\s+/g, '');
    if (!/^\d{3}/.test(codeStr)) continue;
    const Fc = at(r, 5), Gc = at(r, 6), Jc = at(r, 9);
    const Fv = cellText(Fc), Gv = cellText(Gc), Jv = cellText(Jc);
    if (!Fv && !Gv && !Jv) { headers.push({ row: rowNo, code: codeStr.split('/')[0] }); continue; } // section / item header

    const codes = codeStr.split('/').filter(Boolean);
    let qty = 0;
    if (Fc && typeof Fc.v === 'number') qty = Fc.v;
    else if (Fv) { const p = parseFloat(Fv.replace(/,/g, '')); qty = Number.isFinite(p) ? p : 0; }

    const rfis = Gv.split(/\r?\n|;/).map((s) => s.trim()).filter(Boolean).map(parseRfi);
    const { dates, bad } = parseDates(at(r, 7));
    rfis.forEach((x, i) => { x.pos = i + 1; x.date = dates.length ? dates[Math.min(i, dates.length - 1)] : null; });
    const closeDate = dates.length ? dates.reduce((a, b) => (a > b ? a : b)) : null;
    const openDate = dates.length ? dates.reduce((a, b) => (a < b ? a : b)) : null;

    const row = {
      row: rowNo, codes, uom: cellText(at(r, 3)), bank: cellText(at(r, 4)), qty, formula: Fc?.f || '',
      rfis, dates, badDates: bad, dateCount: dates.length, rfiCount: rfis.length,
      bill: cellText(at(r, 8)).replace(/\s+/g, ' ').trim(), text: Jv.replace(/\r/g, '').trim(),
      closeDate, openDate, key: null, parsed: null,
    };
    const k = keyFromRow(codes, row.text);
    if (k.ok) { row.key = k.key; row.parsed = k; } else { row.reason = k.reason; unlinked.push(row); }
    rows.push(row);
  }

  onProgress(0.85, 'Working out element status');
  await tick();
  const elements = buildElements(rows);
  onProgress(1, 'Done');
  return { fileName, bill, period, tableStart, rows, subtotals, headers, unlinked, elements, parsedAt: Date.now() };
}

export function buildElements(rows) {
  const elements = new Map();
  for (const row of rows) {
    if (!row.key) continue;
    let el = elements.get(row.key);
    if (!el) {
      const p = row.parsed;
      el = { key: row.key, type: p.type, unit: p.unit, pier: p.pier, lift: p.lift ?? null, arm: p.arm ?? null, seg: p.seg ?? null, a: !!p.a, fam: p.fam, module: p.module, role: p.role, cable: !!p.cable, cableMark: false, rows: [], net: 0, hasRfi: false, reversalRows: [], codes: new Set() };
      elements.set(row.key, el);
    }
    el.rows.push(row);
    el.net += row.qty;
    if (row.parsed?.cableMark) el.cableMark = true;
    row.codes.forEach((c) => el.codes.add(c));
    if (row.rfis.length) el.hasRfi = true;
    if (row.qty < 0 && !row.rfis.length) el.reversalRows.push(row);
  }
  for (const el of elements.values()) {
    const stages = STAGES[el.type] || {};
    let best = null;
    for (const row of el.rows) {
      if (!row.rfis.length) continue;
      let rank = 0, label = 'Billed', code = row.codes[0];
      for (const c of row.codes) if (stages[c] && stages[c][0] > rank) { rank = stages[c][0]; label = stages[c][1]; code = c; }
      if (!best || rank > best.rank || (rank === best.rank && (row.closeDate || '') > (best.row.closeDate || ''))) best = { rank, label, code, row };
    }
    el.net = Math.round(el.net * 1e6) / 1e6;
    el.reversed = el.reversalRows.length > 0 && Math.abs(el.net) < 0.001;
    el.correction = el.reversalRows.length > 0 && !el.reversed && el.net > 0;
    el.stageRank = best ? best.rank : -1;
    el.status = el.reversed ? 'Reversed' : best ? best.label : 'Billed without RFI';
    el.statusCode = best?.code || null;
    el.statusDate = best?.row.closeDate || null;
    el.ipc = best?.row.bill || el.rows[0]?.bill || '';
    el.yardOnly = el.type === 'SEG' && el.hasRfi && [...el.codes].every((c) => YARD_CODES.has(c));
    const rfiRows = el.rows.filter((r) => r.rfis.length);
    el.builtDate = rfiRows.map((r) => r.closeDate).filter(Boolean).sort()[0] || null;
    el.firstRfiDate = rfiRows.map((r) => r.openDate).filter(Boolean).sort()[0] || null;
    el.chain = [];
    for (const r of el.rows) for (const x of r.rfis) el.chain.push({ ...x, row: r.row, code: r.codes.join(' / ') });
    el.sourceRows = el.rows.map((r) => r.row);
    el.bills = [...new Set(el.rows.map((r) => r.bill).filter(Boolean))];
  }
  return elements;
}

// Stage an element had reached by a given day (for the 4D replay).
export function stageAt(el, day) {
  const stages = STAGES[el.type] || {};
  let rank = -1, label = null;
  for (const r of el.rows) {
    if (!r.rfis.length || !r.closeDate || dayNum(r.closeDate) > day) continue;
    for (const c of r.codes) if (stages[c] && stages[c][0] > rank) { rank = stages[c][0]; label = stages[c][1]; }
    if (rank < 0) { rank = 0; label = 'Billed'; }
  }
  return { rank, label };
}
