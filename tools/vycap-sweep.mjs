// Sweep nadeBounceVyCap: does a small raise let the Left Arch bounce clear
// the plaster roof and reach the short target, and what does it do to the
// demo gate? Usage: node tools/vycap-sweep.mjs
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
const gYaw = 140.792618 * Math.PI / 180;
const oYaw = Math.atan2(-Math.sin(gYaw), -Math.cos(gYaw));
const fwdH = new THREE.Vector3(-Math.sin(oYaw), 0, -Math.cos(oYaw));
const target = new THREE.Vector3(344, 128, -1226);
const rT = CS2.jumpthrowReleaseTime;
const vzRel = CS2.jumpImpulse - CS2.gravity * rT;

console.log('cap | crouched-BIND rest (err)          | crouched jump+click vy=0 rest (err)');
for (const cap of [200, 210, 220, 225, 230, 240, 260]) {
    CS2.nadeBounceVyCap = cap;
    const run = (eyeYext, vy) => {
        const eye = new THREE.Vector3(feet.x, feet.y + eyeYext, feet.z);
        const vel = new THREE.Vector3(0, vy, 0);
        const pos = new THREE.Vector3(), v = new THREE.Vector3();
        grenades.computeThrow(eye.clone(), fwdH, -34.362362, 1.0, vel, pos, v);
        const nade = { position: pos, velocity: v, rolling: false, age: 0 };
        let t = 0;
        while (grenades.stepProjectile(nade, CS2.TICK, false) && t < 64 * 12) t++;
        return { rest: pos.clone(), err: pos.distanceTo(target), air: t / 64 };
    };
    const bind = run(CS2.eyeCrouch + CS2.jumpImpulse * rT - 0.5 * CS2.gravity * rT * rT, vzRel);
    const apex = CS2.eyeCrouch + CS2.jumpImpulse ** 2 / (2 * CS2.gravity);
    const peak = run(apex, 0);
    console.log(`${String(cap).padStart(3)} | (${bind.rest.z.toFixed(0)}, ${bind.rest.x.toFixed(0)}, ${bind.rest.y.toFixed(0)}) err ${bind.err.toFixed(0).padStart(4)}u air ${bind.air.toFixed(1)}s | (${peak.rest.z.toFixed(0)}, ${peak.rest.x.toFixed(0)}, ${peak.rest.y.toFixed(0)}) err ${peak.err.toFixed(0).padStart(4)}u air ${peak.air.toFixed(1)}s`);
}
CS2.nadeBounceVyCap = 200;
