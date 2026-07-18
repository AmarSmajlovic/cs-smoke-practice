import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import GUI from 'lil-gui';
import { MapLoader, MAPS } from './mapLoader.js';
import { Player } from './player.js';
import { GrenadeSystem } from './grenades.js';
import { CS2, tuning, VRF_SCALE, GRENADE_ENV_INTENSITY, ASSET_BASE } from './physicsConfig.js';

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

// Fullscreen viewport, CS2 behaviour: vertical FOV is fixed at 73.74 (the
// game's 90° horizontal at 4:3) and the horizontal view grows with a wider
// window (hor+), exactly like CS2 on wide monitors — no letterboxing. On a
// portrait window the vertical FOV opens up instead so the horizontal view
// never drops below the 4:3 game view.
function applyFov() {
    const W = window.innerWidth, H = window.innerHeight;
    renderer.setSize(W, H);
    const el = renderer.domElement;
    el.style.position = 'absolute';
    el.style.left = '0px';
    el.style.top = '0px';
    camera.aspect = W / H;
    const MIN_H_FOV = THREE.MathUtils.degToRad(90); // CS2 horizontal at 4:3
    const vFov = THREE.MathUtils.degToRad(73.74);
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * camera.aspect);
    camera.fov = hFov >= MIN_H_FOV
        ? 73.74
        : THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(MIN_H_FOV / 2) / camera.aspect));
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

// The CS2 grenade's ORM map is ~0.88 metalness, and metal with nothing to
// reflect renders black no matter how many lights you point at it. The map is
// converted to Lambert on load, so this environment only reaches the viewmodel.
const _pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = _pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
_pmrem.dispose();

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
        document.querySelector('#resume h2').textContent = 'WAIT A SECOND, THEN PRESS ESC OR CLICK';
    }
});

// ---------------------------------------------------------------- Sensitivity
// True CS2 scale: degrees per mouse count = sens * 0.022 (m_yaw), so the same
// number the player uses in game feels identical here. PointerLockControls
// turns 0.002 rad per count at pointerSpeed 1 — the bridge is
// sens * 0.022 * (PI/180) / 0.002 = sens * 0.192.
const SENS_DEFAULT = 2.5; // CS2's own default
let sens = parseFloat(localStorage.getItem('sp-sens')) || SENS_DEFAULT;
function applySens() {
    sens = THREE.MathUtils.clamp(sens, 0.05, 20);
    controls.pointerSpeed = sens * 0.192;
    localStorage.setItem('sp-sens', String(sens));
    $('sens-range').value = Math.min(sens, 8);
    $('sens-num').value = String(+sens.toFixed(2));
}
$('sens-range').addEventListener('input', () => {
    sens = parseFloat($('sens-range').value);
    applySens();
});
$('sens-num').addEventListener('change', () => {
    const v = parseFloat($('sens-num').value.replace(',', '.'));
    if (v > 0) sens = v;
    applySens();
});
// keep WASD/ESC handling out of the text field
$('sens-num').addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') $('sens-num').blur();
});
$('sens-num').addEventListener('keyup', (e) => e.stopPropagation());
applySens();

// CTRL+W (crouch + forward!) closes the tab — the classic browser-FPS rage
// moment. Two guards: a leave-confirmation while a map is loaded (works in
// every browser), and Keyboard Lock on W (Chromium), which fully captures
// CTRL/CMD+W while the tab is fullscreen so the prompt never even appears.
window.addEventListener('beforeunload', (e) => {
    if (map) { e.preventDefault(); e.returnValue = ''; }
});
if (!isMobile) navigator.keyboard?.lock?.(['KeyW']).catch(() => {});

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
            const s = LOOK_SENS * (sens / SENS_DEFAULT);
            mobileLook.euler.setFromQuaternion(camera.quaternion);
            mobileLook.euler.y -= dx * s;
            mobileLook.euler.x -= dy * s;
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
    hide('landing');
    $('load-map-name').textContent = (mapDef.name || mapKey).toUpperCase();
    setLoadProgress(0);
    show('loading');

    try {
        map = await mapLoader.loadMap(mapDef, null, (stage, loaded, total) => {
            if (stage === 'download') {
                // CDNs often hide Content-Length (compressed streams) -> fall
                // back to the known file size so the bar still moves
                const effTotal = total > 0 ? total : (mapDef.sizeMB ? mapDef.sizeMB * 1048576 : 0);
                if (effTotal > 0) setLoadProgress(Math.min(90, (loaded / effTotal) * 88));
            } else if (stage === 'build') {
                setLoadProgress(93);
            }
        });
    } catch (e) {
        console.error('Map load failed:', e);
        hide('loading');
        show('landing');
        gameState = 'menu';
        toast('Map failed to load — check your connection and try again');
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
    // drop any half-finished throw gesture so resuming can't fire a smoke
    leftHeld = rightHeld = gestureL = gestureR = false;
    updateThrowHelp();
    showResume('PAUSED');
}

