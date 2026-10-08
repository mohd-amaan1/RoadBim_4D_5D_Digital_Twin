import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { createLayerMaterial, applyStatusTint, statusVariant, TEXTURED_LAYER_CODES } from './roadTextures.js';

/**
 * Loads a user-uploaded .ifc / .glb / .gltf file into a Three.js Group that the
 * RoadBIMViewer can drop straight into its scene in place of the procedural road.
 *
 * IFC parsing uses the web-ifc WASM core directly (rather than web-ifc-three) so it
 * stays decoupled from the Three.js version. The .wasm binary is served from
 * /wasm/web-ifc.wasm — see the "postinstall" script in package.json.
 */

const WASM_PATH = '/wasm/';

let ifcApiPromise = null;

function getIfcApi() {
  if (!ifcApiPromise) {
    ifcApiPromise = (async () => {
      // Loaded on demand — keeps the ~2 MB web-ifc glue out of the initial bundle
      const { IfcAPI } = await import('web-ifc');
      const api = new IfcAPI();
      api.SetWasmPath(WASM_PATH);
      // forceSingleThread — we ship only web-ifc.wasm, not the multi-threaded build
      await api.Init(undefined, true);
      return api;
    })().catch((err) => {
      ifcApiPromise = null; // allow a retry on the next upload
      throw err;
    });
  }
  return ifcApiPromise;
}

/**
 * Builds a BufferGeometry from web-ifc's interleaved [px,py,pz,nx,ny,nz] vertex array.
 *
 * web-ifc emits no UVs, so a texture map would sample a single texel and render flat.
 * When `transform` is supplied we generate box-projected UVs in *world metres*: each
 * vertex is projected along its dominant normal axis, which keeps tiling continuous
 * across separate meshes and correctly scaled regardless of element size.
 */
function buildBufferGeometry(vertexData, indexData, transform) {
  const vertexCount = vertexData.length / 6;
  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const uvs = transform ? new Float32Array(vertexCount * 2) : null;

  for (let i = 0; i < vertexCount; i++) {
    const px = vertexData[i * 6];
    const py = vertexData[i * 6 + 1];
    const pz = vertexData[i * 6 + 2];
    const nx = vertexData[i * 6 + 3];
    const ny = vertexData[i * 6 + 4];
    const nz = vertexData[i * 6 + 5];

    positions[i * 3] = px;
    positions[i * 3 + 1] = py;
    positions[i * 3 + 2] = pz;
    normals[i * 3] = nx;
    normals[i * 3 + 1] = ny;
    normals[i * 3 + 2] = nz;

    if (!uvs) continue;

    const m = transform;
    const wx = m[0] * px + m[4] * py + m[8] * pz + m[12];
    const wy = m[1] * px + m[5] * py + m[9] * pz + m[13];
    const wz = m[2] * px + m[6] * py + m[10] * pz + m[14];
    // Rotate the normal (no translation) so the axis choice is made in world space
    const wnx = m[0] * nx + m[4] * ny + m[8] * nz;
    const wny = m[1] * nx + m[5] * ny + m[9] * nz;
    const wnz = m[2] * nx + m[6] * ny + m[10] * nz;

    const ax = Math.abs(wnx), ay = Math.abs(wny), az = Math.abs(wnz);
    let u, v;
    if (ay >= ax && ay >= az) { u = wx; v = wz; }        // top / bottom faces
    else if (ax >= az) { u = wz; v = wy; }               // side faces
    else { u = wx; v = wy; }                             // end faces

    uvs[i * 2] = u;
    uvs[i * 2 + 1] = v;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  if (uvs) geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(indexData), 1));
  return geometry;
}

/**
 * Recenters a loaded model on the world origin, rests it on the grid plane and
 * returns its bounding-box size so the camera can frame it.
 *
 * No axis conversion is applied: web-ifc already emits Y-up geometry (verified
 * against v0.0.77 — an IFC solid extruded along +Z comes back extruded along +Y),
 * and glTF is Y-up by specification.
 */
function normalizeModel(innerGroup) {
  const wrapper = new THREE.Group();
  wrapper.name = 'UPLOADED_BIM_MODEL';
  wrapper.add(innerGroup);
  wrapper.updateMatrixWorld(true);

  const box = new THREE.Box3().setFromObject(wrapper);
  if (box.isEmpty()) return { wrapper, size: new THREE.Vector3(1, 1, 1) };

  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());

  // Recenter horizontally, and rest the model on the grid plane (y = 0)
  innerGroup.position.x -= center.x;
  innerGroup.position.z -= center.z;
  innerGroup.position.y -= box.min.y;
  wrapper.updateMatrixWorld(true);

  return { wrapper, size };
}

// ---------------------------------------------------------------------------
// Metadata extraction
// ---------------------------------------------------------------------------

/** web-ifc wraps attribute values as { value, type } — unwrap defensively. */
const attr = (x) => (x && typeof x === 'object' && 'value' in x ? x.value : x);

const vectorToArray = (vec) => {
  const out = [];
  for (let i = 0; i < vec.size(); i++) out.push(vec.get(i));
  return out;
};

function linesOfType(api, modelID, typeName) {
  try {
    const code = api.GetTypeCodeFromName(typeName);
    if (code == null) return [];
    return vectorToArray(api.GetLineIDsWithType(modelID, code, true));
  } catch {
    return [];
  }
}

