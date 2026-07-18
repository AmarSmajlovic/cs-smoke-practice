// Probe: the user's medium-throw lineup (standing shift+F) overshoots slightly.
// Simulate setpos 814.968750 -1548.988770 -44.968750; setang -4.900196 -178.500244
// at a range of medium strengths and print where the grenade rests, so the
// medium factor can be picked from data instead of guesswork.
import * as THREE from 'three';
import { buildHarness, toApp, simulateToRest } from './harness.mjs';
import { CS2 } from '../physicsConfig.js';

const { grenades } = await buildHarness();

const feet = { x: 814.968750, y: -1548.988770, z: -44.968750 };
const pitch = -4.900196, yaw = -178.500244;

const eye = toApp(feet.x, feet.y, feet.z);
eye.y = feet.z + CS2.eyeStand;
const yawRad = THREE.MathUtils.degToRad(yaw);
const fwdH = new THREE.Vector3(Math.sin(yawRad), 0, Math.cos(yawRad));
const still = new THREE.Vector3();

const base = simulateToRest(grenades, eye, fwdH, pitch, 0.5, still).clone();
console.log(`strength 0.500  rest app(${base.x.toFixed(1)}, ${base.y.toFixed(1)}, ${base.z.toFixed(1)})  game(${base.z.toFixed(1)}, ${base.x.toFixed(1)}, ${base.y.toFixed(1)})`);

for (const s of [0.499, 0.4975, 0.495, 0.4925, 0.49, 0.485, 0.48, 0.47, 0.46, 0.45]) {
    const r = simulateToRest(grenades, eye, fwdH, pitch, s, still).clone();
    const d = r.distanceTo(base);
    console.log(`strength ${s.toFixed(4)}  rest game(${r.z.toFixed(1)}, ${r.x.toFixed(1)}, ${r.y.toFixed(1)})  shift ${d.toFixed(1)}u (${(d * 1.905).toFixed(0)}cm)`);
}