function showResume(title) {
    document.querySelector('#resume h2').textContent = title;
    // live "getpos": the spot the player is pausing at, ready to copy
    if (map) $('mypos').textContent = getposString();
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
    pipStop();
    mapLoader.unload();
    map = null;
    gameState = 'menu';
    show('landing');
}

// Menu wiring — everything lives on the landing; a map card starts the game
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
// The arms carry the grenade: CS2's own viewmodel skeleton is driven by CS2's own
// clips (tools/pack-anims.mjs), and the canister hangs off the right hand bone.
// The clips address bones by name, so AnimationMixer binds them to the arms rig
// without any retargeting — the eight *_TWIST helper bones in the mesh aren't in
// the clips and simply stay put, which is invisible at viewmodel distance.
let viewmodel = null;      // arms + gloves root
let vmMixer = null;
let vmActions = {};
let vmCurrent = null;      // action currently faded in
let handBone = null;
let grenadeInHand = null;
let hasSmoke = true;
// Whole-rig placement in camera space; the pose within it comes from the clips.
// VRF's Y-up conversion is a 120° turn about (-1,-1,-1), which sends Source's +X
// (forward) to glTF's +Z — but a three camera looks down -Z, so a rig imported
// as-is has its arms behind the viewer and left/right mirrored. Half a turn about
// Y undoes both at once.
const vmBase = new THREE.Vector3(0, -1.0, 5.0);
const vmRot = new THREE.Euler(0, Math.PI, 0);
// Viewmodels are drawn bigger than life in every shooter, CS2 included — at true
// 1:1 the glove is a thumbnail in the corner. This is taste, not a conversion.
const VM_SCALE = VRF_SCALE * 1.45;
const vmEnv = { intensity: GRENADE_ENV_INTENSITY };
let touchWindup = false; // mobile throw button held
let bobPhase = 0;
const sway = { x: 0, y: 0 };
let lastCamYaw = 0, lastCamPitch = 0;

// Grenade offset on the wpn bone — the clips animate the bone, this seats the
// canister in the fist on top of the export-convention cancel. Tune via the GUI.
const gripPos = new THREE.Vector3(0, 0, 0);
const gripRot = new THREE.Euler(0, 0, 0);
const nadeCancelQ = new THREE.Quaternion();
const _gripQ = new THREE.Quaternion();