const SI_PREFIX_SCALE = {
  EXA: 1e18, PETA: 1e15, TERA: 1e12, GIGA: 1e9, MEGA: 1e6, KILO: 1e3,
  HECTO: 1e2, DECA: 1e1, DECI: 1e-1, CENTI: 1e-2, MILLI: 1e-3,
  MICRO: 1e-6, NANO: 1e-9, PICO: 1e-12,
};

/** Project length unit -> metres (mm -> 0.001, ft -> 0.3048, …). */
function readLengthUnit(api, modelID) {
  for (const id of linesOfType(api, modelID, 'IFCSIUNIT')) {
    const unit = api.GetLine(modelID, id);
    if (attr(unit.UnitType) !== 'LENGTHUNIT') continue;
    const prefix = attr(unit.Prefix);
    return {
      name: `${prefix ? prefix.toLowerCase() : ''}${String(attr(unit.Name) || 'METRE').toLowerCase()}`,
      toMetres: prefix ? SI_PREFIX_SCALE[prefix] ?? 1 : 1,
    };
  }
  for (const id of linesOfType(api, modelID, 'IFCCONVERSIONBASEDUNIT')) {
    const unit = api.GetLine(modelID, id);
    if (attr(unit.UnitType) !== 'LENGTHUNIT') continue;
    const factor = api.GetLine(modelID, attr(unit.ConversionFactor));
    return { name: String(attr(unit.Name) || 'unit'), toMetres: Number(attr(factor?.ValueComponent)) || 1 };
  }
  return { name: 'metre', toMetres: 1 };
}

/** IFC compound-plane-angle [deg, min, sec, millionths] -> decimal degrees. */
function dmsToDecimal(dms) {
  const parts = (Array.isArray(dms) ? dms : []).map((n) => Number(attr(n)) || 0);
  if (!parts.length) return null;
  const [deg = 0, min = 0, sec = 0, millionths = 0] = parts;
  const magnitude = Math.abs(deg) + Math.abs(min) / 60 + (Math.abs(sec) + Math.abs(millionths) / 1e6) / 3600;
  const negative = deg < 0 || min < 0 || sec < 0 || millionths < 0;
  return Number(((negative ? -1 : 1) * magnitude).toFixed(6));
}

/** "Floor:Sub base:1676676" / "Floor:Sub base" -> "Sub base" */
function cleanLayerName(raw) {
  if (!raw) return null;
  const parts = String(raw).split(':').map((p) => p.trim()).filter(Boolean);
  if (parts.length <= 1) return parts[0] || null;
  const meaningful = parts.filter((p) => !/^\d+$/.test(p));
  return meaningful[meaningful.length - 1] || parts[0];
}

/**
 * Maps a modelled layer name onto the standard road pavement codes the Excel
 * template uses, so an uploaded sheet can be matched back to IFC layers.
 */
const LAYER_CODE_RULES = [
  [/\b(bc|bituminous\s*concrete|wearing|surface|asphalt|sma|carriageway)\b/i, 'BC'],
  [/\b(dbm|dense\s*bituminous|binder)\b/i, 'DBM'],
  [/\b(wmm|wet\s*mix|base\s*course|macadam|crushed\s*aggregate|aggregate\s*base|base)\b/i, 'WMM'],
  [/\b(gsb|granular\s*sub|sub[\s-]*base|subbase)\b/i, 'GSB'],
  [/\b(sub[\s-]*grade|subgrade|formation|earthwork|embankment)\b/i, 'SUB'],
];

export function deriveLayerCode(layerName) {
  const name = String(layerName || '');
  // Most specific first: "Sub base" must not be captured by the "surface"/"base course" rules
  if (/\b(sub[\s-]*base|subbase|gsb|granular)\b/i.test(name)) return 'GSB';
  if (/\b(sub[\s-]*grade|subgrade|formation|earthwork|embankment)\b/i.test(name)) return 'SUB';
  // A rigid (concrete) wearing course, as opposed to a flexible asphalt one
  if (/\b(pcc|portland|rigid\s*pavement|cement\s*concrete)\b/i.test(name)) return 'PCC';
  for (const [pattern, code] of LAYER_CODE_RULES) {
    if (pattern.test(name)) return code;
  }
  const initials = name.split(/[\s_-]+/).filter(Boolean).map((w) => w[0]).join('').toUpperCase();
  return (initials || 'LYR').slice(0, 4);
}

