// With cap 230: which release vy clears the roof entirely and carries on
// toward short? (early release = higher vy at release)
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

console.log('relVy (≈release t) | krov-dodir? | rest game | air');
for (const vy of [216, 230, 245, 260, 275, 290, 300]) {
    const tRel = (CS2.jumpImpulse - vy) / CS2.gravity;
    const eye = new THREE.Vector3(feet.x, feet.y + CS2.eyeCrouch + CS2.jumpImpulse * tRel - 0.5 * CS2.gravity * tRel * tRel, feet.z);
    const vel = new THREE.Vector3(0, vy, 0);
    const pos = new THREE.Vector3(), v = new THREE.Vector3();
    grenades.computeThrow(eye.clone(), fwdH, -34.362362, 1.0, vel, pos, v);
    const nade = { position: pos, velocity: v, rolling: false, age: 0 };
    let t = 0, roofTouch = false, prevY = v.y;
    while (grenades.stepProjectile(nade, CS2.TICK, false) && t < 768) {
        t++;
        if (pos.y > 200 && pos.y < 260 && prevY < 0 && v.y > 0) roofTouch = true;
        prevY = v.y;
    }
    console.log(`vy=${String(vy).padStart(3)} (t=${tRel.toFixed(3)}s) | ${roofTouch ? 'DA ' : 'NE '} | (${pos.z.toFixed(0)}, ${pos.x.toFixed(0)}, ${pos.y.toFixed(0)}) | ${(t/64).toFixed(1)}s`);
}
