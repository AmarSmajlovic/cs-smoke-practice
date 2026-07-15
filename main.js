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
let currentMapKey = null;
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

// Viewport locked to 16:9 (letterboxed) so the view matches CS2 videos and
// screenshots 1:1 regardless of the window shape — vertical FOV fixed at
// 73.74 (90 horizontal at 4:3), exactly like the game.
function applyFov() {
    const W = window.innerWidth, H = window.innerHeight;
    let w = W, h = Math.round(W * 9 / 16);
    if (h > H) { h = H; w = Math.round(H * 16 / 9); }
    renderer.setSize(w, h);
    const el = renderer.domElement;
    el.style.position = 'absolute';
    el.style.left = ((W - w) / 2) + 'px';
    el.style.top = ((H - h) / 2) + 'px';
    camera.aspect = 16 / 9;
    camera.fov = 73.74;
    camera.updateProjectionMatrix();
}

const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
$('canvas-container').appendChild(renderer.domElement);
$('canvas-container').style.background = '#000';
applyFov();

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

    // Preferred: real spawn location for the chosen side. The ray uses the
    // GRENADE collider (no player clips — those roof the spawns in the game
    // hulls) and starts below the sky plane.
    const s = mapDef.spawns && mapDef.spawns[spawnChoice];
    if (s) {
        const startY = Math.min(box.max.y + 10, 400);
        const hit = mapLoader.raycastNade(new THREE.Vector3(s.x, startY, s.z), down, startY - box.min.y + 20);
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
    currentMapKey = mapKey;
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
                // CDNs often hide Content-Length (compressed streams) -> fall
                // back to the known file size so the bar still moves
                const effTotal = total > 0 ? total : (mapDef.sizeMB ? mapDef.sizeMB * 1048576 : 0);
                if (effTotal > 0) setLoadProgress(Math.min(90, (loaded / effTotal) * 88));
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
    if (!isMobile) {
        show('hud-hint');
        show('throw-help');
    }

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
    renderLineups();
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
    hide('throw-help');
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
// held low in the bottom-right corner, tilted like a hand grip
const vmBase = new THREE.Vector3(7.8, -7.1, -12);
const vmRot = new THREE.Euler(0.55, -0.7, -0.18);
let bobPhase = 0;
const sway = { x: 0, y: 0 };
let lastCamYaw = 0, lastCamPitch = 0;

(async function createGrenadeInHand() {
    try {
        const gltf = await new GLTFLoader().loadAsync('/models/smoke_grenade.glb');
        grenadeInHand = gltf.scene;
        grenadeInHand.scale.setScalar(0.046);
    } catch (e) {
        grenadeInHand = new THREE.Mesh(
            new THREE.SphereGeometry(1.2, 10, 10),
            new THREE.MeshLambertMaterial({ color: 0x4a5d4a })
        );
    }
    camera.add(grenadeInHand);
    grenadeInHand.position.copy(vmBase);
    grenadeInHand.rotation.copy(vmRot);
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
    grenadeInHand.rotation.set(vmRot.x + sway.y * 0.06, vmRot.y + sway.x * 0.08, vmRot.z + bobX * 0.04);
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
    // use e.code: on macOS Option+F yields e.key "ƒ", not "f"
    if (e.code === 'KeyF') scriptedJumpthrow('bind', e);
    if (e.code === 'KeyG') scriptedJumpthrow('peak', e);
    if (e.code === 'KeyM') placeAimTarget();
    if (e.code === 'KeyN') solveAimFromHere(e.shiftKey ? 0.5 : e.altKey ? 0.0 : 1.0);
    if (k === 'c') { grenades.clearAllSmokes(); clearAimHelper(); }
    if (k === 'r') { player.spawn(spawnPoint.x, spawnPoint.y, spawnPoint.z); playerFrozen = false; }
    if (k === 'v') player.noclip = !player.noclip;
    if (k === 'l') saveLastThrow();
});

document.addEventListener('keyup', (e) => {
    const k = e.key.toLowerCase();
    if (k in keys) keys[k] = false;
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') keys.shift = false;
    if (e.code === 'ControlLeft' || e.code === 'ControlRight') keys.ctrl = false;
    if (e.code === 'Space') keys.space = false;
});

// Throw: LMB = full, RMB = underhand (lob), LMB+RMB = medium.
// A "gesture" collects every button pressed until ALL are released, then
// throws once — state always resets so a failed throw can't corrupt the next.
let leftHeld = false, rightHeld = false;
let gestureL = false, gestureR = false;

// Light up the matching row in the throw-help widget while buttons are held
function updateThrowHelp() {
    $('th-full').classList.toggle('act', leftHeld && !rightHeld);
    $('th-lob').classList.toggle('act', rightHeld && !leftHeld);
    $('th-med').classList.toggle('act', leftHeld && rightHeld);
}

document.addEventListener('mousedown', (e) => {
    if (gameState !== 'playing' || isMobile || !controls.isLocked) return;
    if (e.button === 0) { leftHeld = true; gestureL = true; }
    if (e.button === 2) { rightHeld = true; gestureR = true; }
    updateThrowHelp();
});

document.addEventListener('mouseup', (e) => {
    if (e.button !== 0 && e.button !== 2) return;
    if (e.button === 0) leftHeld = false;
    if (e.button === 2) rightHeld = false;
    updateThrowHelp();
    if (leftHeld || rightHeld) return; // wait until every button is released

    let strength = gestureL && gestureR ? 0.5 : gestureL ? 1.0 : gestureR ? 0.0 : null;
    // trackpad-friendly modifiers on a plain left click
    if (strength === 1.0 && e.shiftKey) strength = 0.5;
    else if (strength === 1.0 && e.altKey) strength = 0.0;
    gestureL = gestureR = false;

    if (strength !== null && gameState === 'playing' && controls.isLocked && hasSmoke) {
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

    // remember the stance for "save lineup"
    lastThrow = {
        map: currentMapKey,
        x: +player.position.x.toFixed(1),
        y: +player.position.y.toFixed(1),
        z: +player.position.z.toFixed(1),
        yaw: +_euler.y.toFixed(4),
        pitch: +_euler.x.toFixed(4),
        s: strength,
        jt: player.onGround ? 0 : 1,
    };
    $('lu-save').disabled = false;

    grenades.throwGrenade(player.getEyePosition(_eye), _fwdH, sourcePitchDeg, strength, player.velocity);

    hasSmoke = false;
    if (grenadeInHand) grenadeInHand.visible = false;
    setTimeout(() => {
        hasSmoke = true;
        if (grenadeInHand) grenadeInHand.visible = true;
    }, 700);
}

// Scripted jumpthrows, driven by the actual physics state instead of timers.
//  mode 'bind': release on the first airborne tick — the classic jumpthrow
//               bind; matches cs2utils.com lineups (verified: window smoke
//               lands inside window room with this timing)
//  mode 'peak': release at the top of the jump — "jump, throw at the highest
//               point" lineups (shorter, higher-clearance arcs)
// Throw strength: SHIFT = medium, ALT = lob (trackpad-friendly), or the
// mouse buttons held while pressing the key (both = medium, RMB = lob).
// The release itself happens inside tickPhysics (see below) so the timing
// is deterministic in ticks, like a CS2 bind — not frame-rate dependent.
let pendingJT = null;
function scriptedJumpthrow(mode = 'bind', e = null) {
    if (gameState !== 'playing' || !hasSmoke || pendingJT) return;
    const strength = (e?.shiftKey || (leftHeld && rightHeld)) ? 0.5
        : (e?.altKey || rightHeld) ? 0.0
        : 1.0;
    gestureL = gestureR = false; // consume the gesture: no double throw on mouseup
    keys.space = true;
    pendingJT = { mode, strength, airTicks: 0, totalTicks: 0 };
}

// Called once per 64Hz physics tick.
function tickScriptedJumpthrow() {
    if (!pendingJT) return;
    const jt = pendingJT;
    jt.totalTicks++;
    if (jt.totalTicks > 60) { // never left the ground: bail out
        pendingJT = null;
        keys.space = false;
        return;
    }
    if (player.onGround) return;
    jt.airTicks++;
    const ready = jt.mode === 'peak'
        ? player.velocity.y <= 20
        : jt.airTicks >= 2; // 2nd airborne tick lands the cs2utils window
                            // reference bounce within 5u (1 tick flies ~40u long)
    if (ready) {
        if (jt.mode === 'bind') {
            // CS2 subtick emulation: the bind releases at an exact time after
            // the jump, between our 64Hz ticks — use the exact inherited
            // velocity for the throw (the jump itself continues unaffected
            // apart from a sub-unit correction)
            player.velocity.y = CS2.jumpImpulse - CS2.gravity * CS2.jumpthrowReleaseTime;
        }
        throwSmoke(jt.strength);
        pendingJT = null;
        setTimeout(() => { keys.space = false; }, 120);
    }
}

// ------------------------------------------------------- setpos import
// Paste a CS2 console string (getpos / cs2utils.com) into the pause menu to
// teleport to the exact spot with the exact view angles. Coordinate mapping
// (verified against the cs2utils window lineup): our x = game y,
// our z = game x, height identical; getpos reports the EYE, so feet = z - 64.
// After a teleport the player is frozen at the EXACT imported position until
// they press a movement key — the capsule depenetration would otherwise nudge
// them off spots where the game hull fits tight against decorative trim.
let playerFrozen = false;
function applySetposString(str) {
    const m = str.match(/setpos\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)(?:.*?setang\s+(-?[\d.]+)\s+(-?[\d.]+))?/s);
    if (!m || !map) return false;
    const gy = +m[2], gx = +m[1], gz = +m[3];
    const ox = gy, oz = gx;
    let oy = gz - CS2.eyeStand;
    // getpos reports the exact eye — trust it to the decimal, NO floor snap:
    // the player is frozen at this spot until they move, so the view matches
    // the game 1:1 even when they stood on a prop/ledge our ray would miss
    // (a snap once pulled a lineup 80u down to the ground below the ledge).
    player.position.set(ox, oy, oz);
    player.velocity.set(0, 0, 0);
    if (m[4] !== undefined) {
        const gPitch = +m[4];
        const gYaw = +m[5] * Math.PI / 180;
        const oYaw = Math.atan2(-Math.sin(gYaw), -Math.cos(gYaw));
        camera.rotation.order = 'YXZ';
        camera.rotation.set(-gPitch * Math.PI / 180, oYaw, 0);
    }
    player.getEyePosition(camera.position);
    playerFrozen = true;
    return true;
}

{
    const input = $('setpos-input');
    const go = () => {
        if (applySetposString(input.value)) {
            input.value = '';
            toast('📍 Teleported to the lineup spot');
            resumeGame();
        } else {
            toast('Could not parse — expected "setpos x y z; setang p y r"');
        }
    };
    $('setpos-go').addEventListener('click', go);
    // keep WASD state clean while typing in the input
    input.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Enter') go();
    });
    input.addEventListener('keyup', (e) => e.stopPropagation());
}

