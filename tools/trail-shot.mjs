// Throw a lineup live, then move the camera to a chosen viewpoint and
// screenshot the persistent trajectory trail — for 1:1 comparison with a
// csnades video frame.
// Usage: node tools/trail-shot.mjs <out.png>
import puppeteer from 'puppeteer-core';

const OUT = process.argv[2] || '/tmp/trail.png';
const SETPOS = { gx: -160.031250, gy: 887.968750, gz: -71.647980 };
const SETANG = { pitch: -50.280293, yaw: -146.488480 };

const browser = await puppeteer.launch({ headless: 'new', channel: 'chrome' });
const page = await browser.newPage();
await page.emulate({
    viewport: { width: 1400, height: 900, isMobile: true, hasTouch: true },
    userAgent: 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
});
let detonated = false;
page.on('console', (m) => { if (/Smoke detonated/.test(m.text())) detonated = true; });
await page.goto('http://localhost:5173', { waitUntil: 'networkidle0' });
await page.waitForFunction(() => !!window.__debug, { timeout: 60000 });
await page.evaluate(() => window.__debug.startGame('mirage'));
await page.waitForFunction(() => window.__debug?.mapLoader?.nadeCollider, { timeout: 120000 });
await new Promise((r) => setTimeout(r, 2500));

await page.evaluate(({ SETPOS, SETANG }) => {
    const { player, camera, THREE, CS2 } = window.__debug;
    player.position.set(SETPOS.gy, SETPOS.gz - CS2.eyeStand, SETPOS.gx);
    player.velocity.set(0, 0, 0);
    camera.quaternion.setFromEuler(new THREE.Euler(
        THREE.MathUtils.degToRad(-SETANG.pitch),
        THREE.MathUtils.degToRad(SETANG.yaw + 180), 0, 'YXZ'));
}, { SETPOS, SETANG });
await new Promise((r) => setTimeout(r, 400));
await page.keyboard.down('KeyF');
await new Promise((r) => setTimeout(r, 120));
await page.keyboard.up('KeyF');
for (let i = 0; i < 160 && !detonated; i++) await new Promise((r) => setTimeout(r, 100));

// street viewpoint in front of the shop, looking at the doorway (video frame)
await page.evaluate(() => {
    const { player, camera, THREE, grenades } = window.__debug;
    player.noclip = true;
    // hide the cloud so the trail is visible (trail lines persist)
    for (const s of grenades.smokes) for (const l of s.layers) l.mesh.visible = false;
    const fog = document.getElementById('smoke-fog');
    if (fog) fog.style.display = 'none';
    // app coords: x = game y, y = height, z = game x
    player.position.set(-80, -80 - 64, -1760);
    camera.position.set(-80, -80, -1760);
    const look = new THREE.Vector3(-300, -140, -1950); // shop doorway area
    camera.lookAt(look);
});
await new Promise((r) => setTimeout(r, 500));
await page.screenshot({ path: OUT });
console.log('saved', OUT, 'detonated:', detonated);
const rest = await page.evaluate(() => {
    const s = window.__debug.grenades.smokes[0];
    return s ? s.center.toArray().map((v) => +v.toFixed(0)) : null;
});
console.log('smoke center app:', JSON.stringify(rest));
await browser.close();
