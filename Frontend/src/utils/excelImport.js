/**
 * Phase 1 — Excel import, validation and normalisation.
 *
 * Turns the four exported workbooks (RoadLayer, Road_chainage, LayerProgress,
 * ProjectMetric) into one normalised dataset, and reports every problem it had
 * to work around instead of silently papering over it.
 *
 * The module is deliberately free of React and DOM dependencies so it can be
 * exercised straight from Node — see `docs/IFC_LAYERPROGRESS_MATCH_REPORT.md`
 * for the findings these rules were written against.
 *
 * Thickness precedence is fixed: **the IFC model wins**. `DesignThicknessMm` in
 * the spreadsheet is carried through for reference and reported when it
 * disagrees, but it never overrides what was modelled. See resolveThickness().
 */

import * as XLSX from 'xlsx';

/* ------------------------------------------------------------------ *
 * Sheet kinds
 * ------------------------------------------------------------------ */

export const SHEET_KIND = {
  CHAINAGES: 'CHAINAGES',
  LAYERS: 'LAYERS',
  PROGRESS: 'PROGRESS',
  METRICS: 'METRICS',
  LEGACY_PROGRESS: 'LEGACY_PROGRESS',
  UNKNOWN: 'UNKNOWN',
};

export const SHEET_LABEL = {
  [SHEET_KIND.CHAINAGES]: 'Chainages',
  [SHEET_KIND.LAYERS]: 'Layer catalogue',
  [SHEET_KIND.PROGRESS]: 'Layer progress',
  [SHEET_KIND.METRICS]: 'Project metrics',
  [SHEET_KIND.LEGACY_PROGRESS]: 'Progress (template format)',
  [SHEET_KIND.UNKNOWN]: 'Unrecognised',
};

/** Columns that uniquely identify each workbook. All must be present. */
const SIGNATURES = [
  { kind: SHEET_KIND.PROGRESS, required: ['ChainageId', 'LayerId', 'Status', 'ProgressPercent'] },
  { kind: SHEET_KIND.CHAINAGES, required: ['ChainageStart', 'ChainageEnd', 'Latitude', 'Longitude'] },
  { kind: SHEET_KIND.LAYERS, required: ['LayerName', 'Code', 'ThicknessMm'] },
  { kind: SHEET_KIND.METRICS, required: ['TotalKmTarget', 'TotalBudgetCost', 'TotalActualCost'] },
  { kind: SHEET_KIND.LEGACY_PROGRESS, required: ['Chainage_Start', 'Layer_Code', 'Status'] },
];

/* ------------------------------------------------------------------ *
 * Scalar coercion
 * ------------------------------------------------------------------ */

/** Excel exports write an unset cell as the four-character text `NULL`. */
const NULLISH = new Set(['', '-', '—', 'null', 'NULL', 'Null', 'n/a', 'N/A', 'NaN', 'undefined']);

export function coerceNull(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' && NULLISH.has(value.trim())) return null;
  if (typeof value === 'number' && Number.isNaN(value)) return null;
  return value;
}

export function toNumber(value) {
  const v = coerceNull(value);
  if (v === null) return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[,\s]/g, ''));
  return Number.isFinite(n) ? n : null;
}

export function toText(value) {
  const v = coerceNull(value);
  if (v === null) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}

/**
 * Excel stores dates as a day count from 1899-12-30. Real Date objects and ISO
 * strings pass through, so a sheet saved with `cellDates` still works.
 */
const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30);
const DAY_MS = 86400000;

export function toIsoDate(value) {
  const v = coerceNull(value);
  if (v === null) return null;

  if (v instanceof Date) {
    return Number.isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10);
  }
  if (typeof v === 'number') {
    // Serial 1 is 1900-01-01; anything below that is not a date.
    if (v < 1 || v > 2958465) return null;
    return new Date(EXCEL_EPOCH_MS + Math.round(v) * DAY_MS).toISOString().slice(0, 10);
  }
  const parsed = new Date(String(v));
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

