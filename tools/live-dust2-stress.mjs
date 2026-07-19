// Physics stress sweep for a freshly built map: throw a batch of smokes from
// random walkable spots at random angles/strengths (ground + jumpthrow) and
// verify every one comes to rest sanely: inside the map bounds, above the
// floor, finite coordinates, within the fuse. Catches tunneling, NaNs and
// runaway bounces before users do.
import puppeteer from 'puppeteer-core';

const MAP = process.argv[2] || 'dust2';
const N = +(process.argv[3] || 200);

const browser = await puppeteer.launch({ headless: 'new', channel: 'chrome', protocolTimeout: 600000 });
const page = await browser.newPage();
await page.emulate({
    viewport: { width: 800, height: 600, isMobile: true, hasTouch: true },
    userAgent: 'Mozilla/5.0 (iPad)',
});
page.on('pageerror', (e) => console.log('PAGE ERROR:', e.message));
await page.goto('http://localhost:5173', { waitUntil: 'networkidle0', timeout: 60000 });
await page.waitForFunction(() => !!window.__debug, { timeout: 60000 });
await page.evaluate((m) => window.__debug.startGame(m), MAP);
await page.waitForFunction(() => window.__debug?.mapLoader?.nadeCollider, { timeout: 240000 });
await new Promise((r) => setTimeout(r, 1200));

const out = await page.evaluate((N) => {
    const d = window.__debug;
    const { THREE, CS2, grenades } = d;
    const bb = new THREE.Box3().setFromObject(d.mapLoader.collider);
    const ray = new THREE.Raycaster();
    const down = new THREE.Vector3(0, -1, 0);
    // deterministic LCG so runs are reproducible
    let seed = 1234567;
    const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;

    const spots = [];
    let guard = 0;
    while (spots.length < N && guard++ < N * 30) {
        const x = bb.min.x + rnd() * (bb.max.x - bb.min.x);
        const z = bb.min.z + rnd() * (bb.max.z - bb.min.z);
        ray.set(new THREE.Vector3(x, bb.max.y + 50, z), down);
        ray.firstHitOnly = true;
        const g = ray.intersectObject(d.mapLoader.collider, true)[0];
        if (!g || g.face.normal.y < 0.9) continue;
        spots.push({ x, z, y: g.point.y });
    }

    const bad = [];
    let maxTicks = 0;
    const pos = new THREE.Vector3(), v = new THREE.Vector3();
    for (const s of spots) {
        const pitch = -60 + rnd() * 90;         // -60 (up) .. +30 (down)
        const yaw = rnd() * Math.PI * 2;
        const strength = [1, 1, 1, 0.49, 0][Math.floor(rnd() * 5)];
        const jt = rnd() < 0.3;
        const fwdH = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
        const eye = new THREE.Vector3(s.x, s.y + CS2.eyeStand, s.z);
        const vel = new THREE.Vector3(0, 0, 0);
        if (jt) {
            const rt = CS2.jumpthrowReleaseTime;
            vel.y = CS2.jumpImpulse - CS2.gravity * rt;
            eye.y += CS2.jumpImpulse * rt - 0.5 * CS2.gravity * rt * rt;
        }
        grenades.computeThrow(eye, fwdH, pitch, strength, vel, pos, v);
        const nade = { position: pos, velocity: v, rolling: false, age: 0 };
        let ticks = 0;
        let exitPoint = null; // where it first dropped below the world floor
        while (grenades.stepProjectile(nade, CS2.TICK, false) && ticks < 64 * 15) {
            ticks++;
            if (!exitPoint && pos.y < bb.min.y - 20) exitPoint = { x: pos.x, z: pos.z };
        }
        maxTicks = Math.max(maxTicks, ticks);
        const fin = Number.isFinite(pos.x) && Number.isFinite(pos.y) && Number.isFinite(pos.z);
        // Flying out over the map edge and falling into the void is BY DESIGN
        // (open skybox, sky not solid for grenades — like CS2). A real failure
        // is falling through a floor INSIDE the playable core, or NaN.
        let tunneled = false;
        if (fin && exitPoint) {
            // dropped below the world: a bug only if a floor EXISTS in the
            // column where it CROSSED the bottom (tunneled through it) —
            // out-of-play void has no floor there
            ray.set(new THREE.Vector3(exitPoint.x, bb.max.y + 50, exitPoint.z), down);
            ray.firstHitOnly = true;
            tunneled = !!ray.intersectObject(d.mapLoader.nadeCollider, true)[0];
        }
        if (!fin || tunneled) {
            bad.push({ from: { x: +s.x.toFixed(0), y: +s.y.toFixed(0), z: +s.z.toFixed(0) }, pitch: +pitch.toFixed(1), rest: fin ? { x: +pos.x.toFixed(0), y: +pos.y.toFixed(0), z: +pos.z.toFixed(0) } : 'NaN', ticks });
        }
    }
    return { thrown: spots.length, bad, maxAirS: +(maxTicks / 64).toFixed(1) };
}, N);
console.log(`bacanja: ${out.thrown} | problematicnih: ${out.bad.length} | najduzi let: ${out.maxAirS}s`);
out.bad.slice(0, 10).forEach((b) => console.log('  LOS:', JSON.stringify(b)));
await browser.close();
process.exit(out.bad.length ? 1 : 0);
