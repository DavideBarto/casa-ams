// Parametric 3D stand-ins for each kind of furniture. Local millimetres, origin at the footprint centre on the floor,
// front of the piece faces +z. Every builder fills the item's w × d × h box so sizes read true.
import * as THREE from 'three';
import { chairCount } from './fit.js';

export const H = 2600;   // ceiling height (assumed)
const m = v => v / 1000;
const mats = new Map();
export function M(color, o = {}) {
  const key = color + JSON.stringify(o);
  if (!mats.has(key)) mats.set(key, new THREE.MeshStandardMaterial({ color, roughness: 0.75, metalness: 0, ...o }));
  return mats.get(key);
}
const shade = (hex, k) => '#' + new THREE.Color(hex).multiplyScalar(k).getHexString();

export function P(g, cx, cz, w, d, y0, h, mat) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(m(Math.max(w, 1)), m(Math.max(h, 1)), m(Math.max(d, 1))), mat);
  mesh.position.set(m(cx), m(y0 + h / 2), m(cz));
  mesh.castShadow = mesh.receiveShadow = true;
  g.add(mesh); return mesh;
}
export function C(g, cx, cz, r, y0, h, mat, r2 = r) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(m(r2), m(r), m(h), 24), mat);
  mesh.position.set(m(cx), m(y0 + h / 2), m(cz));
  mesh.castShadow = mesh.receiveShadow = true;
  g.add(mesh); return mesh;
}
const sub = (g, x, z, rotDeg) => { const s = new THREE.Group(); s.position.set(m(x), 0, m(z)); s.rotation.y = rotDeg * Math.PI / 180; g.add(s); return s; };
const legs = (g, w, d, h, mat, inset = 40, r = 18) => { for (const x of [-1, 1]) for (const z of [-1, 1]) C(g, x * (w / 2 - inset), z * (d / 2 - inset), r, 0, h, mat); };

