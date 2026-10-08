/**
 * Phase 2 — resolving imported progress rows onto IFC elements.
 *
 * A row references the model by GlobalId, but that GlobalId may name either a
 * single element or a Revit model group holding several (the surface course is
 * two lane slabs per segment). It may also have gone stale, because Revit
 * reissues GlobalIds when an element is re-created.
 *
 * So rather than one lookup, four strategies are tried in order of confidence and
 * the winning one is recorded against every row. A stale GlobalId degrades to a
 * positional match with a warning instead of silently blanking the layer.
 *
 *   guid      row.ifcRef is an element GlobalId
 *   group     row.ifcRef is an IfcGroup GlobalId -> expand to its members
 *   position  (chainage -> segment) + layer role -> the elements in that segment
 *   name      element name contains the layer's role keyword
 *   none      unmatched; reported, never guessed at
 *
 * No React or DOM dependency, so it runs under Node for testing.
 */

import { classifyLayerRole, LEVEL } from './excelImport.js';

export const STRATEGY = {
  GUID: 'guid',
  GROUP: 'group',
  POSITION: 'position',
  NAME: 'name',
  NONE: 'none',
};

export const STRATEGY_LABEL = {
  [STRATEGY.GUID]: 'GlobalId',
  [STRATEGY.GROUP]: 'Model group',
  [STRATEGY.POSITION]: 'Segment + layer',
  [STRATEGY.NAME]: 'Element name',
  [STRATEGY.NONE]: 'Unmatched',
};

export const STRATEGY_CONFIDENCE = {
  [STRATEGY.GUID]: 'exact',
  [STRATEGY.GROUP]: 'exact',
  [STRATEGY.POSITION]: 'high',
  [STRATEGY.NAME]: 'medium',
  [STRATEGY.NONE]: null,
};

/* ------------------------------------------------------------------ *
 * Geodesy — only used to check the model against the chainage sheet
 * ------------------------------------------------------------------ */

const EARTH_R = 6371008.8;
const rad = (d) => (d * Math.PI) / 180;

function groundDistanceM(a, b) {
  if (!a || !b || a.latitude == null || b.latitude == null) return null;
  const dLon = rad(b.longitude - a.longitude) * Math.cos(rad((a.latitude + b.latitude) / 2));
  const dLat = rad(b.latitude - a.latitude);
  return Math.hypot(dLon, dLat) * EARTH_R;
}

/* ------------------------------------------------------------------ *
 * Direction — which end of the model is chainage zero
 * ------------------------------------------------------------------ */

/**
 * Spreads chainage ids evenly across segment indices in the given direction.
 * Handles the common case (one chainage per segment) exactly, and degrades
 * proportionally when the two counts differ.
 */
function buildOrderMap(ids, segmentCount, ascending) {
  const ordered = ascending ? ids : [...ids].reverse();
  const map = new Map();
  ordered.forEach((id, i) => {
    const index = ordered.length === segmentCount || segmentCount <= 1
      ? Math.min(i, Math.max(0, segmentCount - 1))
      : Math.round((i * (segmentCount - 1)) / Math.max(1, ordered.length - 1));
    map.set(id, index);
  });
  return map;
}

/**
 * Works out how ChainageIds map onto segment indices.
 *
 * Preference order:
 *  1. `anchors` — pairs recovered from rows that matched by GlobalId or group.
 *     Both directions are scored against them and the better fit wins. Direct
 *     evidence from the data always beats an inference.
 *  2. The `IfcSite` coordinate. Segment 0 sits at the model origin and IfcSite is
 *     placed there, so whichever chainage the site coincides with is segment 0.
 *  3. Ascending: lowest ChainageId at segment 0. Flagged as an assumption.
 *
 * A single anchor in the middle of the road fits both directions equally, so it
 * is treated as ambiguous rather than being allowed to pick one.
 */
