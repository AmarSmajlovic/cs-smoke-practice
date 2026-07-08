import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import GUI from 'lil-gui';
import { MapLoader, MAPS } from './mapLoader.js';
import { Player } from './player.js';
import { GrenadeSystem } from './grenades.js';
import { CS2, tuning } from './physicsConfig.js';

// ---------------------------------------------------------------- State
const isMobile = 'ontouchstart' in window && matchMedia('(pointer: coarse)').matches;
if (isMobile) document.body.classList.add('mobile');

let gameState = 'menu'; // menu | loading | playing | paused
let spawnChoice = 'T';
let mapDef = null;
let map = null;
const spawnPoint = new THREE.Vector3(0, 200, 0);

const $ = (id) => document.getElementById(id);
const show = (id) => $(id).classList.remove('hidden');
const hide = (id) => $(id).classList.add('hidden');

// ---------------------------------------------------------------- Scene
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87ceeb);

// CS2: 90° horizontal FOV at 4:3 = 73.74° vertical; portrait keeps a wide view
const camera = new THREE.PerspectiveCamera(73.74, window.innerWidth / window.innerHeight, 1, 30000);
scene.add(camera);

function applyFov() {
    // CS2 behavior: vertical FOV fixed, wider screens see more horizontally
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.fov = 73.74;
    camera.updateProjectionMatrix();
}
applyFov();

const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
$('canvas-container').appendChild(renderer.domElement);

// Calibrated for three's physical lighting mode (r155+)
scene.add(new THREE.HemisphereLight(0xe8f0ff, 0x8a7a60, 2.0));
const dirLight = new THREE.DirectionalLight(0xfff2dd, 1.1);
dirLight.position.set(2000, 4000, 1500);
scene.add(dirLight);

// ---------------------------------------------------------------- Look controls
const controls = new PointerLockControls(camera, renderer.domElement);
controls.addEventListener('unlock', () => {
    if (gameState === 'playing') pauseGame();
});
// Desktop resume completes only when the pointer actually locks — browsers
// enforce a ~1.5s cooldown after ESC, so a too-quick click can be rejected
controls.addEventListener('lock', () => {
    if (gameState === 'paused') {
        hide('resume');
        gameState = 'playing';
    }
});
document.addEventListener('pointerlockerror', () => {
    if (gameState === 'paused') {
        document.querySelector('#resume h2').textContent = 'WAIT A SECOND, THEN CLICK AGAIN';
    }
});

// JS fallback for the rotate overlay (iOS quirks with the CSS media query)
function updateOrientationClass() {
    if (!isMobile) return;
    document.body.classList.toggle('portrait', window.innerHeight > window.innerWidth);
}
updateOrientationClass();
window.addEventListener('orientationchange', () => setTimeout(updateOrientationClass, 120));

// Mobile look: drag on the right side of the screen
const mobileLook = { euler: new THREE.Euler(0, 0, 0, 'YXZ'), active: false, id: -1, lastX: 0, lastY: 0 };
const LOOK_SENS = 0.0042;

function setupMobileLook() {
    const zone = $('look-zone');
    zone.addEventListener('touchstart', (e) => {
        if (mobileLook.id !== -1) return;
        const t = e.changedTouches[0];
        mobileLook.id = t.identifier;
        mobileLook.lastX = t.clientX;
        mobileLook.lastY = t.clientY;
    }, { passive: true });
    zone.addEventListener('touchmove', (e) => {
        for (const t of e.changedTouches) {
            if (t.identifier !== mobileLook.id) continue;
            const dx = t.clientX - mobileLook.lastX;
            const dy = t.clientY - mobileLook.lastY;
            mobileLook.lastX = t.clientX;
            mobileLook.lastY = t.clientY;
            mobileLook.euler.setFromQuaternion(camera.quaternion);
            mobileLook.euler.y -= dx * LOOK_SENS;
            mobileLook.euler.x -= dy * LOOK_SENS;
            mobileLook.euler.x = THREE.MathUtils.clamp(mobileLook.euler.x, -Math.PI / 2 + 0.01, Math.PI / 2 - 0.01);
            camera.quaternion.setFromEuler(mobileLook.euler);
        }
        e.preventDefault();
    }, { passive: false });
    const end = (e) => {
        for (const t of e.changedTouches) if (t.identifier === mobileLook.id) mobileLook.id = -1;
    };
    zone.addEventListener('touchend', end);
    zone.addEventListener('touchcancel', end);
}