const DARK = M('#2b2b2b');
const B = {
  sofa(g, { w, d, h, color }) {
    const c = M(color), c2 = M(shade(color, 1.08)), arm = Math.min(160, w * 0.08);
    P(g, 0, 0, w, d, 90, h * 0.4, c);
    P(g, 0, d * 0.07, w - 2 * arm, d * 0.8, 90 + h * 0.4, h * 0.07, c2);
    P(g, 0, -d / 2 + d * 0.1, w, d * 0.2, 90, h - 90, c);
    for (const s of [-1, 1]) P(g, s * (w / 2 - arm / 2), d * 0.04, arm, d * 0.92, 90, h * 0.65 - 90, c);
    const n = Math.max(1, Math.round((w - 2 * arm) / 700));
    for (let i = 0; i < n; i++) P(g, -w / 2 + arm + (i + 0.5) * (w - 2 * arm) / n, -d / 2 + d * 0.27, (w - 2 * arm) / n - 20, d * 0.14, h * 0.47 + 90, h * 0.4, c2);
    legs(g, w, d, 90, DARK, 50, 18);
  },
  armchair(g, o) { B.sofa(g, o); },
  bed(g, { w, d, h, color }) {
    const c = M(color);
    P(g, 0, 0, w, d, 100, 300, c);
    P(g, 0, -d / 2 + 40, w, 80, 100, Math.max(h, 400) - 100, c);
    legs(g, w, d, 100, DARK, 50, 20);
  },
  mattress(g, { w, d, h, color }) {
    P(g, 0, 0, w, d, 0, h, M(color));
    P(g, 0, d * 0.16, w + 20, d * 0.7, h, 60, M('#efece6'));                    // duvet, for illustration
    for (const s of [-1, 1]) P(g, s * w / 4, -d / 2 + 210, w / 2 - 40, 300, h, 120, M('#ffffff'));
  },
  wardrobe(g, { w, d, h, color, type }) {
    const body = M(color), seam = M(shade(color, 0.78)), handle = M('#8f9296', { metalness: 0.5 });
    const doors = +(type.match(/(\d+)\s*doors?/i)?.[1]) || Math.max(1, Math.min(4, Math.round(w / 500)));
    P(g, 0, 0, w, d, 0, h, body);
    const dw = w / doors;
    for (let i = 1; i < doors; i++) P(g, -w / 2 + i * dw, d / 2 + 1, 6, 4, 60, h - 80, seam);
    for (let i = 0; i < doors; i++) P(g, -w / 2 + (i + 0.5) * dw + (i < doors / 2 ? 1 : -1) * (dw / 2 - 50), d / 2 + 10, 14, 18, h * 0.45, 180, handle);
  },
  chest(g, { w, d, h, color }) {
    const body = M(color), seam = M(shade(color, 0.78)), knob = M('#8f9296', { metalness: 0.5 });
    P(g, 0, 0, w, d, 60, h - 60, body); P(g, 0, 0, w - 40, d - 40, 0, 60, M(shade(color, 0.85)));
    const n = Math.max(1, Math.min(8, Math.round((h - 60) / 190)));
    for (let i = 1; i < n; i++) P(g, 0, d / 2 + 1, w - 20, 4, 60 + i * (h - 60) / n, 4, seam);
    for (let i = 0; i < n; i++) P(g, 0, d / 2 + 8, 120, 14, 60 + (i + 0.5) * (h - 60) / n - 8, 16, knob);
  },
  nightstand(g, { w, d, h, color }) {
    const c = M(color);
    P(g, 0, 0, w, d, h - 30, 30, c); P(g, 0, 0, w, d, 120, 20, c);
    for (const x of [-1, 1]) for (const z of [-1, 1]) P(g, x * (w / 2 - 12), z * (d / 2 - 12), 24, 24, 0, h - 30, c);
  },
  cabinet(g, { w, d, h, color }) {
    const body = M(color), seam = M(shade(color, 0.8));
    P(g, 0, 0, w, d, Math.min(80, h * 0.12), h - Math.min(80, h * 0.12), body);
    P(g, 0, -10, w - 30, d - 30, 0, Math.min(80, h * 0.12), M(shade(color, 0.85)));
    const n = Math.max(1, Math.round(w / 600));
    for (let i = 1; i < n; i++) P(g, -w / 2 + i * w / n, d / 2 + 1, 6, 4, 100, h - 120, seam);
  },
  shelf(g, { w, d, h, color }) {
    const c = M(color), t = 18;
    for (const s of [-1, 1]) P(g, s * (w / 2 - t / 2), 0, t, d, 0, h, c);
    P(g, 0, -d / 2 + 4, w, 8, 0, h, M(shade(color, 0.9)));
    const n = Math.max(1, Math.round(h / 360));
    for (let i = 0; i <= n; i++) P(g, 0, 0, w - 2 * t, d, Math.min(i * h / n, h - t), t, c);
  },
  desk(g, { w, d, h, color, name, side = 1 }) {
    const c = M(color);
    P(g, 0, 0, w, d, h - 25, 25, c);
    if (/alex/i.test(name)) {
      const ax = side * (w / 2 - 180);
      P(g, ax, 0, 360, d - 20, 0, h - 25, c);
      for (let i = 1; i < 5; i++) P(g, ax, d / 2 - 9, 340, 3, i * (h - 25) / 5, 4, M(shade(color, 0.85)));
      for (const z of [-1, 1]) C(g, -side * (w / 2 - 60), z * (d / 2 - 60), 22, 0, h - 25, M(shade(color, 0.95)));
    } else legs(g, w, d, h - 25, M(shade(color, 0.9)), 60, 22);
  },
  table(g, { w, d, h, color, measure = '' }) {
    const c = M(color), round = w === d && /\d/.test(measure) && !/x/i.test(measure);   // "105 cm" = round top
    if (round) C(g, 0, 0, w / 2, h - 30, 30, c);
    else P(g, 0, 0, w, d, h - 30, 30, c);
    legs(g, round ? w * 0.6 : w, round ? d * 0.6 : d, h - 30, M(shade(color, 0.9)), 50, Math.min(25, w / 40));
  },
  lowtable(g, o) { B.table(g, o); },
  chair(g, { w, d, h, color }) {
    const seat = Math.min(460, h * 0.56);
    P(g, 0, 0, w, d * 0.9, seat - 30, 30, M(color));
    P(g, 0, -d / 2 + 20, w, 40, seat, h - seat, M(color));
    for (const x of [-1, 1]) for (const z of [-1, 1]) C(g, x * (w / 2 - 30), z * (d / 2 - 40), 12, 0, seat - 30, DARK);
  },
  stool(g, { w, h, color }) {
    C(g, 0, 0, w / 2, h - 40, 40, M(color));
    for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2 + Math.PI / 4; C(g, Math.cos(a) * w * 0.35, Math.sin(a) * w * 0.35, 12, 0, h - 40, DARK); }
  },
  bench(g, { w, d, h, color }) { P(g, 0, 0, w, d, h - 40, 40, M(color)); legs(g, w, d, h - 40, M(shade(color, 0.85)), 60, 20); },
  pouf(g, { w, d, h, color }) { if (Math.abs(w - d) < 20) C(g, 0, 0, w / 2, 0, h, M(color)); else P(g, 0, 0, w, d, 0, h, M(color)); },
  officechair(g, { w, d, h, color }) {
    const k = M(color), base = M('#25272b');
    for (let i = 0; i < 5; i++) {
      const a = i * 2 * Math.PI / 5, r = w * 0.42;
      P(g, Math.cos(a) * r / 2, Math.sin(a) * r / 2, r, 40, 40, 30, base).rotation.y = -a;
      C(g, Math.cos(a) * r, Math.sin(a) * r, 25, 0, 40, base);
    }
    C(g, 0, 0, 25, 70, 380, M('#9da1a6', { metalness: 0.5 }));
    P(g, 0, d * 0.05, w * 0.85, d * 0.8, 450, 80, k);
    P(g, 0, -d / 2 + 60, w * 0.8, 60, 560, Math.max(h - 560, 300), k);
    for (const s of [-1, 1]) P(g, s * w * 0.45, 0, 50, d * 0.45, 640, 30, base);
  },
  floorlamp(g, { w, h, color }) {
    const al = M('#b9bcc0', { metalness: 0.6, roughness: 0.35 });
    C(g, 0, 0, w / 2, 0, 20, al); C(g, 0, 0, 10, 20, h - 180, al);
    C(g, 0, 0, 90, h - 180, 180, M(color === '#26282c' ? '#2f3237' : '#f2f1ee', { emissive: '#fff1d0', emissiveIntensity: 0.3 }), 65);
  },
  tablelamp(g, { w, h, color }) {
    C(g, 0, 0, Math.max(w * 0.35, 50), 0, 20, M(shade(color, 0.8)));
    C(g, 0, 0, 8, 20, h * 0.65, M(shade(color, 0.8)));
    C(g, 0, 0, w / 2, h * 0.65, h * 0.35, M(color, { emissive: '#fff1d0', emissiveIntensity: 0.25 }), w / 2.6);
  },
  pendant(g, { w, h, color }) {
    const drop = 1000;                                   // shade bottom ~1.6 m: over a table
    C(g, 0, 0, 4, H - drop + h * 0.5, drop - h * 0.5, DARK);
    const s = new THREE.Mesh(new THREE.SphereGeometry(m(w / 2), 20, 14), M(color, { emissive: '#5a3a10', emissiveIntensity: 0.25 }));
    s.scale.y = h / w; s.position.y = m(H - drop); s.castShadow = true; g.add(s);
  },
  ceillamp(g, { w, h, color }) { C(g, 0, 0, w / 2, H - h, h, M(color, { emissive: '#fff3d6', emissiveIntensity: 0.35 })); },
  rug(g, { w, d, h, color }) { P(g, 0, 0, w, d, 0, Math.max(h, 8), M(color, { roughness: 1 })); },
  curtain(g, { w, h, color }) {
    const c = M(color, { roughness: 0.95 }), stack = Math.max(300, w * 0.4), top = Math.min(h, H - 150);
    for (let i = 0; i < 5; i++) P(g, -stack / 2 + (i + 0.5) * stack / 5, i % 2 ? 22 : -12, stack / 5 + 15, 45, Math.max(20, H - 150 - top), top, c);
  },
  rod(g, { w, color }) {
    const r = new THREE.Mesh(new THREE.CylinderGeometry(m(10), m(10), m(w), 12), M(color));
    r.rotation.z = Math.PI / 2; r.position.y = m(H - 150); g.add(r);
    for (const x of [-w / 2 + 60, w / 2 - 60]) P(g, x, 20, 20, 60, H - 160, 20, M(color));
  },
  mirror(g, { w, d, h }) {
    P(g, 0, 0, w, Math.max(d, 15), 0, h, M('#26282c'));
    P(g, 0, Math.max(d, 15) / 2 + 2, w - 30, 4, 15, h - 30, M('#c9d6df', { metalness: 0.5, roughness: 0.15 }));
  },
  plant(g, { w, h }) {
    C(g, 0, 0, w * 0.35, 0, h * 0.3, M('#d8d3ca'), w * 0.42);
    const s = new THREE.Mesh(new THREE.SphereGeometry(m(w / 2), 14, 10), M('#5f8a55'));
    s.scale.y = (h * 0.75) / w; s.position.y = m(h * 0.3 + h * 0.35); s.castShadow = true; g.add(s);
  },
  coatstand(g, { w, h, color }) {
    const c = M(color);
    C(g, 0, 0, w / 2, 0, 20, c); C(g, 0, 0, 14, 20, h - 20, c);
    for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2; P(g, Math.cos(a) * 110, Math.sin(a) * 110, 160, 16, h - 200, 16, c).rotation.y = -a; }
  },
  tv(g, { w, d, h, color }) {
    P(g, 0, 0, Math.min(w * 0.3, 350), d * 0.8, 0, 20, M('#1d1f23'));
    P(g, 0, 0, 60, 40, 20, 60, M('#1d1f23'));
    P(g, 0, 0, w, 40, 80, h - 80, M(color, { roughness: 0.3 }));
  },
  diningset(g, it) {
    const { w, d, h, color } = it, n = chairCount(it);
    B.table(g, { w, d, h, color });
    const perSide = Math.max(1, Math.ceil(n / 2)), chair = { w: 450, d: 470, h: 800, color };
    for (let i = 0; i < n; i++) {
      const side = i % 2 ? 1 : -1, k = Math.floor(i / 2), x = perSide === 1 ? 0 : -w / 2 + (k + 0.5) * w / perSide;
      B.chair(sub(g, x, side * (d / 2 + 350 - 235), side > 0 ? 180 : 0), chair);
    }
  },
  box(g, { w, d, h, color }) { P(g, 0, 0, w, d, 0, h, M(color)); },
  accessory() {},
};

/** A three.js group for an item, in metres, positioned and rotated on the plan. */
export function buildShape(it) {
  const g = new THREE.Group();
  const inner = new THREE.Group();
  inner.position.y = ['pendant', 'ceillamp', 'rod', 'curtain'].includes(it.shape) ? 0 : m(it.elev || 0);   // hung pieces ignore elevation
  (B[it.shape] || B.box)(inner, it);
  g.add(inner);
  g.position.set(m(it.x), 0, m(it.y));
  g.rotation.y = (it.rot || 0) * Math.PI / 180;
  return g;
}
