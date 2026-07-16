// Counts how many demo throws are unusable as ground truth because their path
// crosses another player — an interaction CS2 has and the trainer deliberately
// does not. Reports the split by throw type and what removing them does to the
// error, which is the test of whether "players blocked it" actually explains the
// outliers or is just a story that fits.
import { buildHarness, loadPlayers, othersAt, pathHitsPlayer, simulateToRest,
         throwFrom, STRENGTHS, category, pct } from './harness.mjs';

const { grenades, pairs } = await buildHarness();
const players = loadPlayers();

const rows = pairs.map((p) => {
    const { eye, vel, fwdH, want } = throwFrom(p, 0);
    const others = othersAt(players, p);
    let best = null;
    for (const s of STRENGTHS) {
        const path = [];
        const got = simulateToRest(grenades, eye, fwdH, p.pitch, s, vel, path).clone();
        const err = got.distanceTo(want);
        if (!best || err < best.err) best = { err, s, path };
    }
    return { p, err: best.err, blocked: pathHitsPlayer(best.path, others), cat: category(p) };
});

const stat = (set) => {
    const e = set.map((r) => r.err).sort((a, b) => a - b);
    return e.length ? `median ${pct(e, 0.5).toFixed(0).padStart(4)}u  p90 ${pct(e, 0.9).toFixed(0).padStart(4)}u` +
        `  <=50u ${(100 * e.filter((x) => x <= 50).length / e.length).toFixed(0).padStart(3)}%` : '-';
};

const bad = rows.filter((r) => r.blocked);
console.log(`KONTAMINIRANO (putanja prolazi kroz igraca): ${bad.length} / ${rows.length}\n`);
console.log('tip        ukupno  kontam.  cisto   greska na cistima');
for (const c of ['stoji', 'kretanje', 'skok']) {
    const all = rows.filter((r) => r.cat === c);
    const clean = all.filter((r) => !r.blocked);
    console.log(`${c.padEnd(10)} ${String(all.length).padStart(5)}` +
        `  ${String(all.filter((r) => r.blocked).length).padStart(6)}` +
        `  ${String(clean.length).padStart(5)}   ${stat(clean)}`);
}
const clean = rows.filter((r) => !r.blocked);
console.log(`\nSVE        ${String(rows.length).padStart(5)}  ${String(bad.length).padStart(6)}  ${String(clean.length).padStart(5)}   ${stat(clean)}`);
console.log(`prije filtera:                            ${stat(rows)}`);
console.log(`\nizbaceni (greska koju bi inace ganjali):  ${stat(bad)}`);
