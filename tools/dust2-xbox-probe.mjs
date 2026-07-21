// Probe the dust2 xbox region: drop a grenade on a fine grid and print the
// rest-height map, so we can see how tall our collider thinks the box is vs the
// ground-truth smoke rest height (~app y +50 from the demos).
// Usage: node tools/dust2-xbox-probe.mjs
import puppeteer from 'puppeteer-core';
const OUT = process.env.OUT_DIR || '/private/tmp/claude-501/-Users-amarsmajlovic-Desktop-smoke-practice-threejs/cfadb422-6a01-4775-a0b2-e4d5a00842b3/scratchpad';
const URL = process.env.APP_URL || 'http://localhost:5173';

const browser = await puppeteer.launch({
    headless: 'new', channel: 'chrome', protocolTimeout: 600000,
    userDataDir: `${OUT}/pptr-profile`, args: ['--no-sandbox', '--no-first-run'],
});
const page = await browser.newPage();
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => !!window.__debug, { timeout: 120000 });
await page.evaluate(() => window.__debug.startGame('dust2'));
await page.waitForFunction(() => window.__debug?.mapLoader?.nadeCollider, { timeout: 300000 });
await new Promise((r) => setTimeout(r, 1500));

const out = await page.evaluate(() => {
    const { THREE, CS2, grenades, mapLoader } = window.__debug;
    // app region over the xbox (x = game y, z = game x)
    const X0 = 1420, X1 = 1760, Z0 = -580, Z1 = -360, STEP = 20;
    const restAt = (ax, az) => {
        const pos = new THREE.Vector3(ax, 400, az), v = new THREE.Vector3();
        const nade = { position: pos, velocity: v, rolling: false, age: 0 };
        let s = 0; while (grenades.stepProjectile(nade, CS2.TICK, false) && s < 64 * 12) s++;
        return s >= 64 * 12 ? null : pos.y;
    };
    const rows = [];
    for (let az = Z0; az <= Z1; az += STEP) {
        let row = `z${String(az).padStart(5)} `;
        for (let ax = X0; ax <= X1; ax += STEP) {
            const y = restAt(ax, az);
            row += y === null ? '  ..' : String(Math.round(y)).padStart(4);
        }
        rows.push(row);
    }
    let head = '        ';
    for (let ax = X0; ax <= X1; ax += STEP) head += String(ax).padStart(4);

    // raycast the collider straight down to get the true top face heights too
    const ray = new THREE.Raycaster();
    const topAt = (ax, az) => {
        ray.set(new THREE.Vector3(ax, 400, az), new THREE.Vector3(0, -1, 0));
        const hit = ray.intersectObject(mapLoader.nadeCollider, true)[0];
        return hit ? hit.point.y : null;
    };
    const tops = [];
    for (let az = -520; az <= -400; az += 20) {
        let row = `z${String(az).padStart(5)} `;
        for (let ax = 1480; ax <= 1700; ax += 20) {
            const y = topAt(ax, az);
            row += y === null ? '  ..' : String(Math.round(y)).padStart(5);
        }
        tops.push(row);
    }
    return { head, rows, tops };
});
await browser.close();
console.log('DROP-PROBE rest height (app y) over xbox region:');
console.log(out.head);
out.rows.forEach((r) => console.log(r));
console.log('\nRAYCAST-DOWN collider top face height (app y):');
out.tops.forEach((r) => console.log(r));