// Mobile D-pad: hold/slide a finger over the arrows; diagonals work
const dpadInput = { fwd: 0, side: 0 };
function setupDpad() {
    const pad = $('dpad');
    const arrows = {
        up: pad.querySelector('[data-d="up"]'),
        down: pad.querySelector('[data-d="down"]'),
        left: pad.querySelector('[data-d="left"]'),
        right: pad.querySelector('[data-d="right"]'),
    };
    let touchId = -1;

    const apply = (clientX, clientY) => {
        const r = pad.getBoundingClientRect();
        const dx = (clientX - (r.left + r.width / 2)) / (r.width / 2);
        const dy = (clientY - (r.top + r.height / 2)) / (r.height / 2);
        dpadInput.side = Math.abs(dx) > 0.28 ? Math.sign(dx) : 0;
        dpadInput.fwd = Math.abs(dy) > 0.28 ? -Math.sign(dy) : 0;
        arrows.up.classList.toggle('on', dpadInput.fwd > 0);
        arrows.down.classList.toggle('on', dpadInput.fwd < 0);
        arrows.left.classList.toggle('on', dpadInput.side < 0);
        arrows.right.classList.toggle('on', dpadInput.side > 0);
    };
    const clear = () => {
        touchId = -1;
        dpadInput.fwd = dpadInput.side = 0;
        for (const a of Object.values(arrows)) a.classList.remove('on');
    };

    pad.addEventListener('touchstart', (e) => {
        if (touchId === -1) {
            const t = e.changedTouches[0];
            touchId = t.identifier;
            apply(t.clientX, t.clientY);
        }
        e.preventDefault();
    }, { passive: false });
    pad.addEventListener('touchmove', (e) => {
        for (const t of e.changedTouches) {
            if (t.identifier === touchId) apply(t.clientX, t.clientY);
        }
        e.preventDefault();
    }, { passive: false });
    const end = (e) => {
        for (const t of e.changedTouches) if (t.identifier === touchId) clear();
    };
    pad.addEventListener('touchend', end);
    pad.addEventListener('touchcancel', end);
}

// ---------------------------------------------------------------- World
const mapLoader = new MapLoader(scene);
const player = new Player();
const grenades = new GrenadeSystem(scene, mapLoader);

function findSpawn() {
    const box = new THREE.Box3().setFromObject(map);
    const down = new THREE.Vector3(0, -1, 0);

    // Preferred: real spawn location for the chosen side
    const s = mapDef.spawns && mapDef.spawns[spawnChoice];
    if (s) {
        const hit = mapLoader.raycast(new THREE.Vector3(s.x, box.max.y + 10, s.z), down, box.max.y - box.min.y + 20);
        if (hit) {
            spawnPoint.set(s.x, hit.point.y + 2, s.z);
            console.log(`Spawn ${spawnChoice}:`, spawnPoint.x.toFixed(0), spawnPoint.y.toFixed(0), spawnPoint.z.toFixed(0));
            return;
        }
    }

    // Fallback: probe for a flat open floor near the center
    const up = new THREE.Vector3(0, 1, 0);
    const height = box.max.y - box.min.y;
    const candidates = [];
    const step = 150;
    for (let x = box.min.x + step; x < box.max.x; x += step) {
        for (let z = box.min.z + step; z < box.max.z; z += step) {
            const hit = mapLoader.raycast(new THREE.Vector3(x, box.max.y + 10, z), down, height + 20);
            if (!hit || Math.abs(hit.face.normal.y) < 0.95) continue;
            if (mapLoader.raycast(new THREE.Vector3(x, hit.point.y + 2, z), up, 160)) continue;
            candidates.push(new THREE.Vector3(x, hit.point.y, z));
        }
    }
    const center = box.getCenter(new THREE.Vector3());
    if (candidates.length) {
        const minY = Math.min(...candidates.map(c => c.y));
        const low = candidates.filter(c => c.y <= minY + 300);
        low.sort((a, b) => (a.x - center.x) ** 2 + (a.z - center.z) ** 2 - ((b.x - center.x) ** 2 + (b.z - center.z) ** 2));
        spawnPoint.copy(low[0]).setY(low[0].y + 2);
    } else {
        spawnPoint.set(center.x, box.max.y + 10, center.z);
    }
}

// ---------------------------------------------------------------- Game flow
// Best effort: keep the game in landscape on mobile, PUBG-style (Android
// supports the lock; on iOS the rotate overlay asks the user instead)
async function lockLandscape() {
    try {
        if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
            await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
        }
        if (screen.orientation && screen.orientation.lock) {
            await screen.orientation.lock('landscape');
        }
    } catch (e) { /* iOS Safari — CSS rotate overlay covers this */ }
}