/** Resolves every element/type expressID to its IfcMaterialLayerSet. */
function buildMaterialIndex(api, modelID) {
  const layerSetByObject = new Map();

  for (const relID of linesOfType(api, modelID, 'IFCRELASSOCIATESMATERIAL')) {
    let rel;
    try {
      rel = api.GetLine(modelID, relID);
    } catch {
      continue;
    }

    const relatingID = attr(rel.RelatingMaterial);
    if (relatingID == null) continue;

    let material;
    try {
      material = api.GetLine(modelID, relatingID);
    } catch {
      continue;
    }

    // NOTE: GetNameFromTypeCode returns mixed case ("IfcMaterialLayerSetUsage") — compare case-insensitively.
    const typeName = String(api.GetNameFromTypeCode(api.GetLineType(modelID, relatingID)) || '').toUpperCase();
    if (typeName === 'IFCMATERIALLAYERSETUSAGE' && material.ForLayerSet != null) {
      try {
        material = api.GetLine(modelID, attr(material.ForLayerSet));
      } catch {
        continue;
      }
    }

    let record = null;
    if (material?.MaterialLayers) {
      const layers = material.MaterialLayers.map((ref) => {
        const ml = api.GetLine(modelID, attr(ref));
        const mat = ml?.Material != null ? api.GetLine(modelID, attr(ml.Material)) : null;
        return { material: attr(mat?.Name) || null, thickness: Number(attr(ml?.LayerThickness)) || 0 };
      });
      record = { setName: attr(material.LayerSetName) || null, layers };
    } else if (material?.Name) {
      // Plain IfcMaterial with no layer set
      record = { setName: attr(material.Name), layers: [{ material: attr(material.Name), thickness: 0 }] };
    }
    if (!record) continue;

    for (const objRef of rel.RelatedObjects || []) {
      layerSetByObject.set(attr(objRef), record);
    }
  }

  // element -> its type, so type-level material associations reach the instances
  const typeByElement = new Map();
  for (const relID of linesOfType(api, modelID, 'IFCRELDEFINESBYTYPE')) {
    try {
      const rel = api.GetLine(modelID, relID);
      const typeID = attr(rel.RelatingType);
      for (const objRef of rel.RelatedObjects || []) typeByElement.set(attr(objRef), typeID);
    } catch {
      /* ignore malformed relation */
    }
  }

  return { layerSetByObject, typeByElement };
}

/**
 * True north as a unit vector in the IFC XY (plan) frame. Defaults to +Y, the IFC
 * convention for "project north" when a file declares nothing.
 */
function readTrueNorth(api, modelID) {
  for (const id of linesOfType(api, modelID, 'IFCGEOMETRICREPRESENTATIONCONTEXT')) {
    let ctx;
    try {
      ctx = api.GetLine(modelID, id);
    } catch {
      continue;
    }
    if (attr(ctx.ContextType) !== 'Model' || ctx.TrueNorth == null) continue;
    try {
      const dir = api.GetLine(modelID, attr(ctx.TrueNorth));
      const ratios = (dir?.DirectionRatios || []).map((n) => Number(attr(n)) || 0);
      const [x = 0, y = 1] = ratios;
      const len = Math.hypot(x, y);
      if (len > 1e-9) return { x: x / len, y: y / len };
    } catch {
      /* fall through to the default */
    }
  }
  return { x: 0, y: 1 };
}

const METRES_PER_DEG_LAT = 111320;

/**
 * Projects the model's plan geometry onto the globe.
 *
 * Anchoring: IfcSite.RefLatitude/Longitude is the site's *placement* origin, but
 * web-ifc's COORDINATE_TO_ORIGIN shifts geometry by an amount the API does not report
 * (GetCoordinationMatrix stays identity — verified). Rather than misplace the road by
 * that unknown offset, the model's own centroid is pinned to the reference point:
 * shape, scale and bearing are all invariant under translation, so only the anchor is
 * approximate, and that is stated in the UI.
 *
 * Axis mapping (verified against web-ifc 0.0.77): worldX = ifcX, worldZ = -ifcY.
 */
