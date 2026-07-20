// READ-ONLY analiza: gdje je memorija u inferno.glb i da li se "van granica"
// geometrija čisto odvaja od igrane, koristeći collision mesh kao playable AABB.
// Ništa ne mijenja — samo mjeri i izvještava.
//
//   node tools/analyze-inferno.mjs

import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dequantize } from '@gltf-transform/functions';
import { MeshoptDecoder } from 'meshoptimizer';
import sharp from 'sharp';

await MeshoptDecoder.ready;
const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });

// ---- world matrix helper (accumulate parents) ----
function mul(a, b) { // 4x4 col-major * 4x4
    const o = new Array(16).fill(0);
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++)
        for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
    return o;
}
function worldMatrix(node) {
    let m = node.getMatrix();
    let p = node.getParentNode?.() || null;
    // gltf-transform: parents via listParents; walk up Node parents
    let cur = node;
    const chain = [];
    while (cur) { chain.push(cur); cur = cur.getParentNode ? cur.getParentNode() : null; }
    m = [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1];
    for (let i = chain.length - 1; i >= 0; i--) m = mul(m, chain[i].getMatrix());
    return m;
}
function xf(m, v) {
    return [
        m[0]*v[0] + m[4]*v[1] + m[8]*v[2]  + m[12],
        m[1]*v[0] + m[5]*v[1] + m[9]*v[2]  + m[13],
        m[2]*v[0] + m[6]*v[1] + m[10]*v[2] + m[14],
    ];
}
function meshWorldAABB(node, mesh) {
    const wm = worldMatrix(node);
    let mn = [Infinity,Infinity,Infinity], mx = [-Infinity,-Infinity,-Infinity];
    for (const prim of mesh.listPrimitives()) {
        const pos = prim.getAttribute('POSITION');
        if (!pos) continue;
        const pmin = pos.getMinNormalized ? pos.getMin([]) : pos.getMin([]);
        const pmax = pos.getMax([]);
        // 8 corners through world matrix
        for (const cx of [pmin[0], pmax[0]]) for (const cy of [pmin[1], pmax[1]]) for (const cz of [pmin[2], pmax[2]]) {
            const w = xf(wm, [cx, cy, cz]);
            for (let i = 0; i < 3; i++) { mn[i] = Math.min(mn[i], w[i]); mx[i] = Math.max(mx[i], w[i]); }
        }
    }
    return { mn, mx };
}

async function collisionAABB() {
    const doc = await io.read('public/maps/inferno-collision.glb');
    await doc.transform(dequantize());
    const root = doc.getRoot();
    let mn = [Infinity,Infinity,Infinity], mx = [-Infinity,-Infinity,-Infinity];
    for (const node of root.listNodes()) {
        const mesh = node.getMesh();
        if (!mesh) continue;
        const b = meshWorldAABB(node, mesh);
        for (let i = 0; i < 3; i++) { mn[i] = Math.min(mn[i], b.mn[i]); mx[i] = Math.max(mx[i], b.mx[i]); }
    }
    return { mn, mx };
}

const play = await collisionAABB();
console.log('Playable AABB (collision, world units):');
console.log('  min', play.mn.map(n => n.toFixed(0)));
console.log('  max', play.mx.map(n => n.toFixed(0)));
const size = play.mx.map((v, i) => v - play.mn[i]);
console.log('  size', size.map(n => n.toFixed(0)));

// margin = 8% of the largest horizontal span, so wall/edge meshes stay "in"
const horiz = Math.max(size[0], size[2]);
const margin = horiz * 0.08;
const inMin = play.mn.map(v => v - margin);
const inMax = play.mx.map(v => v + margin);
function insidePlayable(b) {
    // overlaps the expanded playable box in X and Z (ignore Y so tall walls count)
    return b.mx[0] >= inMin[0] && b.mn[0] <= inMax[0] &&
           b.mx[2] >= inMin[2] && b.mn[2] <= inMax[2];
}

const doc = await io.read('public/maps/inferno.glb');
await doc.transform(dequantize());
const root = doc.getRoot();

// texture -> {w,h, bytes, usedByIn, usedByOut}
const texInfo = new Map();
for (const tex of root.listTextures()) {
    const img = tex.getImage();
    let w = 0, h = 0;
    try { const md = await sharp(Buffer.from(img)).metadata(); w = md.width; h = md.height; } catch {}
    texInfo.set(tex, { w, h, bytes: img.byteLength, decoded: w * h * 4, usedByIn: false, usedByOut: false, name: tex.getName() });
}

// map material -> textures
function matTextures(mat) {
    const t = [];
    for (const get of ['getBaseColorTexture','getEmissiveTexture','getNormalTexture','getMetallicRoughnessTexture','getOcclusionTexture']) {
        const tex = mat[get]?.(); if (tex) t.push(tex);
    }
    return t;
}

let inCount = 0, outCount = 0;
const outNames = [];
for (const node of root.listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    const b = meshWorldAABB(node, mesh);
    if (!isFinite(b.mn[0])) continue;
    const inside = insidePlayable(b);
    if (inside) inCount++; else { outCount++; outNames.push(mesh.getName() || node.getName()); }
    for (const prim of mesh.listPrimitives()) {
        const mat = prim.getMaterial(); if (!mat) continue;
        for (const tex of matTextures(mat)) {
            const ti = texInfo.get(tex); if (!ti) continue;
            if (inside) ti.usedByIn = true; else ti.usedByOut = true;
        }
    }
}

let totalDecoded = 0, outOnlyDecoded = 0, totalFile = 0, outOnlyFile = 0;
let outOnlyTex = 0;
for (const ti of texInfo.values()) {
    totalDecoded += ti.decoded; totalFile += ti.bytes;
    if (ti.usedByOut && !ti.usedByIn) { outOnlyDecoded += ti.decoded; outOnlyFile += ti.bytes; outOnlyTex++; }
}
const MB = n => (n / 1048576).toFixed(1);

console.log('\n--- MESHES ---');
console.log(`  in-bounds (igrano): ${inCount}   out-of-bounds (pozadina): ${outCount}`);
console.log('\n--- TEXTURES ---');
console.log(`  ukupno: ${texInfo.size} tekstura`);
console.log(`  file (compressed webp u GLB): ${MB(totalFile)} MB`);
console.log(`  decoded (GPU RAM, ~w*h*4): ${MB(totalDecoded)} MB   <-- ovo obara mobilni tab`);
console.log(`  SAMO out-of-bounds teksture: ${outOnlyTex} kom`);
console.log(`    file: ${MB(outOnlyFile)} MB   decoded/GPU: ${MB(outOnlyDecoded)} MB  <-- potencijalna ušteda`);

// texture size histogram
const hist = {};
for (const ti of texInfo.values()) { const k = `${ti.w}x${ti.h}`; hist[k] = (hist[k]||0)+1; }
console.log('\n--- dimenzije tekstura (histogram) ---');
for (const [k,v] of Object.entries(hist).sort((a,b)=>b[1]-a[1])) console.log(`  ${k}: ${v}`);

console.log('\n--- primjer out-of-bounds mesh imena (prvih 25) ---');
console.log('  ' + outNames.slice(0, 25).join('\n  '));