/** Same epoch, but keeps the time-of-day fraction (UpdatedAt / CalculatedAt). */
export function toIsoDateTime(value) {
  const v = coerceNull(value);
  if (v === null) return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString();
  if (typeof v === 'number') {
    if (v < 1 || v > 2958465) return null;
    return new Date(EXCEL_EPOCH_MS + v * DAY_MS).toISOString();
  }
  const parsed = new Date(String(v));
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

/* ------------------------------------------------------------------ *
 * Status vocabulary
 * ------------------------------------------------------------------ */

/**
 * The database CHECK constraint accepts only these four. The spreadsheets use
 * `In Progress` and `Not started`, which a raw insert would reject outright.
 */
export const STATUSES = ['Not Started', 'In-Progress', 'Delayed', 'Completed'];

const STATUS_ALIASES = new Map(
  Object.entries({
    'not started': 'Not Started',
    'notstarted': 'Not Started',
    'not-started': 'Not Started',
    'yet to start': 'Not Started',
    'pending': 'Not Started',
    'in progress': 'In-Progress',
    'in-progress': 'In-Progress',
    'inprogress': 'In-Progress',
    'ongoing': 'In-Progress',
    'active': 'In-Progress',
    'wip': 'In-Progress',
    'delayed': 'Delayed',
    'delay': 'Delayed',
    'behind schedule': 'Delayed',
    'held up': 'Delayed',
    'completed': 'Completed',
    'complete': 'Completed',
    'done': 'Completed',
    'finished': 'Completed',
  })
);

/** Returns the canonical status, or null when the value is unrecognised. */
export function normaliseStatus(raw) {
  const text = toText(raw);
  if (text === null) return null;
  return STATUS_ALIASES.get(text.toLowerCase().replace(/\s+/g, ' ')) || null;
}

/* ------------------------------------------------------------------ *
 * Thickness precedence — IFC wins
 * ------------------------------------------------------------------ */

export const THICKNESS_SOURCES = ['ifc', 'excel', 'catalogue'];

/**
 * The model is the record of what was built, so `IfcMaterialLayerSet` outranks
 * both the spreadsheet override and the catalogue default. The losing values are
 * returned alongside so the UI can show the disagreement rather than hide it.
 */
export function resolveThickness({ ifcThicknessMm, excelDesignThicknessMm, catalogueThicknessMm }) {
  const ifc = toNumber(ifcThicknessMm);
  const excel = toNumber(excelDesignThicknessMm);
  const catalogue = toNumber(catalogueThicknessMm);

  let thicknessMm = null;
  let source = null;
  if (ifc !== null) { thicknessMm = ifc; source = 'ifc'; }
  else if (excel !== null) { thicknessMm = excel; source = 'excel'; }
  else if (catalogue !== null) { thicknessMm = catalogue; source = 'catalogue'; }

  const overridden = [];
  if (source === 'ifc' && excel !== null && excel !== ifc) overridden.push({ source: 'excel', value: excel });
  if (source === 'ifc' && catalogue !== null && catalogue !== ifc) overridden.push({ source: 'catalogue', value: catalogue });
  if (source === 'excel' && catalogue !== null && catalogue !== excel) overridden.push({ source: 'catalogue', value: catalogue });

  return { thicknessMm, source, ifcThicknessMm: ifc, excelDesignThicknessMm: excel, catalogueThicknessMm: catalogue, overridden };
}

/* ------------------------------------------------------------------ *
 * Layer roles — why layer codes cannot be joined directly
 * ------------------------------------------------------------------ */

/**
 * `BC` means **Base Course** in these spreadsheets, but `deriveLayerCode()`
 * assigns `BC` to *Bituminous Concrete* — the wearing course at the top of the
 * stack. Joining the two sets on their codes therefore paints base-course
 * progress onto the surface and leaves the real base course untouched:
 *
 *     Excel  SUB  GSB  BC (Base cource)   SC (Surface cource)
 *     IFC    SUB  GSB  WMM (Base Course)  BC (Surface)
 *                      ^^^^^^^^^^^^^^^^^  ^^^^^^^^^^^^^
 *                      collide on "BC" meaning two different layers
 *
 * Both sides are classified into a shared structural role instead, taken from
 * the layer *name*, which is unambiguous. Codes are only a fallback.
 */
export const LAYER_ROLES = ['SUBGRADE', 'SUBBASE', 'BASE', 'BINDER', 'SURFACE'];

// Order matters: "Sub base" must be tested before "base", "subgrade" before both.
const ROLE_BY_NAME = [
  ['SUBGRADE', /sub[\s_-]*grade|formation|earthwork|embankment/i],
  ['SUBBASE', /sub[\s_-]*base|subbase|granular\s*sub|\bgsb\b/i],
  ['BINDER', /\bdbm\b|dense\s*bituminous|binder/i],
  ['BASE', /base\s*c?ource|base\s*course|\bwmm\b|wet\s*mix|macadam|crushed\s*aggregate|aggregate\s*base|\bbase\b/i],
  ['SURFACE', /surface|wearing|bituminous\s*concrete|asphalt|\bsma\b|carriageway|\bpcc\b|portland|cement\s*concrete/i],
];

const ROLE_BY_CODE = {
  SUB: 'SUBGRADE', SG: 'SUBGRADE',
  GSB: 'SUBBASE', SB: 'SUBBASE',
  WMM: 'BASE', GAB: 'BASE',
  DBM: 'BINDER',
  SC: 'SURFACE', PCC: 'SURFACE', AC: 'SURFACE',
  // `BC` is deliberately absent — it is the ambiguous one and must come from a name.
};

/**
 * Resolves a layer to its position in the pavement stack. The name is trusted
 * first because it survives the `BC` collision; the code is a fallback for
 * layers with no usable name.
 */
export function classifyLayerRole(name, code) {
  const text = toText(name);
  if (text) {
    for (const [role, pattern] of ROLE_BY_NAME) {
      if (pattern.test(text)) return role;
    }
  }
  const c = toText(code)?.toUpperCase();
  return (c && ROLE_BY_CODE[c]) || null;
}

/**
 * Maps the imported layer catalogue onto the layers found in the IFC, pairing
 * them by role rather than by code.
 *
 * `ifcLayers` are `ifcSummary.layers` — each `{ code, name, thicknessMm }`.
 * Returns a lookup keyed by the **Excel** layer code, so a progress row can find
 * the modelled layer it belongs to, plus the resolved thickness (IFC wins).
 */
export function reconcileLayerCodes(excelLayers = [], ifcLayers = []) {
  const issues = [];
  const byRole = new Map();

  for (const layer of ifcLayers) {
    const role = classifyLayerRole(layer.name, layer.code);
    if (!role) {
      issues.push({ level: LEVEL.WARNING, code: 'reconcile.ifc-layer-unclassified', message: `Modelled layer "${layer.name}" (${layer.code}) does not look like a standard pavement layer, so no progress can bind to it.` });
      continue;
    }
    if (byRole.has(role)) {
      issues.push({ level: LEVEL.WARNING, code: 'reconcile.duplicate-ifc-role', message: `Both "${byRole.get(role).name}" and "${layer.name}" classify as ${role}; using the first.` });
      continue;
    }
    byRole.set(role, layer);
  }

  const map = new Map();
  for (const layer of excelLayers) {
    const role = classifyLayerRole(layer.layerName, layer.code);
    if (!role) {
      issues.push({ level: LEVEL.WARNING, code: 'reconcile.excel-layer-unclassified', message: `Layer "${layer.layerName}" (${layer.code}) could not be classified, so it cannot bind to the model.` });
      continue;
    }

    const ifcLayer = byRole.get(role) || null;
    const thickness = resolveThickness({
      ifcThicknessMm: ifcLayer?.thicknessMm,
      catalogueThicknessMm: layer.catalogueThicknessMm,
    });

    if (ifcLayer && ifcLayer.code !== layer.code) {
      issues.push({
        level: LEVEL.INFO,
        code: 'reconcile.code-differs',
        message: `Layer "${layer.layerName}" is ${layer.code} in the sheet and ${ifcLayer.code} in the model; matched on role ${role}.`,
      });
    }
    if (!ifcLayer && ifcLayers.length) {
      issues.push({
        level: LEVEL.WARNING,
        code: 'reconcile.no-ifc-layer',
        message: `Layer ${layer.code} (${role}) has no counterpart in the model, so its progress cannot be shown in 3D.`,
      });
    }

    map.set(layer.code, { excelLayer: layer, role, ifcLayer, ...thickness });
  }

  for (const [role, layer] of byRole) {
    if (![...map.values()].some((m) => m.role === role)) {
      issues.push({ level: LEVEL.WARNING, code: 'reconcile.no-excel-layer', message: `Modelled layer "${layer.name}" (${role}) has no row in the layer catalogue.` });
    }
  }

  return { map, issues, rolesMatched: [...map.values()].filter((m) => m.ifcLayer).length };
}

/* ------------------------------------------------------------------ *
 * Issue collection
 * ------------------------------------------------------------------ */

export const LEVEL = { ERROR: 'error', WARNING: 'warning', INFO: 'info' };

function createIssueLog() {
  const issues = [];
  const add = (level, code, message, meta = {}) => {
    issues.push({ level, code, message, ...meta });
  };
  return {
    issues,
    error: (code, message, meta) => add(LEVEL.ERROR, code, message, meta),
    warn: (code, message, meta) => add(LEVEL.WARNING, code, message, meta),
    info: (code, message, meta) => add(LEVEL.INFO, code, message, meta),
  };
}

/* ------------------------------------------------------------------ *
 * Workbook reading
 * ------------------------------------------------------------------ */

/** Trailing blank columns arrive as `__EMPTY`, `__EMPTY_1`… and carry nothing. */
const isUnnamedColumn = (header) => /^__EMPTY(_\d+)?$/.test(header) || header.trim() === '';

export function detectSheetKind(headers) {
  const present = new Set(headers);
  for (const sig of SIGNATURES) {
    if (sig.required.every((c) => present.has(c))) return sig.kind;
  }
  return SHEET_KIND.UNKNOWN;
}

/**
 * Reads every sheet of a workbook into `{ name, kind, headers, rows, droppedColumns }`.
 * `data` is an ArrayBuffer or Uint8Array.
 */
export function readWorkbook(data, fileName = '') {
  const workbook = XLSX.read(data instanceof Uint8Array ? data : new Uint8Array(data), { type: 'array' });

  return workbook.SheetNames.map((name) => {
    const sheet = workbook.Sheets[name];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: null });
    const headers = rows.length ? Object.keys(rows[0]) : [];
    const droppedColumns = headers.filter(isUnnamedColumn);
    const kept = headers.filter((h) => !isUnnamedColumn(h));

    return {
      fileName,
      name,
      kind: detectSheetKind(kept),
      headers: kept,
      droppedColumns,
      rows: rows.map((row) => {
        const clean = {};
        for (const key of kept) clean[key] = row[key];
        return clean;
      }),
    };
  });
}

