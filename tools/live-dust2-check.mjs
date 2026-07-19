// Smoke-test the freshly built dust2: load it in a real browser, verify the
// colliders build, the player lands on solid ground at a real T spawn, and a
// thrown grenade comes to rest somewhere sane (not falling through the map).
import puppeteer from 'puppeteer-core';

const browser = await puppeteer.launch({ headless: 'new', channel: 'chrome' });
const page = await browser.newPage();
await page.emulate({
    viewport: { width: 1280, height: 800, isMobile: true, hasTouch: true },
    userAgent: 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
});
page.on('pageerror', (e) => console.log('PAGE ERROR:', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE ERROR:', m.text()); });
await page.goto('http://localhost:5173', { waitUntil: 'networkidle0', timeout: 60000 });
await page.waitForFunction(() => !!window.__debug, { timeout: 60000 });
await page.evaluate(() => window.__debug.startGame('dust2'));
await page.waitForFunction(() => window.__debug?.mapLoader?.nadeCollider, { timeout: 240000 });
await new Promise((r) => setTimeout(r, 1500));

const report = await page.evaluate(() => {
    const d = window.__debug;
    const p = d.player;
    return {
        collider: !!d.mapLoader.collider,
        nadeCollider: !!d.mapLoader.nadeCollider,
        pos: { x: +p.position.x.toFixed(1), y: +p.position.y.toFixed(1), z: +p.position.z.toFixed(1) },
        onGround: p.onGround,
    };
});
console.log('spawn:', JSON.stringify(report));

// let physics settle a second, then check the player did not fall through
await new Promise((r) => setTimeout(r, 2000));
const after = await page.evaluate(() => {
    const p = window.__debug.player;
    return { y: +p.position.y.toFixed(1), onGround: p.onGround };
});
console.log('poslije 2s:', JSON.stringify(after));

// throw a grenade straight ahead and watch it come to rest
await page.evaluate(() => {
    const el = document.getElementById('btn-throw');
    el.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, cancelable: true }));
    el.dispatchEvent(new TouchEvent('touchend', { bubbles: true, cancelable: true }));
});
// sample the projectile every 500ms until it rests or detonates
for (let i = 0; i < 16; i++) {
    await new Promise((r) => setTimeout(r, 500));
    const s = await page.evaluate(() => {
        const d = window.__debug;
        const n = d.grenades.projectiles[0];
        if (!n) return null;
        return { x: +n.position.x.toFixed(0), y: +n.position.y.toFixed(0), z: +n.position.z.toFixed(0), rolling: n.rolling };
    });
    if (!s) { console.log('granata detonirala/miruje — kraj leta'); break; }
    console.log(`t=${(i + 1) * 0.5}s granata:`, JSON.stringify(s));
    if (s.y < -2000) { console.log('!! GRANATA PROPALA KROZ MAPU'); break; }
}
await browser.close();
