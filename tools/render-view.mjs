// Render the actual in-game view at a console lineup, to compare framing/FOV
// against a reference (e.g. csnades) screenshot.
// Usage: MAP=dust2 SETPOS="setpos ...; setang ..." W=1912 H=964 node tools/render-view.mjs
import puppeteer from 'puppeteer-core';
const OUT = process.env.OUT_DIR || '/private/tmp/claude-501/-Users-amarsmajlovic-Desktop-smoke-practice-threejs/cfadb422-6a01-4775-a0b2-e4d5a00842b3/scratchpad';
const URL = process.env.APP_URL || 'http://localhost:5173';
const MAP = process.env.MAP || 'dust2';
const SETPOS = process.env.SETPOS;
const W = +(process.env.W || 1912), H = +(process.env.H || 964); // 16:9-ish browser content

const browser = await puppeteer.launch({
    headless: 'new', channel: 'chrome', protocolTimeout: 600000,
    userDataDir: `${OUT}/pptr-profile`, args: ['--no-sandbox', '--no-first-run'],
});
const page = await browser.newPage();
await page.setViewport({ width: W, height: H });
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => !!window.__debug, { timeout: 120000 });
await page.evaluate((m) => window.__debug.startGame(m), MAP);
await page.waitForFunction(() => window.__debug?.mapLoader?.nadeCollider, { timeout: 300000 });
await new Promise((r) => setTimeout(r, 2500)); // let textures stream in
const info = await page.evaluate((SETPOS) => {
    const { applySetposString, camera, THREE } = window.__debug;
    applySetposString(SETPOS);
    // hide any overlay so we see the game
    document.querySelectorAll('.overlay').forEach((o) => o.classList.add('hidden'));
    const d = new THREE.Vector3(); camera.getWorldDirection(d);
    return { fov: camera.fov.toFixed(1), aspect: camera.aspect.toFixed(3), dir: `(${d.x.toFixed(3)}, ${d.y.toFixed(3)}, ${d.z.toFixed(3)})` };
}, SETPOS);
await new Promise((r) => setTimeout(r, 600));
await page.screenshot({ path: `${OUT}/view.png` });
console.log('camera fov(vertical)', info.fov, 'aspect', info.aspect, 'worldDir', info.dir, `-> view.png (${W}x${H})`);
await browser.close();