function buildRoadPath(elementBoxes, { latitude, longitude }, trueNorth) {
  if (latitude === null || longitude === null || !elementBoxes.size) return null;

  const model = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
  for (const box of elementBoxes.values()) {
    model.minX = Math.min(model.minX, box.min[0]);
    model.maxX = Math.max(model.maxX, box.max[0]);
    model.minZ = Math.min(model.minZ, box.min[2]);
    model.maxZ = Math.max(model.maxZ, box.max[2]);
  }
  if (!Number.isFinite(model.minX)) return null;

  const centreX = (model.minX + model.maxX) / 2;
  const centreZ = (model.minZ + model.maxZ) / 2;
  const spanX = model.maxX - model.minX;
  const spanZ = model.maxZ - model.minZ;
  const alongIsX = spanX >= spanZ;
  const lengthM = alongIsX ? spanX : spanZ;
  if (lengthM <= 0) return null;

  // Sample the corridor along its long axis; each bucket records the cross-axis
  // extent of every element overlapping it, so a curved alignment stays curved.
  const bucketCount = Math.max(6, Math.min(64, Math.round(lengthM / 5)));
  const buckets = Array.from({ length: bucketCount }, () => ({ min: Infinity, max: -Infinity }));
  const alongMin = alongIsX ? model.minX : model.minZ;
  const step = lengthM / bucketCount;

  for (const box of elementBoxes.values()) {
    const a0 = alongIsX ? box.min[0] : box.min[2];
    const a1 = alongIsX ? box.max[0] : box.max[2];
    const c0 = alongIsX ? box.min[2] : box.min[0];
    const c1 = alongIsX ? box.max[2] : box.max[0];

    const first = Math.max(0, Math.floor((a0 - alongMin) / step));
    const last = Math.min(bucketCount - 1, Math.ceil((a1 - alongMin) / step) - 1);
    for (let i = first; i <= last; i++) {
      buckets[i].min = Math.min(buckets[i].min, c0);
      buckets[i].max = Math.max(buckets[i].max, c1);
    }
  }

  const samples = [];
  for (let i = 0; i < bucketCount; i++) {
    if (!Number.isFinite(buckets[i].min)) continue;
    samples.push({
      along: alongMin + (i + 0.5) * step,
      crossMin: buckets[i].min,
      crossMax: buckets[i].max,
    });
  }
  if (samples.length < 2) return null;

  const cosLat = Math.cos((latitude * Math.PI) / 180) || 1e-6;

  /** world plan metres -> [lat, lng], rotated into the true-north frame */
  const toLatLng = (worldX, worldZ) => {
    const dx = worldX - centreX;
    const dz = worldZ - centreZ;
    // world -> IFC plan
    const ifcX = dx;
    const ifcY = -dz;
    // project onto true north (n) and east (n rotated -90 deg)
    const north = ifcX * trueNorth.x + ifcY * trueNorth.y;
    const east = ifcX * trueNorth.y - ifcY * trueNorth.x;
    return [
      Number((latitude + north / METRES_PER_DEG_LAT).toFixed(8)),
      Number((longitude + east / (METRES_PER_DEG_LAT * cosLat)).toFixed(8)),
    ];
  };

  const pt = (along, cross) => (alongIsX ? toLatLng(along, cross) : toLatLng(cross, along));

  const centreline = samples.map((s) => pt(s.along, (s.crossMin + s.crossMax) / 2));
  const leftEdge = samples.map((s) => pt(s.along, s.crossMin));
  const rightEdge = samples.map((s) => pt(s.along, s.crossMax));
  const outline = [...leftEdge, ...rightEdge.reverse()];

  // Chainage markers: start, end and a handful in between
  const stationCount = Math.min(6, Math.max(2, Math.round(lengthM / 250) + 2));
  const stations = [];
  for (let i = 0; i < stationCount; i++) {
    const t = i / (stationCount - 1);
    const idx = Math.min(centreline.length - 1, Math.round(t * (centreline.length - 1)));
    const chainageM = t * lengthM;
    stations.push({
      chainageM: Number(chainageM.toFixed(1)),
      label: lengthM >= 1000
        ? `KM ${(chainageM / 1000).toFixed(2)}`
        : `${chainageM.toFixed(0)} m`,
      lat: centreline[idx][0],
      lng: centreline[idx][1],
    });
  }

  const widths = samples.map((s) => s.crossMax - s.crossMin);
  return {
    centreline,
    outline,
    stations,
    lengthM: Number(lengthM.toFixed(2)),
    widthM: Number((widths.reduce((a, b) => a + b, 0) / widths.length).toFixed(2)),
    anchor: { lat: latitude, lng: longitude },
    trueNorthDeg: Number(((Math.atan2(trueNorth.x, trueNorth.y) * 180) / Math.PI).toFixed(2)),
    sampleCount: samples.length,
  };
}

/**
 * Resolves one element to its pavement layer. Shared by the geometry pass (which needs
 * it to choose a texture) and the summary pass (which needs it to group layers), so the
 * two can never disagree about what a given element is.
 */
function resolveElementLayer(api, modelID, expressID, materialIndex) {
  const record = materialIndex.layerSetByObject.get(expressID)
    || materialIndex.layerSetByObject.get(materialIndex.typeByElement.get(expressID));

  let element = null;
  try {
    element = api.GetLine(modelID, expressID);
  } catch {
    /* element unreadable — fall through to the record/derived name */
  }
  const elementName = attr(element?.Name) || null;

  const displayName = cleanLayerName(record?.setName) || cleanLayerName(elementName) || `Element ${expressID}`;
  return { record, elementName, displayName, code: deriveLayerCode(displayName) };
}

/**
 * Every element that produced geometry, keyed for the phase-2 resolver:
 * GlobalId, name, derived layer, world AABB and position along the alignment.
 *
 * Progress rows reference elements by GlobalId, so this index is what turns a
 * spreadsheet row into something that can be tinted in 3D.
 */
function buildElementIndex(api, modelID, elementBoxes, materialIndex) {
  const elements = [];

  for (const [expressID, box] of elementBoxes) {
    let line = null;
    let ifcType = 'IFCELEMENT';
    try {
      line = api.GetLine(modelID, expressID);
      ifcType = api.GetNameFromTypeCode(api.GetLineType(modelID, expressID)) || 'IFCELEMENT';
    } catch {
      /* unreadable element still gets a geometry-only entry */
    }

    const { displayName, code } = resolveElementLayer(api, modelID, expressID, materialIndex);

    elements.push({
      expressID,
      globalId: attr(line?.GlobalId) || null,
      name: attr(line?.Name) || attr(line?.LongName) || null,
      ifcType,
      layerName: displayName,
      layerCode: code,
      box: { min: [...box.min], max: [...box.max] },
      centre: [0, 1, 2].map((i) => (box.min[i] + box.max[i]) / 2),
    });
  }

  return elements;
}

/**
 * Revit model groups, which is how a progress row addresses a layer built from
 * several elements — the surface course is two lane slabs per segment, so the
 * sheet points at the group rather than picking one lane arbitrarily.
 */
