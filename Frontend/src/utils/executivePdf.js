/**
 * The executive summary PDF — every number in it comes from rows the database holds
 * right now, fetched at the moment of export. Nothing is estimated, remembered from an
 * earlier screen, or filled in with a demo figure; a package with no data says so.
 *
 * Reads the same vocabulary the app renders with — `STATUS_COLORS` for the chainage
 * matrix, `formatDateTime`/`station` for times and stations — so the report cannot
 * disagree with the screen it summarises.
 */

import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable/es';
import { STATUS_COLORS } from './roadTextures.js';
import { formatDateTime, station } from '../components/Rfi/rfiVocabulary.js';

/* ------------------------------------------------------------------ palette */

const INK = {
  band: [15, 23, 42], // slate-900 — the app's chrome
  accent: [56, 189, 248], // cyan-400
  text: [15, 23, 42],
  muted: [100, 116, 139], // slate-500
  faint: [148, 163, 184], // slate-400
  line: [226, 232, 240], // slate-200
  cardFill: [241, 245, 249], // slate-100
  good: [22, 163, 74],
  bad: [220, 38, 38],
};

const hexToRgb = (hex) => {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
};

/** Matrix cell fills, straight from the map's palette. */
const STATUS_FILL = Object.fromEntries(
  Object.entries(STATUS_COLORS).map(([status, hex]) => [status, hexToRgb(hex)]),
);

/** Register status chip fills, keyed by the server's stageKey. */
const STAGE_FILL = {
  draft: [226, 232, 240],
  pending_inspection: hexToRgb(STATUS_COLORS['In-Progress']),
  overdue: hexToRgb(STATUS_COLORS.Delayed),
  inspected: [186, 230, 253], // sky-200 — inspected, awaiting sign-off
  approved: hexToRgb(STATUS_COLORS.Completed),
  rejected: hexToRgb(STATUS_COLORS.Delayed),
  cancelled: [203, 213, 225],
};

/* ------------------------------------------------------------------ helpers */

const money = (v) =>
  v === null || v === undefined ? '—' : Number(v).toLocaleString('en-IN', { maximumFractionDigits: 0 });

const pct = (part, whole) => (whole ? Math.round((part / whole) * 100) : 0);

const A4 = { w: 210, h: 297, margin: 14 };
const CONTENT_W = A4.w - A4.margin * 2;

/* ------------------------------------------------------------------ numbers */

/**
 * Everything the report states about one package, computed once so the overview table
 * and the package's own section cannot drift apart.
 */
export function packageFacts({ pkg, chainages = [], layers = [], progress = [], rfis = [] }) {
  const cells = progress.length;
  const byStatus = { Completed: 0, 'In-Progress': 0, Delayed: 0, 'Not Started': 0 };
  let verified = 0;
  let budget = 0;
  let actual = 0;

  for (const row of progress) {
    if (byStatus[row.status] !== undefined) byStatus[row.status] += 1;
    if (row.source === 'rfi') verified += 1;
    budget += Number(row.budgetCost) || 0;
    actual += Number(row.actualCost) || 0;
  }

  const stageCounts = {};
  let overdue = 0;
  for (const r of rfis) {
    stageCounts[r.stageKey] = (stageCounts[r.stageKey] || 0) + 1;
    if (r.isOverdue) overdue += 1;
  }
  const open = (stageCounts.draft || 0) + (stageCounts.pending_inspection || 0)
    + (stageCounts.overdue || 0) + (stageCounts.inspected || 0);

  const spanFrom = pkg.chainageFromM ?? (chainages.length ? Math.min(...chainages.map((c) => c.chainageStart)) : null);
  const spanTo = pkg.chainageToM ?? (chainages.length ? Math.max(...chainages.map((c) => c.chainageEnd)) : null);

  return {
    pkg,
    chainages,
    layers: [...layers].sort((a, b) => a.sortOrder - b.sortOrder),
    progress,
    rfis,
    cells,
    byStatus,
    verified,
    budget,
    actual,
    variance: actual - budget,
    completionPct: pct(byStatus.Completed, cells),
    stageCounts,
    overdue,
    openRfis: open,
    span: spanFrom !== null && spanTo !== null ? `km ${station(spanFrom)} – km ${station(spanTo)}` : '—',
  };
}

/* ------------------------------------------------------------------ builder */

