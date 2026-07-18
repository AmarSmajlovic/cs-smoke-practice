// Map the chimney footprint near the Left Arch landing: grid of down-rays,
// print top height per cell (floor=114/128, chimney = higher).
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

const down = new THREE.Vector3(0, -1, 0);
let header = '        ';
for (let gy = 320; gy <= 480; gy += 20) header += String(gy).padStart(5);
console.log(header + '   (game y ->)');
for (let gx = -1140; gx >= -1260; gx -= 20) {
    let row = `x ${String(gx).padStart(5)} `;
    for (let gy = 320; gy <= 480; gy += 20) {
        const o = new THREE.Vector3(gy, 194, gx); // start below the corridor (194)
        const hit = mapLoader.raycastNade(o, down, 400);
        row += (hit ? hit.point.y.toFixed(0) : ' -- ').padStart(5);
    }
    console.log(row);
}
