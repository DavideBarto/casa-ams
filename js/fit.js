// Fit checks in plan millimetres (x east, y south). Pure functions, no three.js, so tests/fit.test.mjs can run them.

// Things that never block anything: they hang, lie flat, or sit on other furniture.
export const DECOR = new Set(['rug', 'curtain', 'rod', 'mirror', 'ceillamp', 'pendant', 'tablelamp', 'mattress', 'accessory']);
const SEATS = new Set(['chair', 'officechair', 'stool']);
const TUCK = new Set(['table', 'desk', 'diningset', 'lowtable']);   // seats may slide under these
// Free space each kind of furniture needs in front of it (mm): doors, drawers, a chair, legs.
const FRONT = { wardrobe: 600, chest: 500, cabinet: 400, shelf: 400, desk: 700, sofa: 300, armchair: 300, bed: 500 };
const CHAIR_OUT = 350;   // how far a tucked-in dining chair sticks out past the table edge

export const solid = it => it.placed !== false && !DECOR.has(it.shape);

// Oriented footprint. rot follows three.js rotation.y: local (x, z) -> (x cos + z sin, -x sin + z cos).
export function footprint(it) {
  const d = it.shape === 'diningset' && chairCount(it) ? it.d + 2 * CHAIR_OUT : it.d;
  return { cx: it.x, cy: it.y, hw: it.w / 2, hd: d / 2, a: (it.rot || 0) * Math.PI / 180 };
}
export const chairCount = it => +((it.type || '').match(/(\d+)\s*(?:folding\s+)?chairs/i)?.[1] || 0);

// L- and U-shaped sofas: rectangles in item-local mm ({ lx, lz, hw, hd }), front = +z, chaise on the +x side unless flipped.
export const chaiseWidth = it => Math.min(1000, Math.max(750, it.w * 0.32));
export function localParts(it) {
  const f = footprint(it), kind = it.shape === 'sofa' ? it.sp?.kind : null;
  if (!['chaise', 'corner', 'u'].includes(kind)) return [{ lx: 0, lz: 0, hw: f.hw, hd: f.hd }];
  const md = Math.min(it.sp.md || it.d * 0.6, it.d), side = kind === 'chaise' ? chaiseWidth(it) : md, flip = it.flip === -1 ? -1 : 1;
  const out = [{ lx: 0, lz: -f.hd + md / 2, hw: f.hw, hd: md / 2 }];                 // the run along the back
  for (const s of kind === 'u' ? [-1, 1] : [flip]) out.push({ lx: s * (f.hw - side / 2), lz: 0, hw: side / 2, hd: f.hd });
  return out;
}
const toPlan = (f, { lx, lz, hw, hd }) => ({ cx: f.cx + lx * Math.cos(f.a) + lz * Math.sin(f.a), cy: f.cy - lx * Math.sin(f.a) + lz * Math.cos(f.a), hw, hd, a: f.a });
export const parts = it => { const f = footprint(it); return localParts(it).map(p => toPlan(f, p)); };

export function corners({ cx, cy, hw, hd, a }) {
  const c = Math.cos(a), s = Math.sin(a);
  return [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]].map(([x, y]) => [cx + x * c + y * s, cy - x * s + y * c]);
}
const rectPoly = ([x1, y1, x2, y2]) => [[x1, y1], [x2, y1], [x2, y2], [x1, y2]];

// Separating-axis test for two convex quads. Touching (within eps) does not count as overlapping.
export function polysOverlap(p, q, eps = 1) {
  for (const poly of [p, q]) {
    for (let i = 0; i < 4; i++) {
      const [x1, y1] = poly[i], [x2, y2] = poly[(i + 1) % 4];
      const nx = y1 - y2, ny = x2 - x1, len = Math.hypot(nx, ny) || 1;
      const proj = pts => pts.map(([x, y]) => (x * nx + y * ny) / len);
      const a = proj(p), b = proj(q);
      if (Math.max(...a) - eps <= Math.min(...b) || Math.max(...b) - eps <= Math.min(...a)) return false;
    }
  }
  return true;
}

