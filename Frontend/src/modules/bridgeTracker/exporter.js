// Exports: formatted element register (.xlsx via ExcelJS), issues (.csv), screenshot (.png).
import { saveFile, csvEscape, todayISO } from './util.js';
import { decodeKey, TYPE_NAMES } from './keys.js';

// ExcelJS is large and only needed when someone exports, so it is its own chunk.
const loadExcelJS = () => import('exceljs').then((m) => m.default ?? m);

export const STATE_LABEL = { built: 'Built', yard: 'Cast in yard', notYet: 'Not yet', notRaised: 'RFI not raised', reversed: 'Reversed', noModel: 'No model element', noKey: 'No key' };
const STATE_FILL = { built: 'FFE3E5E8', yard: 'FFFBEBD0', notYet: 'FFFFFFFF', notRaised: 'FFF6D3D3', reversed: 'FFEBD5D5', noModel: 'FFE8EEF6', noKey: 'FFF2F2F2' };
const SEV_FILL = { High: 'FFF6D3D3', Medium: 'FFFBEBD0', Low: 'FFEFF1F3', Info: 'FFE8EEF6' };

function styleSheet(ws, widths) {
  ws.columns.forEach((c, i) => { c.width = widths[i] || 14; });
  const head = ws.getRow(1);
  head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2F3A45' } };
  head.alignment = { vertical: 'middle' };
  head.height = 20;
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: ws.columnCount } };
}

export async function exportRegister(ctx) {
  const ExcelJS = await loadExcelJS();
  const { ipc, link, ev, model } = ctx;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Bridge RFI tracker';
  wb.created = new Date();

  const sum = wb.addWorksheet('Summary');
  const rowsS = [
    ['Project', 'Palashbari–Sualkuchi Extradosed Bridge'],
    ['IPC', ipc?.bill || '–'], ['Bill period', ipc?.period || '–'], ['IPC file', ipc?.fileName || '–'],
    ['Model file', model?.fileName || '–'], ['Exported', todayISO()],
    [], ['State', 'Model elements'],
    ...Object.entries(ev.counts).filter(([k]) => STATE_LABEL[k]).map(([k, v]) => [STATE_LABEL[k], v]),
    ['Data issues (all)', ev.issues.length],
  ];
  rowsS.forEach((r) => sum.addRow(r));
  sum.getColumn(1).width = 24; sum.getColumn(2).width = 48;
  sum.getColumn(1).font = { bold: true };

  const ws = wb.addWorksheet('Elements');
  ws.addRow(['Element_Key', 'IFC_GlobalId', 'IFC class', 'Type', 'Pier', 'Module', 'Arm', 'Seg / lift', '©', 'State', 'Status', 'Status date', 'IPC', 'Net qty', 'RFI numbers', 'Issues']);
  const put = (key, els, state) => {
    const el = ipc?.elements.get(key);
    const d = el || decodeKey(key);
    const issues = ev.issuesByKey.get(key) || [];
    const nr = ev.notRaised.get(key);
    const row = ws.addRow([
      key, els.map((e) => e.gid + (e.copy ? ` (copy for module ${e.module})` : '')).join(';'), els.map((e) => e.cls).join(';'), TYPE_NAMES[d.type] || d.type || '', d.unit || '', d.module || '', d.arm || '',
      d.type === 'SEG' ? d.seg : d.lift ?? '', d.cable ? '©' : '', STATE_LABEL[state] || state, el?.status || (nr ? `Missing: ${nr.missingStage || 'RFI'}` : ''),
      el?.statusDate ? new Date(el.statusDate + 'T00:00:00Z') : null, el?.ipc || '', el ? el.net : null,
      el ? [...new Set(el.chain.map((x) => x.raw))].join(', ') : '', [...(nr ? nr.reasons.map((r) => `${r.rule}: ${r.text}`) : []), ...issues.map((i) => `${i.code}: ${i.title}`)].join(' | '),
    ]);
    row.getCell(10).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: STATE_FILL[state] || 'FFFFFFFF' } };
    if (state === 'notRaised') row.getCell(10).font = { bold: true, color: { argb: 'FFB3261E' } };
    row.getCell(12).numFmt = 'dd-mmm-yy';
  };
  const keys = link ? [...link.keyToEls.keys()].sort(keySort) : [];
  for (const k of keys) put(k, link.keyToEls.get(k), ev.states.get(k));
  for (const el of ev.noModel) put(el.key, [], 'noModel');
  styleSheet(ws, [20, 26, 22, 16, 9, 8, 6, 9, 4, 15, 20, 12, 10, 10, 50, 60]);

  const log = wb.addWorksheet('RFI log');
  log.addRow(['RFI', 'Series', 'Date', 'Element_Key', 'Position in chain', 'BOQ item', 'Bill', 'Schedule 4 row', 'In model']);
  if (ipc) for (const r of ipc.rows) for (const x of r.rfis) {
    const row = log.addRow([x.raw, x.series, x.date ? new Date(x.date + 'T00:00:00Z') : null, r.key || `(unlinked) ${r.text}`, x.pos, r.codes.join(' / '), r.bill, r.row, r.key && link?.keyToEls.has(r.key) ? 'Yes' : 'No']);
    row.getCell(3).numFmt = 'dd-mmm-yy';
  }
  styleSheet(log, [22, 9, 12, 22, 10, 22, 10, 10, 9]);

  const is = wb.addWorksheet('Issues');
  is.addRow(['Severity', 'Check', 'Issue', 'Detail', 'Elements', 'Schedule 4 rows']);
  for (const [key, nr] of ev.notRaised) {
    const row = is.addRow(['RFI not raised', nr.reasons.map((r) => r.rule).join(', '), `${key}${nr.missingStage ? ` (missing ${nr.missingStage})` : ''}`, nr.reasons.map((r) => r.text).join(' '), key, '']);
    row.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF6D3D3' } };
  }
  for (const x of ev.issues) {
    const row = is.addRow([x.sev, x.code, x.title, x.detail, x.keys.join(', '), x.rows.join(', ')]);
    row.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SEV_FILL[x.sev] } };
  }
  styleSheet(is, [14, 8, 44, 90, 40, 18]);
  is.getColumn(4).alignment = { wrapText: true, vertical: 'top' };

  const buf = await wb.xlsx.writeBuffer();
  const name = `Element_Register_${(ipc?.bill || 'no-IPC').replace(/\s+/g, '')}_${todayISO()}.xlsx`;
  return saveFile(name, new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
}

