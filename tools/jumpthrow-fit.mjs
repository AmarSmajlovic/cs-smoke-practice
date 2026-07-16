// Global fit of the throw-velocity model against real demo launch velocities.
// Real velocity is measured from trajectory samples 2..7 (the first two are
// unreliable — isolate.mjs's known-good replay also starts at sample 2).
// Models tried:
//   bias 'scaled': pitch' = pitch - b*(90-|p|)/90   (current code, b=10)
//   bias 'const':  pitch' = pitch - b
// Fit (speed s, bias b, inherit k) minimizing the 3D velocity residual.
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { CS2 } from '../physicsConfig.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = join(ROOT, 'tools/demo-data');
const TICK = 1 / 64, GN = 800 * CS2.nadeGravityScale, RELEASE = 0.125;

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
        if (best && best.d <= 6 && best.t.samples.length >= 8) all.push({ p, s: best.t.samples });
    }
}
const jumps = all.filter((r) => r.p.vz > 100);

// Least-squares launch velocity from samples 2..7, gravity pinned; velocity
// reported at the time of sample 2, then walked back to throw_tick+RELEASE.
function fitLaunch(s, throwTick) {
    const i0 = 2, n = Math.min(6, s.length - i0);
    const t0 = s[i0].tick;
    let sT = 0, sTT = 0, sX = 0, sXT = 0, sY = 0, sYT = 0, sZ = 0, sZT = 0;
    for (let i = 0; i < n; i++) {
        const smp = s[i0 + i];
        const t = (smp.tick - t0) * TICK;
        const zc = smp.z + 0.5 * GN * t * t;
        sT += t; sTT += t * t;
        sX += smp.x; sXT += smp.x * t;
        sY += smp.y; sYT += smp.y * t;
        sZ += zc; sZT += zc * t;
    }
    const den = n * sTT - sT * sT;
    const dt = (t0 - throwTick) * TICK - RELEASE; // time from release to sample 2
    return {
        vx: (n * sXT - sT * sX) / den,
        vy: (n * sYT - sT * sY) / den,
        vz: (n * sZT - sT * sZ) / den + GN * Math.max(dt, 0),
    };
}

const rows = jumps.map(({ p, s }) => ({
    p,
    real: fitLaunch(s, p.throw_tick),
    pv: { vx: p.vx, vy: p.vy, vz: p.vz - CS2.gravity * RELEASE },
}));
console.log(`${rows.length} jumpthrows (launch vel from samples 2..7)\n`);

function modelVel(p, s, b, mode, k, pv) {
    let pitch = Math.max(-90, Math.min(90, p.pitch));
    pitch -= mode === 'scaled' ? b * (90 - Math.abs(pitch)) / 90 : b;
    const pr = pitch * Math.PI / 180, yr = p.yaw * Math.PI / 180;
    const ch = Math.cos(pr);
    return {
        vx: Math.cos(yr) * ch * s + k * pv.vx,
        vy: Math.sin(yr) * ch * s + k * pv.vy,
        vz: -Math.sin(pr) * s + k * pv.vz,
    };
}

function score(s, b, mode, k) {
    const errs = rows.map(({ p, real, pv }) => {
        const m = modelVel(p, s, b, mode, k, pv);
        return Math.hypot(real.vx - m.vx, real.vy - m.vy, real.vz - m.vz);
    }).sort((a, b2) => a - b2);
    return errs[Math.floor(errs.length / 2)];
}

for (const mode of ['scaled', 'const']) {
    let best = null;
    for (let s = 600; s <= 950; s += 5)
        for (let b = 0; b <= 45; b += 1)
            for (let k = 0; k <= 1.6; k += 0.05) {
                const e = score(s, b, mode, k);
                if (!best || e < best.e) best = { s, b, k, e };
            }
    console.log(`bias=${mode.padEnd(6)} best: speed ${best.s}  bias ${best.b}°  inherit ${best.k.toFixed(2)}  -> median vel err ${best.e.toFixed(0)} u/s`);
}