async function startGame(mapKey) {
    if (isMobile) lockLandscape();
    mapDef = MAPS[mapKey];
    gameState = 'loading';
    hide('menu');
    $('load-map-name').textContent = (mapDef.name || mapKey).toUpperCase();
    setLoadProgress(0);
    $('load-status').textContent = 'Downloading map…';
    show('loading');

    try {
        map = await mapLoader.loadMap(mapDef, null, (stage, loaded, total) => {
            if (stage === 'download') {
                const mb = (loaded / 1048576).toFixed(1);
                if (total > 0) setLoadProgress(Math.min(90, (loaded / total) * 88));
                $('load-status').textContent = `Downloading map… ${mb} MB`;
            } else if (stage === 'build') {
                setLoadProgress(93);
                $('load-status').textContent = 'Building collision…';
            }
        });
    } catch (e) {
        console.error('Map load failed:', e);
        $('load-status').textContent = 'Failed to load the map :(';
        return;
    }

    setLoadProgress(100);
    findSpawn();
    player.spawn(spawnPoint.x, spawnPoint.y, spawnPoint.z);
    player.getEyePosition(camera.position);

    hide('loading');
    show('crosshair');
    show('pos-display');
    if (!isMobile) show('hud-hint');

    if (isMobile) {
        gameState = 'playing';
    } else {
        gameState = 'paused';
        showResume('CLICK "RESUME" TO PLAY');
    }
}

// Map image "fills in" with color as the download progresses
function setLoadProgress(pct) {
    $('load-fill').style.clipPath = `inset(0 ${100 - pct}% 0 0)`;
    $('load-pct').textContent = Math.round(pct) + '%';
}

function pauseGame() {
    if (gameState !== 'playing') return;
    gameState = 'paused';
    showResume('PAUSED');
}

function showResume(title) {
    document.querySelector('#resume h2').textContent = title;
    show('resume');
}

function resumeGame() {
    if (isMobile) {
        hide('resume');
        gameState = 'playing';
        return;
    }
    // stays paused until the 'lock' event actually fires (see listener above)
    controls.lock();
}

function backToMenu() {
    hide('resume');
    hide('crosshair');
    hide('pos-display');
    hide('hud-hint');
    grenades.clearAllSmokes();
    mapLoader.unload();
    map = null;
    gameState = 'menu';
    show('menu');
}

// Menu wiring
document.querySelector('.map-card.playable[data-map="mirage"]').addEventListener('click', () => {
    if (gameState === 'menu') startGame('mirage');
});
$('spawn-t').addEventListener('click', () => {
    spawnChoice = 'T';
    $('spawn-t').classList.add('active');
    $('spawn-ct').classList.remove('active');
});
$('spawn-ct').addEventListener('click', () => {
    spawnChoice = 'CT';
    $('spawn-ct').classList.add('active');
    $('spawn-t').classList.remove('active');
});
$('btn-resume').addEventListener('click', resumeGame);
$('btn-menu').addEventListener('click', backToMenu);

// ---------------------------------------------------------------- Viewmodel
let grenadeInHand = null;
let hasSmoke = true;
const vmBase = new THREE.Vector3(6.5, -5.5, -13);
let bobPhase = 0;
const sway = { x: 0, y: 0 };
let lastCamYaw = 0, lastCamPitch = 0;

(async function createGrenadeInHand() {
    try {
        const gltf = await new GLTFLoader().loadAsync('/models/smoke_grenade.glb');
        grenadeInHand = gltf.scene;
        grenadeInHand.scale.setScalar(0.035);
    } catch (e) {
        grenadeInHand = new THREE.Mesh(
            new THREE.SphereGeometry(1.2, 10, 10),
            new THREE.MeshLambertMaterial({ color: 0x4a5d4a })
        );
    }
    camera.add(grenadeInHand);
    grenadeInHand.position.copy(vmBase);
    grenadeInHand.rotation.set(0.3, -0.3, 0.1);
    grenadeInHand.visible = hasSmoke;
})();