function resolveDirection({ anchors, chainages, segmentCount, site }) {
  const distinct = [...new Map(anchors.map((a) => [a.chainageId, a.segmentIndex])).entries()]
    .map(([chainageId, segmentIndex]) => ({ chainageId, segmentIndex }))
    .sort((a, b) => a.chainageId - b.chainageId);

  const ids = [...new Set(chainages.map((c) => c.id))].sort((a, b) => a - b);
  const fallbackIds = ids.length ? ids : [...new Set(anchors.map((a) => a.chainageId))].sort((a, b) => a - b);

  // --- what the georeference implies, computed either way so it can be compared ---
  let siteImplied = null;
  if (site?.latitude != null && chainages.length) {
    const withCoords = chainages.filter((c) => c.latitude != null && c.longitude != null);
    if (withCoords.length) {
      const nearest = withCoords
        .map((c) => ({ c, d: groundDistanceM(site, c) }))
        .sort((a, b) => a.d - b.d)[0];
      // Within one segment length of the origin counts as "this is the origin chainage"
      const tolerance = Math.max(5, (site.lengthM || 0) / Math.max(1, segmentCount));
      if (nearest.d != null && nearest.d <= tolerance) {
        siteImplied = {
          originChainageId: nearest.c.id,
          offsetM: Number(nearest.d.toFixed(3)),
          // Origin chainage first => ascending; origin chainage last => descending
          ascending: nearest.c.id === fallbackIds[0] ? true
            : nearest.c.id === fallbackIds[fallbackIds.length - 1] ? false
            : null,
        };
      }
    }
  }

  const finish = (map, ascending, source, ambiguous = false) => ({
    map,
    ascending,
    source,
    ambiguous,
    anchorCount: distinct.length,
    siteImplied,
    agreesWithSite: siteImplied?.ascending == null ? null : siteImplied.ascending === ascending,
  });

  // --- 1. score both directions against the anchors ---
  if (distinct.length && segmentCount > 0) {
    const score = (ascending) => {
      const candidate = buildOrderMap(fallbackIds, segmentCount, ascending);
      return distinct.filter((d) => candidate.get(d.chainageId) === d.segmentIndex).length;
    };
    const up = score(true);
    const down = score(false);

    if (up !== down) {
      const ascending = up > down;
      // Anchors are authoritative for the chainages they cover; the rest are filled
      // in from the winning direction.
      const map = buildOrderMap(fallbackIds, segmentCount, ascending);
      for (const d of distinct) map.set(d.chainageId, d.segmentIndex);
      return finish(map, ascending, 'anchors');
    }

    // Equal fit — e.g. a lone anchor on the middle segment. Fall through to the
    // site, but keep the anchors themselves, which are still known-good.
    const ascending = siteImplied?.ascending ?? true;
    const map = buildOrderMap(fallbackIds, segmentCount, ascending);
    for (const d of distinct) map.set(d.chainageId, d.segmentIndex);
    return finish(map, ascending, siteImplied?.ascending != null ? 'site' : 'assumed', true);
  }

  // --- 2/3. no anchors at all ---
  const ascending = siteImplied?.ascending ?? true;
  return finish(
    buildOrderMap(fallbackIds, segmentCount, ascending),
    ascending,
    siteImplied?.ascending != null ? 'site' : 'assumed'
  );
}

/* ------------------------------------------------------------------ *
 * Resolver
 * ------------------------------------------------------------------ */

/**
 * @param progress   normalised rows from `buildImport()`
 * @param chainages  normalised chainage rows (may be empty)
 * @param summary    `ifcSummary` — needs elementIndex, groupIndex, alignment
 */
