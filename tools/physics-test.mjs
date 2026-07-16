// Headless physics regression harness.
//
// Ground truth comes from real CS2 pro demos: `grenade_thrown` gives the
// thrower's position, view angles and velocity; `smokegrenade_detonate` gives
// where the smoke actually popped. tools/demo-extract.py joins them into
// mirage_pairs.json. Nothing here re-implements physics — it drives the very
// same GrenadeSystem and MapLoader the browser runs, so a green run means the
// shipped code is right, not a copy of it.
//
// The one input the demo does not carry is throw strength (left/right/both
// click), so each pair is simulated at every strength and scored on the best.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { MapLoader } from '../mapLoader.js';
import { GrenadeSystem } from '../grenades.js';
import { CS2 } from '../physicsConfig.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// CS2 throw strengths: left click, both, right click. computeThrow maps these
// through speed = throwSpeed * (0.3 + 0.7 * strength).
const STRENGTHS = [1.0, 0.5, 0.0];

// Source is Z-up with x forward; ours is Y-up. Mapping verified in main.js's
// setpos import: our x = game y, our z = game x, height identical.
const toApp = (x, y, z) => new THREE.Vector3(y, z, x);

async function parseGlb(path) {
    const buf = readFileSync(path);
    const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    return new Promise((res, rej) => loader.parse(ab, '', (g) => res(g.scene), rej));
}

// Run one throw to rest and return where the grenade stopped — this is what
// CS2's smokegrenade_detonate reports, so first-touch would be the wrong thing
// to compare against.
function simulateToRest(grenades, eye, fwdH, pitchDeg, strength, playerVel) {
    const pos = new THREE.Vector3(), vel = new THREE.Vector3();
    grenades.computeThrow(eye, fwdH, pitchDeg, strength, playerVel, pos, vel);
    const nade = { position: pos, velocity: vel, rolling: false, age: 0 };
    while (grenades.stepProjectile(nade, CS2.TICK, false)) { /* until at rest */ }
    return pos;
}

const pct = (a, p) => a[Math.min(a.length - 1, Math.floor(a.length * p))];

async function main() {
    const scene = new THREE.Scene();
    const mapLoader = new MapLoader(scene);
    const t0 = performance.now();
    mapLoader.buildGameCollisionFromRoot(await parseGlb(join(ROOT, 'public/maps/mirage-collision.glb')));
    console.log(`collision ready in ${(performance.now() - t0).toFixed(0)}ms`);

    const grenades = new GrenadeSystem(scene, mapLoader);
    const pairs = JSON.parse(readFileSync(join(ROOT, 'tools/mirage_pairs.json'), 'utf8'));

    const results = [];
    const tSim = performance.now();
    for (const p of pairs) {
        // Jumpthrows release 0.1225s after the jump input, not at the
        // grenade_thrown event tick — walk the arc to the release moment
        // (same reconstruction as harness.mjs throwFrom).
        let px = p.px, py = p.py, pz = p.pz, vz = p.vz;
        if (p.vz > 100 && p.vz < CS2.jumpImpulse) {
            const vzRel = CS2.jumpImpulse - CS2.gravity * CS2.jumpthrowReleaseTime;
            const dt = (vzRel - p.vz) / CS2.gravity;
            px -= p.vx * dt;
            py -= p.vy * dt;
            pz -= (p.vz + vzRel) * 0.5 * dt;
            vz = vzRel;
        }
        const eye = toApp(px, py, pz).setY(pz + CS2.eyeStand);
        const vel = toApp(p.vx, p.vy, vz);
        const want = toApp(p.dx, p.dy, p.dz);
        const yaw = THREE.MathUtils.degToRad(p.yaw);
        const fwdH = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));

        let best = null;
        for (const s of STRENGTHS) {
            const got = simulateToRest(grenades, eye, fwdH, p.pitch, s, vel);
            const err = got.distanceTo(want);
            if (!best || err < best.err) best = { err, s, got: got.clone() };
        }
        results.push({ ...p, ...best });
    }
    const errs = results.map((r) => r.err).sort((a, b) => a - b);

    console.log(`\n${pairs.length} throws simulated in ${(performance.now() - tSim).toFixed(0)}ms\n`);
    console.log('greska (HU) do stvarne CS2 detonacije:');
    console.log(`  median ${pct(errs, 0.5).toFixed(0)}   p75 ${pct(errs, 0.75).toFixed(0)}` +
                `   p90 ${pct(errs, 0.9).toFixed(0)}   max ${errs[errs.length - 1].toFixed(0)}`);
    for (const t of [50, 100, 144, 300]) {
        const n = errs.filter((e) => e <= t).length;
        console.log(`  <= ${String(t).padStart(3)}u : ${String(n).padStart(3)}/${errs.length}  (${(100 * n / errs.length).toFixed(0)}%)`);
    }
    console.log('\nizabrana jacina:', STRENGTHS.map((s) =>
        `${s}: ${results.filter((r) => r.s === s).length}`).join('   '));

    // Splits the honest question: is the physics wrong, or is our reconstruction
    // of the throw wrong? A standing, still throw has almost nothing to
    // reconstruct — if those are tight and moving/jumping ones are not, the
    // physics is fine and the input model is what needs work.
    const cat = (r) => (r.vz > 100 ? 'skok    ' : Math.hypot(r.vx, r.vy) > 5 ? 'kretanje' : 'stoji   ');
    console.log('\ngreska po vrsti bacanja:');
    for (const c of ['stoji   ', 'kretanje', 'skok    ']) {
        const e = results.filter((r) => cat(r) === c).map((r) => r.err).sort((a, b) => a - b);
        if (!e.length) continue;
        console.log(`  ${c} n=${String(e.length).padStart(3)}  median ${pct(e, 0.5).toFixed(0).padStart(4)}u` +
                    `  p90 ${pct(e, 0.9).toFixed(0).padStart(4)}u   <=50u: ${(100 * e.filter((x) => x <= 50).length / e.length).toFixed(0)}%`);
    }

    console.log('\n10 najboljih:');
    for (const r of [...results].sort((a, b) => a.err - b.err).slice(0, 10)) {
        console.log(`  ${r.err.toFixed(0).padStart(4)}u  s=${r.s}  ${r.thrower}  tick ${r.throw_tick}  domet ${r.dist.toFixed(0)}u`);
    }
    console.log('\n5 najgorih:');
    for (const r of [...results].sort((a, b) => b.err - a.err).slice(0, 5)) {
        console.log(`  ${r.err.toFixed(0).padStart(4)}u  s=${r.s}  ${r.thrower}  tick ${r.throw_tick}  domet ${r.dist.toFixed(0)}u`);
    }
}

main();
