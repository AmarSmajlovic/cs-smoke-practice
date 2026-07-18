// Hypothesis: CS2 caps the grenade's total launch speed. Forward-running
// jumpthrows (675 + 1.25*245 aligned) would clip hard; sideways/slow ones
// barely. Sweep the cap and watch each cohort.
// Usage: node tools/wjt-cap.mjs
import * as THREE from 'three';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildHarness, toApp, throwFrom, STRENGTHS, pct } from './harness.mjs';
import { CS2 } from '../physicsConfig.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = join(ROOT, 'tools/demo-data');
const { grenades } = await buildHarness();

const all = [];
for (const pf of readdirSync(DATA).filter((f) => f.endsWith('.pairs.json')))
    all.push(...JSON.parse(readFileSync(join(DATA, pf), 'utf8')));

const _pos = new THREE.Vector3(), _v = new THREE.Vector3();
function bestErr(p, cap) {
    const { eye, vel, fwdH, want } = throwFrom(p, 0);
    let best = Infinity;
    for (const s of STRENGTHS) {
        grenades.computeThrow(eye.clone(), fwdH, p.pitch, s, vel, _pos, _v);
        if (cap && _v.length() > cap) _v.setLength(cap);
        const nade = { position: _pos, velocity: _v, rolling: false, age: 0 };
        while (grenades.stepProjectile(nade, CS2.TICK, false));
        best = Math.min(best, _pos.distanceTo(want));
    }
    return best;
}

const h = (p) => Math.hypot(p.vx, p.vy);
const COHORTS = [
    ['JT trci (h>120)', all.filter((p) => p.vz > 100 && h(p) > 120)],
    ['JT hoda (30-120)', all.filter((p) => p.vz > 100 && h(p) >= 30 && h(p) <= 120)],
    ['JT stoji (h<30)', all.filter((p) => p.vz > 100 && h(p) < 30)],
    ['zemlja trci (h>120)', all.filter((p) => p.vz <= 100 && h(p) > 120)],
    ['zemlja hoda (30-120)', all.filter((p) => p.vz <= 100 && h(p) >= 30 && h(p) <= 120)],
    ['stoji', all.filter((p) => p.vz <= 100 && h(p) < 30)],
];

console.log('cohort'.padEnd(22) + ['none', '1050', '1000', '950', '900', '850', '800'].map((c) => c.padStart(10)).join(''));
for (const [name, list] of COHORTS) {
    if (!list.length) continue;
    const cells = [null, 1050, 1000, 950, 900, 850, 800].map((cap) => {
        const e = list.map((p) => bestErr(p, cap)).sort((a, b) => a - b);
        return `${pct(e, 0.5).toFixed(0)}u`.padStart(10);
    });
    console.log(`${name.padEnd(22)}${cells.join('')}  (n=${list.length})`);
}
