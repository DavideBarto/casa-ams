import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { buildApartment, ROOMS, DOORS, BOUNDS } from './apartment.js';
import { buildShape, HUNG } from './shapes.js';
import { checkLayout, gaps, footprint, corners, clearanceZones, solid, roomOf, aabb, DECOR } from './fit.js';
import { search, byItemNo, toItem, variantProduct, articleNo, thumb, uid, sizeOf, classify } from './ikea.js';

const $ = s => document.querySelector(s);
const m = v => v / 1000;
const D2R = Math.PI / 180;
const eur = new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR' });
const money = euros => eur.format(euros);
const lineCents = it => Math.round((it.price || 0) * 100) * (it.qty || 1);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const ikeaUrl = u => (typeof u === 'string' && u.startsWith('https://www.ikea.com/') ? u : '');

// ---------- data ----------
const [dims, seed] = await Promise.all([fetch('data/dims.json').then(r => r.json()), fetch('data/default-layout.json').then(r => r.json())]);

function suggestedItems() {
  const items = seed.map(s => {
    const it = toItem(s.product, dims);
    for (const k of ['x', 'y', 'rot', 'elev', 'w', 'd', 'h', 'side', 'placed', 'qty']) if (s[k] !== undefined) it[k] = s[k];
    return it;
  });
  items.push(customItem({ name: 'Your TV', type: '55" TV, already owned', shape: 'tv', w: 1230, d: 250, h: 760, elev: 380, x: 1900, y: 170, color: '#16181b' }));
  return items;
}
function customItem(o) {
  return { uid: uid(), custom: true, itemNo: '', design: '', price: 0, url: '', img: '', measure: '', rot: 0, elev: 0, placed: true, qty: 1, exact: true, variants: [], ...o };
}

// Anything that comes from a link or a file is untrusted: keep known fields, force numbers, allow only ikea.com URLs.
function cleanItem(raw) {
  const num = (v, d = 0) => (Number.isFinite(+v) ? +v : d);
  const shape = typeof raw.shape === 'string' && /^[a-z]+$/.test(raw.shape) ? raw.shape : 'box';
  return {
    uid: uid(), custom: !!raw.custom, itemNo: String(raw.itemNo || '').replace(/[^\dsS]/g, '').slice(0, 12),
    name: String(raw.name || 'Item').slice(0, 80), type: String(raw.type || '').slice(0, 120), design: String(raw.design || '').slice(0, 120),
    price: Math.max(0, num(raw.price)), url: ikeaUrl(raw.url), img: ikeaUrl(raw.img), measure: String(raw.measure || '').slice(0, 40), shape,
    w: Math.min(Math.max(num(raw.w, 600), 10), 9000), d: Math.min(Math.max(num(raw.d, 600), 10), 9000), h: Math.min(Math.max(num(raw.h, 600), 1), 2600),
    exact: !!raw.exact, color: /^#[0-9a-f]{6}$/i.test(raw.color) ? raw.color : '#c9c9c4', x: num(raw.x), y: num(raw.y), rot: num(raw.rot), elev: num(raw.elev),
    side: raw.side === -1 ? -1 : 1, edited: !!raw.edited, placed: raw.placed !== false, qty: Math.max(1, Math.round(num(raw.qty, 1))), variants: raw.custom ? [] : undefined,
  };
}

// ---------- saved layouts (this browser) ----------
const KEY = 'casa-ams:v1';
let store = (() => { try { return JSON.parse(localStorage.getItem(KEY)); } catch { return null; } })();
if (!store?.layouts?.[store.current]) store = { current: 'a', layouts: { a: { name: 'Suggested plan', budget: 2500, items: suggestedItems() } } };
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(store)); } catch { /* private mode: keeps working, just not saved */ } };
const L = () => store.layouts[store.current];
const items = () => L().items;
const get = id => items().find(i => i.uid === id);

let undoStack = [], redoStack = [];
function remember() { undoStack.push(JSON.stringify(items())); if (undoStack.length > 100) undoStack.shift(); redoStack = []; }
function travel(from, to) {
  if (!from.length) return;
  to.push(JSON.stringify(items()));
  L().items = JSON.parse(from.pop());
  renderAll(); changed(); select(selected);
}

// ---------- scene ----------
const stage = $('#stage');
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
stage.prepend(renderer.domElement);
const labelRenderer = new CSS2DRenderer({ element: $('#labels') });

const scene = new THREE.Scene();
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.35;
const camera = new THREE.PerspectiveCamera(42, 1, 0.05, 200);
const controls = new OrbitControls(camera, renderer.domElement);
Object.assign(controls, { enableDamping: true, maxPolarAngle: 88 * D2R, minDistance: 1.2, maxDistance: 40 });

scene.add(new THREE.HemisphereLight(0xf4f7ff, 0xb9ad96, 1.3));
const sun = new THREE.DirectionalLight(0xfff4e6, 2.2);
sun.position.set(-6, 14, 12); sun.target.position.set(3.3, 0, 2.1); sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -9, right: 9, top: 9, bottom: -9, near: 1, far: 40 });
sun.shadow.camera.updateProjectionMatrix(); sun.shadow.bias = -0.0004;
scene.add(sun, sun.target);

