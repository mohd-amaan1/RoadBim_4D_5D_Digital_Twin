/**
 * Phase 4 — the bridge between persisted rows and the in-memory shapes phases 1–3 use.
 *
 * The rule throughout: what comes back from the database is the *source* data — progress
 * rows and their bindings. Everything derived (layer roll-ups, the segment matrix, KPIs,
 * thickness precedence, material colours) is recomputed by the same functions that
 * computed it before, so a restored session cannot disagree with a freshly imported one.
 */

import { STRATEGY, STRATEGY_CONFIDENCE, resolveProgressToModel } from './ifcResolver.js';
import { classifyLayerRole, reconcileLayerCodes } from './excelImport.js';

/* ------------------------------------------------------------------ *
 * API rows -> the shapes buildImport() produces
 * ------------------------------------------------------------------ */

const asDate = (v) => (v ? String(v).slice(0, 10) : null);
const asNum = (v) => (v === null || v === undefined ? null : Number(v));

export function adaptChainages(rows = []) {
  return rows.map((r) => ({
    id: r.id,
    chainageStart: asNum(r.chainageStart),
    chainageEnd: asNum(r.chainageEnd),
    kmLabel: r.kmLabel,
    sectionName: r.sectionName,
    latitude: asNum(r.latitude),
    longitude: asNum(r.longitude),
    elevationM: asNum(r.elevationM),
    terrainType: r.terrainType,
  }));
}

export function adaptLayers(rows = []) {
  return rows.map((r) => ({
    id: r.id,
    code: r.code,
    layerName: r.layerName,
    catalogueThicknessMm: asNum(r.catalogueThicknessMm),
    materialType: r.materialType,
    defaultColorHex: r.defaultColorHex,
    sortOrder: r.sortOrder,
  }));
}

export function adaptProgress(rows = []) {
  return rows.map((r) => ({
    key: r.key || `${r.chainageId}:${r.layerCode}`,
    dbId: r.id,
    chainageId: r.chainageId,
    layerCode: r.layerCode,
    layerNameInSheet: r.layerNameInSheet,
    // The workbook cell, restored so a re-resolve can still match on GlobalId. Dropping
    // it made every row fall back to positional matching whenever bindings were absent.
    ifcRef: r.ifcRef ?? null,
    status: r.status,
    rawStatus: r.rawStatus,
    progressPercent: asNum(r.progressPercent),
    plannedStartDate: asDate(r.plannedStartDate),
    plannedEndDate: asDate(r.plannedEndDate),
    actualStartDate: asDate(r.actualStartDate),
    actualEndDate: asDate(r.actualEndDate),
    budgetCost: asNum(r.budgetCost),
    actualCost: asNum(r.actualCost),
    costVariance: asNum(r.costVariance),
    delayDays: asNum(r.delayDays),
    excelDesignThicknessMm: asNum(r.excelDesignThicknessMm),
    levelColorHex: r.levelColorHex,
    updatedBy: r.updatedBy,
    updatedAt: r.updatedAt,
  }));
}

/**
 * Rebuilds the dataset `buildImport()` would have produced, then re-runs the layer-role
 * reconciliation so thickness precedence is applied against the freshly loaded model
 * rather than being read back from storage. The IFC keeps winning, and the winning value
 * is never persisted, so it cannot go stale.
 */
export function adaptImportedDataset({ chainages, layers, progress }, ifcLayers = []) {
  const adaptedLayers = adaptLayers(layers);
  const adaptedProgress = adaptProgress(progress);
  const reconciliation = reconcileLayerCodes(adaptedLayers, ifcLayers);

  for (const row of adaptedProgress) {
    const match = reconciliation.map.get(row.layerCode);
    row.role = match?.role ?? classifyLayerRole(row.layerNameInSheet, row.layerCode);
    row.modelLayerCode = match?.ifcLayer?.code ?? null;
    row.thicknessMm = match?.thicknessMm ?? row.excelDesignThicknessMm ?? null;
    row.thicknessSource = match?.source ?? (row.excelDesignThicknessMm !== null ? 'excel' : null);
  }

  return {
    chainages: adaptChainages(chainages),
    layers: adaptedLayers,
    progress: adaptedProgress,
    metrics: null,
    reconciliation,
    issues: [],
    counts: {
      chainages: chainages?.length || 0,
      layers: layers?.length || 0,
      progress: progress?.length || 0,
      metrics: 0,
      errors: 0,
      warnings: 0,
      infos: 0,
    },
    sheetsSeen: [],
    ok: true,
    restored: true,
  };
}

