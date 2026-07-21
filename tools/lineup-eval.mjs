// Per-map lineup accuracy eval — mirrors tools/physics-gate-test.mjs scoring
// but runs against the LIVE app's shipped collision for ANY map (startGame),
// so dust2/inferno are scored against their own geometry + all app-side fixups.
//
// Reads tools/demo-data/<map>/*.{pairs,traj,players}.json, replays every smoke
// throw, and reports median error + %<=50u (overall and by category), plus the
// worst offenders in game coords for targeted fixing.
//
// Usage: node tools/lineup-eval.mjs <dust2|inferno|mirage> [worstN]
import puppeteer from 'puppeteer-core';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MAP = process.argv[2] || 'dust2';
const WORST = +(process.argv[3] || 15);
const OUT = process.env.OUT_DIR || '/private/tmp/claude-501/-Users-amarsmajlovic-Desktop-smoke-practice-threejs/cfadb422-6a01-4775-a0b2-e4d5a00842b3/scratchpad';
const URL = process.env.APP_URL || 'http://localhost:5173';

// mirage lives flat in demo-data; dust2/inferno in subfolders
const DIR = MAP === 'mirage' ? join(ROOT, 'tools/demo-data') : join(ROOT, 'tools/demo-data', MAP);
const groups = [];
for (const pf of readdirSync(DIR).filter((f) => f.endsWith('.pairs.json'))) {
    const base = pf.replace('.pairs.json', '');
    const pairs = JSON.parse(readFileSync(join(DIR, pf), 'utf8'));
    const trajF = join(DIR, `${base}.traj.json`), plF = join(DIR, `${base}.players.json`);
    const traj = existsSync(trajF) ? JSON.parse(readFileSync(trajF, 'utf8')) : [];
    const players = existsSync(plF) ? JSON.parse(readFileSync(plF, 'utf8')) : [];
    groups.push({ base, pairs, traj, players });
}
console.log(`${MAP}: ${groups.length} demos, ${groups.reduce((a, g) => a + g.pairs.length, 0)} throws`);

const browser = await puppeteer.launch({
    headless: 'new', channel: 'chrome', protocolTimeout: 600000,
    userDataDir: `${OUT}/pptr-profile`,
    args: ['--no-sandbox', '--no-first-run', '--no-default-browser-check'],
});
const page = await browser.newPage();
await page.setViewport({ width: 900, height: 700 });
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => !!window.__debug, { timeout: 120000 });
await page.evaluate((m) => window.__debug.startGame(m), MAP);
await page.waitForFunction(() => window.__debug?.mapLoader?.nadeCollider, { timeout: 300000 });
await new Promise((r) => setTimeout(r, 1500));

