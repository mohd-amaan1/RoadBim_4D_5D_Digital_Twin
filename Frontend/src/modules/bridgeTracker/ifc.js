// A compact IFC (STEP) reader: entity index, placements, the geometry Revit exports for this
// bridge (extrusions of arbitrary / parametric profiles, mapped items, face sets, B-reps) and
// property sets. Output is one three.js BufferGeometry per element, in metres, Y up.
import * as THREE from 'three';
import { tick } from './util.js';

class Ref { constructor(r) { this.r = r; } }
const isRef = (v) => v instanceof Ref;

const SKIP_PREFIX = /^IFC(REL|PROPERTY|QUANTITY|ELEMENTQUANTITY|CARTESIAN|DIRECTION|AXIS|POLY|INDEXED|SHAPE|PRODUCTDEFINITION|EXTRUDED|STYLED|SURFACE|PRESENTATION|LOCALPLACEMENT|ARBITRARY|MAPPED|REPRESENTATION|COLOUR|MATERIAL|GEOMETRIC|SIUNIT|UNIT|MEASURE|DIMENSIONAL|CONVERSION|OWNER|PERSON|ORGANIZATION|APPLICATION|TRIMMED|COMPOSITE|CIRCLE|ELLIPSE|LINE|VECTOR|FACE|CLOSEDSHELL|OPENSHELL|CONNECTED|TRIANGULATED|BOOLEAN|BOUNDING|RECTANGLE|ISHAPE|LSHAPE|TSHAPE|USHAPE|CSHAPE|ZSHAPE|DERIVED|PLANE|HALFSPACE|POLYGONAL|SWEPT|REVOLVED|BLOCK|CURVE|TEXT|FILL|DRAUGHTING|OBJECTIVE|GRID|OPENING|VIRTUAL|ANNOTATION|PROJECT|SITE|BUILDINGSTOREY|BUILDING$|SPACE|BRIDGE$|FACILITY|ZONE|GROUP|SYSTEM|CLASSIFICATION|DOCUMENT|EXTERNAL|LIBRARY|APPROVAL|ACTOR|TASK|WORK|COST|TIME|EVENT|RESOURCE|CONSTRAINT|METRIC|TABLE|COMPLEX|PHYSICAL|SIMPLE|PRE|ALIGNMENT|MAP|COORDINATE)/;

