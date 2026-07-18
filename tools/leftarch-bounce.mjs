// Instrument the wall bounce of the Left Arch throw: incoming v, hit normal,
// outgoing v — compared against the ideal flat-wall reflection.
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
const rT = CS2.jumpthrowReleaseTime;
const gYaw = 140.792618 * Math.PI / 180;
const oYaw = Math.atan2(-Math.sin(gYaw), -Math.cos(gYaw));
const fwdH = new THREE.Vector3(-Math.sin(oYaw), 0, -Math.cos(oYaw));
const eye = new THREE.Vector3(feet.x, feet.y + CS2.eyeCrouch + CS2.jumpImpulse * rT - 0.5 * CS2.gravity * rT * rT, feet.z);
const vel = new THREE.Vector3(0, CS2.jumpImpulse - CS2.gravity * rT, 0);
const pos = new THREE.Vector3(), v = new THREE.Vector3();
grenades.computeThrow(eye.clone(), fwdH, -34.362362, 1.0, vel, pos, v);
console.log(`launch game v: (${v.z.toFixed(0)}, ${v.x.toFixed(0)}, ${v.y.toFixed(0)})  |h|=${Math.hypot(v.x, v.z).toFixed(0)}`);

const nade = { position: pos, velocity: v, rolling: false, age: 0 };
const dirV = new THREE.Vector3();
for (let i = 0; i < 400; i++) {
    const vin = v.clone();
    dirV.copy(v).normalize();
    const hit = mapLoader.raycastNade(pos, dirV, v.length() * CS2.TICK + CS2.nadeRadius);
    if (!grenades.stepProjectile(nade, CS2.TICK, false)) break;
    if (hit && vin.dot(v) < 0.9 * vin.length() * v.length()) {
        const n = hit.face.normal;
        console.log(`BOUNCE t=${(i/64).toFixed(2)}s @ game(${hit.point.z.toFixed(0)}, ${hit.point.x.toFixed(0)}, ${hit.point.y.toFixed(0)})`);
        console.log(`  normal game (${n.z.toFixed(3)}, ${n.x.toFixed(3)}, ${n.y.toFixed(3)})`);
        console.log(`  v in  game (${vin.z.toFixed(0)}, ${vin.x.toFixed(0)}, ${vin.y.toFixed(0)})  h=${Math.hypot(vin.x, vin.z).toFixed(0)}`);
        console.log(`  v out game (${v.z.toFixed(0)}, ${v.x.toFixed(0)}, ${v.y.toFixed(0)})  h=${Math.hypot(v.x, v.z).toFixed(0)}`);
        // ideal flat -y wall (game): reflect y with 0.45, keep x tangential 0.45
        break;
    }
}
