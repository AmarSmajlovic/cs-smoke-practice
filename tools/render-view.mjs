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
if (process.env.COLLIDER) await page.evaluate(() => { window.__COLLIDER = 1; });
await new Promise((r) => setTimeout(r, 2500)); // let textures stream in
const info = await page.evaluate((SETPOS) => {
    const { applySetposString, camera, THREE } = window.__debug;
    applySetposString(SETPOS);
    // hide any overlay so we see the game
    document.querySelectorAll('.overlay').forEach((o) => o.classList.add('hidden'));
    if (window.__COLLIDER) {
        const ml = window.__debug.mapLoader;
        if (ml.colliderVisualizer) { ml.colliderVisualizer.visible = true; ml.colliderVisualizer.material.opacity = 0.55; ml.colliderVisualizer.material.color.set(0xff2fff); }
    }
    const d = new THREE.Vector3(); camera.getWorldDirection(d);
    return { fov: camera.fov.toFixed(1), aspect: camera.aspect.toFixed(3), dir: `(${d.x.toFixed(3)}, ${d.y.toFixed(3)}, ${d.z.toFixed(3)})` };
}, SETPOS);
await new Promise((r) => setTimeout(r, 600));
// re-apply right before the shot: headless has no pointer lock so the player
// can drift off the frozen spot in the idle loop
await page.evaluate(({ SETPOS, FOV }) => {
    const { applySetposString, player, camera } = window.__debug;
    applySetposString(SETPOS);
    player.getEyePosition(camera.position);
    if (FOV) { camera.fov = FOV; camera.updateProjectionMatrix(); }
}, { SETPOS, FOV: +(process.env.FOV || 0) });
await new Promise((r) => setTimeout(r, 120));
await page.screenshot({ path: `${OUT}/view.png` });
console.log('camera fov(vertical)', info.fov, 'aspect', info.aspect, 'worldDir', info.dir, `-> view.png (${W}x${H})`);
await browser.close();
