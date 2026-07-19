// Sweep hot-bounce restitution and vy cap over the xbox lineup: which combo
// lands the smoke ON the box (game z ~ -26, gy 1390..1475)?
import puppeteer from 'puppeteer-core';

const browser = await puppeteer.launch({ headless: 'new', channel: 'chrome', protocolTimeout: 600000 });
const page = await browser.newPage();
await page.emulate({
    viewport: { width: 800, height: 600, isMobile: true, hasTouch: true },
    userAgent: 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
});
page.on('pageerror', (e) => console.log('PAGE ERROR:', e.message));
await page.goto('http://localhost:5173', { waitUntil: 'networkidle0', timeout: 60000 });
await page.waitForFunction(() => !!window.__debug, { timeout: 60000 });
await page.evaluate(() => window.__debug.startGame('dust2'));
await page.waitForFunction(() => window.__debug?.mapLoader?.nadeCollider, { timeout: 240000 });
await new Promise((r) => setTimeout(r, 1200));

const rows = await page.evaluate(() => {
    const d = window.__debug;
    const { THREE, CS2, grenades } = d;
    const run = () => {
        const rt = CS2.jumpthrowReleaseTime;
        const vyRel = CS2.jumpImpulse - CS2.gravity * rt;
        const rise = CS2.jumpImpulse * rt - 0.5 * CS2.gravity * rt * rt;
        const eye = new THREE.Vector3(-1161.931030, 136.256561 + rise, -299.968750);
        const yawRad = THREE.MathUtils.degToRad(90.546722);
        const fwdH = new THREE.Vector3(Math.sin(yawRad), 0, Math.cos(yawRad));
        const pos = new THREE.Vector3(), v = new THREE.Vector3();
        grenades.computeThrow(eye, fwdH, -16.521105, 1.0, new THREE.Vector3(0, vyRel, 0), pos, v);
        const nade = { position: pos, velocity: v, rolling: false, age: 0 };
        let ticks = 0;
        while (grenades.stepProjectile(nade, CS2.TICK, false) && ticks < 64 * 12) ticks++;
        return { gy: +pos.x.toFixed(0), gz: +pos.y.toFixed(0), t: +(ticks / 64).toFixed(2) };
    };
    const out = [];
    const origHot = CS2.nadeElasticityHot, origCap = CS2.nadeBounceVyCap;
    for (const hot of [0.29, 0.33, 0.36, 0.40, 0.45]) {
        for (const cap of [230, 245, 260]) {
            CS2.nadeElasticityHot = hot;
            CS2.nadeBounceVyCap = cap;
            const r = run();
            const onBox = r.gz > -35 && r.gy > 1380 && r.gy < 1480;
            out.push(`hot=${hot} cap=${cap} -> rest gy=${r.gy} gz=${r.gz} t=${r.t} ${onBox ? '<<< NA KUTIJI' : ''}`);
        }
    }
    CS2.nadeElasticityHot = origHot;
    CS2.nadeBounceVyCap = origCap;
    return out;
});
rows.forEach((r) => console.log(r));
await browser.close();
