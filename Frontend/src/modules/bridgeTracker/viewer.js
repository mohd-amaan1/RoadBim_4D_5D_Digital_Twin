// three.js viewer in the style of the Autodesk model viewer.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// The tracker's colour tokens are defined on its own root element, not on <html>.
let styleRoot = typeof document === 'undefined' ? null : document.documentElement;
export function setStyleRoot(el) { styleRoot = el; }
const css = (name) => getComputedStyle(styleRoot).getPropertyValue(name).trim();

// px: fixed on-screen height (fraction of the view); world: height in metres instead, so the
// label shrinks with distance (used for the many pier labels).
function textSprite(text, { size = 26, color = '#1c2127', bg = 'rgba(255,255,255,0.86)', weight = 600, px = 0.028, world = 0 } = {}) {
  const c = document.createElement('canvas');
  const g = c.getContext('2d');
  const font = `${weight} ${size * 2}px "IBM Plex Sans", "Segoe UI", sans-serif`;
  g.font = font;
  const w = Math.ceil(g.measureText(text).width) + size * 1.6, h = size * 2.8;
  c.width = w; c.height = h;
  g.font = font;
  if (bg) { g.fillStyle = bg; const r = h / 3; g.beginPath(); g.roundRect(0, 0, w, h, r); g.fill(); }
  g.fillStyle = color; g.textBaseline = 'middle'; g.textAlign = 'center';
  g.fillText(text, w / 2, h / 2 + 1);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, sizeAttenuation: !!world, transparent: true }));
  const H = world || px;
  s.scale.set((H * w) / h, H, 1);
  s.renderOrder = 20;
  return s;
}