// ---------------------------------------------------------------- Aim helper
// M with the crosshair on a spot = "the smoke should land HERE". The solver
// finds the exact pitch/yaw for the current throw type (SHIFT/ALT modifiers
// pick medium/lob) and shows: a ring on the target, a green dot to put the
// crosshair on, and the predicted trajectory. C clears it.
const _simPos = new THREE.Vector3();
const _simVel = new THREE.Vector3();
const _simMove = new THREE.Vector3();
const _simDir = new THREE.Vector3();
const _zeroVel = new THREE.Vector3();

// Integrate one throw exactly like stepProjectile's flight phase; returns the
// first collider hit (or null) and optionally collects points for the preview
function simulateFlight(eye, fwdH, pitchDeg, strength, outPoints = null) {
    grenades.computeThrow(eye, fwdH, pitchDeg, strength, _zeroVel, _simPos, _simVel);
    const dt = CS2.TICK, g = CS2.gravity * tuning.nadeGravityScale;
    if (outPoints) outPoints.push(_simPos.clone());
    for (let i = 0; i < 64 * 12; i++) {
        _simVel.y -= g * dt * 0.5;
        _simMove.copy(_simVel).multiplyScalar(dt);
        const dist = _simMove.length();
        if (dist < 1e-6) break;
        _simDir.copy(_simMove).divideScalar(dist);
        const hit = mapLoader.raycastNade(_simPos, _simDir, dist + CS2.nadeRadius);
        if (hit) {
            _simPos.copy(hit.point);
            if (outPoints) outPoints.push(_simPos.clone());
            return _simPos;
        }
        _simPos.add(_simMove);
        _simVel.y -= g * dt * 0.5;
        if (outPoints && i % 3 === 0) outPoints.push(_simPos.clone());
    }
    return null;
}

