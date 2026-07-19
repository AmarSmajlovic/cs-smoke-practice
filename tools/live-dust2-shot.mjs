// Load dust2 in a real browser and screenshot the T-spawn view, so texture
// problems are visible before telling anyone it works.
import puppeteer from 'puppeteer-core';

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
await new Promise((r) => setTimeout(r, 2500));
await page.screenshot({ path: process.argv[2] || 'd2-shot.jpg', type: 'jpeg', quality: 80 });
// second angle: look toward mid from T spawn
await page.evaluate(() => {
    const d = window.__debug;
    const e = new d.THREE.Euler(0, d.THREE.MathUtils.degToRad(60), 0, 'YXZ');
    d.camera.quaternion.setFromEuler(e);
});
await new Promise((r) => setTimeout(r, 600));
await page.screenshot({ path: (process.argv[2] || 'd2-shot.jpg').replace('.jpg', '-2.jpg'), type: 'jpeg', quality: 80 });
await browser.close();
console.log('shots saved');
