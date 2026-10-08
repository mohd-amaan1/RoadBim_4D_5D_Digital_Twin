import * as THREE from 'three';

/**
 * Procedurally generated pavement textures.
 *
 * Drawn onto a canvas at runtime rather than shipped as image files: no binary
 * assets, no network fetch, and the tiling is seamless because every texture is
 * authored to wrap. Each kind also gets a bump map derived from its own luminance,
 * which is what actually sells the "real material" look under the studio lighting.
 *
 * Layer mapping (per the standard road cross-section):
 *   BC  -> Asphalt Concrete (AC) surface — dark grey/black asphalt
 *   PCC -> Portland Cement Concrete     — light grey concrete
 *   DBM -> Dense bituminous binder      — coarser, browner asphalt
 *   WMM -> Crushed Aggregate Base Course — angular crushed stone
 *   GSB -> Granular Subbase             — gravel, sand and aggregate mix
 *   SUB -> Compacted Subgrade           — natural compacted soil
 */

const SIZE = 512;

/** Deterministic PRNG so a given layer looks identical on every reload. */
function mulberry32(seed) {
  return function random() {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function newCanvas() {
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  return canvas;
}

/**
 * Draws at wrapped offsets too, so shapes crossing an edge reappear on the far side
 * and the texture tiles seamlessly. Only offsets whose copy actually overlaps the
 * canvas are painted — the interior majority of shapes therefore draw exactly once.
 */
function drawWrapped(ctx, x, y, radius, paint) {
  const near = (v) => v + radius >= 0 && v - radius <= SIZE;
  for (const dx of [0, -SIZE, SIZE]) {
    const px = x + dx;
    if (!near(px)) continue;
    for (const dy of [0, -SIZE, SIZE]) {
      const py = y + dy;
      if (!near(py)) continue;
      paint(px, py);
    }
  }
}

function angularStone(ctx, rand, x, y, radius, fill, stroke) {
  const points = 4 + Math.floor(rand() * 3);
  drawWrapped(ctx, x, y, radius, (cx, cy) => {
    ctx.beginPath();
    for (let i = 0; i < points; i++) {
      const angle = (i / points) * Math.PI * 2 + rand() * 0.35;
      const r = radius * (0.6 + rand() * 0.6);
      const px = cx + Math.cos(angle) * r;
      const py = cy + Math.sin(angle) * r;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    if (stroke) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  });
}

function roundStone(ctx, rand, x, y, radius, fill) {
  drawWrapped(ctx, x, y, radius, (cx, cy) => {
    const grad = ctx.createRadialGradient(cx - radius * 0.3, cy - radius * 0.3, radius * 0.1, cx, cy, radius);
    grad.addColorStop(0, fill.light);
    grad.addColorStop(1, fill.dark);
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();
  });
}

/** Per-pixel grain — the fine speckle that stops a surface reading as flat plastic. */
function addGrain(ctx, rand, strength) {
  const img = ctx.getImageData(0, 0, SIZE, SIZE);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (rand() - 0.5) * strength;
    d[i] = Math.max(0, Math.min(255, d[i] + n));
    d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + n));
    d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + n));
  }
  ctx.putImageData(img, 0, 0);
}

function blotches(ctx, rand, count, radiusRange, colors, alpha) {
  for (let i = 0; i < count; i++) {
    const x = rand() * SIZE;
    const y = rand() * SIZE;
    const r = radiusRange[0] + rand() * (radiusRange[1] - radiusRange[0]);
    const color = colors[Math.floor(rand() * colors.length)];
    drawWrapped(ctx, x, y, r, (cx, cy) => {
      const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
      grad.addColorStop(0, `${color}${alpha}`);
      grad.addColorStop(1, `${color}00`);
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fillStyle = grad;
      ctx.fill();
    });
  }
}

// ---------------------------------------------------------------------------
// Per-material painters
// ---------------------------------------------------------------------------