/** Browser helper: File -> parsed sheets. */
export function readWorkbookFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`Could not read ${file.name}`));
    reader.onload = (event) => {
      try {
        resolve(readWorkbook(event.target.result, file.name));
      } catch (err) {
        reject(new Error(`${file.name} is not a readable spreadsheet: ${err.message}`));
      }
    };
    reader.readAsArrayBuffer(file);
  });
}

/* ------------------------------------------------------------------ *
 * Per-sheet normalisation
 * ------------------------------------------------------------------ */

const IFC_GUID = /^[0-9A-Za-z_$]{22}$/;

function normaliseLayers(sheet, log) {
  const seen = new Map();
  const layers = [];

  sheet.rows.forEach((row, i) => {
    const where = { sheet: SHEET_LABEL[SHEET_KIND.LAYERS], row: i + 2 };
    const code = toText(row.Code)?.toUpperCase() || null;
    if (!code) {
      log.error('layer.missing-code', `Row ${i + 2} has no layer Code and cannot be used.`, where);
      return;
    }
    if (seen.has(code)) {
      log.error('layer.duplicate-code', `Layer code "${code}" appears more than once.`, { ...where, field: 'Code' });
      return;
    }

    const layer = {
      id: toNumber(row.Id),
      code,
      layerName: toText(row.LayerName) || code,
      catalogueThicknessMm: toNumber(row.ThicknessMm),
      materialType: toText(row.MaterialType),
      defaultColorHex: toText(row.DefaultColorHex),
      sortOrder: toNumber(row.SortOrder) ?? layers.length + 1,
    };

    if (layer.catalogueThicknessMm === null) {
      log.warn('layer.no-thickness', `Layer "${code}" has no catalogue thickness.`, { ...where, field: 'ThicknessMm' });
    }
    seen.set(code, layer);
    layers.push(layer);
  });

  layers.sort((a, b) => a.sortOrder - b.sortOrder);
  return layers;
}

