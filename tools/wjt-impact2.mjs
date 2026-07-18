// Which named collision group does Escari's throw hit? Uses nadeGroups face
// ranges + raycast faceIndex. Usage: node tools/wjt-impact2.mjs
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

const groupOf = (faceIndex) => {
    const gs = mapLoader.nadeGroups;
    let g = gs[0];
    for (const cand of gs) { if (cand.faceStart <= faceIndex) g = cand; else break; }
    return g.name;
};

const eye = new THREE.Vector3(568.2, -165.0, 993.4);
const gYaw = -149.80 * Math.PI / 180;
const oYaw = Math.atan2(-Math.sin(gYaw), -Math.cos(gYaw));
const fwdH = new THREE.Vector3(-Math.sin(oYaw), 0, -Math.cos(oYaw));
const rT = CS2.jumpthrowReleaseTime;
const vel = fwdH.clone().multiplyScalar(245).setY(CS2.jumpImpulse - CS2.gravity * rT);
const pos = new THREE.Vector3(), v = new THREE.Vector3();
grenades.computeThrow(eye.clone(), fwdH, -42.53, 1.0, vel, pos, v);

const dir = new THREE.Vector3();
for (let i = 0; i < 400; i++) {
    dir.copy(v).normalize();
    const step = v.length() * CS2.TICK + CS2.nadeRadius;
    const hit = mapLoader.raycastNade(pos, dir, step);
    if (hit) {
        console.log(`HIT tick ${i} (t=${(i/64).toFixed(2)}s): group="${groupOf(hit.faceIndex)}"`);
        console.log(`  at game x=${hit.point.z.toFixed(0)} y=${hit.point.x.toFixed(0)} z=${hit.point.y.toFixed(0)}  normal game (${hit.face.normal.z.toFixed(2)}, ${hit.face.normal.x.toFixed(2)}, ${hit.face.normal.y.toFixed(2)})`);
        break;
    }
    if (!grenades.stepProjectile({ position: pos, velocity: v, rolling: false, age: i / 64 }, CS2.TICK, false)) break;
}
