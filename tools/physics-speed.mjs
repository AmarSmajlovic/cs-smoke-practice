// Draws the throw-speed curve out of the demo instead of assuming one.
//
// computeThrow uses speed = throwSpeed * (0.3 + 0.7 * strength), so throwSpeed
// and strength are the same knob: sweeping effective speed at strength 1 covers
// every click type at once, which also removes strength as a free parameter —
// the sweep finds the speed the grenade actually had, whatever the player pressed.
//
// For each throw, find the speed that lands the grenade on the real detonation.
// If the shipped model is right, those speeds cluster at 685 / 343 / 206 (the
// three click strengths) no matter where the player aimed. If Source scales
// speed by pitch, they trace a curve instead.
import { buildHarness, throwFrom, simulateToRest, pct } from './harness.mjs';
import { tuning } from '../physicsConfig.js';

const SPEEDS = [];
for (let v = 150; v <= 1000; v += 10) SPEEDS.push(v);

// Only a throw we can actually land counts as a reading. If no speed puts the
// grenade near the real smoke, something other than speed is wrong with it and
// its argmin is meaningless — including it would just add noise to the curve.
const ACCEPT = 60;

const { grenades, pairs } = await buildHarness();
const base = tuning.throwSpeed;

const t0 = performance.now();
const rows = [];
for (const p of pairs) {
    const { eye, vel, fwdH, want } = throwFrom(p, 0);
    let best = null;
    for (const v of SPEEDS) {
        tuning.throwSpeed = v;
        const err = simulateToRest(grenades, eye, fwdH, p.pitch, 1.0, vel).distanceTo(want);
        if (!best || err < best.err) best = { err, v };
    }
    rows.push({ pitch: p.pitch, dist: p.dist, ...best });
}
tuning.throwSpeed = base;

const good = rows.filter((r) => r.err <= ACCEPT);
console.log(`${SPEEDS.length} brzina x ${pairs.length} bacanja u ${((performance.now() - t0) / 1000).toFixed(1)}s`);
console.log(`upotrebljivih (greska <= ${ACCEPT}u pri najboljoj brzini): ${good.length}/${rows.length}\n`);

console.log('IMPLICIRANA BRZINA po uglu gledanja:');
console.log('pitch        n   median   raspon');
for (const [lo, hi] of [[-90, -40], [-40, -25], [-25, -15], [-15, -5], [-5, 5], [5, 90]]) {
    const v = good.filter((r) => r.pitch >= lo && r.pitch < hi).map((r) => r.v).sort((a, b) => a - b);
    if (!v.length) continue;
    console.log(`${String(lo).padStart(4)}..${String(hi).padStart(3)}  ${String(v.length).padStart(3)}` +
        `   ${pct(v, 0.5).toFixed(0).padStart(5)}    ${v[0]}-${v[v.length - 1]}`);
}

// If the model is right the readings pile up on the three click speeds; if the
// speed is really a function of pitch they spread out instead.
console.log('\nhistogram impliciranih brzina (ocekivano ako je model tacan: 206 / 343 / 685):');
for (let lo = 150; lo < 1000; lo += 50) {
    const n = good.filter((r) => r.v >= lo && r.v < lo + 50).length;
    if (n) console.log(`  ${String(lo).padStart(4)}-${String(lo + 49).padStart(4)}  ${'#'.repeat(n)} ${n}`);
}
