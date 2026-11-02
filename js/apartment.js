// The apartment shell, read off the floor plan. Plan millimetres: x east, y south, origin = inside top-left corner
// of the living room. three.js: x = x, z = y, height = y, in metres.
import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { H, M } from './shapes.js';

const m = v => v / 1000;

export const ROOMS = [
  { id: 'liv', name: 'Living & dining', label: ['Living room', '27 m² · 4.27 × 6.15 m', 2250, 1250], rects: [[0, 0, 4270, 6150]] },
  { id: 'bed', name: 'Bedroom & office', label: ['Bedroom', '13 m² · 3.00 × 4.95 m', 6250, 4950], rects: [[4370, 1200, 6210, 6150], [6210, 2350, 7370, 6150]] },
  { id: 'hall', name: 'Hall', label: ['Hall', '6 m²', 8405, -1000], rects: [[4270, 0, 7860, 1100], [7860, -1880, 8950, 1100]] },
  { id: 'bath', name: 'Bathroom', label: ['Bathroom', '5 m² · 1.37 × 3.78 m', 8150, 5300], rects: [[7470, 2350, 8835, 6150]] },
  { id: 'wc', name: 'Toilet', label: ['Toilet', '1 m²', 6645, -700], rects: [[6160, -1306, 7130, -100]] },
  { id: 'store', name: 'Storage / wash', label: ['Storage / wash', '1 m²', 6815, 2050], rects: [[6320, 1200, 7310, 2250]] },
  { id: 'tech', name: 'Technical area', label: ['Technical', '1 m²', 8185, 1470], rects: [[7420, 1200, 8950, 1750]] },
  { id: 'balc', name: 'Balcony', label: ['Balcony', '16 m² · 2.47 × 6.56 m', -1455, 2500], rects: [[-2700, -140, -210, 6420]] },
];
export const KITCHEN_LABEL = ['Kitchen', 'comes with the flat', 3970, 4300];

// Door swings: hinge, radius, start and end angle (degrees, 0 = east, 90 = south).
export const DOORS = [
  { name: 'bedroom', hx: 6210, hy: 1200, r: 950, a0: 180, a1: 90 },
  { name: 'toilet', hx: 6210, hy: 0, r: 850, a0: 0, a1: 90 },
  { name: 'storage', hx: 7250, hy: 1100, r: 850, a0: 180, a1: 270 },
  { name: 'technical area', hx: 7690, hy: 1100, r: 500, a0: 0, a1: -90 },
  { name: 'technical area', hx: 8690, hy: 1100, r: 500, a0: 180, a1: 270 },
  { name: 'meter cabinet', hx: 7860, hy: -1580, r: 600, a0: 0, a1: 90 },
  { name: 'meter cabinet', hx: 7860, hy: -365, r: 600, a0: 0, a1: -90 },
  { name: 'front', hx: 8940, hy: -1880, r: 1000, a0: 180, a1: 90 },
  { name: 'balcony', hx: 0, hy: 60, r: 1000, a0: 90, a1: 0 },
];
export const BOUNDS = [-2680, -1865, 8940, 6400];   // walkable area for walk mode

function canvasTex(draw) {
  const c = document.createElement('canvas'); c.width = c.height = 512;
  draw(c.getContext('2d'), 512);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4;
  return t;
}

