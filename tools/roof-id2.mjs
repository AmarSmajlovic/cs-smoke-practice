// Definitively identify the mesh that owns the z=240 roof: raycast each
// source mesh of the physics GLB separately. Usage: node tools/roof-id.mjs
import * as THREE from 'three';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const buf = readFileSync(join(ROOT, 'public/maps/mirage-collision.glb'));
const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
const physRoot = await new Promise((res, rej) => loader.parse(ab, '', (g) => res(g.scene), rej));
physRoot.updateMatrixWorld(true);

const ray = new THREE.Raycaster(new THREE.Vector3(420, 320, -1120), new THREE.Vector3(0, -1, 0), 0, 500);
const meshes = [];
physRoot.traverse((o) => { if (o.isMesh) { o.material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }); meshes.push(o); } });
const hits = ray.intersectObjects(meshes, false);
for (const h of hits.slice(0, 6)) {
    let name = h.object.name, p = h.object.parent;
    while (p && p.name) { name = p.name + '/' + name; p = p.parent; }
    console.log(`z=${h.point.y.toFixed(0)}  ${name}`);
}
