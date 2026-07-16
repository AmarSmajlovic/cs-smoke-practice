// Validate jumpthrows + the user's T-spawn lineup against the RAW VRF physics
// export (world_physics_physics.glb) — the packed collision has a crushed sky
// mesh, so this is the honest world. Conversion mirrors pack-collision.mjs:
// bake world matrix, unscale meters->HU, remap (wx,wy,wz) -> (-wz, wy, wx).
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { MapLoader } from '../mapLoader.js';
import { GrenadeSystem } from '../grenades.js';
import { throwFrom, toApp, STRENGTHS, pct } from './harness.mjs';
import { CS2 } from '../physicsConfig.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = join(ROOT, 'tools/demo-data');

const buf = readFileSync(join(ROOT, 'tools/export-phys/maps/de_mirage/world_physics_physics.glb'));
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
const raw = await new Promise((res, rej) => loader.parse(ab, '', (g) => res(g.scene), rej));
raw.updateMatrixWorld(true);

// convert in place to the app frame
raw.traverse((o) => {
    if (!o.isMesh) return;
    const wm = o.matrixWorld.elements;
    const s = Math.hypot(wm[0], wm[1], wm[2]) || 1;
    const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
    const p = g.attributes.position;
    const arr = new Float32Array(p.count * 3);
    const v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
        v.set(p.getX(i), p.getY(i), p.getZ(i)).applyMatrix4(o.matrixWorld);
        arr[i * 3] = v.x / s;
        arr[i * 3 + 1] = v.y / s;
        arr[i * 3 + 2] = v.z / s;
    }
    const ng = new THREE.BufferGeometry();
    ng.setAttribute('position', new THREE.BufferAttribute(arr, 3));
    o.geometry = ng;
    o.matrixWorld.identity();
    o.matrix.identity();
    o.position.set(0, 0, 0); o.scale.set(1, 1, 1); o.quaternion.identity();
});
raw.updateMatrixWorld(true);

const scene = new THREE.Scene();
const ml = new MapLoader(scene);
ml.buildGameCollisionFromRoot(raw);
const grenades = new GrenadeSystem(scene, ml);

const pairs = [];
for (const pf of readdirSync(DATA).filter((f) => f.endsWith('.pairs.json')))
    pairs.push(...JSON.parse(readFileSync(join(DATA, pf), 'utf8')));
const jumps = pairs.filter((p) => p.vz > 100 && p.vz < CS2.jumpImpulse);

const _pos = new THREE.Vector3(), _v = new THREE.Vector3();
function runTo(p, s) {
    const { eye, vel, fwdH, want } = throwFrom(p, 0);
    grenades.computeThrow(eye.clone(), fwdH, p.pitch, s, vel, _pos, _v);
    const nade = { position: _pos, velocity: _v, rolling: false, age: 0 };
    while (grenades.stepProjectile(nade, CS2.TICK, false)) { /* rest */ }
    return _pos.distanceTo(want);
}
const errs = jumps.map((p) => Math.min(...STRENGTHS.map((s) => runTo(p, s)))).sort((a, b) => a - b);
console.log(`${jumps.length} jumps vs RAW physics (sky solid): median ${pct(errs, 0.5).toFixed(0)}u  p90 ${pct(errs, 0.9).toFixed(0)}u  <=50u ${(100 * errs.filter((x) => x <= 50).length / errs.length).toFixed(0)}%`);

// user lineup
const r = CS2.jumpthrowReleaseTime;
const eye = new THREE.Vector3(775.296326, -7.968750 + CS2.jumpImpulse * r - 0.5 * CS2.gravity * r * r, -463.968750);
const vel = new THREE.Vector3(0, CS2.jumpImpulse - CS2.gravity * r, 0);
const yr = THREE.MathUtils.degToRad(-94.999893);
const fwdH = new THREE.Vector3(Math.sin(yr), 0, Math.cos(yr));
for (const s of [1.0, 0.5, 0.0]) {
    grenades.computeThrow(eye.clone(), fwdH, -46.506508, s, vel, _pos, _v);
    const nade = { position: _pos, velocity: _v, rolling: false, age: 0 };
    while (grenades.stepProjectile(nade, CS2.TICK, false)) { /* rest */ }
    const d = Math.hypot(_pos.x - 775.3, _pos.z + 464.0);
    console.log(`lineup strength ${s}: rest game(${_pos.z.toFixed(0)}, ${_pos.x.toFixed(0)}, ${_pos.y.toFixed(0)})  horiz ${d.toFixed(0)}u (CS2: ~1500u)`);
}
