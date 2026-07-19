// csnades "XBox from T Spawn Corner" reference (jump + LMB, stationary):
// simulate the scripted jumpthrow from the exact setpos and report the
// trajectory, first bounce, and rest vs the xbox top.
import puppeteer from 'puppeteer-core';

const browser = await puppeteer.launch({ headless: 'new', channel: 'chrome', protocolTimeout: 600000 });
const page = await browser.newPage();
await page.emulate({
    viewport: { width: 1280, height: 800, isMobile: true, hasTouch: true },
    userAgent: 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
});
page.on('pageerror', (e) => console.log('PAGE ERROR:', e.message));
await page.goto('http://localhost:5173', { waitUntil: 'networkidle0', timeout: 60000 });
await page.waitForFunction(() => !!window.__debug, { timeout: 60000 });
await page.evaluate(() => window.__debug.startGame('dust2'));
await page.waitForFunction(() => window.__debug?.mapLoader?.nadeCollider, { timeout: 240000 });
await new Promise((r) => setTimeout(r, 1200));

const out = await page.evaluate(() => {
    const d = window.__debug;
    const { THREE, CS2, grenades } = d;
    // lineup: setpos -299.968750 -1161.931030 136.256561 (EYE); setang -16.521105 90.546722
    const gx = -299.968750, gy = -1161.931030, gzEye = 136.256561;
    const pitch = -16.521105, gyaw = 90.546722;
    const eyeStand = new THREE.Vector3(gy, gzEye, gx); // app: x=gy, y=eye z, z=gx
    // scripted jumpthrow release state (bind): release 0.1075s after jump input
    const rt = CS2.jumpthrowReleaseTime;
    const vyRel = CS2.jumpImpulse - CS2.gravity * rt;
    const rise = CS2.jumpImpulse * rt - 0.5 * CS2.gravity * rt * rt;
    const eye = eyeStand.clone(); eye.y += rise;
    const yawRad = THREE.MathUtils.degToRad(gyaw);
    const fwdH = new THREE.Vector3(Math.sin(yawRad), 0, Math.cos(yawRad)); // same as harness throwFrom
    const vel = new THREE.Vector3(0, vyRel, 0);

    const pos = new THREE.Vector3(), v = new THREE.Vector3();
    grenades.computeThrow(eye, fwdH, pitch, 1.0, vel, pos, v);
    const nade = { position: pos, velocity: v, rolling: false, age: 0 };
    let bounces = [];
    const trace = [];
    let prevVy = v.y;
    let ticks = 0;
    while (grenades.stepProjectile(nade, CS2.TICK, false) && ticks < 64 * 12) {
        ticks++;
        const t = ticks / 64;
        if (t > 3.8 && t < 6.0 && ticks % 4 === 0) trace.push(
            `t=${t.toFixed(2)} game(${pos.z.toFixed(0)}, ${pos.x.toFixed(0)}, ${pos.y.toFixed(0)}) vel(h=${Math.hypot(v.x, v.z).toFixed(0)}, vy=${v.y.toFixed(0)})`);
        if (v.y > 0 && prevVy < 0) bounces.push({ t: +t.toFixed(2), x: +pos.x.toFixed(0), y: +pos.y.toFixed(0), z: +pos.z.toFixed(0), vy: +v.y.toFixed(0) });
        prevVy = v.y;
    }
    window.__trace = trace;
    // xbox top height at the user's second setpos: game(-323.39, 1461.48)
    const ray = new THREE.Raycaster();
    ray.set(new THREE.Vector3(1461.48, 300, -323.39), new THREE.Vector3(0, -1, 0));
    ray.firstHitOnly = true;
    const boxHit = ray.intersectObject(d.mapLoader.collider, true)[0];
    return {
        rest: { gx: +pos.z.toFixed(0), gy: +pos.x.toFixed(0), gz: +pos.y.toFixed(0) },
        airTime: +(ticks / 64).toFixed(2),
        bounces: bounces.slice(0, 5).map(b => ({ t: b.t, gx: b.z, gy: b.x, gz: b.y, vyOut: b.vy })),
        boxTop: boxHit ? +boxHit.point.y.toFixed(1) : null,
        boxAt: 'game(-323, 1461)',
    };
});
console.log(JSON.stringify(out, null, 1));
const trace = await page.evaluate(() => window.__trace);
trace.forEach((l) => console.log(l));
await browser.close();