export function buildExecutivePdf({ project, user, generatedAt = new Date(), packages = [], rfis = [] }) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const facts = packages.map((p) => packageFacts({ ...p, rfis: rfis.filter((r) => r.packageId === p.pkg.id) }));

  const totals = facts.reduce(
    (t, f) => ({
      cells: t.cells + f.cells,
      done: t.done + f.byStatus.Completed,
      delayed: t.delayed + f.byStatus.Delayed,
      verified: t.verified + f.verified,
      budget: t.budget + f.budget,
      actual: t.actual + f.actual,
    }),
    { cells: 0, done: 0, delayed: 0, verified: 0, budget: 0, actual: 0 },
  );
  const rfiTotals = {
    total: rfis.length,
    open: facts.reduce((n, f) => n + f.openRfis, 0),
    overdue: facts.reduce((n, f) => n + f.overdue, 0),
    approved: rfis.filter((r) => r.stageKey === 'approved').length,
    rejected: rfis.filter((r) => r.stageKey === 'rejected').length,
  };

  /* ---- cover header ---- */

  doc.setFillColor(...INK.band);
  doc.rect(0, 0, A4.w, 36, 'F');

  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text(project.name || project.code, A4.margin, 17, { maxWidth: 150 });

  doc.setFontSize(9);
  doc.setTextColor(...INK.accent);
  doc.text('EXECUTIVE SUMMARY — RFI-DRIVEN PROGRESS', A4.margin, 25);

  doc.setFont('helvetica', 'normal');
  doc.setTextColor(203, 213, 225);
  doc.setFontSize(8);
  doc.text(String(project.code || ''), A4.w - A4.margin, 17, { align: 'right' });

  doc.setTextColor(...INK.muted);
  doc.setFontSize(8);
  doc.text(
    `Generated ${formatDateTime(generatedAt.toISOString())}  ·  by ${user?.displayName || user?.email || 'unknown'}`
    + `  ·  ${packages.length} package${packages.length === 1 ? '' : 's'}  ·  ${rfis.length} RFI${rfis.length === 1 ? '' : 's'}`,
    A4.margin, 43,
  );

  /* ---- project KPI cards ---- */

  let y = 50;
  const kpis = [
    ['Overall completion', `${pct(totals.done, totals.cells)}%`, `${totals.done} of ${totals.cells} chainage-layer cells`],
    ['Verified by inspection', String(totals.verified), 'cells whose status an RFI wrote'],
    ['RFIs', `${rfiTotals.open} open`, `${rfiTotals.overdue} overdue · ${rfiTotals.approved} approved · ${rfiTotals.rejected} rejected`],
    ['Budget', money(totals.budget), 'sum of imported budget cost'],
    ['Actual', money(totals.actual), 'sum of imported actual cost'],
    ['Cost variance', `${totals.actual - totals.budget >= 0 ? '+' : ''}${money(totals.actual - totals.budget)}`,
      totals.actual - totals.budget > 0 ? 'over budget' : 'within budget'],
  ];

  const cardW = (CONTENT_W - 8) / 3;
  kpis.forEach(([label, value, hint], i) => {
    const cx = A4.margin + (i % 3) * (cardW + 4);
    const cy = y + Math.floor(i / 3) * 24;
    doc.setFillColor(...INK.cardFill);
    doc.roundedRect(cx, cy, cardW, 21, 2, 2, 'F');
    doc.setFontSize(7);
    doc.setTextColor(...INK.muted);
    doc.setFont('helvetica', 'bold');
    doc.text(label.toUpperCase(), cx + 4, cy + 6);
    doc.setFontSize(13);
    const isVariance = label === 'Cost variance';
    if (isVariance) doc.setTextColor(...(totals.actual - totals.budget > 0 ? INK.bad : INK.good));
    else doc.setTextColor(...INK.text);
    doc.text(value, cx + 4, cy + 13);
    doc.setFontSize(6.5);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...INK.faint);
    doc.text(hint, cx + 4, cy + 18, { maxWidth: cardW - 8 });
  });
  y += 52;

  /* ---- packages overview table ---- */

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(...INK.text);
  doc.text('Packages', A4.margin, y);

  autoTable(doc, {
    startY: y + 3,
    margin: { left: A4.margin, right: A4.margin },
    styles: { fontSize: 7, cellPadding: 1.6, textColor: INK.text, lineColor: INK.line, lineWidth: 0.1 },
    headStyles: { fillColor: INK.band, textColor: [255, 255, 255], fontSize: 7 },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    head: [['Package', 'Contractor', 'Chainage', 'Model', 'Progress', 'Budget', 'Actual', 'RFIs']],
    body: facts.map((f) => [
      `${f.pkg.code}\n${f.pkg.name}`,
      f.pkg.contractorName || '—',
      f.span,
      f.pkg.activeModel ? `${f.pkg.activeModel.elementCount} elements` : 'none',
      f.cells ? `${f.byStatus.Completed}/${f.cells} (${f.completionPct}%)` : 'no rows',
      money(f.budget),
      money(f.actual),
      f.rfis.length ? `${f.rfis.length} (${f.openRfis} open)` : '—',
    ]),
    columnStyles: {
      0: { cellWidth: 30, fontStyle: 'bold' },
      1: { cellWidth: 24 },
      2: { cellWidth: 28 },
      3: { cellWidth: 18 },
      4: { cellWidth: 24 },
      5: { cellWidth: 20, halign: 'right' },
      6: { cellWidth: 20, halign: 'right' },
      7: { cellWidth: 18 },
    },
  });

  /* ---- one section per package ---- */

  for (const f of facts) drawPackageSection(doc, f);

  /* ---- footer on every page ---- */

  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setDrawColor(...INK.line);
    doc.setLineWidth(0.2);
    doc.line(A4.margin, 288, A4.w - A4.margin, 288);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.5);
    doc.setTextColor(...INK.faint);
    doc.text(`3D-DMS Digital Twin · ${project.code} · generated ${formatDateTime(generatedAt.toISOString())}`, A4.margin, 292);
    doc.text(`Page ${i} of ${pages}`, A4.w - A4.margin, 292, { align: 'right' });
  }

  const stamp = generatedAt.toISOString().slice(0, 16).replace(/[-:]/g, '').replace('T', '-');
  return { doc, fileName: `${project.code}-executive-summary-${stamp}.pdf` };
}

