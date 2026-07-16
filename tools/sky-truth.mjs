// Which parts of physics_sky are actually solid for grenades? Real demo
// trajectories are ground truth: a segment that CROSSES a sky face proves that
// face is not nade-solid; a trajectory that turns around right at one supports
// solidity. Reports every crossing with height + position so the solid/pass
// split is visible (e.g. "high ceiling solid, low edge volumes pass").
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { computeBoundsTree, acceleratedRaycast } from 'three-mesh-bvh';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const toApp = (x, y, z) => new THREE.Vector3(y, z, x);

const buf = readFileSync(join(ROOT, 'public/maps/mirage-collision.glb'));
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
const scene = await new Promise((res, rej) => loader.parse(ab, '', (g) => res(g.scene), rej));
scene.updateMatrixWorld(true);

const skyGeos = [];
scene.traverse((o) => {
    if (o.isMesh && /physics_sky/i.test(o.name)) {
        // mapLoader-style extraction: manual vertex copy handles the meshopt
        // quantized attributes correctly (toNonIndexed().clone() does NOT)
        const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry;
        const src = g.attributes.position;
        const arr = new Float32Array(src.count * 3);
        for (let i = 0; i < src.count; i++) {
            arr[i * 3] = src.getX(i);
            arr[i * 3 + 1] = src.getY(i);
            arr[i * 3 + 2] = src.getZ(i);
        }
        const ng = new THREE.BufferGeometry();
        ng.setAttribute('position', new THREE.BufferAttribute(arr, 3));
        ng.applyMatrix4(o.matrixWorld);
        skyGeos.push(ng);
    }
});
console.log(`sky meshes: ${skyGeos.length}`);
const sky = new THREE.Mesh(skyGeos[0], new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
sky.geometry.computeBoundsTree();

const ray = new THREE.Raycaster();
ray.firstHitOnly = false;

// all trajectories from all demos
const DATA = join(ROOT, 'tools/demo-data');
let nTraj = 0, nCross = 0;
const crossings = [];
let maxFlightZ = -1e9;
for (const tf of readdirSync(DATA).filter((f) => f.endsWith('.traj.json'))) {
    for (const t of JSON.parse(readFileSync(join(DATA, tf), 'utf8'))) {
        if (t.samples.length < 4) continue;
        nTraj++;
        let crossed = false;
        for (let i = 1; i < t.samples.length; i++) {
            const a = toApp(t.samples[i - 1].x, t.samples[i - 1].y, t.samples[i - 1].z);
            const b = toApp(t.samples[i].x, t.samples[i].y, t.samples[i].z);
            maxFlightZ = Math.max(maxFlightZ, a.y);
            const d = b.clone().sub(a), len = d.length();
            if (len < 1e-3) continue;
            ray.set(a, d.divideScalar(len));
            ray.far = len;
            const hits = ray.intersectObject(sky);
            if (hits.length) {
                crossed = true;
                for (const h of hits.slice(0, 1)) crossings.push({ z: h.point.y, x: h.point.z, y: h.point.x });
            }
        }
        if (crossed) nCross++;
    }
}
console.log(`${nTraj} real trajectories, ${nCross} cross the sky mesh somewhere (${crossings.length} segment crossings)`);
console.log(`highest real in-flight sample: z=${maxFlightZ.toFixed(0)}`);
const zs = crossings.map((c) => c.z).sort((a, b) => a - b);
if (zs.length) {
    const q = (p) => zs[Math.floor(zs.length * p)];
    console.log(`crossing heights: min ${zs[0].toFixed(0)}  q25 ${q(.25).toFixed(0)}  med ${q(.5).toFixed(0)}  q75 ${q(.75).toFixed(0)}  max ${zs[zs.length - 1].toFixed(0)}`);
    console.log('sample crossings game(x,y,z):', crossings.slice(0, 8).map((c) => `(${c.x.toFixed(0)},${c.y.toFixed(0)},${c.z.toFixed(0)})`).join(' '));
}