// Find pitch/yaw so the first touch lands on target (standing throw)
function solveAim(target, strength) {
    const eye = player.getEyePosition(new THREE.Vector3());
    const yawRad = Math.atan2(-(target.x - eye.x), -(target.z - eye.z));
    const fwdH = new THREE.Vector3(-Math.sin(yawRad), 0, -Math.cos(yawRad));
    let best = null;
    const tryPitch = (p) => {
        const end = simulateFlight(eye, fwdH, p, strength);
        if (!end) return;
        const err = end.distanceTo(target);
        if (!best || err < best.err) best = { pitch: p, err };
    };
    for (let p = 40; p >= -88; p -= 1) tryPitch(p);
    if (!best) return null;
    const coarse = best.pitch;
    for (let p = coarse - 0.9; p <= coarse + 0.9; p += 0.1) tryPitch(p);
    return { pitch: best.pitch, yawDeg: THREE.MathUtils.radToDeg(yawRad), err: best.err, eye, fwdH };
}

const lineupHelper = { ring: null, ghost: null, line: null, target: null };

function clearAimHelper(keepTarget = false) {
    const kinds = keepTarget ? ['ghost', 'line'] : ['ring', 'ghost', 'line'];
    for (const k of kinds) {
        if (lineupHelper[k]) {
            scene.remove(lineupHelper[k]);
            lineupHelper[k].geometry?.dispose();
            lineupHelper[k].material?.dispose();
            lineupHelper[k] = null;
        }
    }
    if (!keepTarget) lineupHelper.target = null;
}

