// The apartment shell, read off the floor plan. Plan millimetres: x east, y south, origin = inside top-left corner
// of the living room. three.js: x = x, z = y, height = y, in metres.
import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { H, M } from './shapes.js';

const m = v => v / 1000;

export const ROOMS = [
  { id: 'liv', name: 'Living & dining', label: ['Living room', '27 m² · 4.27 × 6.15 m', 2250, 1250], rects: [[0, 0, 4270, 6150]] },
  { id: 'bed', name: 'Bedroom & office', label: ['Bedroom', '13 m² · 3.00 × 4.95 m', 6250, 4950], rects: [[4370, 1200, 6220, 6150], [6220, 2350, 7370, 6150]] },
  { id: 'hall', name: 'Hall', label: ['Hall', '6 m²', 8445, -1350], rects: [[4270, 0, 7900, 1100], [7900, -2065, 8990, 1100]] },
  { id: 'bath', name: 'Bathroom', label: ['Bathroom', '5 m² · 1.37 × 3.78 m', 8000, 5300], rects: [[7470, 2350, 8990, 6150]] },
  { id: 'wc', name: 'Toilet', label: ['Toilet', '1 m²', 6800, -380], rects: [[6320, -1210, 7290, -100]] },
  { id: 'store', name: 'Storage / wash', label: ['Storage / wash', '1 m²', 6870, 2050], rects: [[6320, 1200, 7370, 2250]] },
  { id: 'tech', name: 'Technical area', label: ['Technical', '1 m²', 8230, 1470], rects: [[7470, 1200, 8990, 1750]] },
  { id: 'balc', name: 'Balcony', label: ['Balcony', '16 m² · 2.47 × 6.56 m', -1330, 2500], rects: [[-2570, -160, -100, 6400]] },
];
export const KITCHEN_LABEL = ['Kitchen', 'comes with the flat', 3970, 4300];

// Door swings: hinge, radius, start and end angle (degrees, 0 = east, 90 = south).
export const DOORS = [
  { name: 'bedroom', hx: 6220, hy: 1200, r: 900, a0: 180, a1: 90 },
  { name: 'toilet', hx: 6400, hy: 0, r: 800, a0: 0, a1: 90 },
  { name: 'storage', hx: 7270, hy: 1100, r: 850, a0: 180, a1: 270 },
  { name: 'technical area', hx: 7570, hy: 1100, r: 660, a0: 0, a1: -90 },
  { name: 'technical area', hx: 8890, hy: 1100, r: 660, a0: 180, a1: 270 },
  { name: 'meter cabinet', hx: 7900, hy: -1580, r: 600, a0: 0, a1: 90 },
  { name: 'meter cabinet', hx: 7900, hy: -365, r: 600, a0: 0, a1: -90 },
  { name: 'front', hx: 8950, hy: -2065, r: 1000, a0: 180, a1: 90 },
  { name: 'balcony', hx: 0, hy: 60, r: 1000, a0: 90, a1: 0 },
];
export const BOUNDS = [-2550, -2050, 8980, 6380];   // walkable area for walk mode

function canvasTex(draw) {
  const c = document.createElement('canvas'); c.width = c.height = 512;
  draw(c.getContext('2d'), 512);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4;
  return t;
}

