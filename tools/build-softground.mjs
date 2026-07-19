// Builds the per-map SOFT GROUND grid: top-down classification of the floor
// material (dirt/sand blends vs stone/asphalt) from the visual glb, aligned to
// the nade collider's ground height so roofs/overhangs don't pollute cells.
// The app and the headless harness share the JSON, keeping bounce physics
// identical live and in tests.
//
// Reads the glbs with gltf-transform (GLTFLoader needs a DOM for WebP
// textures); only positions + material names are used.
//
// Usage: node tools/build-softground.mjs <visual.glb> <collision.glb> <out.json>
import * as THREE from 'three';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { computeBoundsTree, acceleratedRaycast } from 'three-mesh-bvh';
import { writeFileSync } from 'node:fs';

THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

// dirt/sand ground materials; deliberately NOT plain "ground" (brick_ground_02
// is a stone floor) and NOT groundstone
const SOFT_RE = /groundrough|groundsmooth|groundsweeds|_sand_|sand_0|dirt|mud|gravel/i;
const CELL = 32;

const [visualPath, collisionPath, outPath] = process.argv.slice(2);

async function loadGroup(path, scale = 1) {
    const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)
        .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
    const doc = await io.read(path);
    const group = new THREE.Group();
    const m4 = new THREE.Matrix4();
    for (const scene of doc.getRoot().listScenes()) {
        const walk = (node, parentMat) => {
            const local = new THREE.Matrix4().fromArray(node.getMatrix());
            const world = new THREE.Matrix4().multiplyMatrices(parentMat, local);
            const mesh = node.getMesh();
            if (mesh) {
                for (const prim of mesh.listPrimitives()) {
                    const posAcc = prim.getAttribute('POSITION');
                    if (!posAcc) continue;
                    const n = posAcc.getCount();
                    const arr = new Float32Array(n * 3);
                    const el = [];
                    for (let i = 0; i < n; i++) {
                        posAcc.getElement(i, el);
                        arr[i * 3] = el[0]; arr[i * 3 + 1] = el[1]; arr[i * 3 + 2] = el[2];
                    }
                    const g = new THREE.BufferGeometry();
                    g.setAttribute('position', new THREE.BufferAttribute(arr, 3));
                    const idxAcc = prim.getIndices();
                    if (idxAcc) g.setIndex(new THREE.BufferAttribute(
                        idxAcc.getArray().slice(), 1));
                    g.applyMatrix4(world);
                    const tm = new THREE.Mesh(g, new THREE.MeshBasicMaterial());
                    tm.material.name = prim.getMaterial()?.getName() || '';
                    tm.name = node.getName() || '';
                    group.add(tm);
                }
            }
            for (const c of node.listChildren()) walk(c, world);
        };
        for (const node of scene.listChildren()) walk(node, new THREE.Matrix4().makeScale(scale, scale, scale));
    }
    group.traverse((o) => { if (o.isMesh) o.geometry.computeBoundsTree(); });
    return group;
}

const visual = await loadGroup(visualPath, 1 / 0.0254); // VRF meters -> HU (app applies the same scale)
const collision = await loadGroup(collisionPath);        // pack-collision output is already app-frame HU
const scene1 = new THREE.Scene(); scene1.add(visual);
const scene2 = new THREE.Scene(); scene2.add(collision);
scene1.updateMatrixWorld(true); scene2.updateMatrixWorld(true);

const bb = new THREE.Box3().setFromObject(collision);
const ray = new THREE.Raycaster();
const down = new THREE.Vector3(0, -1, 0);
const nx = Math.ceil((bb.max.x - bb.min.x) / CELL);
const nz = Math.ceil((bb.max.z - bb.min.z) / CELL);
const rows = [];
let softCells = 0;
for (let iz = 0; iz < nz; iz++) {
    let row = '';
    for (let ix = 0; ix < nx; ix++) {
        const x = bb.min.x + (ix + 0.5) * CELL;
        const z = bb.min.z + (iz + 0.5) * CELL;
        ray.set(new THREE.Vector3(x, bb.max.y + 100, z), down);
        ray.firstHitOnly = false;
        const cHits = ray.intersectObject(collision, true).map((h) => h.point.y);
        const vHits = ray.intersectObject(visual, true);
        let soft = false;
        for (const cy of cHits) {
            const near = vHits.find((v) => Math.abs(v.point.y - cy) < 6);
            if (!near) continue;
            if (SOFT_RE.test(near.object.material?.name || '') || SOFT_RE.test(near.object.name || '')) { soft = true; break; }
        }
        row += soft ? '1' : '0';
        if (soft) softCells++;
    }
    rows.push(row);
}
writeFileSync(outPath, JSON.stringify({ cell: CELL, minX: bb.min.x, minZ: bb.min.z, rows }));
console.log(`${outPath}: ${nx}x${nz} celija, soft: ${softCells} (${(softCells / (nx * nz) * 100).toFixed(1)}%)`);
