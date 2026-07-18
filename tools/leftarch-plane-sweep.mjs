// Sweep the Left Arch wall clip-plane yaw: for each candidate normal, sim the
// reference throw, report first floor touch + rest vs the P-measured truth.
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

const TOUCH = new THREE.Vector2(-1213.87, 364.42); // game x,y
const REST = new THREE.Vector2(-1413.71, 162.98);

function run() {
    const feet = new THREE.Vector3(524.029297, -16.634758 - CS2.eyeStand, -731.505981);
    const rT = CS2.jumpthrowReleaseTime;
    const gYaw = 140.792618 * Math.PI / 180;
    const oYaw = Math.atan2(-Math.sin(gYaw), -Math.cos(gYaw));
    const fwdH = new THREE.Vector3(-Math.sin(oYaw), 0, -Math.cos(oYaw));
    const eye = new THREE.Vector3(feet.x, feet.y + CS2.eyeCrouch + CS2.jumpImpulse * rT - 0.5 * CS2.gravity * rT * rT, feet.z);
    const vel = new THREE.Vector3(0, CS2.jumpImpulse - CS2.gravity * rT, 0);
    const pos = new THREE.Vector3(), v = new THREE.Vector3();
    grenades.computeThrow(eye.clone(), fwdH, -34.362362, 1.0, vel, pos, v);
    const nade = { position: pos, velocity: v, rolling: false, age: 0 };
    let touch = null, prevVy = v.y, bounces = 0;
    for (let i = 0; i < 800; i++) {
        if (!grenades.stepProjectile(nade, CS2.TICK, false)) break;
        if (v.y > prevVy + 1 && nade.age > 0.5) {
            bounces++;
            if (!touch) touch = pos.clone();
        }
        prevVy = v.y;
    }
    return { touch, rest: pos.clone() };
}

for (let deg = 0; deg >= -3.01; deg -= 0.25) {
    const phi = deg * Math.PI / 180;
    const cp = CS2.nadeClipPlanes[0];
    cp.nx = -Math.cos(phi);
    cp.nz = Math.sin(phi);
    const { touch, rest } = run();
    const tG = touch ? new THREE.Vector2(touch.z, touch.x) : null;
    const rG = new THREE.Vector2(rest.z, rest.x);
    console.log(`phi ${deg.toFixed(2)}deg: touch game(${tG ? tG.x.toFixed(1) + ', ' + tG.y.toFixed(1) : '—'}) d=${tG ? tG.distanceTo(TOUCH).toFixed(1) : '—'}u   rest game(${rG.x.toFixed(1)}, ${rG.y.toFixed(1)}, ${rest.y.toFixed(0)}) d=${rG.distanceTo(REST).toFixed(1)}u`);
}
