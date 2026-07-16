// Measures the two jumpthrow parameters against real CS2 demo throws instead of
// guessing them. Both only bite while the thrower is airborne, so they are fitted
// on the jump subset alone; standing throws carry no information about either.
//
// Two parameters against 30 independent throws is a well-determined fit, not a
// curve-fitting exercise — but the result is only trustworthy if the minimum is
// a basin rather than a spike, so the sweep prints the neighbourhood.
import { buildHarness, bestError, category, pct } from './harness.mjs';
import { tuning } from '../physicsConfig.js';

const range = (a, b, step) => {
    const out = [];
    for (let v = a; v <= b + 1e-9; v += step) out.push(+v.toFixed(4));
    return out;
};

const RELEASE = range(0, 0.30, 0.0125);
const INHERIT = range(0.6, 1.4, 0.05);

const score = (grenades, set, release) => {
    const errs = set.map((p) => bestError(grenades, p, release).err).sort((a, b) => a - b);
    return { median: pct(errs, 0.5), hit: errs.filter((e) => e <= 50).length / errs.length };
};

const { grenades, pairs } = await buildHarness();
const jumps = pairs.filter((p) => category(p) === 'skok');
console.log(`fitting release + velInherit on ${jumps.length} real jumpthrows\n`);

const t0 = performance.now();
let best = null;
for (const vi of INHERIT) {
    tuning.velInherit = vi;
    for (const rel of RELEASE) {
        const s = score(grenades, jumps, rel);
        if (!best || s.median < best.median) best = { ...s, vi, rel };
    }
}
console.log(`swept ${INHERIT.length * RELEASE.length} combos in ${((performance.now() - t0) / 1000).toFixed(1)}s`);
console.log(`\nNAJBOLJE: velInherit=${best.vi}  release=${best.rel}s` +
            `  -> median ${best.median.toFixed(0)}u   <=50u: ${(100 * best.hit).toFixed(0)}%`);
console.log(`(sada u kodu: velInherit=1.25  release=0.125s)`);

// A real physical constant sits in a basin; a spike means we fitted noise.
console.log('\nokolina optimuma (median HU) — redovi velInherit, kolone release:');
const cols = RELEASE.filter((r) => Math.abs(r - best.rel) <= 0.05);
console.log('        ' + cols.map((c) => c.toFixed(4).padStart(7)).join(''));
for (const vi of INHERIT.filter((v) => Math.abs(v - best.vi) <= 0.15)) {
    tuning.velInherit = vi;
    const row = cols.map((rel) => score(grenades, jumps, rel).median.toFixed(0).padStart(7)).join('');
    console.log(vi.toFixed(2).padStart(6) + '  ' + row);
}
