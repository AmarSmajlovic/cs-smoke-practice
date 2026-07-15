// Packs VRF's per-clip animation exports into a single GLB.
//
// Source2Viewer writes one GLB per .vnmclip_c, and each carries its own full copy
// of the skeleton. Merging them naively would leave seven nodes called "wpn" —
// three's GLTFLoader makes node names unique on load, so the animation tracks
// (which address bones by name) would bind to "wpn_1" and silently do nothing.
// Instead this keeps the first file's skeleton and re-points every other clip's
// channels onto it, matching bones by name.
//
// At runtime the skeleton in this file is never posed: AnimationMixer resolves
// track names against whatever root it's given (the arms model). It only has to
// exist so the channels have something to target.
//
// Usage:
//   node tools/pack-anims.mjs <out.glb> <name>=<clip.glb> [<name>=<clip.glb> ...]

import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression } from '@gltf-transform/extensions';
import { dedup, prune } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer';
import fs from 'node:fs';

const args = process.argv.slice(2);
const output = args[0];
const inputs = args.slice(1).map((a) => {
    const [name, file] = a.split('=');
    return { name, file };
});

if (!output || !inputs.length) {
    console.error('Usage: node pack-anims.mjs <out.glb> <name>=<clip.glb> [...]');
    process.exit(1);
}

await MeshoptEncoder.ready;
await MeshoptDecoder.ready;
const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });

// The throwcharge_* clips are single-frame poses — the game's animgraph just
// blends into them and holds. A zero-length AnimationClip is useless to three
// (the action reports itself finished the instant it starts), so a static track
// gets a second identical keyframe and becomes a short clip that holds its pose.
// The clip rig and the arms rig are not the same skeleton, and worse, they share
// names for different bones. In the clips the shoulder is "armUpperShoulder_L"
// and "arm_upper_L" is a helper dangling off the forearm; in the arms model
// "arm_upper_L" IS the shoulder. Binding by name alone drives the shoulder with
// the helper's animation and the mesh explodes. So the helpers and the rig-only
// bones (weapon attachment, root motion, IK targets) are dropped first, then the
// real shoulder is renamed onto the arms model's name.
// "wpn" is deliberately NOT dropped: it's the bone CS2 hangs the grenade off,
// and the clips animate it with the real release motion. Its parent in the clip
// rig is root_motion, which is identity, so an empty node named "wpn" parented to
// the arms root lands in exactly the same frame and the track drives it for free.
const DROP = /^(arm_upper_[LR]|armUpperStraighten|attachHand|root_motion|wpnEnd|wpnTip|wpnHand_[LR]|weapon|weapon_offset|econ|handle|pin|ring)$/;
const RENAME = {
    armUpperShoulder_L: 'arm_upper_L',
    armUpperShoulder_R: 'arm_upper_R',
};

const HOLD = 0.25;
function extend(input, output) {
    if (input.length !== 1) return [input, output];
    const stride = output.length;
    const out = new output.constructor(stride * 2);
    out.set(output, 0);
    out.set(output, stride);
    return [new input.constructor([0, HOLD]), out];
}

const base = await io.read(inputs[0].file);
const root = base.getRoot();
const buffer = root.listBuffers()[0];

// The clip exports carry a couple of placeholder triangles to hang the skin on,
// and the base doc's own animation is re-copied below like every other clip so
// they all take the same path through extend().
for (const mesh of root.listMeshes()) mesh.dispose();
for (const skin of root.listSkins()) skin.dispose();
for (const anim of root.listAnimations()) anim.dispose();

// Retarget in place: park the rig-only bones under a name nothing will look up,
// then move the real shoulder onto the arms model's name. Renaming rather than
// deleting keeps the hierarchy intact for the channels that survive.
for (const node of root.listNodes()) {
    const name = node.getName();
    if (DROP.test(name)) node.setName(`x_${name}`);
    else if (RENAME[name]) node.setName(RENAME[name]);
}
const nodesByName = new Map(root.listNodes().map((n) => [n.getName(), n]));
const resolve = (name) => (!name || DROP.test(name)
    ? null
    : nodesByName.get(RENAME[name] ?? name) ?? null);

for (const { name, file } of inputs) {
    const doc = await io.read(file);
    const src = doc.getRoot().listAnimations()[0];
    if (!src) { console.warn(`${file}: no animation, skipped`); continue; }

    const anim = base.createAnimation(name);
    let bound = 0, missed = 0;
    for (const ch of src.listChannels()) {
        const target = resolve(ch.getTargetNode()?.getName());
        if (!target) { missed++; continue; }
        const s = ch.getSampler();
        const [inArr, outArr] = extend(s.getInput().getArray(), s.getOutput().getArray());
        const sampler = base.createAnimationSampler()
            .setInterpolation(s.getInterpolation())
            .setInput(base.createAccessor()
                .setArray(inArr).setType('SCALAR').setBuffer(buffer))
            .setOutput(base.createAccessor()
                .setArray(outArr).setType(s.getOutput().getType()).setBuffer(buffer));
        anim.addSampler(sampler);
        anim.addChannel(base.createAnimationChannel()
            .setTargetNode(target).setTargetPath(ch.getTargetPath()).setSampler(sampler));
        bound++;
    }
    console.log(`  ${name.padEnd(14)} ${bound} channels${missed ? `, ${missed} unmatched` : ''}`);
}

await base.transform(dedup(), prune({ keepLeaves: true }));

base.createExtension(EXTMeshoptCompression)
    .setRequired(true)
    .setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });

await io.write(output, base);
console.log(`\nWritten ${output} (${(fs.statSync(output).size / 1024).toFixed(0)} KB, ` +
    `${base.getRoot().listAnimations().length} clips)`);
