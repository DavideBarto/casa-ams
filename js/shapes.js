// Parametric 3D models for each kind of furniture, proportioned from the product's IKEA measurements
// (it.w/d/h plus it.sp: sofa layout, armrests, seat height, legs). Local millimetres, origin at the footprint
// centre on the floor, front of the piece faces +z.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { chairCount, chaiseWidth } from './fit.js';

export const H = 2600;   // ceiling height (assumed)
export const HUNG = new Set(['pendant', 'ceillamp', 'rod', 'curtain']);   // hang from the ceiling, ignore elevation
const m = v => v / 1000;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

// ---------- materials ----------
function canvasTex(size, draw, repeat = 1) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat, repeat); t.anisotropy = 4;
  return t;
}
let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const fabricTex = canvasTex(256, (x, s) => {        // woven upholstery: fine warp and weft
  x.fillStyle = '#f2f2f2'; x.fillRect(0, 0, s, s);
  for (let i = 0; i < s; i += 2) {
    x.fillStyle = `rgba(0,0,0,${0.04 + rnd() * 0.06})`; x.fillRect(0, i, s, 1);
    x.fillStyle = `rgba(0,0,0,${0.03 + rnd() * 0.05})`; x.fillRect(i, 0, 1, s);
  }
  for (let i = 0; i < 1800; i++) { x.fillStyle = `rgba(${rnd() < 0.5 ? '0,0,0' : '255,255,255'},0.06)`; x.fillRect(rnd() * s, rnd() * s, 2, 1); }
}, 4);
const woodTex = canvasTex(512, (x, s) => {          // long grain with a few knots
  x.fillStyle = '#ececec'; x.fillRect(0, 0, s, s);
  for (let i = 0; i < 140; i++) {
    const y = rnd() * s, a = 0.04 + rnd() * 0.1, amp = 2 + rnd() * 6, f = 0.004 + rnd() * 0.01;
    x.strokeStyle = `rgba(90,60,30,${a})`; x.lineWidth = 0.6 + rnd() * 1.8; x.beginPath();
    for (let px = 0; px <= s; px += 8) x.lineTo(px, y + Math.sin(px * f + i) * amp);
    x.stroke();
  }
  for (let i = 0; i < 3; i++) { const cx = rnd() * s, cy = rnd() * s; x.strokeStyle = 'rgba(90,60,30,0.12)'; for (let r = 2; r < 10; r += 2) { x.beginPath(); x.ellipse(cx, cy, r * 2.2, r, 0, 0, Math.PI * 2); x.stroke(); } }
});

const cache = new Map();
/** Plain painted material; also used by apartment.js. */
export function M(color, o = {}) {
  const key = 'M' + color + JSON.stringify(o);
  if (!cache.has(key)) cache.set(key, new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0, ...o }));
  return cache.get(key);
}
function mat(kind, color) {
  const key = kind + color;
  if (!cache.has(key)) {
    const o = {
      fabric: { map: fabricTex, bumpMap: fabricTex, bumpScale: 0.6, roughness: 0.95 },
      wood: { map: woodTex, roughness: 0.55 },
      paint: { roughness: 0.42 },
      metal: { metalness: 0.85, roughness: 0.3 },
      gloss: { roughness: 0.12 },
      mirror: { metalness: 1, roughness: 0.04 },
    }[kind];
    cache.set(key, new THREE.MeshStandardMaterial({ color, ...o }));
  }
  return cache.get(key);
}
const shade = (hex, k) => '#' + new THREE.Color(hex).multiplyScalar(k).getHexString();
const text = it => `${it.name || ''} ${it.type || ''} ${it.design || ''}`.toLowerCase();
const isWood = it => /oak|birch|pine|ash\b|walnut|beech|bamboo|acacia|teak|eucalyptus|veneer|wood|rattan|stained/.test(text(it)) && !/white stained|black-brown|effect, white/.test(text(it));
const body = it => mat(isWood(it) ? 'wood' : 'paint', it.color);
/** Leg/frame colour: metal when the design names it, black when the piece is pale and the design mentions black. */
function legMat(it) {
  const t = text(it);
  if (/chrome|steel|aluminium|nickel|brass|metal/.test(t)) return mat('metal', /brass/.test(t) ? '#b08d57' : '#b9bcc0');
  if (/black/.test(t) && it.color !== '#26282c') return mat('paint', '#26282c');
  if (isWood(it)) return mat('wood', it.color);
  return mat('paint', '#2b2b2b');
}

