// Escari's connector lineup from side alley: standing JT vs walk-JT vs W-run-JT
// from the same view angles. Where does each land, and which hits the pergola?
// Usage: node tools/wjt-variants.mjs
import * as THREE from 'three';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { MapLoader } from '../mapLoader.js';
import { GrenadeSystem } from '../grenades.js';
import { CS2 } from '../physicsConfig.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const buf = readFileSync(join(ROOT, 'public/maps/mirage-collision.glb'));
const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
const physRoot = await new Promise((res, rej) => loader.parse(ab, '', (g) => res(g.scene), rej));
const scene = new THREE.Scene();
const mapLoader = new MapLoader(scene);
mapLoader.buildGameCollisionFromRoot(physRoot);
const grenades = new GrenadeSystem(scene, mapLoader);
const groupOf = (fi) => { let g = mapLoader.nadeGroups[0]; for (const c of mapLoader.nadeGroups) { if (c.faceStart <= fi) g = c; else break; } return g.name; };

const gYaw = -149.80 * Math.PI / 180;
const oYaw = Math.atan2(-Math.sin(gYaw), -Math.cos(gYaw));
const fwdH = new THREE.Vector3(-Math.sin(oYaw), 0, -Math.cos(oYaw));
const rT = CS2.jumpthrowReleaseTime;
const vzRel = CS2.jumpImpulse - CS2.gravity * rT;

// eye at the setpos spot itself (standing) — W variant moves forward hDist first
function runCase(name, hSpeed, runTime) {
    // player starts at setpos, runs hSpeed for runTime, then jumps + releases
    const startEye = new THREE.Vector3(651.52, -196.83, 1135.89);
    const eye = startEye.clone().addScaledVector(fwdH, hSpeed * (runTime + rT));
    eye.y += CS2.jumpImpulse * rT - 0.5 * CS2.gravity * rT * rT;
    const vel = fwdH.clone().multiplyScalar(hSpeed).setY(vzRel);
    const pos = new THREE.Vector3(), v = new THREE.Vector3();
    grenades.computeThrow(eye.clone(), fwdH, -42.53, 1.0, vel, pos, v);
    const nade = { position: pos, velocity: v, rolling: false, age: 0 };
    let firstHit = null, peak = -1e9;
    const dir = new THREE.Vector3();
    for (let i = 0; i < 64 * 12; i++) {
        peak = Math.max(peak, pos.y);
        dir.copy(v).normalize();
        const hit = mapLoader.raycastNade(pos, dir, v.length() * CS2.TICK + CS2.nadeRadius);
        if (hit && !firstHit) firstHit = { g: groupOf(hit.faceIndex), p: hit.point.clone(), t: i / 64 };
        if (!grenades.stepProjectile(nade, CS2.TICK, false)) break;
    }
    const range = Math.hypot(pos.z - 1135.89, pos.x - 651.52);
    console.log(`${name.padEnd(26)} rest game (${pos.z.toFixed(0)}, ${pos.x.toFixed(0)}, ${pos.y.toFixed(0)})  domet ${range.toFixed(0)}u  peak z ${peak.toFixed(0)}` +
        (firstHit ? `  1st-hit ${firstHit.g} @t=${firstHit.t.toFixed(2)}s game(${firstHit.p.z.toFixed(0)},${firstHit.p.x.toFixed(0)},${firstHit.p.y.toFixed(0)})` : '  no-hit?'));
}

runCase('standing JT (h=0)', 0, 0);
runCase('walk JT (h=127, shift)', 127.4, 0.4);
runCase('W-run JT (h=245)', 245, 0.7);
runCase('W-run kratko (h=245,0.2s)', 245, 0.2);