function normaliseChainages(sheet, log) {
  const seen = new Set();
  const chainages = [];

  sheet.rows.forEach((row, i) => {
    const where = { sheet: SHEET_LABEL[SHEET_KIND.CHAINAGES], row: i + 2 };
    const id = toNumber(row.Id);
    if (id === null) {
      log.error('chainage.missing-id', `Row ${i + 2} has no Id.`, where);
      return;
    }
    if (seen.has(id)) {
      log.error('chainage.duplicate-id', `Chainage Id ${id} appears more than once.`, { ...where, field: 'Id' });
      return;
    }
    seen.add(id);

    const latitude = toNumber(row.Latitude);
    const longitude = toNumber(row.Longitude);
    if (latitude !== null && (latitude < -90 || latitude > 90)) {
      log.error('chainage.bad-latitude', `Chainage ${id}: latitude ${latitude} is out of range.`, { ...where, field: 'Latitude' });
    }
    if (longitude !== null && (longitude < -180 || longitude > 180)) {
      log.error('chainage.bad-longitude', `Chainage ${id}: longitude ${longitude} is out of range.`, { ...where, field: 'Longitude' });
    }
    if (latitude === null || longitude === null) {
      log.warn('chainage.no-coordinates', `Chainage ${id} has no coordinates, so it cannot be placed on the map.`, where);
    }

    chainages.push({
      id,
      chainageStart: toNumber(row.ChainageStart),
      chainageEnd: toNumber(row.ChainageEnd),
      kmLabel: toText(row.KmLabel),
      sectionName: toText(row.SectionName),
      latitude,
      longitude,
      elevationM: toNumber(row.Elevation),
      terrainType: toText(row.TerrainType),
    });
  });

  chainages.sort((a, b) => a.id - b.id);
  return chainages;
}