// ---------- geometry helpers (local mm) ----------
function add(g, geo, mat, x, y, z) {
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(m(x), m(y), m(z)); mesh.castShadow = mesh.receiveShadow = true;
  g.add(mesh); return mesh;
}
export function P(g, cx, cz, w, d, y0, h, mt) {
  return add(g, new THREE.BoxGeometry(m(Math.max(w, 1)), m(Math.max(h, 1)), m(Math.max(d, 1))), mt, cx, y0 + h / 2, cz);
}
/** Rounded box: upholstery, cushions, soft edges. */
function R(g, cx, cz, w, d, y0, h, mt, r = 20) {
  w = Math.max(w, 2); d = Math.max(d, 2); h = Math.max(h, 2);
  const rr = Math.min(r, w / 2 - 0.5, d / 2 - 0.5, h / 2 - 0.5);
  return add(g, new RoundedBoxGeometry(m(w), m(h), m(d), 3, m(Math.max(rr, 0.5))), mt, cx, y0 + h / 2, cz);
}
export function C(g, cx, cz, r, y0, h, mt, r2 = r, seg = 20) {
  return add(g, new THREE.CylinderGeometry(m(r2), m(r), m(Math.max(h, 1)), seg), mt, cx, y0 + h / 2, cz);
}
const sphere = (g, x, y, z, r, mt, sx = 1, sy = 1, sz = 1) => { const s = add(g, new THREE.SphereGeometry(m(r), 18, 12), mt, x, y, z); s.scale.set(sx, sy, sz); return s; };
const sub = (g, x, z, rotDeg) => { const s = new THREE.Group(); s.position.set(m(x), 0, m(z)); s.rotation.y = rotDeg * Math.PI / 180; g.add(s); return s; };
function legsAt(g, pts, h, mt, r = 18, taper = 0.75) { for (const [x, z] of pts) C(g, x, z, r * taper, 0, h, mt, r); }
const corners4 = (w, d, inset) => [[-w / 2 + inset, -d / 2 + inset], [w / 2 - inset, -d / 2 + inset], [w / 2 - inset, d / 2 - inset], [-w / 2 + inset, d / 2 - inset]];
/** 18 mm door/drawer front with a 3 mm shadow gap, flush with the front of a piece D deep. */
const front = (g, cx, w, D, y0, h, mt) => P(g, cx, D / 2 - 9, w - 3, 18, y0 + 1.5, h - 3, mt);
function barHandle(g, x, y, z, len, vertical, mt) {
  const bar = add(g, new THREE.CylinderGeometry(m(6), m(6), m(len), 10), mt, x, y, z + 30);
  if (!vertical) bar.rotation.z = Math.PI / 2;
  for (const s of [-1, 1]) add(g, new THREE.CylinderGeometry(m(4), m(4), m(26), 8), mt, vertical ? x : x + s * len / 2 * 0.9, vertical ? y + s * len / 2 * 0.9 : y, z + 17).rotation.x = Math.PI / 2;
}