export class Viewer {
  constructor({ canvas, cubeCanvas, labelLayer, onPick, onHover, onMeasure, onDoublePick }) {
    this.canvas = canvas;
    this.labelLayer = labelLayer;
    this.onPick = onPick; this.onHover = onHover; this.onMeasure = onMeasure; this.onDoublePick = onDoublePick;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true, logarithmicDepthBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(40, 1, 0.3, 60000);
    this.camera.position.set(300, 200, 300);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.screenSpacePanning = true;
    this.controls.zoomSpeed = 2; // pinch on touch screens; the wheel is handled by wheelZoom()
    this.zoomSpeed = 2; // twice the usual wheel sensitivity
    // Scroll up = zoom in, scroll down = zoom out, towards what is under the cursor. Registered
    // in the capture phase on the parent so it runs instead of OrbitControls' own wheel zoom.
    canvas.parentElement.addEventListener('wheel', (e) => {
      if (e.target !== canvas) return;
      e.preventDefault(); e.stopPropagation();
      this.wheelZoom(e);
    }, { capture: true, passive: false });
    this.controls.addEventListener('change', () => this.dirty());
    this.setNavMode('orbit'); // left drag orbits, right drag pans, middle drag zooms
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x8d949c, 1.15));
    const sun = new THREE.DirectionalLight(0xffffff, 1.35);
    sun.position.set(0.6, 1, 0.35);
    this.scene.add(sun);
    const fill = new THREE.DirectionalLight(0xffffff, 0.35);
    fill.position.set(-0.7, 0.4, -0.5);
    this.scene.add(fill);

    this.root = new THREE.Group();
    this.scene.add(this.root);
    this.contextGroup = new THREE.Group();
    this.scene.add(this.contextGroup);
    this.waterGroup = new THREE.Group();
    this.scene.add(this.waterGroup);
    this.items = new Map(); // item id -> {mesh, edges, item, box}
    this.mats = new Map();
    this.raycaster = new THREE.Raycaster();
    this.clipPlanes = null;
    this.mode = 'orbit';
    this.measuring = false;
    this.measurePts = [];
    this.measureGroup = new THREE.Group();
    this.scene.add(this.measureGroup);
    this.needs = true;
    this.anim = null;

    this.initCube(cubeCanvas);
    this.bindPointer();
    this.resize();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas.parentElement);
    const loop = (t) => {
      if (this.disposed) return;
      this.frame = requestAnimationFrame(loop);
      if (this.anim) this.stepAnim(t);
      const moved = this.controls.update();
      if (this.needs || moved) { this.needs = false; this.render(); }
    };
    this.frame = requestAnimationFrame(loop);
  }

  // Leaving the tracker's screen: stop drawing and give both GL contexts back. Browsers
  // cap live WebGL contexts at about sixteen, so a viewer that only goes out of the DOM
  // would use one up on every visit.
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    this.resizeObserver?.disconnect();
    this.controls.dispose();
    this.clear();
    for (const r of [this.renderer, this.cube?.r]) {
      if (!r) continue;
      r.dispose();
      r.forceContextLoss();
    }
  }

  dirty() { this.needs = true; }

  resize() {
    const r = this.canvas.parentElement.getBoundingClientRect();
    if (!r.width || !r.height) return;
    this.renderer.setSize(r.width, r.height, false);
    this.camera.aspect = r.width / r.height;
    this.camera.updateProjectionMatrix();
    this.dirty();
  }

  render() {
    this.renderer.render(this.scene, this.camera);
    this.renderCube();
    this.updateLabels();
  }

  // ---------- model ----------
  clear() {
    for (const it of this.items.values()) it.edges?.geometry && !it.sharedEdges && it.edges.geometry.dispose();
    this.root.clear();
    this.items.clear();
    this.clearMeasure();
    this.dirty();
  }

  // items: [{id, geometry, matrix?}] — several items may share one geometry (model copies)
  setItems(items) {
    const keepView = this.items.size > 0;
    this.clear();
    const edgeCache = new Map();
    this.bounds = new THREE.Box3();
    for (const item of items) {
      if (!item.geometry) continue;
      const mesh = new THREE.Mesh(item.geometry, this.mat('solid', css('--m-concrete') || '#b7bbbf'));
      mesh.userData.id = item.id;
      mesh.matrixAutoUpdate = false;
      if (item.matrix) mesh.matrix.copy(item.matrix);
      let eg = edgeCache.get(item.geometry);
      if (!eg) { eg = new THREE.EdgesGeometry(item.geometry, 20); edgeCache.set(item.geometry, eg); }
      const edges = new THREE.LineSegments(eg, this.lineMat(css('--m-edge') || '#50565d', 0.35));
      edges.matrixAutoUpdate = false;
      edges.matrix.copy(mesh.matrix);
      edges.userData.id = item.id;
      this.root.add(mesh, edges);
      const box = item.geometry.boundingBox.clone().applyMatrix4(mesh.matrix);
      this.bounds.union(box);
      this.items.set(item.id, { mesh, edges, item, box });
    }
    this.root.updateMatrixWorld(true);
    this.addGround();
    if (!keepView) this.home(false);
    this.dirty();
  }

  addGround() {
    if (this.ground) { this.scene.remove(this.ground); this.ground.geometry.dispose(); }
    if (this.bounds.isEmpty()) return;
    const b = this.bounds, size = b.getSize(new THREE.Vector3()), c = b.getCenter(new THREE.Vector3());
    const cv = document.createElement('canvas'); cv.width = cv.height = 256;
    const g = cv.getContext('2d');
    const grd = g.createRadialGradient(128, 128, 10, 128, 128, 128);
    grd.addColorStop(0, 'rgba(0,0,0,0.18)'); grd.addColorStop(0.6, 'rgba(0,0,0,0.06)'); grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd; g.fillRect(0, 0, 256, 256);
    const tex = new THREE.CanvasTexture(cv);
    const geo = new THREE.PlaneGeometry(size.x * 1.6 + 60, size.z * 1.15 + 60);
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false });
    this.ground = new THREE.Mesh(geo, mat);
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.position.set(c.x, b.min.y - 0.5, c.z);
    this.ground.renderOrder = -1;
    this.ground.visible = !this.contextOn;
    this.scene.add(this.ground);
  }

  // ---------- water plane and map context ----------
  // water: {y, corners:[[x,z]x4], label} or null
  setWater(w) {
    this.waterGroup.clear();
    if (!w) { this.dirty(); return; }
    const shape = new THREE.Shape(w.corners.map(([x, z]) => new THREE.Vector2(x, -z)));
    const geo = new THREE.ShapeGeometry(shape);
    geo.rotateX(-Math.PI / 2);
    const col = css('--water') || '#2f8fd8';
    const plane = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: w.opacity ?? 0.3, depthWrite: false, side: THREE.DoubleSide }));
    plane.position.y = w.y;
    plane.renderOrder = 5;
    const edgePts = [...w.corners, w.corners[0]].map(([x, z]) => new THREE.Vector3(x, w.y + 0.05, z));
    const edge = new THREE.Line(new THREE.BufferGeometry().setFromPoints(edgePts), new THREE.LineBasicMaterial({ color: col, transparent: true, opacity: 0.9 }));
    this.waterGroup.add(plane, edge);
    if (w.label) {
      const s = textSprite(w.label, { color: css('--water-text') || '#0f4f86', bg: 'rgba(235,245,253,0.92)', size: 22, world: 7 });
      s.position.set(w.labelAt[0], w.y + 8, w.labelAt[1]);
      this.waterGroup.add(s);
    }
    this.dirty();
  }

  // ctx: {land:[{corners, y}], lines:Float32Array (x,y,z pairs), align:[[x,y,z]], deck:[[x,y,z]], piers:[{x,z,yTop,yBot,label,modelled}], labels:[{text,x,y,z,kind}]}
  setContext(ctx) {
    for (const o of this.contextGroup.children) o.geometry?.dispose?.();
    this.contextGroup.clear();
    this.contextOn = !!ctx;
    if (this.ground) this.ground.visible = !ctx;
    if (!ctx) { this.contextBounds = null; this.dirty(); return; }
    const land = css('--land') || '#e8e1cf', hatch = css('--hatch') || '#b69b6b', road = css('--road') || '#5b5f66', pierC = css('--pier-marker') || '#6b7179';
    for (const L of ctx.land) {
      const shape = new THREE.Shape(L.corners.map(([x, z]) => new THREE.Vector2(x, -z)));
      const geo = new THREE.ShapeGeometry(shape); geo.rotateX(-Math.PI / 2);
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: land, transparent: true, opacity: 0.75, depthWrite: false, side: THREE.DoubleSide }));
      m.position.y = L.y; m.renderOrder = 1;
      this.contextGroup.add(m);
    }
    if (ctx.lines?.length) {
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(ctx.lines, 3));
      const l = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: hatch, transparent: true, opacity: 0.55 }));
      l.renderOrder = 2; this.contextGroup.add(l);
    }
    for (const part of ctx.alignParts || []) {
      if (part.length < 2) continue;
      const g = new THREE.BufferGeometry().setFromPoints(part.map((p) => new THREE.Vector3(...p)));
      const l = new THREE.Line(g, new THREE.LineBasicMaterial({ color: road, transparent: true, opacity: 0.9 }));
      l.renderOrder = 3; this.contextGroup.add(l);
    }
    if (ctx.extraLines?.length) {
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(ctx.extraLines, 3));
      const l = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: road }));
      l.renderOrder = 3; this.contextGroup.add(l);
    }
    if (ctx.deck?.length) {
      const g = new THREE.BufferGeometry().setFromPoints(ctx.deck.map((p) => new THREE.Vector3(...p)));
      const l = new THREE.Line(g, new THREE.LineDashedMaterial({ color: road, dashSize: 12, gapSize: 8, transparent: true, opacity: 0.8 }));
      l.computeLineDistances(); l.renderOrder = 3; this.contextGroup.add(l);
    }
    const posts = [];
    for (const p of ctx.piers) {
      if (!p.modelled) posts.push(p.x, p.yBot, p.z, p.x, p.yTop, p.z);
      const s = textSprite(p.label, { size: 18, world: p.major || p.modelled ? 11 : 8, color: p.modelled ? '#0e3d6b' : '#3a4149', bg: p.modelled ? 'rgba(227,238,248,0.95)' : 'rgba(255,255,255,0.85)', weight: p.modelled ? 600 : 500 });
      s.position.set(p.x, p.yTop + (p.modelled ? 40 : 14), p.z);
      this.contextGroup.add(s);
    }
    if (posts.length) {
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(posts, 3));
      this.contextGroup.add(new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: pierC })));
    }
    for (const L of ctx.labels) {
      const s = textSprite(L.text, { size: L.kind === 'bank' ? 26 : 22, px: L.kind === 'bank' ? 0.034 : 0.028, color: L.kind === 'river' ? '#0f4f86' : '#3d3527', bg: L.kind === 'river' ? 'rgba(235,245,253,0.9)' : 'rgba(250,247,240,0.92)' });
      s.position.set(L.x, L.y, L.z);
      this.contextGroup.add(s);
    }
    this.contextBounds = new THREE.Box3().setFromObject(this.contextGroup);
    this.dirty();
  }
  // Red stand-ins for "RFI not raised" elements that have no model element:
  // [{id, geometry, matrix, label}] placed at their approximate real position.
  setMarkers(list) {
    if (!this.markerGroup) { this.markerGroup = new THREE.Group(); this.scene.add(this.markerGroup); }
    for (const o of this.markerGroup.children) o.geometry?.dispose?.();
    this.markerGroup.clear();
    this.markers = new Map();
    const red = css('--s-red') || '#d13b3b';
    const mat = new THREE.MeshStandardMaterial({ color: red, roughness: 0.7, emissive: red, emissiveIntensity: 0.25 });
    for (const m of list || []) {
      const mesh = new THREE.Mesh(m.geometry, mat);
      mesh.matrixAutoUpdate = false; mesh.matrix.copy(m.matrix);
      mesh.userData.id = m.id;
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(m.geometry), new THREE.LineBasicMaterial({ color: 0x6b1a1a }));
      edges.matrixAutoUpdate = false; edges.matrix.copy(m.matrix);
      this.markerGroup.add(mesh, edges);
      const box = m.geometry.boundingBox || (m.geometry.computeBoundingBox(), m.geometry.boundingBox);
      const wbox = box.clone().applyMatrix4(m.matrix);
      if (m.label) {
        const s = textSprite(m.label, { size: 18, px: 0.019, color: '#ffffff', bg: 'rgba(209,59,59,0.95)' });
        const c = wbox.getCenter(new THREE.Vector3());
        s.position.set(c.x, wbox.max.y + 6, c.z);
        this.markerGroup.add(s);
      }
      this.markers.set(m.id, { mesh, box: wbox });
    }
    this.markerGroup.updateMatrixWorld(true);
    this.dirty();
  }
  fitMarker(id) { const m = this.markers?.get(id); if (m) this.frameBox(m.box.clone().expandByScalar(40)); }

  viewAlignment() {
    if (!this.contextBounds || this.contextBounds.isEmpty()) return;
    this.frameBox(this.contextBounds, new THREE.Vector3(0.25, 1, 0.12));
  }

  mat(kind, color, opacity = 1) {
    const k = `${kind}|${color}|${opacity}`;
    let m = this.mats.get(k);
    if (m) return m;
    if (kind === 'ghost') m = new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide });
    else m = new THREE.MeshStandardMaterial({ color, roughness: 0.86, metalness: 0.0, side: THREE.DoubleSide, transparent: opacity < 1, opacity, depthWrite: opacity >= 1, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
    this.mats.set(k, m);
    return m;
  }
  lineMat(color, opacity = 1) {
    const k = `line|${color}|${opacity}`;
    let m = this.mats.get(k);
    if (!m) { m = new THREE.LineBasicMaterial({ color, transparent: opacity < 1, opacity, depthWrite: opacity >= 1 }); this.mats.set(k, m); }
    return m;
  }

  // looks: id -> {fill:'solid'|'ghost'|'none', color, opacity, edge:color|null, edgeOpacity, hidden}
  applyLooks(lookOf) {
    for (const [id, it] of this.items) {
      const L = lookOf(id, it.item);
      if (!L || L.hidden) { it.mesh.visible = false; it.edges.visible = false; continue; }
      it.mesh.visible = L.fill !== 'none';
      if (it.mesh.visible) it.mesh.material = this.mat(L.fill === 'ghost' ? 'ghost' : 'solid', L.color, L.opacity ?? 1);
      it.edges.visible = !!L.edge;
      if (L.edge) it.edges.material = this.lineMat(L.edge, L.edgeOpacity ?? 1);
      it.mesh.renderOrder = L.fill === 'ghost' ? 6 : 0;
      it.edges.renderOrder = 7;
    }
    this.dirty();
  }

  // ---------- camera ----------
  // Fit the box's corners inside both field-of-view angles for the given view direction.
  frameBox(box, dirVec, animate = true) {
    if (!box || box.isEmpty()) return;
    const c = box.getCenter(new THREE.Vector3());
    const d = (dirVec ? dirVec.clone() : this.camera.position.clone().sub(this.controls.target)).normalize();
    const up = Math.abs(d.y) > 0.999 ? new THREE.Vector3(0, 0, -1) : new THREE.Vector3(0, 1, 0);
    const right = new THREE.Vector3().crossVectors(up, d).normalize();
    const u = new THREE.Vector3().crossVectors(d, right).normalize();
    const tv = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    const th = tv * this.camera.aspect;
    let dist = 2;
    for (let i = 0; i < 8; i++) {
      const p = new THREE.Vector3(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).sub(c);
      const x = Math.abs(p.dot(right)), y = Math.abs(p.dot(u)), z = p.dot(d);
      dist = Math.max(dist, z + x / th, z + y / tv);
    }
    dist *= 1.1;
    const pos = c.clone().add(d.multiplyScalar(dist));
    this.flyTo(pos, c, animate);
  }
  flyTo(pos, target, animate = true) {
    const dist = pos.distanceTo(target);
    this.camera.near = Math.max(0.05, dist / 3000);
    this.camera.far = Math.max(40000, dist * 20);
    this.camera.updateProjectionMatrix();
    if (!animate || matchMedia('(prefers-reduced-motion: reduce)').matches) {
      this.camera.position.copy(pos); this.controls.target.copy(target); this.controls.update(); this.dirty(); return;
    }
    this.anim = { t0: performance.now(), dur: 650, p0: this.camera.position.clone(), p1: pos, q0: this.controls.target.clone(), q1: target };
  }
  stepAnim(t) {
    const a = this.anim;
    const k = Math.min(1, (t - a.t0) / a.dur);
    const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
    this.camera.position.lerpVectors(a.p0, a.p1, e);
    this.controls.target.lerpVectors(a.q0, a.q1, e);
    if (k >= 1) this.anim = null;
    this.dirty();
  }
  wheelZoom(e) {
    this.anim = null;
    // normalise lines/pages to pixels; a trackpad pinch arrives as ctrl+wheel with small deltas
    let dy = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 100 : 1);
    if (e.ctrlKey) dy *= 4;
    dy = Math.max(-300, Math.min(300, dy));
    const f = Math.exp(dy * 0.0011 * this.zoomSpeed);
    // anchor: the surface under the cursor, reused while the cursor stays put during a scroll
    const now = performance.now();
    let P = null;
    if (this.wheelAnchor && now - this.wheelAnchor.t < 250 && Math.hypot(e.clientX - this.wheelAnchor.x, e.clientY - this.wheelAnchor.y) < 4) P = this.wheelAnchor.p;
    else {
      const hit = this.hit(e);
      if (hit) P = hit.point.clone();
      else {
        // no surface: use the point on the ray at the orbit target's depth
        const r = this.canvas.getBoundingClientRect();
        this.raycaster.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), this.camera);
        const d = this.controls.target.clone().sub(this.camera.position).dot(this.raycaster.ray.direction);
        P = this.raycaster.ray.at(Math.max(d, 1), new THREE.Vector3());
      }
    }
    this.wheelAnchor = { p: P, t: now, x: e.clientX, y: e.clientY };
    const cam = this.camera.position, tgt = this.controls.target;
    const dist = cam.distanceTo(P);
    if (f < 1 && dist * f < 0.5) return; // close enough
    cam.sub(P).multiplyScalar(f).add(P);
    tgt.sub(P).multiplyScalar(f).add(P);
    const d2 = cam.distanceTo(tgt);
    this.camera.near = Math.max(0.05, d2 / 3000);
    this.camera.far = Math.max(40000, d2 * 20);
    this.camera.updateProjectionMatrix();
    this.controls.update();
    this.dirty();
  }
  homeDir() {
    // look across the bridge from its downstream side, whichever way the model runs
    const b = this.bounds, s = b.getSize(new THREE.Vector3());
    return s.x > s.z ? new THREE.Vector3(0.62, 0.42, 0.6) : new THREE.Vector3(0.55, 0.42, 0.72);
  }
  home(animate = true) { if (this.bounds && !this.bounds.isEmpty()) this.frameBox(this.homeBox || this.bounds, this.homeDir(), animate); }
  fit(ids) {
    const box = new THREE.Box3();
    const list = ids && ids.length ? ids.map((id) => this.items.get(id)).filter(Boolean) : [...this.items.values()].filter((it) => it.mesh.visible || it.edges.visible);
    for (const it of list) box.union(it.box);
    if (box.isEmpty()) return;
    // keep a little of the surroundings in view when fitting a small element
    const s = box.getSize(new THREE.Vector3());
    const pad = Math.max(0, 6 - Math.max(s.x, s.y, s.z)) / 2;
    if (pad) box.expandByScalar(pad);
    this.frameBox(box);
  }
  viewFrom(face) {
    const dirs = { top: [0, 1, 0.0001], bottom: [0, -1, 0.0001], front: [1, 0, 0], back: [-1, 0, 0], left: [0, 0, 1], right: [0, 0, -1] };
    const v = dirs[face];
    if (v && this.bounds) this.frameBox(this.bounds, new THREE.Vector3(...v));
  }
  setNavMode(mode) {
    this.mode = mode;
    const M = THREE.MOUSE;
    // right drag pans in both modes
    this.controls.mouseButtons = mode === 'pan' ? { LEFT: M.PAN, MIDDLE: M.DOLLY, RIGHT: M.PAN } : { LEFT: M.ROTATE, MIDDLE: M.DOLLY, RIGHT: M.PAN };
    this.controls.touches = mode === 'pan' ? { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_ROTATE } : { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
  }

  // ---------- picking ----------
  bindPointer() {
    let down = null;
    this.canvas.addEventListener('pointerdown', (e) => { down = e.button === 0 ? { x: e.clientX, y: e.clientY } : null; });
    this.canvas.addEventListener('dblclick', (e) => {
      if (this.measuring || e.button !== 0) return;
      const hit = this.hit(e);
      if (hit) this.onDoublePick?.(hit.object.userData.id, e);
    });
    this.canvas.addEventListener('pointerup', (e) => {
      if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) { down = null; return; }
      down = null;
      const hit = this.hit(e);
      if (this.measuring) { if (hit) this.addMeasurePoint(hit.point); return; }
      this.onPick?.(hit ? hit.object.userData.id : null, e);
    });
    let last = 0;
    this.canvas.addEventListener('pointermove', (e) => {
      if (e.buttons || e.pointerType === 'touch') return;
      const now = performance.now();
      if (now - last < 60) return;
      last = now;
      const hit = this.hit(e);
      this.onHover?.(hit ? hit.object.userData.id : null, e);
    });
    this.canvas.addEventListener('pointerleave', () => this.onHover?.(null));
  }
  hit(e) {
    const r = this.canvas.getBoundingClientRect();
    const p = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(p, this.camera);
    const meshes = [];
    for (const it of this.items.values()) if (it.mesh.visible && !it.dimmed) meshes.push(it.mesh);
    if (this.markerGroup?.visible) for (const m of this.markers?.values() || []) meshes.push(m.mesh);
    const hits = this.raycaster.intersectObjects(meshes, false);
    for (const h of hits) if (!this.clipPlanes || this.clipPlanes.every((pl) => pl.distanceToPoint(h.point) >= -0.01)) return h;
    return null;
  }
  setDimmed(ids) { for (const [id, it] of this.items) it.dimmed = ids ? ids.has(id) : false; }

  // ---------- section box ----------
  setSection(ranges) {
    if (!ranges) { this.clipPlanes = null; this.renderer.clippingPlanes = []; this.dirty(); return; }
    const b = this.bounds;
    const lerp = (a, z, t) => a + (z - a) * t;
    const x0 = lerp(b.min.x, b.max.x, ranges.x[0]), x1 = lerp(b.min.x, b.max.x, ranges.x[1]);
    const y0 = lerp(b.min.y, b.max.y, ranges.y[0]), y1 = lerp(b.min.y, b.max.y, ranges.y[1]);
    const z1 = lerp(b.max.z, b.min.z, ranges.z[0]), z0 = lerp(b.max.z, b.min.z, ranges.z[1]);
    this.clipPlanes = [
      new THREE.Plane(new THREE.Vector3(1, 0, 0), -x0), new THREE.Plane(new THREE.Vector3(-1, 0, 0), x1),
      new THREE.Plane(new THREE.Vector3(0, 1, 0), -y0), new THREE.Plane(new THREE.Vector3(0, -1, 0), y1),
      new THREE.Plane(new THREE.Vector3(0, 0, 1), -z0), new THREE.Plane(new THREE.Vector3(0, 0, -1), z1),
    ];
    this.renderer.clippingPlanes = this.clipPlanes;
    this.dirty();
  }

  // ---------- measure ----------
  setMeasuring(on) { this.measuring = on; if (!on) this.clearMeasure(); this.canvas.style.cursor = on ? 'crosshair' : ''; }
  clearMeasure() { this.measurePts = []; this.measureGroup.clear(); this.measureLabel = null; if (this.labelLayer) this.labelLayer.innerHTML = ''; this.dirty(); }
  addMeasurePoint(p) {
    if (this.measurePts.length >= 2) this.clearMeasure();
    this.measurePts.push(p.clone());
    const color = css('--accent') || '#1f6fb8';
    const dot = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), new THREE.MeshBasicMaterial({ color, depthTest: false }));
    dot.position.copy(p); dot.renderOrder = 10; dot.userData.dot = true;
    this.measureGroup.add(dot);
    if (this.measurePts.length === 2) {
      const [a, b] = this.measurePts;
      const g = new THREE.BufferGeometry().setFromPoints([a, b]);
      const line = new THREE.Line(g, new THREE.LineBasicMaterial({ color, depthTest: false }));
      line.renderOrder = 10;
      this.measureGroup.add(line);
      const d = b.clone().sub(a);
      this.measureLabel = { at: a.clone().add(b).multiplyScalar(0.5), text: `${d.length().toFixed(3)} m`, sub: `Δ plan ${Math.hypot(d.x, d.z).toFixed(2)} · height ${Math.abs(d.y).toFixed(2)} m` };
      this.onMeasure?.(this.measureLabel);
    }
    this.dirty();
  }
  updateLabels() {
    if (!this.labelLayer) return;
    const scale = this.camera.position.distanceTo(this.controls.target) / 400;
    this.measureGroup.children.forEach((o) => { if (o.userData.dot) o.scale.setScalar(Math.max(0.15, scale)); });
    if (!this.measureLabel) { if (this.labelLayer.childElementCount) this.labelLayer.innerHTML = ''; return; }
    const v = this.measureLabel.at.clone().project(this.camera);
    const r = this.canvas.getBoundingClientRect();
    let el = this.labelLayer.firstElementChild;
    if (!el) { el = document.createElement('div'); el.className = 'measure-tag'; this.labelLayer.appendChild(el); }
    el.innerHTML = `<b>${this.measureLabel.text}</b><span>${this.measureLabel.sub}</span>`;
    el.style.transform = `translate(${((v.x + 1) / 2) * r.width}px, ${((1 - v.y) / 2) * r.height}px) translate(-50%, -130%)`;
    el.hidden = v.z > 1;
  }

  // ---------- ViewCube ----------
  initCube(cv) {
    this.cube = { canvas: cv };
    if (!cv) return;
    const r = new THREE.WebGLRenderer({ canvas: cv, antialias: true, alpha: true });
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    r.setSize(cv.clientWidth || 96, cv.clientHeight || 96, false);
    const scene = new THREE.Scene();
    const cam = new THREE.OrthographicCamera(-1.6, 1.6, 1.6, -1.6, 0.1, 10);
    const face = (label) => {
      const c = document.createElement('canvas'); c.width = c.height = 128;
      const g = c.getContext('2d');
      g.fillStyle = '#f3f4f6'; g.fillRect(0, 0, 128, 128);
      g.strokeStyle = '#9aa2ab'; g.lineWidth = 4; g.strokeRect(2, 2, 124, 124);
      g.fillStyle = '#3a4149'; g.font = '600 22px "IBM Plex Sans", "Segoe UI", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(label, 64, 66);
      const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
      return new THREE.MeshBasicMaterial({ map: t });
    };
    // BoxGeometry material order: +x, -x, +y, -y, +z, -z
    const names = ['front', 'back', 'top', 'bottom', 'left', 'right'];
    const mats = ['FRONT', 'BACK', 'TOP', 'BOTTOM', 'LEFT', 'RIGHT'].map(face);
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1.9, 1.9, 1.9), mats);
    scene.add(mesh);
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry), new THREE.LineBasicMaterial({ color: 0x7d858e }));
    scene.add(edges);
    Object.assign(this.cube, { r, scene, cam, mesh, names, mats });
    const rc = new THREE.Raycaster();
    const at = (e) => { const b = cv.getBoundingClientRect(); rc.setFromCamera(new THREE.Vector2(((e.clientX - b.left) / b.width) * 2 - 1, -((e.clientY - b.top) / b.height) * 2 + 1), cam); return rc.intersectObject(mesh)[0]; };
    cv.addEventListener('click', (e) => { const h = at(e); if (h) this.viewFrom(names[h.face.materialIndex]); });
    cv.addEventListener('pointermove', (e) => { const h = at(e); mats.forEach((m, i) => m.color.set(h && h.face.materialIndex === i ? 0xcfe2f5 : 0xffffff)); this.renderCube(); });
    cv.addEventListener('pointerleave', () => { mats.forEach((m) => m.color.set(0xffffff)); this.renderCube(); });
  }
  renderCube() {
    const c = this.cube;
    if (!c || !c.r) return;
    const d = this.camera.position.clone().sub(this.controls.target).normalize().multiplyScalar(5);
    c.cam.position.copy(d);
    c.cam.up.copy(this.camera.up);
    c.cam.lookAt(0, 0, 0);
    c.r.render(c.scene, c.cam);
  }

  // ---------- screenshot ----------
  async screenshot() {
    this.render();
    const src = this.renderer.domElement;
    const out = document.createElement('canvas');
    out.width = src.width; out.height = src.height;
    const g = out.getContext('2d');
    const grd = g.createLinearGradient(0, 0, 0, out.height);
    grd.addColorStop(0, css('--bg-top') || '#F5F6F7'); grd.addColorStop(1, css('--bg-bottom') || '#DADDE1');
    g.fillStyle = grd; g.fillRect(0, 0, out.width, out.height);
    g.drawImage(src, 0, 0);
    return await new Promise((res) => out.toBlob(res, 'image/png'));
  }
}
