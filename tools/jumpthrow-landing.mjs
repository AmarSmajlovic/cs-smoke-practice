// Jumpthrow landing error across all demos, swept over velInherit — using each
// throw's REAL player velocity from the demo (not the app's scripted jump).
//
// The launch-speed measurement said inherit ~1.3 reproduces the real launch
// magnitude. This asks the question that actually matters: does that also land
// the smoke where CS2 put it, or is the remaining jumpthrow error in direction /
// downstream (bounce, roll) rather than launch?
import { buildHarness, loadAllPairs, throwFrom, simulateToRest, STRENGTHS, category, pct } from './harness.mjs';
import { tuning } from '../physicsConfig.js';

const { grenades } = await buildHarness();
const pairs = loadAllPairs();
const jumps = pairs.filter((p) => category(p) === 'skok');
const flat = pairs.filter((p) => category(p) !== 'skok');
console.log(`${pairs.length} bacanja, ${jumps.length} jumpthrowova\n`);

function errStats(set, vi) {
    tuning.velInherit = vi;
    const errs = set.map((p) => {
        const { eye, vel, fwdH, want } = throwFrom(p, 0);
        let best = Infinity;
        for (const s of STRENGTHS)
            best = Math.min(best, simulateToRest(grenades, eye, fwdH, p.pitch, s, vel).distanceTo(want));
        return best;
    }).sort((a, b) => a - b);
    return { median: pct(errs, 0.5), p90: pct(errs, 0.9), hit: errs.filter((e) => e <= 50).length / errs.length };
}

// The grenade leaves the hand `release` seconds after the event; throwFrom
// advances the thrower along their own arc by that much before launching. With
// inherit fixed at the measured 1.3, sweep release to find what lands jumpthrows.
function errStatsR(set, release) {
    tuning.velInherit = 1.3;
    const errs = set.map((p) => {
        const { eye, vel, fwdH, want } = throwFrom(p, release);
        let best = Infinity;
        for (const s of STRENGTHS)
            best = Math.min(best, simulateToRest(grenades, eye, fwdH, p.pitch, s, vel).distanceTo(want));
        return best;
    }).sort((a, b) => a - b);
    return { median: pct(errs, 0.5), p90: pct(errs, 0.9), hit: errs.filter((e) => e <= 50).length / errs.length };
}

console.log('release(s)   jumpthrow median   p90    <=50u    (inherit fiksno 1.3)');
for (let rel = 0; rel <= 0.20001; rel += 0.025) {
    const s = errStatsR(jumps, rel);
    console.log(`  ${rel.toFixed(3)}        ${s.median.toFixed(0).padStart(4)}u          ${s.p90.toFixed(0).padStart(4)}u   ${(100 * s.hit).toFixed(0)}%`);
}
console.log('\nkontrola — bacanja iz mjesta/kretanja pri istom release:');
for (const rel of [0, 0.1]) {
    const s = errStatsR(flat, rel);
    console.log(`  release ${rel}: median ${s.median.toFixed(0)}u  <=50u ${(100 * s.hit).toFixed(0)}%`);
}