(async function createViewmodel() {
    const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
    let anims;
    try {
        const [armsGltf, animGltf, nadeGltf] = await Promise.all([
            loader.loadAsync(`${ASSET_BASE}/arms.glb`),
            loader.loadAsync(`${ASSET_BASE}/nade_anims.glb`),
            loader.loadAsync(`${ASSET_BASE}/smoke_grenade.glb`),
        ]);
        viewmodel = armsGltf.scene;
        anims = animGltf.animations;
        grenadeInHand = nadeGltf.scene;
    } catch (e) {
        console.warn('viewmodel assets failed to load', e);
        return;
    }

    viewmodel.scale.setScalar(VM_SCALE);
    camera.add(viewmodel);

    // CS2 doesn't parent the grenade to the hand — it has a dedicated "wpn" bone
    // that the clips animate with the real carry and release motion, including
    // the moment it leaves the fingers. The arms model has no such bone (it's a
    // weapon-rig bone), so add an empty one under the same parent the clip rig
    // uses and the animation tracks bind to it by name.
    const rigRoot = viewmodel.getObjectByName('arm_upper_R')?.parent ?? viewmodel;
    handBone = new THREE.Object3D();
    handBone.name = 'wpn';
    rigRoot.add(handBone);
    handBone.add(grenadeInHand);
    // Every VRF export carries the same Source->glTF conversion on its root: a
    // 0.0254 scale and a 120° turn about (-1,-1,-1). Inside the rig that
    // conversion has already been applied once by rigRoot, and wpn is expressed
    // in Source axes — so the grenade's own copy of it has to come back off, or
    // the model ends up a 0.1u speck lying at the wrong angle.
    nadeCancelQ.copy(grenadeInHand.children[0].quaternion).invert();
    grenadeInHand.scale.setScalar(VRF_SCALE);
    // The canister is bare metal (metalness ~1 everywhere except the printed
    // labels), so all of its colour is reflected environment tinted by a dark
    // albedo. RoomEnvironment is a dim indoor box and Mirage is in daylight —
    // without a push the grenade reads as a black blob.
    grenadeInHand.traverse((o) => {
        if (o.isMesh) o.material.envMapIntensity = vmEnv.intensity;
    });
    // Arms are cloth and skin — they want the plain lights, not the metal push.
    viewmodel.traverse((o) => {
        if (o.isMesh) { o.material.envMapIntensity = 0.5; o.frustumCulled = false; }
    });
    // The whole rig lives on layer 1: only the player camera sees it, so the
    // smoke cam (PiP) doesn't show giant arms floating at the player's head.
    viewmodel.traverse((o) => o.layers.set(1));
    camera.layers.enable(1);

    vmMixer = new THREE.AnimationMixer(viewmodel);
    for (const clip of anims) vmActions[clip.name] = vmMixer.clipAction(clip);
    for (const name of ['charge_high', 'charge_mid', 'charge_low', 'throw_over', 'throw_under', 'draw']) {
        vmActions[name]?.setLoop(THREE.LoopOnce, 1);
        if (vmActions[name]) vmActions[name].clampWhenFinished = true;
    }
    // Seat the rig and evaluate idle before the first render, or the one frame
    // between loading and the first update shows the bind pose.
    viewmodel.position.copy(vmBase);
    viewmodel.rotation.copy(vmRot);
    playVm('idle', 0);
    vmMixer.update(0);
})();

// Cross-fade to a clip. Restarting the one that's already running would reset a
// held charge pose every frame, so a repeat request is a no-op.
function playVm(name, fade = 0.12) {
    const next = vmActions[name];
    if (!next || next === vmCurrent) return;
    next.reset().play();
    if (vmCurrent) next.crossFadeFrom(vmCurrent, fade, false);
    vmCurrent = next;
}

// Which cocked pose matches the buttons currently down. Mirrors the strength
// mapping in the mouseup handler: both = medium, left = full, right = lob.
function chargeClipFor(l, r) {
    if (l && r) return 'charge_mid';
    if (l) return 'charge_high';
    if (r) return 'charge_low';
    return null;
}

// Dev-only handles for poking the scene from the console or a script — posing the
// viewmodel, playing a clip, dropping a smoke without having to throw one. Declared
// down here so everything it closes over already exists (a const read from a live
// module-eval block hits the temporal dead zone). Compiled out of prod builds.
if (import.meta.env.DEV) {
    window.__dev = {
        vmBase, vmRot, vmEnv, gripPos, gripRot,
        nade: () => grenadeInHand,
        arms: () => viewmodel,
        play: (name) => playVm(name, 0.1),
        clips: () => Object.keys(vmActions),
        // updateViewmodel only runs under pointer lock; this drives it by hand
        tickVm: (dt) => updateViewmodel(dt),
        spawnSmoke: (x, y, z) => grenades.createSmoke(new THREE.Vector3(x, y, z)),
        clearSmokes: () => grenades.clearAllSmokes(),
        // camera only tracks the player while playing, so outside pointer lock
        // it can be flown around freely to look at things
        camera, player, grenades,
    };
}

