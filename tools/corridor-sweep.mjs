// Fan-sweep the whole flight corridor: lateral offsets x heights, list every
// surviving triangle (centroid + verts) the nade could hit.
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

const g = mapLoader.nadeCollider.geometry;
const pa = g.attributes.position, idx = g.index;
const seen = new Map();
// corridor: from behind the -960 wall crossing to past the touch point,
// direction of flight, lateral fan +-50, heights 125..300
const dirApp = new THREE.Vector3(-0.62, 0, -0.78).normalize();
const perp = new THREE.Vector3(-dirApp.z, 0, dirApp.x); // lateral
for (let off = -50; off <= 50; off += 5) {
    for (let h = 125; h <= 300; h += 8) {
        const start = new THREE.Vector3(373 + 0.62 * 260, h, -1198 + 0.78 * 260)
            .addScaledVector(perp, off);
        const hit = mapLoader.raycastNade(start, dirApp, 460);
        if (!hit) continue;
        // only care about hits in the corridor segment (game x -1240..-1000)
        if (hit.point.z > -1000 || hit.point.z < -1245) continue;
        if (hit.point.y < 120) continue; // floor
        const key = hit.faceIndex;
        if (seen.has(key)) continue;
        const verts = [];
        for (let k = 0; k < 3; k++) {
            const vi = idx ? idx.getX(hit.faceIndex * 3 + k) : hit.faceIndex * 3 + k;
            verts.push([pa.getZ(vi), pa.getX(vi), pa.getY(vi)]);
        }
        const c = verts.reduce((a, v) => [a[0] + v[0] / 3, a[1] + v[1] / 3, a[2] + v[2] / 3], [0, 0, 0]);
        seen.set(key, { p: hit.point.clone(), c, verts });
    }
}
console.log(`preostale face u koridoru: ${seen.size}`);
for (const { p, c, verts } of seen.values()) {
    console.log(`hit game(${p.z.toFixed(0)}, ${p.x.toFixed(0)}, ${p.y.toFixed(0)})  centroid(${c[0].toFixed(0)}, ${c[1].toFixed(0)}, ${c[2].toFixed(0)})`);
    console.log(`  verts: ${verts.map((v) => `(${v[0].toFixed(0)},${v[1].toFixed(0)},${v[2].toFixed(0)})`).join(' ')}`);
}