function normaliseProgress(sheet, log) {
  const seen = new Map();
  const progress = [];

  sheet.rows.forEach((row, i) => {
    const where = { sheet: SHEET_LABEL[SHEET_KIND.PROGRESS], row: i + 2 };

    const chainageId = toNumber(row.ChainageId);
    const layerCode = toText(row.LayerCode)?.toUpperCase() || null;

    if (chainageId === null) {
      log.error('progress.missing-chainage', `Row ${i + 2} has no ChainageId.`, where);
      return;
    }
    if (!layerCode) {
      log.error('progress.missing-layer-code', `Row ${i + 2} has no LayerCode.`, where);
      return;
    }

    // `Id` restarts at 1 for every chainage, so it is a layer ordinal rather than
    // a key. (ChainageId, LayerCode) is what actually identifies a row.
    const key = `${chainageId}:${layerCode}`;
    if (seen.has(key)) {
      log.error('progress.duplicate-key', `Chainage ${chainageId} / ${layerCode} appears twice (rows ${seen.get(key)} and ${i + 2}).`, where);
      return;
    }
    seen.set(key, i + 2);

    const rawStatus = toText(row.Status);
    const status = normaliseStatus(rawStatus);
    if (rawStatus && !status) {
      log.error('progress.unknown-status', `Chainage ${chainageId} / ${layerCode}: status "${rawStatus}" is not one of ${STATUSES.join(', ')}.`, { ...where, field: 'Status' });
    } else if (rawStatus && rawStatus !== status) {
      log.info('progress.status-normalised', `"${rawStatus}" normalised to "${status}".`, { ...where, field: 'Status' });
    }

    let progressPercent = toNumber(row.ProgressPercent);
    if (progressPercent !== null && (progressPercent < 0 || progressPercent > 100)) {
      log.error('progress.percent-range', `Chainage ${chainageId} / ${layerCode}: ProgressPercent ${progressPercent} is outside 0–100.`, { ...where, field: 'ProgressPercent' });
      progressPercent = Math.min(100, Math.max(0, progressPercent));
    }

    const budgetCost = toNumber(row.BudgetCost);
    const actualCost = toNumber(row.ActualCost);
    const costVariance = toNumber(row.CostVariance);

    // The exports use Actual − Budget, so an overspend reads positive. That is the
    // opposite sign to the EVM CV the dashboard computes, hence both are kept.
    if (budgetCost !== null && actualCost !== null && costVariance !== null) {
      const expected = actualCost - budgetCost;
      if (Math.abs(expected - costVariance) > 0.5) {
        log.warn('progress.cost-variance-mismatch', `Chainage ${chainageId} / ${layerCode}: CostVariance ${costVariance} is neither Actual − Budget (${expected}) nor Budget − Actual (${-expected}).`, { ...where, field: 'CostVariance' });
      }
    }

    const ifcRef = toText(row.LayerId);
    if (ifcRef && !IFC_GUID.test(ifcRef)) {
      log.warn('progress.bad-ifc-ref', `Chainage ${chainageId} / ${layerCode}: LayerId "${ifcRef}" is not a 22-character IFC GlobalId.`, { ...where, field: 'LayerId' });
    }
    if (!ifcRef) {
      log.warn('progress.no-ifc-ref', `Chainage ${chainageId} / ${layerCode} has no LayerId, so it can only be matched by position.`, { ...where, field: 'LayerId' });
    }

    const record = {
      key,
      chainageId,
      layerCode,
      layerOrdinal: toNumber(row.Id),
      layerNameInSheet: toText(row.LayerName),

      // Resolved against the IFC in phase 2; kind is unknown until then because
      // the GUID may name either an element or an IfcGroup of elements.
      ifcRef,
      ifcRefKind: null,
      matchStrategy: null,

      status,
      rawStatus,
      progressPercent,

      plannedStartDate: toIsoDate(row.PlannedStartDate),
      plannedEndDate: toIsoDate(row.PlannedEndDate),
      actualStartDate: toIsoDate(row.ActualStartDate),
      actualEndDate: toIsoDate(row.ActualEndDate),

      budgetCost,
      actualCost,
      costVariance,
      delayDays: toNumber(row.DelayDays),

      // Kept for reference only — the IFC layer set overrides it (resolveThickness).
      excelDesignThicknessMm: toNumber(row.DesignThicknessMm),
      levelColorHex: toText(row.LevelColorHex),

      updatedBy: toText(row.UpdatedBy),
      updatedAt: toIsoDateTime(row.UpdatedAt),
    };

    validateRowConsistency(record, log, where);
    progress.push(record);
  });

  progress.sort((a, b) => a.chainageId - b.chainageId || (a.layerOrdinal ?? 0) - (b.layerOrdinal ?? 0));
  return progress;
}