function updateViewmodel(delta) {
    if (!viewmodel) return;
    vmMixer.update(delta);

    // Charge pose while a throw button is held; the throw clip itself is fired
    // from throwSmoke() on release, and draw/idle follow from there.
    const want = chargeClipFor(leftHeld || touchWindup, rightHeld);
    if (want && hasSmoke) playVm(want);

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

    // Re-seated every frame so the Debug GUI can dial the grip in live; it's a
    // constant offset inside an animated bone, not per-frame maths.
    if (handBone && grenadeInHand) {
        grenadeInHand.position.copy(gripPos);
        grenadeInHand.quaternion.copy(nadeCancelQ)
            .premultiply(_gripQ.setFromEuler(gripRot));
    }

    // Bob and sway move the whole rig — the arms' own motion is the clip's job.
    viewmodel.position.set(
        vmBase.x + bobX + sway.x,
        vmBase.y + bobY + sway.y,
        vmBase.z
    );
    viewmodel.rotation.set(
        vmRot.x + sway.y * 0.06,
        vmRot.y + sway.x * 0.08,
        vmRot.z + bobX * 0.04
    );
}
const _vmEuler = new THREE.Euler(0, 0, 0, 'YXZ');

// ---------------------------------------------------------------- Input
const keys = { w: false, a: false, s: false, d: false, shift: false, ctrl: false, space: false };

