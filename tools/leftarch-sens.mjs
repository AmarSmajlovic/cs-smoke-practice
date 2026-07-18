// How sensitive is the Left Arch lineup to aim drift? Sweep pitch/yaw around
// the reference angles with the exact bind release.
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

const feet = new THREE.Vector3(524.029297, -16.634758 - CS2.eyeStand, -731.505981);
const target = new THREE.Vector3(360, 128, -1203);
const rT = CS2.jumpthrowReleaseTime;

function run(pitch, yawDeg) {
    const gYaw = yawDeg * Math.PI / 180;
    const oYaw = Math.atan2(-Math.sin(gYaw), -Math.cos(gYaw));
    const fwdH = new THREE.Vector3(-Math.sin(oYaw), 0, -Math.cos(oYaw));
    const eye = new THREE.Vector3(feet.x, feet.y + CS2.eyeCrouch + CS2.jumpImpulse * rT - 0.5 * CS2.gravity * rT * rT, feet.z);
    const vel = new THREE.Vector3(0, CS2.jumpImpulse - CS2.gravity * rT, 0);
    const pos = new THREE.Vector3(), v = new THREE.Vector3();
    grenades.computeThrow(eye.clone(), fwdH, pitch, 1.0, vel, pos, v);
    const nade = { position: pos, velocity: v, rolling: false, age: 0 };
    let t = 0;
    while (grenades.stepProjectile(nade, CS2.TICK, false) && t < 768) t++;
    return { rest: pos.clone(), err: pos.distanceTo(target) };
}

console.log('pitch sweep (yaw ref):');
for (const dp of [-3, -2, -1, -0.5, 0, 0.5, 1, 2, 3]) {
    const r = run(-34.362362 + dp, 140.792618);
    console.log(`  pitch ${(-34.36 + dp).toFixed(1).padStart(6)}  rest (${r.rest.z.toFixed(0)}, ${r.rest.x.toFixed(0)}, ${r.rest.y.toFixed(0)})  err ${r.err.toFixed(0)}u`);
}
console.log('yaw sweep (pitch ref):');
for (const dy of [-2, -1, 0, 1, 2]) {
    const r = run(-34.362362, 140.792618 + dy);
    console.log(`  yaw ${(140.79 + dy).toFixed(1)}  rest (${r.rest.z.toFixed(0)}, ${r.rest.x.toFixed(0)}, ${r.rest.y.toFixed(0)})  err ${r.err.toFixed(0)}u`);
}