/** Cross-field checks that do not depend on other sheets. */
function validateRowConsistency(r, log, where) {
  const id = `Chainage ${r.chainageId} / ${r.layerCode}`;

  if (r.status === 'Completed' && r.progressPercent !== null && r.progressPercent < 100) {
    log.warn('progress.completed-under-100', `${id} is Completed but only ${r.progressPercent}%.`, where);
  }
  if (r.status === 'Not Started' && r.progressPercent > 0) {
    log.warn('progress.not-started-over-0', `${id} is Not Started but shows ${r.progressPercent}%.`, where);
  }
  if (r.status === 'Completed' && !r.actualEndDate) {
    log.warn('progress.completed-no-end-date', `${id} is Completed but has no actual end date.`, where);
  }
  if (r.status === 'Delayed' && (r.delayDays === null || r.delayDays === 0)) {
    log.warn('progress.delayed-no-days', `${id} is Delayed but DelayDays is ${r.delayDays === null ? 'empty' : 0}.`, where);
  }
  if (r.plannedStartDate && r.plannedEndDate && r.plannedStartDate > r.plannedEndDate) {
    log.error('progress.planned-dates-reversed', `${id}: planned start ${r.plannedStartDate} is after planned end ${r.plannedEndDate}.`, where);
  }
  if (r.actualStartDate && r.actualEndDate && r.actualStartDate > r.actualEndDate) {
    log.error('progress.actual-dates-reversed', `${id}: actual start ${r.actualStartDate} is after actual end ${r.actualEndDate}.`, where);
  }
  if (r.actualEndDate && !r.actualStartDate) {
    log.warn('progress.end-without-start', `${id} has an actual end date but no actual start date.`, where);
  }
}

function normaliseMetrics(sheet, log) {
  if (!sheet.rows.length) return null;
  if (sheet.rows.length > 1) {
    log.warn('metrics.multiple-rows', `Project metrics has ${sheet.rows.length} rows; using the first.`, { sheet: SHEET_LABEL[SHEET_KIND.METRICS] });
  }
  const row = sheet.rows[0];
  return {
    id: toNumber(row.Id),
    totalKmTarget: toNumber(row.TotalKmTarget),
    totalKmCompleted: toNumber(row.TotalKmCompleted),
    overallProgressPercent: toNumber(row.OverallProgressPercent),
    spi: toNumber(row.SchedulePerformanceIndex),
    cpi: toNumber(row.CostPerformanceIndex),
    totalBudgetCost: toNumber(row.TotalBudgetCost),
    totalActualCost: toNumber(row.TotalActualCost),
    delayedSectionsCount: toNumber(row.DelayedSectionsCount),
    calculatedAt: toIsoDateTime(row.CalculatedAt),
  };
}

/* ------------------------------------------------------------------ *
 * Cross-sheet validation
 * ------------------------------------------------------------------ */

function validateAcrossSheets({ chainages, layers, progress, metrics }, log) {
  const layerByCode = new Map(layers.map((l) => [l.code, l]));
  const chainageIds = new Set(chainages.map((c) => c.id));
  const driftReported = new Set();

  for (const row of progress) {
    const where = { sheet: SHEET_LABEL[SHEET_KIND.PROGRESS] };

    if (layers.length && !layerByCode.has(row.layerCode)) {
      log.error('progress.unknown-layer-code', `Chainage ${row.chainageId}: layer code "${row.layerCode}" is not in the layer catalogue (${[...layerByCode.keys()].join(', ')}).`, where);
    }
    if (chainages.length && !chainageIds.has(row.chainageId)) {
      log.error('progress.unknown-chainage', `Progress references chainage ${row.chainageId}, which is not in the chainage sheet.`, where);
    }

    // Names drift between the two sheets ("Base Course" vs "Base cource"), so the
    // join is on Code alone and the mismatch is only reported.
    const catalogue = layerByCode.get(row.layerCode);
    if (catalogue && row.layerNameInSheet && catalogue.layerName && !driftReported.has(row.layerCode)) {
      const a = row.layerNameInSheet.toLowerCase().replace(/[^a-z]/g, '');
      const b = catalogue.layerName.toLowerCase().replace(/[^a-z]/g, '');
      if (a !== b && !b.includes(a) && !a.includes(b)) {
        driftReported.add(row.layerCode);
        log.info('progress.layer-name-drift', `Layer ${row.layerCode} is "${row.layerNameInSheet}" in progress but "${catalogue.layerName}" in the catalogue; matched on code.`, where);
      }
    }
  }

  // Chainages with no progress at all, and layers never referenced.
  for (const c of chainages) {
    if (progress.length && !progress.some((p) => p.chainageId === c.id)) {
      log.warn('chainage.no-progress', `Chainage ${c.id} (${c.kmLabel || 'unlabelled'}) has no progress rows.`, { sheet: SHEET_LABEL[SHEET_KIND.CHAINAGES] });
    }
  }
  for (const l of layers) {
    if (progress.length && !progress.some((p) => p.layerCode === l.code)) {
      log.warn('layer.no-progress', `Layer ${l.code} is in the catalogue but has no progress rows.`, { sheet: SHEET_LABEL[SHEET_KIND.LAYERS] });
    }
  }

  // Roll-up reconciliation: the metrics sheet should agree with the detail.
  if (metrics && progress.length) {
    const budget = progress.reduce((s, r) => s + (r.budgetCost || 0), 0);
    const actual = progress.reduce((s, r) => s + (r.actualCost || 0), 0);
    const where = { sheet: SHEET_LABEL[SHEET_KIND.METRICS] };

    if (metrics.totalBudgetCost !== null && Math.abs(metrics.totalBudgetCost - budget) > 0.5) {
      log.warn('metrics.budget-mismatch', `Project metrics budget ${metrics.totalBudgetCost} does not match the sum of progress rows (${budget}).`, where);
    }
    if (metrics.totalActualCost !== null && Math.abs(metrics.totalActualCost - actual) > 0.5) {
      log.warn('metrics.actual-mismatch', `Project metrics actual ${metrics.totalActualCost} does not match the sum of progress rows (${actual}).`, where);
    }

    const delayed = progress.filter((r) => r.status === 'Delayed').length;
    if (metrics.delayedSectionsCount !== null && metrics.delayedSectionsCount !== delayed) {
      log.warn('metrics.delayed-count-mismatch', `Project metrics reports ${metrics.delayedSectionsCount} delayed sections; the progress rows contain ${delayed}.`, where);
    }
  }
}