function updateViewmodel(delta) {
    if (!grenadeInHand || !grenadeInHand.visible) return;

    // walk bob (classic CS-style figure-eight)
    const hSpeed = Math.hypot(player.velocity.x, player.velocity.z);
    const speedFactor = Math.min(hSpeed / CS2.maxspeed, 1);
    if (player.onGround && hSpeed > 5) {
        bobPhase += delta * 9.5 * speedFactor;
    }
    const bobX = Math.sin(bobPhase) * 0.55 * speedFactor;
    const bobY = -Math.abs(Math.cos(bobPhase)) * 0.4 * speedFactor;

    // sway: viewmodel lags behind camera rotation
    _vmEuler.setFromQuaternion(camera.quaternion);
    const yawDelta = _vmEuler.y - lastCamYaw;
    const pitchDelta = _vmEuler.x - lastCamPitch;
    lastCamYaw = _vmEuler.y;
    lastCamPitch = _vmEuler.x;
    sway.x += (THREE.MathUtils.clamp(yawDelta * 22, -1.4, 1.4) - sway.x) * Math.min(1, delta * 9);
    sway.y += (THREE.MathUtils.clamp(pitchDelta * 22, -1.4, 1.4) - sway.y) * Math.min(1, delta * 9);

    grenadeInHand.position.set(
        vmBase.x + bobX + sway.x,
        vmBase.y + bobY + sway.y,
        vmBase.z
    );
    grenadeInHand.rotation.set(0.3 + sway.y * 0.06, -0.3 + sway.x * 0.08, 0.1 + bobX * 0.04);
}
const _vmEuler = new THREE.Euler(0, 0, 0, 'YXZ');

// ---------------------------------------------------------------- Input
const keys = { w: false, a: false, s: false, d: false, shift: false, ctrl: false, space: false };

document.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    if (k in keys) keys[k] = true;
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') keys.shift = true;
    if (e.code === 'ControlLeft' || e.code === 'ControlRight') { keys.ctrl = true; e.preventDefault(); }
    if (e.code === 'Space') { keys.space = true; e.preventDefault(); }

    if (gameState !== 'playing') return;
    if (k === '4') {
        hasSmoke = !hasSmoke;
        if (grenadeInHand) grenadeInHand.visible = hasSmoke;
    }
    if (k === 'c') grenades.clearAllSmokes();
    if (k === 'r') player.spawn(spawnPoint.x, spawnPoint.y, spawnPoint.z);
});

document.addEventListener('keyup', (e) => {
    const k = e.key.toLowerCase();
    if (k in keys) keys[k] = false;
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') keys.shift = false;
    if (e.code === 'ControlLeft' || e.code === 'ControlRight') keys.ctrl = false;
    if (e.code === 'Space') keys.space = false;
});

// Throw: LMB = full, RMB = underhand, LMB+RMB = medium. Release to throw.
let leftHeld = false, rightHeld = false, bothWereHeld = false;

document.addEventListener('mousedown', (e) => {
    if (gameState !== 'playing' || isMobile || !controls.isLocked || !hasSmoke) return;
    if (e.button === 0) leftHeld = true;
    if (e.button === 2) rightHeld = true;
    if (leftHeld && rightHeld) bothWereHeld = true;
});

document.addEventListener('mouseup', (e) => {
    if (e.button !== 0 && e.button !== 2) return;
    const wasThrowing = leftHeld || rightHeld;
    const strength = bothWereHeld ? 0.5 : (leftHeld ? 1.0 : 0.0);
    if (e.button === 0) leftHeld = false;
    if (e.button === 2) rightHeld = false;
    if (leftHeld || rightHeld) return;

    if (wasThrowing && gameState === 'playing' && controls.isLocked && hasSmoke) {
        bothWereHeld = false;
        throwSmoke(strength);
    }
});

document.addEventListener('contextmenu', (e) => {
    if (controls.isLocked || isMobile) e.preventDefault();
});

const _euler = new THREE.Euler(0, 0, 0, 'YXZ');
const _fwdH = new THREE.Vector3();
const _fwdFull = new THREE.Vector3();
const _right = new THREE.Vector3();
const _eye = new THREE.Vector3();

function throwSmoke(strength) {
    if (!hasSmoke) return;
    _euler.setFromQuaternion(camera.quaternion);
    const sourcePitchDeg = -THREE.MathUtils.radToDeg(_euler.x); // Source: + is down

    camera.getWorldDirection(_fwdH);
    _fwdH.y = 0;
    _fwdH.normalize();

    grenades.throwGrenade(player.getEyePosition(_eye), _fwdH, sourcePitchDeg, strength, player.velocity);

    hasSmoke = false;
    if (grenadeInHand) grenadeInHand.visible = false;
    setTimeout(() => {
        hasSmoke = true;
        if (grenadeInHand) grenadeInHand.visible = true;
    }, 700);
}