const cssVar = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const applyTheme = () => { scene.background = new THREE.Color(cssVar('--scene') || '#dde3ea'); };
applyTheme();
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);
new MutationObserver(applyTheme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

const apt = buildApartment(scene);
const furniture = new THREE.Group(); scene.add(furniture);
const overlay = new THREE.Group(); scene.add(overlay);     // clearance zones + distance guides
const views = new Map();                                    // uid -> { group, foot }

const footMats = {
  idle: new THREE.MeshBasicMaterial({ color: 0x2b4c9b, transparent: true, opacity: 0.10, depthWrite: false }),
  sel: new THREE.MeshBasicMaterial({ color: 0x2b4c9b, transparent: true, opacity: 0.28, depthWrite: false }),
  warn: new THREE.MeshBasicMaterial({ color: 0xd98a1c, transparent: true, opacity: 0.38, depthWrite: false }),
  error: new THREE.MeshBasicMaterial({ color: 0xd6342c, transparent: true, opacity: 0.45, depthWrite: false }),
};
const zoneMat = new THREE.MeshBasicMaterial({ color: 0xd98a1c, transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide });
const guideMat = new THREE.LineBasicMaterial({ color: 0x2b4c9b, depthTest: false });

function dropView(id) {
  const v = views.get(id); if (!v) return;
  furniture.remove(v.group);
  v.group.traverse(o => o.geometry?.dispose());
  views.delete(id);
}
function renderItem(it) {
  dropView(it.uid);
  if (it.placed === false) return;
  const group = buildShape(it);
  const f = footprint(it);
  const foot = new THREE.Mesh(new THREE.PlaneGeometry(m(2 * f.hw), m(2 * f.hd)), footMats.idle);
  foot.rotation.x = -Math.PI / 2; foot.position.y = 0.008; foot.renderOrder = 2;
  group.add(foot);
  group.traverse(o => { o.userData.uid = it.uid; });
  furniture.add(group);
  views.set(it.uid, { group, foot });
}
function renderAll() { for (const id of [...views.keys()]) dropView(id); items().forEach(renderItem); }
function placeView(it) {
  const v = views.get(it.uid); if (!v) return;
  v.group.position.set(m(it.x), 0, m(it.y)); v.group.rotation.y = (it.rot || 0) * D2R;
}

// ---------- view modes ----------
let mode = 'orbit', cut = true, labelsOn = true, zonesOn = false, selected = null, issues = [];
const center = new THREE.Vector3(3.36, 0, 2.1);

function applyVisibility() {
  apt.setCut(cut);
  const level = new Map();
  for (const is of issues) for (const id of is.uids) if (level.get(id) !== 'error') level.set(id, is.level);
  for (const it of items()) {
    const v = views.get(it.uid); if (!v) continue;
    v.group.visible = !(HUNG.has(it.shape) && (cut || mode === 'top'));
    const state = it.uid === selected ? 'sel' : level.get(it.uid) || 'idle';
    v.foot.material = footMats[state];
    v.foot.visible = mode === 'top' || state !== 'idle';
  }
  for (const l of apt.labels) l.visible = labelsOn && mode !== 'walk';
}

let tween = null;
function flyTo(pos, target, ms = 650) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) ms = 0;
  tween = { p0: camera.position.clone(), t0: controls.target.clone(), p1: pos, t1: target, start: performance.now(), ms };
}
const aspect = () => Math.max(stage.clientWidth / Math.max(stage.clientHeight, 1), 0.3);
function homeView() {
  const k = Math.min(aspect() < 1 ? 1.25 / aspect() : 1, 2.4);
  return [center.clone().add(new THREE.Vector3(-4.6, 13, 11.4).multiplyScalar(k)), center.clone()];
}
function topView() {
  const t = Math.tan(camera.fov / 2 * D2R);
  return [new THREE.Vector3(center.x, Math.max(9.4 / (2 * t), 12.6 / (2 * t * aspect())) * 1.05, center.z + 0.01), center.clone()];
}

const walk = { pos: new THREE.Vector3(), yaw: 0, pitch: 0, keys: new Set(), pad: new Set(), obstacles: [] };
function walkObstacles() {
  walk.obstacles = [...apt.walls, ...items().filter(it => solid(it) && (it.elev || 0) < 1700).map(it => aabb(corners(footprint(it))))];
}
function blocked(x, z) {
  const px = x * 1000, pz = z * 1000, r = 200, [bx1, by1, bx2, by2] = BOUNDS;
  if (px < bx1 || px > bx2 || pz < by1 || pz > by2) return true;
  return walk.obstacles.some(([x1, y1, x2, y2]) => px > x1 - r && px < x2 + r && pz > y1 - r && pz < y2 + r);
}

function setMode(next) {
  mode = next;
  for (const id of ['orbit', 'top', 'walk']) $('#v-' + id).setAttribute('aria-pressed', String(id === mode));
  $('#pad').hidden = mode !== 'walk';
  controls.enabled = mode !== 'walk';
  camera.fov = mode === 'walk' ? 70 : 42; camera.updateProjectionMatrix();
  if (mode === 'walk') {
    tween = null; walkObstacles();
    walk.pos.set(m(5200), 1.6, m(550)); walk.yaw = 90 * D2R; walk.pitch = -0.08;
  } else {
    controls.enableRotate = mode === 'orbit';
    controls.mouseButtons.LEFT = mode === 'top' ? THREE.MOUSE.PAN : THREE.MOUSE.ROTATE;
    controls.touches.ONE = mode === 'top' ? THREE.TOUCH.PAN : THREE.TOUCH.ROTATE;
    flyTo(...(mode === 'top' ? topView() : homeView()));
  }
  $('#hint').textContent = {
    orbit: 'Drag furniture to move it · drag empty space to orbit · R rotates · Delete removes · Ctrl+Z undoes',
    top: 'Drag furniture to move it · drag empty space to pan · scroll to zoom · R rotates',
    walk: 'W A S D or arrow keys to walk · drag to look around · click furniture to select it',
  }[mode];
  applyVisibility();
}

// ---------- fit checks, guides, clearance zones ----------
function runChecks() {
  issues = checkLayout(items(), { walls: apt.walls, doors: DOORS, rooms: ROOMS });
  applyVisibility();
  drawOverlay();
}

