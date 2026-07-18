// LIVE test of the mobile throw-strength + JT combo: real browser, touch
// emulation (mobile path), real button elements. Verifies:
//   1. plain MED tap still throws one medium smoke
//   2. hold MED + tap JT = ONE jumpthrow at medium strength (the MED release
//      after the JT must NOT throw a second smoke)
// Usage: vite dev server on :5173, then node tools/live-touch-combo.mjs
import puppeteer from 'puppeteer-core';

const browser = await puppeteer.launch({ headless: 'new', channel: 'chrome' });
const page = await browser.newPage();
await page.emulate({
    viewport: { width: 1280, height: 800, isMobile: true, hasTouch: true },
    userAgent: 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
});
page.on('pageerror', (e) => console.log('PAGE ERROR:', e.message));
await page.goto('http://localhost:5173', { waitUntil: 'networkidle0' });
await page.waitForFunction(() => !!window.__debug, { timeout: 60000 });
await page.evaluate(() => window.__debug.startGame('mirage'));
await page.waitForFunction(() => window.__debug?.mapLoader?.nadeCollider, { timeout: 120000 });
await new Promise((r) => setTimeout(r, 1200));
console.log('mobile path:', await page.evaluate(() => document.body.classList.contains('mobile')));

const touch = (id, type) => page.evaluate(({ id, type }) => {
    const el = document.getElementById(id);
    el.dispatchEvent(new TouchEvent(type, { bubbles: true, cancelable: true }));
}, { id, type });

const nadeCount = () => page.evaluate(() => window.__debug.grenades.projectiles.length);
const lastStrength = () => page.evaluate(() => {
    const d = window.__debug;
    const nade = d.grenades.projectiles[d.grenades.projectiles.length - 1];
    return { n: d.grenades.projectiles.length, vel: nade ? Math.hypot(nade.velocity.x, nade.velocity.y, nade.velocity.z) : null };
});

// --- 1. plain MED tap
await touch('btn-med', 'touchstart');
await new Promise((r) => setTimeout(r, 150));
await touch('btn-med', 'touchend');
await new Promise((r) => setTimeout(r, 300));
const t1 = await lastStrength();
console.log(`plain MED tap: nades=${t1.n} launchSpeed=${t1.vel?.toFixed(1)} (medium ≈ ${(675 * (0.3 + 0.7 * 0.49)).toFixed(1)}, plus inherit≈0 standing)`);

// restock + clear
await page.evaluate(() => { window.__debug.grenades.clearAllSmokes?.(); });
await page.waitForFunction(() => window.__debug.hasSmoke?.() ?? true, { timeout: 15000 }).catch(() => {});
await new Promise((r) => setTimeout(r, 2500));

// --- 2. hold MED, tap JT, release MED
const before = await nadeCount();
await touch('btn-med', 'touchstart');
await new Promise((r) => setTimeout(r, 150));
await touch('btn-jt', 'touchstart');
await touch('btn-jt', 'touchend');
await new Promise((r) => setTimeout(r, 400)); // JT releases a few ticks after liftoff
await touch('btn-med', 'touchend');
await new Promise((r) => setTimeout(r, 500));
const t2 = await lastStrength();
console.log(`hold MED + tap JT: new nades=${t2.n - before} (must be 1) launchSpeed=${t2.vel?.toFixed(1)} (medium JT > plain medium: inherits jump velocity)`);

await browser.close();
