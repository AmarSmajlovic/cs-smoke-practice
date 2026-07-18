// Sweep the G (peak) release moment along the jump arc at the Left Arch spot.
// Which release vy reproduces the csnades video (wall bounce -> falls through
// the arches to the ground, ~7s air)? Usage: node tools/leftarch-sweep.mjs
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

const feet = new THREE.Vector3(524.029297, -16.634758 - CS2.eyeStand, -731.505981);
const gPitch = -34.362362;
const gYaw = 140.792618 * Math.PI / 180;
const oYaw = Math.atan2(-Math.sin(gYaw), -Math.cos(gYaw));
const fwdH = new THREE.Vector3(-Math.sin(oYaw), 0, -Math.cos(oYaw));
const apex = feet.y + CS2.eyeCrouch + CS2.jumpImpulse ** 2 / (2 * CS2.gravity);

console.log('releaseVy | 1st-hit (group@height) | rest game (x,y,z) | air');
for (const vy of [100, 50, 20, 14.5, 0, -25, -50, -75, -100, -150, -200]) {
    const eye = new THREE.Vector3(feet.x, apex - vy * vy / (2 * CS2.gravity), feet.z);
    const vel = new THREE.Vector3(0, vy, 0);
    const pos = new THREE.Vector3(), v = new THREE.Vector3();
    grenades.computeThrow(eye.clone(), fwdH, gPitch, 1.0, vel, pos, v);
    const nade = { position: pos, velocity: v, rolling: false, age: 0 };
    const dir = new THREE.Vector3();
    let first = null, ticks = 0;
    for (let i = 0; i < 64 * 12; i++) {
        dir.copy(v).normalize();
        const hit = mapLoader.raycastNade(pos, dir, v.length() * CS2.TICK + CS2.nadeRadius);
        if (hit && !first) first = `${groupOf(hit.faceIndex).replace('physics_group_', '')}@z${hit.point.y.toFixed(0)}`;
        if (!grenades.stepProjectile(nade, CS2.TICK, false)) break;
        ticks++;
    }
    console.log(`${String(vy).padStart(7)}   | ${String(first).padEnd(22)} | (${pos.z.toFixed(0)}, ${pos.x.toFixed(0)}, ${pos.y.toFixed(0)})  | ${(ticks / 64).toFixed(1)}s`);
}

// STANDING G comparison (eye = eyeStand, not crouched)
console.log('\nSTANDING (bez CTRL):');
const apexS = feet.y + CS2.eyeStand + CS2.jumpImpulse ** 2 / (2 * CS2.gravity);
for (const vy of [20, 14.5, 0, -50]) {
    const eye = new THREE.Vector3(feet.x, apexS - vy * vy / (2 * CS2.gravity), feet.z);
    const vel = new THREE.Vector3(0, vy, 0);
    const pos = new THREE.Vector3(), v = new THREE.Vector3();
    grenades.computeThrow(eye.clone(), fwdH, gPitch, 1.0, vel, pos, v);
    const nade = { position: pos, velocity: v, rolling: false, age: 0 };
    const dir = new THREE.Vector3();
    let first = null, ticks = 0;
    for (let i = 0; i < 64 * 12; i++) {
        dir.copy(v).normalize();
        const hit = mapLoader.raycastNade(pos, dir, v.length() * CS2.TICK + CS2.nadeRadius);
        if (hit && !first) first = `${groupOf(hit.faceIndex).replace('physics_group_', '')}@z${hit.point.y.toFixed(0)}`;
        if (!grenades.stepProjectile(nade, CS2.TICK, false)) break;
        ticks++;
    }
    console.log(`${String(vy).padStart(7)}   | ${String(first).padEnd(22)} | (${pos.z.toFixed(0)}, ${pos.x.toFixed(0)}, ${pos.y.toFixed(0)})  | ${(ticks / 64).toFixed(1)}s`);
}
