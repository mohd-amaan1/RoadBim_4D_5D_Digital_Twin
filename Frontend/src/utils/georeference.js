/**
 * Phase 5 — placing the model on a map.
 *
 * The 3D viewer works in model metres. To draw the same elements on a satellite basemap
 * every footprint has to become latitude/longitude, and there are two independent sources
 * for that transform:
 *
 *   1. **IfcSite + TrueNorth.** An exact survey anchor: the model origin sits at a stated
 *      coordinate and TrueNorth gives the bearing. Scale is exactly 1 because both sides
 *      are the same metres.
 *   2. **Chainage coordinates**, fitted against the model positions the resolver worked
 *      out. Available even when the model carries no site location.
 *
 * The original plan preferred (2) on the assumption that models would not carry a site
 * location. `Road.ifc` does, and it is exact — it places all three chainage points within
 * 0.05 m of where their own coordinates say they are. So (1) is preferred when present,
 * and (2) is the fallback.
 *
 * Both are computed whenever possible and compared, because these are exactly the two
 * sources that disagree about which end of the road is chainage zero. A map that silently
 * picked one would hide that; this one reports the gap and lets the view be switched.
 *
 * No React, no Leaflet — pure geometry, so it can be tested headlessly.
 */

const EARTH_R = 6378137; // WGS-84 semi-major axis
const RAD = Math.PI / 180;

/* ------------------------------------------------------------------ *
 * Local tangent plane
 * ------------------------------------------------------------------ */

/**
 * An east/north metre grid centred on `origin`. Over a road corridor — kilometres, not
 * hundreds of them — the curvature error of this flat approximation is far below the
 * metre-level accuracy the source data has anyway.
 */
export function createTangentPlane(origin) {
  const mPerDegLat = EARTH_R * RAD;
  const mPerDegLng = EARTH_R * RAD * Math.cos(origin.lat * RAD);

  return {
    origin,
    toEN: ({ lat, lng }) => ({
      e: (lng - origin.lng) * mPerDegLng,
      n: (lat - origin.lat) * mPerDegLat,
    }),
    toLatLng: ({ e, n }) => ({
      lat: origin.lat + n / mPerDegLat,
      lng: origin.lng + e / mPerDegLng,
    }),
  };
}

export function groundDistanceM(a, b) {
  const dLat = (b.lat - a.lat) * EARTH_R * RAD;
  const dLng = (b.lng - a.lng) * EARTH_R * RAD * Math.cos(((a.lat + b.lat) / 2) * RAD);
  return Math.hypot(dLat, dLng);
}

/* ------------------------------------------------------------------ *
 * Fitting
 * ------------------------------------------------------------------ */

/**
 * Least-squares 2D transform from model (x along, z across) to local east/north:
 *
 *     e = a·x − b·z + tx
 *     n = b·x + a·z + ty
 *
 * With `lockScale` the rotation is estimated but the scale is pinned to 1, giving a rigid
 * transform. That is the physically correct model: the survey and the drawing measure the
 * same road in the same metres, so a scale difference is **error to report, not a degree
 * of freedom to absorb**. Letting scale float would stretch the road to hide bad control
 * points — on this project's data it produced a 90 m road from a 60 m model.
 *
 * `lockScale: false` is kept for diagnosis: the recovered scale is a direct measure of how
 * badly the control points disagree with the model.
 *
 * **Caveat with collinear control points.** Chainage markers all sit on the centreline, so
 * they fix the along-axis but leave the cross-axis determined only by the no-reflection
 * assumption. Residuals cannot detect a mirrored model; nothing in collinear data can.
 */
