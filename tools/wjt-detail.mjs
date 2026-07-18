// Dump each fast-moving jumpthrow (hSpeed>120): where does it miss, and is
// the miss along the player's movement (inherit-shaped) or somewhere else?
// Usage: node tools/wjt-detail.mjs
import * as THREE from 'three';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildHarness, toApp, throwFrom, STRENGTHS } from './harness.mjs';
import { CS2, tuning } from '../physicsConfig.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = join(ROOT, 'tools/demo-data');
const { grenades } = await buildHarness();

const all = [];
for (const pf of readdirSync(DATA).filter((f) => f.endsWith('.pairs.json'))) {
    for (const p of JSON.parse(readFileSync(join(DATA, pf), 'utf8'))) {
        p.demo = pf.slice(0, 14);
        all.push(p);
    }
}

const _pos = new THREE.Vector3(), _v = new THREE.Vector3();
function simRest(p, s) {
    const { eye, vel, fwdH } = throwFrom(p, 0);
    grenades.computeThrow(eye.clone(), fwdH, p.pitch, s, vel, _pos, _v);
    const nade = { position: _pos, velocity: _v, rolling: false, age: 0 };
    while (grenades.stepProjectile(nade, CS2.TICK, false));
    return _pos.clone();
}

const fast = all.filter((p) => p.vz > 100 && Math.hypot(p.vx, p.vy) > 120);
console.log(`fast jumpthrows: ${fast.length}\n`);
for (const p of fast) {
    const want = toApp(p.dx, p.dy, p.dz);
    let best = null;
    for (const s of STRENGTHS) {
        const rest = simRest(p, s);
        const err = rest.distanceTo(want);
        if (!best || err < best.err) best = { s, rest, err };
    }
    // miss decomposed: along the player's horizontal velocity vs across it
    const velDir = toApp(p.vx, p.vy, 0).normalize();
    const miss = best.rest.clone().sub(want);
    const along = miss.dot(velDir);
    const missH = Math.hypot(miss.x, miss.z);
    const range = Math.hypot(p.dx - p.px, p.dy - p.py);
    // throw direction vs movement direction (throwing forward while running?)
    const yaw = THREE.MathUtils.degToRad(p.yaw);
    const fwd = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    const angMove = THREE.MathUtils.radToDeg(Math.acos(Math.max(-1, Math.min(1, fwd.dot(velDir)))));
    console.log(
        `${p.demo}  h=${Math.hypot(p.vx, p.vy).toFixed(0).padStart(3)} vz=${p.vz.toFixed(0)}  ` +
        `pitch ${p.pitch.toFixed(1).padStart(6)}  domet ${range.toFixed(0).padStart(4)}  s=${best.s}  ` +
        `err ${best.err.toFixed(0).padStart(4)}u  uzduz-kretanja ${along >= 0 ? '+' : ''}${along.toFixed(0)}u  ` +
        `smjer-vs-kretanje ${angMove.toFixed(0)}deg`
    );
}