const results = await page.evaluate((groups) => {
    const { THREE, CS2, grenades } = window.__debug;
    const TICK = 1 / 64, GN = 800 * CS2.nadeGravityScale;
    const STRENGTHS = [1.0, 0.5, 0.0];
    const toApp = (x, y, z) => new THREE.Vector3(y, z, x);

    function realLaunchDir(samples) {
        const i0 = 2, n = Math.min(6, samples.length - i0);
        if (n < 3) return null;
        const t0 = samples[i0].tick;
        let sT = 0, sTT = 0, sX = 0, sXT = 0, sY = 0, sYT = 0, sZ = 0, sZT = 0;
        for (let i = 0; i < n; i++) {
            const smp = samples[i0 + i];
            const t = (smp.tick - t0) * TICK;
            const zc = smp.z + 0.5 * GN * t * t;
            sT += t; sTT += t * t;
            sX += smp.x; sXT += smp.x * t;
            sY += smp.y; sYT += smp.y * t;
            sZ += zc; sZT += zc * t;
        }
        const den = n * sTT - sT * sT;
        return toApp((n * sXT - sT * sX) / den, (n * sYT - sT * sY) / den, (n * sZT - sT * sZ) / den).normalize();
    }
    const _eye = new THREE.Vector3(), _vel = new THREE.Vector3();
    function throwFrom(p, release) {
        _vel.set(p.vx, p.vy, p.vz); _eye.set(p.px, p.py, p.pz);
        if (p.vz > 100 && p.vz < CS2.jumpImpulse) {
            const vzRel = CS2.jumpImpulse - CS2.gravity * CS2.jumpthrowReleaseTime;
            const dt = (vzRel - p.vz) / CS2.gravity;
            _eye.x -= p.vx * dt; _eye.y -= p.vy * dt; _eye.z -= (p.vz + vzRel) * 0.5 * dt; _vel.z = vzRel;
        } else if (release > 0) {
            _eye.addScaledVector(_vel, release);
            _eye.z -= 0.5 * CS2.gravity * release * release; _vel.z -= CS2.gravity * release;
        }
        const eye = toApp(_eye.x, _eye.y, _eye.z); eye.y = _eye.z + CS2.eyeStand;
        const yaw = THREE.MathUtils.degToRad(p.yaw);
        return { eye, vel: toApp(_vel.x, _vel.y, _vel.z), fwdH: new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw)), want: toApp(p.dx, p.dy, p.dz) };
    }
    const PR = 16 + CS2.nadeRadius, PH = CS2.hullHeightStand;
    function pathHitsPlayer(path, others) {
        for (const pt of path) for (const o of others) {
            const dy = pt.y - o.y; if (dy < -CS2.nadeRadius || dy > PH) continue;
            if (Math.hypot(pt.x - o.x, pt.z - o.z) < PR) return true;
        }
        return false;
    }
    const _pos = new THREE.Vector3(), _v = new THREE.Vector3();
    function simulate(p, s, path) {
        const { eye, vel, fwdH } = throwFrom(p, 0);
        grenades.computeThrow(eye.clone(), fwdH, p.pitch, s, vel, _pos, _v);
        const nade = { position: _pos, velocity: _v, rolling: false, age: 0 };
        if (path) path.push(_pos.clone());
        let steps = 0;
        while (grenades.stepProjectile(nade, CS2.TICK, false) && steps < 64 * 15) { if (path) path.push(_pos.clone()); steps++; }
        return { rest: _pos.clone(), err: _pos.distanceTo(throwFrom(p, 0).want) };
    }

    const out = [];
    for (const g of groups) {
        const byThrower = new Map();
        for (const t of g.traj) (byThrower.get(t.thrower) || byThrower.set(t.thrower, []).get(t.thrower)).push(t);
        const byTick = new Map();
        for (const r of g.players) (byTick.get(r.tick) || byTick.set(r.tick, []).get(r.tick)).push(r);
        for (const p of g.pairs) {
            // launch-direction sanity filter (drop throws we can't reconstruct)
            let bestT = null;
            for (const t of byThrower.get(p.thrower) || []) {
                const d = Math.abs(t.throw_tick - p.throw_tick);
                if (!bestT || d < bestT.d) bestT = { t, d };
            }
            if (bestT && bestT.d <= 6 && bestT.t.samples.length >= 8) {
                const real = realLaunchDir(bestT.t.samples);
                if (real) {
                    const { eye, vel, fwdH } = throwFrom(p, 0);
                    let ang = Infinity;
                    for (const s of STRENGTHS) {
                        grenades.computeThrow(eye.clone(), fwdH, p.pitch, s, vel, _pos, _v);
                        ang = Math.min(ang, THREE.MathUtils.radToDeg(_v.clone().normalize().angleTo(real)));
                    }
                    if (ang > 6) { out.push({ dropped: 'launch', dist: p.dist }); continue; }
                }
            }
            let best = null, bestPath = null;
            for (const s of STRENGTHS) {
                const path = [];
                const r = simulate(p, s, path);
                if (!best || r.err < best.err) { best = r; bestPath = path; }
            }
            const others = (byTick.get(p.throw_tick) || []).filter((r) => r.name !== p.thrower).map((r) => toApp(r.X, r.Y, r.Z));
            if (others.length && pathHitsPlayer(bestPath, others)) { out.push({ dropped: 'player', dist: p.dist }); continue; }
            out.push({
                err: best.err, vx: p.vx, vy: p.vy, vz: p.vz,
                px: p.px, py: p.py, pz: p.pz, pitch: p.pitch, yaw: p.yaw,
                dx: p.dx, dy: p.dy, dz: p.dz,
                restGx: best.rest.z, restGy: best.rest.x, restH: best.rest.y,
            });
        }
    }
    return out;
}, groups);

await browser.close();

const cat = (r) => (r.vz > 100 ? 'skok' : Math.hypot(r.vx, r.vy) > 5 ? 'kretanje' : 'stoji');
const kept = results.filter((r) => r.err !== undefined);
const droppedLaunch = results.filter((r) => r.dropped === 'launch').length;
const droppedPlayer = results.filter((r) => r.dropped === 'player').length;
const metrics = (list) => {
    if (!list.length) return { n: 0, med: 0, in50: 0 };
    const e = list.map((r) => r.err).sort((a, b) => a - b);
    return { n: e.length, med: e[e.length >> 1], in50: 100 * e.filter((x) => x <= 50).length / e.length };
};
console.log(`\n=== ${MAP} lineup accuracy (live-app collision) ===`);
console.log(`kept ${kept.length}   dropped: launch-mismatch ${droppedLaunch}, player-block ${droppedPlayer}`);
for (const name of ['SVE', 'stoji', 'kretanje', 'skok']) {
    const list = name === 'SVE' ? kept : kept.filter((r) => cat(r) === name);
    const m = metrics(list);
    console.log(`  ${name.padEnd(9)} n=${String(m.n).padStart(4)}  median ${m.med.toFixed(0).padStart(4)}u   <=50u ${m.in50.toFixed(0)}%`);
}
console.log(`\nworst ${WORST} (game coords — throw -> our rest vs real det):`);
for (const r of kept.sort((a, b) => b.err - a.err).slice(0, WORST)) {
    console.log(`  err ${r.err.toFixed(0).padStart(5)}u  ${cat(r).padEnd(8)} setpos ${r.px.toFixed(0)} ${r.py.toFixed(0)} ${r.pz?.toFixed?.(0) ?? '?'}  yaw ${r.yaw.toFixed(0)} pitch ${r.pitch.toFixed(0)}  ourRest(${r.restGx.toFixed(0)}, ${r.restGy.toFixed(0)}, ${r.restH.toFixed(0)})  realDet(${r.dx.toFixed(0)}, ${r.dy.toFixed(0)}, ${r.dz.toFixed(0)})`);
}