function quad(poly, mat, y = 0.006) {
  const g = new THREE.BufferGeometry();
  const v = poly.map(([x, z]) => [m(x), y, m(z)]);
  g.setAttribute('position', new THREE.Float32BufferAttribute([...v[0], ...v[1], ...v[2], ...v[0], ...v[2], ...v[3]], 3));
  const mesh = new THREE.Mesh(g, mat); mesh.renderOrder = 1; return mesh;
}
function drawOverlay() {
  overlay.traverse(o => o.geometry?.dispose());
  overlay.clear();
  const sel = selected && get(selected);
  for (const it of items()) {
    if (!solid(it) || !(zonesOn || it === sel)) continue;
    for (const z of clearanceZones(it)) overlay.add(quad(corners(z), zoneMat));
  }
  if (!sel || sel.placed === false || mode === 'walk') return;
  const g = gaps(sel, items(), apt.walls, 4000);
  const [x1, y1, x2, y2] = g.box, cx = (x1 + x2) / 2, cy = (y1 + y2) / 2;
  const seg = (ax, ay, bx, by, d) => {
    if (d === null || d < 5) return;
    overlay.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(m(ax), 0.03, m(ay)), new THREE.Vector3(m(bx), 0.03, m(by))]), guideMat));
    const el = document.createElement('div'); el.className = 'gd'; el.textContent = `${Math.round(d / 10)} cm`;
    const lab = new CSS2DObject(el); lab.position.set(m((ax + bx) / 2), 0.03, m((ay + by) / 2)); overlay.add(lab);
  };
  seg(x2, cy, x2 + g.px, cy, g.px); seg(x1, cy, x1 - g.nx, cy, g.nx);
  seg(cx, y2, cx, y2 + g.py, g.py); seg(cx, y1, cx, y1 - g.ny, g.ny);
}

// ---------- selection & item card ----------
const card = $('#card');
const selBox = new THREE.BoxHelper(undefined, 0x2b4c9b); selBox.material.depthTest = false; selBox.renderOrder = 10; selBox.visible = false; scene.add(selBox);

function select(id, fly = false) {
  selected = id && get(id) ? id : null;
  const it = selected && get(selected), v = it && views.get(it.uid);
  selBox.visible = !!v;
  if (v) { selBox.setFromObject(v.group); selBox.material.color.set(cssVar('--accent') || '#2b4c9b'); }
  if (it && it.variants === undefined && it.itemNo) {   // links and files don't carry variants: fetch them once
    it.variants = [];
    byItemNo(it.itemNo).then(p => { if (p) { it.variants = toItem(p, dims).variants; if (selected === it.uid) renderCard(); save(); } }).catch(() => {});
  }
  if (fly && v && mode !== 'walk') {
    const bb = new THREE.Box3().setFromObject(v.group), c = bb.getCenter(new THREE.Vector3());
    const size = Math.max(bb.getSize(new THREE.Vector3()).length(), 1.2);
    if (mode === 'top') flyTo(new THREE.Vector3(c.x, Math.max(size * 2.4, 4.5), c.z + 0.01), new THREE.Vector3(c.x, 0, c.z));
    else flyTo(c.clone().add(new THREE.Vector3(-0.45, 0.8, 0.6).normalize().multiplyScalar(size * 1.8 + 1.6)), c);
  }
  applyVisibility(); drawOverlay(); renderCard(); renderList();
  if (!$('#pane-add').hidden) renderResults();   // swap buttons depend on the selection
}

function renderCard() {
  const it = selected && get(selected);
  if (!it) { card.hidden = true; return; }
  const mine = issues.filter(i => i.uids.includes(it.uid));
  const cm = v => Math.round(v / 10);
  const variants = it.variants?.length ? [{ itemNo: it.itemNo, design: it.design, img: it.img, price: it.price, current: true }, ...it.variants] : [];
  const canLift = !HUNG.has(it.shape);
  card.innerHTML = `
    <div class="card-top">
      ${it.img ? `<img src="${esc(thumb(it.img, 's'))}" alt="" width="64" height="64">` : `<span class="swatch-big" style="background:${esc(it.color)}"></span>`}
      <div class="card-id"><h2>${esc(it.name)}</h2><div class="type">${esc(it.type)}${it.design ? ` · ${esc(it.design)}` : ''}</div>
        <div class="money">${it.custom ? 'Not in the total' : (it.qty > 1 ? `${it.qty} × ${money(it.price)} = ` : '') + money(lineCents(it) / 100)}</div></div>
      <button class="x" data-act="close" aria-label="Close">×</button>
    </div>
    <div class="tools">
      ${it.placed !== false ? `<button data-act="rotl" title="Rotate left (Shift+R)" aria-label="Rotate left">⟲</button><button data-act="rotr" title="Rotate right (R)" aria-label="Rotate right">⟳</button>
      <button data-act="dup">Duplicate</button>` : ''}
      ${it.custom ? '' : '<button data-act="swap">Swap…</button>'}
      <button data-act="del" class="danger">Remove</button>
    </div>
    ${variants.length ? `<div class="variants" role="group" aria-label="Colours and versions">${variants.map(v => `
      <button class="vs${v.current ? ' on' : ''}" data-variant="${esc(v.itemNo)}" title="${esc(v.design)} · ${money(v.price)}" aria-label="${esc(v.design)}, ${money(v.price)}">
        <img src="${esc(thumb(v.img, 'xxs'))}" alt="" width="40" height="40" loading="lazy"></button>`).join('')}</div>` : ''}
    ${it.placed !== false ? `<div class="size">
      <label>W <input id="sz-w" type="number" min="1" max="900" value="${cm(it.w)}"></label>
      <label>D <input id="sz-d" type="number" min="1" max="900" value="${cm(it.d)}"></label>
      <label>H <input id="sz-h" type="number" min="1" max="260" value="${cm(it.h)}"></label>
      ${canLift ? `<label>Off floor <input id="sz-e" type="number" min="0" max="250" value="${cm(it.elev || 0)}"></label>` : ''}
      ${it.custom ? `<label>Colour <input id="sz-c" type="color" value="${esc(it.color)}"></label>` : ''}
      <small>${it.edited ? 'Size set by you, in cm.' : it.exact ? 'Size from IKEA.nl, in cm.' : 'Estimated size. Check it on IKEA.nl and correct it here.'}</small>
    </div>` : `<div class="size"><label>Quantity <input id="sz-q" type="number" min="1" max="99" value="${it.qty}"></label><small>Not placed in the model.</small></div>`}
    ${mine.length ? `<ul class="fitmsg">${mine.map(i => `<li class="${i.level}">${esc(i.text)}</li>`).join('')}</ul>` : (solid(it) ? '<p class="fitok">Fits where it is.</p>' : '')}
    ${it.url ? `<a class="btn" href="${esc(it.url)}" target="_blank" rel="noopener">View on IKEA.nl ↗</a>` : ''}`;
  card.hidden = false;
}

