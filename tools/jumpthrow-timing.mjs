// Can the app's jumpthrow be fixed even though pro bind timings vary? The app
// controls its own F-bind, so it only needs ONE consistent release to emulate.
// This measures, per real jumpthrow, how high above the player's event-tick eye
// the grenade actually launches — i.e. how far the player rose before release.
// If that clusters, there's a dominant standard bind to calibrate the app to; if
// it's smeared, jumpthrow really can't be reconstructed and needs the user's own
// lineups instead.
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { CS2 } from '../physicsConfig.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = join(ROOT, 'tools/demo-data');
const TICK = 1 / 64, GN = 800 * 0.4;

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
        if (best && best.d <= 6 && best.t.samples.length >= 4) all.push({ p, s: best.t.samples });
    }
}

const med = (a) => { a.sort((x, y) => x - y); return a.length ? a[Math.floor(a.length / 2)] : NaN; };
// Solve jump rise height -> time since jump: h = jumpImpulse*t - 0.5*g*t^2 (player gravity)
function riseToTime(h) {
    const a = 0.5 * CS2.gravity, b = -CS2.jumpImpulse, c = h;
    const disc = b * b - 4 * a * c;
    if (disc < 0) return NaN;
    return (-b - Math.sqrt(disc)) / (2 * a); // ascending branch
}

const jumps = all.filter((r) => r.p.vz > 100);
console.log(`${jumps.length} jumpthrowova\n`);

// Grenade launch z (game up) at sample 0 vs the player's event-tick eye.
const heights = [], times = [];
for (const { p, s } of jumps) {
    const launchZ = s[0].z;                       // game z = up
    const eyeZ = p.pz + CS2.eyeStand;             // player eye at event tick
    const h = launchZ - eyeZ;                     // rise above event eye
    heights.push(h);
    const t = riseToTime(h);
    if (!isNaN(t)) times.push(t);
}
console.log(`launch visina iznad event-oka: median ${med(heights).toFixed(1)}u   raspon p10..p90 ${med([...heights]).toFixed(0)}`);
const hs = [...heights].sort((a, b) => a - b);
console.log(`  p10 ${hs[Math.floor(hs.length * 0.1)].toFixed(0)}u  p25 ${hs[Math.floor(hs.length * 0.25)].toFixed(0)}u  median ${med(hs).toFixed(0)}u  p75 ${hs[Math.floor(hs.length * 0.75)].toFixed(0)}u  p90 ${hs[Math.floor(hs.length * 0.9)].toFixed(0)}u`);

console.log('\nhistogram visine (u) — ima li dominantni mod?:');
for (let lo = -20; lo < 60; lo += 10) {
    const n = heights.filter((h) => h >= lo && h < lo + 10).length;
    if (n) console.log(`  ${String(lo).padStart(3)}..${String(lo + 9).padStart(3)}u  ${'#'.repeat(n)} ${n}`);
}
console.log(`\nvrijeme od skoka do otpustanja (s): median ${med(times).toFixed(3)}   (app sada: 2 ticka = ${(2 * TICK).toFixed(3)})`);
const ts = times.sort((a, b) => a - b);
console.log(`  p25 ${ts[Math.floor(ts.length * 0.25)].toFixed(3)}  median ${med(ts).toFixed(3)}  p75 ${ts[Math.floor(ts.length * 0.75)].toFixed(3)}`);
