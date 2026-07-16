// 1) Is there ANY collision above the throw spot / along the flight path?
// 2) If a horizontal ceiling existed at height H, where would the lineup's
//    full jumpthrow come to rest? Sweep H to see if a plausible skybox
//    height reproduces the user's measured CS2 distance (~1500u).
import * as THREE from 'three';
import { buildHarness } from './harness.mjs';
import { CS2 } from '../physicsConfig.js';

const { grenades } = await buildHarness();
const map = grenades.mapLoader;

const gx = -463.968750, gy = 775.296326, gz = -7.968750;
const pitch = -46.506508, yaw = -94.999893;

const up = new THREE.Vector3(0, 1, 0);
for (const [label, x, z] of [['spot', gy, gx], ['500u out', gy - 43, gx - 498], ['1000u out', gy - 87, gx - 996]]) {
    const hit = map.raycastNade(new THREE.Vector3(x, gz, z), up, 5000);
    console.log(`ceiling above ${label}: ${hit ? `z=${(hit.distance + gz).toFixed(0)} (dist ${hit.distance.toFixed(0)})` : 'NEMA NISTA'}`);
}

const r = CS2.jumpthrowReleaseTime;
const eye = new THREE.Vector3(gy, gz + CS2.jumpImpulse * r - 0.5 * CS2.gravity * r * r, gx);
const vel = new THREE.Vector3(0, CS2.jumpImpulse - CS2.gravity * r, 0);
const yr = THREE.MathUtils.degToRad(yaw);
const fwdH = new THREE.Vector3(Math.sin(yr), 0, Math.cos(yr));
const start2D = new THREE.Vector2(gy, gx);

console.log('\nsa vjestackim plafonom na visini H (game z):');
for (const H of [300, 400, 500, 600, 700, 800, 900, 10000]) {
    const pos = new THREE.Vector3(), v = new THREE.Vector3();
    grenades.computeThrow(eye.clone(), fwdH, pitch, 1.0, vel, pos, v);
    const nade = { position: pos, velocity: v, rolling: false, age: 0 };
    let apex = -Infinity;
    while (true) {
        // artificial ceiling: split-restitution bounce off a downward normal
        if (pos.y > H && nade.velocity.y > 0) {
            pos.y = H;
            nade.velocity.y = -nade.velocity.y * 0.45;
            nade.velocity.x *= 0.45;
            nade.velocity.z *= 0.45;
        }
        apex = Math.max(apex, pos.y);
        if (!grenades.stepProjectile(nade, CS2.TICK, false)) break;
    }
    const d = new THREE.Vector2(pos.x, pos.z).distanceTo(start2D);
    console.log(`  H=${H === 10000 ? 'bez' : H}: rest game(${pos.z.toFixed(0)}, ${pos.x.toFixed(0)}, ${pos.y.toFixed(0)})  horiz ${d.toFixed(0)}u  apex z=${apex.toFixed(0)}`);
}
