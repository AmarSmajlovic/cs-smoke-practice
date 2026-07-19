// Teleport to a user-reported setpos, screenshot what they see, and raycast
// through the view center + a grid of screen points to name the materials.
// Usage: node tools/live-dust2-inspect.mjs "<setpos ...; setang ...>" out.jpg
import puppeteer from 'puppeteer-core';

const posStr = process.argv[2];
const out = process.argv[3] || 'inspect.jpg';

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
await new Promise((r) => setTimeout(r, 1500));
await page.evaluate((s) => window.__debug.applySetposString(s), posStr);
await new Promise((r) => setTimeout(r, 800));
await page.screenshot({ path: out, type: 'jpeg', quality: 82 });

const hits = await page.evaluate(() => {
    const d = window.__debug;
    const { THREE, camera } = d;
    const ray = new THREE.Raycaster();
    const seen = {};
    for (let sx = -0.8; sx <= 0.8; sx += 0.2) {
        for (let sy = -0.8; sy <= 0.8; sy += 0.2) {
            ray.setFromCamera(new THREE.Vector2(sx, sy), camera);
            ray.firstHitOnly = true;
            const v = ray.intersectObject(d.mapLoader.visualRoot, true)[0];
            if (!v) continue;
            const mat = Array.isArray(v.object.material) ? v.object.material[v.face?.materialIndex ?? 0] : v.object.material;
            const k = `${(mat?.name || '?').slice(0, 55)} | mesh ${(v.object.name || '?').slice(0, 45)}`;
            seen[k] = seen[k] || { n: 0, hasMap: !!mat?.map, transparent: !!mat?.transparent, alphaTest: mat?.alphaTest ?? 0 };
            seen[k].n++;
        }
    }
    return seen;
});
console.log('materijali u pogledu:');
Object.entries(hits).sort((a, b) => b[1].n - a[1].n).forEach(([k, v]) =>
    console.log(`  ${v.n}x ${k} | map:${v.hasMap} transp:${v.transparent} aTest:${v.alphaTest}`));
await browser.close();
