// One broken jumpthrow, full strength, full path dump: every bounce with the
// surface group it hit. Run with sky in the collider to see the bogus contact.
import * as THREE from 'three';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildHarness, toApp, throwFrom } from './harness.mjs';
import { CS2 } from '../physicsConfig.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = join(ROOT, 'tools/demo-data');
const { grenades } = await buildHarness();
const map = grenades.mapLoader;

const pairs = [];
for (const pf of readdirSync(DATA).filter((f) => f.endsWith('.pairs.json')))
    pairs.push(...JSON.parse(readFileSync(join(DATA, pf), 'utf8')));
const jumps = pairs.filter((p) => p.vz > 100 && p.vz < CS2.jumpImpulse);
const p = jumps[Number(process.argv[2] || 0)];

console.log(`throw from game(${p.px.toFixed(0)},${p.py.toFixed(0)},${p.pz.toFixed(0)}) pitch ${p.pitch.toFixed(1)} yaw ${p.yaw.toFixed(1)} -> want game(${p.dx.toFixed(0)},${p.dy.toFixed(0)},${p.dz.toFixed(0)})`);

const { eye, vel, fwdH, want } = throwFrom(p, 0);
const pos = new THREE.Vector3(), v = new THREE.Vector3();
grenades.computeThrow(eye.clone(), fwdH, p.pitch, 1.0, vel, pos, v);
console.log(`launch app pos(${pos.x.toFixed(0)},${pos.y.toFixed(0)},${pos.z.toFixed(0)}) vel(${v.x.toFixed(0)},${v.y.toFixed(0)},${v.z.toFixed(0)})`);
const nade = { position: pos, velocity: v, rolling: false, age: 0 };
let prev = v.clone(), n = 0;
while (grenades.stepProjectile(nade, CS2.TICK, false)) {
    n++;
    // a bounce = velocity direction change beyond gravity
    const expected = prev.clone(); expected.y -= 800 * CS2.nadeGravityScale * CS2.TICK;
    if (nade.velocity.distanceTo(expected) > 30) {
        // identify surface: short raycast opposite the velocity change
        console.log(`  tick ${n}: BOUNCE at game(${pos.z.toFixed(0)}, ${pos.x.toFixed(0)}, ${pos.y.toFixed(0)})  vel ${prev.length().toFixed(0)} -> ${nade.velocity.length().toFixed(0)}`);
    }
    prev.copy(nade.velocity);
}
console.log(`rest game(${pos.z.toFixed(0)}, ${pos.x.toFixed(0)}, ${pos.y.toFixed(0)})  err ${pos.distanceTo(want).toFixed(0)}u`);
