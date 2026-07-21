// Collider integrity sweep — no ground truth / demos needed.
// Drops a grenade straight down from a dense grid over the whole map and flags
// cells where it never comes to rest (falls through a hole into the void) or
// rests far below its neighbours (fell through a small gap onto lower geometry).
// Uses the SHIPPED collision (window.__debug.grenades + mapLoader.nadeCollider)
// so it exercises exactly what the app does. Renders a top-down heatmap PNG and
// prints hole clusters in game coordinates.
//
// Usage: node tools/collider-integrity-sweep.mjs [dust2|inferno|mirage] [gridN]
import puppeteer from 'puppeteer-core';

const MAP = process.argv[2] || 'dust2';
const N = +(process.argv[3] || 90);
const OUT = process.env.OUT_DIR || '/private/tmp/claude-501/-Users-amarsmajlovic-Desktop-smoke-practice-threejs/cfadb422-6a01-4775-a0b2-e4d5a00842b3/scratchpad';
const URL = process.env.APP_URL || 'http://localhost:5173';

const browser = await puppeteer.launch({
    headless: 'new', channel: 'chrome', protocolTimeout: 600000,
    userDataDir: `${OUT}/pptr-profile`,
    args: ['--no-sandbox', '--no-first-run', '--no-default-browser-check'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1000, height: 1000 });
page.on('console', (m) => { const t = m.text(); if (t.startsWith('SWEEP')) console.log(t); });
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => !!window.__debug, { timeout: 120000 });
await page.evaluate((m) => window.__debug.startGame(m), MAP);
await page.waitForFunction(() => window.__debug?.mapLoader?.nadeCollider, { timeout: 300000 });
await new Promise((r) => setTimeout(r, 1500));

const data = await page.evaluate((N) => {
    const d = window.__debug;
    const { THREE, CS2, grenades, mapLoader } = d;

    // world bounds of the nade collider
    const box = new THREE.Box3().setFromObject(mapLoader.nadeCollider);
    const min = box.min, max = box.max;
    const startY = max.y - 2;                 // drop from just under the top
    const voidY = min.y - 50;                 // below this = escaped the world
    const CAP = 64 * 10;                       // ticks before we call it "never rests"

    const drop = (ax, az) => {
        const pos = new THREE.Vector3(ax, startY, az);
        const v = new THREE.Vector3(0, 0, 0);
        const nade = { position: pos, velocity: v, rolling: false, age: 0 };
        let t = 0, alive = true;
        while (alive && t < CAP) { alive = grenades.stepProjectile(nade, CS2.TICK, false); t++; }
        if (alive || pos.y < voidY) return { hole: true, y: pos.y };
        return { hole: false, y: pos.y };
    };

    // app.x spans max.x..min.x, app.z spans max.z..min.z. Report in GAME coords:
    // game.x = app.z, game.y = app.x, height = app.y.
    const cells = [];
    let holes = 0, rested = 0;
    let ys = [];
    for (let iz = 0; iz < N; iz++) {
        for (let ix = 0; ix < N; ix++) {
            const ax = min.x + (max.x - min.x) * (ix + 0.5) / N;
            const az = min.z + (max.z - min.z) * (iz + 0.5) / N;
            const r = drop(ax, az);
            cells.push({ ix, iz, ax, az, hole: r.hole, y: r.y });
            if (r.hole) holes++; else { rested++; ys.push(r.y); }
        }
    }
    ys.sort((a, b) => a - b);
    const med = ys.length ? ys[ys.length >> 1] : 0;
    const yLo = ys.length ? ys[Math.floor(ys.length * 0.02)] : 0;
    const yHi = ys.length ? ys[Math.floor(ys.length * 0.98)] : 1;

    // draw a top-down heatmap
    const PX = 900, cell = PX / N;
    const cv = document.createElement('canvas');
    cv.width = PX; cv.height = PX; cv.id = 'sweep-canvas';
    document.body.appendChild(cv);
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#0b0d10'; ctx.fillRect(0, 0, PX, PX);
    for (const c of cells) {
        // image x from app.z (game x), image y from app.x (game y)
        const px = (max.z - c.az) / (max.z - min.z) * PX;
        const py = (max.x - c.ax) / (max.x - min.x) * PX;
        if (c.hole) ctx.fillStyle = '#ff2d2d';
        else {
            const t = Math.max(0, Math.min(1, (c.y - yLo) / (yHi - yLo || 1)));
            const g = Math.round(60 + 150 * t);
            ctx.fillStyle = `rgb(${30},${g},${Math.round(70 + 60 * (1 - t))})`;
        }
        ctx.fillRect(px - cell / 2, py - cell / 2, cell + 1, cell + 1);
    }

    // cluster hole cells into rectangles (coarse: merge adjacent by grid flood)
    const holeSet = new Set(cells.filter((c) => c.hole).map((c) => c.iz * N + c.ix));
    const seen = new Set(); const clusters = [];
    const idx = (x, z) => z * N + x;
    for (const c of cells) {
        if (!c.hole || seen.has(idx(c.ix, c.iz))) continue;
        const stack = [[c.ix, c.iz]]; seen.add(idx(c.ix, c.iz));
        let minGX = 1e9, maxGX = -1e9, minGY = 1e9, maxGY = -1e9, n = 0;
        while (stack.length) {
            const [x, z] = stack.pop(); n++;
            const cc = cells[idx(x, z)];
            const gx = cc.az, gy = cc.ax; // game x = app z, game y = app x
            minGX = Math.min(minGX, gx); maxGX = Math.max(maxGX, gx);
            minGY = Math.min(minGY, gy); maxGY = Math.max(maxGY, gy);
            for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                const nx = x + dx, nz = z + dz;
                if (nx < 0 || nz < 0 || nx >= N || nz >= N) continue;
                if (holeSet.has(idx(nx, nz)) && !seen.has(idx(nx, nz))) { seen.add(idx(nx, nz)); stack.push([nx, nz]); }
            }
        }
        clusters.push({ n, gx: [Math.round(minGX), Math.round(maxGX)], gy: [Math.round(minGY), Math.round(maxGY)] });
    }
    clusters.sort((a, b) => b.n - a.n);

    return {
        N, total: cells.length, holes, rested,
        pct: (100 * holes / cells.length).toFixed(1),
        bbox: { gx: [Math.round(min.z), Math.round(max.z)], gy: [Math.round(min.x), Math.round(max.x)], h: [Math.round(min.y), Math.round(max.y)] },
        clusters: clusters.slice(0, 20),
        png: cv.toDataURL('image/png'),
    };
}, N);

console.log(`\n=== ${MAP} collider integrity — ${N}x${N} grid (${data.total} probes) ===`);
console.log(`holes (fell through): ${data.holes}  (${data.pct}%)   rested: ${data.rested}`);
console.log(`map bbox game: x ${data.bbox.gx.join('..')}  y ${data.bbox.gy.join('..')}  height ${data.bbox.h.join('..')}`);
console.log(`\ntop hole clusters (game coords, biggest first):`);
for (const c of data.clusters) {
    console.log(`  ${String(c.n).padStart(4)} cells   x[${c.gx.join(', ')}]  y[${c.gy.join(', ')}]`);
}

const { writeFileSync } = await import('node:fs');
writeFileSync(`${OUT}/integrity-${MAP}.png`, Buffer.from(data.png.split(',')[1], 'base64'));
console.log(`\nheatmap -> integrity-${MAP}.png (red = hole, green ramp = rest height)`);
await browser.close();