// Mobile buttons
function setupMobileButtons() {
    const press = (id, down, up) => {
        const el = $(id);
        el.addEventListener('touchstart', (e) => { down(); e.preventDefault(); }, { passive: false });
        if (up) {
            el.addEventListener('touchend', (e) => { up(); e.preventDefault(); }, { passive: false });
            el.addEventListener('touchcancel', up);
        }
    };
    press('btn-jump', () => { keys.space = true; }, () => { keys.space = false; });
    press('btn-throw', () => {}, () => { if (gameState === 'playing') throwSmoke(1.0); });
    press('btn-clear', () => grenades.clearAllSmokes());
    press('btn-pause', () => { if (gameState === 'playing') pauseGame(); });
    // scripted jumpthrow: jump, release the nade on the way up
    press('btn-jt', () => {
        if (gameState !== 'playing') return;
        keys.space = true;
        setTimeout(() => { throwSmoke(1.0); }, 130);
        setTimeout(() => { keys.space = false; }, 300);
    });
}

if (isMobile) {
    setupMobileLook();
    setupDpad();
    setupMobileButtons();
    // Lock to landscape at the FIRST tap anywhere (browsers require a user
    // gesture before fullscreen/orientation APIs are allowed)
    const firstTouch = () => {
        lockLandscape();
        document.removeEventListener('touchend', firstTouch);
        document.removeEventListener('click', firstTouch);
    };
    document.addEventListener('touchend', firstTouch, { once: false });
    document.addEventListener('click', firstTouch, { once: false });
} else {
    renderer.domElement.addEventListener('click', () => {
        if (gameState === 'playing' && !controls.isLocked) controls.lock();
    });
}

// ---------------------------------------------------------------- Debug GUI
const gui = new GUI({ title: 'Debug' });
const nadeFolder = gui.addFolder('Grenade Tuning');
nadeFolder.add(tuning, 'throwSpeed', 400, 900, 5).name('Throw Speed (u/s)');
nadeFolder.add(tuning, 'nadeGravityScale', 0.2, 1.0, 0.05).name('Gravity Scale');
nadeFolder.add(tuning, 'elasticity', 0.1, 0.9, 0.05).name('Elasticity');
nadeFolder.add(tuning, 'velInherit', 0, 2, 0.05).name('Velocity Inherit');
nadeFolder.close();
const debugFolder = gui.addFolder('Debug');
debugFolder.add({ collider: false }, 'collider').name('Show Collider').onChange((v) => {
    if (mapLoader.colliderVisualizer) mapLoader.colliderVisualizer.visible = v;
});
debugFolder.close();
gui.close();
if (isMobile) gui.hide();

// ---------------------------------------------------------------- Main loop
const posDisplay = $('pos-display');
const clock = new THREE.Clock();
let accumulator = 0;
let frameCount = 0;
const input = { forwardMove: 0, sideMove: 0, jump: false, duck: false, walk: false };

function tickPhysics(dt) {
    camera.getWorldDirection(_fwdFull);
    _fwdH.copy(_fwdFull);
    _fwdH.y = 0;
    if (_fwdH.lengthSq() > 0) _fwdH.normalize();
    _right.crossVectors(_fwdH, camera.up);

    if (isMobile) {
        input.forwardMove = dpadInput.fwd;
        input.sideMove = dpadInput.side;
    } else {
        input.forwardMove = (keys.w ? 1 : 0) - (keys.s ? 1 : 0);
        input.sideMove = (keys.d ? 1 : 0) - (keys.a ? 1 : 0);
    }
    input.jump = keys.space;
    input.duck = keys.ctrl;
    input.walk = keys.shift;

    player.update(dt, input, _fwdH, _right, mapLoader.collider, _fwdFull, mapLoader.ladderZones);
    grenades.tick(dt);
}

const playingNow = () => gameState === 'playing' && (isMobile || controls.isLocked);

function animate() {
    requestAnimationFrame(animate);
    const delta = Math.min(clock.getDelta(), 0.1);
    frameCount++;

    if (playingNow() && mapLoader.collider) {
        accumulator += delta;
        while (accumulator >= CS2.TICK) {
            tickPhysics(CS2.TICK);
            accumulator -= CS2.TICK;
        }
        player.getEyePosition(camera.position);
        updateViewmodel(delta);
    }

    grenades.update(delta);

    if (frameCount % 10 === 0 && posDisplay && map) {
        const hSpeed = Math.hypot(player.velocity.x, player.velocity.z);
        posDisplay.textContent =
            `pos ${player.position.x.toFixed(0)} ${player.position.y.toFixed(0)} ${player.position.z.toFixed(0)}  ` +
            `vel ${hSpeed.toFixed(0)}${player.onLadder ? ' [ladder]' : ''}`;
    }

    renderer.render(scene, camera);
}

animate();

window.__debug = { player, mapLoader, grenades, CS2, tuning, camera, THREE, startGame };

window.addEventListener('resize', () => {
    applyFov();
    updateOrientationClass();
    renderer.setSize(window.innerWidth, window.innerHeight);
});