/* ------------------------------------------------------------------ *
 * Persisted bindings -> the resolver's result shape
 * ------------------------------------------------------------------ */

/**
 * Reconstructs a resolution from stored bindings instead of resolving again.
 *
 * The join is on **GlobalId**, never the stored `ExpressId`: express ids are IFC line
 * numbers, stable only while the file bytes are identical, whereas GlobalId is designed
 * to survive a re-export. Any binding whose GlobalId is absent from the freshly parsed
 * model is reported stale, and the caller can fall back to a full re-resolve — the same
 * drift path phase 2 already handles.
 *
 * Returns null when there is nothing usable to hydrate from, so the caller can resolve.
 */
export function hydrateResolution({ progress = [], bindings = [], summary } = {}) {
  const elements = summary?.elementIndex || [];
  if (!elements.length || !bindings.length) return null;

  const elementByGuid = new Map(elements.filter((e) => e.globalId).map((e) => [e.globalId, e]));
  for (const el of elements) {
    if (el.role === undefined) el.role = classifyLayerRole(el.layerName, el.layerCode);
  }

  const rowByKey = new Map(progress.map((r) => [r.key, r]));
  const rowByDbId = new Map(progress.filter((r) => r.dbId != null).map((r) => [r.dbId, r]));
  const rowByBusiness = new Map(progress.map((r) => [`${r.chainageId}:${r.layerCode}`, r]));

  const stale = [];

  // All of a row's bindings first, then one answer per row — never a merge of
  // disagreeing ones.
  const perRow = new Map();
  for (const b of bindings) {
    const row =
      rowByDbId.get(b.layerProgressId) ??
      rowByKey.get(b.key) ??
      rowByBusiness.get(`${b.chainageId}:${b.layerCode}`);
    if (!row) continue;

    const element = elementByGuid.get(b.ifcElementGlobalId);
    if (!element) {
      stale.push(b);
      continue;
    }

    if (!perRow.has(row.key)) perRow.set(row.key, { row, hits: [] });
    perRow.get(row.key).hits.push({ binding: b, element });
  }

  // Exact bindings silence weaker ones. A row carrying a GlobalId match AND a positional
  // guess is not extra information, it is a contradiction: the two point at different
  // stretches of road, and hydrating both once painted a single inspected kilometre onto
  // two segments of the plan map. The exact answer wins; the guess is reported, not drawn.
  const EXACT = new Set([STRATEGY.GUID, STRATEGY.GROUP]);
  const grouped = new Map();
  const overridden = [];

  for (const [key, { row, hits }] of perRow) {
    const exact = hits.filter((h) => EXACT.has(h.binding.strategy));
    const chosen = exact.length ? exact : hits;
    if (exact.length && exact.length < hits.length) overridden.push(row);

    const first = chosen[0];
    grouped.set(key, {
      row,
      strategy: first.binding.strategy,
      elements: chosen.map((h) => h.element),
      segmentIndex: first.binding.segmentIndex ?? first.element.segmentIndex ?? null,
      note: null,
    });
  }

  if (!grouped.size) return null;

  const matches = progress.map((row) => {
    const hit = grouped.get(row.key);
    if (hit) {
      if (hit.elements.length > 1 && hit.strategy === STRATEGY.GROUP) {
        hit.note = `restored group binding — ${hit.elements.length} elements`;
      }
      return hit;
    }
    return { row, strategy: STRATEGY.NONE, elements: [], segmentIndex: null, note: null };
  });

  const byExpressID = new Map();
  for (const m of matches) {
    for (const el of m.elements) if (!byExpressID.has(el.expressID)) byExpressID.set(el.expressID, m);
  }

  const counts = { guid: 0, group: 0, position: 0, name: 0, none: 0, total: matches.length };
  for (const m of matches) counts[m.strategy] = (counts[m.strategy] || 0) + 1;

  const uncovered = elements.filter((e) => !byExpressID.has(e.expressID));
  const alignment = summary?.alignment || null;

  const chainageToSegment = [...new Map(
    matches
      .filter((m) => m.segmentIndex !== null && m.segmentIndex !== undefined)
      .map((m) => [m.row.chainageId, m.segmentIndex])
  ).entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([chainageId, segmentIndex]) => {
      const seg = alignment?.segments?.[segmentIndex] || null;
      return {
        chainageId,
        segmentIndex,
        startM: seg?.startM ?? null,
        endM: seg?.endM ?? null,
        elementCount: seg?.expressIDs?.length ?? 0,
      };
    });

  const issues = [];
  if (overridden.length) {
    issues.push({
      level: 'warning',
      code: 'restore.conflicting-bindings',
      message: `${overridden.length} row(s) carried both an exact binding and a weaker positional one pointing elsewhere `
        + `(${overridden.slice(0, 4).map((r) => `${r.chainageId}/${r.layerCode}`).join(', ')}`
        + `${overridden.length > 4 ? ', …' : ''}). The exact binding was used; the rest were ignored.`,
    });
  }
  if (stale.length) {
    issues.push({
      level: 'warning',
      code: 'restore.stale-bindings',
      message: `${stale.length} stored binding(s) reference elements the loaded model no longer contains. Re-import or rebind to refresh them.`,
    });
  }
  if (counts.none) {
    issues.push({
      level: 'warning',
      code: 'restore.unbound-rows',
      message: `${counts.none} progress row(s) have no stored binding and will not tint anything.`,
    });
  }

  return {
    matches,
    byExpressID,
    restored: true,
    staleBindings: stale,
    direction: {
      map: new Map(chainageToSegment.map((c) => [c.chainageId, c.segmentIndex])),
      ascending: chainageToSegment.length < 2
        ? true
        : chainageToSegment[chainageToSegment.length - 1].segmentIndex >= chainageToSegment[0].segmentIndex,
      source: 'stored',
      ambiguous: false,
      anchorCount: chainageToSegment.length,
      siteImplied: null,
      agreesWithSite: null,
    },
    issues,
    report: {
      counts,
      resolvedPercent: counts.total ? Math.round(((counts.total - counts.none) / counts.total) * 100) : 0,
      coverage: { elements: elements.length, covered: byExpressID.size, uncovered: uncovered.length },
      uncoveredElements: uncovered.map((e) => ({
        expressID: e.expressID, globalId: e.globalId, name: e.name,
        layerName: e.layerName, segmentIndex: e.segmentIndex ?? null,
      })),
      unmatchedRows: matches
        .filter((m) => m.strategy === STRATEGY.NONE)
        .map((m) => ({ chainageId: m.row.chainageId, layerCode: m.row.layerCode, ifcRef: null })),
      chainageToSegment,
      direction: {
        source: 'stored', ascending: true, anchorCount: chainageToSegment.length,
        agreesWithSite: null, siteImplied: null,
      },
      alignment: alignment
        ? {
            axis: alignment.axis,
            lengthM: alignment.lengthM,
            segmentCount: alignment.segmentCount,
            segments: alignment.segments.map(({ expressIDs, ...s }) => ({
              ...s, elementCount: expressIDs.length,
            })),
          }
        : null,
    },
  };
}