function paintAsphalt(ctx, rand, { base, fleck, coarse }) {
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, SIZE, SIZE);

  blotches(ctx, rand, 40, [30, 90], ['#000000', '#3a3f47'], '22');

  // embedded aggregate poking through the bitumen
  const stoneCount = coarse ? 2600 : 1700;
  for (let i = 0; i < stoneCount; i++) {
    const r = 0.8 + rand() * (coarse ? 3.2 : 2.0);
    const shade = 90 + Math.floor(rand() * 90);
    angularStone(ctx, rand, rand() * SIZE, rand() * SIZE, r, `rgba(${shade},${shade + 3},${shade + 8},0.55)`, null);
  }

  // brighter chippings
  for (let i = 0; i < 300; i++) {
    const r = 0.6 + rand() * 1.6;
    angularStone(ctx, rand, rand() * SIZE, rand() * SIZE, r, fleck, null);
  }

  addGrain(ctx, rand, 26);
}

function paintConcrete(ctx, rand) {
  ctx.fillStyle = '#b9bcb7';
  ctx.fillRect(0, 0, SIZE, SIZE);

  blotches(ctx, rand, 70, [40, 130], ['#ffffff', '#9a9d99', '#8f938e'], '26');

  // air pores
  for (let i = 0; i < 1400; i++) {
    const r = 0.5 + rand() * 1.6;
    drawWrapped(ctx, rand() * SIZE, rand() * SIZE, r, (cx, cy) => {
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(120,124,120,${0.25 + rand() * 0.35})`;
      ctx.fill();
    });
  }

  addGrain(ctx, rand, 16);
}

function paintCrushedAggregate(ctx, rand) {
  ctx.fillStyle = '#4f4a45';
  ctx.fillRect(0, 0, SIZE, SIZE);

  const palette = ['#8c857b', '#7a7369', '#9b9184', '#6e675e', '#a39887', '#5f5951', '#8f8378'];

  // large angular stones first, then progressively smaller to fill the voids
  for (const [count, min, max] of [[420, 8, 18], [900, 4, 9], [1800, 2, 5]]) {
    for (let i = 0; i < count; i++) {
      const r = min + rand() * (max - min);
      const fill = palette[Math.floor(rand() * palette.length)];
      angularStone(ctx, rand, rand() * SIZE, rand() * SIZE, r, fill, 'rgba(35,32,29,0.55)');
    }
  }

  blotches(ctx, rand, 30, [40, 110], ['#2b2724'], '30');
  addGrain(ctx, rand, 22);
}

function paintGranularSubbase(ctx, rand) {
  // sandy matrix
  ctx.fillStyle = '#9c8a68';
  ctx.fillRect(0, 0, SIZE, SIZE);
  blotches(ctx, rand, 60, [30, 110], ['#b4a480', '#8a7854', '#c2b494'], '30');

  // gravel: rounded, mixed sizes, greys and browns together
  const pebbles = [
    { light: '#cfc4ae', dark: '#8e836d' },
    { light: '#b9ab8e', dark: '#7b6f57' },
    { light: '#a9a49b', dark: '#6f6a61' },
    { light: '#c8bda6', dark: '#87795e' },
  ];
  for (const [count, min, max] of [[300, 5, 11], [800, 3, 6], [1600, 1.2, 3]]) {
    for (let i = 0; i < count; i++) {
      const r = min + rand() * (max - min);
      roundStone(ctx, rand, rand() * SIZE, rand() * SIZE, r, pebbles[Math.floor(rand() * pebbles.length)]);
    }
  }

  addGrain(ctx, rand, 30);
}

function paintSubgradeSoil(ctx, rand) {
  ctx.fillStyle = '#6a4d34';
  ctx.fillRect(0, 0, SIZE, SIZE);

  // compaction mottling
  blotches(ctx, rand, 150, [25, 95], ['#54402c', '#7d5c3e', '#8a6845', '#43331f'], '38');

  // clods
  for (let i = 0; i < 700; i++) {
    const r = 2 + rand() * 7;
    const shade = 60 + Math.floor(rand() * 45);
    angularStone(ctx, rand, rand() * SIZE, rand() * SIZE, r,
      `rgba(${shade + 42},${shade + 22},${shade},0.5)`, null);
  }

  // occasional small stones worked into the fill
  for (let i = 0; i < 130; i++) {
    const r = 1.2 + rand() * 2.6;
    angularStone(ctx, rand, rand() * SIZE, rand() * SIZE, r, 'rgba(150,142,128,0.55)', null);
  }

  // roller / compaction lines, very subtle
  ctx.globalAlpha = 0.06;
  for (let i = 0; i < 26; i++) {
    const y = rand() * SIZE;
    ctx.fillStyle = rand() > 0.5 ? '#3a2b1c' : '#8b6a48';
    ctx.fillRect(0, y, SIZE, 1 + rand() * 3);
  }
  ctx.globalAlpha = 1;

  addGrain(ctx, rand, 30);
}

const PAINTERS = {
  asphalt: (ctx, rand) => paintAsphalt(ctx, rand, { base: '#26292e', fleck: 'rgba(176,181,188,0.5)', coarse: false }),
  asphaltCoarse: (ctx, rand) => paintAsphalt(ctx, rand, { base: '#32302d', fleck: 'rgba(168,160,148,0.5)', coarse: true }),
  concrete: paintConcrete,
  crushedAggregate: paintCrushedAggregate,
  granularSubbase: paintGranularSubbase,
  subgradeSoil: paintSubgradeSoil,
};

/** Surface response per material — matte soil vs. slightly specular asphalt. */
const SURFACE = {
  asphalt: { roughness: 0.82, metalness: 0.06, bumpScale: 0.018, tiles: 1.6 },
  asphaltCoarse: { roughness: 0.88, metalness: 0.05, bumpScale: 0.026, tiles: 1.4 },
  concrete: { roughness: 0.74, metalness: 0.03, bumpScale: 0.014, tiles: 1.8 },
  crushedAggregate: { roughness: 0.96, metalness: 0.0, bumpScale: 0.05, tiles: 1.1 },
  granularSubbase: { roughness: 0.95, metalness: 0.0, bumpScale: 0.042, tiles: 1.2 },
  subgradeSoil: { roughness: 1.0, metalness: 0.0, bumpScale: 0.038, tiles: 1.0 },
};

const SEEDS = {
  asphalt: 1337, asphaltCoarse: 4242, concrete: 90210,
  crushedAggregate: 5150, granularSubbase: 8675, subgradeSoil: 31415,
};

/** Greyscale height map derived from the colour texture's own luminance. */
function bumpFromCanvas(source) {
  const canvas = newCanvas();
  const ctx = canvas.getContext('2d');
  ctx.drawImage(source, 0, 0);
  const img = ctx.getImageData(0, 0, SIZE, SIZE);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    d[i] = d[i + 1] = d[i + 2] = lum;
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

const textureCache = new Map();

/** Builds (and caches) the map + bumpMap pair for a material kind. */
export function getRoadTexture(kind) {
  if (textureCache.has(kind)) return textureCache.get(kind);

  const painter = PAINTERS[kind] || PAINTERS.crushedAggregate;
  const surface = SURFACE[kind] || SURFACE.crushedAggregate;

  const canvas = newCanvas();
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  painter(ctx, mulberry32(SEEDS[kind] || 1));

  const map = new THREE.CanvasTexture(canvas);
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 8;
  map.repeat.set(1 / surface.tiles, 1 / surface.tiles);

  const bumpMap = new THREE.CanvasTexture(bumpFromCanvas(canvas));
  bumpMap.wrapS = bumpMap.wrapT = THREE.RepeatWrapping;
  bumpMap.anisotropy = 8;
  bumpMap.repeat.copy(map.repeat);

  const entry = { map, bumpMap, ...surface };
  textureCache.set(kind, entry);
  return entry;
}

/** Standard pavement code -> texture kind. */
export const LAYER_TEXTURE_KIND = {
  BC: 'asphalt',
  AC: 'asphalt',
  SMA: 'asphalt',
  OGFC: 'asphalt',
  PCC: 'concrete',
  DBM: 'asphaltCoarse',
  'DBM-1': 'asphaltCoarse',
  'DBM-2': 'asphaltCoarse',
  WMM: 'crushedAggregate',
  GSB: 'granularSubbase',
  SUB: 'subgradeSoil',
  REF: 'subgradeSoil',
};

/** Codes we are confident enough about to re-skin with a pavement material. */
export const TEXTURED_LAYER_CODES = new Set(Object.keys(LAYER_TEXTURE_KIND));

/**
 * Picks a texture kind for a layer, using the name to separate a concrete
 * surface course (PCC) from an asphalt one (AC) when the code alone is ambiguous.
 */
export function textureKindForLayer(code, layerName = '') {
  if ((code === 'BC' || code === 'AC') && /\b(pcc|cement|concrete|rigid)\b/i.test(layerName)
      && !/bitumin|asphalt/i.test(layerName)) {
    return 'concrete';
  }
  return LAYER_TEXTURE_KIND[code] || null;
}

/**
 * Status tint applied *over* the texture.
 *
 * `color` multiplies the map, so it is deliberately kept pale — a saturated colour
 * would crush the texture detail to a flat block. A low emissive in the same hue
 * lifts it back up so the status still reads at a glance on dark asphalt.
 */
const STATUS_TINTS = {
  Completed: { tint: 0x6EE7A8, mix: 0.5, emissive: 0x0d4028, intensity: 0.16 },
  'In-Progress': { tint: 0xFBBF4A, mix: 0.5, emissive: 0x4a3005, intensity: 0.16 },
  Delayed: { tint: 0xF87171, mix: 0.55, emissive: 0x5c1414, intensity: 0.3 },
  'Not Started': { tint: 0x94A3B8, mix: 0.22, emissive: 0x000000, intensity: 0 },
};

const WHITE = new THREE.Color(0xffffff);

/**
 * The same status hues the 3D tint uses, as CSS colours for the plan map and legends.
 * Shared so a segment that reads "delayed" in the viewer reads delayed on the map too —
 * two palettes would drift the moment one was edited.
 */
export const STATUS_COLORS = {
  Completed: "#6EE7A8",
  "In-Progress": "#FBBF4A",
  Delayed: "#F87171",
  "Not Started": "#94A3B8",
};

/** Untinted: no progress row is bound to the element. */
export const UNBOUND_COLOR = "#475569";

export function statusColor(status) {
  return STATUS_COLORS[status] || UNBOUND_COLOR;
}

/** Null/unknown status leaves the raw material look untouched. */
export function applyStatusTint(material, status) {
  if (!material) return;
  const spec = status ? STATUS_TINTS[status] : null;

  if (!spec) {
    material.color.copy(WHITE);
    material.emissive.setHex(0x000000);
    material.emissiveIntensity = 0;
  } else {
    material.color.copy(WHITE).lerp(new THREE.Color(spec.tint), spec.mix);
    material.emissive.setHex(spec.emissive);
    material.emissiveIntensity = spec.intensity;
  }
  material.needsUpdate = true;
}

/** Textured MeshStandardMaterial for a pavement layer, untinted by default. */
export function createLayerMaterial(code, layerName = '') {
  const kind = textureKindForLayer(code, layerName);
  if (!kind) return null;

  const { map, bumpMap, roughness, metalness, bumpScale } = getRoadTexture(kind);
  const material = new THREE.MeshStandardMaterial({
    map,
    bumpMap,
    bumpScale,
    roughness,
    metalness,
    color: 0xffffff,
  });
  material.userData.textureKind = kind;
  material.userData.layerCode = code;
  return material;
}

/**
 * One tinted copy of a material per status, so two elements of the same layer can
 * show different progress. Without this every subgrade slab in the model shares a
 * single material and the whole layer has to take one colour.
 *
 * `clone()` copies texture *references*, so all variants share the cached maps —
 * the extra cost is one small material object, not another texture upload.
 * Variants are registered on `owner` so the model can release them on dispose.
 */
const variantCache = new WeakMap();

export function statusVariant(base, status, owner) {
  if (!base) return null;
  if (!status) return base;

  let byStatus = variantCache.get(base);
  if (!byStatus) {
    byStatus = new Map();
    variantCache.set(base, byStatus);
  }

  const existing = byStatus.get(status);
  if (existing) return existing;

  const clone = base.clone();
  clone.userData = { ...base.userData, statusVariant: status };
  applyStatusTint(clone, status);
  byStatus.set(status, clone);
  if (owner) owner.add(clone);
  return clone;
}

/** Textures are shared and cached; only per-model materials should be disposed. */
export function disposeTextureCache() {
  for (const { map, bumpMap } of textureCache.values()) {
    map.dispose();
    bumpMap.dispose();
  }
  textureCache.clear();
}
