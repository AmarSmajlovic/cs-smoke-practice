// Replaying the real launch lands jumpthrows at 22u; reconstructing the launch
// with computeThrow misses by 250u. So computeThrow's start state differs from
// the real one. This compares them component by component — launch POSITION vs
// launch VELOCITY — to see which is off, and by how much, for jumpthrows.
//
// Suspicion: for a jumpthrow the grenade leaves the hand a few ticks after the
// grenade_thrown event, by which point the player has risen further — so the
// event-tick eye position (what we reconstruct from) is below the real release.
import * as THREE from 'three';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildHarness, toApp, throwFrom, category, pct, STRENGTHS, simulateToRest } from './harness.mjs';
import { CS2 } from '../physicsConfig.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = join(ROOT, 'tools/demo-data');
const TICK = 1 / 64, GN = 800 * 0.4;
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

// Real launch (position at sample 2, velocity there) in app coords.
function realLaunch(s) {
    const i = 2, a = s[i], b = s[i + 2], dt = (b.tick - a.tick) * TICK;
    return {
        pos: toApp(a.x, a.y, a.z),
        vel: toApp((b.x - a.x) / dt, (b.y - a.y) / dt, (b.z - a.z) / dt + GN * dt / 2),
    };
}

const med = (a) => { a.sort((x, y) => x - y); return a.length ? a[Math.floor(a.length / 2)] : NaN; };
const _p = new THREE.Vector3(), _v = new THREE.Vector3();

for (const c of ['stoji', 'skok']) {
    const set = all.filter((r) => category(r.p) === c);
    const posErr = [], velErr = [], heightErr = [];
    for (const { p, s } of set) {
        const real = realLaunch(s);
        // best-strength model launch, same as the landing test
        const { eye, vel, fwdH } = throwFrom(p, 0);
        let bestS = null, bestE = Infinity;
        for (const st of STRENGTHS) {
            grenades.computeThrow(eye.clone(), fwdH, p.pitch, st, vel, _p, _v);
            const e = Math.abs(_v.length() - real.vel.length());
            if (e < bestE) { bestE = e; bestS = st; }
        }
        grenades.computeThrow(eye.clone(), fwdH, p.pitch, bestS, vel, _p, _v);
        posErr.push(_p.distanceTo(real.pos));
        heightErr.push(_p.y - real.pos.y);           // signed: model minus real
        velErr.push(_v.distanceTo(real.vel));
    }
    console.log(`${c.padEnd(6)} n=${set.length}`);
    console.log(`  launch pozicija greska: median ${med(posErr).toFixed(0)}u   (visina model−stvarno: ${med(heightErr).toFixed(0)}u)`);
    console.log(`  launch brzina greska:   median ${med(velErr).toFixed(0)}u/s\n`);
}
