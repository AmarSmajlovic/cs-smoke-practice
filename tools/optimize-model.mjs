// Model optimizer: takes a Source 2 Viewer glTF model export and produces a
// compact GLB for the web app.
//
// Separate from optimize-map.mjs because that one strips normal/ORM maps (the
// map renders Lambert, so they'd be dead weight). A viewmodel sits in the
// corner of the screen at arm's length, where the normal map is most of what
// sells it — so this keeps the full PBR set and only shrinks the textures.
//
// Usage:
//   node tools/optimize-model.mjs <input.glb> <output.glb> [--texsize N]
//
//   --texsize   max texture dimension (default 512 — plenty at viewmodel size)
//   --fix-orm   swap the ORM red/blue channels (see below)
//   --drop      regex of mesh/node names to delete, e.g. "physics|worldmodel"
//               (default "physics" — VRF ships the collision hull alongside the
//               render mesh, and arm models carry a third-person worldmodel too)

import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression } from '@gltf-transform/extensions';
import { dedup, flatten, join, prune, quantize, textureCompress } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';
import sharp from 'sharp';
import fs from 'node:fs';

const args = process.argv.slice(2);
const input = args[0];
const output = args[1];
const texSize = parseInt(args[args.indexOf('--texsize') + 1]) || 512;
const fixOrm = args.includes('--fix-orm');
const dropRe = new RegExp(
    args.indexOf('--drop') !== -1 ? args[args.indexOf('--drop') + 1] : 'physics', 'i');

if (!input || !output) {
    console.error('Usage: node optimize-model.mjs <input.glb> <output.glb> [--texsize N]');
    process.exit(1);
}

await MeshoptEncoder.ready;
const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.encoder': MeshoptEncoder });

console.log(`Reading ${input} ...`);
const doc = await io.read(input);
const root = doc.getRoot();

const stat = (label) => {
    let tris = 0;
    for (const mesh of root.listMeshes()) {
        for (const prim of mesh.listPrimitives()) {
            const idx = prim.getIndices();
            tris += (idx ? idx.getCount() : prim.getAttribute('POSITION').getCount()) / 3;
        }
    }
    const texKB = root.listTextures()
        .reduce((sum, t) => sum + (t.getImage()?.byteLength ?? 0), 0) / 1024;
    console.log(`${label}: ${Math.round(tris).toLocaleString()} tris, ` +
        `${root.listTextures().length} textures (${texKB.toFixed(0)} KB), ` +
        `${root.listMaterials().length} materials`);
};
stat('input');

let dropped = 0;
for (const node of root.listNodes()) {
    if (dropRe.test(node.getName())) { node.dispose(); dropped++; }
}
for (const mesh of root.listMeshes()) {
    if (dropRe.test(mesh.getName())) { mesh.dispose(); dropped++; }
}
if (dropped) console.log(`dropped ${dropped} nodes/meshes matching /${dropRe.source}/`);

// CS2 weapon materials use the csgo_weapon.vfx shader, which VRF can't resolve
// ("Failed to find shader" during export). Without it VRF packs the ORM as
// (metalness, roughness, occlusion) instead of glTF's (occlusion, roughness,
// metalness) — so the renderer reads the AO map as metalness and the model
// comes out black. Swapping red and blue puts each map back in its own slot.
// Verify before using: dump the mean of each ORM channel and each of VRF's
// loose *_ao / *_rough / *_metal PNGs — if red matches _metal and blue matches
// _ao, the export is affected.
if (fixOrm) {
    const seen = new Set();
    for (const mat of root.listMaterials()) {
        for (const tex of [mat.getMetallicRoughnessTexture(), mat.getOcclusionTexture()]) {
            if (!tex || seen.has(tex)) continue;
            seen.add(tex);
            const { data, info } = await sharp(Buffer.from(tex.getImage()))
                .ensureAlpha().raw().toBuffer({ resolveWithObject: true });
            for (let i = 0; i < data.length; i += 4) {
                const r = data[i];
                data[i] = data[i + 2];
                data[i + 2] = r;
            }
            const png = await sharp(data, {
                raw: { width: info.width, height: info.height, channels: 4 },
            }).png().toBuffer();
            tex.setImage(png).setMimeType('image/png');
        }
    }
    console.log(`fixed ORM red/blue on ${seen.size} texture(s)`);
}

// No simplify: these models are already a few thousand tris, and a viewmodel is
// the one mesh on screen where silhouette damage would actually be visible.
await doc.transform(
    flatten(),
    join(),
    dedup(),
    textureCompress({ encoder: sharp, targetFormat: 'webp', quality: 85, resize: [texSize, texSize] }),
    prune(),
    quantize(),
);
stat('output');

doc.createExtension(EXTMeshoptCompression)
    .setRequired(true)
    .setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });

await io.write(output, doc);
const kb = (fs.statSync(output).size / 1024).toFixed(0);
console.log(`Written ${output} (${kb} KB)`);