card.addEventListener('click', e => {
  const it = selected && get(selected); if (!it) return;
  const b = e.target.closest('button'); if (!b) return;
  const act = b.dataset.act, variant = b.dataset.variant;
  if (act === 'close') select(null);
  else if (act === 'rotl' || act === 'rotr') rotate(it, act === 'rotl' ? -90 : 90);
  else if (act === 'dup') { remember(); const copy = { ...structuredClone(it), uid: uid(), x: it.x + 300, y: it.y + 300 }; items().push(copy); renderItem(copy); changed(); select(copy.uid); }
  else if (act === 'swap') openSwap(it);
  else if (act === 'del') { remember(); L().items = items().filter(i => i !== it); dropView(it.uid); select(null); changed(); }
  else if (variant && variant !== it.itemNo) {
    const v = it.variants.find(x => x.itemNo === variant);
    if (v) replaceWith(it, variantProduct(v), [{ itemNo: it.itemNo, design: it.design, img: it.img, url: it.url, price: it.price, measure: it.measure, name: it.name, typeName: it.type }, ...it.variants.filter(x => x !== v)]);
  }
});
card.addEventListener('change', e => {
  const it = selected && get(selected); if (!it || !e.target.id?.startsWith('sz-')) return;
  const v = +e.target.value, k = e.target.id.slice(3);
  if (k !== 'c' && (e.target.value === '' || !(v >= 0))) return renderCard();   // an emptied field is not 0
  remember();
  if (k === 'q') it.qty = Math.max(1, Math.round(v));
  else if (k === 'c') it.color = e.target.value;
  else { const key = { w: 'w', d: 'd', h: 'h', e: 'elev' }[k]; it[key] = k === 'e' ? Math.max(0, v * 10) : Math.max(10, v * 10); if (k !== 'e' && !it.custom) it.edited = true; }
  renderItem(it); changed();
});

function rotate(it, delta) {
  remember();
  it.rot = (((it.rot || 0) + delta) % 360 + 360) % 360;
  renderItem(it); changed();
}
function replaceWith(old, product, variants) {
  remember();
  const next = toItem(product, dims);
  Object.assign(next, { uid: old.uid, x: old.x, y: old.y, rot: old.rot, placed: old.placed, qty: old.qty, side: old.side,
    elev: next.shape === old.shape ? old.elev : next.elev, ...(variants ? { variants } : {}) });
  L().items = items().map(i => (i === old ? next : i));
  renderItem(next); changed(); select(next.uid);
  toast(`Swapped to ${next.name}, ${money(next.price)}`);
}

// ---------- pointer: select, drag, look ----------
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
function setRay(ev) {
  const r = renderer.domElement.getBoundingClientRect();
  ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ndc, camera);
}
const shown = o => { for (let p = o; p; p = p.parent) if (!p.visible) return false; return true; };
function hit(ev) {
  setRay(ev);
  const h = ray.intersectObjects(furniture.children, true).find(x => x.object.isMesh && shown(x.object));   // raycasts include hidden meshes
  return h?.object.userData.uid || null;
}
function floorAt(ev) { setRay(ev); const p = new THREE.Vector3(); return ray.ray.intersectPlane(floorPlane, p) ? p : null; }

let press = null;   // { x, y, drag?: { it, ox, oy, moved } , look?: true }
renderer.domElement.addEventListener('pointerdown', e => {
  press = { x: e.clientX, y: e.clientY, lx: e.clientX, ly: e.clientY };
  if (mode === 'walk') { press.look = true; renderer.domElement.setPointerCapture(e.pointerId); return; }
  const id = hit(e), it = id && get(id);
  if (it && (it.uid === selected || !DECOR.has(it.shape))) {
    const p = floorAt(e);
    if (p) {
      press.drag = { it, ox: it.x - p.x * 1000, oy: it.y - p.z * 1000, moved: false };
      controls.enabled = false;
      renderer.domElement.setPointerCapture(e.pointerId);
      if (it.uid !== selected) select(it.uid);
    }
  }
});
renderer.domElement.addEventListener('pointermove', e => {
  if (!press) return;
  if (press.look) {
    walk.yaw -= (e.clientX - press.lx) * 0.005;
    walk.pitch = Math.max(-1.2, Math.min(1.2, walk.pitch - (e.clientY - press.ly) * 0.004));
    press.lx = e.clientX; press.ly = e.clientY;
    return;
  }
  const d = press.drag; if (!d) return;
  if (!d.moved && Math.hypot(e.clientX - press.x, e.clientY - press.y) < 4) return;
  const p = floorAt(e); if (!p) return;
  if (!d.moved) { remember(); d.moved = true; }
  d.it.x = Math.round((p.x * 1000 + d.ox) / 10) * 10;
  d.it.y = Math.round((p.z * 1000 + d.oy) / 10) * 10;
  if (solid(d.it)) {   // snap flush against anything closer than 4 cm
    const g = gaps(d.it, items(), apt.walls, 40);
    if (g.px !== null && g.px < 40) d.it.x += g.px; else if (g.nx !== null && g.nx < 40) d.it.x -= g.nx;
    if (g.py !== null && g.py < 40) d.it.y += g.py; else if (g.ny !== null && g.ny < 40) d.it.y -= g.ny;
  }
  placeView(d.it); selBox.setFromObject(views.get(d.it.uid).group);
  runChecks();
});
renderer.domElement.addEventListener('pointerup', e => {
  if (!press) return;
  const d = press.drag, click = Math.hypot(e.clientX - press.x, e.clientY - press.y) < 6;
  if (d) { controls.enabled = mode !== 'walk'; if (d.moved) changed(); }
  else if (click) select(hit(e));
  press = null;
});
renderer.domElement.addEventListener('pointercancel', () => {
  if (press?.drag) { controls.enabled = mode !== 'walk'; if (press.drag.moved) changed(); }
  press = null;
});

