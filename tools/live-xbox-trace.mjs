// Trace the two xbox jumpthrows tick-by-tick near the box to see why they end
// ~95u below the box top instead of resting on it.
import puppeteer from 'puppeteer-core';

const LINEUPS = [
    { name: 'A', gx: -428, gy: -843, gz: 156.245865, pitch: -12.552456, yaw: 86.206802 },
    { name: 'B', gx: -299.968933, gy: -1163.764160, gz: 136.982574, pitch: -12.228539, yaw: 90.173004 },
];

const browser = await puppeteer.launch({ headless: 'new', channel: 'chrome', protocolTimeout: 600000 });
const page = await browser.newPage();
await page.emulate({ viewport: { width: 800, height: 600, isMobile: true, hasTouch: true }, userAgent: 'Mozilla/5.0 (iPad)' });
await page.goto('http://localhost:5173', { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => !!window.__debug, { timeout: 120000 });
await page.evaluate(() => window.__debug.startGame('dust2'));
await page.waitForFunction(() => window.__debug?.mapLoader?.nadeCollider, { timeout: 240000 });
await new Promise((r) => setTimeout(r, 1500));

const out = await page.evaluate((LINEUPS) => {
    const d = window.__debug;
    const { THREE, CS2, grenades } = d;
    const trace = (lu) => {
        const eye = new THREE.Vector3(lu.gy, lu.gz, lu.gx);
        const yawRad = THREE.MathUtils.degToRad(lu.yaw);
        const fwdH = new THREE.Vector3(Math.sin(yawRad), 0, Math.cos(yawRad));
        const rt = CS2.jumpthrowReleaseTime;
        const vel = new THREE.Vector3(0, CS2.jumpImpulse - CS2.gravity * rt, 0);
        eye.y += CS2.jumpImpulse * rt - 0.5 * CS2.gravity * rt * rt;
        const pos = new THREE.Vector3(), v = new THREE.Vector3();
        grenades.computeThrow(eye, fwdH, lu.pitch, 1.0, vel, pos, v);
        const nade = { position: pos, velocity: v, rolling: false, age: 0 };
        const lines = []; let t = 0; let prevVy = v.y;
        while (grenades.stepProjectile(nade, CS2.TICK, false) && t < 64 * 12) {
            t++;
            // near the box region (app x 1400-1520, z -360..-290)
            const nearBox = pos.x > 1380 && pos.x < 1540 && pos.z > -370 && pos.z < -280;
            const bounced = (v.y > 0 && prevVy < 0);
            if (nearBox || bounced) lines.push(
                `t=${(t / 64).toFixed(2)} game(${pos.z.toFixed(0)}, ${pos.x.toFixed(0)}, ${pos.y.toFixed(0)}) vy=${v.y.toFixed(0)} ${bounced ? 'BOUNCE' : ''}`);
            prevVy = v.y;
        }
        return { name: lu.name, rest: `game(${pos.z.toFixed(0)}, ${pos.x.toFixed(0)}, ${pos.y.toFixed(0)})`, lines: lines.slice(-14) };
    };
    return LINEUPS.map(trace);
}, LINEUPS);

for (const r of out) {
    console.log(`\n=== ${r.name}  rest ${r.rest}`);
    r.lines.forEach((l) => console.log('  ' + l));
}
await browser.close();
