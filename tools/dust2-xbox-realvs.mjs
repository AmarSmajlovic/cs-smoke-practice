// Decisive: overlay the REAL demo trajectory vs OUR simulation for the xbox
// smoke, to see exactly where/what our collider bounces off differently.
import puppeteer from 'puppeteer-core';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = process.env.OUT_DIR || '/private/tmp/claude-501/-Users-amarsmajlovic-Desktop-smoke-practice-threejs/cfadb422-6a01-4775-a0b2-e4d5a00842b3/scratchpad';
const URL = process.env.APP_URL || 'http://localhost:5173';
const DIR = join(ROOT, 'tools/demo-data/dust2');

// find the throw whose detonation is closest to app(1598,-462,50) i.e.
// game det (x=-462, y=1598, z=50)
let best = null;
for (const pf of readdirSync(DIR).filter((f) => f.endsWith('.pairs.json'))) {
    const base = pf.replace('.pairs.json', '');
    const pairs = JSON.parse(readFileSync(join(DIR, pf), 'utf8'));
    const traj = JSON.parse(readFileSync(join(DIR, `${base}.traj.json`), 'utf8'));
    for (const p of pairs) {
        const d = Math.hypot(p.dx - (-462), p.dy - 1598, p.dz - 50);
        if (!best || d < best.d) {
            // attach matching real samples (nearest throw_tick, same thrower)
            let bt = null;
            for (const t of traj) if (t.thrower === p.thrower) {
                const dd = Math.abs(t.throw_tick - p.throw_tick);
                if (!bt || dd < bt.dd) bt = { t, dd };
            }
            best = { d, p, base, samples: bt && bt.dd <= 6 ? bt.t.samples : [] };
        }
    }
}
console.log(`chosen: ${best.base}  thrower=${best.p.thrower}  det game(${best.p.dx.toFixed(0)},${best.p.dy.toFixed(0)},${best.p.dz.toFixed(0)})  ${best.samples.length} real samples`);

const browser = await puppeteer.launch({
    headless: 'new', channel: 'chrome', protocolTimeout: 600000,
    userDataDir: `${OUT}/pptr-profile`, args: ['--no-sandbox', '--no-first-run'],
});
const page = await browser.newPage();
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => !!window.__debug, { timeout: 120000 });
await page.evaluate(() => window.__debug.startGame('dust2'));
await page.waitForFunction(() => window.__debug?.mapLoader?.nadeCollider, { timeout: 300000 });
await new Promise((r) => setTimeout(r, 1500));

const out = await page.evaluate(({ p, samples }) => {
    const { THREE, CS2, grenades } = window.__debug;
    const toApp = (x, y, z) => new THREE.Vector3(y, z, x);
    // reconstruct throw (jumpthrow-aware) — same as harness throwFrom
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
    const pos = new THREE.Vector3(), v = new THREE.Vector3();
    grenades.computeThrow(eye.clone(), fwdH, p.pitch, 1.0, vel, pos, v);
    const nade = { position: pos, velocity: v, rolling: false, age: 0 };
    const fmt = (x, y, z) => `app(x${x.toFixed(0)}, y${y.toFixed(0)}, z${z.toFixed(0)})`;
    let s = 0, prevVy = v.y;
    const bounces = [];
    const simApproach = [];
    while (grenades.stepProjectile(nade, CS2.TICK, false) && s < 64 * 12) {
        if (v.y > 0 && prevVy < 0) bounces.push(`bounce@ ${fmt(pos.x, pos.y, pos.z)} vy ${prevVy.toFixed(0)}->${v.y.toFixed(0)}`);
        if (pos.x > 1300 && s % 3 === 0) simApproach.push(fmt(pos.x, pos.y, pos.z));
        prevVy = v.y; s++;
    }
    const real = samples.map((sm) => toApp(sm.x, sm.y, sm.z));
    const realApproach = real.filter((vv) => vv.x > 1300).filter((_, i) => i % 3 === 0).map((vv) => fmt(vv.x, vv.y, vv.z));
    return {
        simRest: fmt(pos.x, pos.y, pos.z), simBounces: bounces.slice(-6),
        simApproach: simApproach.slice(0, 14),
        realApproach: realApproach.slice(0, 14),
        realRest: real.length ? fmt(real[real.length - 1].x, real[real.length - 1].y, real[real.length - 1].z) : 'n/a',
    };
}, { p: best.p, samples: best.samples });
await browser.close();
console.log('\n--- REAL approach (x>1300) ---'); out.realApproach.forEach((r) => console.log('  ' + r));
console.log('real rest:', out.realRest);
console.log('\n--- OUR SIM approach (x>1300) ---'); out.simApproach.forEach((r) => console.log('  ' + r));
console.log('bounces:'); out.simBounces.forEach((b) => console.log('  ' + b));
console.log('sim rest:', out.simRest);
