// The honest full gate: all 4 demos, throws whose simulated path crosses a
// player at throw time are EXCLUDED (we deliberately don't model player
// collision — a lineup trainer has an empty map), categories reported.
// Usage: node tools/gate4.mjs
import * as THREE from 'three';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildHarness, toApp, throwFrom, STRENGTHS, pct, pathHitsPlayer } from './harness.mjs';
import { CS2 } from '../physicsConfig.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = join(ROOT, 'tools/demo-data');
const { grenades } = await buildHarness();

const groups = [];
for (const pf of readdirSync(DATA).filter((f) => f.endsWith('.pairs.json'))) {
    const base = pf.replace('.pairs.json', '');
    const pairs = JSON.parse(readFileSync(join(DATA, pf), 'utf8'));
    const plf = join(DATA, `${base}.players.json`);
    const players = existsSync(plf) ? JSON.parse(readFileSync(plf, 'utf8')) : [];
    const byTick = new Map();
    for (const r of players) (byTick.get(r.tick) || byTick.set(r.tick, []).get(r.tick)).push(r);
    const traj = JSON.parse(readFileSync(join(DATA, `${base}.traj.json`), 'utf8'));
    const byThrower = new Map();
    for (const t of traj) (byThrower.get(t.thrower) || byThrower.set(t.thrower, []).get(t.thrower)).push(t);
    groups.push({ base, pairs, byTick, byThrower });
}

// Measured launch direction from trajectory samples 2..7 (least squares,
// gravity pinned) — the ground truth for whether the event-tick view angles
// actually describe the throw. Players often FLICK right after releasing
// (the worst gate outliers climb at 40° while the event says pitch -14),
// so an angle mismatch means the LABEL is corrupt, not the physics.
const TICK = 1 / 64, GN = 800 * CS2.nadeGravityScale;
function realLaunchDir(samples) {
    const i0 = 2, n = Math.min(6, samples.length - i0);
    if (n < 3) return null;
    const t0 = samples[i0].tick;
    let sT = 0, sTT = 0, sX = 0, sXT = 0, sY = 0, sYT = 0, sZ = 0, sZT = 0;
    for (let i = 0; i < n; i++) {
        const smp = samples[i0 + i];
        const t = (smp.tick - t0) * TICK;
        const zc = smp.z + 0.5 * GN * t * t;
        sT += t; sTT += t * t;
        sX += smp.x; sXT += smp.x * t;
        sY += smp.y; sYT += smp.y * t;
        sZ += zc; sZT += zc * t;
    }
    const den = n * sTT - sT * sT;
    return toApp((n * sXT - sT * sX) / den, (n * sYT - sT * sY) / den, (n * sZT - sT * sZ) / den).normalize();
}

const _pos = new THREE.Vector3(), _v = new THREE.Vector3();
function simulate(p, s, path) {
    const { eye, vel, fwdH, want } = throwFrom(p, 0);
    grenades.computeThrow(eye.clone(), fwdH, p.pitch, s, vel, _pos, _v);
    const nade = { position: _pos, velocity: _v, rolling: false, age: 0 };
    if (path) path.push(_pos.clone());
    while (grenades.stepProjectile(nade, CS2.TICK, false)) if (path) path.push(_pos.clone());
    return { rest: _pos.clone(), err: _pos.distanceTo(want) };
}

const cat = (p) => (p.vz > 100 ? 'skok' : Math.hypot(p.vx, p.vy) > 5 ? 'kretanje' : 'stoji');
const results = [];
let dropped = 0, flicked = 0;
const _launchDir = new THREE.Vector3();
for (const { base, pairs, byTick, byThrower } of groups) {
    for (const p of pairs) {
        // corrupted label? compare the measured launch direction with the
        // reconstructed one (direction is nearly strength-independent)
        let bestT = null;
        for (const t of byThrower.get(p.thrower) || []) {
            const d = Math.abs(t.throw_tick - p.throw_tick);
            if (!bestT || d < bestT.d) bestT = { t, d };
        }
        if (bestT && bestT.d <= 6 && bestT.t.samples.length >= 8) {
            const real = realLaunchDir(bestT.t.samples);
            if (real) {
                // inherit doesn't scale with strength, so each strength has
                // its own launch direction — corrupt label only if NONE match
                const { eye, vel, fwdH } = throwFrom(p, 0);
                let ang = Infinity;
                for (const s of STRENGTHS) {
                    grenades.computeThrow(eye.clone(), fwdH, p.pitch, s, vel, _pos, _v);
                    ang = Math.min(ang, THREE.MathUtils.radToDeg(_v.clone().normalize().angleTo(real)));
                }
                if (ang > 6) { flicked++; continue; }
            }
        }
        let best = null, bestPath = null;
        for (const s of STRENGTHS) {
            const path = [];
            const r = simulate(p, s, path);
            if (!best || r.err < best.err) { best = { ...r, s }; bestPath = path; }
        }
        // exclude throws whose best path crosses a team-mate/opponent hull
        const others = (byTick.get(p.throw_tick) || [])
            .filter((r) => r.name !== p.thrower)
            .map((r) => toApp(r.X, r.Y, r.Z));
        if (others.length && pathHitsPlayer(bestPath, others)) { dropped++; continue; }
        results.push({ p, ...best });
    }
}

const line = (label, list) => {
    if (!list.length) return;
    const e = list.map((r) => r.err).sort((a, b) => a - b);
    console.log(`  ${label.padEnd(9)} n=${String(e.length).padStart(3)}  median ${pct(e, 0.5).toFixed(0).padStart(4)}u  p75 ${pct(e, 0.75).toFixed(0).padStart(4)}u  p90 ${pct(e, 0.9).toFixed(0).padStart(4)}u  <=50u ${(100 * e.filter((x) => x <= 50).length / e.length).toFixed(0)}%  <=100u ${(100 * e.filter((x) => x <= 100).length / e.length).toFixed(0)}%`);
};
console.log(`${results.length} bacanja (4 demoa), ${dropped} kroz igrača + ${flicked} flick-korumpirane labele isključeno:\n`);
line('SVE', results);
for (const c of ['stoji', 'kretanje', 'skok']) line(c, results.filter((r) => cat(r.p) === c));

console.log('\n10 najgorih:');
for (const r of [...results].sort((a, b) => b.err - a.err).slice(0, 10)) {
    const d = Math.hypot(r.p.dx - r.p.px, r.p.dy - r.p.py);
    console.log(`  ${r.err.toFixed(0).padStart(4)}u  ${cat(r.p).padEnd(8)} s=${r.s}  pitch ${r.p.pitch.toFixed(1).padStart(6)}  domet ${d.toFixed(0).padStart(4)}u  det(${r.p.dx.toFixed(0)},${r.p.dy.toFixed(0)},${r.p.dz.toFixed(0)})`);
}
