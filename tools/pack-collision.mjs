// Packs the VRF world-physics export (game collision hulls, Hammer units,
// Z-up) into a compact GLB for the app: positions only, axes remapped into
// the app's frame (our x = game y, our y = game z, our z = game x), meshopt
// compressed. Node names (physics_group_*, physics_csgo_grenadeclip, ...)
// are preserved — mapLoader classifies player vs grenade collision by name.
//
// Usage: node tools/pack-collision.mjs <world_physics_physics.glb> <out.glb>

import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression } from '@gltf-transform/extensions';
import { prune, weld, quantize } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';
import fs from 'node:fs';

const [input, output] = process.argv.slice(2);
if (!input || !output) {
    console.error('Usage: node tools/pack-collision.mjs <in.glb> <out.glb>');
    process.exit(1);
}

const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.encoder': MeshoptEncoder });

const doc = await io.read(input);
const root = doc.getRoot();

// Bake each node's world matrix into its positions first (VRF puts a Z-up ->
// Y-up rotation on the root node), then remap the resulting glTF-world frame
// (x=game x, y=game z, z=-game y) into the app frame (x=game y, y=game z,
// z=game x): (wx, wy, wz) -> (-wz, wy, wx).
let prims = 0;
const mul = (m, x, y, z) => [
    m[0] * x + m[4] * y + m[8] * z + m[12],
    m[1] * x + m[5] * y + m[9] * z + m[13],
    m[2] * x + m[6] * y + m[10] * z + m[14],
];
for (const node of root.listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    const wm = node.getWorldMatrix();
    // VRF bakes a HU->meters scale into the root — undo it, we want HU
    const s = Math.hypot(wm[0], wm[1], wm[2]) || 1;
    for (const prim of mesh.listPrimitives()) {
        prims++;
        const pos = prim.getAttribute('POSITION');
        const arr = pos.getArray();
        for (let i = 0; i < arr.length; i += 3) {
            // world matrix bake puts us in VRF's glTF frame — the SAME frame
            // the visual map export uses, i.e. the app frame (just unscale)
            const [wx, wy, wz] = mul(wm, arr[i], arr[i + 1], arr[i + 2]);
            arr[i] = wx / s;
            arr[i + 1] = wy / s;
            arr[i + 2] = wz / s;
        }
        pos.setArray(arr);
        // collision needs positions only
        for (const sem of prim.listSemantics()) {
            if (sem !== 'POSITION') prim.setAttribute(sem, null);
        }
        prim.setMaterial(null);
    }
    node.setMatrix([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
}
for (const mat of root.listMaterials()) mat.dispose();
for (const tex of root.listTextures()) tex.dispose();

await doc.transform(prune(), weld(), quantize({ quantizePosition: 14 }));

doc.createExtension(EXTMeshoptCompression)
    .setRequired(true)
    .setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });

await io.write(output, doc);
const mb = (fs.statSync(output).size / 1024 / 1024).toFixed(2);
console.log(`Packed ${prims} prims -> ${output} (${mb} MB)`);