/**
 * Restores a resolution from storage, falling back to a full re-resolve when the stored
 * bindings no longer fit the model (a re-export that reissued GlobalIds, say).
 */
export function restoreOrResolve({ progress, chainages, bindings, summary }) {
  const hydrated = hydrateResolution({ progress, bindings, summary });
  if (hydrated && hydrated.report.resolvedPercent > 0) return hydrated;

  const resolved = resolveProgressToModel({ progress, chainages, summary });
  resolved.issues = [
    {
      level: 'info',
      code: 'restore.re-resolved',
      message: 'No usable stored bindings for this model, so progress was matched again from scratch.',
    },
    ...resolved.issues,
  ];
  return resolved;
}

/* ------------------------------------------------------------------ *
 * In-memory shapes -> API payloads
 * ------------------------------------------------------------------ */

/** Everything the model-upload endpoint needs, extracted from a parsed summary. */
export function buildIfcMetadata(summary) {
  if (!summary) return null;
  const guidByExpressId = new Map((summary.elementIndex || []).map((e) => [e.expressID, e.globalId]));

  return {
    schemaName: summary.schema,
    lengthUnit: summary.lengthUnit,
    siteLatitude: summary.latitude,
    siteLongitude: summary.longitude,
    siteElevationM: summary.siteElevationM,
    elementCount: summary.elementCount,
    corridorLengthM: summary.corridorLengthM,
    corridorWidthM: summary.corridorWidthM,
    elements: (summary.elementIndex || []).map((e) => ({
      globalId: e.globalId,
      expressId: e.expressID,
      name: e.name,
      ifcType: e.ifcType,
      layerName: e.layerName,
      layerCode: e.layerCode,
      segmentIndex: e.segmentIndex ?? null,
      bboxMin: e.box?.min,
      bboxMax: e.box?.max,
    })),
    groups: (summary.groupIndex || []).map((g) => ({
      globalId: g.globalId,
      name: g.name,
      ifcType: g.ifcType,
      memberGlobalIds: g.memberExpressIDs.map((id) => guidByExpressId.get(id)).filter(Boolean),
    })),
    segments: (summary.alignment?.segments || []).map((s) => ({
      segmentIndex: s.index,
      startM: s.startM,
      endM: s.endM,
      centreM: s.centreM,
      elementCount: s.expressIDs.length,
    })),
    layers: (summary.layers || []).map((l) => ({
      layerName: l.name,
      layerCode: l.code,
      thicknessMm: l.thicknessMm,
      materialType: l.materialType,
      sortOrder: l.sortOrder,
    })),
  };
}

