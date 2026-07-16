// Measures the jumpthrow launch from real trajectories across every demo in
// tools/demo-data/, to pin down what a landing-point sweep couldn't.
//
// The grenade's real launch velocity is a fact read from its first trajectory
// samples. The throw model is v0 = throwSpeed·dir(view,pitchBias) + inherit·vPlayer.
// throwSpeed is already confirmed at 685, so for each candidate inherit we strip
// inherit·vPlayer off the measured v0 and check whether the remainder's magnitude
// lands on 685. The inherit that makes the remainder cluster tightest on 685 —
// across jumpthrows, where vPlayer is large — is the real one, no landing sim.
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = join(ROOT, 'tools/demo-data');
const TICK = 1 / 64;
const GN = 800 * 0.4; // grenade gravity

// Load and pair up every demo's throws with their trajectories.
const files = readdirSync(DATA).filter((f) => f.endsWith('.pairs.json'));
const all = [];
for (const pf of files) {
    const base = pf.replace('.pairs.json', '');
    const pairs = JSON.parse(readFileSync(join(DATA, pf), 'utf8'));
    const traj = JSON.parse(readFileSync(join(DATA, `${base}.traj.json`), 'utf8'));
    const byThrower = new Map();
    for (const t of traj) (byThrower.get(t.thrower) || byThrower.set(t.thrower, []).get(t.thrower)).push(t);
    for (const p of pairs) {
        const cands = byThrower.get(p.thrower) || [];
        let best = null;
        for (const t of cands) {
            const d = Math.abs(t.throw_tick - p.throw_tick);
            if (!best || d < best.d) best = { t, d };
        }
        if (best && best.d <= 6 && best.t.samples.length >= 4) all.push({ p, s: best.t.samples });
    }
}

// Real launch velocity: fit from the first few samples, correct back to release
// with grenade gravity. Trajectory is game coords (z up).
function launchVel(s) {
    const a = s[0], b = s[3];
    const dt = (b.tick - a.tick) * TICK;
    return {
        x: (b.x - a.x) / dt,
        y: (b.y - a.y) / dt,
        z: (b.z - a.z) / dt + GN * dt / 2, // correct to t=0
    };
}

const cat = (p) => (p.vz > 100 ? 'skok' : Math.hypot(p.vx, p.vy) > 5 ? 'kretanje' : 'stoji');
const rows = all.map(({ p, s }) => ({ p, v0: launchVel(s), cat: cat(p) }));
const med = (a) => { a.sort((x, y) => x - y); return a.length ? a[Math.floor(a.length / 2)] : NaN; };

console.log(`ukupno ${rows.length} bacanja iz ${files.length} demoa` +
    `   (skok ${rows.filter((r) => r.cat === 'skok').length},` +
    ` kretanje ${rows.filter((r) => r.cat === 'kretanje').length},` +
    ` stoji ${rows.filter((r) => r.cat === 'stoji').length})\n`);

// Sanity: standing throws have vPlayer~0, so |v0| should already sit on the
// three click speeds regardless of inherit.
console.log('|v0| stvarno po tipu:');
for (const c of ['stoji', 'kretanje', 'skok'])
    console.log(`  ${c.padEnd(9)} median ${med(rows.filter((r) => r.cat === c).map((r) => Math.hypot(r.v0.x, r.v0.y, r.v0.z))).toFixed(0)}`);

// Sweep inherit on jumpthrows: strip inherit·vPlayer, see if the remainder's
// speed clusters on one of the click speeds (685 / 480 / 275 for s=1/0.5/0).
const jumps = rows.filter((r) => r.cat === 'skok');
console.log(`\ninherit sweep na ${jumps.length} jumpthrowova (ostatak nakon skidanja inherit·vPlayer):`);
console.log('inherit   median |ostatak|   koliko blizu 685(±40)');
for (let vi = 0.8; vi <= 1.6001; vi += 0.1) {
    const rem = jumps.map((r) => Math.hypot(
        r.v0.x - vi * r.p.vx, r.v0.y - vi * r.p.vy, r.v0.z - vi * r.p.vz));
    const near = rem.filter((x) => Math.abs(x - 685) <= 40).length;
    console.log(`  ${vi.toFixed(1)}       ${med(rem).toFixed(0).padStart(4)}              ${near}/${jumps.length}`);
}