export function fitSimilarity(pairs, { lockScale = false } = {}) {
  if (!pairs || pairs.length < 2) return null;

  const n = pairs.length;
  const mean = (get) => pairs.reduce((s, p) => s + get(p), 0) / n;
  const xm = mean((p) => p.x);
  const zm = mean((p) => p.z);
  const em = mean((p) => p.e);
  const nm = mean((p) => p.n);

  let num1 = 0; // Σ(dx·de + dz·dn)
  let num2 = 0; // Σ(dx·dn − dz·de)
  let den = 0;  // Σ(dx² + dz²)

  for (const p of pairs) {
    const dx = p.x - xm, dz = p.z - zm;
    const de = p.e - em, dn = p.n - nm;
    num1 += dx * de + dz * dn;
    num2 += dx * dn - dz * de;
    den += dx * dx + dz * dz;
  }

  if (den < 1e-9) return null; // every control point at the same model position

  let a = num1 / den;
  let b = num2 / den;
  const freeScale = Math.hypot(a, b);

  if (lockScale) {
    if (freeScale < 1e-12) return null;
    a /= freeScale;
    b /= freeScale;
  }

  const tx = em - a * xm + b * zm;
  const ty = nm - b * xm - a * zm;
  const apply = ({ x, z }) => ({ e: a * x - b * z + tx, n: b * x + a * z + ty });

  const residuals = pairs.map((p) => {
    const got = apply(p);
    return Math.hypot(got.e - p.e, got.n - p.n);
  });

  return {
    a, b, tx, ty, apply,
    scale: lockScale ? 1 : freeScale,
    /** Scale the data wanted, whether or not it was applied. A direct disagreement measure. */
    impliedScale: freeScale,
    /** Bearing of model +X, degrees clockwise from north. */
    rotationDeg: (Math.atan2(a, b) / RAD + 360) % 360,
    residuals,
    residualM: Math.sqrt(residuals.reduce((s, r) => s + r * r, 0) / n),
    maxResidualM: Math.max(...residuals),
    controlCount: n,
  };
}

/* ------------------------------------------------------------------ *
 * The two placements
 * ------------------------------------------------------------------ */

/**
 * IfcSite anchor. The model origin is the stated coordinate and TrueNorth gives the
 * bearing, so the drawing keeps its true dimensions exactly.
 *
 * web-ifc rotates IFC's Z-up geometry to Y-up, which maps the IFC plan axes onto
 * (x, −z). With TrueNorth at bearing β from +Y_ifc, that works out as:
 *
 *     E = x·cosβ + z·sinβ
 *     N = x·sinβ − z·cosβ
 */
function siteTransform(summary) {
  if (summary?.latitude == null || summary?.longitude == null) return null;

  const plane = createTangentPlane({ lat: summary.latitude, lng: summary.longitude });
  const beta = (summary.roadPath?.trueNorthDeg ?? 0) * RAD;
  const cos = Math.cos(beta);
  const sin = Math.sin(beta);

  return {
    source: 'ifc-site',
    plane,
    apply: ({ x, z }) => ({ e: x * cos + z * sin, n: x * sin - z * cos }),
    scale: 1,
    rotationDeg: (90 - (summary.roadPath?.trueNorthDeg ?? 0) + 360) % 360,
    controlCount: 0,
    residualM: null,
    maxResidualM: null,
  };
}

/** Rigid fit of chainage coordinates against the segment each one resolved to. */
function surveyTransform(summary, chainages, resolution) {
  const alignment = summary?.alignment;
  if (!alignment) return null;

  const withCoords = chainages.filter((c) => c.latitude != null && c.longitude != null);
  const segmentOf = new Map(
    (resolution?.report?.chainageToSegment || []).map((c) => [c.chainageId, c.segmentIndex])
  );
  if (withCoords.length < 2 || segmentOf.size < 2) return null;

  const plane = createTangentPlane({ lat: withCoords[0].latitude, lng: withCoords[0].longitude });
  const crossCentre = alignment.crossCentreM ?? 0;

  const pairs = [];
  for (const c of withCoords) {
    const segIndex = segmentOf.get(c.id);
    if (segIndex === undefined) continue;
    const seg = alignment.segments?.[segIndex];
    if (!seg) continue;
    const { e, n } = plane.toEN({ lat: c.latitude, lng: c.longitude });
    pairs.push({ x: seg.centreM, z: crossCentre, e, n, chainageId: c.id });
  }
  if (pairs.length < 2) return null;

  const fit = fitSimilarity(pairs, { lockScale: true });
  if (!fit) return null;

  return { source: 'chainage-fit', plane, ...fit, pairs };
}

/* ------------------------------------------------------------------ *
 * Choosing
 * ------------------------------------------------------------------ */

/**
 * Works out how to place model coordinates on the map, and reports the disagreement
 * between the two available sources rather than hiding it.
 *
 * @param prefer  'auto' (default), 'ifc-site' or 'chainage-fit' — the map exposes this so
 *                the two placements can be compared on screen.
 */