export function aabb(poly) {
  const xs = poly.map(p => p[0]), ys = poly.map(p => p[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

const vertical = (a, b) => (a.elev || 0) < (b.elev || 0) + b.h - 1 && (b.elev || 0) < (a.elev || 0) + a.h - 1;

// Zones in front of (and for beds, beside) a piece that should stay free.
export function clearanceZones(it) {
  const c = FRONT[it.shape];
  if (!c) return [];
  const f = footprint(it), zones = [];
  const local = (lx, lz, hw, hd, need) => ({ ...toPlan(f, { lx, lz, hw, hd }), need });
  const [back, ...sides] = localParts(it);
  if (sides.length) {   // L/U sofa: the free space is in front of the seats between the side parts
    const x1 = Math.max(-f.hw, ...sides.filter(p => p.lx < 0).map(p => p.lx + p.hw));
    const x2 = Math.min(f.hw, ...sides.filter(p => p.lx > 0).map(p => p.lx - p.hw));
    zones.push(local((x1 + x2) / 2, back.lz + back.hd + c / 2, (x2 - x1) / 2, c / 2, `${c / 10} cm free in front`));
    return zones;
  }
  zones.push(local(0, f.hd + c / 2, f.hw, c / 2, `${c / 10} cm free in front`));
  if (it.shape === 'bed') {   // getting in and out on both sides, along the foot end of the bed
    for (const s of [-1, 1]) zones.push(local(s * (f.hw + 225), f.hd * 0.4, 225, f.hd * 0.6, '45 cm free beside it'));
  }
  return zones;
}

// Square around a 90° door swing: hinge plus the two arc end points.
export function doorZone({ hx, hy, r, a0, a1 }) {
  const pt = a => [hx + r * Math.cos(a * Math.PI / 180), hy + r * Math.sin(a * Math.PI / 180)];
  const [p, q] = [pt(a0), pt(a1)];
  return [Math.min(hx, p[0], q[0]), Math.min(hy, p[1], q[1]), Math.max(hx, p[0], q[0]), Math.max(hy, p[1], q[1])];
}

const inRooms = (x, y, rooms) => rooms.some(r => r.rects.some(([x1, y1, x2, y2]) => x >= x1 && x <= x2 && y >= y1 && y <= y2));
export const roomOf = (it, rooms) => rooms.find(r => r.rects.some(([x1, y1, x2, y2]) => it.x >= x1 && it.x <= x2 && it.y >= y1 && it.y <= y2));

/** Every fit problem in the layout: { uids, level: 'error' | 'warn', text }. */
export function checkLayout(items, { walls, doors, rooms }) {
  const issues = [];
  const placed = items.filter(solid);
  const polys = new Map(placed.map(it => [it.uid, parts(it).map(corners)]));   // one quad, or several for L-shaped sofas
  const hits = (ps, q) => ps.some(p => polysOverlap(p, q));
  const hitsAny = (ps, qs) => qs.some(q => hits(ps, q));
  const label = it => it.name;

  for (const it of placed) {
    const p = polys.get(it.uid);
    if (!inRooms(it.x, it.y, rooms)) issues.push({ uids: [it.uid], level: 'error', text: `${label(it)} is outside the apartment` });
    else if (walls.some(w => hits(p, rectPoly(w)))) issues.push({ uids: [it.uid], level: 'error', text: `${label(it)} runs into a wall` });
    for (const door of doors) {
      if (hits(p, rectPoly(doorZone(door)))) issues.push({ uids: [it.uid], level: 'warn', text: `${label(it)} blocks the ${door.name} door` });
    }
    for (const zone of clearanceZones(it)) {
      const z = corners(zone);
      const blocker = walls.some(w => polysOverlap(z, rectPoly(w)))
        ? 'a wall'
        : placed.find(o => o !== it && !(SEATS.has(o.shape) && TUCK.has(it.shape)) && hits(polys.get(o.uid), z))?.name;
      if (blocker) { issues.push({ uids: [it.uid], level: 'warn', text: `${label(it)} needs about ${zone.need}; ${blocker} is in the way` }); break; }
    }
  }
  for (let i = 0; i < placed.length; i++) {
    for (let j = i + 1; j < placed.length; j++) {
      const a = placed[i], b = placed[j];
      const tucked = (SEATS.has(a.shape) && TUCK.has(b.shape)) || (SEATS.has(b.shape) && TUCK.has(a.shape));
      if (!tucked && vertical(a, b) && hitsAny(polys.get(a.uid), polys.get(b.uid))) {
        issues.push({ uids: [a.uid, b.uid], level: 'error', text: `${label(a)} overlaps ${label(b)}` });
      }
    }
  }
  return issues;
}

/** Free distance from a piece to the nearest obstacle on each side (plan axes): { px, nx, py, ny } in mm, or null. */
export function gaps(it, items, walls, max = 6000) {
  const [x1, y1, x2, y2] = aabb(corners(footprint(it)));
  const obstacles = [...walls, ...items.filter(o => o.uid !== it.uid && solid(o) && vertical(o, it)).flatMap(o => parts(o).map(p => aabb(corners(p))))];
  const best = { px: null, nx: null, py: null, ny: null };
  const take = (k, d) => { if (d >= -1 && d < max && (best[k] === null || d < best[k])) best[k] = Math.max(0, d); };
  for (const [a1, b1, a2, b2] of obstacles) {
    if (b1 < y2 - 1 && b2 > y1 + 1) { take('px', a1 - x2); take('nx', x1 - a2); }
    if (a1 < x2 - 1 && a2 > x1 + 1) { take('py', b1 - y2); take('ny', y1 - b2); }
  }
  return { box: [x1, y1, x2, y2], ...best };
}
