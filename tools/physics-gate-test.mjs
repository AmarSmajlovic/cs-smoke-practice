// PASS/FAIL physics regression gate. Runs the honest 4-demo comparison
// (same filters as gate4) and exits 1 if any threshold regresses.
// Thresholds = current calibrated baseline with a small tolerance, so any
// physics change that breaks real-demo agreement fails loudly.
// Usage: node tools/physics-gate-test.mjs
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
    groups.push({ pairs, byTick, byThrower });
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
    return { err: _pos.distanceTo(want) };
}

const results = [];
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
            if (!best || r.err < best.err) { best = r; bestPath = path; }
        }
        const others = (byTick.get(p.throw_tick) || [])
            .filter((r) => r.name !== p.thrower)
            .map((r) => toApp(r.X, r.Y, r.Z));
        if (others.length && pathHitsPlayer(bestPath, others)) continue;
        results.push({ p, err: best.err });
    }
}

const cat = (p) => (p.vz > 100 ? 'skok' : Math.hypot(p.vx, p.vy) > 5 ? 'kretanje' : 'stoji');
const metrics = (list) => {
    const e = list.map((r) => r.err).sort((a, b) => a - b);
    return { n: e.length, med: pct(e, 0.5), in50: 100 * e.filter((x) => x <= 50).length / e.length };
};

// Baseline (17.7.2026): SVE med 26/77%, stoji 14/89%, kretanje 29/72%, skok 28/71%.
// Tolerance ~10% so tick-level jitter never flakes, real regressions still fail.
const CHECKS = [
    ['SVE', results, { med: 30, in50: 73 }],
    ['stoji', results.filter((r) => cat(r.p) === 'stoji'), { med: 17, in50: 85 }],
    ['kretanje', results.filter((r) => cat(r.p) === 'kretanje'), { med: 33, in50: 68 }],
    ['skok', results.filter((r) => cat(r.p) === 'skok'), { med: 32, in50: 67 }],
];

let failed = false;
for (const [name, list, th] of CHECKS) {
    const m = metrics(list);
    const ok = m.med <= th.med && m.in50 >= th.in50;
    if (!ok) failed = true;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(9)} n=${m.n}  median ${m.med.toFixed(0)}u (max ${th.med})  <=50u ${m.in50.toFixed(0)}% (min ${th.in50}%)`);
}

// ---- csnades machine reference: "Left Arch from Back Alley" ----
// setpos -731.51 524.03 -16.63; setang -34.36 140.79, crouched jump+LMB.
// Ground truth (user-verified vs the csnades video): wall bounce -> DIRECT
// arc -> first touch game (-1213.9, 364.4, ~128) -> drops off the edge ->
// bounces on the short floor (z ~ -166) and rests there.
{
    const feet = new THREE.Vector3(524.029297, -16.634758 - CS2.eyeStand, -731.505981);
    const rT = CS2.jumpthrowReleaseTime;
    const gYawL = 140.792618 * Math.PI / 180;
    const oYawL = Math.atan2(-Math.sin(gYawL), -Math.cos(gYawL));
    const fwdHL = new THREE.Vector3(-Math.sin(oYawL), 0, -Math.cos(oYawL));
    const eye = new THREE.Vector3(feet.x, feet.y + CS2.eyeCrouch + CS2.jumpImpulse * rT - 0.5 * CS2.gravity * rT * rT, feet.z);
    const vel = new THREE.Vector3(0, CS2.jumpImpulse - CS2.gravity * rT, 0);
    const p2 = new THREE.Vector3(), v2 = new THREE.Vector3();
    grenades.computeThrow(eye.clone(), fwdHL, -34.362362, 1.0, vel, p2, v2);
    const nade = { position: p2, velocity: v2, rolling: false, age: 0 };
    const touchWant = new THREE.Vector3(364.4, 128, -1213.9);
    let touch = null, prevVy = v2.y;
    while (grenades.stepProjectile(nade, CS2.TICK, false)) {
        if (!touch && prevVy < -100 && v2.y > 0 && p2.y > 90 && p2.y < 150) touch = p2.clone();
        prevVy = v2.y;
    }
    const touchErr = touch ? Math.hypot(touch.x - touchWant.x, touch.z - touchWant.z) : Infinity;
    const restOnFloor = p2.y < -140;
    const ok = touchErr <= 60 && restOnFloor;
    if (!ok) failed = true;
    console.log(`${ok ? 'PASS' : 'FAIL'}  left-arch  touch ${touch ? `(${touch.z.toFixed(0)}, ${touch.x.toFixed(0)})` : 'NIKAD'} err ${touchErr.toFixed(0)}u (max 60)  rest z=${p2.y.toFixed(0)} (mora < -140, na podu shorta)`);
}

// ---- user reference: top-mid "spin" onto short ----
// setpos -160.03 887.97 -71.65; setang -45.79 -134.50, standing left click.
// Wall bounce game(-945, 89) -> steep fall onto the 8.8-deg underpass ramp
// -> hooks ~46 deg LEFT ("spin") and carries onto short. P-verified rest
// game (-1203.6, 228.4, pod ~-170).
{
    const gYawS = -134.498291 * Math.PI / 180;
    const oYawS = Math.atan2(-Math.sin(gYawS), -Math.cos(gYawS));
    const fwdHS = new THREE.Vector3(-Math.sin(oYawS), 0, -Math.cos(oYawS));
    const eye = new THREE.Vector3(887.970276, -71.648178, -160.031250);
    const p3 = new THREE.Vector3(), v3 = new THREE.Vector3();
    grenades.computeThrow(eye.clone(), fwdHS, -45.790627, 1.0, new THREE.Vector3(), p3, v3);
    const nade = { position: p3, velocity: v3, rolling: false, age: 0 };
    while (grenades.stepProjectile(nade, CS2.TICK, false));
    const restErr = Math.hypot(p3.z - -1203.64, p3.x - 228.38);
    const ok = restErr <= 40 && p3.y < -160;
    if (!ok) failed = true;
    console.log(`${ok ? 'PASS' : 'FAIL'}  spin-short rest (${p3.z.toFixed(0)}, ${p3.x.toFixed(0)}, ${p3.y.toFixed(0)}) err ${restErr.toFixed(0)}u (max 40)`);
    process.exitCode = failed ? 1 : 0;
}