document.addEventListener('keydown', (e) => {
    // CS2-style ESC: the same key closes the pause menu again. (The browser
    // eats the ESC that exits pointer lock, so this only ever fires while the
    // menu is already open; the lock cooldown is handled by pointerlockerror.)
    if (e.key === 'Escape' && gameState === 'paused' && map && !isMobile) resumeGame();
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
    if (e.code === 'KeyM') placeAimTarget();
    if (e.code === 'KeyN') solveAimFromHere(e.shiftKey ? 0.5 : e.altKey ? 0.0 : 1.0);
    if (e.code === 'KeyP') copyPos();
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

// ---------------------------------------------------------------- Smoke cam
// Picture-in-picture chase cam: follows the thrown grenade from behind-above,
// then holds on the landing spot while the smoke blooms. Drawn as a scissor
// pass into the #pip-frame rect on top of the main render.
const pipCam = new THREE.PerspectiveCamera(65, 16 / 9, 1, 30000);
const pipFrame = $('pip-frame');
const pip = { nade: null, holdUntil: 0 };
const _pipDesired = new THREE.Vector3();
const _pipDir = new THREE.Vector3();

function pipFollow(nade) {
    pip.nade = nade;
    pip.holdUntil = 0;
    // start at the thrower's eye so the chase eases out of the player's view
    pipCam.position.copy(camera.position);
    pipFrame.classList.add('on');
}

function pipStop() {
    pip.nade = null;
    pipFrame.classList.remove('on');
}

function updatePip(delta) {
    if (!pip.nade) return;
    const target = pip.nade.position; // the vector persists after detonation
    if (grenades.projectiles.includes(pip.nade)) {
        // chase point behind-above the flight direction…
        _pipDesired.set(pip.nade.velocity.x, 0, pip.nade.velocity.z);
        if (_pipDesired.lengthSq() > 1) _pipDesired.normalize().multiplyScalar(-130);
        _pipDesired.add(target);
        _pipDesired.y = target.y + 70;
        // …pulled in front of the first wall so the cam never sits inside one
        _pipDir.copy(_pipDesired).sub(target);
        const d = _pipDir.length();
        if (d > 1) {
            const hit = mapLoader.raycastNade(target, _pipDir.divideScalar(d), d);
            if (hit) _pipDesired.copy(target).addScaledVector(_pipDir, Math.max(hit.distance - 6, 10));
        }
        pipCam.position.lerp(_pipDesired, Math.min(1, delta * 4));
    } else if (!pip.holdUntil) {
        pip.holdUntil = performance.now() + 3500; // watch the smoke bloom
    } else if (performance.now() > pip.holdUntil) {
        pipStop();
        return;
    }
    pipCam.lookAt(target);
}

function renderPip() {
    if (!pip.nade || gameState !== 'playing') return;
    const r = pipFrame.getBoundingClientRect();
    if (r.width < 8) return;
    pipCam.aspect = r.width / r.height;
    pipCam.updateProjectionMatrix();
    // setViewport/setScissor take CSS pixels (three applies the pixel ratio);
    // WebGL's origin is bottom-left, the DOM's is top-left
    const y = window.innerHeight - r.bottom;
    renderer.setScissorTest(true);
    renderer.setViewport(r.left, y, r.width, r.height);
    renderer.setScissor(r.left, y, r.width, r.height);
    renderer.render(scene, pipCam);
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, window.innerWidth, window.innerHeight);
}

const _euler = new THREE.Euler(0, 0, 0, 'YXZ');
const _fwdH = new THREE.Vector3();
const _fwdFull = new THREE.Vector3();
const _right = new THREE.Vector3();
const _eye = new THREE.Vector3();

function throwSmoke(strength, throwVel = player.velocity, eyeOverride = null) {
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

    const nade = grenades.throwGrenade(eyeOverride || player.getEyePosition(_eye), _fwdH, sourcePitchDeg, strength, throwVel);
    pipFollow(nade);

    hasSmoke = false;
    // Underhand for the lob, overhand for everything else — the same split the
    // charge poses use. The canister leaves the hand partway through, so it's
    // hidden for the follow-through rather than the whole cooldown.
    playVm(strength === 0 ? 'throw_under' : 'throw_over', 0.06);
    setTimeout(() => { if (grenadeInHand) grenadeInHand.visible = false; }, 180);
    setTimeout(() => {
        hasSmoke = true;
        if (grenadeInHand) grenadeInHand.visible = true;
        playVm('draw', 0.05);
        setTimeout(() => playVm('idle', 0.15), 500);
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
const _jtVel = new THREE.Vector3();
const _jtEye = new THREE.Vector3();
function scriptedJumpthrow(mode = 'bind', e = null) {
    if (gameState !== 'playing' || !hasSmoke || pendingJT) return;
    // SHIFT picks medium ONLY while standing still: lining up means
    // shift-WALKING to the spot, and a walking W+shift+F must stay a FULL
    // throw like a real CS2 bind — a silent medium here made every walking
    // jumpthrow land way short.
    const standing = Math.hypot(player.velocity.x, player.velocity.z) < 5;
    const strength = ((e?.shiftKey && standing) || (leftHeld && rightHeld)) ? 0.5
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
    if (player.onGround) {
        // remember where the jump starts from — the release state is
        // reconstructed analytically from here
        jt.groundY = player.position.y;
        return;
    }
    // A just-unfrozen (setpos) player first FALLS a few units onto the floor.
    // That airborne tick is not the jump — releasing there threw the nade
    // with falling velocity straight into the nearest wall. Wait until the
    // actual jump impulse shows up, then start timing the release.
    if (!jt.sawJump) {
        if (player.velocity.y > 100) jt.sawJump = true;
        else return;
    }
    jt.airTicks++;
    const ready = jt.mode === 'peak'
        ? player.velocity.y <= 20
        : jt.airTicks >= Math.round(CS2.jumpthrowReleaseTime * 64);
    if (ready) {
        if (jt.mode === 'bind') {
            // A CS2 jumpthrow bind releases exactly releaseTime after the
            // jump input (demo-calibrated). The 64Hz tick grid lands ~1-2u
            // off that moment — enough to flip razor-edge lineups (the
            // window ledge) — so pass the EXACT analytic release state:
            // velocity AND eye height from the jump arc at releaseTime.
            const rT = CS2.jumpthrowReleaseTime;
            _jtVel.copy(player.velocity)
                .setY(CS2.jumpImpulse - CS2.gravity * rT);
            player.getEyePosition(_jtEye);
            if (jt.groundY !== undefined) {
                _jtEye.y = jt.groundY + player.eyeHeight
                    + CS2.jumpImpulse * rT - 0.5 * CS2.gravity * rT * rT;
            }
            throwSmoke(jt.strength, _jtVel, _jtEye);
        } else {
            throwSmoke(jt.strength);
        }
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
let setposHold = null;

// The inverse of applySetposString: the player's current spot as a CS2 console
// string ("getpos" format — eye position + view angles). The same string works
// pasted back into our TELEPORT box, into a friend's browser, or into the CS2
// console on the real map.
function getposString() {
    _euler.setFromQuaternion(camera.quaternion);
    const gPitch = -THREE.MathUtils.radToDeg(_euler.x);
    const gYaw = THREE.MathUtils.radToDeg(Math.atan2(-Math.sin(_euler.y), -Math.cos(_euler.y)));
    const p = player.position;
    return `setpos ${p.z.toFixed(2)} ${p.x.toFixed(2)} ${(p.y + CS2.eyeStand).toFixed(2)}; setang ${gPitch.toFixed(2)} ${gYaw.toFixed(2)} 0.00`;
}

function copyPos() {
    if (!map) return;
    const s = getposString();
    if (!navigator.clipboard) { toast(s); return; }
    navigator.clipboard.writeText(s).then(
        () => toast('📋 Position copied — save it, share it, or paste it in the TELEPORT box'),
        () => toast(s));
}

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
    // Chrome can deliver a spurious mouse-movement burst while the pointer
    // re-locks after the menu closes — at CS2 sens that is up to ~1 degree,
    // which silently ruins razor-edge lineups. Hold the imported angles for a
    // moment so the teleported aim survives the lock.
    setposHold = { x: camera.rotation.x, y: camera.rotation.y, frames: 90 };
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
    // click the string or the button — both copy the current spot
    $('mypos').addEventListener('click', copyPos);
    $('mypos-copy').addEventListener('click', copyPos);
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
    const throwBtn = (id, strength) => press(id,
        () => { touchWindup = true; },
        () => { touchWindup = false; if (gameState === 'playing') throwSmoke(strength); });
    throwBtn('btn-throw', 1.0);
    throwBtn('btn-med', 0.5);
    throwBtn('btn-lob', 0.0);
    press('btn-clear', () => { grenades.clearAllSmokes(); clearAimHelper(); });
    press('btn-pause', () => { if (gameState === 'playing') pauseGame(); });
    press('btn-fly', () => { player.noclip = !player.noclip; $('btn-fly').classList.toggle('act', player.noclip); });
    press('btn-respawn', () => { player.spawn(spawnPoint.x, spawnPoint.y, spawnPoint.z); playerFrozen = false; });
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
// Dev-only: the whole panel (and lil-gui itself) is compiled out of prod builds.
if (import.meta.env.DEV) {
const gui = new GUI({ title: 'Debug' });
const nadeFolder = gui.addFolder('Grenade Tuning');
nadeFolder.add(tuning, 'throwSpeed', 400, 900, 5).name('Throw Speed (u/s)');
nadeFolder.add(tuning, 'nadeGravityScale', 0.2, 1.0, 0.05).name('Gravity Scale');
nadeFolder.add(tuning, 'elasticity', 0.1, 0.9, 0.05).name('Elasticity (tangent)');
nadeFolder.add(tuning, 'elasticityVert', 0.1, 0.9, 0.02).name('Elasticity (vert)');
nadeFolder.add(tuning, 'velInheritH', 0, 2, 0.05).name('Vel Inherit H');
nadeFolder.add(tuning, 'velInheritZ', 0, 2, 0.05).name('Vel Inherit Z');
nadeFolder.close();
// The grenade's rest pose is pure taste — dial it in live, then paste the
// numbers back into vmBase/vmRot. updateViewmodel reads both every frame.
const vmFolder = gui.addFolder('Viewmodel');
vmFolder.add(vmBase, 'x', -20, 20, 0.1).name('Pos X');
vmFolder.add(vmBase, 'y', -20, 20, 0.1).name('Pos Y');
vmFolder.add(vmBase, 'z', -30, 0, 0.1).name('Pos Z (depth)');
vmFolder.add(vmRot, 'x', -Math.PI, Math.PI, 0.01).name('Rot X');
vmFolder.add(vmRot, 'y', -Math.PI, Math.PI, 0.01).name('Rot Y');
vmFolder.add(vmRot, 'z', -Math.PI, Math.PI, 0.01).name('Rot Z');
vmFolder.add({ scale: VM_SCALE }, 'scale', 5, 120, 0.5).name('Rig Scale')
    .onChange((v) => viewmodel?.scale.setScalar(v));
vmFolder.add(vmEnv, 'intensity', 0, 8, 0.1).name('Nade Env Intensity').onChange((v) => {
    grenadeInHand?.traverse((o) => { if (o.isMesh) o.material.envMapIntensity = v; });
});
const gripFolder = vmFolder.addFolder('Grenade grip (in hand bone)');
gripFolder.add(gripPos, 'x', -8, 8, 0.05).name('Pos X');
gripFolder.add(gripPos, 'y', -8, 8, 0.05).name('Pos Y');
gripFolder.add(gripPos, 'z', -8, 8, 0.05).name('Pos Z');
gripFolder.add(gripRot, 'x', -Math.PI, Math.PI, 0.01).name('Rot X');
gripFolder.add(gripRot, 'y', -Math.PI, Math.PI, 0.01).name('Rot Y');
gripFolder.add(gripRot, 'z', -Math.PI, Math.PI, 0.01).name('Rot Z');
vmFolder.add({ dump: () => {
    const v3 = (v) => `${v.x.toFixed(2)}, ${v.y.toFixed(2)}, ${v.z.toFixed(2)}`;
    console.log(`vmBase:  ${v3(vmBase)}\nvmRot:   ${v3(vmRot)}`);
    console.log(`gripPos: ${v3(gripPos)}\ngripRot: ${v3(gripRot)}`);
} }, 'dump').name('Log values to console');
vmFolder.close();

const debugFolder = gui.addFolder('Debug');
debugFolder.add({ collider: false }, 'collider').name('Show Collider').onChange((v) => {
    if (mapLoader.colliderVisualizer) mapLoader.colliderVisualizer.visible = v;
});
debugFolder.add(player, 'noclip').name('Noclip (V)').listen();
debugFolder.close();
gui.close();
if (isMobile) gui.hide();
}

// ---------------------------------------------------------------- Main loop
const posDisplay = $('pos-display');
const nadeXhair = $('nade-crosshair');
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

// re-assert teleported view angles while the pointer lock settles (see
// applySetposString); any real mouse input after the hold works as normal
function tickSetposHold() {
    if (!setposHold) return;
    camera.rotation.order = 'YXZ';
    camera.rotation.set(setposHold.x, setposHold.y, 0);
    if (--setposHold.frames <= 0) setposHold = null;
}

// Standing inside a smoke, CS2 shows a near-solid grey wash — billboard puffs
// alone always leave see-through gaps at point-blank range. A fullscreen
// overlay driven by how deep the camera sits inside the nearest cloud.
const smokeFog = document.createElement('div');
smokeFog.id = 'smoke-fog';
smokeFog.style.cssText =
    'position:fixed;inset:0;pointer-events:none;background:#c7c7c5;opacity:0;z-index:5';
document.body.appendChild(smokeFog);

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
    }
    // Outside the gate: the arms are visible behind the pause overlay, and until
    // the mixer has run once they sit in the raw bind pose — a character-space
    // T-pose that smears across the whole screen.
    updateViewmodel(delta);

    grenades.update(delta);
    updatePip(delta);
    smokeFog.style.opacity = (grenades.smokeFogDensity(camera.position) * 0.97).toFixed(3);

    // full-screen lineup crosshair while a throw button is charged (CS2 style)
    nadeXhair.classList.toggle('on',
        playingNow() && hasSmoke && (leftHeld || rightHeld || touchWindup));

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

    tickSetposHold();
    renderer.render(scene, camera);
    renderPip();
}

animate();

if (import.meta.env.DEV) {
    window.__debug = { player, mapLoader, grenades, CS2, tuning, camera, THREE, startGame, solveAim, placeAimTarget, solveAimFromHere, lineupHelper, getposString, applySetposString };
}

window.addEventListener('resize', () => {
    applyFov(); // also sizes the canvas (fullscreen, hor+ FOV)
    updateOrientationClass();
});