// ---------- furniture ----------
const B = {
  sofa(g, it) {
    const { w, d, h } = it, sp = it.sp || {}, kind = sp.kind || 'straight', f = it.flip === -1 ? -1 : 1;
    const fab = mat('fabric', it.color), fab2 = mat('fabric', shade(it.color, 1.06)), t = text(it);
    const lm = /chrome|steel|metal/.test(t) ? mat('metal', '#b9bcc0') : /oak|birch|beech|wood/.test(t) ? mat('wood', '#b8935f') : mat('paint', '#2b2b2b');
    const leg = clamp(sp.leg ?? 90, 0, 250), seatH = clamp(sp.seatH || 440, 300, 550), armH = clamp(sp.armH || h * 0.75, seatH + 60, h);
    const arm = clamp(sp.arm || w * 0.07, 80, 260), md = kind === 'straight' ? d : Math.min(sp.md || d * 0.6, d);
    const backT = clamp(md * 0.22, 140, 260), cushT = 130, side = kind === 'chaise' ? chaiseWidth(it) : md;
    const X = x => x * f;   // layouts are drawn with the side part on +x, then mirrored
    const block = (x1, x2, z1, z2, y0, y1, mt, r = 30) => R(g, X((x1 + x2) / 2), (z1 + z2) / 2, Math.abs(x2 - x1), z2 - z1, y0, y1 - y0, mt, r);
    const seats = (x1, x2, z1, z2) => {         // base plus one cushion per ~65 cm
      block(x1, x2, z1, z2, leg, seatH - cushT, fab, 25);
      const along = (x2 - x1) >= (z2 - z1), len = along ? x2 - x1 : z2 - z1, n = Math.max(1, Math.round(len / 650));
      for (let i = 0; i < n; i++) {
        const a = (along ? x1 : z1) + i * len / n;
        if (along) block(a + 6, a + len / n - 6, z1 + 10, z2, seatH - cushT, seatH, fab2, 45);
        else block(x1 + 10, x2, a + 6, a + len / n - 6, seatH - cushT, seatH, fab2, 45);
      }
    };
    const backCushions = (x1, x2, z, dir) => {  // leaning cushions along a back; dir = +1 back on -z side, side backs use rotated groups
      const n = Math.max(1, Math.round((x2 - x1) / 650));
      for (let i = 0; i < n; i++) {
        const a = x1 + i * (x2 - x1) / n, c = R(g, X(a + (x2 - x1) / n / 2), z + dir * 95, (x2 - x1) / n - 14, 190, seatH - 10, h - seatH - 30, fab2, 70);
        c.rotation.x = -0.12 * dir;
      }
    };
    const legsUnder = rects => { if (leg < 15) return; for (const [x1, x2, z1, z2] of rects) legsAt(g, [[X(x1 + 50), z1 + 50], [X(x2 - 50), z1 + 50], [X(x2 - 50), z2 - 50], [X(x1 + 50), z2 - 50]], leg, lm, 18, 0.7); };
    const z0 = -d / 2;
    if (kind === 'straight') {
      block(-w / 2, w / 2, z0, z0 + backT, leg, h - 40, fab, 35);
      for (const s of [-1, 1]) block(s < 0 ? -w / 2 : w / 2 - arm, s < 0 ? -w / 2 + arm : w / 2, z0, d / 2, leg, armH, fab, 45);
      seats(-w / 2 + arm, w / 2 - arm, z0 + backT, d / 2);
      backCushions(-w / 2 + arm, w / 2 - arm, z0 + backT, 1);
      legsUnder([[-w / 2, w / 2, z0, d / 2]]);
      return;
    }
    // back run along -z, the full width
    block(-w / 2, w / 2, z0, z0 + backT, leg, h - 40, fab, 35);
    if (kind === 'chaise') {
      block(-w / 2, -w / 2 + arm, z0, z0 + md, leg, armH, fab, 45);                    // arm on the open end
      block(w / 2 - arm * 0.6, w / 2, z0, d / 2, leg, seatH + 60, fab, 40);             // low arm along the chaise
      seats(-w / 2 + arm, w / 2 - side, z0 + backT, z0 + md);
      seats(w / 2 - side, w / 2 - arm * 0.6, z0 + backT, d / 2);
      backCushions(-w / 2 + arm, w / 2 - arm * 0.6, z0 + backT, 1);
      legsUnder([[-w / 2, w / 2 - side, z0, z0 + md], [w / 2 - side, w / 2, z0, d / 2]]);
      return;
    }
    // corner / U: side runs with their own back on the outside, arms at the front ends
    const sides = kind === 'u' ? [-1, 1] : [1];
    for (const s of sides) {
      const xo = s * w / 2, xi = s * (w / 2 - md), xb = s * (w / 2 - backT);
      block(Math.min(xo, xb), Math.max(xo, xb), z0, d / 2, leg, h - 40, fab, 35);
      block(Math.min(xo, xi), Math.max(xo, xi), d / 2 - arm, d / 2, leg, armH, fab, 45);
      seats(Math.min(xi, xb), Math.max(xi, xb), z0 + md, d / 2 - arm);
      const cg = sub(g, X((xi + xb) / 2), (z0 + md + d / 2 - arm) / 2, s * f * 90);   // side back cushions, turned to face inward
      const len = d / 2 - arm - (z0 + md), n = Math.max(1, Math.round(len / 650));
      for (let i = 0; i < n; i++) R(cg, -len / 2 + (i + 0.5) * len / n, (md - backT) / 2 - 95, len / n - 14, 190, seatH - 10, h - seatH - 30, fab2, 70).rotation.x = 0.12;
    }
    if (kind === 'corner') block(-w / 2, -w / 2 + arm, z0, z0 + md, leg, armH, fab, 45);
    const x1 = kind === 'u' ? -w / 2 + backT : -w / 2 + arm, x2 = w / 2 - backT;
    seats(x1, x2, z0 + backT, z0 + md);
    backCushions(x1, x2, z0 + backT, 1);
    legsUnder([[-w / 2, w / 2, z0, z0 + md], ...sides.map(s => s > 0 ? [w / 2 - md, w / 2, z0 + md, d / 2] : [-w / 2, -w / 2 + md, z0 + md, d / 2])]);
  },
  armchair(g, it) { B.sofa(g, { ...it, sp: { ...it.sp, kind: 'straight' } }); },
  bed(g, it) {
    const { w, d, h } = it, sp = it.sp || {}, soft = sp.soft, wood = isWood(it);
    const mt = soft ? mat('fabric', it.color) : body(it), leg = clamp(sp.leg ?? (soft ? 100 : 160), 0, 400);
    const top = clamp(sp.foot || 400, 220, 700);
    if (sp.storage) R(g, 0, 0, w, d, 0, top, mt, soft ? 30 : 6);                       // storage beds sit on their drawers
    else {
      R(g, 0, 0, w, d - 40, leg, top - leg, mt, soft ? 40 : 6);
      legsAt(g, corners4(w, d - 40, 60), leg, wood ? mt : legMat(it), 22, 0.8);
    }
    if (sp.storage) for (const s of [-1, 1]) for (const z of [-d / 4, d / 4]) {
      const fr = P(g, s * (w / 2 + 2), z, 4, d / 2 - 40, 40, top - 120, mat('paint', shade(it.color, 0.92))); fr.rotation.y = 0;
    }
    const hbH = Math.max(h, top + 200), hbT = soft ? 110 : 40;
    R(g, 0, -d / 2 + hbT / 2, w + (soft ? 20 : 0), hbT, soft ? leg : 0, hbH - (soft ? leg : 0), mt, soft ? 50 : 6);
    if (soft) for (let i = 1; i < 4; i++) P(g, -w / 2 + i * w / 4, -d / 2 + hbT + 1, 4, 3, top + 60, hbH - top - 140, mat('fabric', shade(it.color, 0.8)));
  },
  mattress(g, it) {
    const { w, d, h } = it, linen = mat('fabric', '#f4f2ee'), duvet = mat('fabric', '#ece8df');
    R(g, 0, 0, w, d, 0, h, mat('fabric', it.color), 40);
    R(g, 0, d * 0.14, w + 40, d * 0.72, h, 80, duvet, 35);                               // duvet, for illustration
    for (const s of [-1, 1]) R(g, s * (w / 2 + 14), d * 0.14, 24, d * 0.72, h - 180, 220, duvet, 10);
    const n = w >= 1200 ? 2 : 1;
    for (let i = 0; i < n; i++) R(g, n === 1 ? 0 : (i ? 1 : -1) * w / 4, -d / 2 + 230, w / n - 70, 360, h, 140, linen, 60);
    R(g, 0, d / 2 - 220, w + 50, 380, h + 70, 30, mat('fabric', shade(it.color, 0.75)), 12);   // throw at the foot
  },
  wardrobe(g, it) {
    const { w, d, h } = it, b = body(it), t = text(it), hm = mat('metal', '#a9adb2');
    const doors = +(t.match(/(\d+)\s*doors?/)?.[1]) || Math.max(1, Math.min(6, Math.round(w / 500)));
    P(g, 0, -9, w, d - 18, 0, h, b);
    P(g, 0, d / 2 - 30, w - 10, 20, 0, 70, mat('paint', shade(it.color, 0.75)));          // plinth shadow
    if (/sliding/.test(t)) {
      for (const [i, z] of [[0, d / 2 - 4], [1, d / 2 - 30]]) P(g, (i ? 1 : -1) * w / 4, z, w / 2 + 20, 18, 80, h - 100, b);
      P(g, 0, d / 2 - 15, w, 30, h - 30, 30, hm);
      return;
    }
    const dw = w / doors, mirrorDoor = /mirror/.test(t) ? Math.floor(doors / 2) : -1;
    for (let i = 0; i < doors; i++) {
      const cx = -w / 2 + (i + 0.5) * dw;
      front(g, cx, dw, d, 75, h - 75, b);
      if (i === mirrorDoor) P(g, cx, d / 2 + 1, dw - 90, 4, 260, h - 520, mat('mirror', '#dfe6ea'));
      const hx = cx + (i % 2 ? -1 : 1) * (dw / 2 - 45);
      barHandle(g, hx, h * 0.5, d / 2 - 9, Math.min(320, h * 0.18), true, hm);
    }
  },
  chest(g, it) {
    const { w, d, h } = it, b = body(it), sp = it.sp || {}, hm = mat('metal', '#a9adb2'), t = text(it);
    const leg = clamp(sp.leg ?? 60, 0, 300);
    P(g, 0, -9, w, d - 18, leg, h - leg, b);
    if (leg > 70) legsAt(g, corners4(w, d - 18, 40), leg, legMat(it), 16, 0.7);
    else P(g, 0, -20, w - 30, d - 50, 0, leg, mat('paint', shade(it.color, 0.75)));
    const n = clamp(+(t.match(/(\d+)\s*drawers/)?.[1]) || Math.round((h - leg) / 180), 1, 9);
    const cols = w > 1000 && n % 2 === 0 ? 2 : 1, rows = n / cols;
    for (let c = 0; c < cols; c++) for (let r = 0; r < rows; r++) {
      const fw = w / cols, fh = (h - leg - 20) / rows, cx = -w / 2 + (c + 0.5) * fw, y0 = leg + 10 + r * fh;
      front(g, cx, fw, d, y0, fh, b);
      if (!/malm/.test(t)) barHandle(g, cx, y0 + fh * 0.62, d / 2 - 9, Math.min(160, fw * 0.4), false, hm);
    }
  },
  nightstand(g, it) {
    const { w, d, h } = it;
    if (/knarrevik|frame/.test(text(it))) {                                                  // slim metal frame with two trays
      const k = mat('paint', it.color);
      for (const y of [120, h - 30]) R(g, 0, 0, w, d, y, 30, k, 4);
      for (const [x, z] of corners4(w, d, 12)) C(g, x, z, 9, 0, h - 2, k);
      return;
    }
    B.chest(g, { ...it, type: `${it.type} 1 drawers`, sp: { leg: 120 } });
  },
  cabinet(g, it) {
    const { w, d, h } = it, b = body(it), t = text(it), sp = it.sp || {}, hm = mat('metal', '#a9adb2');
    const leg = clamp(sp.leg ?? (h < 700 ? 0 : 100), 0, 300);
    if (/trones/.test(t)) {                                                                 // rounded tilt-out fronts, wall-hung
      const n = Math.max(1, Math.round(w / 520));
      for (let i = 0; i < n; i++) R(g, -w / 2 + (i + 0.5) * w / n, 0, w / n - 6, d, 0, h, b, Math.min(60, d / 2));
      return;
    }
    P(g, 0, -9, w, d - 18, leg, h - leg, b);
    if (leg > 0) legsAt(g, corners4(w, d - 18, 50), leg, legMat(it), 16, 0.7);
    const n = Math.max(1, Math.round(w / 600)), fw = w / n, inner = mat('paint', shade(it.color, 0.55));
    for (let i = 0; i < n; i++) {
      const cx = -w / 2 + (i + 0.5) * fw;
      if (/tv/.test(t) && i === Math.floor(n / 2)) { P(g, cx, d / 2 - 12, fw - 40, 6, leg + 25, h - leg - 50, inner); continue; }   // open shelf for the box
      if (/tv bench\b/.test(t) && !/door|drawer/.test(t)) { P(g, cx, d / 2 - 12, fw - 40, 6, leg + 25, h - leg - 50, inner); continue; }
      front(g, cx, fw, d, leg + 5, h - leg - 10, b);
      if (/shoe/.test(t)) barHandle(g, cx, leg + h * 0.85, d / 2 - 9, fw * 0.4, false, hm);
      else barHandle(g, cx + (i % 2 ? -1 : 1) * (fw / 2 - 40), leg + (h - leg) * 0.55, d / 2 - 9, Math.min(140, h * 0.3), true, hm);
    }
  },
  shelf(g, it) {
    const { w, d, h } = it, b = body(it), t = text(it), kallax = /kallax/.test(t);
    const tk = kallax ? 38 : 18;
    for (const s of [-1, 1]) P(g, s * (w / 2 - tk / 2), 0, tk, d, 0, h, b);
    P(g, 0, -d / 2 + 4, w - 2 * tk, 8, 0, h, mat('paint', shade(it.color, 0.9)));
    const cols = kallax ? Math.max(1, Math.round(w / 390)) : 1, rows = Math.max(1, Math.round(h / (kallax ? 390 : 360)));
    for (let r = 0; r <= rows; r++) P(g, 0, 0, w - 2 * tk, d, Math.min(r * (h - tk) / rows, h - tk), tk, b);
    for (let c = 1; c < cols; c++) P(g, -w / 2 + c * w / cols, 0, tk, d, 0, h, b);
    // a few books and boxes so shelves read as shelves
    const tones = ['#b8443a', '#3e5c7a', '#d9c7a1', '#2f3a33', '#c9a14a', '#7d8a91', '#efe9de'];
    seed = Math.round(w + h);
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      if (rnd() < 0.35) continue;
      const cw = (w - 2 * tk) / cols, x0 = -w / 2 + tk + c * cw, y0 = r * (h - tk) / rows + tk, ch = (h - tk) / rows - tk;
      if (kallax && rnd() < 0.5) { R(g, x0 + cw / 2, 0, cw - 30, d - 30, y0, ch - 20, mat('fabric', tones[Math.floor(rnd() * tones.length)]), 12); continue; }
      let x = x0 + 15;
      const end = x0 + cw * (0.4 + rnd() * 0.55);
      while (x < end) { const bw = 20 + rnd() * 25, bh = ch * (0.6 + rnd() * 0.3); P(g, x + bw / 2, 0, bw, d * 0.75, y0, bh, M(tones[Math.floor(rnd() * tones.length)])); x += bw + 2; }
    }
  },
  desk(g, it) {
    const { w, d, h } = it, b = body(it), side = it.side === -1 ? -1 : 1;
    R(g, 0, 0, w, d, h - 25, 25, b, 4);
    if (/alex/i.test(it.name)) {
      const ax = side * (w / 2 - 190);
      P(g, ax, -10, 360, d - 40, 0, h - 25, b);
      for (let i = 0; i < 5; i++) front(g, ax, 360, d - 24, i * (h - 25) / 5, (h - 25) / 5, b);
      legsAt(g, [[-side * (w / 2 - 60), -d / 2 + 60], [-side * (w / 2 - 60), d / 2 - 60]], h - 25, mat('paint', shade(it.color, 0.95)), 24, 0.85);
    } else legsAt(g, corners4(w, d, 60), h - 25, isWood(it) ? b : legMat(it), 22, 0.85);
  },
  table(g, it) {
    const { w, d, h } = it, b = body(it), t = text(it), m2 = it.measure || '';
    const round = w === d && /\d/.test(m2) && !/x/i.test(m2), topT = /lack/.test(t) ? 50 : 30;
    if (round) {
      C(g, 0, 0, w / 2, h - topT, topT, b, w / 2, 48);
      C(g, 0, 0, w * 0.06, 20, h - topT - 20, legMat(it)); C(g, 0, 0, w * 0.22, 0, 20, legMat(it));
      return;
    }
    R(g, 0, 0, w, d, h - topT, topT, b, 5);
    if (/lack/.test(t)) {                                                               // thick square legs and a shelf below
      for (const [x, z] of corners4(w, d, 25)) P(g, x, z, 50, 50, 0, h - topT, b);
      P(g, 0, 0, w - 60, d - 60, 120, 20, b);
      return;
    }
    legsAt(g, corners4(w, d, 55), h - topT, isWood(it) ? b : legMat(it), Math.min(25, w / 40), isWood(it) ? 0.65 : 1);
    if (h > 600) for (const s of [-1, 1]) P(g, 0, s * (d / 2 - 55), w - 140, 18, h - topT - 70, 70, b);   // apron
  },
  lowtable(g, it) { B.table(g, it); },
  chair(g, it) {
    const { w, d, h } = it, seat = Math.min(460, h * 0.56), t = text(it), mt = isWood(it) || /outdoor|tärnö/.test(t) ? mat('wood', it.color) : mat('paint', it.color);
    const lm = /outdoor|tärnö|black/.test(t) ? mat('paint', '#26282c') : isWood(it) ? mt : mat('paint', shade(it.color, 0.9));
    if (/outdoor|slat|tärnö/.test(t)) { for (let i = 0; i < 4; i++) R(g, 0, -d * 0.4 + i * d * 0.25, w, d * 0.2, seat - 25, 25, mt, 5); }
    else R(g, 0, 0, w, d * 0.92, seat - 35, 35, mt, 12);
    for (const s of [-1, 1]) C(g, s * (w / 2 - 25), -d / 2 + 30, 12, seat, h - seat, lm);   // back posts
    const back = R(g, 0, -d / 2 + 28, w - 20, 22, seat + (h - seat) * 0.45, (h - seat) * 0.5, mt, 8); back.rotation.x = 0.08;
    legsAt(g, corners4(w, d * 0.9, 30), seat - 35, lm, 14, 0.7);
  },
  stool(g, it) {
    const { w, h } = it;
    C(g, 0, 0, w / 2, h - 40, 40, body(it), w / 2, 32);
    for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2 + Math.PI / 4; const l = C(g, Math.cos(a) * w * 0.33, Math.sin(a) * w * 0.33, 12, 0, h - 40, legMat(it)); l.rotation.set(Math.sin(a) * 0.08, 0, -Math.cos(a) * 0.08); }
    C(g, 0, 0, w * 0.32, h * 0.32, 12, legMat(it), w * 0.32);
  },
  bench(g, it) { const { w, d, h } = it; R(g, 0, 0, w, d, h - 40, 40, body(it), 8); legsAt(g, corners4(w, d, 60), h - 40, legMat(it), 20, 0.75); },
  pouf(g, it) { const { w, d, h } = it, mt = mat('fabric', it.color); if (Math.abs(w - d) < 20) { C(g, 0, 0, w / 2, 0, h - 30, mt, w / 2, 36); R(g, 0, 0, w * 0.98, d * 0.98, h - 60, 60, mt, 30); } else R(g, 0, 0, w, d, 0, h, mt, 50); },
  officechair(g, it) {
    const { w, d, h } = it, k = mat('fabric', it.color), base = mat('paint', '#25272b'), chrome = mat('metal', '#9da1a6');
    for (let i = 0; i < 5; i++) {
      const a = i * 2 * Math.PI / 5, r = w * 0.42;
      R(g, Math.cos(a) * r / 2, Math.sin(a) * r / 2, r, 40, 45, 28, base, 8).rotation.y = -a;
      sphere(g, Math.cos(a) * r, 25, Math.sin(a) * r, 25, base);
    }
    C(g, 0, 0, 25, 70, 380, chrome);
    R(g, 0, d * 0.05, w * 0.85, d * 0.82, 440, 90, k, 40);
    const back = R(g, 0, -d / 2 + 70, w * 0.78, 70, 580, Math.max(h - 580 - (h > 1250 ? 200 : 0), 320), k, 30); back.rotation.x = 0.1;
    if (h > 1250) R(g, 0, -d / 2 + 30, w * 0.5, 70, h - 190, 170, k, 30).rotation.x = 0.15;   // headrest
    for (const s of [-1, 1]) { R(g, s * w * 0.45, 0, 55, d * 0.45, 650, 30, base, 12); C(g, s * w * 0.45, -20, 14, 530, 120, base); }
  },
  floorlamp(g, it) {
    const { w, h } = it, t = text(it), metal = mat('metal', '#b9bcc0'), glow = M('#f6f3ea', { emissive: '#ffe9c4', emissiveIntensity: 0.45 });
    C(g, 0, 0, w / 2, 0, 18, metal, w / 2, 32);
    if (/reading|lersta/.test(t)) {                                                     // straight pole with a tilted reading head
      C(g, 0, 0, 10, 18, h - 160, metal);
      const head = add(g, new THREE.CylinderGeometry(m(60), m(80), m(150), 24, 1, true), M('#c9ccd0', { metalness: 0.6, roughness: 0.3, side: THREE.DoubleSide }), 60, h - 110, 0);
      head.rotation.z = -0.9;
      return;
    }
    if (/uplighter/.test(t)) { C(g, 0, 0, 12, 18, h - 80, metal); C(g, 0, 0, 90, h - 70, 70, glow, 160); return; }
    C(g, 0, 0, 12, 18, h - 300, metal);
    add(g, new THREE.CylinderGeometry(m(150), m(190), m(300), 32, 1, true), M('#f2efe6', { emissive: '#ffe9c4', emissiveIntensity: 0.4, side: THREE.DoubleSide }), 0, h - 150, 0);
  },
  tablelamp(g, it) {
    const { w, h } = it, t = text(it), c = mat('paint', it.color);
    if (/work lamp|tertial/.test(t)) {                                                  // clamp, two arms, cone shade
      P(g, 0, 0, 50, 70, -60, 80, c);
      const a1 = add(g, new THREE.CylinderGeometry(m(8), m(8), m(450), 10), c, 0, 230, 80); a1.rotation.x = 0.35;
      const a2 = add(g, new THREE.CylinderGeometry(m(8), m(8), m(380), 10), c, 0, 470, 320); a2.rotation.x = 1.25;
      add(g, new THREE.ConeGeometry(m(Math.max(w, 150) / 2), m(130), 24, 1, true), M(it.color, { side: THREE.DoubleSide, roughness: 0.42 }), 0, 390, 520).rotation.x = 0.5;
      return;
    }
    C(g, 0, 0, Math.max(w * 0.3, 50), 0, 25, c);
    C(g, 0, 0, 8, 25, h * 0.6, mat('metal', '#b9bcc0'));
    add(g, new THREE.CylinderGeometry(m(w * 0.38), m(w / 2), m(h * 0.38), 28, 1, true), M('#f2efe6', { emissive: '#ffe9c4', emissiveIntensity: 0.4, side: THREE.DoubleSide }), 0, h * 0.8, 0);
  },
  pendant(g, it) {
    const { w, h } = it, t = text(it), drop = 1000, y = H - drop;
    C(g, 0, 0, 3, y + h / 2, drop - h / 2, M('#2b2b2b'));
    if (/bamboo|rattan|sinnerlig/.test(t)) {                                            // woven sphere: shell plus bands
      sphere(g, 0, y, 0, w / 2, mat('wood', it.color), 1, h / w, 1);
      for (let i = -2; i <= 2; i++) { const r = Math.sqrt(1 - (i / 3) ** 2) * w / 2 + 2; const band = add(g, new THREE.TorusGeometry(m(r), m(4), 6, 32), mat('wood', shade(it.color, 0.8)), 0, y + i * h / 6, 0); band.rotation.x = Math.PI / 2; }
      sphere(g, 0, y, 0, w / 4, M('#fff3d6', { emissive: '#ffe2b0', emissiveIntensity: 0.9 }));
      return;
    }
    const dome = add(g, new THREE.SphereGeometry(m(w / 2), 28, 14, 0, Math.PI * 2, 0, Math.PI / 2), M(it.color, { side: THREE.DoubleSide, roughness: 0.42 }), 0, y, 0);
    dome.scale.y = h / w * 1.6;
    sphere(g, 0, y - 10, 0, 40, M('#fff3d6', { emissive: '#ffe2b0', emissiveIntensity: 1 }));
  },
  ceillamp(g, it) { const { w, h } = it; C(g, 0, 0, w / 2, H - h, h, M('#fbfbf9', { emissive: '#fff3d6', emissiveIntensity: 0.5 }), w / 2 * 0.92, 40); },
  rug(g, it) {
    const { w, d, h } = it, round = w === d && it.measure && !/x/i.test(it.measure);
    if (round) C(g, 0, 0, w / 2, 0, Math.max(h, 8), mat('fabric', it.color), w / 2, 48);
    else { R(g, 0, 0, w, d, 0, Math.max(h, 8), mat('fabric', it.color), 4); R(g, 0, 0, w - 120, d - 120, 1, Math.max(h, 8), mat('fabric', shade(it.color, 0.93)), 3); }
  },
  curtain(g, it) {
    const { w, h } = it, top = Math.min(h, H - 150), stack = Math.max(350, w * 0.42), folds = 9;
    const geo = new THREE.PlaneGeometry(m(stack), m(top), folds * 8, 1);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) pos.setZ(i, m(28) * Math.sin(pos.getX(i) / m(stack) * folds * Math.PI * 2));
    geo.computeVertexNormals();
    const fab = mat('fabric', it.color).clone(); fab.side = THREE.DoubleSide;
    add(g, geo, fab, 0, H - 150 - top / 2, 0);
  },
  rod(g, it) {
    const { w } = it, c = mat('paint', it.color);
    const r = add(g, new THREE.CylinderGeometry(m(10), m(10), m(w), 12), c, 0, H - 150, 0); r.rotation.z = Math.PI / 2;
    for (const s of [-1, 1]) { sphere(g, s * w / 2, H - 150, 0, 18, c); P(g, s * (w / 2 - 80), 20, 18, 60, H - 160, 20, c); }
  },
  mirror(g, it) {
    const { w, d, h } = it;
    R(g, 0, 0, w, Math.max(d, 18), 0, h, mat('paint', '#26282c'), 6);
    P(g, 0, Math.max(d, 18) / 2 + 1, w - 30, 3, 15, h - 30, mat('mirror', '#dfe6ea'));
  },
  plant(g, it) {
    const { w, h } = it, pot = mat('paint', '#e6e1d8'), leaf = [mat('paint', '#4f7d48'), mat('paint', '#5f8f52'), mat('paint', '#3f6b3b')];
    C(g, 0, 0, w * 0.32, 0, h * 0.28, pot, w * 0.4, 28);
    C(g, 0, 0, 10, h * 0.28, h * 0.4, M('#6b5a3e'));
    seed = Math.round(w * 3 + h);
    for (let i = 0; i < 9; i++) {
      const a = rnd() * Math.PI * 2, r = w * (0.1 + rnd() * 0.3), y = h * (0.45 + rnd() * 0.5);
      sphere(g, Math.cos(a) * r, y, Math.sin(a) * r, w * 0.22, leaf[i % 3], 1.3, 0.5, 0.8).rotation.y = a;
    }
  },
  coatstand(g, it) {
    const { w, h } = it, c = mat(isWood(it) ? 'wood' : 'paint', it.color);
    C(g, 0, 0, w / 2, 0, 20, c, w / 2, 28); C(g, 0, 0, 14, 20, h - 20, c);
    for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2; R(g, Math.cos(a) * 110, Math.sin(a) * 110, 160, 16, h - 200, 16, c, 6).rotation.y = -a; }
  },
  tv(g, it) {
    const { w, d, h } = it;
    R(g, 0, 0, Math.min(w * 0.3, 350), d * 0.8, 0, 14, mat('metal', '#2a2c30'), 6);
    P(g, 0, -10, 50, 30, 14, 70, mat('metal', '#2a2c30'));
    R(g, 0, 0, w, 30, 80, h - 80, mat('gloss', '#111214'), 6);
    P(g, 0, 16, w - 16, 2, 88, h - 96, M('#0b0d12', { roughness: 0.08, emissive: '#0d1626', emissiveIntensity: 0.4 }));
  },
  diningset(g, it) {
    const { w, d, h } = it, n = chairCount(it);
    B.table(g, { ...it, type: 'table' });
    const perSide = Math.max(1, Math.ceil(n / 2)), chair = { ...it, w: 450, d: 470, h: 800 };
    for (let i = 0; i < n; i++) {
      const s = i % 2 ? 1 : -1, k = Math.floor(i / 2), x = perSide === 1 ? 0 : -w / 2 + (k + 0.5) * w / perSide;
      B.chair(sub(g, x, s * (d / 2 + 350 - 235), s > 0 ? 180 : 0), chair);
    }
  },
  box(g, it) { R(g, 0, 0, it.w, it.d, 0, it.h, body(it), 12); },
  accessory() {},
};

/** A three.js group for an item, in metres, positioned and rotated on the plan. */
export function buildShape(it) {
  const g = new THREE.Group(), inner = new THREE.Group();
  inner.position.y = HUNG.has(it.shape) ? 0 : m(it.elev || 0);
  (B[it.shape] || B.box)(inner, it);
  g.add(inner);
  g.position.set(m(it.x), 0, m(it.y));
  g.rotation.y = (it.rot || 0) * Math.PI / 180;
  return g;
}