// M: mark "the smoke should land HERE" (stand there / look at the spot)
function placeAimTarget() {
    camera.getWorldDirection(_fwdFull);
    const hit = mapLoader.raycast(camera.position, _fwdFull, 20000);
    if (!hit) { toast('Aim at the landing spot first, then press M'); return; }
    clearAimHelper();
    lineupHelper.target = hit.point.clone();

    const ring = new THREE.Mesh(
        new THREE.TorusGeometry(14, 1.6, 8, 40),
        new THREE.MeshBasicMaterial({ color: 0xff4444, depthTest: false, transparent: true, opacity: 0.9 })
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.copy(lineupHelper.target).y += 2;
    ring.renderOrder = 998;
    scene.add(ring);
    lineupHelper.ring = ring;
    toast('🎯 Target set — go to the throw spot and press N (SHIFT/ALT = medium/lob)');
}

// N: from where I stand now, compute the aim that lands on the marker
function solveAimFromHere(strength) {
    if (!lineupHelper.target) { toast('No target — aim at the landing spot and press M first'); return; }
    const sol = solveAim(lineupHelper.target, strength);
    clearAimHelper(true);

    const name = strength === 1 ? 'full' : strength === 0.5 ? 'medium' : 'lob';
    if (!sol || sol.err > 40) {
        toast(`No ${name} throw reaches the target from here (best miss ${sol ? sol.err.toFixed(0) : '∞'}u)`);
        return;
    }

    // green dot: put the crosshair exactly on it
    const p = THREE.MathUtils.degToRad(sol.pitch);
    const aimDir = sol.fwdH.clone().multiplyScalar(Math.cos(p));
    aimDir.y = -Math.sin(p);
    const ghost = new THREE.Mesh(
        new THREE.SphereGeometry(2.6, 12, 12),
        new THREE.MeshBasicMaterial({ color: 0x33ff66, depthTest: false, transparent: true, opacity: 0.95 })
    );
    ghost.position.copy(sol.eye).addScaledVector(aimDir, 250);
    ghost.renderOrder = 999;
    scene.add(ghost);
    lineupHelper.ghost = ghost;

    // predicted trajectory
    const pts = [];
    simulateFlight(sol.eye, sol.fwdH, sol.pitch, strength, pts);
    const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(pts),
        new THREE.LineBasicMaterial({ color: 0x33ff66, transparent: true, opacity: 0.55, depthTest: false })
    );
    line.renderOrder = 997;
    scene.add(line);
    lineupHelper.line = line;

    toast(`🎯 ${name}: aim pitch ${sol.pitch.toFixed(1)}, yaw ${sol.yawDeg.toFixed(1)} — put the crosshair on the green dot and throw`);
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
    press('btn-med', () => {}, () => { if (gameState === 'playing') throwSmoke(0.5); });
    press('btn-lob', () => {}, () => { if (gameState === 'playing') throwSmoke(0.0); });
    press('btn-clear', () => grenades.clearAllSmokes());
    press('btn-pause', () => { if (gameState === 'playing') pauseGame(); });
    press('btn-fly', () => { player.noclip = !player.noclip; $('btn-fly').classList.toggle('act', player.noclip); });
    press('btn-savelu', () => saveLastThrow());
    press('btn-jt', () => scriptedJumpthrow('bind'));
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

// ---------------------------------------------------------------- Lineups
// Saved as {id, name, map, x,y,z (feet), yaw, pitch (camera), s (strength), jt}
let lastThrow = null;
let toastTimer = 0;

function toast(msg) {
    const el = $('toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
}

const loadLineups = () => {
    try { return JSON.parse(localStorage.getItem('sp-lineups') || '[]'); }
    catch { return []; }
};
const storeLineups = (list) => localStorage.setItem('sp-lineups', JSON.stringify(list.slice(0, 50)));

function saveLastThrow() {
    if (!lastThrow) { toast('Throw a smoke first'); return; }
    const list = loadLineups();
    const lu = { id: Math.random().toString(36).slice(2, 9), name: `Lineup ${list.length + 1}`, ...lastThrow };
    list.unshift(lu);
    storeLineups(list);
    renderLineups();
    toast('Lineup saved 📌 (rename it in the pause menu)');
}

function lineupLink(lu) {
    const q = [lu.map, lu.x, lu.y, lu.z, lu.yaw, lu.pitch, lu.s, lu.jt].join(',');
    return `${location.origin}${location.pathname}#lu=${q}&n=${encodeURIComponent(lu.name)}`;
}

function applyLineup(lu) {
    player.spawn(lu.x, lu.y, lu.z);
    camera.quaternion.setFromEuler(new THREE.Euler(lu.pitch, lu.yaw, 0, 'YXZ'));
    player.getEyePosition(camera.position);
    const strengthName = lu.s === 1 ? 'FULL (LMB)' : lu.s === 0.5 ? 'MEDIUM (LMB+RMB)' : 'LOB (RMB)';
    toast(`${lu.name} — throw: ${strengthName}${lu.jt ? ' + JUMPTHROW' : ''}`);
}

function renderLineups() {
    const listEl = $('lu-list');
    const list = loadLineups().filter(l => l.map === currentMapKey);
    listEl.innerHTML = '';
    if (!list.length) {
        listEl.innerHTML = '<div class="lu-empty">No saved lineups on this map yet — throw a smoke, then hit SAVE (or press L right after a throw).</div>';
        return;
    }
    for (const lu of list) {
        const row = document.createElement('div');
        row.className = 'lu-item';
        const badges = (lu.jt ? '<span class="tag">JT</span>' : '') +
            (lu.s === 0.5 ? '<span class="tag">MED</span>' : lu.s === 0 ? '<span class="tag">LOB</span>' : '');
        row.innerHTML = `<span class="nm">${lu.name}</span>${badges}` +
            `<span class="ic" data-a="share" title="Copy share link">🔗</span>` +
            `<span class="ic" data-a="rename" title="Rename">✎</span>` +
            `<span class="ic" data-a="del" title="Delete">✕</span>`;
        row.querySelector('.nm').addEventListener('click', () => {
            applyLineup(lu);
            resumeGame();
        });
        row.querySelector('[data-a="share"]').addEventListener('click', () => {
            navigator.clipboard.writeText(lineupLink(lu)).then(
                () => toast('Share link copied 🔗'),
                () => toast(lineupLink(lu)));
        });
        row.querySelector('[data-a="rename"]').addEventListener('click', () => {
            const name = prompt('Lineup name:', lu.name);
            if (!name) return;
            const all = loadLineups();
            const t = all.find(l => l.id === lu.id);
            if (t) { t.name = name.slice(0, 40); storeLineups(all); renderLineups(); }
        });
        row.querySelector('[data-a="del"]').addEventListener('click', () => {
            storeLineups(loadLineups().filter(l => l.id !== lu.id));
            renderLineups();
        });
        listEl.appendChild(row);
    }
}

$('lu-save').addEventListener('click', saveLastThrow);
$('lu-save').disabled = true;

// Shared lineup in the URL: #lu=map,x,y,z,yaw,pitch,s,jt&n=name
let pendingLineup = null;
(function parseSharedLineup() {
    const m = location.hash.match(/lu=([^&]+)/);
    if (!m) return;
    const p = m[1].split(',');
    if (p.length < 8 || !MAPS[p[0]]) return;
    const nm = location.hash.match(/n=([^&]+)/);
    pendingLineup = {
        map: p[0], name: nm ? decodeURIComponent(nm[1]) : 'Shared lineup',
        x: +p[1], y: +p[2], z: +p[3], yaw: +p[4], pitch: +p[5], s: +p[6], jt: +p[7],
    };
})();

// ---------------------------------------------------------------- Debug GUI
const gui = new GUI({ title: 'Debug' });
const nadeFolder = gui.addFolder('Grenade Tuning');
nadeFolder.add(tuning, 'throwSpeed', 400, 900, 5).name('Throw Speed (u/s)');
nadeFolder.add(tuning, 'nadeGravityScale', 0.2, 1.0, 0.05).name('Gravity Scale');
nadeFolder.add(tuning, 'elasticity', 0.1, 0.9, 0.05).name('Elasticity (tangent)');
nadeFolder.add(tuning, 'elasticityVert', 0.1, 0.9, 0.02).name('Elasticity (vert)');
nadeFolder.add(tuning, 'velInherit', 0, 2, 0.05).name('Velocity Inherit');
nadeFolder.close();
const debugFolder = gui.addFolder('Debug');
debugFolder.add({ collider: false }, 'collider').name('Show Collider').onChange((v) => {
    if (mapLoader.colliderVisualizer) mapLoader.colliderVisualizer.visible = v;
});
debugFolder.add(player, 'noclip').name('Noclip (V)').listen();
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

    if (playerFrozen) {
        if (input.forwardMove || input.sideMove || input.jump || input.duck) playerFrozen = false;
    }
    if (!playerFrozen) {
        player.update(dt, input, _fwdH, _right, mapLoader.collider, _fwdFull, mapLoader.ladderZones);
    }
    tickScriptedJumpthrow();
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
        // view angles: pitch + is down (CS2 setang convention), yaw in degrees
        _euler.setFromQuaternion(camera.quaternion);
        const pitch = -THREE.MathUtils.radToDeg(_euler.x);
        const yaw = THREE.MathUtils.radToDeg(_euler.y);
        // world point under the crosshair (for lineup screenshots/calibration)
        camera.getWorldDirection(_fwdFull);
        const aimHit = mapLoader.raycast(camera.position, _fwdFull, 20000);
        const aim = aimHit
            ? `aim ${aimHit.point.x.toFixed(0)} ${aimHit.point.y.toFixed(0)} ${aimHit.point.z.toFixed(0)}`
            : 'aim sky';
        posDisplay.textContent =
            `pos ${player.position.x.toFixed(0)} ${player.position.y.toFixed(0)} ${player.position.z.toFixed(0)}  ` +
            `ang ${pitch.toFixed(1)} ${yaw.toFixed(1)}  ${aim}  ` +
            `vel ${hSpeed.toFixed(0)}${player.onLadder ? ' [ladder]' : ''}${player.noclip ? ' [noclip]' : ''}`;
    }

    renderer.render(scene, camera);
}

animate();

window.__debug = { player, mapLoader, grenades, CS2, tuning, camera, THREE, startGame, solveAim, placeAimTarget, solveAimFromHere, lineupHelper };

window.addEventListener('resize', () => {
    applyFov(); // also sizes + letterboxes the canvas
    updateOrientationClass();
});