export function resolveProgressToModel({ progress = [], chainages = [], summary } = {}) {
  const issues = [];
  const elements = summary?.elementIndex || [];
  const groups = summary?.groupIndex || [];
  const alignment = summary?.alignment || null;

  if (!elements.length) {
    return emptyResult(progress, 'No model is loaded, so progress rows cannot be bound to elements.');
  }

  const byGlobalId = new Map(elements.filter((e) => e.globalId).map((e) => [e.globalId, e]));
  const byExpressIDLookup = new Map(elements.map((e) => [e.expressID, e]));
  const groupByGlobalId = new Map(groups.map((g) => [g.globalId, g]));

  // Every element gets a structural role, so a progress row can find its layer
  // without relying on the colliding short codes. See excelImport §BC/SC.
  for (const el of elements) {
    if (el.role === undefined) el.role = classifyLayerRole(el.layerName, el.layerCode);
  }

  /* ---- pass 1: the exact strategies, which also anchor the direction ---- */

  const matches = [];
  const anchors = [];

  for (const row of progress) {
    const ref = row.ifcRef;
    let match = null;

    if (ref && byGlobalId.has(ref)) {
      match = { strategy: STRATEGY.GUID, elements: [byGlobalId.get(ref)] };
    } else if (ref && groupByGlobalId.has(ref)) {
      const group = groupByGlobalId.get(ref);
      const members = group.memberExpressIDs.map((id) => byExpressIDLookup.get(id)).filter(Boolean);
      if (members.length) {
        match = {
          strategy: STRATEGY.GROUP,
          elements: members,
          note: `${group.name || 'Model group'} — ${members.length} element${members.length === 1 ? '' : 's'}`,
        };
      }
    }

    if (match) {
      const segs = [...new Set(match.elements.map((e) => e.segmentIndex).filter((s) => s !== undefined))];
      if (segs.length === 1) anchors.push({ chainageId: row.chainageId, segmentIndex: segs[0] });
      matches.push({ row, ...match, segmentIndex: segs.length === 1 ? segs[0] : null });
    } else {
      matches.push({ row, strategy: null, elements: [] });
    }
  }

  /* ---- direction, from the anchors the exact strategies produced ---- */

  const direction = resolveDirection({
    anchors,
    chainages,
    segmentCount: alignment?.segmentCount || 0,
    site: summary?.latitude != null
      ? { latitude: summary.latitude, longitude: summary.longitude, lengthM: alignment?.lengthM }
      : null,
  });

  /* ---- pass 2: fallbacks for anything still unresolved ---- */

  for (const m of matches) {
    if (m.strategy) continue;
    const { row } = m;
    const role = row.role || classifyLayerRole(row.layerNameInSheet, row.layerCode);
    const segmentIndex = direction.map.get(row.chainageId);

    // position: the right layer inside the right segment
    if (segmentIndex !== undefined && alignment && role) {
      const inSegment = elements.filter((e) => e.segmentIndex === segmentIndex && e.role === role);
      if (inSegment.length) {
        m.strategy = STRATEGY.POSITION;
        m.elements = inSegment;
        m.segmentIndex = segmentIndex;
        m.note = `segment ${segmentIndex} · ${role}${inSegment.length > 1 ? ` · ${inSegment.length} elements` : ''}`;
        continue;
      }
    }

    // name: last resort, restricted to the segment when one is known
    if (role) {
      const pool = segmentIndex !== undefined
        ? elements.filter((e) => e.segmentIndex === segmentIndex)
        : elements;
      const named = pool.filter((e) => classifyLayerRole(e.name, null) === role);
      if (named.length) {
        m.strategy = STRATEGY.NAME;
        m.elements = named;
        m.segmentIndex = segmentIndex ?? null;
        m.note = `matched on element name · ${role}`;
        continue;
      }
    }

    m.strategy = STRATEGY.NONE;
    m.elements = [];
    m.segmentIndex = segmentIndex ?? null;
    // A warning, not an error: the row's figures are still valid and still feed the
    // KPIs and analytics. All it loses is the 3D tint, and blocking a whole import
    // because the model lacks one layer would be the wrong trade.
    issues.push({
      level: LEVEL.WARNING,
      code: 'resolve.unmatched',
      message: `Chainage ${row.chainageId} / ${row.layerCode} could not be bound to any model element (LayerId ${row.ifcRef || 'missing'}). Its figures still count towards the KPIs, but nothing will be tinted for it.`,
    });
  }

  /* ---- reporting ---- */

  const byExpressID = new Map();
  for (const m of matches) {
    for (const el of m.elements) {
      const existing = byExpressID.get(el.expressID);
      if (existing) {
        issues.push({
          level: LEVEL.WARNING,
          code: 'resolve.element-claimed-twice',
          message: `Element ${el.name || el.expressID} is claimed by chainage ${existing.row.chainageId}/${existing.row.layerCode} and chainage ${m.row.chainageId}/${m.row.layerCode}.`,
        });
        continue;
      }
      byExpressID.set(el.expressID, m);
    }
  }

  const counts = { guid: 0, group: 0, position: 0, name: 0, none: 0, total: matches.length };
  for (const m of matches) counts[m.strategy] = (counts[m.strategy] || 0) + 1;

  const uncoveredElements = elements.filter((e) => !byExpressID.has(e.expressID));

  for (const m of matches) {
    if (m.strategy === STRATEGY.POSITION) {
      issues.push({
        level: LEVEL.WARNING,
        code: 'resolve.by-position',
        message: `Chainage ${m.row.chainageId} / ${m.row.layerCode}: GlobalId ${m.row.ifcRef || '(missing)'} is not in the model; matched by ${m.note} instead.`,
      });
    } else if (m.strategy === STRATEGY.NAME) {
      issues.push({
        level: LEVEL.WARNING,
        code: 'resolve.by-name',
        message: `Chainage ${m.row.chainageId} / ${m.row.layerCode}: matched only on element name — verify before trusting the 3D tint.`,
      });
    }
  }

  if (uncoveredElements.length) {
    issues.push({
      level: LEVEL.INFO,
      code: 'resolve.elements-uncovered',
      message: `${uncoveredElements.length} of ${elements.length} model elements carry no progress row and stay untinted.`,
    });
  }

  if (direction.source === 'assumed' && counts.position + counts.name > 0) {
    issues.push({
      level: LEVEL.WARNING,
      code: 'resolve.direction-assumed',
      message: 'No GlobalId anchored the direction and the model carries no usable site coordinate, so the lowest chainage was assumed to sit at the model origin. Positional matches may be reversed.',
    });
  }
  if (direction.ambiguous && counts.position + counts.name > 0) {
    issues.push({
      level: LEVEL.WARNING,
      code: 'resolve.direction-ambiguous',
      message: `The ${direction.anchorCount} GlobalId match${direction.anchorCount === 1 ? '' : 'es'} fit both directions equally, so the ${direction.source === 'site' ? 'site coordinate' : 'ascending order'} decided it. Positional matches may be reversed.`,
    });
  }
  if (direction.agreesWithSite === false) {
    const implied = direction.siteImplied;
    issues.push({
      level: LEVEL.WARNING,
      code: 'resolve.direction-conflict',
      message: `The spreadsheet places chainage ${[...direction.map.entries()].find(([, s]) => s === 0)?.[0]} at the model origin, but IfcSite sits on chainage ${implied.originChainageId} (${implied.offsetM} m away). The GlobalId evidence was used; one of the two is wrong.`,
    });
  }

  return {
    matches,
    byExpressID,
    direction,
    issues,
    report: {
      counts,
      resolvedPercent: counts.total ? Math.round(((counts.total - counts.none) / counts.total) * 100) : 0,
      coverage: {
        elements: elements.length,
        covered: byExpressID.size,
        uncovered: uncoveredElements.length,
      },
      uncoveredElements: uncoveredElements.map((e) => ({
        expressID: e.expressID,
        globalId: e.globalId,
        name: e.name,
        layerName: e.layerName,
        segmentIndex: e.segmentIndex ?? null,
      })),
      unmatchedRows: matches.filter((m) => m.strategy === STRATEGY.NONE).map((m) => ({
        chainageId: m.row.chainageId,
        layerCode: m.row.layerCode,
        ifcRef: m.row.ifcRef,
      })),
      chainageToSegment: [...direction.map.entries()]
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
        }),
      direction: {
        source: direction.source,
        ascending: direction.ascending,
        anchorCount: direction.anchorCount,
        agreesWithSite: direction.agreesWithSite,
        siteImplied: direction.siteImplied,
      },
      alignment: alignment
        ? {
            axis: alignment.axis,
            lengthM: alignment.lengthM,
            segmentCount: alignment.segmentCount,
            segments: alignment.segments.map(({ expressIDs, ...s }) => ({ ...s, elementCount: expressIDs.length })),
          }
        : null,
    },
  };
}

