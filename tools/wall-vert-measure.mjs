// Do WALL bounces in CS2 keep more VERTICAL (tangential) speed than floors?
// For every demo bounce: recover in/out velocity, raycast the collider for the
// surface normal, decompose, report tangential+normal retention split by
// surface orientation. Usage: node tools/wall-vert-measure.mjs
import * as THREE from 'three';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { MapLoader } from '../mapLoader.js';
import { toApp } from './harness.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const buf = readFileSync(join(ROOT, 'public/maps/mirage-collision.glb'));
const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
const physRoot = await new Promise((res, rej) => loader.parse(ab, '', (g) => res(g.scene), rej));
const scene = new THREE.Scene();
const mapLoader = new MapLoader(scene);
mapLoader.buildGameCollisionFromRoot(physRoot);

const TICK = 1 / 64, G = 800 * 0.4;
const DATA = join(ROOT, 'tools/demo-data');
const trajs = [];
for (const f of readdirSync(DATA).filter((f) => f.endsWith('.traj.json')))
    trajs.push(...JSON.parse(readFileSync(join(DATA, f), 'utf8')));

function velAt(s, idx, dir) {
    const pts = [];
    for (let k = 1; k <= 3; k++) {
        const j = idx + dir * k;
        if (j < 0 || j >= s.length) break;
        pts.push(s[j]);
    }
    if (pts.length < 2) return null;
    const a = pts[0], b = pts[pts.length - 1];
    const dt = (b.tick - a.tick) * TICK;
    // gravity-correct vertical back to the bounce instant (game z is up)
    const mid = (a.tick + b.tick) / 2;
    const v = { x: (b.x - a.x) / dt, y: (b.y - a.y) / dt, z: (b.z - a.z) / dt };
    v.z += G * (mid - s[idx].tick) * TICK * (dir === -1 ? -1 : 1) * -1;
    return v;
}
const med = (a) => { a.sort((x, y) => x - y); return a.length ? a[Math.floor(a.length / 2)] : NaN; };

const _dir = new THREE.Vector3();
const cats = { wall: { t: [], tv: [], n: [] }, floor: { t: [], tv: [], n: [] }, slope: { t: [], tv: [], n: [] } };
let used = 0;
for (const t of trajs) {
    const s = t.samples;
    const byTick = new Map(s.map((x, i) => [x.tick, i]));
    for (const bt of t.bounce_ticks) {
        const i = byTick.get(bt);
        if (i == null || i < 3 || i > s.length - 4) continue;
        const vb = velAt(s, i, -1), va = velAt(s, i, +1);
        if (!vb || !va) continue;
        const vin = toApp(vb.x, vb.y, vb.z);        // app coords: y up
        const vout = toApp(va.x, va.y, va.z);
        if (vin.length() < 100) continue;
        // surface normal: ray from just before the bounce along vin
        const p0 = toApp(s[i - 1].x, s[i - 1].y, s[i - 1].z);
        _dir.copy(vin).normalize();
        const hit = mapLoader.raycastNade(p0, _dir, 40);
        if (!hit) continue;
        const n = hit.face.normal.clone();
        if (n.dot(_dir) > 0) n.negate();
        const into = vin.dot(n);
        if (into > -60) continue; // grazing, unreliable
        const tIn = vin.clone().addScaledVector(n, -into);
        const nOut = vout.dot(n);
        const tOut = vout.clone().sub(n.clone().multiplyScalar(nOut));
        const cat = Math.abs(n.y) < 0.3 ? 'wall' : n.y > 0.7 ? 'floor' : 'slope';
        if (tIn.length() > 60) {
            cats[cat].t.push(tOut.length() / tIn.length());
            // vertical share of the tangential (walls: is the VERTICAL kept more?)
            if (cat === 'wall' && Math.abs(tIn.y) > 60) cats[cat].tv.push(tOut.y / tIn.y);
        }
        cats[cat].n.push(nOut / -into);
        used++;
    }
}
console.log(`bounces used: ${used}`);
for (const [k, v] of Object.entries(cats)) {
    console.log(`${k.padEnd(6)} n=${String(v.n.length).padStart(3)}  tangencijalno med ${med(v.t).toFixed(2)}  normalno med ${med(v.n).toFixed(2)}` +
        (v.tv.length ? `  VERTIKALNO-uz-zid med ${med(v.tv).toFixed(2)} (n=${v.tv.length})` : ''));
}
