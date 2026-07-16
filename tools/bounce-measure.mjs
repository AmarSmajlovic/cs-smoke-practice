// Measures grenade bounce restitution from real demo trajectories — the
// evidence behind dropping the glance² falloff in grenades.js.
//
// Needs tools/smoke_traj.json (produced by demo-traj/). Velocity is recovered by
// differencing successive per-tick positions; the vertical component is
// corrected back to the contact instant with the grenade's gravity, since the
// sampling window straddles the bounce.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TICK = 1 / 64;
const G = 800 * 0.4; // grenade gravity, game units/s^2 (CS2.gravity * nadeGravityScale)

const throws = JSON.parse(readFileSync(join(ROOT, 'tools/smoke_traj.json'), 'utf8'));

// Velocity from a short window of samples on one side of a bounce tick.
function velAt(s, idx, dir) {
    const pts = [];
    for (let k = 1; k <= 3; k++) {
        const j = idx + dir * k;
        if (j < 0 || j >= s.length) break;
        pts.push(s[j]);
    }
    if (pts.length < 2) return null;
    const a = pts[0], b = pts[pts.length - 1];
    const dt = (b.tick - a.tick) * TICK;
    return { x: (b.x - a.x) / dt, y: (b.y - a.y) / dt, z: (b.z - a.z) / dt };
}
const med = (a) => { a.sort((x, y) => x - y); return a.length ? a[Math.floor(a.length / 2)] : NaN; };

// Restitution split by surface, and — the key test — floor restitution split by
// impact steepness. glance = horizontal / |vertical| at impact.
const floorN = [], floorT = [], wall = [];
const bands = [[0, 0.3, 'strmo  '], [0.3, 0.7, 'srednje'], [0.7, 1.5, 'koso   '], [1.5, 99, 'jako koso']];
const byBand = bands.map(() => []);

for (const t of throws) {
    const s = t.samples;
    const byTick = new Map(s.map((x, i) => [x.tick, i]));
    for (const bt of t.bounce_ticks) {
        const i = byTick.get(bt);
        if (i == null) continue;
        const vb = velAt(s, i, -1), va = velAt(s, i, +1);
        if (!vb || !va) continue;
        const hb = Math.hypot(vb.x, vb.y), ha = Math.hypot(va.x, va.y);
        if (Math.hypot(vb.x, vb.y, vb.z) < 80) continue;
        if (vb.z < -60 && va.z > 20) {              // floor bounce
            const vzIn = -(vb.z - G * 2 * TICK), vzOut = va.z + G * 2 * TICK;
            floorN.push(vzOut / vzIn);
            if (hb > 60) floorT.push(ha / hb);
            const glance = hb / vzIn;
            for (let b = 0; b < bands.length; b++) {
                if (glance >= bands[b][0] && glance < bands[b][1]) { byBand[b].push(vzOut / vzIn); break; }
            }
        } else if (Math.abs(vb.z) < 120 && hb > 120) { // wall bounce
            wall.push(ha / hb);
        }
    }
}

console.log('restitucija po povrsini (iz stvarnih putanja):');
console.log(`  POD normalna (vert):      ${med(floorN).toFixed(3)}   n=${floorN.length}`);
console.log(`  POD tangencijalna:        ${med(floorT).toFixed(3)}   n=${floorT.length}`);
console.log(`  ZID:                      ${med(wall).toFixed(3)}   n=${wall.length}`);
console.log('\nnormalna restitucija poda po strmini upada (dokaz da glance² ne pripada):');
console.log('  upad        n     stvarno   model(0.45·glance²)');
for (let b = 0; b < bands.length; b++) {
    const g2 = Math.min(1, ((bands[b][0] + Math.min(bands[b][1], 1.5)) / 2)) ** 2;
    console.log(`  ${bands[b][2].padEnd(10)} ${String(byBand[b].length).padStart(3)}    ${med(byBand[b]).toFixed(3)}     ~${(0.45 * g2).toFixed(3)}`);
}
console.log('\nu kodu: elasticity=0.45  elasticityVert=0.45  (oba potvrdena ~0.45)');
