// Replay (real launch) lands jumpthrows at 22u; reconstruction misses by 256u.
// Cross real vs reconstructed POSITION and VELOCITY to see which one carries the
// error, so the fix targets the right thing.
//   A real pos  + real vel  -> known good (22u)
//   B recon pos + recon vel -> known bad  (256u)
//   C real pos  + recon vel -> isolates velocity
//   D recon pos + real vel  -> isolates position
import * as THREE from 'three';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildHarness, toApp, throwFrom, category, pct, STRENGTHS } from './harness.mjs';
import { CS2, tuning } from '../physicsConfig.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = join(ROOT, 'tools/demo-data');
const TICK = 1 / 64, GN = 800 * 0.4;
tuning.velInherit = 1.3;
const { grenades } = await buildHarness();

const all = [];
for (const pf of readdirSync(DATA).filter((f) => f.endsWith('.pairs.json'))) {
    const base = pf.replace('.pairs.json', '');
    const pairs = JSON.parse(readFileSync(join(DATA, pf), 'utf8'));
    const traj = JSON.parse(readFileSync(join(DATA, `${base}.traj.json`), 'utf8'));
    const byT = new Map();
    for (const t of traj) (byT.get(t.thrower) || byT.set(t.thrower, []).get(t.thrower)).push(t);
    for (const p of pairs) {
        let best = null;
        for (const t of byT.get(p.thrower) || []) {
            const d = Math.abs(t.throw_tick - p.throw_tick);
            if (!best || d < best.d) best = { t, d };
        }
        if (best && best.d <= 6 && best.t.samples.length >= 5) all.push({ p, s: best.t.samples });
    }
}
const jumps = all.filter((r) => r.p.vz > 100);

function realLaunch(s) {
    const i = 2, a = s[i], b = s[i + 2], dt = (b.tick - a.tick) * TICK;
    return {
        pos: toApp(a.x, a.y, a.z),
        vel: toApp((b.x - a.x) / dt, (b.y - a.y) / dt, (b.z - a.z) / dt + GN * dt / 2),
    };
}
// Reconstructed launch (best-fitting strength), same as the landing test.
const _p = new THREE.Vector3(), _v = new THREE.Vector3();
function reconLaunch(p, real) {
    const { eye, vel, fwdH } = throwFrom(p, 0);
    let bestS = 1, bestE = Infinity;
    for (const st of STRENGTHS) {
        grenades.computeThrow(eye.clone(), fwdH, p.pitch, st, vel, _p, _v);
        const e = _v.length() - real.vel.length();
        if (Math.abs(e) < bestE) { bestE = Math.abs(e); bestS = st; }
    }
    grenades.computeThrow(eye.clone(), fwdH, p.pitch, bestS, vel, _p, _v);
    return { pos: _p.clone(), vel: _v.clone() };
}

function runTo(pos, vel, want) {
    const nade = { position: pos.clone(), velocity: vel.clone(), rolling: false, age: 0 };
    while (grenades.stepProjectile(nade, TICK, false)) { /* rest */ }
    return nade.position.distanceTo(want);
}

const res = { A: [], B: [], C: [], D: [] };
for (const { p, s } of jumps) {
    const real = realLaunch(s), rec = reconLaunch(p, real);
    const want = toApp(p.dx, p.dy, p.dz);
    res.A.push(runTo(real.pos, real.vel, want));
    res.B.push(runTo(rec.pos, rec.vel, want));
    res.C.push(runTo(real.pos, rec.vel, want));
    res.D.push(runTo(rec.pos, real.vel, want));
}
const line = (k, label) => {
    const e = res[k].sort((a, b) => a - b);
    console.log(`  ${label.padEnd(34)} median ${pct(e, 0.5).toFixed(0).padStart(4)}u   <=50u ${(100 * e.filter((x) => x <= 50).length / e.length).toFixed(0)}%`);
};
console.log(`${jumps.length} jumpthrowova (inherit 1.3):\n`);
line('A', 'A stvarna poz + stvarna brzina');
line('D', 'D rekonstr poz + STVARNA brzina');
line('C', 'C STVARNA poz + rekonstr brzina');
line('B', 'B rekonstr poz + rekonstr brzina');
console.log('\nkoja kombinacija ostane niska pokazuje sta je ispravno; koja skoci je krivac');