const KEYS = { KeyW: 'f', ArrowUp: 'f', KeyS: 'b', ArrowDown: 'b', KeyA: 'sl', KeyD: 'sr', ArrowLeft: 'l', ArrowRight: 'r', KeyQ: 'l', KeyE: 'r' };
window.addEventListener('keydown', e => {
  if (e.target.closest?.('input, textarea, select')) return;
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); return e.shiftKey ? travel(redoStack, undoStack) : travel(undoStack, redoStack); }
  if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); return travel(redoStack, undoStack); }
  if (mode === 'walk' && KEYS[e.code]) { walk.keys.add(KEYS[e.code]); e.preventDefault(); return; }
  if (e.key === 'Escape') return select(null);
  const it = selected && get(selected); if (!it || it.placed === false) return;
  if (e.target.closest?.('#panel')) return;   // keys in the side panel scroll and navigate, they don't edit
  if ((e.key === 'r' || e.key === 'R') && !mod) rotate(it, e.shiftKey ? -90 : 90);   // leave Ctrl/Cmd+R to the browser
  else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); card.querySelector('[data-act="del"]')?.click(); }
  else if (mod && e.key.toLowerCase() === 'd') { e.preventDefault(); card.querySelector('[data-act="dup"]')?.click(); }
  else if (e.key.startsWith('Arrow')) {
    e.preventDefault();
    const step = e.shiftKey ? 100 : 10, dx = { ArrowLeft: -step, ArrowRight: step }[e.key] || 0, dy = { ArrowUp: -step, ArrowDown: step }[e.key] || 0;
    if (!e.repeat) remember();
    it.x += dx; it.y += dy; placeView(it); changed();
  }
});
window.addEventListener('keyup', e => walk.keys.delete(KEYS[e.code]));
window.addEventListener('blur', () => walk.keys.clear());
for (const b of document.querySelectorAll('#pad button')) {
  const k = b.dataset.k;
  b.addEventListener('pointerdown', e => { walk.pad.add(k); b.setPointerCapture(e.pointerId); });
  for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) b.addEventListener(ev, () => walk.pad.delete(k));
}

// ---------- panel: shopping list ----------
const roomName = it => (it.placed === false ? 'Not placed in the model' : roomOf(it, ROOMS)?.name || 'Outside the plan');
const ROOM_ORDER = [...ROOMS.map(r => r.name), 'Not placed in the model', 'Outside the plan'];

function groups() {
  const byRoom = new Map();
  for (const it of items()) {
    const room = roomName(it), key = it.custom ? it.uid : it.itemNo;
    if (!byRoom.has(room)) byRoom.set(room, new Map());
    const g = byRoom.get(room);
    if (!g.has(key)) g.set(key, { it, qty: 0, cents: 0, uids: [] });
    const row = g.get(key); row.qty += it.qty || 1; row.cents += it.custom ? 0 : lineCents(it); row.uids.push(it.uid);
  }
  return [...byRoom].sort((a, b) => ROOM_ORDER.indexOf(a[0]) - ROOM_ORDER.indexOf(b[0]));
}

function renderList() {
  const all = groups();
  const total = items().reduce((s, it) => s + (it.custom ? 0 : lineCents(it)), 0), budget = Math.round((+L().budget || 0) * 100), left = budget - total;
  $('#b-total').textContent = money(total / 100);
  $('#b-left').textContent = money(left / 100);
  $('#b-bar').classList.toggle('over', left < 0);
  $('#b-bar').firstElementChild.style.width = (budget ? Math.min(100, total / budget * 100) : 0) + '%';
  if (document.activeElement !== $('#budget')) $('#budget').value = L().budget;
  $('#layout-name').textContent = L().name;

  const errors = issues.filter(i => i.level === 'error').length, warns = issues.length - errors;
  $('#fit').innerHTML = issues.length
    ? `<p class="chip ${errors ? 'error' : 'warn'}">${errors ? `${errors} problem${errors > 1 ? 's' : ''}` : ''}${errors && warns ? ' · ' : ''}${warns ? `${warns} warning${warns > 1 ? 's' : ''}` : ''}</p>
       <ul>${issues.map(i => `<li class="${i.level}"><button data-sel="${esc(i.uids[0])}">${esc(i.text)}</button></li>`).join('')}</ul>`
    : '<p class="chip ok">Everything fits</p>';

  $('#rooms').innerHTML = all.map(([room, rows]) => {
    const sub = [...rows.values()].reduce((s, r) => s + r.cents, 0);
    return `<section class="room"><h3><span>${esc(room)}</span><span class="num">${money(sub / 100)}</span></h3><ul class="items">${[...rows.values()].map(r => `
      <li class="item${r.uids.includes(selected) ? ' sel' : ''}">
        ${r.it.img ? `<img src="${esc(thumb(r.it.img, 'xxs'))}" alt="" width="36" height="36" loading="lazy">` : `<span class="swatch" style="background:${esc(r.it.color)}"></span>`}
        <button class="pick" data-sel="${esc(r.uids[(r.uids.indexOf(selected) + 1) % r.uids.length])}"><strong>${esc(r.it.name)}</strong><span class="t">${esc(r.it.type)}${r.it.design ? ` · ${esc(r.it.design)}` : ''}</span></button>
        <span class="price">${r.it.custom ? '<small>owned</small>' : money(r.cents / 100)}${r.qty > 1 && !r.it.custom ? `<small>${r.qty} × ${money(r.it.price)}</small>` : ''}</span>
        ${r.it.url ? `<a href="${esc(r.it.url)}" target="_blank" rel="noopener" aria-label="Open ${esc(r.it.name)} on IKEA.nl">↗</a>` : '<span></span>'}
      </li>`).join('')}</ul></section>`;
  }).join('');
}
$('#panel').addEventListener('click', e => {
  const b = e.target.closest('[data-sel]');
  if (b) select(b.dataset.sel, true);
});
$('#budget').addEventListener('change', e => { L().budget = Math.max(0, +e.target.value || 0); changed(); });