/* ------------------------------------------------------- package section */

function drawPackageSection(doc, f) {
  doc.addPage();
  let y = 16;

  // header band
  doc.setFillColor(...INK.cardFill);
  doc.rect(A4.margin, y - 6, CONTENT_W, 16, 'F');
  doc.setFillColor(...INK.accent);
  doc.rect(A4.margin, y - 6, 1.6, 16, 'F');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(...INK.text);
  doc.text(`${f.pkg.code} — ${f.pkg.name}`, A4.margin + 5, y);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(...INK.muted);
  doc.text(
    `${f.pkg.contractorName || 'No contractor recorded'}`
    + `${f.pkg.contractNo ? ` · contract ${f.pkg.contractNo}` : ''}`
    + ` · ${f.span} · ${f.pkg.inspectionNoticeHours} h inspection notice · ${f.pkg.status}`,
    A4.margin + 5, y + 6,
  );
  y += 16;

  // KPI line
  doc.setFontSize(8);
  doc.setTextColor(...INK.text);
  const kpiLine = f.cells
    ? `${f.byStatus.Completed}/${f.cells} cells complete (${f.completionPct}%) — ${f.verified} verified by inspection`
      + ` · delayed ${f.byStatus.Delayed} · in progress ${f.byStatus['In-Progress']} · not started ${f.byStatus['Not Started']}`
      + ` · budget ${money(f.budget)} · actual ${money(f.actual)}`
      + ` (${f.variance >= 0 ? '+' : ''}${money(f.variance)})`
    : 'No progress rows imported for this package yet.';
  doc.text(kpiLine, A4.margin, y, { maxWidth: CONTENT_W });
  y += 7;

  /* ---- chainage × layer matrix ---- */

  if (f.cells && f.chainages.length && f.layers.length) {
    const rowByCell = new Map(f.progress.map((r) => [`${r.chainageId}:${r.layerCode}`, r]));

    autoTable(doc, {
      startY: y,
      margin: { left: A4.margin, right: A4.margin },
      styles: { fontSize: 6.5, cellPadding: 1.2, halign: 'center', lineColor: [255, 255, 255], lineWidth: 0.25 },
      headStyles: { fillColor: INK.band, textColor: [255, 255, 255], fontSize: 6.5 },
      head: [['Chainage', ...f.layers.map((l) => l.code)]],
      body: f.chainages
        .slice()
        .sort((a, b) => a.chainageStart - b.chainageStart)
        .map((c) => [
          c.kmLabel || `km ${station(c.chainageStart)} – ${station(c.chainageEnd)}`,
          ...f.layers.map((l) => {
            const row = rowByCell.get(`${c.id}:${l.code}`);
            if (!row) return { content: '—', styles: { fillColor: [237, 242, 247], textColor: INK.faint } };
            const verified = row.source === 'rfi' ? ' •' : '';
            return {
              content: `${Math.round(row.progressPercent)}%${verified}`,
              styles: { fillColor: STATUS_FILL[row.status] || [237, 242, 247], textColor: INK.text },
            };
          }),
        ]),
      columnStyles: { 0: { halign: 'left', fontStyle: 'bold', cellWidth: 34, fillColor: [248, 250, 252] } },
    });

    // legend
    let lx = A4.margin;
    const ly = doc.lastAutoTable.finalY + 4;
    doc.setFontSize(6.5);
    for (const [status, fill] of Object.entries(STATUS_FILL)) {
      doc.setFillColor(...fill);
      doc.rect(lx, ly - 2.2, 3, 3, 'F');
      doc.setTextColor(...INK.muted);
      doc.text(status, lx + 4, ly);
      lx += 4 + doc.getTextWidth(status) + 5;
    }
    doc.text('• status written by an RFI inspection', lx + 2, ly);
    y = ly + 7;
  } else {
    y += 2;
  }

  /* ---- the RFI register, with who did what and when ---- */

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(...INK.text);
  if (y > 265) { doc.addPage(); y = 18; }
  doc.text(`Requests for inspection (${f.rfis.length})`, A4.margin, y);

  if (!f.rfis.length) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...INK.muted);
    doc.text('No RFIs raised on this package yet — its chainages carry no inspection-backed status.', A4.margin, y + 5);
    return;
  }

  const who = (name, at, extra) => {
    if (!name && !at) return '—';
    const lines = [name || '—'];
    if (at) lines.push(formatDateTime(at));
    if (extra) lines.push(extra);
    return lines.join('\n');
  };

  const ordered = f.rfis.slice().sort((a, b) => a.rfiNo.localeCompare(b.rfiNo));

  autoTable(doc, {
    startY: y + 3,
    margin: { left: A4.margin, right: A4.margin },
    styles: { fontSize: 6.5, cellPadding: 1.4, textColor: INK.text, lineColor: INK.line, lineWidth: 0.1, valign: 'top' },
    headStyles: { fillColor: INK.band, textColor: [255, 255, 255], fontSize: 6.5 },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    head: [['RFI No', 'Chainage · layer', 'Status', 'Raised', 'Assigned to', 'Inspected', 'Decision']],
    body: ordered
      .map((r) => [
        `${r.rfiNo}\n${(r.title || '').slice(0, 48)}`,
        `${r.chainageLabel}\n${r.layerCode ? `${r.layerCode} — ${r.layerName || ''}` : 'whole cross-section'}`
          + `${r.side && r.side !== 'na' ? ` (${r.side})` : ''}`,
        r.statusLabel,
        who(r.raisedByName, r.submittedAt || r.createdAt, r.submittedAt ? null : 'draft'),
        r.assignedToName || '—',
        who(r.inspectedByName, r.inspectedAt, r.outcome ? (r.outcome === 'pass' ? 'PASS' : 'FAIL') : null),
        r.stageKey === 'approved'
          ? who(r.approvedByName, r.approvedAt, 'Approved')
          : r.stageKey === 'rejected'
            ? who(r.raisedByName, null, 'Rejected')
            : '—',
      ]),
    columnStyles: {
      0: { cellWidth: 32, fontStyle: 'bold' },
      1: { cellWidth: 34 },
      2: { cellWidth: 22 },
      3: { cellWidth: 25 },
      4: { cellWidth: 20 },
      5: { cellWidth: 25 },
      6: { cellWidth: 24 },
    },
    didParseCell: (data) => {
      if (data.section === 'body' && data.column.index === 2) {
        const r = ordered[data.row.index];
        if (r && STAGE_FILL[r.isOverdue ? 'overdue' : r.stageKey]) {
          data.cell.styles.fillColor = STAGE_FILL[r.isOverdue ? 'overdue' : r.stageKey];
        }
      }
    },
  });
}
