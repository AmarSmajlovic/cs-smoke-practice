// Find the exact first impact of Escari's throw and name the collision
// meshes near it. Usage: node tools/wjt-impact.mjs
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

// release state from the app-level run
const eye = new THREE.Vector3(568.2, -165.0, 993.4);
const gYaw = -149.80 * Math.PI / 180;
const oYaw = Math.atan2(-Math.sin(gYaw), -Math.cos(gYaw));
const fwdH = new THREE.Vector3(-Math.sin(oYaw), 0, -Math.cos(oYaw));
const rT = CS2.jumpthrowReleaseTime;
const vel = fwdH.clone().multiplyScalar(245).setY(CS2.jumpImpulse - CS2.gravity * rT);
const pos = new THREE.Vector3(), v = new THREE.Vector3();
grenades.computeThrow(eye.clone(), fwdH, -42.53, 1.0, vel, pos, v);

// step until speed drops sharply -> impact just happened; report the raycast
let prevSpeed = v.length();
for (let i = 0; i < 200; i++) {
    const before = pos.clone();
    if (!grenades.stepProjectile({ position: pos, velocity: v, rolling: false, age: i / 64 }, CS2.TICK, false)) break;
    if (v.length() < prevSpeed * 0.8) {
        console.log(`impact ~tick ${i}: game x=${before.z.toFixed(0)} y=${before.x.toFixed(0)} z=${before.y.toFixed(0)}  speed ${prevSpeed.toFixed(0)} -> ${v.length().toFixed(0)}`);
        // named meshes near the impact
        const hitP = before;
        const near = [];
        physRoot.updateMatrixWorld(true);
        physRoot.traverse((o) => {
            if (!o.isMesh) return;
            const box = new THREE.Box3().setFromObject(o);
            const d = box.distanceToPoint(hitP);
            if (d < 60) near.push({ name: o.name || o.parent?.name || '?', d: d.toFixed(0), box: `${box.min.x.toFixed(0)},${box.min.y.toFixed(0)},${box.min.z.toFixed(0)} -> ${box.max.x.toFixed(0)},${box.max.y.toFixed(0)},${box.max.z.toFixed(0)}` });
        });
        near.sort((a, b) => a.d - b.d);
        for (const n of near.slice(0, 12)) console.log(`  d=${n.d}  ${n.name}  [app box ${n.box}]`);
        break;
    }
    prevSpeed = v.length();
}
