// Does holding W INTO the side-alley corner keep the player pinned (CS2 box
// hull behaviour) or does our capsule slide them along the wall?
// Usage: node tools/corner-test.mjs
import * as THREE from 'three';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { MapLoader } from '../mapLoader.js';
import { Player } from '../player.js';
import { CS2 } from '../physicsConfig.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const buf = readFileSync(join(ROOT, 'public/maps/mirage-collision.glb'));
const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
const physRoot = await new Promise((res, rej) => loader.parse(ab, '', (g) => res(g.scene), rej));
const scene = new THREE.Scene();
const mapLoader = new MapLoader(scene);
mapLoader.buildGameCollisionFromRoot(physRoot);

const player = new Player();
const gYaw = -149.80 * Math.PI / 180;
const oYaw = Math.atan2(-Math.sin(gYaw), -Math.cos(gYaw));
const fwdH = new THREE.Vector3(-Math.sin(oYaw), 0, -Math.cos(oYaw));
const right = new THREE.Vector3().crossVectors(fwdH, new THREE.Vector3(0, 1, 0)).negate();
player.spawn(651.52, -196.83 - CS2.eyeStand, 1135.89);
const input = { forwardMove: 1, sideMove: 0, jump: false, duck: false, walk: false };
// settle
for (let i = 0; i < 16; i++) player.update(CS2.TICK, { ...input, forwardMove: 0 }, fwdH, right, mapLoader.collider, fwdH, mapLoader.ladderZones);
const start = player.position.clone();
console.log(`start game (${start.z.toFixed(1)}, ${start.x.toFixed(1)})`);
for (let i = 0; i < 96; i++) {
    player.update(CS2.TICK, input, fwdH, right, mapLoader.collider, fwdH, mapLoader.ladderZones);
    if (i % 16 === 15) {
        const d = player.position.clone().sub(start);
        console.log(`t=${((i + 1) / 64).toFixed(2)}s  hSpeed=${Math.hypot(player.velocity.x, player.velocity.z).toFixed(1)}  moved=${Math.hypot(d.x, d.z).toFixed(1)}u  pos game (${player.position.z.toFixed(1)}, ${player.position.x.toFixed(1)})`);
    }
}
