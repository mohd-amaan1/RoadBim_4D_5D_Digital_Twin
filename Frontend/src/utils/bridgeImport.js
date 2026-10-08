/**
 * Bridge registers — one workbook instead of four.
 *
 * A road package is chainage × pavement layer, so it takes four sheets that describe that
 * grid. A bridge is not a grid. Its register is a flat list of activities — every well
 * lift, pylon lift and precast segment — and only a few rows name the model element they
 * complete. So a bridge takes exactly one sheet, and only two of its columns drive the
 * model:
 *
 *   IFC GUID   which element (or IfcGroup) the row speaks for
 *   Approval   Approved -> green · Rejected -> red · anything else -> pending
 *
 * Pending is not a colour. A row with no GUID, no verdict, or a GUID the model does not
 * contain leaves the element exactly as the model draws it.
 *
 * No React or DOM dependency, so it runs under Node for testing.
 */

import { readWorkbookFile, toText, toNumber, toIsoDate, LEVEL } from './excelImport.js';
import { STRATEGY } from './ifcResolver.js';

export const APPROVAL = { APPROVED: 'approved', REJECTED: 'rejected', PENDING: 'pending' };

export const APPROVAL_LABEL = { approved: 'Approved', rejected: 'Rejected', pending: 'Pending' };

/**
 * The status each verdict paints, in the vocabulary the viewer and the plan map already
 * tint with — so an approved bridge column is the same green as a completed road layer.
 * Pending maps to null, which both of them read as "leave the material alone".
 */
export const APPROVAL_STATUS = { approved: 'Completed', rejected: 'Delayed', pending: null };

/**
 * When several rows name one element, the least-finished decides: a single refusal must
 * not be hidden by an approval on the same element, and an element is only green when
 * everything said about it is approved. Same rule the road roll-up uses.
 */
const APPROVAL_RANK = { rejected: 0, pending: 1, approved: 2 };

const APPROVAL_ALIASES = new Map(Object.entries({
  approved: 'approved', approve: 'approved', accepted: 'approved', accept: 'approved',
  passed: 'approved', pass: 'approved', 'rfi approved': 'approved',
  rejected: 'rejected', reject: 'rejected', 'not approved': 'rejected', declined: 'rejected',
  failed: 'rejected', fail: 'rejected', returned: 'rejected', 'rfi rejected': 'rejected',
  pending: 'pending', 'under review': 'pending', 'in review': 'pending', submitted: 'pending',
  awaiting: 'pending', open: 'pending', 'not inspected': 'pending',
}));

/** A blank cell is pending by definition; an unreadable one is pending AND reported. */
export function normaliseApproval(raw) {
  const text = toText(raw);
  if (text === null) return { approval: APPROVAL.PENDING, recognised: true };
  const hit = APPROVAL_ALIASES.get(text.toLowerCase().replace(/\s+/g, ' '));
  return hit
    ? { approval: hit, recognised: true }
    : { approval: APPROVAL.PENDING, recognised: false };
}

/* ------------------------------------------------------------------ *
 * Columns
 * ------------------------------------------------------------------ */

/**
 * Registers are typed by people, so headers are matched loosely: case, punctuation and
 * the stray spaces around " Executed Quantity " are all ignored. The two columns that
 * drive the model come first so nothing else can claim their header.
 */
