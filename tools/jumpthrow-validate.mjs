// End-to-end landing validation of the uniform-inherit jumpthrow model:
//   inherit k = 1.25 on ALL axes (matches the ground-mover fit exactly),
//   release r seconds after the jump instant — player advanced along the
//   jump arc to +r for BOTH the spawn position and the inherited velocity.
// Sweeps r; landing error vs the real detonation point across all demos.
import * as THREE from 'three';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildHarness, toApp, STRENGTHS, pct } from './harness.mjs';
import { CS2, tuning } from '../physicsConfig.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = join(ROOT, 'tools/demo-data');
const { grenades } = await buildHarness();

const pairs = [];
for (const pf of readdirSync(DATA).filter((f) => f.endsWith('.pairs.json')))
    pairs.push(...JSON.parse(readFileSync(join(DATA, pf), 'utf8')));
const jumps = pairs.filter((p) => p.vz > 100 && p.vz < CS2.jumpImpulse);

const _pos = new THREE.Vector3(), _v = new THREE.Vector3();
function landErr(p, r, k) {
    // rewind to jump instant, then advance r along the jump arc
    const dt0 = (CS2.jumpImpulse - p.vz) / CS2.gravity;
    const jx = p.px - p.vx * dt0, jy = p.py - p.vy * dt0;
    const jz = p.pz - (p.vz + CS2.jumpImpulse) * 0.5 * dt0;
    const vz = CS2.jumpImpulse - CS2.gravity * r;
    const ez = jz + CS2.jumpImpulse * r - 0.5 * CS2.gravity * r * r;
    const eye = toApp(jx + p.vx * r, jy + p.vy * r, ez).setY(ez + CS2.eyeStand);
    const vel = toApp(p.vx, p.vy, vz);
    const want = toApp(p.dx, p.dy, p.dz);
    const yaw = THREE.MathUtils.degToRad(p.yaw);
    const fwdH = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    tuning.velInheritH = k;
    tuning.velInheritZ = k;
    let best = Infinity;
    for (const s of STRENGTHS) {
        grenades.computeThrow(eye.clone(), fwdH, p.pitch, s, vel, _pos, _v);
        const nade = { position: _pos, velocity: _v, rolling: false, age: 0 };
        while (grenades.stepProjectile(nade, CS2.TICK, false)) { /* rest */ }
        best = Math.min(best, _pos.distanceTo(want));
    }
    return best;
}

console.log(`${jumps.length} jumpthrows, uniform inherit 1.25, sweep release r:\n`);
for (const r of [0.115, 0.1175, 0.12, 0.1225, 0.125, 0.1275, 0.13, 0.1325, 0.135]) {
    const errs = jumps.map((p) => landErr(p, r, 1.25)).sort((a, b) => a - b);
    console.log(`  r=${r.toFixed(2)}s: median ${pct(errs, 0.5).toFixed(0).padStart(4)}u  p90 ${pct(errs, 0.9).toFixed(0).padStart(4)}u  <=50u ${(100 * errs.filter((x) => x <= 50).length / errs.length).toFixed(0)}%`);
}