$('#copy-list').addEventListener('click', async () => {
  const rows = new Map();
  for (const it of items()) {
    if (it.custom) continue;
    const r = rows.get(it.itemNo) || { it, qty: 0 }; r.qty += it.qty || 1; rows.set(it.itemNo, r);
  }
  const total = [...rows.values()].reduce((s, r) => s + Math.round(r.it.price * 100) * r.qty, 0);
  const text = [`${L().name}: IKEA shopping list`, '', ...[...rows.values()].map(({ it, qty }) =>
    `${qty} × ${it.name}, ${it.type}${it.design ? `, ${it.design}` : ''} (${articleNo(it.itemNo)}): ${money(it.price * qty)}\n   ${it.url}`), '', `Total: ${money(total / 100)}`].join('\n');
  try { await navigator.clipboard.writeText(text); toast('Shopping list copied'); }
  catch { prompt('Copy the shopping list:', text); }
});

$('#refresh').addEventListener('click', async e => {
  const btn = e.currentTarget; btn.disabled = true; btn.textContent = 'Checking prices…';
  const nos = [...new Set(items().filter(i => !i.custom && i.itemNo).map(i => i.itemNo))];
  let changedCount = 0, failed = 0;
  for (let i = 0; i < nos.length; i += 4) {
    await Promise.all(nos.slice(i, i + 4).map(async no => {
      try {
        const p = await byItemNo(no);
        const price = p?.salesPrice?.numeral;
        if (typeof price !== 'number') { failed++; return; }
        for (const it of items().filter(x => x.itemNo === no)) {
          if (it.price !== price) { changedCount++; it.price = price; }
        }
      } catch { failed++; }
    }));
  }
  btn.disabled = false; btn.textContent = 'Refresh prices';
  changed();
  toast(failed ? `${failed} product${failed > 1 ? 's' : ''} couldn't be checked (maybe no longer sold).` : changedCount ? `${changedCount} price${changedCount > 1 ? 's' : ''} changed.` : 'All prices are current.');
});

// ---------- panel: add & swap ----------
const results = { q: '', size: 24, products: [], total: 0, swapping: null, loading: false, error: '', req: 0 };
const CHIPS = ['Sofa', 'Armchair', 'Bed frame', 'Mattress', 'Wardrobe', 'Chest of drawers', 'Bedside table', 'Desk', 'Office chair', 'Dining table',
  'Dining chair', 'Coffee table', 'TV bench', 'Bookcase', 'Shelving unit', 'Sideboard', 'Shoe cabinet', 'Floor lamp', 'Pendant lamp', 'Rug', 'Curtains', 'Mirror', 'Outdoor furniture', 'Plant pot'];
$('#chips').innerHTML = CHIPS.map(c => `<button type="button" data-q="${esc(c)}">${esc(c)}</button>`).join('');
$('#chips').addEventListener('click', e => { const b = e.target.closest('[data-q]'); if (b) { $('#q').value = b.dataset.q; runSearch(); } });
$('#search').addEventListener('submit', e => { e.preventDefault(); runSearch(); });
$('#sort').addEventListener('change', () => results.q && runSearch());
$('#more').addEventListener('click', () => runSearch(true));

async function runSearch(more = false) {
  const q = $('#q').value.trim(); if (!q) return;
  const req = ++results.req;   // only the latest request may write results (query, sort or page can change mid-flight)
  Object.assign(results, { q, size: more ? results.size + 24 : 24, loading: true, error: '' });
  renderResults();
  try {
    const r = await search(q, { size: results.size, sort: $('#sort').value || undefined });
    if (req !== results.req) return;
    Object.assign(results, { products: r.products, total: r.total });
  } catch {
    if (req !== results.req) return;
    results.error = "Couldn't reach IKEA.nl. Check your connection and try again.";
  }
  results.loading = false;
  renderResults();
}

// How much room the selected piece has around it, for "fits here" badges while swapping.
function roomFor(it) {
  const g = gaps(it, items(), apt.walls, 3000), [x1, y1, x2, y2] = g.box;
  return { x: x2 - x1 + (g.px ?? 3000) + (g.nx ?? 3000), y: y2 - y1 + (g.py ?? 3000) + (g.ny ?? 3000), sideways: Math.round(((it.rot || 0) % 180 + 180) % 180) === 90 };
}
function fitBadge(p) {
  const s = results.swapping && get(results.swapping);
  if (!s || s.placed === false) return '';
  const shape = classify(p.typeName), size = sizeOf(p, shape, dims);
  if (!size.known) return '';
  const room = roomFor(s), w = room.sideways ? size.d : size.w, d = room.sideways ? size.w : size.d;
  const over = Math.max(w - room.x, d - room.y);
  return over <= 0 ? '<span class="badge ok">Fits here</span>' : `<span class="badge warn">${Math.ceil(over / 10)} cm too big</span>`;
}