export function buildGeoTransform({ summary, chainages = [], resolution, prefer = 'auto' } = {}) {
  const alignment = summary?.alignment;
  if (!alignment) return null;

  const crossCentre = alignment.crossCentreM ?? 0;
  const site = siteTransform(summary);
  const survey = surveyTransform(summary, chainages, resolution);
  if (!site && !survey) return null;

  const notes = [];

  // Where does each placement put the far end of the model? That gap is the honest
  // measure of how much the two sources disagree.
  let disagreementM = null;
  if (site && survey) {
    const far = { x: alignment.maxM, z: crossCentre };
    const a = site.plane.toLatLng(site.apply(far));
    const b = survey.plane.toLatLng(survey.apply(far));
    disagreementM = groundDistanceM(a, b);
  }

  let chosen = site || survey;
  if (prefer === 'chainage-fit' && survey) chosen = survey;
  else if (prefer === 'ifc-site' && site) chosen = site;

  if (chosen.source === 'ifc-site') {
    notes.push('Placed from the IfcSite coordinate and TrueNorth, so the drawing keeps its true dimensions.');
  } else {
    notes.push(`Placed by fitting ${survey.controlCount} chainage coordinate(s) against the resolved segment positions.`);
  }

  if (survey) {
    if (Math.abs(survey.impliedScale - 1) > 0.02) {
      notes.push(
        `The chainage coordinates want to stretch the model by ${((survey.impliedScale - 1) * 100).toFixed(0)}% ` +
        'to fit — they and the model do not agree on where the stations sit. Scale is held at 1:1 rather than ' +
        'distorting the road.'
      );
    }
    if (survey.maxResidualM > 5) {
      notes.push(`Worst chainage control point is ${survey.maxResidualM.toFixed(1)} m from where the fit puts it.`);
    }
  }

  if (disagreementM !== null && disagreementM > Math.max(10, alignment.lengthM * 0.1)) {
    notes.push(
      `The two placements put the far end of the road ${disagreementM.toFixed(0)} m apart — the same ` +
      'chainage-direction disagreement the resolver reports. Switch the source to compare them.'
    );
  }

  return {
    source: chosen.source,
    available: { ifcSite: Boolean(site), chainageFit: Boolean(survey) },
    notes,
    disagreementM,
    scale: chosen.scale,
    impliedScale: survey?.impliedScale ?? null,
    residualM: chosen.residualM ?? null,
    maxResidualM: chosen.maxResidualM ?? null,
    controlCount: chosen.controlCount ?? 0,
    rotationDeg: chosen.rotationDeg,

    /** Model (x = along, z = across) -> { lat, lng }. */
    toLatLng: ({ x, z }) => chosen.plane.toLatLng(chosen.apply({ x, z })),

    /** Model metres -> [lat, lng], the tuple Leaflet wants. */
    toLeaflet: ({ x, z }) => {
      const { lat, lng } = chosen.plane.toLatLng(chosen.apply({ x, z }));
      return [lat, lng];
    },
  };
}

/* ------------------------------------------------------------------ *
 * Footprints
 * ------------------------------------------------------------------ */

/**
 * Plan footprint of one element as a closed lat/lng ring.
 *
 * web-ifc emits Y-up geometry, so the plan is the X/Z plane: X runs along the alignment
 * and Z across it. `offsetM` shifts the whole footprint sideways, which is what draws the
 * layers exploded rather than stacked on top of each other.
 */
export function elementFootprint(element, transform, offsetM = 0) {
  if (!element?.box || !transform) return null;
  const { min, max } = element.box;
  if (![min?.[0], max?.[0], min?.[2], max?.[2]].every(Number.isFinite)) return null;

  const z0 = min[2] + offsetM;
  const z1 = max[2] + offsetM;

  return [
    transform.toLeaflet({ x: min[0], z: z0 }),
    transform.toLeaflet({ x: max[0], z: z0 }),
    transform.toLeaflet({ x: max[0], z: z1 }),
    transform.toLeaflet({ x: min[0], z: z1 }),
  ];
}

/** Centreline of the alignment, for the dashed guide line. */
export function centrelineLatLngs(alignment, transform, crossCentre = 0, samples = 24) {
  if (!alignment || !transform) return [];
  const out = [];
  for (let i = 0; i <= samples; i++) {
    const x = alignment.minM + ((alignment.maxM - alignment.minM) * i) / samples;
    out.push(transform.toLeaflet({ x, z: crossCentre }));
  }
  return out;
}

/**
 * How far to push each layer sideways in exploded mode.
 *
 * Layers are spread symmetrically about the centreline in stack order, so the fan reads
 * bottom-to-top the same way the 3D cross-section does.
 */
export function explodeOffsets(layerCodes, corridorWidthM) {
  const gap = Math.max(corridorWidthM * 1.25, 4);
  const mid = (layerCodes.length - 1) / 2;
  const out = {};
  layerCodes.forEach((code, i) => { out[code] = (i - mid) * gap; });
  return out;
}
