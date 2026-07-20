// Re-encode a map GLB's textures to KTX2/Basis (GPU-compressed) so they stay
// compressed in GPU memory — same resolution, ~5-6x less VRAM. Fixes mobile OOM
// on heavy maps (e.g. inferno) without dropping texture resolution.
//
// Geometry is kept meshopt-compressed & quantized (unchanged).
//
//   node tools/ktx2-map.mjs <in.glb> <out.glb> [-q N] [--uastc] [--no-mipmap]
//     -q N        ETC1S quality 1..255 (default 192; higher = better/larger)
//     --uastc     use UASTC (higher quality, larger VRAM) instead of ETC1S
//     --no-mipmap don't generate mipmaps

import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression, KHRTextureBasisu } from '@gltf-transform/extensions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import sharp from 'sharp';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const args = process.argv.slice(2);
const input = args[0], output = args[1];
if (!input || !output) { console.error('Usage: node tools/ktx2-map.mjs <in.glb> <out.glb> [-q N] [--uastc] [--no-mipmap]'); process.exit(1); }
const q = parseInt(args[args.indexOf('-q') + 1]) || 192;
const uastc = args.includes('--uastc');
const mipmap = !args.includes('--no-mipmap');

await MeshoptDecoder.ready;
await MeshoptEncoder.ready;
const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });

console.log(`Reading ${input} ...`);
const doc = await io.read(input);
const root = doc.getRoot();
const textures = root.listTextures();
console.log(`${textures.length} textures -> KTX2 (${uastc ? 'UASTC' : 'ETC1S q=' + q}${mipmap ? ', mipmaps' : ''})`);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ktx2-'));
let done = 0, srcBytes = 0, outBytes = 0, skipped = 0;

for (const tex of textures) {
    const img = tex.getImage();
    if (!img) { skipped++; continue; }
    srcBytes += img.byteLength;
    const inPng = path.join(tmp, `t${done}.png`);
    const outKtx = path.join(tmp, `t${done}.ktx2`);
    // basisu reads png/jpg/tga — convert whatever's inside (usually webp) to png
    await sharp(Buffer.from(img)).png().toFile(inPng);
    const cmd = ['-ktx2', '-q', String(q), '-output_file', outKtx];
    if (uastc) { cmd.splice(1, 2, '-uastc'); }        // replace -q with -uastc
    if (mipmap) cmd.push('-mipmap');
    cmd.push(inPng);
    try {
        execFileSync('basisu', cmd, { stdio: ['ignore', 'ignore', 'pipe'] });
    } catch (e) {
        console.warn(`  basisu failed on texture ${done} (${tex.getName()}): ${e.stderr?.toString().trim().split('\n').pop() || e.message}`);
        skipped++; done++; continue;
    }
    const ktx = fs.readFileSync(outKtx);
    tex.setImage(new Uint8Array(ktx)).setMimeType('image/ktx2');
    outBytes += ktx.byteLength;
    done++;
    if (done % 25 === 0) process.stdout.write(`  ${done}/${textures.length}\r`);
}
fs.rmSync(tmp, { recursive: true, force: true });

// mark KTX2 textures as required, keep geometry meshopt-compressed
doc.createExtension(KHRTextureBasisu).setRequired(true);
doc.createExtension(EXTMeshoptCompression).setRequired(true)
    .setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });

await io.write(output, doc);
const mb = n => (n / 1048576).toFixed(1);
console.log(`\nEncoded ${done - skipped} textures (${skipped} skipped).`);
console.log(`  texture payload: ${mb(srcBytes)} MB -> ${mb(outBytes)} MB (in-file)`);
console.log(`Written ${output} (${mb(fs.statSync(output).size)} MB)`);