function buildGroupIndex(api, modelID, elementBoxes) {
  const groups = new Map();

  for (const relID of linesOfType(api, modelID, 'IFCRELASSIGNSTOGROUP')) {
    let rel;
    try {
      rel = api.GetLine(modelID, relID);
    } catch {
      continue;
    }

    const groupID = attr(rel.RelatingGroup);
    if (groupID == null) continue;

    let group;
    try {
      group = api.GetLine(modelID, groupID);
    } catch {
      continue;
    }

    const globalId = attr(group?.GlobalId);
    if (!globalId) continue;

    // Only members that actually rendered can be tinted, so the rest are dropped.
    const memberExpressIDs = (rel.RelatedObjects || [])
      .map((ref) => attr(ref))
      .filter((id) => elementBoxes.has(id));

    const existing = groups.get(globalId);
    if (existing) {
      for (const id of memberExpressIDs) {
        if (!existing.memberExpressIDs.includes(id)) existing.memberExpressIDs.push(id);
      }
    } else {
      groups.set(globalId, {
        globalId,
        expressID: groupID,
        name: attr(group?.Name) || attr(group?.LongName) || null,
        ifcType: (() => {
          try { return api.GetNameFromTypeCode(api.GetLineType(modelID, groupID)) || 'IFCGROUP'; }
          catch { return 'IFCGROUP'; }
        })(),
        memberExpressIDs,
      });
    }
  }

  return [...groups.values()];
}

/**
 * Splits the model into construction segments along its long axis.
 *
 * A road modelled per chainage repeats the whole layer stack at each station, so
 * the element centres fall into tight clusters with clear gaps between them.
 * Clustering on those gaps recovers the segmentation without needing any naming
 * convention — which is what lets a progress row be placed when its GlobalId has
 * gone stale.
 *
 * A continuously modelled road yields a single cluster; that is reported rather
 * than faked, and the position strategy simply cannot help there.
 */
function buildAlignment(elements) {
  if (!elements.length) return null;

  const spanOf = (i) => Math.max(...elements.map((e) => e.box.max[i])) - Math.min(...elements.map((e) => e.box.min[i]));
  const axis = spanOf(0) >= spanOf(2) ? 0 : 2; // 1 is up
  const axisName = axis === 0 ? 'x' : 'z';

  const min = Math.min(...elements.map((e) => e.box.min[axis]));
  const max = Math.max(...elements.map((e) => e.box.max[axis]));
  const lengthM = max - min;

  const sorted = elements
    .map((e) => ({ e, centre: e.centre[axis], lo: e.box.min[axis], hi: e.box.max[axis] }))
    .sort((a, b) => a.centre - b.centre);

  // A gap wider than this starts a new segment. Proportional to the model so it
  // scales from a 60 m test road to a 36 km highway.
  const gapThreshold = Math.max(0.5, lengthM * 0.02);

  const clusters = [];
  for (const item of sorted) {
    const last = clusters[clusters.length - 1];
    if (last && item.centre - last.lastCentre <= gapThreshold) {
      last.items.push(item);
      last.lastCentre = item.centre;
    } else {
      clusters.push({ items: [item], lastCentre: item.centre });
    }
  }

  const segments = clusters.map((cluster, index) => ({
    index,
    startM: Math.min(...cluster.items.map((i) => i.lo)),
    endM: Math.max(...cluster.items.map((i) => i.hi)),
    centreM: cluster.items.reduce((s, i) => s + i.centre, 0) / cluster.items.length,
    expressIDs: cluster.items.map((i) => i.e.expressID),
  }));

  for (const seg of segments) {
    for (const id of seg.expressIDs) {
      const el = elements.find((e) => e.expressID === id);
      if (el) el.segmentIndex = seg.index;
    }
  }

  // The other horizontal axis, which the plan-view map needs to draw footprints
  const crossAxis = axis === 0 ? 2 : 0;
  const crossMin = Math.min(...elements.map((e) => e.box.min[crossAxis]));
  const crossMax = Math.max(...elements.map((e) => e.box.max[crossAxis]));

  return {
    axis: axisName,
    axisIndex: axis,
    crossAxisIndex: crossAxis,
    crossMinM: Number(crossMin.toFixed(3)),
    crossMaxM: Number(crossMax.toFixed(3)),
    crossCentreM: Number(((crossMin + crossMax) / 2).toFixed(3)),
    crossWidthM: Number((crossMax - crossMin).toFixed(3)),
    minM: Number(min.toFixed(3)),
    maxM: Number(max.toFixed(3)),
    lengthM: Number(lengthM.toFixed(3)),
    segmentCount: segments.length,
    segments: segments.map((s) => ({
      index: s.index,
      startM: Number(s.startM.toFixed(3)),
      endM: Number(s.endM.toFixed(3)),
      centreM: Number(s.centreM.toFixed(3)),
      // Distance from the model origin end, which is where IfcSite sits
      offsetM: Number((s.centreM - min).toFixed(3)),
      expressIDs: s.expressIDs,
    })),
  };
}

/**
 * Derives everything the dashboard can legitimately know from the model itself.
 * Anything schedule-, progress- or cost-related is deliberately absent — the UI
 * renders those as "—" until an Excel sheet supplies them.
 */
