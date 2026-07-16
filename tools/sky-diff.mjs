// Per-jump landing error with the sky mesh in vs out of the nade collider.
// For throws that flip good->bad, print where their path crosses the sky, to
// map exactly which sky faces are hurting (low edges vs high ceiling).
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { MapLoader } from '../mapLoader.js';
import { GrenadeSystem } from '../grenades.js';
import { throwFrom, STRENGTHS, pct } from './harness.mjs';
import { CS2 } from '../physicsConfig.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = join(ROOT, 'tools/demo-data');

async function parseGlb(path) {
    const buf = readFileSync(path);
    const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    return new Promise((res, rej) => loader.parse(ab, '', (g) => res(g.scene), rej));
}

function makeSystem(root, dropSky) {
    if (dropSky) {
        const del = [];
        root.traverse((o) => { if (/physics_sky/i.test(o.name)) del.push(o); });
        for (const o of del) o.removeFromParent();
    }
    const scene = new THREE.Scene();
    const ml = new MapLoader(scene);
    ml.buildGameCollisionFromRoot(root);
    return new GrenadeSystem(scene, ml);
}

const gOn = makeSystem(await parseGlb(join(ROOT, 'public/maps/mirage-collision.glb')), false);
const gOff = makeSystem(await parseGlb(join(ROOT, 'public/maps/mirage-collision.glb')), true);

// sky-only BVH for crossing localization
const skyGeos = [];
(await parseGlb(join(ROOT, 'public/maps/mirage-collision.glb'))).traverse((o) => {
    if (o.isMesh && /physics_sky/i.test(o.name)) {
        o.updateWorldMatrix(true, false);
        const g = (o.geometry.index ? o.geometry.toNonIndexed() : o.geometry).clone();
        g.applyMatrix4(o.matrixWorld);
        skyGeos.push(g);
    }
});
const sky = new THREE.Mesh(skyGeos[0], new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
sky.geometry.computeBoundsTree();
const ray = new THREE.Raycaster();

const pairs = [];
for (const pf of readdirSync(DATA).filter((f) => f.endsWith('.pairs.json')))
    pairs.push(...JSON.parse(readFileSync(join(DATA, pf), 'utf8')));
const jumps = pairs.filter((p) => p.vz > 100 && p.vz < CS2.jumpImpulse);

const _pos = new THREE.Vector3(), _v = new THREE.Vector3();
function run(grenades, p, s, path = null) {
    const { eye, vel, fwdH, want } = throwFrom(p, 0);
    grenades.computeThrow(eye.clone(), fwdH, p.pitch, s, vel, _pos, _v);
    const nade = { position: _pos, velocity: _v, rolling: false, age: 0 };
    if (path) path.push(_pos.clone());
    while (grenades.stepProjectile(nade, CS2.TICK, false)) if (path) path.push(_pos.clone());
    return _pos.distanceTo(want);
}
const bestErr = (g, p) => Math.min(...STRENGTHS.map((s) => run(g, p, s)));

const eOn = [], eOff = [];
let flipped = 0;
for (const p of jumps) {
    const on = bestErr(gOn, p), off = bestErr(gOff, p);
    eOn.push(on); eOff.push(off);
    if (off < 100 && on > 300 && flipped < 12) {
        flipped++;
        // localize: s=1 path in the sky-on world, find first sky crossing
        const path = [];
        run(gOn, p, 1.0, path);
        let cross = null;
        for (let i = 1; i < path.length && !cross; i++) {
            const a = path[i - 1], d = path[i].clone().sub(a), len = d.length();
            if (len < 1e-3) continue;
            ray.set(a, d.divideScalar(len)); ray.far = len + 2.5;
            const h = ray.intersectObject(sky)[0];
            if (h) cross = h.point;
        }
        console.log(`flip: off ${off.toFixed(0)}u -> on ${on.toFixed(0)}u  ` +
            (cross ? `sky contact game(${cross.z.toFixed(0)}, ${cross.x.toFixed(0)}, ${cross.y.toFixed(0)})` : 'no direct sky contact (indirect)'));
    }
}
const s = (a) => { const v = [...a].sort((x, y) => x - y); return `median ${pct(v, 0.5).toFixed(0)}u p90 ${pct(v, 0.9).toFixed(0)}u`; };
console.log(`\nsky OFF: ${s(eOff)}   sky ON: ${s(eOn)}   (${jumps.length} jumps)`);
