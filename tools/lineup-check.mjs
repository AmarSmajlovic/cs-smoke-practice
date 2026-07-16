// Simulate one user lineup through the shipped physics, as the scripted
// jumpthrow (F key) does it: eye advanced 0.1225s along the jump arc, player
// velocity at the release moment, all three strengths.
import * as THREE from 'three';
import { buildHarness } from './harness.mjs';
import { CS2 } from '../physicsConfig.js';

const { grenades } = await buildHarness();

// setpos -463.968750 775.296326 -7.968750; setang -46.506508 -94.999893
const gx = -463.968750, gy = 775.296326, gz = -7.968750; // game coords, eye
const pitch = -46.506508, yaw = -94.999893;
const target = new THREE.Vector3(-170, -675, -1628); // toApp(-1628,-170,-675)

const r = CS2.jumpthrowReleaseTime;
const eye = new THREE.Vector3(gy, gz, gx); // toApp
eye.y += CS2.jumpImpulse * r - 0.5 * CS2.gravity * r * r;
const vel = new THREE.Vector3(0, CS2.jumpImpulse - CS2.gravity * r, 0);
const yr = THREE.MathUtils.degToRad(yaw);
const fwdH = new THREE.Vector3(Math.sin(yr), 0, Math.cos(yr));

const start2D = new THREE.Vector2(gy, gx);
for (const s of [1.0, 0.5, 0.0]) {
    const pos = new THREE.Vector3(), v = new THREE.Vector3();
    grenades.computeThrow(eye.clone(), fwdH, pitch, s, vel, pos, v);
    const nade = { position: pos, velocity: v, rolling: false, age: 0 };
    let firstHit = null;
    let prevVy = v.y;
    while (grenades.stepProjectile(nade, CS2.TICK, false)) {
        if (!firstHit && nade.velocity.y > prevVy + 1 && nade.age > 0.2) firstHit = pos.clone();
        prevVy = nade.velocity.y;
    }
    const d = new THREE.Vector2(pos.x, pos.z).distanceTo(start2D);
    const dt = pos.distanceTo(target);
    console.log(`strength ${s}: rest app(${pos.x.toFixed(0)}, ${pos.y.toFixed(0)}, ${pos.z.toFixed(0)}) = game(${pos.z.toFixed(0)}, ${pos.x.toFixed(0)}, ${pos.y.toFixed(0)})  horiz ${d.toFixed(0)}u od spota, ${dt.toFixed(0)}u od targeta` + (firstHit ? `  prvi udar game(${firstHit.z.toFixed(0)}, ${firstHit.x.toFixed(0)}, ${firstHit.y.toFixed(0)})` : ''));
}
console.log('\ncilj: game(-1628, -170, -675), horiz 1500u od spota');
