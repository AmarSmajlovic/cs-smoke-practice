// Two user-reported dust2 xbox smoke lineups that should land ON the box but
// don't. Simulate each at every strength (+ jumpthrow) and print the rest
// point + bounce trail vs the box top (app ~x1461 z-323, top y-28).
import puppeteer from 'puppeteer-core';

const LINEUPS = [
    { name: 'A (wall bounce)', gx: -428, gy: -843, gz: 156.245865, pitch: -12.552456, yaw: 86.206802 },
    { name: 'B (ground bounce)', gx: -299.968933, gy: -1163.764160, gz: 136.982574, pitch: -12.228539, yaw: 90.173004 },
];

const browser = await puppeteer.launch({ headless: 'new', channel: 'chrome', protocolTimeout: 600000 });
const page = await browser.newPage();
await page.emulate({ viewport: { width: 800, height: 600, isMobile: true, hasTouch: true }, userAgent: 'Mozilla/5.0 (iPad)' });
page.on('pageerror', (e) => console.log('ERR', e.message));
await page.goto('http://localhost:5173', { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => !!window.__debug, { timeout: 120000 });
await page.evaluate(() => window.__debug.startGame('dust2'));
await page.waitForFunction(() => window.__debug?.mapLoader?.nadeCollider, { timeout: 240000 });
await new Promise((r) => setTimeout(r, 1500));

const out = await page.evaluate((LINEUPS) => {
    const d = window.__debug;
    const { THREE, CS2, grenades } = d;
    // box top probe
    const ray = new THREE.Raycaster();
    ray.set(new THREE.Vector3(1461, 300, -323), new THREE.Vector3(0, -1, 0));
    ray.firstHitOnly = true;
    const boxHit = ray.intersectObject(d.mapLoader.collider, true)[0];
    const boxTop = boxHit ? boxHit.point.y : null;

    const sim = (lu, strength, jt) => {
        const eye = new THREE.Vector3(lu.gy, lu.gz, lu.gx); // app x=game y, y=game z, z=game x
        const yawRad = THREE.MathUtils.degToRad(lu.yaw);
        const fwdH = new THREE.Vector3(Math.sin(yawRad), 0, Math.cos(yawRad));
        const vel = new THREE.Vector3();
        if (jt) {
            const rt = CS2.jumpthrowReleaseTime;
            vel.y = CS2.jumpImpulse - CS2.gravity * rt;
            eye.y += CS2.jumpImpulse * rt - 0.5 * CS2.gravity * rt * rt;
        }
        const pos = new THREE.Vector3(), v = new THREE.Vector3();
        grenades.computeThrow(eye, fwdH, lu.pitch, strength, vel, pos, v);
        const nade = { position: pos, velocity: v, rolling: false, age: 0 };
        let t = 0;
        while (grenades.stepProjectile(nade, CS2.TICK, false) && t < 64 * 12) t++;
        return { rest: [pos.z.toFixed(0), pos.x.toFixed(0), pos.y.toFixed(0)], air: +(t / 64).toFixed(1) };
    };

    const res = [];
    for (const lu of LINEUPS) {
        const rows = [];
        for (const [label, s, jt] of [['full', 1, false], ['medium', CS2.nadeMediumStrength, false], ['lob', 0, false], ['full-JT', 1, true], ['medium-JT', CS2.nadeMediumStrength, true]]) {
            const r = sim(lu, s, jt);
            const onBox = Math.abs(r.rest[2] - (boxTop ?? -28)) < 12 && Math.abs(r.rest[0] - (-323)) < 60 && Math.abs(r.rest[1] - 1461) < 60;
            rows.push(`  ${label.padEnd(10)} rest game(${r.rest.join(', ')}) air ${r.air}s ${onBox ? '<<< NA KUTIJI' : ''}`);
        }
        res.push(`${lu.name}:\n` + rows.join('\n'));
    }
    return { boxTop: boxTop?.toFixed(0), res };
}, LINEUPS);

console.log('kutija vrh y =', out.boxTop, '(cilj: rest game(-323, 1461, ~' + out.boxTop + '))');
out.res.forEach((r) => console.log(r));
await browser.close();