function renderResults() {
  const s = results.swapping && get(results.swapping);
  $('#swapbar').hidden = !s;
  if (s) $('#swapbar span').textContent = `Pick a replacement for ${s.name} (${money(s.price)}).`;
  const list = $('#results');
  if (results.loading && !results.products.length) { list.innerHTML = '<p class="muted">Searching IKEA.nl…</p>'; return; }
  if (results.error) { list.innerHTML = `<p class="muted">${esc(results.error)}</p>`; return; }
  if (!results.q) { list.innerHTML = '<p class="muted">Search the IKEA.nl catalogue, or pick a category above. Prices and photos are live.</p>'; $('#more').hidden = true; return; }
  if (!results.products.length) { list.innerHTML = `<p class="muted">Nothing found for “${esc(results.q)}”.</p>`; $('#more').hidden = true; return; }
  list.innerHTML = results.products.map(p => {
    const shape = classify(p.typeName), size = sizeOf(p, shape, dims);
    const sz = `${Math.round(size.w / 10)} × ${Math.round(size.d / 10)} × ${Math.round(size.h / 10)} cm${size.exact ? '' : ' (est.)'}`;
    return `<li class="res">
      <img src="${esc(thumb(ikeaUrl(p.mainImageUrl), 'xs'))}" alt="" width="72" height="72" loading="lazy">
      <div class="res-body"><strong>${esc(p.name)}</strong><span class="t">${esc(p.typeName)}${p.validDesignText ? ` · ${esc(p.validDesignText)}` : ''}</span>
        <span class="t mono">${esc(sz)}${p.ratingValue ? ` · ★ ${p.ratingValue} (${p.ratingCount})` : ''}</span>${fitBadge(p)}</div>
      <div class="res-side"><span class="price">${money(p.salesPrice?.numeral ?? 0)}</span>
        ${s ? `<button class="primary" data-swap="${esc(p.itemNo)}">Use this</button>` : `<button class="primary" data-add="${esc(p.itemNo)}">Add</button>`}
        <a href="${esc(ikeaUrl(p.pipUrl))}" target="_blank" rel="noopener" aria-label="Open ${esc(p.name)} on IKEA.nl">IKEA ↗</a></div>
    </li>`;
  }).join('');
  $('#more').hidden = results.products.length >= results.total;
}
$('#results').addEventListener('click', e => {
  const add = e.target.closest('[data-add]'), swap = e.target.closest('[data-swap]');
  const p = results.products.find(x => x.itemNo === (add || swap)?.dataset[add ? 'add' : 'swap']);
  if (!p) return;
  if (swap) { const s = get(results.swapping); results.swapping = null; if (s) replaceWith(s, p); return; }
  remember();
  const it = toItem(p, dims);
  Object.assign(it, dropPoint());
  items().push(it); renderItem(it); changed(); select(it.uid);
  toast(it.placed ? `Added ${it.name}. Drag it into place.` : `Added ${it.name} to the list.`);
});
function openSwap(it) {
  results.swapping = it.uid;
  $('#q').value = it.type;
  showTab('add');
  runSearch();
}
$('#swapbar button').addEventListener('click', () => { results.swapping = null; renderResults(); });

// New pieces land where you're looking.
function dropPoint() {
  if (mode === 'walk') return { x: Math.round((walk.pos.x - Math.sin(walk.yaw) * 1.5) * 1000), y: Math.round((walk.pos.z - Math.cos(walk.yaw) * 1.5) * 1000) };
  return { x: Math.round(controls.target.x * 1000), y: Math.round(controls.target.z * 1000) };
}

$('#own').addEventListener('submit', e => {
  e.preventDefault();
  const f = new FormData(e.target), cm = k => Math.max(1, +f.get(k) || 0) * 10;
  remember();
  const it = customItem({ name: String(f.get('name') || 'My item').slice(0, 60), type: 'Already owned', shape: String(f.get('shape')), w: cm('w'), d: cm('d'), h: cm('h'), color: String(f.get('color')), ...dropPoint() });
  items().push(it); renderItem(it); changed(); select(it.uid);
  toast(`Added ${it.name}. Drag it into place.`);
});

// ---------- panel: layouts ----------
function renderLayouts() {
  $('#layouts').innerHTML = Object.entries(store.layouts).map(([id, l]) => {
    const total = l.items.reduce((s, it) => s + (it.custom ? 0 : lineCents(it)), 0);
    return `<li class="${id === store.current ? 'on' : ''}"><button data-layout="${esc(id)}"><strong>${esc(l.name)}</strong><span class="t">${l.items.length} pieces · ${money(total / 100)}</span></button></li>`;
  }).join('');
}
function switchTo(id) {
  store.current = id; undoStack = []; redoStack = []; select(null);
  renderAll(); changed();
}
function addLayout(name, layoutItems, budget = L()?.budget ?? 2500) {
  const id = uid(); store.layouts[id] = { name, budget, items: layoutItems }; switchTo(id); return id;
}
$('#layouts').addEventListener('click', e => { const b = e.target.closest('[data-layout]'); if (b) switchTo(b.dataset.layout); });
$('#l-dup').addEventListener('click', () => addLayout(`${L().name} (copy)`, structuredClone(items())));
$('#l-new').addEventListener('click', () => addLayout('Suggested plan', suggestedItems(), 2500));
$('#l-empty').addEventListener('click', () => addLayout('Empty flat', []));
$('#l-rename').addEventListener('click', () => {
  const box = $('#rename'); box.hidden = !box.hidden; $('#rename-input').value = L().name; if (!box.hidden) $('#rename-input').focus();
});
$('#rename').addEventListener('submit', e => { e.preventDefault(); L().name = $('#rename-input').value.trim().slice(0, 60) || L().name; $('#rename').hidden = true; changed(); });
$('#l-del').addEventListener('click', () => {
  if (Object.keys(store.layouts).length === 1) return toast('This is your only layout, so it stays.');
  const b = $('#l-del');
  if (!b.dataset.armed) { b.dataset.armed = '1'; b.textContent = 'Click again to delete'; setTimeout(() => { delete b.dataset.armed; b.textContent = 'Delete'; }, 3000); return; }
  delete store.layouts[store.current]; switchTo(Object.keys(store.layouts)[0]);
});

