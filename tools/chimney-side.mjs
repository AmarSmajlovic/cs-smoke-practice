// Horizontal probes along the flight direction at the user's impact point:
// find the chimney's side faces below the corridor (z 120-200).
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

// along flight dir game (-0.78, -0.62), passing through the user's impact (-1198, 373)
const dirApp = new THREE.Vector3(-0.62, 0, -0.78).normalize();
for (let h = 130; h <= 210; h += 10) {
    // start back along the line from the impact
    const start = new THREE.Vector3(373 + 0.62 * 120, h, -1198 + 0.78 * 120);
    const hit = mapLoader.raycastNade(start, dirApp, 260);
    if (hit) {
        const n = hit.face.normal;
        console.log(`h=${h}  hit game(${hit.point.z.toFixed(0)}, ${hit.point.x.toFixed(0)}, ${hit.point.y.toFixed(0)})  n=(${n.z.toFixed(2)},${n.x.toFixed(2)},${n.y.toFixed(2)})`);
    } else console.log(`h=${h}  PROLAZ`);
}

// print the actual triangle vertices of the offending face
{
    const dirApp2 = new THREE.Vector3(-0.62, 0, -0.78).normalize();
    const start = new THREE.Vector3(373 + 0.62 * 120, 160, -1198 + 0.78 * 120);
    const hit = mapLoader.raycastNade(start, dirApp2, 260);
    if (hit) {
        const g = mapLoader.nadeCollider.geometry;
        const pa = g.attributes.position;
        const idx = g.index;
        for (let k = 0; k < 3; k++) {
            const vi = idx ? idx.getX(hit.faceIndex * 3 + k) : hit.faceIndex * 3 + k;
            console.log(`vert${k}: game(${pa.getZ(vi).toFixed(0)}, ${pa.getX(vi).toFixed(0)}, ${pa.getY(vi).toFixed(0)})`);
        }
    }
}
