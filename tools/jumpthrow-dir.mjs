// Launch magnitude for jumpthrows checks out at inherit ~1.3, but landing still
// misses — so the error must be in launch DIRECTION or downstream. This strips
// inherit·vPlayer off the measured launch and asks whether the remaining 685
// vector points where the view + pitch bias say it should. If the bias matches
// standing throws, the launch is right and the miss is downstream (long high
// arcs amplifying tiny errors); if it's wild, the direction model is wrong.
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = join(ROOT, 'tools/demo-data');
const TICK = 1 / 64, GN = 800 * 0.4, INHERIT = 1.3;

const all = [];
for (const pf of readdirSync(DATA).filter((f) => f.endsWith('.pairs.json'))) {
    const base = pf.replace('.pairs.json', '');
    const pairs = JSON.parse(readFileSync(join(DATA, pf), 'utf8'));
    const traj = JSON.parse(readFileSync(join(DATA, `${base}.traj.json`), 'utf8'));
    const byT = new Map();
    for (const t of traj) (byT.get(t.thrower) || byT.set(t.thrower, []).get(t.thrower)).push(t);
    for (const p of pairs) {
        let best = null;
        for (const t of byT.get(p.thrower) || []) {
            const d = Math.abs(t.throw_tick - p.throw_tick);
            if (!best || d < best.d) best = { t, d };
        }
        if (best && best.d <= 6 && best.t.samples.length >= 4) all.push({ p, s: best.t.samples });
    }
}

function launchVel(s) {
    const a = s[0], b = s[3], dt = (b.tick - a.tick) * TICK;
    return { x: (b.x - a.x) / dt, y: (b.y - a.y) / dt, z: (b.z - a.z) / dt + GN * dt / 2 };
}
const cat = (p) => (p.vz > 100 ? 'skok' : Math.hypot(p.vx, p.vy) > 5 ? 'kretanje' : 'stoji');
const med = (a) => { a.sort((x, y) => x - y); return a.length ? a[Math.floor(a.length / 2)] : NaN; };
const deg = (r) => r * 180 / Math.PI;

console.log(`inherit ${INHERIT}: ostatak launch − inherit·vPlayer, njegov smjer vs pogled\n`);
console.log('tip        n    view pitch   launch pitch   BIAS    yaw greska');
for (const c of ['stoji', 'kretanje', 'skok']) {
    const set = all.filter((r) => cat(r.p) === c);
    const bias = [], yawErr = [];
    for (const { p, s } of set) {
        const v0 = launchVel(s);
        const r = { x: v0.x - INHERIT * p.vx, y: v0.y - INHERIT * p.vy, z: v0.z - INHERIT * p.vz };
        const horiz = Math.hypot(r.x, r.y);
        bias.push(deg(Math.atan2(r.z, horiz)) - (-p.pitch));       // launch pitch − view pitch(up)
        // demo yaw: atan2(vy,vx) game; residual horizontal dir vs view yaw
        let dy = deg(Math.atan2(r.y, r.x)) - p.yaw;
        while (dy > 180) dy -= 360; while (dy < -180) dy += 360;
        yawErr.push(Math.abs(dy));
    }
    console.log(`${c.padEnd(9)} ${String(set.length).padStart(3)}    ${med(set.map((r) => -r.p.pitch)).toFixed(1).padStart(6)}` +
        `       ${(med(bias) + med(set.map((r) => -r.p.pitch))).toFixed(1).padStart(6)}      ${med(bias).toFixed(1).padStart(5)}    ${med(yawErr).toFixed(1)}°`);
}