/* ------------------------------------------------------------------ *
 * Entry point
 * ------------------------------------------------------------------ */

/**
 * Normalises every recognised sheet across one or more workbooks into a single
 * dataset. Sheets may arrive in any order and split across any number of files;
 * a multi-sheet workbook works just as well as four separate ones.
 */
export function buildImport(sheets, { ifcLayers = [] } = {}) {
  const log = createIssueLog();
  const byKind = new Map();

  for (const sheet of sheets) {
    if (sheet.droppedColumns.length) {
      log.info('sheet.unnamed-columns', `Ignored ${sheet.droppedColumns.length} unnamed column(s) in ${sheet.fileName || sheet.name}.`, { sheet: sheet.name });
    }
    if (sheet.kind === SHEET_KIND.UNKNOWN) {
      log.warn('sheet.unrecognised', `Sheet "${sheet.name}" in ${sheet.fileName || 'the workbook'} does not match any known layout and was skipped.`, { sheet: sheet.name });
      continue;
    }
    if (byKind.has(sheet.kind)) {
      log.warn('sheet.duplicate-kind', `More than one ${SHEET_LABEL[sheet.kind]} sheet was supplied; using "${byKind.get(sheet.kind).name}".`, { sheet: sheet.name });
      continue;
    }
    byKind.set(sheet.kind, sheet);
  }

  const layersSheet = byKind.get(SHEET_KIND.LAYERS);
  const chainagesSheet = byKind.get(SHEET_KIND.CHAINAGES);
  const progressSheet = byKind.get(SHEET_KIND.PROGRESS);
  const metricsSheet = byKind.get(SHEET_KIND.METRICS);

  const layers = layersSheet ? normaliseLayers(layersSheet, log) : [];
  const chainages = chainagesSheet ? normaliseChainages(chainagesSheet, log) : [];
  const progress = progressSheet ? normaliseProgress(progressSheet, log) : [];
  const metrics = metricsSheet ? normaliseMetrics(metricsSheet, log) : null;

  // The older single-sheet template (Chainage_Start / Layer_Code / Progress_Percent)
  // is still accepted; it is handed back untouched for the legacy code path.
  const legacySheet = byKind.get(SHEET_KIND.LEGACY_PROGRESS) || null;

  if (!progressSheet && legacySheet) {
    log.info('import.legacy-template', `"${legacySheet.name}" uses the older progress template; importing it through the template path.`, { sheet: legacySheet.name });
  } else if (!progressSheet) {
    log.error('import.no-progress-sheet', 'No LayerProgress sheet was supplied — there is nothing to apply to the model.', {});
  }
  if (!layersSheet) {
    log.warn('import.no-layer-sheet', 'No RoadLayer sheet was supplied; layer names and catalogue thicknesses will be missing.', {});
  }
  if (!chainagesSheet) {
    log.warn('import.no-chainage-sheet', 'No Road_chainage sheet was supplied; the map cannot be georeferenced from Excel.', {});
  }

  validateAcrossSheets({ chainages, layers, progress, metrics }, log);

  // Pair the sheet's layers with the modelled ones by structural role, and settle
  // each thickness in favour of the IFC. Skipped when no model is loaded yet —
  // the import still succeeds and reconciles when the model arrives.
  const reconciliation = reconcileLayerCodes(layers, ifcLayers);
  for (const issue of reconciliation.issues) log.issues.push(issue);

  const thicknessReported = new Set();
  for (const row of progress) {
    const match = reconciliation.map.get(row.layerCode);
    row.role = match?.role ?? classifyLayerRole(row.layerNameInSheet, row.layerCode);
    row.modelLayerCode = match?.ifcLayer?.code ?? null;
    row.thicknessMm = match?.thicknessMm ?? row.excelDesignThicknessMm ?? null;
    row.thicknessSource = match?.source ?? (row.excelDesignThicknessMm !== null ? 'excel' : null);

    // One note per layer, not per row — the override is a property of the layer.
    if (match?.source === 'ifc' && row.excelDesignThicknessMm !== null
        && row.excelDesignThicknessMm !== match.thicknessMm && !thicknessReported.has(row.layerCode)) {
      thicknessReported.add(row.layerCode);
      log.info(
        'progress.thickness-overridden',
        `Layer ${row.layerCode}: DesignThicknessMm ${row.excelDesignThicknessMm} superseded by the modelled ${match.thicknessMm} mm.`,
        { sheet: SHEET_LABEL[SHEET_KIND.PROGRESS], field: 'DesignThicknessMm' }
      );
    }
  }

  const errors = log.issues.filter((i) => i.level === LEVEL.ERROR);
  const warnings = log.issues.filter((i) => i.level === LEVEL.WARNING);

  return {
    chainages,
    layers,
    progress,
    metrics,
    reconciliation,
    legacySheet,
    issues: log.issues,
    counts: {
      chainages: chainages.length,
      layers: layers.length,
      progress: progress.length,
      metrics: metrics ? 1 : 0,
      errors: errors.length,
      warnings: warnings.length,
      infos: log.issues.length - errors.length - warnings.length,
    },
    sheetsSeen: [...byKind.keys()],
    /** Nothing is written while an error stands. */
    ok: errors.length === 0 && (progress.length > 0 || Boolean(legacySheet)),
  };
}