export function buildApartment(scene) {
  const group = new THREE.Group(); group.name = 'Apartment'; scene.add(group);
  const cutables = [];   // { mesh, z1, z2, wall }: shrink to 1 m when walls are low; walls lie flat when they're off
  const walls = [];      // plan rects that furniture and walkers can't pass

  // Own (uncached) materials with names for the .glb export, so renaming them can't touch furniture sharing a colour.
  const named = (name, color, o = {}) => new THREE.MeshStandardMaterial({ name, color, roughness: 0.6, ...o });
  const wallMat = named('wall', '#f3f2ef'), poche = named('wall-top', '#2a2d33');   // section-cut colour, like the black walls on the drawing
  const wallMats = [wallMat, wallMat, poche, wallMat, wallMat, wallMat];
  const glassMat = new THREE.MeshStandardMaterial({ name: 'glass', color: 0xa9c7d8, transparent: true, opacity: 0.28, roughness: 0.05, metalness: 0.1, depthWrite: false });
  const frameMat = named('frame', '#4a4039'), fixture = named('ceramic', '#ffffff', { roughness: 0.35 }), grey = named('appliance', '#b9bdc2');
  const steel = named('steel', '#c9cdd1', { metalness: 0.6, roughness: 0.3 });

  function slab(x1, y1, x2, y2, z1, z2, mat, { cut = true, solid = false, shadow = true, isWall = false } = {}) {
    const h = m(z2 - z1), geo = new THREE.BoxGeometry(m(x2 - x1), h, m(y2 - y1));
    geo.translate(0, h / 2, 0);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(m((x1 + x2) / 2), m(z1), m((y1 + y2) / 2));
    mesh.castShadow = shadow; mesh.receiveShadow = true;
    group.add(mesh);
    if (cut) cutables.push({ mesh, z1, z2, wall: isWall });
    if (solid) walls.push([x1, y1, x2, y2]);
    return mesh;
  }
  const wall = (x1, y1, x2, y2, z1 = 0, z2 = H) => slab(x1, y1, x2, y2, z1, z2, wallMats, { solid: z1 < 1500, isWall: true });
  const header = (x1, y1, x2, y2, z1 = 2150) => wall(x1, y1, x2, y2, z1, H);
  const glass = (x1, y1, x2, y2, z1, z2, solid = false) => slab(x1, y1, x2, y2, z1, z2, glassMat, { solid, shadow: false, isWall: true });
  const post = (x1, y1, x2, y2, z1 = 0, z2 = H) => slab(x1, y1, x2, y2, z1, z2, frameMat, { isWall: true });

  function floor(x1, y1, x2, y2, tex, rep, z, name) {
    const t = tex.clone(); t.needsUpdate = true; t.repeat.set(m(x2 - x1) / rep, m(y2 - y1) / rep);
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(m(x2 - x1), m(y2 - y1)), new THREE.MeshStandardMaterial({ name, map: t, roughness: 0.85 }));
    mesh.rotation.x = -Math.PI / 2; mesh.position.set(m((x1 + x2) / 2), m(z), m((y1 + y2) / 2)); mesh.receiveShadow = true;
    mesh.userData.floor = true;
    group.add(mesh);
  }
  const wood = canvasTex(x => {
    const tones = ['#a8703f', '#9f6838', '#b07843', '#a46c3b', '#b47d48'];   // warm oak, as in the videos
    for (let r = 0; r < 8; r++) {
      const off = (r * 173) % 256;
      for (let i = -1; i < 3; i++) {
        x.fillStyle = tones[(r * 3 + i + 5) % tones.length]; x.fillRect(off + i * 256, r * 64, 256, 64);
        x.strokeStyle = 'rgba(60,35,15,0.3)'; x.lineWidth = 2; x.strokeRect(off + i * 256 + 1, r * 64 + 1, 256, 64);
      }
    }
  });
  const deck = canvasTex((x, s) => {
    // light grey composite boards
    for (let i = 0; i < 8; i++) { x.fillStyle = i % 2 ? '#aaa69e' : '#b4b0a8'; x.fillRect(i * 64, 0, 64, s); x.fillStyle = 'rgba(40,40,40,0.35)'; x.fillRect(i * 64, 0, 3, s); }
  });
  const tile = canvasTex((x, s) => {
    // grey-beige 60 x 30 cm tiles (the texture repeats every 1.2 m)
    x.fillStyle = '#cbbfae'; x.fillRect(0, 0, s, s); x.strokeStyle = '#b3a693'; x.lineWidth = 3;
    for (let i = 0; i <= 4; i++) { x.beginPath(); x.moveTo(0, i * 128); x.lineTo(s, i * 128); x.stroke(); }
    for (let i = 0; i <= 2; i++) { x.beginPath(); x.moveTo(i * 256, 0); x.lineTo(i * 256, s); x.stroke(); }
  });
  floor(-210, -2090, 9450, 6490, wood, 1.44, 0, 'floor-wood');
  floor(7470, 2350, 8835, 6150, tile, 1.2, 2, 'floor-tile');
  floor(6160, -1306, 7130, -100, tile, 1.2, 2, 'floor-tile');
  floor(-2700, -140, -210, 6420, deck, 1.12, -40, 'deck');

  // exterior and party walls (positions measured on the architect's drawing, to about 1 cm)
  wall(-210, -300, 6160, 0); wall(5940, -1880, 6160, -300); wall(5940, -2090, 7900, -1880);
  header(7900, -2090, 8950, -1880, 2300); wall(8950, -2090, 9450, 6490);

  // glass facade to the balcony: door, sliding door, fixed glazing
  for (const y of [0, 1080, 2300, 3520, 5110, 6090]) post(-210, y, 0, y + 60);
  glass(-150, 60, -110, 1080, 0, 2400); glass(-150, 1140, -110, 3520, 0, 2400); glass(-150, 3580, -110, 6090, 0, 2400, true);
  wall(-210, 0, 0, 6150, 2400, H);

  // south facade with 30 cm sills (assumed), columns
  const windowRun = (x1, x2, sill = 300, head = 2400) => {
    wall(x1, 6150, x2, 6490, 0, sill); glass(x1, 6420, x2, 6460, sill, head); wall(x1, 6150, x2, 6490, head, H);
    post(x1, 6250, x1 + 60, 6490, sill, head); post(x2 - 60, 6250, x2, 6490, sill, head);
  };
  // the glass runs past the columns, between the drawing's mullions
  wall(-210, 6150, 0, 6490); windowRun(0, 700); windowRun(700, 2460); windowRun(2460, 4355); windowRun(4355, 5550); windowRun(5550, 7440);
  windowRun(7440, 8950, 1400);
  wall(690, 5830, 1280, 6150); wall(3770, 5830, 4370, 6150); wall(6870, 5830, 7370, 6150);

  // north block: shafts, toilet, meter cabinet
  wall(6160, -1880, 7130, -1306); wall(7130, -1880, 7260, 0);
  wall(6160, -100, 6210, 0); header(6210, -100, 7070, 0); wall(7070, -100, 7130, 0);
  wall(7260, -294, 7860, 0);
  wall(7790, -1880, 7860, -1580); header(7790, -1580, 7860, -365); wall(7790, -365, 7860, -294);

  // corridor south side: bedroom, storage/wash, technical area, bathroom
  wall(3670, 1100, 5150, 1200); header(5150, 1100, 6210, 1200);
  wall(6210, 1100, 6320, 2350);
  wall(6320, 1100, 6400, 1200); header(6400, 1100, 7250, 1200); wall(7250, 1100, 7310, 1200);
  wall(6320, 2250, 7420, 2350); wall(7310, 1100, 7420, 2350);
  wall(7370, 2350, 7470, 3600); header(7370, 3600, 7470, 4645); wall(7370, 4645, 7470, 6200);
  wall(7420, 1100, 7690, 1200); header(7690, 1100, 8690, 1200); wall(8690, 1100, 8950, 1200);
  wall(7420, 1750, 8950, 2350); wall(4270, 1200, 4370, 6250); wall(3670, 2120, 4270, 2200);
  wall(8490, 2350, 8950, 3470); wall(8835, 3470, 8950, 6150);   // shaft, bathroom lining
  slab(7330, 3580, 7366, 4665, 0, 2150, M('#e9e4da')); slab(7340, 3550, 7368, 5750, 2160, 2200, frameMat);   // bathroom sliding door

  // kitchen (comes with the flat)
  const front = named('kitchen-front', '#ecebe8');
  slab(3670, 2200, 4270, 2800, 0, 2200, front, { solid: true });
  slab(3670, 2800, 4270, 5750, 0, 870, front, { solid: true });
  slab(3650, 2800, 4270, 5750, 870, 910, M('#45484e'), { cut: false });
  slab(3720, 3480, 4220, 3840, 910, 915, M('#111214', { roughness: 0.2 }), { cut: false });
  for (const [x, y] of [[3870, 3570], [4090, 3570], [3870, 3760], [4090, 3760]]) {
    const ring = new THREE.Mesh(new THREE.RingGeometry(m(55), m(75), 24), M('#5a5d63'));
    ring.rotation.x = -Math.PI / 2; ring.position.set(m(x), m(916), m(y)); group.add(ring);
  }
  slab(3740, 4700, 4200, 5100, 905, 912, steel, { cut: false }); slab(4180, 4880, 4220, 4920, 912, 1180, steel, { cut: false });
  // dark grey splashback, upper cabinets and a slim hood under them over the hob
  slab(4250, 2800, 4270, 5750, 910, 1450, M('#3e4247'));
  slab(3920, 2800, 4270, 3460, 1450, 2200, front); slab(3920, 3460, 4270, 3860, 1520, 2200, front); slab(3920, 3860, 4270, 5750, 1450, 2200, front);
  slab(3920, 3460, 4270, 3860, 1450, 1520, M('#cfd2d6', { metalness: 0.4 }));

  // bathroom, toilet, washer + dryer (appliances not included)
  slab(7470, 2350, 8490, 3450, 0, 40, M('#d4d8db'), { cut: false }); glass(7470, 3430, 8290, 3450, 40, 2000);
  slab(8385, 3700, 8835, 4300, 820, 860, fixture); slab(8385, 4700, 8835, 5300, 820, 860, fixture);
  for (const y of [3750, 4750]) slab(8815, y, 8833, y + 500, 1100, 1900, named('mirror', '#c9d6df', { metalness: 0.5, roughness: 0.15 }));
  slab(6460, -1306, 6830, -700, 0, 420, fixture, { cut: false }); slab(6460, -1306, 6830, -1146, 420, 900, fixture); slab(6950, -600, 7130, -300, 780, 860, fixture);
  slab(6420, 1300, 7020, 1900, 0, 850, grey, { cut: false }); slab(6420, 1300, 7020, 1900, 860, 1710, grey);

  // balcony: planter, glass railing
  slab(-2700, -140, -210, 420, -40, 560, M('#6b6f74'), { cut: false, solid: true });
  for (let i = 0; i < 9; i++) {
    const s = new THREE.Mesh(new THREE.SphereGeometry(m(170 + (i % 3) * 40), 12, 10), M(i % 2 ? '#5f8a55' : '#76a065'));
    s.position.set(m(-2530 + i * 270), m(640 + (i % 2) * 60), m(120 + (i % 3) * 50)); s.castShadow = true; group.add(s);
  }
  slab(-2740, -140, -2700, 6460, -40, 1100, glassMat, { solid: true, shadow: false, isWall: true });
  slab(-2740, 6420, -210, 6460, -40, 1100, glassMat, { solid: true, shadow: false, isWall: true });
  slab(-2750, -140, -2690, 6470, 1060, 1110, frameMat, { cut: false }); slab(-2750, 6410, -210, 6470, 1060, 1110, frameMat, { cut: false });

  // door swings drawn on the floor, like the arcs on the drawing
  const lineMat = new THREE.LineBasicMaterial({ color: 0x3b3f45 });
  const swings = new THREE.Group(); swings.name = 'Door swings'; group.add(swings);   // plan drawing only, left out of the 3D export
  for (const { hx, hy, r, a0, a1 } of DOORS) {
    const pts = [new THREE.Vector3(m(hx), 0.004, m(hy))];
    for (let i = 0; i <= 24; i++) { const a = (a0 + (a1 - a0) * i / 24) * Math.PI / 180; pts.push(new THREE.Vector3(m(hx + r * Math.cos(a)), 0.004, m(hy + r * Math.sin(a)))); }
    pts.push(pts[0].clone());
    swings.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), lineMat));
  }

  const labels = [...ROOMS.map(r => r.label), KITCHEN_LABEL].map(([name, sub, x, y]) => {
    const el = document.createElement('div'); el.className = 'rl';
    el.innerHTML = `<b>${name}</b><span>${sub}</span>`;
    const o = new CSS2DObject(el); o.position.set(m(x), 0.05, m(y)); scene.add(o); return o;
  });

  /** 'full' walls, 'low' (cut at 1 m), or 'off' (walls drawn as a dark outline on the floor, fittings kept at 1 m). */
  function setWalls(mode) {
    for (const { mesh, z1, z2, wall } of cutables) {
      const top = mode === 'full' ? z2 : mode === 'off' && wall ? (z1 <= 0 ? Math.min(z2, 20) : z1) : Math.min(z2, 1000);
      mesh.visible = top > z1;
      mesh.scale.y = mesh.visible ? (top - z1) / (z2 - z1) : 1;
    }
  }
  return { group, walls, labels, swings, setWalls };
}
