// What blocks the direct arc at game x ~ -1140? Rays along the flight line
// at several heights; report hit distance/position per height.
import * as THREE from 'three';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { MapLoader } from '../mapLoader.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const buf = readFileSync(join(ROOT, 'public/maps/mirage-collision.glb'));
const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
const physRoot = await new Promise((res, rej) => loader.parse(ab, '', (g) => res(g.scene), rej));
const scene = new THREE.Scene();
const mapLoader = new MapLoader(scene);
mapLoader.buildGameCollisionFromRoot(physRoot);

// flight line: from above the wall-bounce (game -863,631) toward target (-1203,360)
const from = new THREE.Vector3(560, 0, -950);   // app: x=game y, z=game x
const to = new THREE.Vector3(360, 0, -1203);
const dir = to.clone().sub(from).setY(0).normalize();
for (let h = 110; h <= 280; h += 15) {
    const o = from.clone().setY(h);
    const hit = mapLoader.raycastNade(o, dir, 400);
    if (hit) console.log(`h=${h}  hit @ game(${hit.point.z.toFixed(0)}, ${hit.point.x.toFixed(0)}, ${hit.point.y.toFixed(0)})  n=(${hit.face.normal.z.toFixed(2)},${hit.face.normal.x.toFixed(2)},${hit.face.normal.y.toFixed(2)})`);
    else console.log(`h=${h}  PROLAZ`);
}
