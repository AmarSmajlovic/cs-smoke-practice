// computeThrow treats throw speed as constant, scaled only by click strength.
// Checks whether the residual depends on aim pitch — if it does, the missing
// term is in the speed model, and the jumpthrow failures are a symptom (players
// aim high when they jumpthrow) rather than a jump problem at all.
import { buildHarness, throwFrom, simulateToRest, STRENGTHS, pct } from './harness.mjs';

const { grenades, pairs } = await buildHarness();

const rows = pairs.map((p) => {
    const { eye, vel, fwdH, want } = throwFrom(p, 0);
    let best = null;
    for (const s of STRENGTHS) {
        const err = simulateToRest(grenades, eye, fwdH, p.pitch, s, vel).distanceTo(want);
        if (!best || err < best.err) best = { err, s };
    }
    return { pitch: p.pitch, err: best.err, s: best.s };
});

console.log('greska po uglu gledanja (pitch < 0 = gleda gore):\n');
console.log('pitch        n   median   p90    <=50u');
const bands = [[-90, -40], [-40, -25], [-25, -15], [-15, -5], [-5, 5], [5, 90]];
for (const [lo, hi] of bands) {
    const e = rows.filter((r) => r.pitch >= lo && r.pitch < hi).map((r) => r.err).sort((a, b) => a - b);
    if (!e.length) continue;
    console.log(`${String(lo).padStart(4)}..${String(hi).padStart(3)}  ${String(e.length).padStart(3)}` +
        `   ${pct(e, 0.5).toFixed(0).padStart(5)}u ${pct(e, 0.9).toFixed(0).padStart(5)}u` +
        `   ${(100 * e.filter((x) => x <= 50).length / e.length).toFixed(0).padStart(3)}%`);
}

// Rank correlation between how high they aimed and how wrong we are. Spearman
// rather than Pearson: the relationship needs to be monotonic, not linear, and
// a few huge outliers should not carry it.
const rank = (vals) => {
    const idx = vals.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
    const r = new Array(vals.length);
    idx.forEach(([, i], k) => { r[i] = k; });
    return r;
};
const a = rank(rows.map((r) => -r.pitch)); // higher = aimed further up
const b = rank(rows.map((r) => r.err));
const n = rows.length;
const d2 = a.reduce((s, v, i) => s + (v - b[i]) ** 2, 0);
console.log(`\nSpearman (gleda vise <-> veca greska): rho = ${(1 - 6 * d2 / (n * (n * n - 1))).toFixed(2)}`);
