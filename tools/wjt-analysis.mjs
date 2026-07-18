// W-jumpthrow diagnosis: are RUNNING jumpthrows (high player horizontal speed
// at release) overshooting with the current velInheritH? Bins jump throws by
// horizontal speed and sweeps the horizontal inherit factor per bin.
// Reads the same data with the same label filters as gate4.
// Usage: node tools/wjt-analysis.mjs
import * as THREE from 'three';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildHarness, toApp, throwFrom, STRENGTHS, pct, pathHitsPlayer } from './harness.mjs';
import { CS2, tuning } from '../physicsConfig.js';

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

// Collect the same filtered set as gate4 (flick labels + player hits out)
const usable = [];
for (const { pairs, byTick, byThrower } of groups) {
    for (const p of pairs) {
        let bestT = null;
        for (const t of byThrower.get(p.thrower) || []) {
            const d = Math.abs(t.throw_tick - p.throw_tick);
            if (!bestT || d < bestT.d) bestT = { t, d };
        }
        if (bestT && bestT.d <= 6 && bestT.t.samples.length >= 8) {
            const real = realLaunchDir(bestT.t.samples);
            if (real) {
                const { eye, vel, fwdH } = throwFrom(p, 0);
                let ang = Infinity;
                for (const s of STRENGTHS) {
                    grenades.computeThrow(eye.clone(), fwdH, p.pitch, s, vel, _pos, _v);
                    ang = Math.min(ang, THREE.MathUtils.radToDeg(_v.clone().normalize().angleTo(real)));
                }
                if (ang > 6) continue;
            }
        }
        let best = null, bestPath = null;
        for (const s of STRENGTHS) {
            const path = [];
            const r = simulate(p, s, path);
            if (!best || r.err < best.err) { best = { ...r, s }; bestPath = path; }
        }
        const others = (byTick.get(p.throw_tick) || [])
            .filter((r) => r.name !== p.thrower)
            .map((r) => toApp(r.X, r.Y, r.Z));
        if (others.length && pathHitsPlayer(bestPath, others)) continue;
        usable.push(p);
    }
}

const hSpeed = (p) => Math.hypot(p.vx, p.vy);
const jumps = usable.filter((p) => p.vz > 100);
const BINS = [
    { name: 'JT stoji   (h<30)', f: (p) => hSpeed(p) < 30 },
    { name: 'JT hoda (30-120)', f: (p) => hSpeed(p) >= 30 && hSpeed(p) < 120 },
    { name: 'JT trci  (h>120)', f: (p) => hSpeed(p) >= 120 },
];

const stats = (list) => {
    const e = list.map((p) => {
        let best = Infinity;
        for (const s of STRENGTHS) best = Math.min(best, simulate(p, s).err);
        return best;
    }).sort((a, b) => a - b);
    return e.length ? {
        n: e.length,
        med: pct(e, 0.5), p90: pct(e, 0.9),
        in50: 100 * e.filter((x) => x <= 50).length / e.length,
    } : null;
};

console.log(`\njump bacanja (filtrirano): ${jumps.length}; hSpeed distribucija:`);
const hs = jumps.map(hSpeed).sort((a, b) => a - b);
console.log(`  min ${hs[0]?.toFixed(0)}  med ${pct(hs, 0.5)?.toFixed(0)}  p90 ${pct(hs, 0.9)?.toFixed(0)}  max ${hs[hs.length - 1]?.toFixed(0)}`);

console.log(`\n== baseline (velInheritH=${tuning.velInheritH}) ==`);
for (const b of BINS) {
    const s = stats(jumps.filter(b.f));
    if (s) console.log(`  ${b.name}  n=${String(s.n).padStart(3)}  median ${s.med.toFixed(0).padStart(4)}u  p90 ${s.p90.toFixed(0).padStart(4)}u  <=50u ${s.in50.toFixed(0)}%`);
}

console.log('\n== sweep velInheritH (samo jump bacanja, po binu: median / <=50u%) ==');
const saved = tuning.velInheritH;
const header = ['  inheritH', ...BINS.map((b) => b.name.trim().padStart(18))].join(' ');
console.log(header);
for (let ih = 0; ih <= 1.5001; ih += 0.125) {
    tuning.velInheritH = ih;
    const cells = BINS.map((b) => {
        const s = stats(jumps.filter(b.f));
        return s ? `${s.med.toFixed(0).padStart(5)}u ${s.in50.toFixed(0).padStart(3)}%`.padStart(18) : ' '.repeat(18);
    });
    console.log(`  ${ih.toFixed(3).padStart(7)} ${cells.join(' ')}`);
}
tuning.velInheritH = saved;

// The same sweep for MOVING GROUND throws as a control — their 1.25 fit was
// sharp, so if it stays pinned while the running JT bin wants something else,
// the difference is specifically the jumpthrow.
const movers = usable.filter((p) => p.vz <= 100 && hSpeed(p) > 60);
console.log(`\n== kontrola: moving GROUND throws (h>60), n=${movers.length} ==`);
for (let ih = 0.75; ih <= 1.5001; ih += 0.125) {
    tuning.velInheritH = ih;
    const s = stats(movers);
    console.log(`  inheritH ${ih.toFixed(3)}  median ${s.med.toFixed(0).padStart(4)}u  <=50u ${s.in50.toFixed(0)}%`);
}
tuning.velInheritH = saved;
