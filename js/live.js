// ?live: keep the Unreal level in step with the planner, through tools/unreal/live_bridge.py on this computer.
import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const BRIDGE = 'http://127.0.0.1:8766';
const baked = new WeakMap();   // piece group -> Promise<{ key, glb, light }>; a new group means a new shape

// One mesh per piece (one material slot per material), in the piece's own frame: Unreal places and turns it.
async function bake(group, foot) {
  group.updateMatrixWorld(true);
  const inv = group.matrixWorld.clone().invert(), byMat = new Map();
  (function walk(o) {
    if (o === foot) return;
    if (o.isMesh) {
      const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
      for (const n of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(n)) g.deleteAttribute(n);
      if (!g.attributes.normal) g.computeVertexNormals();
      if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
      g.clearGroups(); g.morphAttributes = {};
      g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld));
      if (!byMat.has(o.material)) byMat.set(o.material, []);
      byMat.get(o.material).push(g);
    }
    o.children.forEach(walk);
  })(group);
  if (!byMat.size) return null;                 // nothing to show (an accessory)
  const parts = [...byMat.values()].map(gs => mergeGeometries(gs));
  const mesh = new THREE.Mesh(mergeGeometries(parts, true), [...byMat.keys()]);
  mesh.name = group.name;
  const bulb = [...byMat.keys()].findIndex(mt => mt.name === 'light');   // shapes.js names glowing lamp parts 'light'
  const light = bulb < 0 ? null : (parts[bulb].computeBoundingBox(), parts[bulb].boundingBox.getCenter(new THREE.Vector3()).toArray());
  const glb = await new GLTFExporter().parseAsync(mesh, { binary: true });
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', glb));
  return { key: [...hash.slice(0, 8)].map(b => b.toString(16).padStart(2, '0')).join(''), glb, light };
}

/** pieces() lists { it, group, foot } for every piece on the plan; call the returned function after every change. */
export function startLive(pieces, toolbar) {
  const pill = document.createElement('span');
  pill.className = 'live'; pill.setAttribute('role', 'status');
  toolbar.append(pill);
  let v = 0, sent = 0, last = '', problem = '', online = null, timer = 0, running = false, again = false;
  const OFF = 'Start Casa Live on this computer; if Chrome asks, allow this site to reach other apps on this device.';
  const show = (state, text, title = '') => {
    if (pill.textContent === text && pill.title === title) return;   // a status region re-announces any rewrite
    pill.dataset.state = state; pill.textContent = text; pill.title = title;
  };
  const offline = () => { online = false; show('off', 'Unreal: not connected', OFF); };
  const post = (path, body) => fetch(BRIDGE + path, { method: 'POST', body });

  // force: send even if the pieces haven't changed (the bridge restarted)
  async function push(force) {
    if (running) { again = true; return; }
    running = true;
    try {
      const all = (await Promise.all(pieces().map(async ({ it, group, foot }) => {
        if (!baked.has(group)) baked.set(group, bake(group, foot).catch(e => { console.warn(`Casa Live: ${group.name} not sent`, e); return null; }));
        const shape = await baked.get(group);
        return shape && { uid: it.uid, name: group.name, x: it.x, y: it.y, rot: it.rot || 0, ...shape };
      }))).filter(Boolean);
      const items = JSON.stringify(all.map(({ glb, ...item }) => item));
      if (items === last && !force) return;      // a budget or name change: nothing for Unreal
      v = Math.max(v + 1, Date.now());           // the newest change wins, across reloads and tabs
      const body = `{"v":${v},"items":${items}}`;
      let r = await post('/layout', body);
      if (r.status === 409) {                    // shapes Unreal hasn't seen yet
        for (const key of (await r.json()).missing) await post('/mesh/' + key, all.find(p => p.key === key).glb);
        r = await post('/layout', body);
      }
      problem = r.ok ? '' : `Casa Live refused the plan (${r.status})`;
      if (r.ok) { sent = v; last = items; }
      poll();
    } catch { offline(); }
    finally { running = false; if (again) { again = false; push(); } }
  }

  async function poll() {
    try {
      const s = await (await fetch(BRIDGE + '/status')).json();
      if (online === false || s.got < sent) push(true);   // the bridge (re)started: send it the current plan
      online = true;
      if (!s.unreal) show('off', 'Unreal: not open', 'Open Unreal Engine with the flat');
      else if (s.done < sent) show('busy', 'Unreal: updating…');
      else if (problem || s.error) show('error', 'Unreal: not updated', problem || s.error);
      else show('ok', 'Unreal: up to date', s.note);
    } catch { offline(); }
  }
  setInterval(poll, 2000);
  show('busy', 'Unreal: connecting…');
  return () => { clearTimeout(timer); timer = setTimeout(push, 400); };
}
