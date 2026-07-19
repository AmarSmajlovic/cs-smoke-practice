// Find visual geometry the player collider does not know about: sample a grid
// around a spot, raycast straight down against BOTH the visual meshes and the
// player collider, and report cells where the visual top is >=20u above the
// collider top (a crate you would fall through / cannot stand on).
import puppeteer from 'puppeteer-core';

const CX = -822, CZ = -796; // app coords (game y, game x) — T spawn
const browser = await puppeteer.launch({ headless: 'new', channel: 'chrome' });
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
await new Promise((r) => setTimeout(r, 1500));

const out = await page.evaluate(({ CX, CZ }) => {
    const d = window.__debug;
    const { THREE } = d;
    const ray = new THREE.Raycaster();
    const down = new THREE.Vector3(0, -1, 0);
    const visRoot = d.mapLoader.visualRoot;
    const collider = d.mapLoader.collider;
    const rows = [];
    for (let x = CX - 300; x <= CX + 300; x += 25) {
        for (let z = CZ - 300; z <= CZ + 300; z += 25) {
            ray.set(new THREE.Vector3(x, 500, z), down);
            ray.firstHitOnly = true;
            const v = ray.intersectObject(visRoot, true)[0];
            const c = ray.intersectObject(collider, true)[0];
            if (!v) continue;
            const vy = v.point.y, cy = c ? c.point.y : -9999;
            if (vy - cy >= 20) rows.push({ x, z, vy: +vy.toFixed(0), cy: +cy.toFixed(0), mesh: (v.object.name || '?').slice(0, 60) });
        }
    }
    return rows;
}, { CX, CZ });
console.log('celija sa vizuelnim objektom BEZ player kolizije:', out.length);
out.slice(0, 20).forEach((r) => console.log(`  app(${r.x},${r.z}) visual y=${r.vy} collider y=${r.cy} | ${r.mesh}`));
await browser.close();