/** Convenience: files (or ArrayBuffers) straight to a validated dataset. */
export async function importWorkbookFiles(files, options = {}) {
  const sheets = [];
  const log = createIssueLog();

  for (const file of files) {
    try {
      sheets.push(...(await readWorkbookFile(file)));
    } catch (err) {
      log.error('file.unreadable', err.message, { sheet: file.name });
    }
  }

  const result = buildImport(sheets, options);
  result.issues = [...log.issues, ...result.issues];
  result.counts.errors += log.issues.length;
  if (log.issues.length) result.ok = false;
  return result;
}

/* ------------------------------------------------------------------ *
 * Bridge to the existing progress store
 * ------------------------------------------------------------------ */

/**
 * Flattens the normalised import into the shape `RoadDataContext.progressData`
 * already uses, so the dashboard, 3D tint and analytics keep working unchanged
 * while phases 2–3 land.
 *
 * `chainageToKm` maps a ChainageId onto the kilometre index the rest of the app
 * keys on; without a chainage sheet it falls back to `id - 1`.
 */
export function toProgressRows({ chainages, progress }) {
  const kmById = new Map(
    chainages.map((c) => [c.id, c.chainageStart ?? c.id - 1])
  );

  return progress.map((r) => ({
    km: kmById.get(r.chainageId) ?? r.chainageId - 1,
    chainageId: r.chainageId,
    // The model's own code, so downstream code-matching lands on the right layer.
    // `BC` in the sheet is the base course; in the model it is the wearing course.
    layerCode: r.modelLayerCode || r.layerCode,
    sheetLayerCode: r.layerCode,
    role: r.role,
    thicknessMm: r.thicknessMm,
    thicknessSource: r.thicknessSource,
    status: r.status,
    progressPercent: r.progressPercent ?? 0,
    budgetCost: r.budgetCost ?? 0,
    actualCost: r.actualCost ?? 0,
    // Normalised to the EVM sign the dashboard expects: negative means overspent.
    costVariance: r.budgetCost !== null && r.actualCost !== null ? r.budgetCost - r.actualCost : (r.costVariance ?? 0),
    targetDate: r.plannedEndDate,
    delayDays: r.delayDays ?? 0,
    ifcRef: r.ifcRef,
    excelDesignThicknessMm: r.excelDesignThicknessMm,
  }));
}
