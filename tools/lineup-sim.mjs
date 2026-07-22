// Simulate one exact console lineup (setpos/setang) through every throw type,
// using the app's real setpos->camera convention, and report where each rests
// vs a reference point. For diagnosing a specific user-reported lineup.
// Usage: MAP=dust2 SETPOS="setpos x y z; setang p y r" REF="ax,ay,az" node tools/lineup-sim.mjs
import puppeteer from 'puppeteer-core';
const OUT = process.env.OUT_DIR || '/private/tmp/claude-501/-Users-amarsmajlovic-Desktop-smoke-practice-threejs/cfadb422-6a01-4775-a0b2-e4d5a00842b3/scratchpad';
const URL = process.env.APP_URL || 'http://localhost:5173';
const MAP = process.env.MAP || 'dust2';
const SETPOS = process.env.SETPOS;
const REF = (process.env.REF || '1600,50,-460').split(',').map(Number); // app x,y,z

const browser = await puppeteer.launch({
    headless: 'new', channel: 'chrome', protocolTimeout: 600000,
    userDataDir: `${OUT}/pptr-profile`, args: ['--no-sandbox', '--no-first-run'],
});
const page = await browser.newPage();
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => !!window.__debug, { timeout: 120000 });
await page.evaluate((m) => window.__debug.startGame(m), MAP);
await page.waitForFunction(() => window.__debug?.mapLoader?.nadeCollider, { timeout: 300000 });
await new Promise((r) => setTimeout(r, 1500));

if (process.env.HARD) await page.evaluateOnNewDocument(() => { window.__HARD = 1; });
if (process.env.HARD) await page.evaluate(() => { window.__HARD = 1; });
const out = await page.evaluate(({ SETPOS, REF }) => {
    const { THREE, CS2, grenades, player, camera, applySetposString, mapLoader } = window.__debug;
    if (window.__HARD) mapLoader.isSoftGround = () => false;
    applySetposString(SETPOS);
    player.getEyePosition(camera.position);
    const dir = new THREE.Vector3();
    camera.getWorldDirection(dir);
    const pitch = -THREE.MathUtils.radToDeg(Math.asin(Math.max(-1, Math.min(1, dir.y)))); // Source: + is down
    const fwdH = new THREE.Vector3(dir.x, 0, dir.z).normalize();
    const eye = player.getEyePosition(new THREE.Vector3());
    const want = new THREE.Vector3(REF[0], REF[1], REF[2]);

    const sim = (strength, jump) => {
        const e = eye.clone();
        let vel = new THREE.Vector3(0, 0, 0);
        if (jump) {
            const rT = CS2.jumpthrowReleaseTime;
            e.y += CS2.jumpImpulse * rT - 0.5 * CS2.gravity * rT * rT;
            vel = new THREE.Vector3(0, CS2.jumpImpulse - CS2.gravity * rT, 0);
        }
        const p = new THREE.Vector3(), v = new THREE.Vector3();
        grenades.computeThrow(e, fwdH, pitch, strength, vel, p, v);
        const nade = { position: p, velocity: v, rolling: false, age: 0 };
        let s = 0, prevVy = v.y; const bounces = [];
        while (grenades.stepProjectile(nade, CS2.TICK, false) && s < 64 * 14) {
            if (v.y > 0 && prevVy < 0) bounces.push({ x: p.x, y: p.y, z: p.z });
            prevVy = v.y; s++;
        }
        return { rest: p.clone(), err: p.distanceTo(want), nb: bounces.length, lastB: bounces[bounces.length - 1] };
    };
    const types = [['full', 1, 0], ['medium', 0.5, 0], ['lob', 0, 0], ['JT-full', 1, 1], ['JT-med', 0.5, 1], ['JT-lob', 0, 1]];
    const f = (v) => `(${v.x.toFixed(0)}, ${v.y.toFixed(0)}, ${v.z.toFixed(0)})`;
    return {
        eye: f(eye), pitch: pitch.toFixed(1), fwd: f(fwdH),
        rows: types.map(([n, s, j]) => {
            const r = sim(s, j);
            return `${n.padEnd(8)} rest ${f(r.rest)}  err ${r.err.toFixed(0).padStart(4)}u  bounces ${r.nb}${r.lastB ? ' last ' + f(new THREE.Vector3(r.lastB.x, r.lastB.y, r.lastB.z)) : ''}`;
        }),
    };
}, { SETPOS, REF });
await browser.close();
console.log(`\nlineup: ${SETPOS}`);
console.log(`eye ${out.eye}  pitch ${out.pitch}  fwdH ${out.fwd}   ref(box top) app ${REF.join(', ')}`);
console.log('rest by throw type (app x,y,z):');
out.rows.forEach((r) => console.log('  ' + r));
