// csnades "Left Arch from Back Alley": crouched jump+LMB, bounces off the
// wall, lands under the left arch. setpos -731.51 524.03 -16.63;
// setang -34.36 140.79. Expected rest ~ game (-1225, 347, 128)?
// Usage: node tools/leftarch-test.mjs
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
const gPitch = -34.362362;
const gYaw = 140.792618 * Math.PI / 180;
const oYaw = Math.atan2(-Math.sin(gYaw), -Math.cos(gYaw));
const fwdH = new THREE.Vector3(-Math.sin(oYaw), 0, -Math.cos(oYaw));
const rT = CS2.jumpthrowReleaseTime;
const vzRel = CS2.jumpImpulse - CS2.gravity * rT;
const target = new THREE.Vector3(347, 128, -1225); // from the user's aim readout

function jt(name, eyeH, strength) {
    const eye = feet.clone();
    eye.y += eyeH + CS2.jumpImpulse * rT - 0.5 * CS2.gravity * rT * rT;
    const vel = new THREE.Vector3(0, vzRel, 0); // standing-still jumpthrow
    const pos = new THREE.Vector3(), v = new THREE.Vector3();
    grenades.computeThrow(eye.clone(), fwdH, gPitch, strength, vel, pos, v);
    const nade = { position: pos, velocity: v, rolling: false, age: 0 };
    const hits = [];
    const dir = new THREE.Vector3();
    for (let i = 0; i < 64 * 12; i++) {
        dir.copy(v).normalize();
        const hit = mapLoader.raycastNade(pos, dir, v.length() * CS2.TICK + CS2.nadeRadius);
        if (hit && hits.length < 4) hits.push(`${groupOf(hit.faceIndex)}@(${hit.point.z.toFixed(0)},${hit.point.x.toFixed(0)},${hit.point.y.toFixed(0)})`);
        if (!grenades.stepProjectile(nade, CS2.TICK, false)) break;
    }
    const err = pos.distanceTo(target);
    console.log(`${name.padEnd(24)} s=${strength}  rest game (${pos.z.toFixed(0)}, ${pos.x.toFixed(0)}, ${pos.y.toFixed(0)})  err-vs-target ${err.toFixed(0)}u`);
    console.log(`   hits: ${hits.join(' -> ') || 'none'}`);
}

jt('crouched JT (eye 46.1)', CS2.eyeCrouch, 1.0);
jt('standing JT (eye 64.1)', CS2.eyeStand, 1.0);

// experiment: exclude physics_group_boulder from the nade collider and retry
{
    const playerGeos = [];
    const scene2 = new THREE.Scene();
    const ml2 = new MapLoader(scene2);
    // rebuild, dropping boulder meshes before the build
    physRoot.traverse((o) => { if (o.isMesh && /boulder/i.test(o.name)) o.userData.__skip = true; });
    const clone = physRoot;
    // simplest: temporarily rename boulder meshes so the nade router treats them like playerclip (excluded)
    const renamed = [];
    clone.traverse((o) => { if (o.isMesh && /boulder/i.test(o.name)) { renamed.push([o, o.name]); o.name = o.name + '_playerclip'; } });
    ml2.buildGameCollisionFromRoot(clone);
    for (const [o, n] of renamed) o.name = n;
    const gr2 = new GrenadeSystem(scene2, ml2);
    const eye = feet.clone();
    eye.y += CS2.eyeCrouch + CS2.jumpImpulse * rT - 0.5 * CS2.gravity * rT * rT;
    const vel = new THREE.Vector3(0, vzRel, 0);
    const pos = new THREE.Vector3(), v = new THREE.Vector3();
    gr2.computeThrow(eye.clone(), fwdH, gPitch, 1.0, vel, pos, v);
    const nade = { position: pos, velocity: v, rolling: false, age: 0 };
    let ticks = 0;
    while (gr2.stepProjectile(nade, CS2.TICK, false)) ticks++;
    console.log(`NO-BOULDER crouched JT:  rest game (${pos.z.toFixed(0)}, ${pos.x.toFixed(0)}, ${pos.y.toFixed(0)})  err-vs-target ${pos.distanceTo(target).toFixed(0)}u  air ${(ticks/64).toFixed(1)}s`);
}

// PEAK-release variant (csnades "Jump + Left Click" = human clicks at the top):
// vz ~ 0, eye raised by the full jump height
{
    const jumpPeak = CS2.jumpImpulse * CS2.jumpImpulse / (2 * CS2.gravity);
    const eye = feet.clone();
    eye.y += CS2.eyeCrouch + jumpPeak;
    const vel = new THREE.Vector3(0, 0, 0);
    const pos = new THREE.Vector3(), v = new THREE.Vector3();
    grenades.computeThrow(eye.clone(), fwdH, gPitch, 1.0, vel, pos, v);
    const nade = { position: pos, velocity: v, rolling: false, age: 0 };
    const dir = new THREE.Vector3();
    const hits = [];
    let ticks = 0;
    for (let i = 0; i < 64 * 12; i++) {
        dir.copy(v).normalize();
        const hit = mapLoader.raycastNade(pos, dir, v.length() * CS2.TICK + CS2.nadeRadius);
        if (hit && hits.length < 5) hits.push(`(${hit.point.z.toFixed(0)},${hit.point.x.toFixed(0)},${hit.point.y.toFixed(0)})`);
        if (!grenades.stepProjectile(nade, CS2.TICK, false)) break;
        ticks++;
    }
    console.log(`PEAK crouched JT: rest game (${pos.z.toFixed(0)}, ${pos.x.toFixed(0)}, ${pos.y.toFixed(0)})  err-vs-target ${pos.distanceTo(target).toFixed(0)}u  air ${(ticks/64).toFixed(1)}s`);
    console.log(`   hits: ${hits.join(' -> ')}`);
}