export function buildApartment(scene) {
  const group = new THREE.Group(); scene.add(group);
  const cutables = [];   // { mesh, z1, z2, wall }: shrink to 1 m when walls are low; walls lie flat when they're off
  const walls = [];      // plan rects that furniture and walkers can't pass

  const wallMat = M('#f3f2ef'), poche = M('#2a2d33');       // section-cut colour, like the black walls on the drawing
  const wallMats = [wallMat, wallMat, poche, wallMat, wallMat, wallMat];
  const glassMat = new THREE.MeshStandardMaterial({ color: 0xa9c7d8, transparent: true, opacity: 0.28, roughness: 0.05, metalness: 0.1, depthWrite: false });
  const frameMat = M('#3b3f45'), fixture = M('#ffffff', { roughness: 0.35 }), grey = M('#b9bdc2'), steel = M('#c9cdd1', { metalness: 0.6, roughness: 0.3 });

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

  function floor(x1, y1, x2, y2, tex, rep, z = 0) {
    const t = tex.clone(); t.needsUpdate = true; t.repeat.set(m(x2 - x1) / rep, m(y2 - y1) / rep);
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(m(x2 - x1), m(y2 - y1)), new THREE.MeshStandardMaterial({ map: t, roughness: 0.85 }));
    mesh.rotation.x = -Math.PI / 2; mesh.position.set(m((x1 + x2) / 2), m(z), m((y1 + y2) / 2)); mesh.receiveShadow = true;
    mesh.userData.floor = true;
    group.add(mesh);
  }
  const wood = canvasTex(x => {
    const tones = ['#caa77a', '#c49f71', '#cfae83', '#c7a375', '#d2b289'];
    for (let r = 0; r < 8; r++) {
      const off = (r * 173) % 256;
      for (let i = -1; i < 3; i++) {
        x.fillStyle = tones[(r * 3 + i + 5) % tones.length]; x.fillRect(off + i * 256, r * 64, 256, 64);
        x.strokeStyle = 'rgba(80,55,30,0.28)'; x.lineWidth = 2; x.strokeRect(off + i * 256 + 1, r * 64 + 1, 256, 64);
      }
    }
  });
  const deck = canvasTex((x, s) => {
    for (let i = 0; i < 8; i++) { x.fillStyle = i % 2 ? '#9a8a76' : '#a39380'; x.fillRect(i * 64, 0, 64, s); x.fillStyle = 'rgba(40,30,20,0.35)'; x.fillRect(i * 64, 0, 3, s); }
  });
  const tile = canvasTex((x, s) => {
    x.fillStyle = '#e3e6e8'; x.fillRect(0, 0, s, s); x.strokeStyle = '#c4c9cd'; x.lineWidth = 3;
    for (let i = 0; i <= 4; i++) { x.beginPath(); x.moveTo(i * 128, 0); x.lineTo(i * 128, s); x.moveTo(0, i * 128); x.lineTo(s, i * 128); x.stroke(); }
  });
  floor(-100, -2165, 9290, 6350, wood, 1.44);
  floor(7470, 2350, 8990, 6150, tile, 1.2, 2);
  floor(6320, -1210, 7290, -100, tile, 1.2, 2);
  floor(-2570, -160, -100, 6400, deck, 1.12, -40);

  // exterior and party walls
  wall(-100, -300, 6220, 0); wall(6220, -2165, 6320, -300); wall(6220, -2165, 7950, -2065);
  header(7950, -2165, 8950, -2065, 2300); wall(8950, -2165, 8990, -2065); wall(8990, -2165, 9290, 6350);

  // glass facade to the balcony: door, sliding door, fixed glazing
  for (const y of [0, 1080, 2300, 3520, 4990, 6090]) post(-100, y, 0, y + 60);
  glass(-70, 60, -30, 1080, 0, 2400); glass(-70, 1140, -30, 3520, 0, 2400); glass(-70, 3580, -30, 6090, 0, 2400, true);
  wall(-100, 0, 0, 6150, 2400, H);

  // south facade with 30 cm sills (assumed), columns
  const windowRun = (x1, x2, sill = 300, head = 2400) => {
    wall(x1, 6150, x2, 6350, 0, sill); glass(x1, 6230, x2, 6270, sill, head); wall(x1, 6150, x2, 6350, head, H);
    post(x1, 6200, x1 + 50, 6300, sill, head); post(x2 - 50, 6200, x2, 6300, sill, head);
  };
  wall(-100, 6150, 0, 6350); windowRun(0, 826); wall(826, 6150, 1418, 6350); windowRun(1418, 2568); windowRun(2568, 3770);
  wall(3770, 6150, 4370, 6350); windowRun(4370, 5630); windowRun(5630, 6950); wall(6950, 6150, 7470, 6350); windowRun(7470, 8990, 1400);
  wall(826, 5750, 1418, 6150); wall(3770, 5750, 4370, 6150); wall(6950, 5750, 7370, 6150);

  // north block: toilet, shafts, meter cabinet
  wall(6320, -2065, 7290, -1310); wall(6320, -1310, 7290, -1210); wall(7290, -2065, 7390, 0);
  wall(6320, -100, 6400, 0); header(6400, -100, 7200, 0); wall(7200, -100, 7290, 0);
  wall(7390, -2065, 7800, -1960); wall(7390, -100, 7800, 0);
  wall(7800, -2065, 7900, -1580); header(7800, -1580, 7900, -365); wall(7800, -365, 7900, 0);

  // corridor south side: bedroom, storage/wash, technical area, bathroom
  wall(3670, 1100, 5300, 1200); header(5300, 1100, 6220, 1200);
  wall(6220, 1100, 6320, 2350);
  wall(6320, 1100, 6420, 1200); header(6420, 1100, 7270, 1200); wall(7270, 1100, 7370, 1200);
  wall(6320, 2250, 7370, 2350);
  wall(7370, 1100, 7470, 3550); header(7370, 3550, 7470, 4450); wall(7370, 4450, 7470, 6150);
  wall(7470, 1100, 7570, 1200); header(7570, 1100, 8890, 1200); wall(8890, 1100, 8990, 1200);
  wall(7470, 1750, 8990, 2350); wall(4270, 1200, 4370, 6150); wall(3670, 2120, 4270, 2200); wall(8630, 2350, 8990, 3300);
  slab(7330, 3530, 7366, 4470, 0, 2150, M('#e9e4da')); slab(7340, 3500, 7368, 5400, 2160, 2200, frameMat);   // bathroom sliding door

  // kitchen (comes with the flat)
  const front = M('#e2e0da');
  slab(3670, 2200, 4270, 2800, 0, 2200, front, { solid: true });
  slab(3670, 2800, 4270, 5750, 0, 870, front, { solid: true });
  slab(3650, 2800, 4270, 5750, 870, 910, M('#45484e'), { cut: false });
  slab(3720, 3480, 4220, 3840, 910, 915, M('#111214', { roughness: 0.2 }), { cut: false });
  for (const [x, y] of [[3870, 3570], [4090, 3570], [3870, 3760], [4090, 3760]]) {
    const ring = new THREE.Mesh(new THREE.RingGeometry(m(55), m(75), 24), M('#5a5d63'));
    ring.rotation.x = -Math.PI / 2; ring.position.set(m(x), m(916), m(y)); group.add(ring);
  }
  slab(3740, 4700, 4200, 5100, 905, 912, steel, { cut: false }); slab(4180, 4880, 4220, 4920, 912, 1180, steel, { cut: false });
  slab(3770, 3460, 4270, 3860, 1650, 1800, M('#cfd2d6', { metalness: 0.4 })); slab(4060, 3560, 4270, 3760, 1800, H, M('#cfd2d6', { metalness: 0.4 }));

  // bathroom, toilet, washer + dryer (appliances not included)
  slab(7470, 2350, 8490, 3450, 0, 40, M('#d4d8db'), { cut: false }); glass(7470, 3430, 8290, 3450, 40, 2000);
  slab(8540, 3700, 8990, 4300, 820, 860, fixture); slab(8540, 4700, 8990, 5300, 820, 860, fixture);
  for (const y of [3750, 4750]) slab(8970, y, 8988, y + 500, 1100, 1900, M('#c9d6df', { metalness: 0.5, roughness: 0.15 }));
  slab(6620, -1210, 6990, -600, 0, 420, fixture, { cut: false }); slab(6620, -1210, 6990, -1050, 420, 900, fixture); slab(7110, -760, 7290, -460, 780, 860, fixture);
  slab(6420, 1300, 7020, 1900, 0, 850, grey, { cut: false }); slab(6420, 1300, 7020, 1900, 860, 1710, grey);

  // balcony: planter, glass railing
  slab(-2570, -160, -100, 400, -40, 560, M('#6b6f74'), { cut: false, solid: true });
  for (let i = 0; i < 9; i++) {
    const s = new THREE.Mesh(new THREE.SphereGeometry(m(170 + (i % 3) * 40), 12, 10), M(i % 2 ? '#5f8a55' : '#76a065'));
    s.position.set(m(-2400 + i * 270), m(640 + (i % 2) * 60), m(120 + (i % 3) * 50)); s.castShadow = true; group.add(s);
  }
  slab(-2610, -160, -2570, 6440, -40, 1100, glassMat, { solid: true, shadow: false, isWall: true });
  slab(-2610, 6400, -100, 6440, -40, 1100, glassMat, { solid: true, shadow: false, isWall: true });
  slab(-2620, -160, -2560, 6450, 1060, 1110, frameMat, { cut: false }); slab(-2620, 6390, -100, 6450, 1060, 1110, frameMat, { cut: false });

  // door swings drawn on the floor, like the arcs on the drawing
  const lineMat = new THREE.LineBasicMaterial({ color: 0x3b3f45 });
  for (const { hx, hy, r, a0, a1 } of DOORS) {
    const pts = [new THREE.Vector3(m(hx), 0.004, m(hy))];
    for (let i = 0; i <= 24; i++) { const a = (a0 + (a1 - a0) * i / 24) * Math.PI / 180; pts.push(new THREE.Vector3(m(hx + r * Math.cos(a)), 0.004, m(hy + r * Math.sin(a)))); }
    pts.push(pts[0].clone());
    group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), lineMat));
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
  return { group, walls, labels, setWalls };
}
