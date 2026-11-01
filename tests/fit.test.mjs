// node tests/fit.test.mjs
import assert from 'node:assert/strict';
import { checkLayout, gaps, polysOverlap, corners, footprint, clearanceZones } from '../js/fit.js';

const room = { rects: [[0, 0, 4000, 3000]] };
const walls = [[-100, -100, 4100, 0], [-100, 3000, 4100, 3100], [-100, 0, 0, 3000], [4000, 0, 4100, 3000]];
const ctx = { walls, doors: [{ name: 'bedroom', hx: 4000, hy: 0, r: 800, a0: 180, a1: 90 }], rooms: [room] };
const item = (o) => ({ uid: o.name, placed: true, rot: 0, elev: 0, h: 800, ...o });

// rotation: a 2000x500 piece turned 90° is 500 wide in plan
const [x1, , x2] = corners(footprint(item({ name: 'a', x: 1000, y: 1000, w: 2000, d: 500, rot: 90 }))).reduce((b, [x]) => [Math.min(b[0], x), 0, Math.max(b[2], x)], [Infinity, 0, -Infinity]);
assert.ok(Math.abs(x2 - x1 - 500) < 1e-6);

// rotated squares overlap only when they really touch
const sq = (cx, a) => corners({ cx, cy: 0, hw: 500, hd: 500, a });
assert.equal(polysOverlap(sq(0, 0), sq(1000, 0)), false);              // edge to edge
assert.equal(polysOverlap(sq(0, Math.PI / 4), sq(1150, 0)), true);    // diamond tip reaches in
assert.equal(polysOverlap(sq(0, Math.PI / 4), sq(1250, 0)), false);

// a clean layout has no issues; a chair tucked under the table is fine
const ok = [
  item({ name: 'sofa', shape: 'sofa', x: 1200, y: 2550, w: 2000, d: 900, rot: 180 }),
  item({ name: 'table', shape: 'table', x: 1000, y: 800, w: 1200, d: 750 }),
  item({ name: 'chair', shape: 'chair', x: 1000, y: 1250, w: 450, d: 500, rot: 180 }),
  item({ name: 'rug', shape: 'rug', x: 3000, y: 0, w: 3000, d: 3000 }),   // decor is ignored, even outside
];
assert.deepEqual(checkLayout(ok, ctx), []);

// wall hit, overlap, blocked door, blocked clearance, outside
const bad = checkLayout([
  item({ name: 'wardrobe', shape: 'wardrobe', x: 3700, y: 1500, w: 1000, d: 600, rot: -90 }),   // front faces west, 600 free needed
  item({ name: 'box', shape: 'box', x: 2900, y: 1500, w: 400, d: 400 }),                         // sits in that zone
  item({ name: 'desk', shape: 'desk', x: 3800, y: 300, w: 1000, d: 600 }),                       // in the door swing and into the wall
  item({ name: 'bin', shape: 'box', x: 5000, y: 500, w: 300, d: 300 }),
  item({ name: 'stool', shape: 'box', x: 2900, y: 1500, w: 300, d: 300 }),
], ctx).map(i => `${i.level}:${i.text}`);
assert.ok(bad.includes('warn:wardrobe needs about 60 cm free in front; box is in the way'), bad.join('\n'));
assert.ok(bad.includes('error:desk runs into a wall'), bad.join('\n'));
assert.ok(bad.includes('warn:desk blocks the bedroom door'), bad.join('\n'));
assert.ok(bad.includes('error:bin is outside the apartment'), bad.join('\n'));
assert.ok(bad.includes('error:box overlaps stool'), bad.join('\n'));

// stacked pieces don't collide: a TV standing on a bench
const tv = checkLayout([
  item({ name: 'bench', shape: 'cabinet', x: 2000, y: 2700, w: 1800, d: 400, h: 380, rot: 180 }),
  item({ name: 'tv', shape: 'tv', x: 2000, y: 2700, w: 1200, d: 250, h: 720, elev: 380 }),
], ctx);
assert.deepEqual(tv, []);

// bed clearance zones: foot + both sides
assert.equal(clearanceZones(item({ shape: 'bed', x: 2000, y: 1500, w: 1600, d: 2000 })).length, 3);

// gaps to walls and neighbours
const g = gaps(item({ name: 'x', shape: 'box', x: 1000, y: 1500, w: 400, d: 400 }), [item({ name: 'y', shape: 'box', x: 2000, y: 1500, w: 400, d: 400 })], walls);
assert.deepEqual([g.nx, g.px, g.ny, g.py], [800, 600, 1300, 1300]);

// a sofa with a chaise longue is L-shaped: the empty corner in front of the seats is free
const chaise = item({ name: 'chaise', shape: 'sofa', x: 2000, y: 1500, w: 2800, d: 1600, sp: { kind: 'chaise', md: 950 } });
const pouf = item({ name: 'pouf', shape: 'pouf', x: 1300, y: 2100, w: 400, d: 400 });    // in front of the main seats, beside the chaise
assert.deepEqual(checkLayout([chaise, pouf], ctx).filter(i => i.level === 'error'), []);
assert.ok(checkLayout([chaise, { ...pouf, x: 3000 }], ctx).some(i => i.text === 'chaise overlaps pouf'));       // on the chaise itself
assert.ok(checkLayout([{ ...chaise, flip: -1 }, pouf], ctx).some(i => i.text === 'chaise overlaps pouf'));    // chaise flipped to that side

console.log('fit tests passed');
