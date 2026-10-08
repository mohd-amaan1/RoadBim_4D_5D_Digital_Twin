// Alignment context from a KMZ/KML (e.g. a Civil 3D export): the longest line is taken as the
// alignment, every other line as context (embankments, hatching). Output is a compact local
// metric frame: east/north metres from the alignment's first point.
import { tick } from './util.js';

const MAX_SEGMENTS = 45000;

async function inflateRaw(bytes) {
  if (typeof DecompressionStream === 'undefined') throw new Error('This browser cannot open .kmz files. Unzip it and upload the .kml inside.');
  const ds = new DecompressionStream('deflate-raw');
  const out = new Response(new Blob([bytes]).stream().pipeThrough(ds));
  return new Uint8Array(await out.arrayBuffer());
}

async function kmlFromKmz(buf) {
  const dv = new DataView(buf);
  let eocd = -1;
  for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 70000); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('This .kmz is not a valid zip file.');
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const dec = new TextDecoder();
  for (let n = 0; n < count; n++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true), extraLen = dv.getUint16(p + 30, true), commentLen = dv.getUint16(p + 32, true);
    const local = dv.getUint32(p + 42, true);
    const name = dec.decode(new Uint8Array(buf, p + 46, nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    if (!/\.kml$/i.test(name)) continue;
    const start = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
    const data = new Uint8Array(buf, start, csize);
    const raw = method === 0 ? data : method === 8 ? await inflateRaw(data) : null;
    if (!raw) throw new Error('The .kml inside this .kmz uses an unsupported compression.');
    return dec.decode(raw);
  }
  throw new Error('No .kml file was found inside this .kmz.');
}

export async function parseAlignment(file, { onProgress = () => {} } = {}) {
  onProgress(0.05, 'Opening');
  const buf = await file.arrayBuffer();
  const text = /\.kmz$/i.test(file.name) || new Uint8Array(buf, 0, 2)[0] === 0x50 ? await kmlFromKmz(buf) : new TextDecoder().decode(buf);
  onProgress(0.25, 'Reading lines');
  await tick();
  // Stream through <coordinates> blocks with a regex; a DOM for a 20+ MB KML is slow.
  const lines = [];
  const re = /<(LineString|LinearRing)\b[\s\S]*?<coordinates>([\s\S]*?)<\/coordinates>/g;
  let m, k = 0;
  while ((m = re.exec(text))) {
    const pts = [];
    for (const t of m[2].trim().split(/\s+/)) { const c = t.split(','); const lon = +c[0], lat = +c[1]; if (Number.isFinite(lon) && Number.isFinite(lat)) pts.push(lon, lat); }
    if (pts.length >= 4) lines.push(pts);
    if ((++k & 4095) === 0) { onProgress(0.25 + 0.5 * (m.index / text.length), 'Reading lines'); await tick(); }
  }
  if (!lines.length) throw new Error('No lines were found in this KML.');
  const lenDeg = (pts) => { let s = 0; for (let i = 2; i < pts.length; i += 2) s += Math.hypot((pts[i] - pts[i - 2]) * Math.cos((pts[i + 1] * Math.PI) / 180), pts[i + 1] - pts[i - 1]); return s; };
  let best = 0, bestLen = -1;
  lines.forEach((l, i) => { const L = lenDeg(l); if (L > bestLen) { bestLen = L; best = i; } });
  const al = lines[best];
  // run south to north so chainage grows with pier numbers (P6 Palashbari -> P30 Sualkuchi)
  let alPts = [];
  for (let i = 0; i < al.length; i += 2) alPts.push([al[i], al[i + 1]]);
  if (alPts[0][1] > alPts[alPts.length - 1][1]) alPts = alPts.reverse();
  const [lon0, lat0] = alPts[0];
  const kx = 111320 * Math.cos((lat0 * Math.PI) / 180), ky = 110574;
  const r1 = (v) => Math.round(v * 10) / 10;
  const align = alPts.flatMap(([lo, la]) => [r1((lo - lon0) * kx), r1((la - lat0) * ky)]);
  const others = lines.filter((_, i) => i !== best);
  const total = others.reduce((s, l) => s + l.length / 2 - 1, 0);
  const step = Math.max(1, Math.ceil(total / MAX_SEGMENTS));
  const segs = [];
  let n = 0;
  for (const l of others) for (let i = 2; i < l.length; i += 2) { if (n++ % step) continue; segs.push(r1((l[i - 2] - lon0) * kx), r1((l[i - 1] - lat0) * ky), r1((l[i] - lon0) * kx), r1((l[i + 1] - lat0) * ky)); }
  onProgress(1, 'Done');
  return { version: 1, name: file.name, origin: [lon0, lat0], kx, ky, align, lines: segs };
}

// ---- geometry helpers on the local frame ----
export function chainages(align) {
  const ch = [0];
  for (let i = 2; i < align.length; i += 2) ch.push(ch[ch.length - 1] + Math.hypot(align[i] - align[i - 2], align[i + 1] - align[i - 1]));
  return ch;
}
export function pointAt(align, ch, c) {
  const n = ch.length;
  if (c <= 0) return { e: align[0], n: align[1], dir: Math.atan2(align[3] - align[1], align[2] - align[0]) };
  for (let i = 1; i < n; i++) {
    if (ch[i] >= c || i === n - 1) {
      const t = ch[i] > ch[i - 1] ? Math.min(1, (c - ch[i - 1]) / (ch[i] - ch[i - 1])) : 0;
      const ax = align[2 * i - 2], ay = align[2 * i - 1], bx = align[2 * i], by = align[2 * i + 1];
      return { e: ax + (bx - ax) * t, n: ay + (by - ay) * t, dir: Math.atan2(by - ay, bx - ax) };
    }
  }
  return { e: align[align.length - 2], n: align[align.length - 1], dir: 0 };
}
