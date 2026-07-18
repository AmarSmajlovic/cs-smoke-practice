// Phantom-collision census: real demo grenade trajectories vs our nade
// collider. A segment that crosses collider faces with NO bounce in the demo
// is a phantom (that geometry shouldn't block nades). A real bounce at the
// same group supports its solidity. Verdict per named group.
// Usage: node tools/phantom-census.mjs
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

const groupOf = (faceIndex) => {
    const gs = mapLoader.nadeGroups;
    let g = gs[0];
    for (const cand of gs) { if (cand.faceStart <= faceIndex) g = cand; else break; }
    return g.name;
};

const DATA = join(ROOT, 'tools/demo-data');
const trajs = [];
for (const f of readdirSync(DATA).filter((f) => f.endsWith('.traj.json')))
    trajs.push(...JSON.parse(readFileSync(join(DATA, f), 'utf8')));
console.log(`trajectories: ${trajs.length}`);

const dirV = new THREE.Vector3();
const phantoms = new Map(), bounces = new Map(), examples = new Map();
for (const t of trajs) {
    const s = t.samples;
    for (let i = 1; i < s.length - 2; i++) {
        const a = toApp(s[i].x, s[i].y, s[i].z);
        const b = toApp(s[i + 1].x, s[i + 1].y, s[i + 1].z);
        const seg = b.clone().sub(a);
        const len = seg.length();
        if (len < 1 || len > 60) continue; // teleports/slow rolls out
        dirV.copy(seg).divideScalar(len);
        // start pushed 1u in so we don't re-hit the face we sit on
        const hit = mapLoader.raycastNade(a.clone().addScaledVector(dirV, 1), dirV, len - 2);
        if (!hit) continue;
        // did the DEMO bounce here? velocity dir before vs after the crossing
        const vin = a.clone().sub(toApp(s[i - 1].x, s[i - 1].y, s[i - 1].z)).normalize();
        const vout = toApp(s[i + 2].x, s[i + 2].y, s[i + 2].z).sub(b).normalize();
        const ang = THREE.MathUtils.radToDeg(vin.angleTo(vout));
        const g = groupOf(hit.faceIndex);
        if (ang > 25) {
            bounces.set(g, (bounces.get(g) || 0) + 1);
        } else {
            phantoms.set(g, (phantoms.get(g) || 0) + 1);
            if (!examples.has(g)) examples.set(g, []);
            const ex = examples.get(g);
            if (ex.length < 3) ex.push(`x=${hit.point.z.toFixed(0)} y=${hit.point.x.toFixed(0)} z=${hit.point.y.toFixed(0)}`);
        }
    }
}

console.log('\ngroup                                phantom  bounce   verdict');
const names = new Set([...phantoms.keys(), ...bounces.keys()]);
for (const g of [...names].sort((x, y) => (phantoms.get(y) || 0) - (phantoms.get(x) || 0))) {
    const ph = phantoms.get(g) || 0, bo = bounces.get(g) || 0;
    const verdict = ph >= 3 && ph > bo * 2 ? 'NOT nade-solid?' : ph > 0 && bo > 0 ? 'mixed' : bo > 0 ? 'solid' : '?';
    console.log(`${g.padEnd(38)} ${String(ph).padStart(5)} ${String(bo).padStart(7)}   ${verdict}`);
    if (ph > 0) for (const e of examples.get(g) || []) console.log(`    e.g. ${e}`);
}
