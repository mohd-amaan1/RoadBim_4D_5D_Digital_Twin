/**
 * Derives dashboard figures for an uploaded IFC model.
 *
 * The rule throughout: anything the IFC genuinely contains (geometry, materials,
 * layer thicknesses, element counts, georeferencing) is reported as a real value.
 * Anything schedule-, progress- or cost-related is NOT in a design model, so it is
 * returned as `null` and rendered as "—" until an Excel sheet supplies it.
 */

/** Renders a nullable metric: real values pass through, unknowns become an em dash. */
export function display(value, { suffix = '', digits = 0, fallback = '—' } = {}) {
  if (value === null || value === undefined || Number.isNaN(value)) return fallback;
  const num = typeof value === 'number' ? value.toFixed(digits) : value;
  return `${num}${suffix}`;
}

/** Human-friendly length: sub-kilometre models read in metres, longer ones in km. */
export function formatLength(metres) {
  if (metres === null || metres === undefined) return { value: '—', unit: '' };
  if (metres < 1000) return { value: metres.toFixed(metres < 100 ? 1 : 0), unit: 'm' };
  return { value: (metres / 1000).toFixed(2), unit: 'KM' };
}

const STATUS_PRIORITY = ['Delayed', 'In-Progress', 'Not Started', 'Completed'];

/** Worst-case wins, so a single delayed segment surfaces at layer level. */
function rollUpStatus(statuses) {
  for (const candidate of STATUS_PRIORITY) {
    if (statuses.includes(candidate)) return candidate;
  }
  return statuses[0] || null;
}

/**
 * Attaches Excel progress rows to IFC-derived layers.
 *
 * With a `resolution` (phase 2) each row is already bound to specific elements, so
 * a layer's figures come from the rows that actually describe its elements. That
 * is strictly better than code matching, which cannot tell one segment from
 * another and mis-binds outright when codes collide (`BC` is the base course in
 * the spreadsheets and the wearing course in the model).
 *
 * Without a resolution it falls back to matching on the layer code or name.
 */
export function mergeLayersWithProgress(ifcLayers, progressData, excelApplied, resolution) {
  if (!ifcLayers) return [];

  const blank = (layer) => ({
    ...layer,
    status: null,
    progressPercent: null,
    matchedRows: 0,
    boundElements: 0,
    matchStrategies: [],
    thicknessSource: 'ifc',
  });

  if (resolution?.byExpressID?.size) {
    // expressID -> layer, so each bound element can be attributed to its layer
    const layerByExpressID = new Map();
    for (const [expressID, match] of resolution.byExpressID) {
      for (const el of match.elements) {
        if (el.expressID === expressID) layerByExpressID.set(expressID, el.layerCode);
      }
    }

    return ifcLayers.map((layer) => {
      const bound = [];
      for (const [expressID, match] of resolution.byExpressID) {
        if (layerByExpressID.get(expressID) === layer.code) bound.push(match);
      }
      if (!bound.length) return blank(layer);

      // Averaged per element, so a layer half-built across the road reads as half
      // done rather than being dominated by whichever row happens to be first.
      const withProgress = bound.filter((m) => m.row.progressPercent !== null);
      const progressPercent = withProgress.length
        ? withProgress.reduce((s, m) => s + m.row.progressPercent, 0) / withProgress.length
        : null;

      const rowKeys = new Set(bound.map((m) => m.row.key));

      return {
        ...layer,
        status: rollUpStatus(bound.map((m) => m.row.status).filter(Boolean)),
        progressPercent: progressPercent === null ? null : Math.round(progressPercent * 10) / 10,
        matchedRows: rowKeys.size,
        boundElements: bound.length,
        matchStrategies: [...new Set(bound.map((m) => m.strategy))],
        thicknessSource: 'ifc',
      };
    });
  }

  if (!excelApplied || !progressData?.length) return ifcLayers.map(blank);

  return ifcLayers.map((layer) => {
    const code = String(layer.code || '').toUpperCase();
    const name = String(layer.name || '').toUpperCase();

    const rows = progressData.filter((row) => {
      const rowCode = String(row.layerCode || '').trim().toUpperCase();
      return rowCode === code || rowCode === name;
    });

    if (!rows.length) return blank(layer);

    const progressPercent =
      rows.reduce((sum, r) => sum + (Number(r.progressPercent) || 0), 0) / rows.length;

    return {
      ...layer,
      status: rollUpStatus(rows.map((r) => r.status).filter(Boolean)),
      progressPercent: Math.round(progressPercent * 10) / 10,
      matchedRows: rows.length,
      boundElements: 0,
      matchStrategies: [],
      thicknessSource: 'ifc',
    };
  });
}

/**
 * Per-segment layer state, for the chainage heatmap and analytics. Only available
 * once rows are bound to elements — before that there is no way to know which part
 * of the road a row refers to.
 */