function decodeStepString(s) {
  let out = s.replace(/''/g, "'");
  out = out.replace(/\\X2\\([0-9A-F]+)\\X0\\/gi, (_, hex) => { let r = ''; for (let i = 0; i < hex.length; i += 4) r += String.fromCharCode(parseInt(hex.substr(i, 4), 16)); return r; });
  out = out.replace(/\\X\\([0-9A-F]{2})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
  out = out.replace(/\\S\\(.)/g, (_, c) => String.fromCharCode(c.charCodeAt(0) + 128));
  return out;
}

function parseArgString(s) {
  let i = 0;
  const n = s.length;
  const ws = () => { while (i < n && s.charCodeAt(i) <= 32) i++; };
  function val() {
    ws();
    const c = s[i];
    if (c === '#') { i++; let v = 0; while (i < n) { const d = s.charCodeAt(i); if (d < 48 || d > 57) break; v = v * 10 + (d - 48); i++; } return new Ref(v); }
    if (c === "'") {
      i++; let start = i;
      for (;;) { const j = s.indexOf("'", i); if (j < 0) { i = n; break; } if (s[j + 1] === "'") { i = j + 2; continue; } i = j + 1; return decodeStepString(s.slice(start, j)); }
      return decodeStepString(s.slice(start));
    }
    if (c === '$' || c === '*') { i++; return null; }
    if (c === '.') { const j = s.indexOf('.', i + 1); const e = s.slice(i + 1, j); i = j + 1; return { e }; }
    if (c === '(') { i++; const arr = []; ws(); if (s[i] === ')') { i++; return arr; } for (;;) { arr.push(val()); ws(); if (s[i] === ',') { i++; continue; } if (s[i] === ')') { i++; break; } if (i >= n) break; } return arr; }
    if ((c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z')) {
      let j = i; while (j < n && s[j] !== '(') j++;
      const t = s.slice(i, j).trim().toUpperCase(); i = j + 1;
      const v = val(); ws(); if (s[i] === ')') i++;
      return { t, v };
    }
    let j = i; while (j < n && /[-+0-9.Ee]/.test(s[j])) j++;
    const num = parseFloat(s.slice(i, j)); i = j; return num;
  }
  const out = [];
  ws();
  if (i >= n) return out;
  for (;;) { out.push(val()); ws(); if (s[i] === ',') { i++; continue; } break; }
  return out;
}

class Step {
  constructor(text) {
    this.text = text;
    this.ents = new Map();
    this.cache = new Map();
    this.byType = new Map();
    this.schema = (text.match(/FILE_SCHEMA\s*\(\s*\(\s*'([^']+)'/i) || [])[1] || '';
    let pos = text.indexOf('DATA;');
    if (pos < 0) throw new Error('This file has no DATA section. Upload an IFC (STEP) file exported from Revit.');
    pos += 5;
    const end = text.length;
    while (pos < end) {
      const hash = text.indexOf('#', pos);
      if (hash < 0) break;
      let j = hash + 1, id = 0, c;
      while ((c = text.charCodeAt(j)) >= 48 && c <= 57) { id = id * 10 + (c - 48); j++; }
      while (j < end && (text.charCodeAt(j) <= 32 || text[j] === '=')) j++;
      const k0 = j;
      while (j < end && text[j] !== '(' && text[j] !== ';') j++;
      if (text[j] !== '(') { pos = j + 1; continue; }
      const type = text.slice(k0, j).trim().toUpperCase();
      let depth = 0, m = j, inStr = false;
      for (; m < end; m++) {
        const ch = text.charCodeAt(m);
        if (inStr) { if (ch === 39) { if (text.charCodeAt(m + 1) === 39) m++; else inStr = false; } continue; }
        if (ch === 39) inStr = true;
        else if (ch === 40) depth++;
        else if (ch === 41) { depth--; if (depth === 0) break; }
      }
      this.ents.set(id, { t: type, a: j + 1, b: m });
      if (!this.byType.has(type)) this.byType.set(type, []);
      this.byType.get(type).push(id);
      pos = m + 1;
    }
  }
  type(id) { const e = this.ents.get(id); return e ? e.t : null; }
  args(id) {
    let v = this.cache.get(id);
    if (v) return v;
    const e = this.ents.get(id);
    if (!e) return null;
    v = parseArgString(this.text.slice(e.a, e.b));
    this.cache.set(id, v);
    return v;
  }
  ids(type) { return this.byType.get(type) || []; }
}

// ---------- geometry helpers ----------
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

export async function parseIFC(text, { onProgress = () => {}, fileName = '' } = {}) {
  onProgress(0.02, 'Indexing model');
  await tick();
  const st = new Step(text);
  const warnings = new Map();
  const warn = (msg) => warnings.set(msg, (warnings.get(msg) || 0) + 1);

  // units
  let lengthScale = 1, angleScale = 1;
  for (const id of st.ids('IFCSIUNIT')) {
    const a = st.args(id);
    const kind = a[1]?.e, prefix = a[2]?.e, name = a[3]?.e;
    if (kind === 'LENGTHUNIT' && name === 'METRE') lengthScale = { MILLI: 0.001, CENTI: 0.01, DECI: 0.1, KILO: 1000 }[prefix] ?? 1;
  }
  for (const id of st.ids('IFCCONVERSIONBASEDUNIT')) {
    const a = st.args(id);
    const kind = a[1]?.e, name = String(a[2] || '').toUpperCase();
    const mwu = isRef(a[3]) ? st.args(a[3].r) : null;
    const f = mwu ? (typeof mwu[0] === 'object' && mwu[0] ? mwu[0].v : mwu[0]) : 1;
    if (kind === 'LENGTHUNIT') lengthScale = name.includes('FOOT') ? 0.3048 : name.includes('INCH') ? 0.0254 : f;
    if (kind === 'PLANEANGLEUNIT') angleScale = name.includes('DEGREE') ? Math.PI / 180 : f;
  }

  const num = (v) => (typeof v === 'number' ? v : v && typeof v === 'object' && 'v' in v ? num(v.v) : 0);
  const point = (ref) => { const a = st.args(ref.r)[0]; return V(a[0] || 0, a[1] || 0, a[2] || 0); };
  const dir = (ref, def) => { if (!isRef(ref)) return def.clone(); const a = st.args(ref.r)[0]; return V(a[0] || 0, a[1] || 0, a[2] || 0).normalize(); };

  function axis2(ref) {
    const m = new THREE.Matrix4();
    if (!isRef(ref)) return m;
    const t = st.type(ref.r), a = st.args(ref.r);
    const o = isRef(a[0]) ? point(a[0]) : V();
    let z = V(0, 0, 1), x = V(1, 0, 0);
    if (t === 'IFCAXIS2PLACEMENT3D') { z = dir(a[1], z); x = dir(a[2], x); }
    else if (t === 'IFCAXIS2PLACEMENT2D') { x = dir(a[1], x); x.z = 0; x.normalize(); }
    const y = new THREE.Vector3().crossVectors(z, x).normalize();
    x = new THREE.Vector3().crossVectors(y, z).normalize();
    m.makeBasis(x, y, z); m.setPosition(o);
    return m;
  }
  function cartOp(ref) {
    const m = new THREE.Matrix4();
    if (!isRef(ref)) return m;
    const t = st.type(ref.r), a = st.args(ref.r);
    const is3 = t.includes('3D');
    const ax1 = isRef(a[0]) ? dir(a[0], V(1, 0, 0)) : V(1, 0, 0);
    const o = isRef(a[2]) ? point(a[2]) : V();
    const s = typeof a[3] === 'number' ? a[3] : 1;
    let x = ax1, z = is3 && isRef(a[4]) ? dir(a[4], V(0, 0, 1)) : V(0, 0, 1);
    let y = new THREE.Vector3().crossVectors(z, x).normalize();
    x = new THREE.Vector3().crossVectors(y, z).normalize();
    const s2 = t.includes('NONUNIFORM') && typeof a[5] === 'number' ? a[5] : s;
    const s3 = t.includes('NONUNIFORM') && typeof a[6] === 'number' ? a[6] : s;
    m.makeBasis(x.multiplyScalar(s), y.multiplyScalar(s2), z.multiplyScalar(s3)); m.setPosition(o);
    return m;
  }
  const placeCache = new Map();
  function placement(id) {
    if (placeCache.has(id)) return placeCache.get(id);
    let m = new THREE.Matrix4();
    const t = st.type(id);
    if (t === 'IFCLOCALPLACEMENT') {
      const a = st.args(id);
      m = axis2(a[1]);
      if (isRef(a[0])) m = placement(a[0].r).clone().multiply(m);
    }
    placeCache.set(id, m);
    return m;
  }

  // ---- 2D curves -> point lists ----
  const arcSteps = (sweep) => Math.max(6, Math.ceil(Math.abs(sweep) / (Math.PI / 36)));
  function arc3(p1, p2, p3, out) {
    const ax = p1[0], ay = p1[1], bx = p2[0], by = p2[1], cx = p3[0], cy = p3[1];
    const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
    if (Math.abs(d) < 1e-9) { out.push(p2, p3); return; }
    const ux = ((ax * ax + ay * ay) * (by - cy) + (bx * bx + by * by) * (cy - ay) + (cx * cx + cy * cy) * (ay - by)) / d;
    const uy = ((ax * ax + ay * ay) * (cx - bx) + (bx * bx + by * by) * (ax - cx) + (cx * cx + cy * cy) * (bx - ax)) / d;
    const r = Math.hypot(ax - ux, ay - uy);
    const a1 = Math.atan2(ay - uy, ax - ux), a2 = Math.atan2(by - uy, bx - ux), a3 = Math.atan2(cy - uy, cx - ux);
    const norm = (x) => ((x % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    const d13 = norm(a3 - a1), d12 = norm(a2 - a1);
    const sweep = d12 < d13 ? d13 : d13 - 2 * Math.PI;
    const steps = arcSteps(sweep);
    for (let k = 1; k <= steps; k++) { const t = a1 + (sweep * k) / steps; out.push([ux + r * Math.cos(t), uy + r * Math.sin(t)]); }
  }
  function circlePts(cx0, m2, r, t0, t1, out, rx = r, ry = r) {
    const sweep = t1 - t0;
    const steps = arcSteps(sweep);
    for (let k = 0; k <= steps; k++) {
      const t = t0 + (sweep * k) / steps;
      const p = V(rx * Math.cos(t), ry * Math.sin(t), 0).applyMatrix4(m2);
      out.push([p.x, p.y]);
    }
  }
  function curve2d(ref, depth = 0) {
    const out = [];
    if (!isRef(ref) || depth > 12) return out;
    const t = st.type(ref.r), a = st.args(ref.r);
    if (t === 'IFCPOLYLINE') { for (const p of a[0]) { const v = st.args(p.r)[0]; out.push([v[0], v[1]]); } return out; }
    if (t === 'IFCINDEXEDPOLYCURVE') {
      const pl = st.args(a[0].r)[0];
      const P = (i) => pl[i - 1];
      const segs = a[1];
      if (!segs) { for (const p of pl) out.push([p[0], p[1]]); return out; }
      for (const sg of segs) {
        const idx = sg.v;
        if (!out.length) out.push(P(idx[0]).slice(0, 2));
        if (sg.t === 'IFCARCINDEX' && idx.length === 3) arc3(P(idx[0]), P(idx[1]), P(idx[2]), out);
        else for (let k = 1; k < idx.length; k++) out.push(P(idx[k]).slice(0, 2));
      }
      return out;
    }
    if (t === 'IFCCOMPOSITECURVE') {
      for (const sref of a[0]) {
        const sa = st.args(sref.r);
        let pts = curve2d(sa[2], depth + 1);
        if (sa[1] === false || sa[1]?.e === 'F') pts = pts.reverse();
        for (const p of pts) { const q = out[out.length - 1]; if (!q || Math.hypot(q[0] - p[0], q[1] - p[1]) > 1e-6) out.push(p); }
      }
      return out;
    }
    if (t === 'IFCCIRCLE' || t === 'IFCELLIPSE') {
      const m2 = axis2(a[0]);
      if (t === 'IFCCIRCLE') circlePts(null, m2, a[1], 0, 2 * Math.PI, out); else circlePts(null, m2, 0, 0, 2 * Math.PI, out, a[1], a[2]);
      out.pop();
      return out;
    }
    if (t === 'IFCTRIMMEDCURVE') {
      const bt = st.type(a[0].r), ba = st.args(a[0].r);
      const sense = !(a[3] === false || a[3]?.e === 'F');
      if (bt === 'IFCCIRCLE' || bt === 'IFCELLIPSE') {
        const m2 = axis2(ba[0]); const inv = m2.clone().invert();
        const r1 = ba[1], r2 = bt === 'IFCELLIPSE' ? ba[2] : ba[1];
        const trimAngle = (trims) => {
          const pv = trims.find((x) => x && x.t === 'IFCPARAMETERVALUE');
          const pr = trims.find((x) => isRef(x));
          if (pr) { const p = point(pr).applyMatrix4(inv); return Math.atan2(p.y / r2, p.x / r1); }
          if (pv) return pv.v * angleScale;
          return 0;
        };
        let t0 = trimAngle(a[1]), t1 = trimAngle(a[2]);
        if (sense) { while (t1 <= t0) t1 += 2 * Math.PI; } else { while (t1 >= t0) t1 -= 2 * Math.PI; }
        circlePts(null, m2, r1, t0, t1, out, r1, r2);
        return out;
      }
      if (bt === 'IFCLINE') {
        const pts = [a[1], a[2]].map((trims) => { const pr = trims.find((x) => isRef(x)); if (pr) { const p = point(pr); return [p.x, p.y]; } const pv = trims.find((x) => x && x.t === 'IFCPARAMETERVALUE'); const o = point(ba[0]); const va = st.args(ba[1].r); const d = dir(va[0], V(1, 0, 0)).multiplyScalar(va[1]); return [o.x + d.x * pv.v, o.y + d.y * pv.v]; });
        return sense ? pts : pts.reverse();
      }
      warn('Trimmed curve on ' + bt);
      return out;
    }
    warn('Curve type ' + t);
    return out;
  }
  const clean = (pts) => {
    const out = [];
    for (const p of pts) { const q = out[out.length - 1]; if (!q || Math.hypot(q[0] - p[0], q[1] - p[1]) > 1e-6) out.push(p); }
    if (out.length > 2 && Math.hypot(out[0][0] - out[out.length - 1][0], out[0][1] - out[out.length - 1][1]) < 1e-6) out.pop();
    return out;
  };
  const rectPts = (m2, x, y) => [[-x / 2, -y / 2], [x / 2, -y / 2], [x / 2, y / 2], [-x / 2, y / 2]].map(([px, py]) => { const p = V(px, py, 0).applyMatrix4(m2); return [p.x, p.y]; });
  const circleLoop = (m2, r) => { const o = []; circlePts(null, m2, r, 0, 2 * Math.PI, o); o.pop(); return o; };

  // profile -> [{outer:[[x,y]], holes:[[[x,y]]]}]
  function profile(ref, depth = 0) {
    if (!isRef(ref) || depth > 6) return [];
    const t = st.type(ref.r), a = st.args(ref.r);
    switch (t) {
      case 'IFCARBITRARYCLOSEDPROFILEDEF': return [{ outer: clean(curve2d(a[2])), holes: [] }];
      case 'IFCARBITRARYPROFILEDEFWITHVOIDS': return [{ outer: clean(curve2d(a[2])), holes: (a[3] || []).map((c) => clean(curve2d(c))) }];
      case 'IFCRECTANGLEPROFILEDEF': return [{ outer: rectPts(axis2(a[2]), a[3], a[4]), holes: [] }];
      case 'IFCROUNDEDRECTANGLEPROFILEDEF': return [{ outer: rectPts(axis2(a[2]), a[3], a[4]), holes: [] }];
      case 'IFCRECTANGLEHOLLOWPROFILEDEF': { const m2 = axis2(a[2]); const w = a[5]; return [{ outer: rectPts(m2, a[3], a[4]), holes: [rectPts(m2, a[3] - 2 * w, a[4] - 2 * w)] }]; }
      case 'IFCCIRCLEPROFILEDEF': return [{ outer: circleLoop(axis2(a[2]), a[3]), holes: [] }];
      case 'IFCCIRCLEHOLLOWPROFILEDEF': { const m2 = axis2(a[2]); return [{ outer: circleLoop(m2, a[3]), holes: [circleLoop(m2, a[3] - a[4])] }]; }
      case 'IFCELLIPSEPROFILEDEF': { const o = []; circlePts(null, axis2(a[2]), 0, 0, 2 * Math.PI, o, a[3], a[4]); o.pop(); return [{ outer: o, holes: [] }]; }
      case 'IFCISHAPEPROFILEDEF': {
        const m2 = axis2(a[2]); const W = a[3], D = a[4], tw = a[5], tf = a[6];
        const pts = [[-W / 2, -D / 2], [W / 2, -D / 2], [W / 2, -D / 2 + tf], [tw / 2, -D / 2 + tf], [tw / 2, D / 2 - tf], [W / 2, D / 2 - tf], [W / 2, D / 2], [-W / 2, D / 2], [-W / 2, D / 2 - tf], [-tw / 2, D / 2 - tf], [-tw / 2, -D / 2 + tf], [-W / 2, -D / 2 + tf]];
        return [{ outer: pts.map(([x, y]) => { const p = V(x, y, 0).applyMatrix4(m2); return [p.x, p.y]; }), holes: [] }];
      }
      case 'IFCCOMPOSITEPROFILEDEF': return (a[2] || []).flatMap((p) => profile(p, depth + 1));
      case 'IFCDERIVEDPROFILEDEF': {
        const base = profile(a[2], depth + 1); const m = cartOp(a[3]);
        const tr = (pts) => pts.map(([x, y]) => { const p = V(x, y, 0).applyMatrix4(m); return [p.x, p.y]; });
        return base.map((p) => ({ outer: tr(p.outer), holes: p.holes.map(tr) }));
      }
      default: warn('Profile type ' + t); return [];
    }
  }

  // ---- mesh builder (world-space triangles) ----
  class Builder {
    constructor() { this.pos = []; }
    tri(a, b, c) { this.pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z); }
  }
  const signedArea = (pts) => { let s = 0; for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; s += p[0] * q[1] - q[0] * p[1]; } return s / 2; };

  function extrusion(a, M, B) {
    const pos = axis2(a[1]);
    const d = isRef(a[2]) ? dir(a[2], V(0, 0, 1)) : V(0, 0, 1);
    const depth = a[3];
    const Mi = M.clone().multiply(pos);
    for (const pr of profile(a[0])) {
      let outer = pr.outer; if (outer.length < 3) continue;
      if (signedArea(outer) < 0) outer = outer.slice().reverse();
      const holes = pr.holes.filter((h) => h.length >= 3).map((h) => (signedArea(h) > 0 ? h.slice().reverse() : h));
      const all = outer.concat(...holes);
      const bot = all.map(([x, y]) => V(x, y, 0).applyMatrix4(Mi));
      const top = all.map(([x, y]) => V(x + d.x * depth, y + d.y * depth, d.z * depth).applyMatrix4(Mi));
      let faces = [];
      try { faces = THREE.ShapeUtils.triangulateShape(outer.map(([x, y]) => new THREE.Vector2(x, y)), holes.map((h) => h.map(([x, y]) => new THREE.Vector2(x, y)))); } catch { faces = []; }
      for (const [i, j, k] of faces) { B.tri(bot[k], bot[j], bot[i]); B.tri(top[i], top[j], top[k]); }
      let off = 0;
      for (const loop of [outer, ...holes]) {
        const L = loop.length;
        for (let i = 0; i < L; i++) {
          const i0 = off + i, i1 = off + ((i + 1) % L);
          B.tri(bot[i0], bot[i1], top[i1]); B.tri(bot[i0], top[i1], top[i0]);
        }
        off += L;
      }
    }
  }
  function polygon3(pts, B, holes = []) {
    if (pts.length < 3) return;
    if (pts.length === 3 && !holes.length) { B.tri(pts[0], pts[1], pts[2]); return; }
    const n = V();
    for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; n.x += (p.y - q.y) * (p.z + q.z); n.y += (p.z - q.z) * (p.x + q.x); n.z += (p.x - q.x) * (p.y + q.y); }
    const ax = Math.abs(n.x), ay = Math.abs(n.y), az = Math.abs(n.z);
    const proj = az >= ax && az >= ay ? (p) => new THREE.Vector2(p.x, p.y) : ax >= ay ? (p) => new THREE.Vector2(p.y, p.z) : (p) => new THREE.Vector2(p.z, p.x);
    const flip = (az >= ax && az >= ay ? n.z : ax >= ay ? n.x : n.y) < 0;
    let faces = [];
    try { faces = THREE.ShapeUtils.triangulateShape(pts.map(proj), holes.map((h) => h.map(proj))); } catch { faces = []; }
    const all = pts.concat(...holes);
    for (const [i, j, k] of faces) flip ? B.tri(all[k], all[j], all[i]) : B.tri(all[i], all[j], all[k]);
  }
  function faceSet(t, a, M, B) {
    const coords = st.args(a[0].r)[0].map((p) => V(p[0], p[1], p[2] || 0).applyMatrix4(M));
    if (t === 'IFCTRIANGULATEDFACESET') {
      const pn = a[4];
      const P = (i) => coords[(pn ? pn[i - 1] : i) - 1];
      for (const f of a[3]) B.tri(P(f[0]), P(f[1]), P(f[2]));
      return;
    }
    const pn = a[3];
    const P = (i) => coords[(pn ? pn[i - 1] : i) - 1];
    for (const fref of a[2]) {
      const fa = st.args(fref.r);
      const outer = fa[0].map(P);
      const holes = st.type(fref.r) === 'IFCINDEXEDPOLYGONALFACEWITHVOIDS' ? (fa[1] || []).map((h) => h.map(P)) : [];
      polygon3(outer, B, holes);
    }
  }
  function face(ref, M, B) {
    const bounds = st.args(ref.r)[0] || [];
    let outer = null; const holes = [];
    for (const bref of bounds) {
      const ba = st.args(bref.r);
      const lt = st.type(ba[0].r);
      if (lt !== 'IFCPOLYLOOP') { warn('Face loop ' + lt); continue; }
      let pts = st.args(ba[0].r)[0].map((p) => point(p).applyMatrix4(M));
      if (ba[1] === false || ba[1]?.e === 'F') pts = pts.reverse();
      if (st.type(bref.r) === 'IFCFACEOUTERBOUND' && !outer) outer = pts; else holes.push(pts);
    }
    if (!outer && holes.length) outer = holes.shift();
    if (outer) polygon3(outer, B, holes);
  }
  function shell(ref, M, B) { for (const f of st.args(ref.r)[0] || []) face(f, M, B); }

  function item(ref, M, B, depth = 0) {
    if (!isRef(ref) || depth > 8) return;
    const t = st.type(ref.r), a = st.args(ref.r);
    switch (t) {
      case 'IFCEXTRUDEDAREASOLID': extrusion(a, M, B); break;
      case 'IFCMAPPEDITEM': {
        const src = st.args(a[0].r);
        const origin = axis2(src[0]);
        const target = cartOp(a[1]);
        const Mi = M.clone().multiply(target).multiply(origin);
        const rep = st.args(src[1].r);
        for (const it of rep[3] || []) item(it, Mi, B, depth + 1);
        break;
      }
      case 'IFCPOLYGONALFACESET': case 'IFCTRIANGULATEDFACESET': faceSet(t, a, M, B); break;
      case 'IFCFACETEDBREP': case 'IFCFACETEDBREPWITHVOIDS': case 'IFCADVANCEDBREP': shell(a[0], M, B); break;
      case 'IFCSHELLBASEDSURFACEMODEL': for (const s of a[0] || []) shell(s, M, B); break;
      case 'IFCFACEBASEDSURFACEMODEL': for (const s of a[0] || []) shell(s, M, B); break;
      case 'IFCCLOSEDSHELL': case 'IFCOPENSHELL': shell(ref, M, B); break;
      case 'IFCBOOLEANRESULT': case 'IFCBOOLEANCLIPPINGRESULT': item(a[1], M, B, depth + 1); if (a[0]?.e !== 'UNION') warn('Boolean cut shown without the cut'); else item(a[2], M, B, depth + 1); break;
      case 'IFCBOUNDINGBOX': {
        const o = point(a[0]); const [x, y, z] = [a[1], a[2], a[3]];
        const c = [[0, 0, 0], [x, 0, 0], [x, y, 0], [0, y, 0], [0, 0, z], [x, 0, z], [x, y, z], [0, y, z]].map(([px, py, pz]) => V(o.x + px, o.y + py, o.z + pz).applyMatrix4(M));
        [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]].forEach(([p, q, r, s]) => { B.tri(c[p], c[q], c[r]); B.tri(c[p], c[r], c[s]); });
        break;
      }
      default: warn('Geometry type ' + t);
    }
  }

  // ---- products ----
  const products = [];
  for (const [id, e] of st.ents) {
    const t = e.t;
    if (!t.startsWith('IFC') || t.endsWith('TYPE') || t.endsWith('STYLE') || SKIP_PREFIX.test(t)) continue;
    const a = st.args(id);
    if (!a || a.length < 7 || !isRef(a[5]) || !isRef(a[6])) continue;
    if (st.type(a[5].r) !== 'IFCLOCALPLACEMENT' || st.type(a[6].r) !== 'IFCPRODUCTDEFINITIONSHAPE') continue;
    products.push({ id, t, a });
  }
  if (!products.length) throw new Error('No building elements with geometry were found in this IFC file.');

  // IFC (Z up, model units) -> three (Y up, metres), re-centred to keep float precision
  const toThree = new THREE.Matrix4().set(lengthScale, 0, 0, 0, 0, 0, lengthScale, 0, 0, -lengthScale, 0, 0, 0, 0, 0, 1);
  const origins = products.map((p) => new THREE.Vector3().setFromMatrixPosition(placement(p.a[5].r)).applyMatrix4(toThree));
  const mid = (k) => { const v = origins.map((o) => o[k]).sort((x, y) => x - y); return v[v.length >> 1]; };
  const offset = new THREE.Vector3(mid('x'), 0, mid('z'));
  const minY = Math.min(...origins.map((o) => o.y));
  const C = new THREE.Matrix4().makeTranslation(-offset.x, 0, -offset.z).multiply(toThree);

  const elements = [];
  const bounds = new THREE.Box3();
  for (let i = 0; i < products.length; i++) {
    if (i % 40 === 0) { onProgress(0.08 + 0.85 * (i / products.length), `Building geometry ${i}/${products.length}`); await tick(); }
    const p = products[i];
    const M = C.clone().multiply(placement(p.a[5].r));
    const pds = st.args(p.a[6].r);
    const reps = (pds[2] || []).map((r) => ({ r, a: st.args(r.r) }));
    const pick = reps.find((r) => r.a[1] === 'Body') || reps.find((r) => ['Facetation', 'Mesh', 'Surface'].includes(r.a[1])) || reps.find((r) => r.a[1] === 'Box');
    const B = new Builder();
    if (pick) for (const it of pick.a[3] || []) item(it, M, B);
    const el = { id: p.id, gid: typeof p.a[0] === 'string' ? p.a[0] : '', cls: p.t, name: typeof p.a[2] === 'string' ? p.a[2] : '', objectType: typeof p.a[4] === 'string' ? p.a[4] : '', tag: typeof p.a[7] === 'string' ? p.a[7] : '' };
    if (B.pos.length) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(B.pos, 3));
      g.computeVertexNormals();
      g.computeBoundingBox();
      g.computeBoundingSphere();
      el.geometry = g;
      bounds.union(g.boundingBox);
    } else warn('Element without displayable geometry');
    elements.push(el);
  }

  // ---- property sets (for the optional key-from-property link and the properties panel) ----
  onProgress(0.95, 'Reading properties');
  await tick();
  const psetsOf = new Map();
  for (const rid of st.ids('IFCRELDEFINESBYPROPERTIES')) {
    const a = st.args(rid);
    const def = a[5];
    if (!isRef(def) || st.type(def.r) !== 'IFCPROPERTYSET') continue;
    for (const o of a[4] || []) { if (!psetsOf.has(o.r)) psetsOf.set(o.r, []); psetsOf.get(o.r).push(def.r); }
  }
  const valueOf = (v) => (v && typeof v === 'object' && 't' in v ? (typeof v.v === 'object' && v.v?.e ? v.v.e : v.v) : v?.e ?? v);
  function props(el) {
    const out = [];
    for (const ps of psetsOf.get(el.id) || []) {
      const pa = st.args(ps);
      for (const pr of pa[4] || []) {
        if (st.type(pr.r) !== 'IFCPROPERTYSINGLEVALUE') continue;
        const x = st.args(pr.r);
        out.push({ pset: pa[2], name: x[0], value: valueOf(x[2]) });
      }
    }
    return out;
  }
  function propValue(el, pset, prop) {
    const hit = props(el).find((p) => p.pset === pset && p.name === prop);
    return hit ? hit.value : null;
  }

  onProgress(1, 'Done');
  return { fileName, schema: st.schema, elements, bounds, groundY: bounds.min.y, lengthScale, warnings: [...warnings].map(([m, n]) => `${m} (${n})`), props, propValue, parsedAt: Date.now(), minY };
}
