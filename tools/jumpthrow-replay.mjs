// The decisive test: feed the grenade its REAL launch position and velocity
// straight from the demo trajectory (no computeThrow, no reconstruction) and run
// only the flight physics to rest. If it still misses the real detonation, the
// remaining jumpthrow error is purely downstream — flight/bounce/roll for steep
// high arcs, or map collision — not the throw. If it lands, reconstruction is
// the culprit.
import * as THREE from 'three';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildHarness, toApp, category, pct } from './harness.mjs';
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

// Replay from real launch: start a few samples in (past the hand), use the
// measured velocity there, run flight physics to rest.
function replay(s) {
    const i = 2;                     // skip first couple samples (hand/spawn)
    const a = s[i], b = s[i + 2], dt = (b.tick - a.tick) * TICK;
    const vGame = { x: (b.x - a.x) / dt, y: (b.y - a.y) / dt, z: (b.z - a.z) / dt + GN * dt / 2 };
    const pos = toApp(a.x, a.y, a.z);
    const vel = toApp(vGame.x, vGame.y, vGame.z);
    const nade = { position: pos, velocity: vel, rolling: false, age: 0 };
    while (grenades.stepProjectile(nade, TICK, false)) { /* to rest */ }
    return pos;
}

const stat = (set) => {
    const e = set.map((r) => {
        const got = replay(r.s);
        const want = toApp(r.p.dx, r.p.dy, r.p.dz);
        return got.distanceTo(want);
    }).sort((a, b) => a - b);
    return `median ${pct(e, 0.5).toFixed(0).padStart(4)}u  p90 ${pct(e, 0.9).toFixed(0).padStart(4)}u  <=50u ${(100 * e.filter((x) => x <= 50).length / e.length).toFixed(0)}%`;
};

console.log('REPLAY iz stvarne launch brzine (samo let-fizika, bez rekonstrukcije):\n');
for (const c of ['stoji', 'kretanje', 'skok']) {
    const set = all.filter((r) => category(r.p) === c);
    console.log(`  ${c.padEnd(9)} n=${String(set.length).padStart(3)}   ${stat(set)}`);
}
console.log('\nako je skok i ovdje los -> greska je u letu/odbijanju za strme lukove, ne u launchu');
