// Geometry probe for the Left Arch lineup: (1) can ANY release reach the
// target with our collider? (2) how tall is our wall at the bounce point?
// (3) what surface is the z=240 roof? Usage: node tools/leftarch-geom.mjs
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
const gYaw = 140.792618 * Math.PI / 180;
const oYaw = Math.atan2(-Math.sin(gYaw), -Math.cos(gYaw));
const fwdH = new THREE.Vector3(-Math.sin(oYaw), 0, -Math.cos(oYaw));
const target = new THREE.Vector3(344, 128, -1226);

// (1) full release sweep: vy -200..270 x eye crouch/stand
let best = null;
for (const eyeH of [CS2.eyeCrouch, CS2.eyeStand]) {
    const apex = feet.y + eyeH + CS2.jumpImpulse ** 2 / (2 * CS2.gravity);
    for (let vy = -200; vy <= 270; vy += 10) {
        const eyeY = vy > 0 ? apex - vy * vy / (2 * CS2.gravity) : apex - vy * vy / (2 * CS2.gravity);
        const eye = new THREE.Vector3(feet.x, Math.min(eyeY, apex), feet.z);
        const vel = new THREE.Vector3(0, vy, 0);
        const pos = new THREE.Vector3(), v = new THREE.Vector3();
        grenades.computeThrow(eye.clone(), fwdH, -34.362362, 1.0, vel, pos, v);
        const nade = { position: pos, velocity: v, rolling: false, age: 0 };
        while (grenades.stepProjectile(nade, CS2.TICK, false));
        const err = pos.distanceTo(target);
        if (!best || err < best.err) best = { err, vy, eyeH, rest: pos.clone() };
    }
}
console.log(`(1) najbolji rest: err ${best.err.toFixed(0)}u  vy=${best.vy} eyeH=${best.eyeH.toFixed(0)}  rest game (${best.rest.z.toFixed(0)}, ${best.rest.x.toFixed(0)}, ${best.rest.y.toFixed(0)})`);

// (2) wall top at the bounce point: horizontal rays toward the wall at rising heights
const wallXZ = new THREE.Vector3(631, 0, -863);
const probeFrom = new THREE.Vector3(590, 0, -810); // back toward the thrower
const toWall = new THREE.Vector3().subVectors(wallXZ, probeFrom).setY(0).normalize();
let top = null;
for (let z = 140; z <= 560; z += 10) {
    probeFrom.y = z;
    const hit = mapLoader.raycastNade(probeFrom, toWall, 120);
    if (!hit) { top = z; break; }
}
console.log(`(2) zid kod (-863,631): prvi PROLAZ na z=${top} (ispod toga solidan)`);

// (3) what is the roof at (-1054, 474, 240)?
const down = new THREE.Vector3(0, -1, 0);
const above = new THREE.Vector3(474, 400, -1054);
const rh = mapLoader.raycastNade(above, down, 500);
if (rh) console.log(`(3) krov: ${groupOf(rh.faceIndex)} @ z=${rh.point.y.toFixed(0)}, normal y=${rh.face.normal.y.toFixed(2)}`);
// and directly under it (if the roof were gone, where would it fall?)
const under = new THREE.Vector3(474, rh ? rh.point.y - 5 : 235, -1054);
const rh2 = mapLoader.raycastNade(under, down, 600);
if (rh2) console.log(`    ispod krova: ${groupOf(rh2.faceIndex)} @ z=${rh2.point.y.toFixed(0)}`);