/** SHA-256 of a File, so the server can recognise a workbook it has already ingested. */
export async function hashFile(file) {
  const buffer = await file.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Turns a validated import plus its resolution into the request body the server stores.
 * Only source values travel — no roll-ups, no derived thickness, nothing from the viewer.
 */
export function buildImportPayload({ result, resolution, sheets = [], hashes = {}, mode = 'incremental' }) {
  const bindingsByKey = new Map();
  for (const m of resolution?.matches || []) {
    if (!m.elements?.length) continue;
    bindingsByKey.set(
      m.row.key,
      m.elements.map((e) => ({
        ifcElementGlobalId: e.globalId,
        sourceRef: m.row.ifcRef ?? null,
        sourceRefKind:
          m.strategy === STRATEGY.GROUP ? 'group' : m.strategy === STRATEGY.GUID ? 'element' : 'none',
        strategy: m.strategy,
        confidence: STRATEGY_CONFIDENCE[m.strategy] ?? null,
        segmentIndex: m.segmentIndex ?? null,
      }))
    );
  }

  return {
    mode,
    files: sheets.map((s) => ({
      fileName: s.fileName,
      sheetName: s.name,
      sheetKind: s.kind,
      rowCount: s.rows.length,
      contentSha256: hashes[s.fileName] ?? null,
      byteSize: 0,
    })),
    chainages: result.chainages.map((c) => ({
      id: c.id,
      chainageStart: c.chainageStart,
      chainageEnd: c.chainageEnd,
      kmLabel: c.kmLabel,
      sectionName: c.sectionName,
      latitude: c.latitude,
      longitude: c.longitude,
      elevationM: c.elevationM,
      terrainType: c.terrainType,
      sortOrder: c.id,
    })),
    layers: result.layers.map((l) => ({
      id: l.id,
      code: l.code,
      layerName: l.layerName,
      catalogueThicknessMm: l.catalogueThicknessMm,
      materialType: l.materialType,
      defaultColorHex: l.defaultColorHex,
      sortOrder: l.sortOrder,
    })),
    progress: result.progress.map((r) => ({
      key: r.key,
      chainageId: r.chainageId,
      layerCode: r.layerCode,
      rowNumber: r.sourceRowNumber ?? null,
      ifcRef: r.ifcRef ?? null,
      status: r.status,
      rawStatus: r.rawStatus,
      progressPercent: r.progressPercent,
      plannedStartDate: r.plannedStartDate,
      plannedEndDate: r.plannedEndDate,
      actualStartDate: r.actualStartDate,
      actualEndDate: r.actualEndDate,
      budgetCost: r.budgetCost,
      actualCost: r.actualCost,
      costVariance: r.costVariance,
      delayDays: r.delayDays,
      // The sheet's own value. The resolved thickness is deliberately NOT sent —
      // it is recomputed from the model every time so it cannot go stale.
      designThicknessMm: r.excelDesignThicknessMm,
      levelColorHex: r.levelColorHex,
      updatedBy: r.updatedBy,
      bindings: bindingsByKey.get(r.key) || [],
    })),
    metrics: result.metrics && {
      totalKmTarget: result.metrics.totalKmTarget,
      totalKmCompleted: result.metrics.totalKmCompleted,
      overallProgressPercent: result.metrics.overallProgressPercent,
      spi: result.metrics.spi,
      cpi: result.metrics.cpi,
      totalBudgetCost: result.metrics.totalBudgetCost,
      totalActualCost: result.metrics.totalActualCost,
      delayedSectionsCount: result.metrics.delayedSectionsCount,
      calculatedAt: result.metrics.calculatedAt,
    },
    issues: (result.issues || []).map((i) => ({
      level: i.level,
      code: i.code,
      message: i.message,
      sheet: i.sheet ?? null,
      row: i.row ?? null,
      field: i.field ?? null,
    })),
    summary: JSON.stringify(result.counts || {}),
  };
}
