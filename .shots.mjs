import puppeteer from 'puppeteer-core';
const SCRATCH = '/private/tmp/claude-501/-Users-amarsmajlovic-Desktop-smoke-practice-threejs/dd9f3544-152f-40f5-b14b-6865703998a4/scratchpad';
const browser = await puppeteer.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: 'new',
    args: ['--no-sandbox', '--use-gl=angle', '--window-size=1280,800', '--user-data-dir=/tmp/pup-profile-cs2'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 800 });
await page.goto('http://localhost:5173', { waitUntil: 'networkidle0', timeout: 120000 });
await page.evaluate(() => window.__debug.startGame('mirage'));
await page.waitForFunction(() => window.__debug.mapLoader.collider, { timeout: 120000 });
await page.evaluate(() => {
    for (const id of ['resume', 'loading', 'menu', 'crosshair', 'pos-display', 'hud-hint']) document.getElementById(id)?.classList.add('hidden');
    document.querySelector('.lil-gui')?.style.setProperty('display', 'none');
    window.__debug.camera.children.forEach(c => c.visible = false);
});
const spots = [
    // [camX, camY, camZ, lookX, lookY, lookZ, name]
    [-500, 300, 500, -1200, -150, -700, 'spot-a'],      // over T toward mid
    [-1400, 250, -1300, -600, -150, -300, 'spot-b'],    // over CT toward mid
    [-136, 120, 800, -700, -100, -900, 'spot-c'],       // T spawn street toward mid
    [-2200, 350, -800, -900, -150, -900, 'spot-d'],     // high above A-ish toward mid
    [-864, 500, 1100, -900, -100, -1400, 'spot-e'],     // high above T looking across map
];
for (const [cx, cy, cz, lx, ly, lz, name] of spots) {
    await page.evaluate(([cx, cy, cz, lx, ly, lz]) => {
        const { camera } = window.__debug;
        camera.position.set(cx, cy, cz);
        camera.lookAt(lx, ly, lz);
        camera.updateMatrixWorld(true);
    }, [cx, cy, cz, lx, ly, lz]);
    await new Promise(r => setTimeout(r, 350));
    await page.screenshot({ path: `${SCRATCH}/${name}.png` });
}
console.log('shots done');
await browser.close();
