// Where does the grenade ACTUALLY spawn, relative to our reconstruction?
// Integrate the fitted launch trajectory backwards and find the time/point
// closest to the reconstructed spawn (jump-instant eye + 16*forward). The
// median offset tells us how to fix the position model. Also: fit the
// horizontal inherit on MOVING GROUND throws' launch velocities directly —
// jumps can't separate it cleanly.
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { CS2 } from '../physicsConfig.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = join(ROOT, 'tools/demo-data');
const TICK = 1 / 64, GN = 800 * CS2.nadeGravityScale;

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

function fitLaunch(s) {
    const i0 = 2, n = Math.min(6, s.length - i0);
    const t0 = s[i0].tick;
    let sT = 0, sTT = 0, sX = 0, sXT = 0, sY = 0, sYT = 0, sZ = 0, sZT = 0, mX = 0, mY = 0, mZ = 0;
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
    const vx = (n * sXT - sT * sX) / den, vy = (n * sYT - sT * sY) / den, vz = (n * sZT - sT * sZ) / den;
    // intercepts: position at t0
    const x0 = (sX - vx * sT) / n, y0 = (sY - vy * sT) / n, z0 = (sZ - vz * sT) / n;
    return { t0, x0, y0, z0, vx, vy, vz }; // z0/vz in gravity-removed frame at t0
}

// pos(t) relative to t0: x = x0+vx*t, z = z0+vz*t-0.5*GN*t^2  (t can be <0)
const stats = (v) => { const s = [...v].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };

const jumps = all.filter((r) => r.p.vz > 100 && r.p.vz < CS2.jumpImpulse);
const dts = [], dF = [], dL = [], dU = [], dEye = [];
for (const { p, s } of jumps) {
    const L = fitLaunch(s);
    // reconstructed spawn: jump-instant eye + 16*dir(biased pitch, yaw)
    const dt = (CS2.jumpImpulse - p.vz) / CS2.gravity;
    const ex = p.px - p.vx * dt, ey = p.py - p.vy * dt;
    const ez = p.pz - (p.vz + CS2.jumpImpulse) * 0.5 * dt + CS2.eyeStand;
    let pitch = p.pitch - CS2.nadePitchBias * (90 - Math.abs(p.pitch)) / 90;
    const pr = pitch * Math.PI / 180, yr = p.yaw * Math.PI / 180;
    const fx = Math.cos(yr) * Math.cos(pr), fy = Math.sin(yr) * Math.cos(pr), fz = -Math.sin(pr);
    const sx = ex + 16 * fx, sy = ey + 16 * fy, sz = ez + 16 * fz;
    // closest approach time of the ballistic line to (sx,sy,sz): search t
    let bt = 0, bd = Infinity;
    for (let t = -0.4; t <= 0.1; t += 1 / 256) {
        const x = L.x0 + L.vx * t, y = L.y0 + L.vy * t, z = L.z0 + L.vz * t - 0.5 * GN * t * t;
        const d = Math.hypot(x - sx, y - sy, z - sz);
        if (d < bd) { bd = d; bt = t; }
    }
    const jumpT = ((p.throw_tick - L.t0) * TICK) - dt; // jump instant rel t0 (negative)
    dts.push(bt - jumpT); // release relative to jump instant
    // offset at the jump instant: where was the grenade line vs recon spawn
    const t = jumpT;
    const gx = L.x0 + L.vx * t, gy = L.y0 + L.vy * t, gz = L.z0 + L.vz * t - 0.5 * GN * t * t;
    const ox = gx - sx, oy = gy - sy, oz = gz - sz;
    // decompose into forward(yaw)/left/up
    const cf = Math.cos(yr), sf = Math.sin(yr);
    dF.push(ox * cf + oy * sf);
    dL.push(-ox * sf + oy * cf);
    dU.push(oz);
    dEye.push(Math.hypot(ox, oy, oz));
}
console.log(`${jumps.length} jumps: release happens ${(stats(dts) * 1000).toFixed(0)}ms after the jump instant (median)`);
console.log(`grenade-line offset AT jump instant vs recon spawn: fwd ${stats(dF).toFixed(0)}u  left ${stats(dL).toFixed(0)}u  up ${stats(dU).toFixed(0)}u  |3D| ${stats(dEye).toFixed(0)}u`);

// Horizontal inherit from moving GROUND throws (vz small, horizontal speed >100)
const movers = all.filter((r) => Math.abs(r.p.vz) < 30 && Math.hypot(r.p.vx, r.p.vy) > 100);
console.log(`\n${movers.length} moving ground throws — horizontal inherit fit (speed 685 / bias 10 pinned):`);
for (let k = 0.8; k <= 1.5; k += 0.05) {
    const errs = movers.map(({ p, s }) => {
        const L = fitLaunch(s);
        let pitch = Math.max(-90, Math.min(90, p.pitch));
        pitch -= CS2.nadePitchBias * (90 - Math.abs(pitch)) / 90;
        const pr = pitch * Math.PI / 180, yr = p.yaw * Math.PI / 180;
        // best strength per throw
        let be = Infinity;
        for (const st of [1, 0.5, 0]) {
            const sp = 685 * (0.3 + 0.7 * st);
            const mx = Math.cos(yr) * Math.cos(pr) * sp + k * p.vx;
            const my = Math.sin(yr) * Math.cos(pr) * sp + k * p.vy;
            const mz = -Math.sin(pr) * sp + k * p.vz;
            const e = Math.hypot(L.vx - mx, L.vy - my, L.vz + GN * ((L.t0 - p.throw_tick) * TICK) - mz);
            if (e < be) be = e;
        }
        return be;
    });
    console.log(`  kH ${k.toFixed(2)}: median vel err ${stats(errs).toFixed(0)} u/s`);
}
