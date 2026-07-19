// Measure the reported pallet: collider heights + surface normals around the
// aim point, then ACTUALLY jump at it (dpad forward + jump via touch events)
// and report whether the player ends up on top.
import puppeteer from 'puppeteer-core';

const posStr = process.argv[2];
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
await page.evaluate((s) => window.__debug.applySetposString(s), posStr);
await new Promise((r) => setTimeout(r, 500));

const probe = await page.evaluate(() => {
    const d = window.__debug;
    const { THREE, player, camera } = d;
    const ray = new THREE.Raycaster();
    const down = new THREE.Vector3(0, -1, 0);
    const fwd = new THREE.Vector3();
    camera.getWorldDirection(fwd); fwd.y = 0; fwd.normalize();
    const rows = [];
    for (let t = 0; t <= 120; t += 10) {
        const px = player.position.x + fwd.x * t, pz = player.position.z + fwd.z * t;
        ray.set(new THREE.Vector3(px, player.position.y + 150, pz), down);
        ray.firstHitOnly = true;
        const c = ray.intersectObject(d.mapLoader.collider, true)[0];
        if (!c) continue;
        rows.push({ t, top: +(c.point.y - player.position.y).toFixed(1), ny: +c.face.normal.y.toFixed(2) });
    }
    return { feet: +player.position.y.toFixed(1), rows };
});
console.log('feet y =', probe.feet, '| profil ispred (t=dist): rel visina kolidera + normal.y (1=ravno, <0.7=strmo)');
probe.rows.forEach((r) => console.log(`  t=${r.t} h=+${r.top} ny=${r.ny}`));

// real jump attempt: proper dpad touch (Touch objects with identifier) + Space
await page.evaluate(() => {
    const pad = document.getElementById('dpad');
    const r = pad.getBoundingClientRect();
    const t = new Touch({ identifier: 7, target: pad, clientX: r.left + r.width / 2, clientY: r.top + 4 });
    pad.dispatchEvent(new TouchEvent('touchstart', { touches: [t], targetTouches: [t], changedTouches: [t], bubbles: true, cancelable: true }));
});
await page.keyboard.down('KeyW'); // harmless on mobile, drives desktop path if ever used
await new Promise((r) => setTimeout(r, 250));
await page.keyboard.down('Space');
await new Promise((r) => setTimeout(r, 120));
await page.keyboard.up('Space');
await new Promise((r) => setTimeout(r, 500));
// more hops (CS2 needs a chain: step -> pallet top -> platform)
for (let i = 0; i < 3; i++) {
    await new Promise((r) => setTimeout(r, 500));
    await page.keyboard.down('Space');
    await new Promise((r) => setTimeout(r, 120));
    await page.keyboard.up('Space');
}
await new Promise((r) => setTimeout(r, 900));
await page.keyboard.up('KeyW');
await page.evaluate(() => {
    const pad = document.getElementById('dpad');
    const t = new Touch({ identifier: 7, target: pad, clientX: 0, clientY: 0 });
    pad.dispatchEvent(new TouchEvent('touchend', { touches: [], targetTouches: [], changedTouches: [t], bubbles: true, cancelable: true }));
});
const after = await page.evaluate(() => {
    const p = window.__debug.player;
    return { y: +p.position.y.toFixed(1), onGround: p.onGround, x: +p.position.x.toFixed(0), z: +p.position.z.toFixed(0) };
});
console.log('poslije skoka:', JSON.stringify(after));
await browser.close();
