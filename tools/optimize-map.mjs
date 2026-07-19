// CS2 map optimizer: takes a Source 2 Viewer glTF export (huge, loose textures)
// and produces a compact self-contained GLB for the web app.
//
// Usage:
//   node tools/optimize-map.mjs <input.glb> <output.glb> [--physics] [--texsize N] [--ratio R]
//
//   --physics   physics-mesh mode: strips ALL materials/textures, geometry only
//   --collision collision mode: like --physics but from the VISUAL mesh, with
//               aggressive simplification (use when the VRF physics export
//               only contains entities, not world geometry)
//   --texsize   max texture dimension (default 1024)
//   --ratio     mesh simplification target ratio (default 0.6 = keep 60%)

import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression } from '@gltf-transform/extensions';
import {
    dedup, flatten, join, prune, quantize, simplify, textureCompress, weld,
} from '@gltf-transform/functions';
import { MeshoptSimplifier, MeshoptEncoder } from 'meshoptimizer';
import sharp from 'sharp';
import fs from 'node:fs';

const args = process.argv.slice(2);
const input = args[0];
const output = args[1];
const isPhysics = args.includes('--physics');
const isCollision = args.includes('--collision');
const texSize = parseInt(args[args.indexOf('--texsize') + 1]) || 1024;
const ratio = parseFloat(args[args.indexOf('--ratio') + 1]) || 0.6;
const quality = parseInt(args[args.indexOf('--quality') + 1]) || 75;

if (!input || !output) {
    console.error('Usage: node optimize-map.mjs <input.glb> <output.glb> [--physics] [--texsize N] [--ratio R]');
    process.exit(1);
}

await MeshoptEncoder.ready;
const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
console.log(`Reading ${input} ...`);
const doc = await io.read(input);
const root = doc.getRoot();

// Source 2 utility geometry that is invisible in-game but present in VRF
// exports — covers real surfaces with untextured meshes and bloats the file
const UTILITY_RE = /blocklight|shadowmesh|occluder|toolsinvisible|toolsnodraw|toolsskybox|lightprobe/i;
let utilRemoved = 0;
for (const node of root.listNodes()) {
    if (UTILITY_RE.test(node.getName())) { node.dispose(); utilRemoved++; }
}
for (const mesh of root.listMeshes()) {
    if (UTILITY_RE.test(mesh.getName())) { mesh.dispose(); utilRemoved++; }
}
if (utilRemoved) console.log(`removed ${utilRemoved} utility (blocklight/shadowmesh/...) nodes`);

const stat = (label) => {
    let tris = 0;
    for (const mesh of root.listMeshes()) {
        for (const prim of mesh.listPrimitives()) {
            const idx = prim.getIndices();
            tris += (idx ? idx.getCount() : prim.getAttribute('POSITION').getCount()) / 3;
        }
    }
    console.log(`${label}: ${root.listMeshes().length} meshes, ${Math.round(tris).toLocaleString()} tris, ` +
        `${root.listTextures().length} textures, ${root.listMaterials().length} materials`);
};
stat('input');

if (isPhysics || isCollision) {
    // collision mesh: geometry only
    for (const prim of root.listMeshes().flatMap(m => m.listPrimitives())) {
        prim.setMaterial(null);
        // drop everything except positions/indices
        for (const sem of prim.listSemantics()) {
            if (sem !== 'POSITION') prim.setAttribute(sem, null);
        }
    }
    await doc.transform(prune(), dedup(), flatten(), join(), weld());
    if (isCollision) {
        stat('before collision simplify');
        await doc.transform(simplify({ simplifier: MeshoptSimplifier, ratio: 0.3, error: 0.003, lockBorder: true }));
        stat('after collision simplify');
    }
    await doc.transform(quantize());
} else {
    // visual mesh: keep only base color textures (renderer uses Lambert anyway)
    //
    // EXCEPTION — 2-way blend materials (F_FANCY_BLENDING, walls/floors with a
    // damaged/patchy second layer, the detail lineups aim at): the layer2
    // color texture is smuggled in the EMISSIVE slot (harmless for plain
    // Lambert since emissive stays black) and the app's shader mixes it in by
    // the _TEXCOORD_4 vertex blend weight. Layer2 PNGs must sit next to the
    // input glb (VRF skips them; export from pak01 by vtex path when missing).
    const path = await import('node:path');
    const srcDir = path.dirname(input);
    let blendPacked = 0;
    for (const mat of root.listMaterials()) {
        const layer2 = mat.getExtras()?.vmat?.TextureParams?.g_tLayer2Color;
        mat.setNormalTexture(null);
        mat.setOcclusionTexture(null);
        mat.setMetallicRoughnessTexture(null);
        mat.setEmissiveTexture(null);
        if (!layer2 || !mat.getBaseColorTexture()) continue;
        const png = path.join(srcDir, layer2.split('/').pop().replace(/\.vtex$/, '.png'));
        if (!fs.existsSync(png)) { console.warn(`layer2 missing on disk: ${png}`); continue; }
        const tex = doc.createTexture(path.basename(png))
            .setImage(fs.readFileSync(png))
            .setMimeType('image/png');
        mat.setEmissiveTexture(tex);
        blendPacked++;
    }
    if (blendPacked) console.log(`packed layer2 blend textures into ${blendPacked} materials`);
    await doc.transform(prune(), dedup());
    stat('after texture strip');

    await doc.transform(flatten(), join());
    stat('after join');

    if (ratio < 1) {
        await doc.transform(
            weld(),
            simplify({ simplifier: MeshoptSimplifier, ratio, error: 0.001 }),
        );
        stat('after simplify');
    }

    await doc.transform(
        textureCompress({ encoder: sharp, targetFormat: 'webp', quality, resize: [texSize, texSize] }),
        prune(),
        quantize(),
    );
}

doc.createExtension(EXTMeshoptCompression)
    .setRequired(true)
    .setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });

await io.write(output, doc);
const mb = (fs.statSync(output).size / 1024 / 1024).toFixed(1);
console.log(`Written ${output} (${mb} MB)`);
