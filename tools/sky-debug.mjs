// Where do the SIMULATED jumpthrows hit the sky mesh (real ones never do)?
// Prints per-jump: landing error, apex, and the first sim-path sky crossing.
import * as THREE from 'three';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildHarness, toApp, throwFrom, STRENGTHS } from './harness.mjs';
import { CS2 } from '../physicsConfig.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = join(ROOT, 'tools/demo-data');
const { grenades } = await buildHarness();
const map = grenades.mapLoader;

const pairs = [];
for (const pf of readdirSync(DATA).filter((f) => f.endsWith('.pairs.json')))
    pairs.push(...JSON.parse(readFileSync(join(DATA, pf), 'utf8')));
const jumps = pairs.filter((p) => p.vz > 100 && p.vz < CS2.jumpImpulse).slice(0, 40);

const _pos = new THREE.Vector3(), _v = new THREE.Vector3();
for (const p of jumps) {
    const { eye, vel, fwdH, want } = throwFrom(p, 0);
    let best = null;
    for (const s of STRENGTHS) {
        grenades.computeThrow(eye.clone(), fwdH, p.pitch, s, vel, _pos, _v);
        const nade = { position: _pos, velocity: _v, rolling: false, age: 0 };
        const path = [_pos.clone()];
        while (grenades.stepProjectile(nade, CS2.TICK, false)) path.push(_pos.clone());
        const err = _pos.distanceTo(want);
        if (!best || err < best.err) best = { err, s, path };
    }
    // find first sky contact along the path: check each point's surface via
    // a short raycast in the travel direction against nade collider groups
    let skyHit = null, apex = -1e9;
    for (let i = 1; i < best.path.length && !skyHit; i++) {
        const a = best.path[i - 1], b = best.path[i];
        apex = Math.max(apex, b.y);
        const d = b.clone().sub(a), len = d.length();
        if (len < 1e-3) continue;
        const hit = map.raycastNade(a, d.divideScalar(len), len + 2);
        if (hit && /sky/i.test(hit.surfaceGroup || '')) skyHit = hit.point;
    }
    console.log(`err ${best.err.toFixed(0).padStart(5)}u s=${best.s}  apex ${apex.toFixed(0).padStart(5)}  ` +
        (skyHit ? `SKY at game(${skyHit.z.toFixed(0)}, ${skyHit.x.toFixed(0)}, ${skyHit.y.toFixed(0)})` : '-'));
}