export function extractModelSummary(api, modelID, elementBoxes, prebuiltMaterialIndex) {
  const lengthUnit = readLengthUnit(api, modelID);

  // --- project / site / building ---
  const [projectID] = linesOfType(api, modelID, 'IFCPROJECT');
  const project = projectID != null ? api.GetLine(modelID, projectID) : null;
  const [siteID] = linesOfType(api, modelID, 'IFCSITE');
  const site = siteID != null ? api.GetLine(modelID, siteID) : null;
  const [buildingID] = linesOfType(api, modelID, 'IFCBUILDING');
  const building = buildingID != null ? api.GetLine(modelID, buildingID) : null;

  const latitude = site ? dmsToDecimal(attr(site.RefLatitude)) : null;
  const longitude = site ? dmsToDecimal(attr(site.RefLongitude)) : null;
  const siteElevationM = site && site.RefElevation != null
    ? (Number(attr(site.RefElevation)) || 0) * lengthUnit.toMetres
    : 0;

  const storeys = linesOfType(api, modelID, 'IFCBUILDINGSTOREY').map((id) => {
    const s = api.GetLine(modelID, id);
    return { name: attr(s.Name) || '—', elevationM: (Number(attr(s.Elevation)) || 0) * lengthUnit.toMetres };
  });

  // --- element type census over everything that actually rendered ---
  const typeNameCache = new Map();
  const elementTypeCounts = {};
  for (const expressID of elementBoxes.keys()) {
    let name;
    try {
      const code = api.GetLineType(modelID, expressID);
      if (!typeNameCache.has(code)) typeNameCache.set(code, api.GetNameFromTypeCode(code) || 'IfcProduct');
      name = typeNameCache.get(code);
    } catch {
      name = 'IfcProduct';
    }
    elementTypeCounts[name] = (elementTypeCounts[name] || 0) + 1;
  }

  // --- overall extents (metres) ---
  const modelBox = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
  for (const box of elementBoxes.values()) {
    for (let i = 0; i < 3; i++) {
      modelBox.min[i] = Math.min(modelBox.min[i], box.min[i]);
      modelBox.max[i] = Math.max(modelBox.max[i], box.max[i]);
    }
  }
  const spanX = Number.isFinite(modelBox.min[0]) ? modelBox.max[0] - modelBox.min[0] : 0;
  const spanY = Number.isFinite(modelBox.min[1]) ? modelBox.max[1] - modelBox.min[1] : 0;
  const spanZ = Number.isFinite(modelBox.min[2]) ? modelBox.max[2] - modelBox.min[2] : 0;
  const corridorLengthM = Math.max(spanX, spanZ);
  const corridorWidthM = Math.min(spanX, spanZ);

  // --- pavement layers ---
  const materialIndex = prebuiltMaterialIndex || buildMaterialIndex(api, modelID);
  const grouped = new Map();

  for (const [expressID, box] of elementBoxes) {
    const { record, displayName } = resolveElementLayer(api, modelID, expressID, materialIndex);
    const key = displayName.toLowerCase();

    // Material-defined thickness is authoritative; fall back to the modelled height.
    const thicknessMm = record?.layers?.length
      ? record.layers.reduce((sum, l) => sum + l.thickness, 0) * lengthUnit.toMetres * 1000
      : (box.max[1] - box.min[1]) * 1000;

    const materials = record?.layers?.map((l) => l.material).filter(Boolean) || [];

    const existing = grouped.get(key);
    if (existing) {
      existing.instanceCount += 1;
      existing.minY = Math.min(existing.minY, box.min[1]);
      existing.maxY = Math.max(existing.maxY, box.max[1]);
      for (const m of materials) if (!existing.materials.includes(m)) existing.materials.push(m);
    } else {
      grouped.set(key, {
        name: displayName,
        code: deriveLayerCode(displayName),
        materials: [...materials],
        thicknessMm: Math.round(thicknessMm * 10) / 10,
        instanceCount: 1,
        minY: box.min[1],
        maxY: box.max[1],
        expressID,
      });
    }
  }

  // Stack bottom-up using the modelled vertical position, then quote reduced levels
  // from the site datum. (Geometry may be shifted by COORDINATE_TO_ORIGIN, but the
  // *ordering* survives translation, and RLs from the datum are what engineers read.)
  const ordered = [...grouped.values()].sort((a, b) => a.minY - b.minY);
  let runningRL = siteElevationM;
  const layers = ordered.map((layer, index) => {
    const baseLevelM = runningRL;
    const topLevelM = runningRL + layer.thicknessMm / 1000;
    runningRL = topLevelM;
    return {
      sortOrder: index + 1,
      name: layer.name,
      code: layer.code,
      materialType: layer.materials.join(', ') || '—',
      thicknessMm: layer.thicknessMm,
      instanceCount: layer.instanceCount,
      baseLevelM: Number(baseLevelM.toFixed(3)),
      topLevelM: Number(topLevelM.toFixed(3)),
      expressID: layer.expressID,
      // Progress/cost are NOT in the IFC — filled in by an Excel upload
      status: null,
      progressPercent: null,
    };
  });

  const totalThicknessMm = layers.reduce((sum, l) => sum + l.thicknessMm, 0);

  // Georeferenced plan of the corridor, for the satellite map
  const trueNorth = readTrueNorth(api, modelID);
  const roadPath = buildRoadPath(elementBoxes, { latitude, longitude }, trueNorth);

  // --- phase-2 resolver index: elements, model groups, segmentation ---
  const elementIndex = buildElementIndex(api, modelID, elementBoxes, materialIndex);
  const groupIndex = buildGroupIndex(api, modelID, elementBoxes);
  const alignment = buildAlignment(elementIndex);

  return {
    roadPath,
    elementIndex,
    groupIndex,
    alignment,
    projectName: attr(project?.LongName) || attr(project?.Name) || '—',
    projectNumber: attr(project?.Name) || '—',
    projectPhase: attr(project?.Phase) || '—',
    siteName: attr(site?.Name) || '—',
    buildingName: attr(building?.LongName) || attr(building?.Name) || '—',
    schema: (() => { try { return api.GetModelSchema(modelID) || '—'; } catch { return '—'; } })(),
    lengthUnit: lengthUnit.name,
    latitude,
    longitude,
    siteElevationM: Number(siteElevationM.toFixed(3)),
    storeys,
    elementTypeCounts,
    elementCount: elementBoxes.size,
    corridorLengthM: Number(corridorLengthM.toFixed(3)),
    // Prefer the carriageway width measured across the alignment. The raw bounding-box
    // cross-span is wrong for a curved road — it also counts the lateral swing of the
    // curve (a 9 m road snaking +/-30 m would otherwise report ~68 m wide).
    corridorWidthM: roadPath?.widthM ?? Number(corridorWidthM.toFixed(3)),
    modelHeightM: Number(spanY.toFixed(3)),
    totalThicknessMm: Math.round(totalThicknessMm * 10) / 10,
    layers,
  };
}

