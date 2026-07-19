// Shared rig for the headless physics tools. Drives the real GrenadeSystem and
// MapLoader against ground truth joined out of CS2 pro demos, so both the
// regression gate and the calibration sweep exercise the shipped code.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { MapLoader } from '../mapLoader.js';
import { GrenadeSystem } from '../grenades.js';
import { CS2 } from '../physicsConfig.js';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// CS2 throw strengths: left click, both, right click. computeThrow maps these
// through speed = throwSpeed * (0.3 + 0.7 * strength). The demo does not record
// which one was used, so callers score a throw on its best-fitting strength.
export const STRENGTHS = [1.0, 0.5, 0.0];

// Source is Z-up with x forward; ours is Y-up. Mapping verified in main.js's
// setpos import: our x = game y, our z = game x, height identical.
export const toApp = (x, y, z) => new THREE.Vector3(y, z, x);

export const pct = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];

export const category = (r) =>
    (r.vz > 100 ? 'skok' : Math.hypot(r.vx, r.vy) > 5 ? 'kretanje' : 'stoji');

async function parseGlb(path) {
    const buf = readFileSync(path);
    const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    return new Promise((res, rej) => loader.parse(ab, '', (g) => res(g.scene), rej));
}

export async function buildHarness() {
    const scene = new THREE.Scene();
    const mapLoader = new MapLoader(scene);
    mapLoader.buildGameCollisionFromRoot(await parseGlb(join(ROOT, 'public/maps/mirage-collision.glb')));
    // same soft-ground grid the app loads — keeps live and harness identical
    mapLoader.softGround = JSON.parse(readFileSync(join(ROOT, 'public/maps/mirage-softground.json'), 'utf8'));
    const grenades = new GrenadeSystem(scene, mapLoader);
    const pairs = JSON.parse(readFileSync(join(ROOT, 'tools/mirage_pairs.json'), 'utf8'));
    return { grenades, pairs };
}

// Every demo's pairs merged, when one demo's ~30 jumpthrows aren't enough.
// Falls back to the committed single-demo set if demo-data/ isn't populated.
export function loadAllPairs() {
    const dir = join(ROOT, 'tools/demo-data');
    if (!existsSync(dir)) return JSON.parse(readFileSync(join(ROOT, 'tools/mirage_pairs.json'), 'utf8'));
    const out = [];
    for (const f of readdirSync(dir).filter((f) => f.endsWith('.pairs.json')))
        out.push(...JSON.parse(readFileSync(join(dir, f), 'utf8')));
    return out;
}

// Reconstruct the throw as CS2 saw it. A jumpthrow releases 0.1225s after the
// jump input, which is NOT the `grenade_thrown` event tick — walk the player's
// ballistic arc from the event state to the release moment (vz = jumpImpulse -
// gravity * releaseTime, position moved accordingly; dt may go either way).
// For ground throws the event-tick state is used as-is (release only matters
// when the player velocity is large, i.e. mid-jump).
const _eye = new THREE.Vector3(), _vel = new THREE.Vector3();
export function throwFrom(p, release) {
    _vel.set(p.vx, p.vy, p.vz);
    _eye.set(p.px, p.py, p.pz);
    if (p.vz > 100 && p.vz < CS2.jumpImpulse) {
        const vzRel = CS2.jumpImpulse - CS2.gravity * CS2.jumpthrowReleaseTime;
        const dt = (vzRel - p.vz) / CS2.gravity;
        _eye.x -= p.vx * dt;
        _eye.y -= p.vy * dt;
        _eye.z -= (p.vz + vzRel) * 0.5 * dt;
        _vel.z = vzRel;
    } else if (release > 0) {
        _eye.addScaledVector(_vel, release);
        _eye.z -= 0.5 * CS2.gravity * release * release;
        _vel.z -= CS2.gravity * release;
    }
    const eye = toApp(_eye.x, _eye.y, _eye.z);
    eye.y = _eye.z + CS2.eyeStand;
    const yaw = THREE.MathUtils.degToRad(p.yaw);
    return {
        eye,
        vel: toApp(_vel.x, _vel.y, _vel.z),
        fwdH: new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw)),
        want: toApp(p.dx, p.dy, p.dz),
    };
}

// Run one throw to rest. CS2's smokegrenade_detonate reports where the grenade
// stopped, so first touch would be the wrong thing to compare against.
const _pos = new THREE.Vector3(), _v = new THREE.Vector3();
export function simulateToRest(grenades, eye, fwdH, pitchDeg, strength, playerVel, path = null) {
    grenades.computeThrow(eye, fwdH, pitchDeg, strength, playerVel, _pos, _v);
    const nade = { position: _pos, velocity: _v, rolling: false, age: 0 };
    if (path) path.push(_pos.clone());
    while (grenades.stepProjectile(nade, CS2.TICK, false)) {
        if (path) path.push(_pos.clone());
    }
    return _pos;
}

// CS2 grenades bounce off players; ours fly through them, because a lineup
// trainer has an empty map. A pro demo does not — so any throw whose path
// crosses a team-mate is measuring an interaction we deliberately do not model,
// and cannot be used to judge the physics either way.
//
// Player positions are sampled at the throw tick and treated as static. Players
// move at most ~250 u/s against a grenade's ~685 u/s, and a block that matters
// happens in the first fraction of a second, so this is close enough to flag a
// throw as unusable — it is a filter, not a simulation.
const PLAYER_RADIUS = 16 + CS2.nadeRadius; // 32x32 hull, half-width plus the nade
const PLAYER_HEIGHT = CS2.hullHeightStand;

export function pathHitsPlayer(path, others) {
    for (const pt of path) {
        for (const o of others) {
            const dy = pt.y - o.y;
            if (dy < -CS2.nadeRadius || dy > PLAYER_HEIGHT) continue;
            if (Math.hypot(pt.x - o.x, pt.z - o.z) < PLAYER_RADIUS) return true;
        }
    }
    return false;
}

// All players except the thrower, positioned at the moment of the throw.
export function othersAt(players, p) {
    return players.filter((r) => r.tick === p.throw_tick && r.name !== p.thrower)
        .map((r) => toApp(r.X, r.Y, r.Z));
}

export function loadPlayers() {
    const csv = readFileSync(join(ROOT, 'tools/players.csv'), 'utf8').trim().split('\n');
    const head = csv[0].split(',');
    return csv.slice(1).map((line) => {
        const c = line.split(',');
        const o = {};
        head.forEach((h, i) => { o[h] = /^-?[\d.]+$/.test(c[i]) ? +c[i] : c[i]; });
        return o;
    });
}

// Best-fitting strength for one demo throw, since the demo does not record it.
export function bestError(grenades, p, release) {
    const { eye, vel, fwdH, want } = throwFrom(p, release);
    let best = Infinity, bs = null;
    for (const s of STRENGTHS) {
        const err = simulateToRest(grenades, eye, fwdH, p.pitch, s, vel).distanceTo(want);
        if (err < best) { best = err; bs = s; }
    }
    return { err: best, s: bs };
}
