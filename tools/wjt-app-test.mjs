// End-to-end W-jumpthrow as THE APP does it, headless: real Player + real
// GrenadeSystem at Escari's reported spot. Tracks player velocity every tick
// through the run-up and jump — a depenetration spike would show up here and
// would be inherited 1.25x into the nade.
// Usage: node tools/wjt-app-test.mjs
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
async function parseGlb(path) {
    const buf = readFileSync(path);
    const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    return new Promise((res, rej) => loader.parse(ab, '', (g) => res(g.scene), rej));
}

const scene = new THREE.Scene();
const mapLoader = new MapLoader(scene);
// the physics GLB carries both the player and the nade collision meshes
const physRoot = await parseGlb(join(ROOT, 'public/maps/mirage-collision.glb'));
mapLoader.buildGameCollisionFromRoot(physRoot);
console.log('collider ready:', !!mapLoader.collider, 'nade:', !!mapLoader.nadeCollider);

const grenades = new GrenadeSystem(scene, mapLoader);
const player = new Player();

// Escari: setpos 1135.89 651.52 -196.83; setang -42.53 -149.80
// mapping (main.js applySetposString): our x = game y, our z = game x,
// feet y = game z - eyeStand
const ox = 651.52, oz = 1135.89, oy = -196.83 - CS2.eyeStand;
const gPitch = -42.53, gYawDeg = -149.80;
const gYaw = gYawDeg * Math.PI / 180;
const oYaw = Math.atan2(-Math.sin(gYaw), -Math.cos(gYaw));

player.spawn(ox, oy, oz);
const fwdH = new THREE.Vector3(-Math.sin(oYaw), 0, -Math.cos(oYaw));
const right = new THREE.Vector3().crossVectors(fwdH, new THREE.Vector3(0, 1, 0)).negate();
// player.update(dt, input, fwd, right, collider, fwdFull, ladders)
const fwdFull = fwdH.clone();
const input = { forwardMove: 1, sideMove: 0, jump: false, duck: false, walk: false };

// settle on the ground first
for (let i = 0; i < 32; i++) player.update(CS2.TICK, { ...input, forwardMove: 0 }, fwdH, right, mapLoader.collider, fwdFull, mapLoader.ladderZones);
console.log(`settled: pos ${player.position.x.toFixed(1)} ${player.position.y.toFixed(1)} ${player.position.z.toFixed(1)} onGround=${player.onGround}`);

// run forward ~0.7s, then jump (W held) — the scripted bind path
const speeds = [];
let jumpTick = -1, jt = null, thrown = null;
for (let tick = 0; tick < 200; tick++) {
    const wantJump = tick >= 45 && jumpTick === -1 ? true : (jt ? true : false);
    input.jump = wantJump || !!jt;
    player.update(CS2.TICK, input, fwdH, right, mapLoader.collider, fwdFull, mapLoader.ladderZones);
    const h = Math.hypot(player.velocity.x, player.velocity.z);
    speeds.push({ tick, h, vy: player.velocity.y, onGround: player.onGround, y: player.position.y });
    if (tick >= 45 && jumpTick === -1) { jumpTick = tick; jt = { airTicks: 0, groundY: player.position.y }; continue; }
    if (jt && !thrown) {
        if (player.onGround) { jt.groundY = player.position.y; continue; }
        jt.airTicks++;
        if (jt.airTicks >= Math.round(CS2.jumpthrowReleaseTime * 64)) {
            // exact scriptedJumpthrow 'bind' reconstruction from main.js
            const rT = CS2.jumpthrowReleaseTime;
            const vel = player.velocity.clone().setY(CS2.jumpImpulse - CS2.gravity * rT);
            const eye = new THREE.Vector3();
            player.getEyePosition(eye);
            eye.y = jt.groundY + player.eyeHeight + CS2.jumpImpulse * rT - 0.5 * CS2.gravity * rT * rT;
            const sourcePitchDeg = gPitch; // camera pitch: game pitch value directly
            thrown = { eye, vel: vel.clone(), h: Math.hypot(vel.x, vel.z) };
            const pos = new THREE.Vector3(), v = new THREE.Vector3();
            grenades.computeThrow(eye.clone(), fwdH, sourcePitchDeg, 1.0, vel, pos, v);
            thrown.launch = v.clone();
            const nade = { position: pos, velocity: v, rolling: false, age: 0 };
            // trace: record velocity direction flips (bounces) with positions
            thrown.bounces = [];
            let prev = v.clone();
            while (grenades.stepProjectile(nade, CS2.TICK, false)) {
                if (prev.dot(v) < 0.7 * prev.length() * v.length() && thrown.bounces.length < 8) {
                    thrown.bounces.push({ p: pos.clone(), v: v.clone() });
                }
                prev.copy(v);
            }
            thrown.rest = pos.clone();
        }
    }
}

console.log('\nplayer hSpeed around the jump (tick: h, vy, ground):');
for (const s of speeds.filter((s) => s.tick >= jumpTick - 4 && s.tick <= jumpTick + 10))
    console.log(`  t${s.tick}  h=${s.h.toFixed(1)}  vy=${s.vy.toFixed(0)}  ${s.onGround ? 'GROUND' : 'air'}  y=${s.y.toFixed(1)}`);
const maxH = Math.max(...speeds.map((s) => s.h));
console.log(`\nmax hSpeed anywhere: ${maxH.toFixed(1)} (CS2 max with nade = 245)`);
if (thrown) {
    console.log(`release: hSpeed=${thrown.h.toFixed(1)} eye=(${thrown.eye.x.toFixed(1)}, ${thrown.eye.y.toFixed(1)}, ${thrown.eye.z.toFixed(1)})`);
    console.log(`launch |v|=${thrown.launch.length().toFixed(0)}`);
    const r = thrown.rest;
    console.log(`nade rest (app):  game coords x=${r.z.toFixed(0)} y=${r.x.toFixed(0)} z=${r.y.toFixed(0)}`);
    console.log('bounces (game coords):');
    for (const b of thrown.bounces)
        console.log(`  at x=${b.p.z.toFixed(0)} y=${b.p.x.toFixed(0)} z=${b.p.y.toFixed(0)}  -> v(${b.v.z.toFixed(0)}, ${b.v.x.toFixed(0)}, ${b.v.y.toFixed(0)})`);
}

// quick path dump for direction sanity
{
    const rT = CS2.jumpthrowReleaseTime;
    const eye = new THREE.Vector3(568.2, -165.0, 993.4);
    const vel = fwdH.clone().multiplyScalar(245).setY(CS2.jumpImpulse - CS2.gravity * rT);
    const pos = new THREE.Vector3(), v = new THREE.Vector3();
    grenades.computeThrow(eye.clone(), fwdH, gPitch, 1.0, vel, pos, v);
    console.log(`\nfwdH game dir: dx=${fwdH.z.toFixed(2)} dy=${fwdH.x.toFixed(2)}  launch game v: (${v.z.toFixed(0)}, ${v.x.toFixed(0)}, ${v.y.toFixed(0)})`);
    const nade = { position: pos, velocity: v, rolling: false, age: 0 };
    for (let i = 0; i < 40; i++) {
        if (!grenades.stepProjectile(nade, CS2.TICK, false)) break;
        if (i % 8 === 0) console.log(`  t+${(i / 64).toFixed(2)}s  game x=${pos.z.toFixed(0)} y=${pos.x.toFixed(0)} z=${pos.y.toFixed(0)}  |v|=${v.length().toFixed(0)}`);
    }
}