async function parseIfc(arrayBuffer, onProgress) {
  const api = await getIfcApi();
  const modelID = api.OpenModel(new Uint8Array(arrayBuffer), {
    COORDINATE_TO_ORIGIN: true,
  });

  const inner = new THREE.Group();
  const materialCache = new Map();
  const elementBoxes = new Map(); // expressID -> world-space AABB, drives layer ordering
  // Pavement materials are shared per layer code so a status tint is one assignment
  const layerMaterials = new Map();
  // expressID -> its meshes, so a single element can be retinted on its own once the
  // resolver says which progress row describes it
  const meshesByElement = new Map();
  let meshCount = 0;

  // Built up front: the geometry pass needs it to decide which texture each element gets
  const materialIndex = buildMaterialIndex(api, modelID);
  const layerCodeByElement = new Map();

  api.StreamAllMeshes(modelID, (flatMesh, index, total) => {
    const placedGeometries = flatMesh.geometries;

    // Classify once per element, not per geometry
    let layerCode = layerCodeByElement.get(flatMesh.expressID);
    if (layerCode === undefined) {
      const { code, displayName } = resolveElementLayer(api, modelID, flatMesh.expressID, materialIndex);
      layerCode = TEXTURED_LAYER_CODES.has(code) ? code : null;
      if (layerCode && !layerMaterials.has(layerCode)) {
        const material = createLayerMaterial(layerCode, displayName);
        if (material) layerMaterials.set(layerCode, material);
      }
      if (layerCode && !layerMaterials.has(layerCode)) layerCode = null;
      layerCodeByElement.set(flatMesh.expressID, layerCode);
    }

    for (let i = 0; i < placedGeometries.size(); i++) {
      const placed = placedGeometries.get(i);
      const geometry = api.GetGeometry(modelID, placed.geometryExpressID);

      const vertexData = api.GetVertexArray(geometry.GetVertexData(), geometry.GetVertexDataSize());
      const indexData = api.GetIndexArray(geometry.GetIndexData(), geometry.GetIndexDataSize());
      if (!vertexData.length || !indexData.length) {
        geometry.delete();
        continue;
      }

      // Accumulate the element's world AABB while the vertices are already in hand
      const m = placed.flatTransformation;
      let box = elementBoxes.get(flatMesh.expressID);
      if (!box) {
        box = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
        elementBoxes.set(flatMesh.expressID, box);
      }
      for (let v = 0; v < vertexData.length / 6; v++) {
        const x = vertexData[v * 6], y = vertexData[v * 6 + 1], z = vertexData[v * 6 + 2];
        const wx = m[0] * x + m[4] * y + m[8] * z + m[12];
        const wy = m[1] * x + m[5] * y + m[9] * z + m[13];
        const wz = m[2] * x + m[6] * y + m[10] * z + m[14];
        if (wx < box.min[0]) box.min[0] = wx; if (wx > box.max[0]) box.max[0] = wx;
        if (wy < box.min[1]) box.min[1] = wy; if (wy > box.max[1]) box.max[1] = wy;
        if (wz < box.min[2]) box.min[2] = wz; if (wz > box.max[2]) box.max[2] = wz;
      }

      // Only pavement layers need world-projected UVs; everything else keeps its IFC colour
      const bufferGeometry = buildBufferGeometry(
        vertexData,
        indexData,
        layerCode ? placed.flatTransformation : null
      );

      let material = layerMaterials.get(layerCode);
      if (!material) {
        const { x: r, y: g, z: b, w: a } = placed.color;
        const key = `${r.toFixed(3)}_${g.toFixed(3)}_${b.toFixed(3)}_${a.toFixed(3)}`;
        material = materialCache.get(key);
        if (!material) {
          material = new THREE.MeshStandardMaterial({
            color: new THREE.Color(r, g, b),
            transparent: a < 1,
            opacity: a,
            side: THREE.DoubleSide,
            roughness: 0.75,
            metalness: 0.05,
          });
          materialCache.set(key, material);
        }
      }

      const mesh = new THREE.Mesh(bufferGeometry, material);
      mesh.matrixAutoUpdate = false;
      mesh.matrix.fromArray(placed.flatTransformation);
      // baseMaterial is kept so a status tint can be swapped in and back out
      mesh.userData = { isIfcElement: true, expressID: flatMesh.expressID, layerCode, baseMaterial: material };

      const siblings = meshesByElement.get(flatMesh.expressID);
      if (siblings) siblings.push(mesh);
      else meshesByElement.set(flatMesh.expressID, [mesh]);

      inner.add(mesh);
      meshCount++;
      geometry.delete();
    }

    if (onProgress && total && index % 250 === 0) {
      onProgress(Math.round((index / total) * 100));
    }
  });

  if (meshCount === 0) {
    api.CloseModel(modelID);
    throw new Error('No renderable geometry found in this IFC file.');
  }

  const { wrapper, size } = normalizeModel(inner);

  // Tinted material copies made on demand by applyStatusByElement, tracked so they
  // can be released with the model rather than outliving it.
  const statusVariants = new Set();

  let summary = null;
  try {
    summary = extractModelSummary(api, modelID, elementBoxes, materialIndex);
  } catch (err) {
    // Metadata is a bonus — never let it stop the model from rendering
    console.warn('[IFC] Metadata extraction failed, rendering geometry only:', err);
  }

  return {
    group: wrapper,
    meshCount,
    size,
    summary,
    texturedLayerCodes: [...layerMaterials.keys()],
    /**
     * Tints whole layers by construction status. Coarse — every element of a layer
     * takes one colour — but it is all that is possible before the resolver has
     * bound rows to individual elements.
     *
     * The tint multiplies the texture rather than replacing it, so the asphalt /
     * aggregate / soil detail stays visible underneath.
     */
    applyStatusByCode(statusByCode = {}) {
      // Undo any per-element assignment, otherwise the two fight over the meshes
      for (const meshes of meshesByElement.values()) {
        for (const mesh of meshes) {
          if (mesh.material !== mesh.userData.baseMaterial) mesh.material = mesh.userData.baseMaterial;
        }
      }
      for (const [code, material] of layerMaterials) {
        applyStatusTint(material, statusByCode[code] || null);
      }
    },

    /**
     * Tints each element individually from the resolved progress rows, so two
     * segments of the same layer can show different states — the whole point of
     * binding rows to GlobalIds rather than to layer codes.
     *
     * Elements with no row keep their untinted material.
     */
    applyStatusByElement(statusByExpressID) {
      // The shared layer materials must be neutral again, or a leftover layer-wide
      // tint would show through on every element that has no row of its own.
      for (const material of layerMaterials.values()) applyStatusTint(material, null);

      let tinted = 0;
      for (const [expressID, meshes] of meshesByElement) {
        const status = statusByExpressID?.get?.(expressID)?.status || null;
        for (const mesh of meshes) {
          const base = mesh.userData.baseMaterial;
          const next = status ? statusVariant(base, status, statusVariants) : base;
          if (mesh.material !== next) mesh.material = next;
        }
        if (status) tinted++;
      }
      return tinted;
    },
    /** Reads element metadata straight from the still-open web-ifc model. */
    getElementInfo(expressID) {
      try {
        const typeCode = api.GetLineType(modelID, expressID);
        const line = api.GetLine(modelID, expressID);
        return {
          expressID,
          ifcType: api.GetNameFromTypeCode(typeCode) || 'IFCELEMENT',
          name: line?.Name?.value || line?.LongName?.value || '—',
          globalId: line?.GlobalId?.value || '—',
          objectType: line?.ObjectType?.value || '—',
        };
      } catch {
        return { expressID, ifcType: 'IFCELEMENT', name: '—', globalId: '—', objectType: '—' };
      }
    },
    dispose() {
      try {
        api.CloseModel(modelID);
      } catch {
        /* model already closed */
      }
      disposeGroup(wrapper);
      // Variants not currently attached to a mesh are missed by disposeGroup
      for (const material of statusVariants) material.dispose();
      statusVariants.clear();
    },
  };
}

