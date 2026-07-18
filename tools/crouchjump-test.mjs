// Can the player jump while ducked, and what does the G (peak) release state
// look like crouched at the Left Arch spot? Usage: node tools/crouchjump-test.mjs
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
const ml = new MapLoader(scene);
ml.buildGameCollisionFromRoot(physRoot);

const player = new Player();
player.spawn(524.03, -16.63 - CS2.eyeStand, -731.51);
const fwd = new THREE.Vector3(0, 0, -1), right = new THREE.Vector3(1, 0, 0);
const base = { forwardMove: 0, sideMove: 0, jump: false, duck: true, walk: false };
for (let i = 0; i < 48; i++) player.update(CS2.TICK, base, fwd, right, ml.collider, fwd, ml.ladderZones);
console.log(`ducked settled: eyeH=${player.eyeHeight.toFixed(1)} onGround=${player.onGround}`);
let peakEye = -1e9, released = null, airTicks = 0;
for (let i = 0; i < 96; i++) {
    player.update(CS2.TICK, { ...base, jump: true }, fwd, right, ml.collider, fwd, ml.ladderZones);
    const eye = new THREE.Vector3();
    player.getEyePosition(eye);
    peakEye = Math.max(peakEye, eye.y);
    if (!player.onGround) airTicks++;
    if (!released && !player.onGround && player.velocity.y <= 20) {
        released = { tick: i, eyeY: eye.y, vy: player.velocity.y, eyeH: player.eyeHeight };
    }
}
console.log(`airborne ticks: ${airTicks}  peak eye y: ${peakEye.toFixed(1)} (feet start ${(-16.63 - CS2.eyeStand).toFixed(1)})`);
console.log(released
    ? `G-release: tick ${released.tick}  eyeY=${released.eyeY.toFixed(1)}  vy=${released.vy.toFixed(1)}  eyeH=${released.eyeH.toFixed(1)}`
    : 'G-release NIKAD (uslov vy<=20 u zraku nije postignut!)');
