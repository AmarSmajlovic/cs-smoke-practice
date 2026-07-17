// Is grenade restitution constant across IMPACT SPEED? The roof hit on the
// "Jungle from Back Alley" lineup comes in at ~965 u/s — far hotter than a
// typical bounce — and the sim keeps too much energy there. Bin the real demo
// bounces by impact speed and report tangential + normal retention per bin.
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = join(ROOT, 'tools/demo-data');
const TICK = 1 / 64;
const G = 800 * 0.4;

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
    if (!dt) return null;
    return { x: (b.x - a.x) / dt, y: (b.y - a.y) / dt, z: (b.z - a.z) / dt };
}
const med = (a) => { a.sort((x, y) => x - y); return a.length ? a[Math.floor(a.length / 2)] : NaN; };

const BIN_BY_VZ = process.argv[2] === 'vz';
const bins = BIN_BY_VZ
    ? [[60, 200], [200, 350], [350, 500], [500, 650], [650, 1200]]
    : [[0, 300], [300, 450], [450, 600], [600, 750], [750, 1200]];
const tang = bins.map(() => []), norm = bins.map(() => []), hops = bins.map(() => []);

for (const tf of readdirSync(DATA).filter((f) => f.endsWith('.traj.json'))) {
    for (const t of JSON.parse(readFileSync(join(DATA, tf), 'utf8'))) {
        const s = t.samples;
        if (!t.bounce_ticks) continue;
        const byTick = new Map(s.map((x, i) => [x.tick, i]));
        for (const bt of t.bounce_ticks) {
            const i = byTick.get(bt);
            if (i == null) continue;
            // ISOLATED bounces only: another contact within the +-4-tick
            // sampling window corrupts the after-velocity (reads the second
            // bounce's slowdown as the first one's restitution)
            if (t.bounce_ticks.some((o) => o !== bt && Math.abs(o - bt) <= 8)) continue;
            const vb = velAt(s, i, -1), va = velAt(s, i, +1);
            if (!vb || !va) continue;
            const speedIn = Math.hypot(vb.x, vb.y, vb.z);
            if (speedIn < 80) continue;
            // floor bounces only: coming down, going up
            if (!(vb.z < -60 && va.z > 20)) continue;
            const vzIn = -(vb.z - G * 2 * TICK), vzOut = va.z + G * 2 * TICK;
            const hIn = Math.hypot(vb.x, vb.y), hOut = Math.hypot(va.x, va.y);
            const key = BIN_BY_VZ ? vzIn : speedIn;
            const bi = bins.findIndex(([lo, hi]) => key >= lo && key < hi);
            if (bi < 0) continue;
            if (hIn > 20) tang[bi].push(hOut / hIn);
            if (vzIn > 60) norm[bi].push(vzOut / vzIn);
            hops[bi].push(vzOut); // absolute rebound, to see the cap
        }
    }
}
console.log('restitucija po BRZINI UDARA (podni odskoci, svi demoi):');
for (let i = 0; i < bins.length; i++) {
    console.log(`  ${String(bins[i][0]).padStart(4)}-${String(bins[i][1]).padEnd(4)} u/s  n=${String(tang[i].length).padStart(3)}   tang ${med(tang[i]).toFixed(2)}   norm ${med(norm[i]).toFixed(2)}   vzOut med ${med(hops[i]).toFixed(0)}`);
}