function emptyResult(progress, message) {
  return {
    matches: progress.map((row) => ({ row, strategy: STRATEGY.NONE, elements: [] })),
    byExpressID: new Map(),
    direction: { map: new Map(), ascending: true, source: 'assumed', anchorCount: 0, siteImplied: null, agreesWithSite: null },
    issues: message ? [{ level: LEVEL.INFO, code: 'resolve.no-model', message }] : [],
    report: {
      counts: { guid: 0, group: 0, position: 0, name: 0, none: progress.length, total: progress.length },
      resolvedPercent: 0,
      coverage: { elements: 0, covered: 0, uncovered: 0 },
      uncoveredElements: [],
      unmatchedRows: [],
      chainageToSegment: [],
      direction: { source: 'assumed', ascending: true, anchorCount: 0, agreesWithSite: null, siteImplied: null },
      alignment: null,
    },
  };
}

/* ------------------------------------------------------------------ *
 * Outputs the viewer and dashboard consume
 * ------------------------------------------------------------------ */

/** expressID -> the progress row driving it, flattened for the 3D tint. */
export function statusByExpressID(resolution) {
  const out = new Map();
  for (const [expressID, match] of resolution.byExpressID) {
    out.set(expressID, {
      status: match.row.status,
      progressPercent: match.row.progressPercent,
      chainageId: match.row.chainageId,
      layerCode: match.row.layerCode,
      modelLayerCode: match.row.modelLayerCode,
      strategy: match.strategy,
    });
  }
  return out;
}

/**
 * Worst-case status per modelled layer code, for the existing per-layer material
 * tint. Delayed beats In-Progress beats Not Started beats Completed, so one bad
 * segment stays visible at layer level.
 */
const STATUS_PRIORITY = ['Delayed', 'In-Progress', 'Not Started', 'Completed'];

export function statusByLayerCode(resolution) {
  const seen = new Map();
  for (const [, match] of resolution.byExpressID) {
    for (const el of match.elements) {
      const code = el.layerCode;
      if (!code || !match.row.status) continue;
      if (!seen.has(code)) seen.set(code, new Set());
      seen.get(code).add(match.row.status);
    }
  }

  const out = {};
  for (const [code, statuses] of seen) {
    out[code] = STATUS_PRIORITY.find((s) => statuses.has(s)) || null;
  }
  return out;
}
