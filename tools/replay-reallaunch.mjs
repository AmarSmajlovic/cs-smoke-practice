// Isolate launch-reconstruction error vs collision error, straight from demos.
// For the throw nearest TARGET, simulate to rest against our live collider in
// TWO ways and compare to the real detonation:
//   (A) our reconstructed launch (throwFrom + computeThrow) — current pipeline
//   (B) the REAL launch velocity measured off the demo trajectory samples
// If (B) lands right but (A) doesn't -> our launch reconstruction is the bug.
// If (B) also misses -> our collision/bounce is the bug.
//
// Usage: MAP=inferno TARGET="dx,dy,dz" node tools/replay-reallaunch.mjs
import puppeteer from 'puppeteer-core';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = process.env.OUT_DIR || '/private/tmp/claude-501/-Users-amarsmajlovic-Desktop-smoke-practice-threejs/cfadb422-6a01-4775-a0b2-e4d5a00842b3/scratchpad';
const URL = process.env.APP_URL || 'http://localhost:5173';
const MAP = process.env.MAP || 'dust2';
const [TX, TY, TZ] = (process.env.TARGET || '-462,1598,50').split(',').map(Number);
const N = +(process.env.N || 1); // how many nearest throws to report
const DIR = join(ROOT, 'tools/demo-data', MAP);

const all = [];
for (const pf of readdirSync(DIR).filter((f) => f.endsWith('.pairs.json'))) {
    const base = pf.replace('.pairs.json', '');
    const pairs = JSON.parse(readFileSync(join(DIR, pf), 'utf8'));
    const traj = JSON.parse(readFileSync(join(DIR, `${base}.traj.json`), 'utf8'));
    for (const p of pairs) {
        const d = Math.hypot(p.dx - TX, p.dy - TY, p.dz - TZ);
        let bt = null;
        for (const t of traj) if (t.thrower === p.thrower) {
            const dd = Math.abs(t.throw_tick - p.throw_tick);
            if (!bt || dd < bt.dd) bt = { t, dd };
        }
        if (bt && bt.dd <= 6 && bt.t.samples.length >= 8) all.push({ d, p, samples: bt.t.samples });
    }
}
all.sort((a, b) => a.d - b.d);
const picks = all.slice(0, N);
console.log(`${MAP} TARGET ${TX},${TY},${TZ} — ${picks.length} nearest throws`);

const browser = await puppeteer.launch({
    headless: 'new', channel: 'chrome', protocolTimeout: 600000,
    userDataDir: `${OUT}/pptr-profile`, args: ['--no-sandbox', '--no-first-run'],
});
const page = await browser.newPage();
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => !!window.__debug, { timeout: 120000 });
await page.evaluate((m) => window.__debug.startGame(m), MAP);
await page.waitForFunction(() => window.__debug?.mapLoader?.nadeCollider, { timeout: 300000 });
await new Promise((r) => setTimeout(r, 1500));

