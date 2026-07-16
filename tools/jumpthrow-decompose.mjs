// Velocity reconstruction is the jumpthrow culprit (isolate: recon vel 259u vs
// real vel 22u). Decompose the error: fit the REAL launch velocity from the
// first trajectory samples (linear x/y, quadratic z with known gravity), then
// compare against the model residual real - k*vPlayer for a grid of inherit
// factors, separately for the horizontal and vertical components. Prints the
// per-throw residual speed and pitch so the broken term is visible.
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { CS2 } from '../physicsConfig.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = join(ROOT, 'tools/demo-data');
const TICK = 1 / 64, GN = 800 * CS2.nadeGravityScale;

// join pairs (throw metadata) with traj (grenade samples), same as isolate.mjs
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
        if (best && best.d <= 6 && best.t.samples.length >= 6) all.push({ p, s: best.t.samples });
    }
}
const jumps = all.filter((r) => r.p.vz > 100);

// Fit launch velocity at t0 = first sample time, via least squares over the
// first N pre-bounce samples. Horizontal: linear. Vertical: quadratic with
// gravity pinned to GN, so only v0 is free.
function fitLaunch(s) {
    const n = Math.min(6, s.length);
    const t0 = s[0].tick;
    let sT = 0, sTT = 0, sX = 0, sXT = 0, sY = 0, sYT = 0, sZ = 0, sZT = 0;
    for (let i = 0; i < n; i++) {
        const t = (s[i].tick - t0) * TICK;
        const zc = s[i].z + 0.5 * GN * t * t; // remove gravity -> linear
        sT += t; sTT += t * t;
        sX += s[i].x; sXT += s[i].x * t;
        sY += s[i].y; sYT += s[i].y * t;
        sZ += zc; sZT += zc * t;
    }
    const den = n * sTT - sT * sT;
    return {
        vx: (n * sXT - sT * sX) / den,
        vy: (n * sYT - sT * sY) / den,
        vz: (n * sZT - sT * sZ) / den, // vertical launch vel at t0
        t0,
    };
}

// Player velocity advanced to the actual release (grenade_thrown fires at
// animation start; the nade leaves the hand ~release later, jump arc applies).
function playerVelAt(p, release) {
    return { vx: p.vx, vy: p.vy, vz: p.vz - CS2.gravity * release };
}

const rows = [];
for (const { p, s } of jumps) {
    const L = fitLaunch(s);
    // back the launch velocity up from first-sample time to the throw event:
    // horizontal unchanged, vertical regains gravity for the elapsed ticks.
    // (subtick release time unknown -> keep at first sample, note the gap)
    rows.push({ p, L, gapTicks: L.t0 - p.throw_tick });
}

console.log(`${rows.length} jumpthrows\n`);

// For a grid of (inherit, release), what residual speed does the data imply,
// and how does its pitch compare with the biased-pitch model?
const biasedPitch = (pitch) => pitch - CS2.nadePitchBias * (90 - Math.abs(pitch)) / 90;

function stats(vals) {
    const v = [...vals].sort((a, b) => a - b);
    const q = (p) => v[Math.min(v.length - 1, Math.floor(v.length * p))];
    return { med: q(0.5), q1: q(0.25), q3: q(0.75) };
}

for (const inh of [0, 0.5, 1.0, 1.25, 1.3]) {
    for (const release of [0.125]) {
        const speeds = [], dpitch = [];
        for (const { p, L, gapTicks } of rows) {
            const pv = playerVelAt(p, release);
            // vertical launch vel at release time = fitted v0 at t0 plus
            // gravity over the gap back to (throw_tick + release)
            const dt = gapTicks * TICK - release;
            const vz0 = L.vz + GN * Math.max(dt, 0);
            const rx = L.vx - inh * pv.vx, ry = L.vy - inh * pv.vy, rz = vz0 - inh * pv.vz;
            const speed = Math.hypot(rx, ry, rz);
            const realPitch = -Math.atan2(rz, Math.hypot(rx, ry)) * 180 / Math.PI;
            speeds.push(speed);
            dpitch.push(realPitch - biasedPitch(p.pitch));
        }
        const S = stats(speeds), D = stats(dpitch);
        console.log(`inherit ${inh.toFixed(2).padStart(4)}: residual speed med ${S.med.toFixed(0)} [${S.q1.toFixed(0)}..${S.q3.toFixed(0)}]  pitch-vs-model med ${D.med.toFixed(1)}° [${D.q1.toFixed(1)}..${D.q3.toFixed(1)}]`);
    }
}

// Per-throw dump at inherit 0 to see structure vs pitch: does the real vertical
// component track the model at steep pitches?
console.log('\npitch_bin: real vertical vs model vertical (inherit 0, speed as measured)');
const bins = new Map();
for (const { p, L, gapTicks } of rows) {
    const dt = gapTicks * TICK - 0.125;
    const vz0 = L.vz + GN * Math.max(dt, 0);
    const vh = Math.hypot(L.vx, L.vy);
    const bin = Math.round(p.pitch / 10) * 10;
    (bins.get(bin) || bins.set(bin, []).get(bin)).push({ pitch: p.pitch, vh, vz0, pvz: p.vz - CS2.gravity * 0.125, pvh: Math.hypot(p.vx, p.vy) });
}
for (const [bin, list] of [...bins.entries()].sort((a, b) => a[0] - b[0])) {
    const mVh = stats(list.map((r) => r.vh)).med;
    const mVz = stats(list.map((r) => r.vz0)).med;
    const mPvz = stats(list.map((r) => r.pvz)).med;
    const bp = biasedPitch(bin);
    const modelVh = 685 * Math.cos(bp * Math.PI / 180);
    const modelVz = -685 * Math.sin(bp * Math.PI / 180);
    console.log(`pitch ~${String(bin).padStart(4)}° (n=${String(list.length).padStart(2)}): real vh ${mVh.toFixed(0).padStart(4)} vz ${mVz.toFixed(0).padStart(4)} | model(685) vh ${modelVh.toFixed(0).padStart(4)} vz ${modelVz.toFixed(0).padStart(4)} | player vz@rel ${mPvz.toFixed(0)}`);
}