const normHeader = (h) => String(h ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

const COLUMN_RULES = [
  ['ifcGlobalId', /\b(ifc )?(guid|global ?id|globalid)\b/],
  ['approval', /^(approval|approval status|rfi status|status|verdict)$/],
  ['itemNo', /^(item|item no|item number|item code|boq item|boq no|sl no|s no)$/],
  ['description', /description|particulars|activity|work item/],
  ['uom', /^(uom|unit|units|unit of measure)$/],
  ['location', /^(location|site|place)$/],
  ['executedQuantity', /quantity|\bqty\b/],
  ['rfiRefs', /^rfi\b|letter no|reference/],
  ['rfiDates', /^(date|dates|rfi date|rfi dates)$/],
  ['billNo', /^(bill|bill no|ipc|ipc no)\b/],
  ['remarks', /^(remarks?|comments?|notes?)$/],
];

/** field -> the sheet's own header for it. */
function mapColumns(headers = []) {
  const columns = {};
  for (const [field, pattern] of COLUMN_RULES) {
    const header = headers.find(
      (h) => !Object.values(columns).includes(h) && pattern.test(normHeader(h)),
    );
    if (header !== undefined) columns[field] = header;
  }
  return columns;
}

/* ------------------------------------------------------------------ *
 * Cells
 * ------------------------------------------------------------------ */

/** A multi-line cell — RFI numbers, one per line — kept as lines, blank ones dropped. */
function lines(value) {
  const text = toText(value);
  if (text === null) return null;
  const out = text.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  return out.length ? out.join('\n') : null;
}

/** "406.a / \r\n407.c" -> "406.a / 407.c": wrapped for the printout, one value really. */
function oneLine(value) {
  const text = lines(value);
  return text === null ? null : text.replace(/\s+/g, ' ').trim();
}

/** Dates arrive as typed text ("8-Jan-25") or as Excel serials; both are kept readable. */
function dateLines(value) {
  if (typeof value === 'number' || value instanceof Date) return toIsoDate(value);
  return lines(value);
}

const keyPart = (v) => String(v ?? '').toLowerCase().replace(/\s+/g, ' ').trim();

const IFC_GUID = /^[0-9A-Za-z_$]{22}$/;

/* ------------------------------------------------------------------ *
 * Parsing
 * ------------------------------------------------------------------ */

function emptyResult(fileName, issues = []) {
  return {
    fileName,
    sheetName: null,
    columns: {},
    items: [],
    issues,
    counts: { rows: 0, withGuid: 0, approved: 0, rejected: 0, pending: 0, colouring: 0 },
    ok: false,
  };
}

/**
 * Sheets (from `readWorkbook`) -> one normalised register.
 *
 * The first sheet carrying both an IFC GUID and an Approval column is the register; a
 * workbook with neither is refused outright, because importing it would colour nothing
 * and look as if it had worked.
 */
export function buildBridgeImport(sheets = [], fileName = '') {
  const issues = [];
  const add = (level, code, message, meta = {}) => issues.push({ level, code, message, ...meta });

  const chosen = sheets
    .map((sheet) => ({ sheet, columns: mapColumns(sheet.headers) }))
    .find((c) => c.columns.ifcGlobalId && c.columns.approval);

  if (!chosen) {
    add(LEVEL.ERROR, 'bridge.not-a-register',
      `${fileName || 'This workbook'} has no sheet with both an "IFC GUID" and an "Approval" column, `
      + 'so it is not a bridge register. Turn the bridge switch off to import road workbooks.');
    return emptyResult(fileName, issues);
  }

  const { sheet, columns } = chosen;
  const others = sheets.filter((s) => s !== sheet).length;
  if (others) {
    add(LEVEL.INFO, 'bridge.other-sheets',
      `Read "${sheet.name}". The workbook's other ${others} sheet${others === 1 ? ' was' : 's were'} ignored — a bridge register is one sheet.`);
  }
  if (sheet.droppedColumns?.length) {
    add(LEVEL.INFO, 'sheet.unnamed-columns',
      `Ignored ${sheet.droppedColumns.length} unnamed column(s) in "${sheet.name}".`, { sheet: sheet.name });
  }

  const cell = (row, field) => (columns[field] ? row[columns[field]] : null);
  const items = [];
  const keyUses = new Map();

  sheet.rows.forEach((row, i) => {
    const rowNumber = i + 2; // the header is row 1
    const where = { sheet: sheet.name, row: rowNumber };

    const item = {
      rowNumber,
      itemNo: oneLine(cell(row, 'itemNo')),
      description: oneLine(cell(row, 'description')),
      uom: oneLine(cell(row, 'uom')),
      location: oneLine(cell(row, 'location')),
      executedQuantity: toNumber(cell(row, 'executedQuantity')),
      rfiRefs: lines(cell(row, 'rfiRefs')),
      rfiDates: dateLines(cell(row, 'rfiDates')),
      billNo: oneLine(cell(row, 'billNo')),
      remarks: oneLine(cell(row, 'remarks')),
      ifcGlobalId: toText(cell(row, 'ifcGlobalId')),
      approvalText: toText(cell(row, 'approval')),
    };

    const { rowNumber: _, ...content } = item;
    if (Object.values(content).every((v) => v === null)) return; // a blank line in the sheet

    if (item.ifcGlobalId && !IFC_GUID.test(item.ifcGlobalId)) {
      add(LEVEL.WARNING, 'bridge.bad-guid',
        `Row ${rowNumber}: "${item.ifcGlobalId}" is not a 22-character IFC GlobalId, so it will probably match nothing.`,
        { ...where, field: columns.ifcGlobalId });
    }

    const { approval, recognised } = normaliseApproval(item.approvalText);
    item.approval = approval;
    if (!recognised) {
      add(LEVEL.WARNING, 'bridge.unknown-approval',
        `Row ${rowNumber}: Approval "${item.approvalText}" is neither approved nor rejected, so it is treated as pending.`,
        { ...where, field: columns.approval });
    }
    if (approval !== APPROVAL.PENDING && !item.ifcGlobalId) {
      add(LEVEL.WARNING, 'bridge.verdict-without-guid',
        `Row ${rowNumber} (${item.remarks || item.description || 'unlabelled'}) is ${approval} but names no IFC GUID, so nothing on the model changes colour for it.`,
        where);
    }

    // Identity across re-imports. A repeated line keeps importing — it is numbered, not
    // refused — and the numbering is stable as long as the sheet's order is.
    const base = [item.itemNo, item.location, item.remarks || item.description].map(keyPart).join('|');
    const identity = base.replace(/\|/g, '') ? base : `row:${rowNumber}`;
    const uses = (keyUses.get(identity) || 0) + 1;
    keyUses.set(identity, uses);
    item.key = uses > 1 ? `${identity}#${uses}` : identity;
    if (uses === 2) {
      add(LEVEL.INFO, 'bridge.repeated-row',
        `"${item.remarks || item.description || identity}" appears more than once; the repeats are kept as separate rows.`,
        where);
    }

    items.push(item);
  });

  if (!items.length) {
    add(LEVEL.ERROR, 'bridge.empty', `"${sheet.name}" has a header but no register rows.`, { sheet: sheet.name });
  }

  // One element, several verdicts: allowed, but worth saying which one wins.
  const byGuid = new Map();
  for (const item of items) {
    if (!item.ifcGlobalId) continue;
    if (!byGuid.has(item.ifcGlobalId)) byGuid.set(item.ifcGlobalId, []);
    byGuid.get(item.ifcGlobalId).push(item);
  }
  for (const [guid, rows] of byGuid) {
    const verdicts = new Set(rows.map((r) => r.approval));
    if (verdicts.size > 1) {
      add(LEVEL.WARNING, 'bridge.guid-conflict',
        `GUID ${guid} is named by rows ${rows.map((r) => r.rowNumber).join(', ')} with different verdicts (${[...verdicts].join(', ')}). `
        + 'The least-finished decides the colour: rejected, then pending, then approved.');
    }
  }

  const counts = {
    rows: items.length,
    withGuid: items.filter((r) => r.ifcGlobalId).length,
    approved: items.filter((r) => r.approval === APPROVAL.APPROVED).length,
    rejected: items.filter((r) => r.approval === APPROVAL.REJECTED).length,
    pending: items.filter((r) => r.approval === APPROVAL.PENDING).length,
    colouring: items.filter((r) => r.ifcGlobalId && r.approval !== APPROVAL.PENDING).length,
  };

  return {
    fileName,
    sheetName: sheet.name,
    columns,
    items,
    issues,
    counts,
    ok: !issues.some((i) => i.level === LEVEL.ERROR) && items.length > 0,
  };
}

/** Browser helper: File -> validated register. Never throws; failures become issues. */
export async function importBridgeWorkbook(file) {
  try {
    return buildBridgeImport(await readWorkbookFile(file), file.name);
  } catch (err) {
    return emptyResult(file?.name || '', [
      { level: LEVEL.ERROR, code: 'file.unreadable', message: err.message },
    ]);
  }
}

/** The request body the server stores — the rows as parsed, nothing derived. */
export function buildBridgePayload({ result, contentSha256 = null }) {
  return {
    fileName: result.fileName,
    sheetName: result.sheetName,
    contentSha256,
    items: result.items.map((r) => ({
      key: r.key,
      rowNumber: r.rowNumber,
      itemNo: r.itemNo,
      description: r.description,
      uom: r.uom,
      location: r.location,
      executedQuantity: r.executedQuantity,
      rfiRefs: r.rfiRefs,
      rfiDates: r.rfiDates,
      billNo: r.billNo,
      remarks: r.remarks,
      ifcGlobalId: r.ifcGlobalId,
      approvalText: r.approvalText,
      approval: r.approval,
    })),
    issues: result.issues.map((i) => ({
      level: i.level,
      code: i.code,
      message: i.message,
      sheet: i.sheet ?? null,
      row: i.row ?? null,
      field: i.field ?? null,
    })),
    summary: JSON.stringify(result.counts),
  };
}

/* ------------------------------------------------------------------ *
 * Binding to the model
 * ------------------------------------------------------------------ */

const labelOf = (item) => item.remarks || item.description || `row ${item.rowNumber}`;

/**
 * Register rows -> model elements, in the SAME shape `resolveProgressToModel` returns.
 *
 * That shape is the whole point: the per-element tint (`statusByExpressID` →
 * `applyStatusByElement`), the plan map and the dashboard roll-ups all consume it
 * unchanged, so a bridge needs no second rendering path. A GUID resolves to an element
 * directly, or through an IfcGroup to its members.
 *
 * Works on freshly parsed rows and on rows read back from the server alike — both carry
 * `ifcGlobalId` and a normalised `approval`.
 */
export function resolveBridgeToModel({ items = [], summary } = {}) {
  const elements = summary?.elementIndex || [];
  const groups = summary?.groupIndex || [];
  const issues = [];

  const elementByGuid = new Map(elements.filter((e) => e.globalId).map((e) => [e.globalId, e]));
  const elementByExpress = new Map(elements.map((e) => [e.expressID, e]));
  const groupByGuid = new Map(groups.map((g) => [g.globalId, g]));

  const rowsByGuid = new Map();
  for (const item of items) {
    const guid = item.ifcGlobalId ? String(item.ifcGlobalId).trim() : '';
    if (!guid) continue;
    if (!rowsByGuid.has(guid)) rowsByGuid.set(guid, []);
    rowsByGuid.get(guid).push(item);
  }

  const counts = { guid: 0, group: 0, position: 0, name: 0, none: 0, total: rowsByGuid.size };
  const matches = [];
  const byExpressID = new Map();
  const unmatchedRows = [];

  for (const [guid, rows] of rowsByGuid) {
    let hit = [];
    let strategy = STRATEGY.NONE;
    let note = null;

    if (elementByGuid.has(guid)) {
      hit = [elementByGuid.get(guid)];
      strategy = STRATEGY.GUID;
    } else if (groupByGuid.has(guid)) {
      const group = groupByGuid.get(guid);
      hit = group.memberExpressIDs.map((id) => elementByExpress.get(id)).filter(Boolean);
      if (hit.length) {
        strategy = STRATEGY.GROUP;
        note = `${group.name || 'Model group'} — ${hit.length} element${hit.length === 1 ? '' : 's'}`;
      }
    }

    counts[strategy] += 1;

    const deciding = rows.reduce((worst, r) =>
      (APPROVAL_RANK[r.approval] ?? 1) < (APPROVAL_RANK[worst.approval] ?? 1) ? r : worst);
    const approval = APPROVAL_RANK[deciding.approval] === undefined ? APPROVAL.PENDING : deciding.approval;

    if (!hit.length) {
      unmatchedRows.push({ guid, rowNumbers: rows.map((r) => r.rowNumber), label: labelOf(deciding), approval });
      if (elements.length) {
        issues.push({
          level: LEVEL.WARNING,
          code: 'bridge.guid-not-in-model',
          message: `Row${rows.length === 1 ? '' : 's'} ${rows.map((r) => r.rowNumber).join(', ')} (${labelOf(deciding)}) name GUID ${guid}, which the loaded model does not contain — nothing is coloured for ${rows.length === 1 ? 'it' : 'them'}.`,
        });
      }
      continue;
    }

    const match = {
      strategy,
      elements: hit,
      segmentIndex: hit[0].segmentIndex ?? null,
      note,
      row: {
        key: `bridge:${guid}`,
        bridge: true,
        guid,
        rowNumbers: rows.map((r) => r.rowNumber),
        itemNo: deciding.itemNo ?? null,
        description: deciding.description ?? null,
        remarks: deciding.remarks ?? null,
        rfiRefs: deciding.rfiRefs ?? null,
        rfiDates: deciding.rfiDates ?? null,
        billNo: deciding.billNo ?? null,
        approvalText: deciding.approvalText ?? null,
        approval,
        status: APPROVAL_STATUS[approval],
        // Accepted work counts as done and refused work as not; pending is unmeasured,
        // so it neither drags a roll-up down nor pretends to have been checked.
        progressPercent: approval === APPROVAL.APPROVED ? 100 : approval === APPROVAL.REJECTED ? 0 : null,
        // A register has no chainage grid. Leaving this null is what keeps bridge rows
        // out of the chainage × layer matrix, which has nothing true to draw for them.
        chainageId: null,
        layerCode: hit[0].layerCode ?? null,
        modelLayerCode: hit[0].layerCode ?? null,
      },
    };
    matches.push(match);

    for (const el of hit) {
      const prior = byExpressID.get(el.expressID);
      // An element reached twice — directly and through a group — takes the worse verdict.
      if (!prior || APPROVAL_RANK[approval] < APPROVAL_RANK[prior.row.approval]) {
        byExpressID.set(el.expressID, match);
      }
    }
  }

  if (!elements.length && rowsByGuid.size) {
    issues.push({
      level: LEVEL.INFO,
      code: 'bridge.no-model',
      message: 'No model is loaded, so no element is coloured yet. The GUIDs are kept and bind as soon as one is added.',
    });
  }

  const colouring = { green: 0, red: 0, pending: 0, untouched: elements.length - byExpressID.size };
  for (const m of byExpressID.values()) {
    if (m.row.approval === APPROVAL.APPROVED) colouring.green += 1;
    else if (m.row.approval === APPROVAL.REJECTED) colouring.red += 1;
    else colouring.pending += 1;
  }

  const bound = counts.total - counts.none;
  const direction = {
    source: 'bridge', ascending: true, anchorCount: 0, agreesWithSite: null, siteImplied: null,
  };

  return {
    bridge: true,
    matches,
    byExpressID,
    issues,
    direction: { ...direction, map: new Map(), ambiguous: false },
    report: {
      counts,
      resolvedPercent: counts.total ? Math.round((bound / counts.total) * 100) : 0,
      coverage: { elements: elements.length, covered: byExpressID.size, uncovered: elements.length - byExpressID.size },
      colouring,
      uncoveredElements: [],
      unmatchedRows,
      chainageToSegment: [],
      direction,
      alignment: null,
    },
  };
}

/**
 * Every register row behind one clicked element, and the verdict it is painted with.
 *
 * Looked up through the resolution first, so an element reached through an IfcGroup
 * finds the group's rows rather than nothing; its own GlobalId is the fallback. Returns
 * ALL rows naming the element, not just the one that decided its colour — the inspector
 * shows the register as written, including a disagreement if there is one.
 */
export function registerRowsForElement({ items = [], resolution, expressID, globalId }) {
  const match = resolution?.bridge ? resolution.byExpressID.get(expressID) || null : null;
  const guid = match?.row?.guid || (globalId && globalId !== '—' ? globalId : null);
  const rows = guid ? items.filter((item) => item.ifcGlobalId === guid) : [];
  return { rows, match, approval: match?.row?.approval ?? APPROVAL.PENDING };
}
