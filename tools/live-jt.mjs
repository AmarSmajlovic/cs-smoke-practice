// End-to-end LIVE test of the scripted jumpthrow: real browser, real app,
// real input path (pointer lock + F key), teleported to a setpos lineup.
// Prints where the smoke detonates vs the expected landing.
// Usage: node tools/live-jt.mjs
import puppeteer from 'puppeteer-core';

const SETPOS = { gx: -463.968750, gy: 775.296326, gz: -7.968750 }; // eye, game
const SETANG = { pitch: -46.506508, yaw: -94.999893 };
const EXPECT = { x: -1620, y: -170, z: -674 }; // harness @ hot-floor-bounce model

const browser = await puppeteer.launch({ headless: 'new', channel: 'chrome' });
const page = await browser.newPage();
// touch emulation -> the app takes the mobile path: gameState goes straight
// to 'playing' without pointer lock (which headless can't grant)
await page.emulate({
    viewport: { width: 1280, height: 800, isMobile: true, hasTouch: true },
    userAgent: 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
});
let detonation = null;
page.on('console', (msg) => {
    const m = msg.text().match(/Smoke detonated at (-?[\d.]+) (-?[\d.]+) (-?[\d.]+)/);
    if (m) detonation = { x: +m[1], y: +m[2], z: +m[3] };
});
page.on('pageerror', (e) => console.log('PAGE ERROR:', e.message));
await page.goto('http://localhost:5173', { waitUntil: 'networkidle0' });
await page.waitForFunction(() => !!window.__debug, { timeout: 60000 });
await page.evaluate(() => window.__debug.startGame('mirage'));
await page.waitForFunction(() => window.__debug?.mapLoader?.nadeCollider, { timeout: 120000 });
await new Promise((r) => setTimeout(r, 1200));

console.log('mobile path:', await page.evaluate(() => document.body.classList.contains('mobile')));

// teleport to the lineup (same mapping as applySetposString) + view angles
await page.evaluate(({ SETPOS, SETANG }) => {
    const { player, camera, THREE, CS2 } = window.__debug;
    player.position.set(SETPOS.gy, SETPOS.gz - CS2.eyeStand, SETPOS.gx);
    player.velocity.set(0, 0, 0);
    const e = new THREE.Euler(
        THREE.MathUtils.degToRad(-SETANG.pitch),
        THREE.MathUtils.degToRad(SETANG.yaw + 180),
        0, 'YXZ');
    camera.quaternion.setFromEuler(e);
}, { SETPOS, SETANG });
await new Promise((r) => setTimeout(r, 400));

const pre = await page.evaluate(() => {
    const { player } = window.__debug;
    return { pos: player.position.toArray().map((v) => +v.toFixed(1)), onGround: player.onGround };
});
console.log('pre-throw player:', JSON.stringify(pre));

await page.keyboard.down('KeyF');
await new Promise((r) => setTimeout(r, 120));
await page.keyboard.up('KeyF');

// smoke flies ~6s; poll for the detonation log
for (let i = 0; i < 120 && !detonation; i++) await new Promise((r) => setTimeout(r, 250));
if (!detonation) {
    console.log('NO DETONATION — jumpthrow did not fire (gameState/pointer lock?)');
} else {
    const d = Math.hypot(detonation.x - EXPECT.x, detonation.z - EXPECT.z);
    console.log(`LIVE rest app(${detonation.x.toFixed(0)}, ${detonation.y.toFixed(0)}, ${detonation.z.toFixed(0)})`);
    console.log(`expected app(${EXPECT.x}, ${EXPECT.y}, ${EXPECT.z})  ->  horiz diff ${d.toFixed(0)}u`);
}
await browser.close();