// Variant: separate horizontal and vertical inherit (scaled bias).
function scoreHV(s, b, kh, kz) {
    const errs = rows.map(({ p, real, pv }) => {
        const m = modelVel(p, s, b, 'scaled', 0, pv);
        m.vx += kh * pv.vx; m.vy += kh * pv.vy; m.vz += kz * pv.vz;
        return Math.hypot(real.vx - m.vx, real.vy - m.vy, real.vz - m.vz);
    }).sort((a, b2) => a - b2);
    return errs[Math.floor(errs.length / 2)];
}
{
    let best = null;
    for (let s = 600; s <= 950; s += 5)
        for (let b = 0; b <= 45; b += 1)
            for (let kh = 0; kh <= 1.6; kh += 0.1)
                for (let kz = 0; kz <= 2.2; kz += 0.1) {
                    const e = scoreHV(s, b, kh, kz);
                    if (!best || e < best.e) best = { s, b, kh, kz, e };
                }
    console.log(`split inherit best: speed ${best.s}  bias ${best.b}°  kH ${best.kh.toFixed(2)}  kZ ${best.kz.toFixed(2)}  -> median vel err ${best.e.toFixed(0)} u/s`);
}

// And the current shipped model for reference:
console.log(`current shipped (685, scaled 10, 1.3):    median vel err ${score(685, 10, 'scaled', 1.3).toFixed(0)} u/s`);

// Variants that PIN the standing calibration (speed 685, scaled bias 10 —
// verified on machine-setpos references) and only model the jump boost:
//   D: vertical boost = kz * jumpImpulse (release at the exact jump subtick,
//      the CS2 "consistent jumpthrow" story), horizontal = kh * pv_h
//   E: velocity inherited at release r after the event: k * pv(r)
function scoreD(kh, kz) {
    const errs = rows.map(({ p, real }) => {
        const m = modelVel(p, 685, 10, 'scaled', 0, { vx: 0, vy: 0, vz: 0 });
        m.vx += kh * p.vx; m.vy += kh * p.vy; m.vz += kz * CS2.jumpImpulse;
        return Math.hypot(real.vx - m.vx, real.vy - m.vy, real.vz - m.vz);
    }).sort((a, b2) => a - b2);
    return errs[Math.floor(errs.length / 2)];
}
{
    let best = null;
    for (let kh = 0; kh <= 1.6; kh += 0.05)
        for (let kz = 0; kz <= 1.6; kz += 0.05) {
            const e = scoreD(kh, kz);
            if (!best || e < best.e) best = { kh, kz, e };
        }
    console.log(`D pin685/10, boost=kz*302:  kH ${best.kh.toFixed(2)}  kZ ${best.kz.toFixed(2)}  -> median vel err ${best.e.toFixed(0)} u/s`);
}
function scoreE(k, r) {
    const errs = rows.map(({ p, real }) => {
        const m = modelVel(p, 685, 10, 'scaled', 0, { vx: 0, vy: 0, vz: 0 });
        m.vx += k * p.vx; m.vy += k * p.vy; m.vz += k * (p.vz - CS2.gravity * r);
        return Math.hypot(real.vx - m.vx, real.vy - m.vy, real.vz - m.vz);
    }).sort((a, b2) => a - b2);
    return errs[Math.floor(errs.length / 2)];
}
{
    let best = null;
    for (let k = 0; k <= 2.2; k += 0.05)
        for (let r = -0.15; r <= 0.2; r += 0.0125) {
            const e = scoreE(k, r);
            if (!best || e < best.e) best = { k, r, e };
        }
    console.log(`E pin685/10, k*pv(rel r):   k ${best.k.toFixed(2)}  r ${best.r.toFixed(3)}s -> median vel err ${best.e.toFixed(0)} u/s`);
}