const res = await page.evaluate((picks) => {
    const { THREE, CS2, grenades } = window.__debug;
    const TICK = 1 / 64, GN = 800 * CS2.nadeGravityScale;
    const toApp = (x, y, z) => new THREE.Vector3(y, z, x);
    const STR = [1.0, 0.5, 0.0];

    // least-squares launch velocity (app frame) from early samples, gravity-removed
    function realLaunch(samples) {
        const i0 = 2, n = Math.min(6, samples.length - i0);
        const t0 = samples[i0].tick;
        let sT = 0, sTT = 0, sX = 0, sXT = 0, sY = 0, sYT = 0, sZ = 0, sZT = 0;
        for (let i = 0; i < n; i++) {
            const s = samples[i0 + i], t = (s.tick - t0) * TICK;
            const zc = s.z + 0.5 * GN * t * t; // remove gravity on game-z (height)
            sT += t; sTT += t * t; sX += s.x; sXT += s.x * t; sY += s.y; sYT += s.y * t; sZ += zc; sZT += zc * t;
        }
        const den = n * sTT - sT * sT;
        const vGx = (n * sXT - sT * sX) / den, vGy = (n * sYT - sT * sY) / den, vGz = (n * sZT - sT * sZ) / den;
        const p0 = samples[i0];
        return { vel: toApp(vGx, vGy, vGz), pos: toApp(p0.x, p0.y, p0.z) };
    }
    const simFrom = (pos, vel) => {
        const nade = { position: pos.clone(), velocity: vel.clone(), rolling: false, age: 0 };
        let s = 0; while (grenades.stepProjectile(nade, CS2.TICK, false) && s < 64 * 14) s++;
        return nade.position.clone();
    };
    const _p = new THREE.Vector3(), _v = new THREE.Vector3();
    function ourLaunch(p) {
        const _eye = new THREE.Vector3(p.px, p.py, p.pz), _vel = new THREE.Vector3(p.vx, p.vy, p.vz);
        if (p.vz > 100 && p.vz < CS2.jumpImpulse) {
            const vzRel = CS2.jumpImpulse - CS2.gravity * CS2.jumpthrowReleaseTime;
            const dt = (vzRel - p.vz) / CS2.gravity;
            _eye.x -= p.vx * dt; _eye.y -= p.vy * dt; _eye.z -= (p.vz + vzRel) * 0.5 * dt; _vel.z = vzRel;
        }
        const eye = toApp(_eye.x, _eye.y, _eye.z); eye.y = _eye.z + CS2.eyeStand;
        const yaw = THREE.MathUtils.degToRad(p.yaw);
        const fwdH = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
        const vel = toApp(_vel.x, _vel.y, _vel.z);
        return { eye, fwdH, pitch: p.pitch, vel };
    }
    const fmt = (v) => `(${v.x.toFixed(0)},${v.y.toFixed(0)},${v.z.toFixed(0)})`;

    return picks.map(({ p, samples }) => {
        const want = toApp(p.dx, p.dy, p.dz);
        // (A) our reconstruction — best of 3 strengths
        let bestA = Infinity, restA = null, ourV = null;
        const ol = ourLaunch(p);
        for (const s of STR) {
            grenades.computeThrow(ol.eye.clone(), ol.fwdH, ol.pitch, s, ol.vel, _p, _v);
            const r = simFrom(_p, _v);
            const e = r.distanceTo(want);
            if (e < bestA) { bestA = e; restA = r; ourV = _v.clone(); }
        }
        // (B) real measured launch
        const rl = realLaunch(samples);
        const restB = simFrom(rl.pos, rl.vel);
        const errB = restB.distanceTo(want);
        // launch comparison (speed + angle between our chosen and real)
        const ourSpeed = ourV.length(), realSpeed = rl.vel.length();
        const ang = THREE.MathUtils.radToDeg(ourV.clone().normalize().angleTo(rl.vel.clone().normalize()));
        return {
            errA: bestA, errB, restA: fmt(restA), restB: fmt(restB), want: fmt(want),
            ourSpeed, realSpeed, ang, cat: p.vz > 100 ? 'skok' : Math.hypot(p.vx, p.vy) > 5 ? 'kret' : 'stoji',
        };
    });
}, picks);
await browser.close();
console.log(`\n  errA=our-launch  errB=real-launch  (both vs real det, sim on our collider)`);
for (const r of res) {
    console.log(`  ${r.cat.padEnd(5)} errA ${r.errA.toFixed(0).padStart(5)}u  errB ${r.errB.toFixed(0).padStart(5)}u   launch: our|real speed ${r.ourSpeed.toFixed(0)}|${r.realSpeed.toFixed(0)}  angle ${r.ang.toFixed(1)}deg   restA ${r.restA} restB ${r.restB} want ${r.want}`);
}
const mean = (f) => (res.reduce((a, r) => a + f(r), 0) / res.length);
console.log(`\n  MEAN errA ${mean((r) => r.errA).toFixed(0)}u   errB ${mean((r) => r.errB).toFixed(0)}u   speed our ${mean((r) => r.ourSpeed).toFixed(0)} real ${mean((r) => r.realSpeed).toFixed(0)}   angle ${mean((r) => r.ang).toFixed(1)}deg`);
