// The APP's real F path at the Left Arch spot: settle the (crouched) player
// on OUR floor, real jump ticks, analytic release exactly like main.js
// tickScriptedJumpthrow. Where does the nade land?
import * as THREE from 'three';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { MapLoader } from '../mapLoader.js';
import { GrenadeSystem } from '../grenades.js';
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
const grenades = new GrenadeSystem(scene, mapLoader);
const target = new THREE.Vector3(350, 128, -1209);

const gYaw = 140.792618 * Math.PI / 180;
const oYaw = Math.atan2(-Math.sin(gYaw), -Math.cos(gYaw));
const fwdH = new THREE.Vector3(-Math.sin(oYaw), 0, -Math.cos(oYaw));
const right = new THREE.Vector3().crossVectors(fwdH, new THREE.Vector3(0, 1, 0)).negate();

for (const duck of [true, false]) {
    const player = new Player();
    player.spawn(524.029297, -16.634758 - CS2.eyeStand, -731.505981);
    const input = { forwardMove: 0, sideMove: 0, jump: false, duck, walk: false };
    for (let i = 0; i < 64; i++) player.update(CS2.TICK, input, fwdH, right, mapLoader.collider, fwdH, mapLoader.ladderZones);
    const settledFeet = player.position.y;
    // F pressed: jump + bind release (main.js logic verbatim)
    let jt = { airTicks: 0, sawJump: false, groundY: player.position.y };
    let released = null;
    for (let i = 0; i < 120 && !released; i++) {
        player.update(CS2.TICK, { ...input, jump: true }, fwdH, right, mapLoader.collider, fwdH, mapLoader.ladderZones);
        if (player.onGround) { jt.groundY = player.position.y; continue; }
        if (!jt.sawJump) { if (player.velocity.y > 100) jt.sawJump = true; else continue; }
        jt.airTicks++;
        if (jt.airTicks >= Math.round(CS2.jumpthrowReleaseTime * 64)) {
            const rT = CS2.jumpthrowReleaseTime;
            const vel = player.velocity.clone().setY(CS2.jumpImpulse - CS2.gravity * rT);
            const eye = new THREE.Vector3();
            player.getEyePosition(eye);
            eye.y = jt.groundY + player.eyeHeight + CS2.jumpImpulse * rT - 0.5 * CS2.gravity * rT * rT;
            released = { eye, vel, eyeH: player.eyeHeight };
        }
    }
    const pos = new THREE.Vector3(), v = new THREE.Vector3();
    grenades.computeThrow(released.eye.clone(), fwdH, -34.362362, 1.0, released.vel, pos, v);
    const nade = { position: pos, velocity: v, rolling: false, age: 0 };
    let t = 0;
    while (grenades.stepProjectile(nade, CS2.TICK, false) && t < 768) t++;
    console.log(`duck=${duck}  settledFeet=${settledFeet.toFixed(1)} (setpos kaze -80.7)  eyeH=${released.eyeH.toFixed(1)}  releaseEyeY=${released.eye.y.toFixed(1)}  hVel=${Math.hypot(released.vel.x, released.vel.z).toFixed(1)}`);
    console.log(`   rest game (${pos.z.toFixed(0)}, ${pos.x.toFixed(0)}, ${pos.y.toFixed(0)})  err ${pos.distanceTo(target).toFixed(0)}u  air ${(t/64).toFixed(1)}s`);
}