const packable = () => ({ name: L().name, budget: L().budget, items: items().map(({ variants, uid: _u, ...rest }) => rest) });
async function pack(obj) {
  const stream = new Blob([JSON.stringify(obj)]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  let bin = ''; for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
async function unpack(str) {
  const bytes = Uint8Array.from(atob(str.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
  return JSON.parse(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).text());
}
function importLayout(data, fallbackName) {
  if (!Array.isArray(data?.items)) throw new Error('not a layout');
  addLayout(String(data.name || fallbackName).slice(0, 60), data.items.slice(0, 300).map(cleanItem), typeof data.budget === 'number' && data.budget >= 0 ? data.budget : 2500);
}
$('#l-share').addEventListener('click', async () => {
  let url;
  try { url = `${location.origin}${location.pathname}#plan=${await pack(packable())}`; }
  catch { return toast("This browser can't make share links. Use Download file instead."); }
  try { await navigator.clipboard.writeText(url); toast('Link copied. Opening it loads this layout as a new copy.'); }
  catch { prompt('Copy this link:', url); }
});
$('#l-export').addEventListener('click', () => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(packable(), null, 1)], { type: 'application/json' }));
  a.download = `casa-ams-${L().name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.json`;
  a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});
$('#l-import').addEventListener('change', async e => {
  const file = e.target.files[0]; if (!file) return;
  try { importLayout(JSON.parse(await file.text()), file.name.replace(/\.json$/, '')); toast('Layout imported.'); }
  catch { toast("That file isn't a Casa AMS layout."); }
  e.target.value = '';
});

// ---------- tabs, toolbar, toast ----------
function showTab(name) {
  for (const t of ['list', 'add', 'layouts']) {
    $('#tab-' + t).setAttribute('aria-selected', String(t === name));
    $('#pane-' + t).hidden = t !== name;
  }
  if (name === 'layouts') renderLayouts();
  if (name === 'add') renderResults();
}
for (const t of ['list', 'add', 'layouts']) $('#tab-' + t).addEventListener('click', () => showTab(t));

$('#v-orbit').onclick = () => setMode('orbit');
$('#v-top').onclick = () => setMode('top');
$('#v-walk').onclick = () => setMode('walk');
const toggle = (id, read, write) => { const b = $(id); b.onclick = () => { write(!read()); b.setAttribute('aria-pressed', String(read())); applyVisibility(); drawOverlay(); }; };
toggle('#t-cut', () => cut, v => { cut = v; });
toggle('#t-labels', () => labelsOn, v => { labelsOn = v; });
toggle('#t-zones', () => zonesOn, v => { zonesOn = v; });
$('#t-undo').onclick = () => travel(undoStack, redoStack);
$('#t-redo').onclick = () => travel(redoStack, undoStack);
$('#t-reset').onclick = () => { select(null); setMode(mode === 'walk' ? 'orbit' : mode); };

let toastTimer;
function toast(text) {
  const t = $('#toast'); t.textContent = text; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 3200);
}

function changed() {
  save(); runChecks(); renderList(); renderCard();
  if (!$('#pane-layouts').hidden) renderLayouts();
  $('#t-undo').disabled = !undoStack.length; $('#t-redo').disabled = !redoStack.length;
  if (mode === 'walk') walkObstacles();
}

// ---------- loop ----------
function resize() {
  const w = stage.clientWidth, h = stage.clientHeight;
  renderer.setSize(w, h, false); labelRenderer.setSize(w, h);
  camera.aspect = w / Math.max(h, 1); camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(stage);
resize();

const clock = new THREE.Clock();
function frame() {
  const dt = Math.min(clock.getDelta(), 0.05);
  if (tween) {
    const t = tween.ms ? Math.min(1, (performance.now() - tween.start) / tween.ms) : 1, k = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    camera.position.lerpVectors(tween.p0, tween.p1, k); controls.target.lerpVectors(tween.t0, tween.t1, k);
    if (t >= 1) tween = null;
  }
  if (mode === 'walk') {
    const has = k => walk.keys.has(k) || walk.pad.has(k);
    walk.yaw += ((has('l') ? 1 : 0) - (has('r') ? 1 : 0)) * 1.8 * dt;
    const f = (has('f') ? 1 : 0) - (has('b') ? 1 : 0), s = (has('sr') ? 1 : 0) - (has('sl') ? 1 : 0);
    const sp = 1.5 * dt, sin = Math.sin(walk.yaw), cos = Math.cos(walk.yaw);
    const dx = (-sin * f + cos * s) * sp, dz = (-cos * f - sin * s) * sp;
    if (!blocked(walk.pos.x + dx, walk.pos.z)) walk.pos.x += dx;
    if (!blocked(walk.pos.x, walk.pos.z + dz)) walk.pos.z += dz;
    camera.position.copy(walk.pos); camera.rotation.set(walk.pitch, walk.yaw, 0, 'YXZ');
  } else controls.update();
  if (selBox.visible) { const v = views.get(selected); if (v) selBox.setFromObject(v.group); }
  renderer.render(scene, camera);
  labelRenderer.render(scene, camera);
  requestAnimationFrame(frame);
}

// a shared link opens as a new layout, also when pasted into an open tab
const openedLinks = new Set();   // Back to an already-imported link must not import it again
async function openSharedLink() {
  if (!location.hash.startsWith('#plan=')) return;
  if (openedLinks.has(location.hash)) return history.replaceState(null, '', location.pathname);
  openedLinks.add(location.hash);
  try { importLayout(await unpack(location.hash.slice(6)), 'Shared plan'); setTimeout(() => toast('Shared layout loaded as a new copy.'), 300); }
  catch { setTimeout(() => toast("That link doesn't contain a valid layout."), 300); }
  history.replaceState(null, '', location.pathname);
}
window.addEventListener('hashchange', openSharedLink);
await openSharedLink();

renderAll();
const [p0, t0] = homeView(); camera.position.copy(p0); controls.target.copy(t0);
changed();
showTab('list');
frame();