export function exportIssuesCSV(ctx) {
  const { ev, ipc } = ctx;
  const lines = [['Severity', 'Check', 'Issue', 'Detail', 'Elements', 'Rows'].join(',')];
  for (const [key, nr] of ev.notRaised) lines.push(['RFI not raised', nr.reasons.map((r) => r.rule).join(' '), key + (nr.missingStage ? ` (missing ${nr.missingStage})` : ''), nr.reasons.map((r) => r.text).join(' '), key, ''].map(csvEscape).join(','));
  for (const x of ev.issues) lines.push([x.sev, x.code, x.title, x.detail, x.keys.join(' '), x.rows.join(' ')].map(csvEscape).join(','));
  return saveFile(`Issues_${(ipc?.bill || 'no-IPC').replace(/\s+/g, '')}_${todayISO()}.csv`, '﻿' + lines.join('\r\n'), 'text/csv');
}

export async function exportScreenshot(viewer, ipc) {
  const blob = await viewer.screenshot();
  return saveFile(`Bridge_view_${(ipc?.bill || '').replace(/\s+/g, '')}_${todayISO()}.png`, blob, 'image/png');
}

export function keySort(a, b) {
  const da = decodeKey(a), db = decodeKey(b);
  const order = { CE: 0, WELL: 1, PLUG: 2, CAP: 3, LPYL: 4, PT: 5, UPYL: 6, SEG: 7, OTHER: 8 };
  return (da.pier || 0) - (db.pier || 0) || order[da.type] - order[db.type] || String(da.arm || '').localeCompare(String(db.arm || '')) || (da.seg ?? da.lift ?? 0) - (db.seg ?? db.lift ?? 0) || (da.a ? -1 : 0) - (db.a ? -1 : 0) || a.localeCompare(b);
}
