// The app knows when a throw is a jumpthrow (F was pressed), so it can use a
// jumpthrow-specific pitch bias instead of the global 10 that suits flat throws.
// Standing jumpthrows from the demos (99 of them, ~like the app's stand-and-F)
// are the references. Sweep the bias used only for these and see if landing
// error finds a basin — if it does, that's a clean, jumpthrow-only fix.
import * as THREE from 'three';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildHarness, toApp, pct } from './harness.mjs';
import { CS2, tuning } from '../physicsConfig.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = join(ROOT, 'tools/demo-data');
tuning.velInherit = 1.3;
const { grenades } = await buildHarness();

const pairs = [];
for (const pf of readdirSync(DATA).filter((f) => f.endsWith('.pairs.json')))
    pairs.push(...JSON.parse(readFileSync(join(DATA, pf), 'utf8')));
// standing jumpthrow: airborne (vz>100) but not running (small horizontal)
const jumps = pairs.filter((p) => p.vz > 100 && Math.hypot(p.vx, p.vy) < 60);

const STRENGTHS = [1.0, 0.5, 0.0];
const _dir = new THREE.Vector3(), _pos = new THREE.Vector3(), _vel = new THREE.Vector3();

// Launch with an explicit pitch bias (mirrors computeThrow but bias is a param),
// then run flight physics to rest.
function land(p, strength, bias) {
    const eye = toApp(p.px, p.py, p.pz);
    eye.y = p.pz + CS2.eyeStand;
    const yaw = THREE.MathUtils.degToRad(p.yaw);
    const fwdH = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    let pitch = THREE.MathUtils.clamp(p.pitch, -90, 90);
    pitch -= bias * (90 - Math.abs(pitch)) / 90;
    const pr = THREE.MathUtils.degToRad(pitch);
    _dir.copy(fwdH).multiplyScalar(Math.cos(pr));
    _dir.y = -Math.sin(pr);
    _dir.normalize();
    const speed = tuning.throwSpeed * (0.3 + 0.7 * strength);
    _vel.copy(_dir).multiplyScalar(speed).addScaledVector(toApp(p.vx, p.vy, p.vz), tuning.velInherit);
    _pos.copy(eye).addScaledVector(_dir, CS2.nadeSpawnForward);
    const nade = { position: _pos.clone(), velocity: _vel.clone(), rolling: false, age: 0 };
    while (grenades.stepProjectile(nade, CS2.TICK, false)) { /* rest */ }
    return nade.position.distanceTo(toApp(p.dx, p.dy, p.dz));
}

console.log(`${jumps.length} "stani+skoci" jumpthrowova, sweep pitch bias:\n`);
console.log('bias    median   p75    <=50u   <=144u');
for (let b = 0; b <= 14.0001; b += 2) {
    const e = jumps.map((p) => Math.min(...STRENGTHS.map((s) => land(p, s, b)))).sort((a, b) => a - b);
    console.log(`  ${b.toFixed(0).padStart(2)}    ${pct(e, 0.5).toFixed(0).padStart(4)}u  ${pct(e, 0.75).toFixed(0).padStart(4)}u   ${(100 * e.filter((x) => x <= 50).length / e.length).toFixed(0).padStart(3)}%   ${(100 * e.filter((x) => x <= 144).length / e.length).toFixed(0)}%`);
}
console.log('\n(app sada: bias 10 za sve; ako skok ima basen drugdje, to je jumpthrow-only popravka)');
