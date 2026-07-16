// Visual iteration harness for the smoke cloud: spawns a smoke next to a wall,
// parks the camera, and screenshots the bloom at a few timestamps.
// Usage: node tools/smoke-shot.mjs <outDir> [gx gy gz]  (game coords of ground)
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';

const outDir = process.argv[2] || '/tmp/smoke-shots';
mkdirSync(outDir, { recursive: true });
// game coords -> app: (x=game y, y=game z, z=game x)
const g = process.argv.length >= 6
    ? { x: +process.argv[4], y: +process.argv[5], z: +process.argv[3] }
    : { x: -1744, y: -178, z: -685 }; // user's target area (near a wall)

const browser = await puppeteer.launch({ headless: 'new', channel: 'chrome' });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 800 });
page.on('pageerror', (e) => console.log('PAGE ERROR:', e.message));
await page.goto('http://localhost:5173', { waitUntil: 'networkidle0' });
await page.waitForFunction(() => !!window.__debug, { timeout: 60000 });
await page.evaluate(() => window.__debug.startGame('mirage'));
await page.waitForFunction(() => window.__debug?.mapLoader?.nadeCollider, { timeout: 120000 });
await new Promise((r) => setTimeout(r, 2500)); // let map visuals land

const info = await page.evaluate((g) => {
    const { grenades, mapLoader, camera, THREE } = window.__debug;
    // hide UI so shots show only the world (keep canvas + smoke fog overlay)
    const canvas = document.querySelector('canvas');
    document.querySelectorAll('body > *').forEach((el) => {
        if (el.id !== 'smoke-fog' && el !== canvas && !el.contains(canvas)) el.style.visibility = 'hidden';
    });
    const center = new THREE.Vector3(g.x, g.y, g.z);
    // snap to actual ground
    const down = mapLoader.raycastNade(center.clone().add(new THREE.Vector3(0, 80, 0)), new THREE.Vector3(0, -1, 0), 400);
    if (down) center.y = down.point.y;
    // find the nearest TALL wall (solid at 40u and 150u up) and tuck the
    // smoke 32u from it so climbing/banking shows
    let best = null;
    for (let a = 0; a < 24; a++) {
        const d = new THREE.Vector3(Math.cos(a / 24 * 6.283), 0, Math.sin(a / 24 * 6.283));
        const lo = mapLoader.raycastNade(center.clone().add(new THREE.Vector3(0, 40, 0)), d, 300);
        if (!lo || Math.abs(lo.face.normal.y) > 0.4) continue;
        const hi = mapLoader.raycastNade(center.clone().add(new THREE.Vector3(0, 150, 0)), d, 300);
        if (!hi || Math.abs(hi.distance - lo.distance) > 40) continue;
        if (!best || lo.distance < best.h.distance) best = { h: lo, d };
    }
    if (best) center.addScaledVector(best.d, Math.max(best.h.distance - 32, 0));
    grenades.clearAllSmokes();
    grenades.createSmoke(center.clone());
    // camera: to the SIDE of the wall-approach direction so the cloud and the
    // wall face are both visible, clamped in front of blocking geometry
    const side = best
        ? best.d.clone().cross(new THREE.Vector3(0, 1, 0)).normalize()
        : new THREE.Vector3(1, 0, 0);
    const camDir = side.clone().addScaledVector(best ? best.d : side, -0.5)
        .add(new THREE.Vector3(0, 0.45, 0)).normalize();
    const block = mapLoader.raycastNade(center.clone().add(new THREE.Vector3(0, 60, 0)), camDir, 440);
    const dist = block ? Math.max(block.distance - 20, 160) : 440;
    camera.position.copy(center).add(new THREE.Vector3(0, 60, 0)).addScaledVector(camDir, dist);
    camera.lookAt(center.x, center.y + 80, center.z);
    return { center: [center.x, center.y, center.z], wall: !!best, wallDist: best?.h.distance };
}, g);
console.log('smoke at app', info.center.map((v) => v.toFixed(0)).join(','), 'wall:', info.wall, info.wallDist?.toFixed(0));

for (const [t, name] of [[400, 't0400'], [1200, 't1200'], [4000, 't4000']]) {
    await new Promise((r) => setTimeout(r, t === 400 ? 400 : t - (t === 1200 ? 400 : 1200)));
    await page.screenshot({ path: `${outDir}/${name}.png` });
    console.log('shot', name);
}
// inside view: camera into the cloud centre
await page.evaluate(() => {
    const { grenades, camera } = window.__debug;
    const s = grenades.smokes[0];
    camera.position.copy(s.center);
});
await new Promise((r) => setTimeout(r, 300));
await page.screenshot({ path: `${outDir}/inside.png` });
console.log('shot inside');
await browser.close();