async function parseGltf(arrayBuffer) {
  const gltf = await new Promise((resolve, reject) => {
    new GLTFLoader().parse(arrayBuffer, '', resolve, reject);
  });

  const inner = gltf.scene;
  let meshCount = 0;
  inner.traverse((child) => {
    if (child.isMesh) {
      meshCount++;
      child.userData = { ...child.userData, isIfcElement: true, elementName: child.name };
    }
  });

  // glTF is already Y-up
  const { wrapper, size } = normalizeModel(inner);

  return {
    group: wrapper,
    meshCount,
    size,
    getElementInfo(_expressID, object) {
      return {
        expressID: object?.id ?? '—',
        ifcType: 'GLTF_MESH',
        name: object?.name || '—',
        globalId: '—',
        objectType: object?.parent?.name || '—',
      };
    },
    dispose() {
      disposeGroup(wrapper);
    },
  };
}

export function disposeGroup(group) {
  if (!group) return;
  group.traverse((child) => {
    if (child.isMesh) {
      child.geometry?.dispose();
      const material = child.material;
      if (Array.isArray(material)) material.forEach((m) => m.dispose());
      else material?.dispose();
    }
  });
}

/**
 * Reads a File and returns { group, meshCount, size, getElementInfo, dispose }.
 * Throws with a user-presentable message on failure.
 */
export async function loadBimModelFile(file, onProgress) {
  const extension = file.name.split('.').pop()?.toLowerCase();
  const arrayBuffer = await file.arrayBuffer();

  if (extension === 'ifc') return parseIfc(arrayBuffer, onProgress);
  if (extension === 'glb' || extension === 'gltf') return parseGltf(arrayBuffer);

  throw new Error(`Unsupported file type ".${extension}". Upload an .ifc, .glb or .gltf file.`);
}
