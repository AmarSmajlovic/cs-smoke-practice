// Whole-map audit in one flyover: grid raycast top-down over the collider
// bounds, reporting (1) visual geometry with no player collision, (2) hits on
// untextured materials (no color map), (3) foliage clutter mesh names. Gives
// concrete map coordinates for every class of complaint.
import puppeteer from 'puppeteer-core';

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

await page.evaluate(() => {
    // one-time BVH on the visual meshes so the grid raycast is fast
    window.__debug.mapLoader.visualRoot.traverse((o) => {
        if (o.isMesh && o.geometry && !o.geometry.boundsTree) o.geometry.computeBoundsTree();
    });
});

const out = await page.evaluate(() => {
    const d = window.__debug;
    const { THREE } = d;
    const ray = new THREE.Raycaster();
    const down = new THREE.Vector3(0, -1, 0);
    const visRoot = d.mapLoader.visualRoot;
    const collider = d.mapLoader.collider;
    const bb = new THREE.Box3().setFromObject(collider);
    const noColl = [], noTex = {}, foliage = {};
    const folRe = /foliage|weed|grass|bush|sage|shrub|vine|ivy|leaf|leaves|plant/i;
    for (let x = bb.min.x; x <= bb.max.x; x += 50) {
        for (let z = bb.min.z; z <= bb.max.z; z += 50) {
            ray.set(new THREE.Vector3(x, bb.max.y + 100, z), down);
            ray.firstHitOnly = true;
            const v = ray.intersectObject(visRoot, true)[0];
            if (!v) continue;
            const name = v.object.name || '?';
            const mat = Array.isArray(v.object.material) ? v.object.material[v.face?.materialIndex ?? 0] : v.object.material;
            if (folRe.test(name) || folRe.test(mat?.name || '')) {
                const k = (mat?.name || name).slice(0, 50);
                foliage[k] = foliage[k] || { n: 0, at: `game(${z.toFixed(0)}, ${x.toFixed(0)})` };
                foliage[k].n++;
                continue; // foliage has no collision by design
            }
            if (mat && !mat.map) {
                const k = (mat.name || name).slice(0, 60);
                noTex[k] = noTex[k] || { n: 0, at: `game(${z.toFixed(0)}, ${x.toFixed(0)}, ${v.point.y.toFixed(0)})` };
                noTex[k].n++;
            }
            const c = ray.intersectObject(collider, true)[0];
            const cy = c ? c.point.y : -9999;
            if (v.point.y - cy >= 20) noColl.push({ at: `game(${z.toFixed(0)}, ${x.toFixed(0)})`, vy: +v.point.y.toFixed(0), cy: +cy.toFixed(0), mesh: name.slice(0, 55) });
        }
    }
    // horizontal pass: walls have no top-down footprint — scan at eye height
    const dirs = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, -1)];
    for (let x = bb.min.x; x <= bb.max.x; x += 100) {
        for (let z = bb.min.z; z <= bb.max.z; z += 100) {
            ray.set(new THREE.Vector3(x, bb.max.y + 100, z), down);
            ray.firstHitOnly = true;
            const ground = ray.intersectObject(collider, true)[0];
            if (!ground) continue;
            const eye = ground.point.y + 64;
            for (const dir of dirs) {
                ray.set(new THREE.Vector3(x, eye, z), dir);
                ray.far = 300;
                const v = ray.intersectObject(visRoot, true)[0];
                ray.far = Infinity;
                if (!v) continue;
                const mat = Array.isArray(v.object.material) ? v.object.material[v.face?.materialIndex ?? 0] : v.object.material;
                if (mat && !mat.map && !folRe.test(v.object.name || '') && !folRe.test(mat.name || '')) {
                    const k = (mat.name || v.object.name || '?').slice(0, 60);
                    noTex[k] = noTex[k] || { n: 0, at: `game(${v.point.z.toFixed(0)}, ${v.point.x.toFixed(0)}, ${v.point.y.toFixed(0)})` };
                    noTex[k].n++;
                }
            }
        }
    }
    return { noColl, noTex, foliage };
});
console.log('== BEZ KOLIZIJE (visual 20u+ iznad collidera):', out.noColl.length);
out.noColl.slice(0, 25).forEach((r) => console.log(`  ${r.at} vy=${r.vy} cy=${r.cy} | ${r.mesh}`));
console.log('== BEZ TEKSTURE (mat.map == null):');
Object.entries(out.noTex).sort((a, b) => b[1].n - a[1].n).slice(0, 20).forEach(([k, v]) => console.log(`  ${v.n}x ${k} npr ${v.at}`));
console.log('== FOLIAGE/KLATER:');
Object.entries(out.foliage).sort((a, b) => b[1].n - a[1].n).forEach(([k, v]) => console.log(`  ${v.n}x ${k} npr ${v.at}`));
await browser.close();
