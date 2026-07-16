// Asks which way the simulation is wrong, rather than searching for parameters
// that make the error smaller. A blind sweep over velInherit/release produced a
// noisy surface with no basin, which means those two are not the cause — so
// look at the sign and shape of the residual instead.
import * as THREE from 'three';
import { buildHarness, throwFrom, simulateToRest, STRENGTHS, category, pct } from './harness.mjs';

const { grenades, pairs } = await buildHarness();

// Range along the throw's own horizontal direction: does the sim land long or
// short, and by how much relative to how far the throw actually went?
const along = (from, to, fwd) =>
    new THREE.Vector3(to.x - from.x, 0, to.z - from.z).dot(fwd);

console.log('vrsta      n   sim/real domet   lateralno   visina(sim-real)');
for (const c of ['stoji', 'kretanje', 'skok']) {
    const set = pairs.filter((p) => category(p) === c);
    const ratio = [], lat = [], dy = [];
    for (const p of set) {
        const { eye, vel, fwdH, want } = throwFrom(p, 0);
        let best = null;
        for (const s of STRENGTHS) {
            const got = simulateToRest(grenades, eye, fwdH, p.pitch, s, vel).clone();
            const err = got.distanceTo(want);
            if (!best || err < best.err) best = { err, got };
        }
        const rReal = along(eye, want, fwdH), rSim = along(eye, best.got, fwdH);
        if (Math.abs(rReal) > 100) ratio.push(rSim / rReal);
        const side = new THREE.Vector3(-fwdH.z, 0, fwdH.x);
        lat.push(Math.abs(along(want, best.got, side)));
        dy.push(best.got.y - want.y);
    }
    const s = (a) => [...a].sort((x, y) => x - y);
    console.log(`${c.padEnd(9)} ${String(set.length).padStart(2)}` +
        `      ${pct(s(ratio), 0.5).toFixed(2).padStart(5)}x` +
        `        ${pct(s(lat), 0.5).toFixed(0).padStart(4)}u` +
        `      ${pct(s(dy), 0.5).toFixed(0).padStart(5)}u`);
}

// If the smoke bounced off a player CS2 had and we do not, the sim keeps flying
// and lands long. That would show up as real throws being systematically shorter.
console.log('\nsim/real domet po jumpthrowu (1.00 = tacno):');
const jumps = pairs.filter((p) => category(p) === 'skok');
const rows = jumps.map((p) => {
    const { eye, vel, fwdH, want } = throwFrom(p, 0);
    let best = null;
    for (const s of STRENGTHS) {
        const got = simulateToRest(grenades, eye, fwdH, p.pitch, s, vel).clone();
        const err = got.distanceTo(want);
        if (!best || err < best.err) best = { err, got, s };
    }
    return { p, ...best, rReal: along(eye, want, fwdH), rSim: along(eye, best.got, fwdH) };
}).sort((a, b) => a.rSim / a.rReal - b.rSim / b.rReal);
for (const r of rows) {
    console.log(`  ${(r.rSim / r.rReal).toFixed(2).padStart(6)}x  err ${r.err.toFixed(0).padStart(4)}u` +
        `  s=${r.s}  real ${r.rReal.toFixed(0).padStart(5)}u  sim ${r.rSim.toFixed(0).padStart(5)}u` +
        `  vz ${r.p.vz.toFixed(0)}  pitch ${r.p.pitch.toFixed(0)}`);
}