function deriveSegments(resolution) {
  if (!resolution?.byExpressID?.size) return null;

  const byChainage = new Map();
  for (const [, match] of resolution.byExpressID) {
    const { chainageId, layerCode, status, progressPercent, budgetCost, actualCost } = match.row;
    // A bridge register has no chainage, so there is no chainage × layer grid to draw —
    // one row keyed on null would render as a meaningless "chnull" line in the matrix.
    if (chainageId === null || chainageId === undefined) continue;
    if (!byChainage.has(chainageId)) {
      byChainage.set(chainageId, { chainageId, segmentIndex: match.segmentIndex, rows: new Map() });
    }
    byChainage.get(chainageId).rows.set(layerCode, {
      layerCode, status, progressPercent, budgetCost, actualCost, strategy: match.strategy,
    });
  }

  return [...byChainage.values()]
    .sort((a, b) => a.chainageId - b.chainageId)
    .map((seg) => {
      const layers = [...seg.rows.values()];
      const measured = layers.filter((l) => l.progressPercent !== null);
      return {
        chainageId: seg.chainageId,
        segmentIndex: seg.segmentIndex,
        layers,
        status: rollUpStatus(layers.map((l) => l.status).filter(Boolean)),
        progressPercent: measured.length
          ? Math.round((measured.reduce((s, l) => s + l.progressPercent, 0) / measured.length) * 10) / 10
          : null,
      };
    });
}

/** Earned-value roll-up. Returns nulls unless the sheet carried cost columns. */
function deriveCostMetrics(progressData, excelApplied) {
  const empty = { pv: null, ev: null, ac: null, cv: null, cpi: null, spi: null, hasCostData: false };
  if (!excelApplied || !progressData?.length) return empty;

  const rows = progressData.filter((r) => Number(r.budgetCost) > 0 || Number(r.actualCost) > 0);
  if (!rows.length) return empty;

  const pv = rows.reduce((s, r) => s + (Number(r.budgetCost) || 0), 0);
  const ac = rows.reduce((s, r) => s + (Number(r.actualCost) || 0), 0);
  const ev = rows.reduce(
    (s, r) => s + (Number(r.budgetCost) || 0) * ((Number(r.progressPercent) || 0) / 100),
    0
  );

  // SPI needs a time baseline. The only one the sheet carries is Target_Date, so
  // planned value to date = budget of everything that should already have finished.
  const today = new Date();
  const plannedToDate = rows.reduce((s, r) => {
    const target = r.targetDate ? new Date(r.targetDate) : null;
    const due = target && !Number.isNaN(target.getTime()) && target <= today;
    return s + (due ? Number(r.budgetCost) || 0 : 0);
  }, 0);

  return {
    pv,
    ev,
    ac,
    cv: ev - ac,
    cpi: ac > 0 ? Number((ev / ac).toFixed(2)) : null,
    spi: plannedToDate > 0 ? Number((ev / plannedToDate).toFixed(2)) : null,
    hasCostData: true,
  };
}

/**
 * Top-level dashboard model. `modelMode` false means no IFC is loaded and the
 * existing demo dataset drives the UI unchanged.
 */
export function deriveModelMetrics({ ifcSummary, progressData, excelApplied, resolution }) {
  if (!ifcSummary) return { modelMode: false };

  const layers = mergeLayersWithProgress(ifcSummary.layers, progressData, excelApplied, resolution);
  const measured = layers.filter((l) => l.progressPercent !== null);
  const segments = deriveSegments(resolution);

  // A bridge register has no planned total to measure against: it lists work executed,
  // and only the few rows that complete a modelled piece name an element. Averaging those
  // few verdicts would print "80%" for a structure whose register is mostly unfinished,
  // so the figure is left unknown — shown as "—", the same as a cost index with no costs.
  const isBridge = Boolean(resolution?.bridge);

  const overallProgressPercent = measured.length && !isBridge
    ? Math.round((measured.reduce((s, l) => s + l.progressPercent, 0) / measured.length) * 10) / 10
    : null;

  const delayFlags = measured.length ? layers.filter((l) => l.status === 'Delayed').length : null;
  const activeZones = measured.length ? layers.filter((l) => l.status === 'In-Progress').length : null;
  const completedLayers = measured.length ? layers.filter((l) => l.status === 'Completed').length : null;

  const cost = deriveCostMetrics(progressData, excelApplied);

  return {
    modelMode: true,
    summary: ifcSummary,
    layers,
    segments,

    // How progress reached the model: per element once the resolver has run,
    // otherwise one colour for a whole layer.
    binding: resolution
      ? {
          mode: 'element',
          resolvedPercent: resolution.report.resolvedPercent,
          covered: resolution.report.coverage.covered,
          elements: resolution.report.coverage.elements,
          counts: resolution.report.counts,
          direction: resolution.report.direction,
        }
      : { mode: measured.length ? 'layer' : 'none' },

    // --- straight from the model ---
    corridorLengthM: ifcSummary.corridorLengthM,
    corridorWidthM: ifcSummary.corridorWidthM,
    elementCount: ifcSummary.elementCount,
    layerCount: layers.length,
    totalThicknessMm: ifcSummary.totalThicknessMm,

    // --- only knowable from an Excel upload ---
    overallProgressPercent,
    delayFlags,
    activeZones,
    completedLayers,
    ...cost,

    awaitingExcel: !measured.length,
    bridge: isBridge,
  };
}
