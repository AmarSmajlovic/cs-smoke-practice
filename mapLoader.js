import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import {
    computeBoundsTree,
    disposeBoundsTree,
    acceleratedRaycast,
} from 'three-mesh-bvh';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { VRF_SCALE } from './physicsConfig.js';

// Accelerate all raycasts against geometries that have a bounds tree
THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

// Map registry.
//  - scale: exact world-units-per-file-unit (Source 2 Viewer exports are 1:1 HU)
//  - targetSize: fallback for rips of unknown scale — desired horizontal extent
//    in HU; the model is measured and auto-scaled to it
//  - physicsPath: real in-game collision mesh (VRF *_physics export) — used for
//    the collider instead of the visual mesh when present
//  - zUp: file has Z as the vertical axis
// Hand-measured MIRAGE holes in the nade collider: invisible physics seals
// that real CS2 grenades demonstrably pass (csnades "Left Arch from Back
// Alley" + top-short references). Mirage-only calibration data — the app
// passes them via MAPS.mirage, the headless harness gets them as defaults.
export const MIRAGE_NADE_PASS_ZONES = [
    { minX: 335, maxX: 565, minY: 195, maxY: 305, minZ: -1255, maxZ: -945 },
    // the chimney-like block on the top-short walkway: its side faces reach
    // below the corridor and swatted throws a hair right of the reference line
    { minX: 385, maxX: 485, minY: 130, maxY: 305, minZ: -1195, maxZ: -1085 },
    // the 30u stub on the touch-down tile that deflected arriving throws
    // sideways (floor centroids sit below 118)
    { minX: 312, maxX: 348, minY: 118, maxY: 148, minZ: -1232, maxZ: -1198 },
];

export const MAPS = {
    mirage: {
        name: 'de_mirage',
        path: '/maps/mirage.glb?v=1',
        sizeMB: 35.1, // progress fallback when the server hides Content-Length
        scale: VRF_SCALE,
        zUp: false,
        // The game's REAL world collision (VRF export of world_physics.vmdl,
        // packed by tools/pack-collision.mjs — already in HU, app axes).
        // Node names carry the game's collision groups: physics_group_*,
        // physics_csgo_grenadeclip, physics_npcclip_playerclip, physics_sky…
        collisionPath: '/maps/mirage-collision.glb?v=1',
        softGroundPath: '/maps/mirage-softground.json?v=1',
        nadePassZones: MIRAGE_NADE_PASS_ZONES,
        nadeCeilingY: 650,
        // The REAL competitive spawn slots (priority-0 info_player_* entities
        // from de_mirage default_ents, extracted via Source2Viewer) so instant
        // smokes can be practiced from every spawn you can actually get in a
        // match. App frame: x = game Y, z = game X; yaw = game yaw degrees.
        spawns: {
            T: [
                { x: -352, z: 1296, yaw: 227 },
                { x: -307, z: 1216, yaw: 270 },
                { x: -256, z: 1136, yaw: 270 },
                { x: -211, z: 1216, yaw: 270 },
                { x: -160, z: 1136, yaw: 270 },
                { x: -115, z: 1216, yaw: 90 },
                { x: -64, z: 1136, yaw: 90 },
                { x: -16, z: 1216, yaw: 90 },
                { x: 32, z: 1296, yaw: 141 },
                { x: 32, z: 1136, yaw: 90 },
            ],
            CT: [
                { x: -1976, z: -1776, yaw: 331 },
                { x: -1976, z: -1656, yaw: 299 },
                { x: -1896, z: -1720, yaw: 50 },
                { x: -1800, z: -1776, yaw: 36 },
                { x: -1800, z: -1656, yaw: 94 },
            ],
        },
        // spawn-picker snapshot orientation: sides whose base reads upside
        // down with the default framing get rotated 180 degrees
        radarRot180: ['CT'],
    },
    dust2: {
        name: 'de_dust2',
        path: '/maps/dust2.glb?v=2',
        sizeMB: 60.0,
        scale: VRF_SCALE,
        zUp: false,
        collisionPath: '/maps/dust2-collision.glb?v=2',
        softGroundPath: '/maps/dust2-softground.json?v=2',
        // ground weed/grass sprite cards export as opaque-looking brown
        // crumple; in game they are barely-visible tufts — drop them
        stripVisual: /dust_weeds|weeds_cressa|zebra_grass|sagebrush/i,
        // The leaning wood pallet up to the B-halls platform: climbable in CS2
        // (two hops), but the exported hull is a steep slab the player slides
        // off. Flat cap on its top face (measured via live-dust2-jumptest).
        // Two steps: near half (player side) low, far half (ledge side) high —
        // the pallet leans diagonally, one full-footprint cap would hang over
        // the player's head and block the jump instead of carrying it.
        playerPatches: [
            { min: [2356, -92, 76], max: [2374, -86, 96] },
            { min: [2325, -72, 46], max: [2356, -66, 76] },
        ],
        // priority-0 info_player_* from de_dust2 default_ents (same extraction
        // as mirage). App frame: x = game Y, z = game X; yaw = game yaw.
        spawns: {
            T: [
                { x: -796, z: -822, yaw: 107 },
                { x: -738, z: -858, yaw: 37 },
                { x: -836, z: -761, yaw: 128 },
                { x: -807, z: -697, yaw: 178 },
                { x: -756, z: -657, yaw: 208 },
                { x: -808, z: -1141, yaw: 112 },
                { x: -754, z: -1181, yaw: 42 },
                { x: -843, z: -1076, yaw: 133 },
                { x: -808, z: -1015, yaw: 183 },
                { x: -754, z: -980, yaw: 213 },
                { x: -808, z: -493, yaw: 112 },
                { x: -754, z: -533, yaw: 42 },
                { x: -843, z: -428, yaw: 133 },
                { x: -808, z: -367, yaw: 183 },
                { x: -754, z: -332, yaw: 213 },
            ],
            CT: [
                { x: 2439, z: 182, yaw: 356 },
                { x: 2370, z: 160, yaw: 24 },
                { x: 2481, z: 258, yaw: 292 },
                { x: 2434, z: 334, yaw: 230 },
                { x: 2353, z: 351, yaw: 202 },
            ],
        },
    },
    inferno: {
        name: 'de_inferno',
        path: '/maps/inferno-ktx2.glb?v=5',
        sizeMB: 100,
        scale: VRF_SCALE,
        zUp: false,
        collisionPath: '/maps/inferno-collision.glb?v=4',
        softGroundPath: '/maps/inferno-softground.json?v=4',
        lightenWindows: /_glass\b|glass_|_windows_|window_opaque|apartment_windows/i,
        warmTint: 0xfff1e0, // subtle golden warmth toward the CS2 inferno tone
        // Construction/clutter props that are in this vpk but NOT in live CS2
        // inferno (user-verified in game): cones, barrier, wheelbarrow, trash
        // bags, scaffolding, garbage bins, pallet. Strip so mid/arch match CS2.
        stripVisual: /traffic_cone|trashbag|wheelbarrow|tuscan_scaffolding|garbage_?bin|italy_barricade|pallet_wood|streetbarrier|concrete_bag|_cement_|sandbag/i,
        // Single door instance that closes the CT-side library entrance (open
        // in live CS2); the door material is shared map-wide so it's removed by
        // box, not by name. No collision here (verified).
        stripBoxes: [
            { min: [1548, 158, 2300], max: [1560, 275, 2376] },
        ],
        // spawns carry the entity height y (game z) — inferno spawns sit UNDER
        // apartment roofs, so findSpawn must drop from just above y, not from
        // the map top (which lands the player on a roof).
        spawns: {
            T: [
                { x: 441, y: -46, z: -1587, yaw: 337 },
                { x: 431, y: -46, z: -1520, yaw: 267 },
                { x: 420, y: -46, z: -1657, yaw: 358 },
                { x: 352, y: -46, z: -1676, yaw: 48 },
                { x: 289, y: -46, z: -1662, yaw: 78 },
            ],
            CT: [
                { x: 2090, y: 141, z: 2493, yaw: 224 },
                { x: 2153, y: 141, z: 2457, yaw: 252 },
                { x: 2006, y: 141, z: 2472, yaw: 160 },
                { x: 1977, y: 141, z: 2353, yaw: 98 },
                { x: 2028, y: 141, z: 2292, yaw: 70 },
                { x: 2079, y: 155, z: 2397, yaw: 135 },
            ],
        },
    },
};

export class MapLoader {
    constructor(scene, renderer = null) {
        this.scene = scene;
        this.loader = new GLTFLoader();
        this.loader.setMeshoptDecoder(MeshoptDecoder);
        // KTX2/Basis textures stay GPU-compressed (a fraction of the VRAM of
        // decoded RGBA) — required so heavy maps like inferno fit mobile memory.
        // detectSupport needs the renderer to pick a GPU-supported target format.
        if (renderer) {
            this.ktx2Loader = new KTX2Loader()
                .setTranscoderPath('/basis/')
                .detectSupport(renderer);
            this.loader.setKTX2Loader(this.ktx2Loader);
        }
        this.loadedMap = null;         // root group (visual + physics)
        this.visualRoot = null;        // visible geometry only
        this.collider = null;          // merged static mesh with a BVH, used by ALL physics
        this.nadeCollider = null;      // grenade collision (game world_physics groups)
        this.colliderVisualizer = null;
        this.baseHorizontal = null;
        this.ladderZones = [];         // Box3 volumes where the player can climb
        this.breakables = [];          // { mesh, box, broken } — glass the nade smashes through
    }

    async loadMap(mapDef, region = null, onProgress = null) {
        const gltf = await new Promise((resolve, reject) => {
            this.loader.load(mapDef.path, resolve, (ev) => {
                if (onProgress) onProgress('download', ev.loaded, ev.total);
            }, reject);
        });
        if (onProgress) onProgress('build');
        // let the loading UI paint before the heavy synchronous work below
        await new Promise(r => setTimeout(r, 40));
        const visual = gltf.scene;

        // Strip baked-in light entities (VRF exports the in-game sun with
        // huge physical intensity — it nukes the whole scene to white)
        const lights = [];
        visual.traverse((child) => { if (child.isLight) lights.push(child); });
        for (const light of lights) light.parent.remove(light);
        if (lights.length) console.log(`Removed ${lights.length} baked light(s) from map`);

        this.fixSkinnedMeshes(visual);
        this.stripEffectMeshes(visual);
        // Per-map cosmetic strip: exported detail clutter that reads as junk
        // in-app (ground weed/grass sprite cards render like brown paper).
        // Visual only — colliders come from the physics glb.
        if (mapDef.stripVisual) {
            const doomed = [];
            visual.traverse((o) => {
                if (o.isMesh && (mapDef.stripVisual.test(o.name) || mapDef.stripVisual.test(o.material?.name || ''))) doomed.push(o);
            });
            for (const m of doomed) m.parent.remove(m);
            if (doomed.length) console.log(`Stripped ${doomed.length} map-specific clutter mesh(es)`);
        }
        this.optimizeMaterials(visual, mapDef);

        const mapRoot = new THREE.Group();
        mapRoot.name = 'mapRoot';
        mapRoot.add(visual);

        // Real in-game collision mesh, if available
        let physicsRoot = null;
        if (mapDef.physicsPath) {
            try {
                const pgltf = await this.loader.loadAsync(mapDef.physicsPath);
                physicsRoot = pgltf.scene;
                physicsRoot.visible = false;
                mapRoot.add(physicsRoot);
            } catch (e) {
                console.warn('Physics mesh failed to load, falling back to visual mesh:', e);
            }
        }

        if (mapDef.zUp) mapRoot.rotation.x = -Math.PI / 2;
        this.scene.add(mapRoot);
        this.loadedMap = mapRoot;
        this.visualRoot = visual;
        mapRoot.updateMatrixWorld(true);

        // Scale to Hammer units: exact scale if known, otherwise measure the
        // footprint and scale the longer horizontal side to targetSize HU
        if (mapDef.scale) {
            this.baseHorizontal = null;
            mapRoot.scale.setScalar(mapDef.scale);
        } else {
            const baseBox = new THREE.Box3().setFromObject(visual);
            const baseSize = baseBox.getSize(new THREE.Vector3());
            this.baseHorizontal = Math.max(baseSize.x, baseSize.z);
            mapRoot.scale.setScalar(mapDef.targetSize / this.baseHorizontal);
        }
        mapRoot.updateMatrixWorld(true);

        // stripBoxes run here (after scale) so world positions are in app HU —
        // remove VISUAL faces inside world-space boxes: single prop instances
        // sharing a map-wide material (e.g. one closed door CS2 doesn't have).
        // Visual only; targets verified to have no collision.
        if (mapDef.stripBoxes) {
            const boxes = mapDef.stripBoxes.map((bx) =>
                new THREE.Box3(new THREE.Vector3(...bx.min), new THREE.Vector3(...bx.max)));
            let faces = 0;
            const va = new THREE.Vector3(), vb = new THREE.Vector3(), vc = new THREE.Vector3(), ct = new THREE.Vector3();
            visual.traverse((o) => {
                if (!o.isMesh || !o.geometry.attributes.position) return;
                const wb = new THREE.Box3().setFromBufferAttribute(o.geometry.attributes.position).applyMatrix4(o.matrixWorld);
                if (!boxes.some((b) => b.intersectsBox(wb))) return;
                const g = o.geometry, pos = g.attributes.position, idx = g.index, wm = o.matrixWorld;
                const tri = idx ? idx.count / 3 : pos.count / 3;
                const kept = [];
                for (let f = 0; f < tri; f++) {
                    const i0 = idx ? idx.getX(f * 3) : f * 3, i1 = idx ? idx.getX(f * 3 + 1) : f * 3 + 1, i2 = idx ? idx.getX(f * 3 + 2) : f * 3 + 2;
                    va.fromBufferAttribute(pos, i0).applyMatrix4(wm);
                    vb.fromBufferAttribute(pos, i1).applyMatrix4(wm);
                    vc.fromBufferAttribute(pos, i2).applyMatrix4(wm);
                    ct.addVectors(va, vb).add(vc).multiplyScalar(1 / 3);
                    if (boxes.some((b) => b.containsPoint(ct))) { faces++; continue; }
                    kept.push(i0, i1, i2);
                }
                if (idx) g.setIndex(kept);
            });
            if (faces) console.log(`Stripped ${faces} face(s) inside stripBoxes`);
        }

        this.collectSpecialMeshes(visual);
        // per-map soft-ground grid (dirt/sand cells for the bounce physics)
        this.softGround = null;
        if (mapDef.softGroundPath) {
            try {
                this.softGround = await (await fetch(mapDef.softGroundPath)).json();
            } catch (e) { console.warn('softground grid failed to load:', e); }
        }
        if (mapDef.collisionPath) {
            // the game's real collision hulls — used for BOTH player and nades
            await this.buildGameCollision(mapDef.collisionPath, mapDef.nadePassZones ?? [], mapDef.nadeCeilingY ?? Infinity, mapDef.playerPatches ?? null);
        } else {
            this.buildCollider(physicsRoot || visual);
        }

        if (region) this.clipToRegion(visual, region);

        const box = new THREE.Box3().setFromObject(mapRoot);
        console.log(`Map loaded: ${mapDef.path}` + (physicsRoot ? ' + physics mesh' : ' (no physics mesh)'));
        console.log('Bounds (HU): min', box.min.toArray().map(v => v.toFixed(0)).join(','),
            'max', box.max.toArray().map(v => v.toFixed(0)).join(','));

        return mapRoot;
    }

    // Remove the loaded map and free GPU/BVH memory (for map switching)
    unload() {
        if (!this.loadedMap) return;
        this.scene.remove(this.loadedMap);
        this.loadedMap.traverse((child) => {
            if (!child.isMesh) return;
            child.geometry.dispose();
            const mats = Array.isArray(child.material) ? child.material : [child.material];
            for (const m of mats) { if (m) { m.map?.dispose(); m.dispose(); } }
        });
        if (this.collider) {
            this.collider.geometry.disposeBoundsTree();
            this.collider.geometry.dispose();
            this.collider = null;
        }
        if (this.nadeCollider) {
            this.nadeCollider.geometry.disposeBoundsTree();
            this.nadeCollider.geometry.dispose();
            this.nadeCollider = null;
        }
        if (this.colliderVisualizer) {
            this.scene.remove(this.colliderVisualizer);
            this.colliderVisualizer.material.dispose();
            this.colliderVisualizer = null;
        }
        this.loadedMap = null;
        this.visualRoot = null;
        this.ladderZones = [];
        this.breakables = [];
    }

    // Find ladders and breakable windows by name. Merged exports can aggregate
    // several instances into one mesh, so ladder volumes are built by
    // clustering vertices into grid cells instead of one huge bbox.
    collectSpecialMeshes(rootObj) {
        this.ladderZones = [];
        this.breakables = [];
        rootObj.updateMatrixWorld(true);
        const v = new THREE.Vector3();

        rootObj.traverse((child) => {
            if (!child.isMesh) return;
            const name = child.name.toLowerCase();

            if (/ladder/.test(name)) {
                // cluster world-space vertices into 128u cells -> one zone per ladder
                const cells = new Map();
                const pos = child.geometry.attributes.position;
                for (let i = 0; i < pos.count; i += 3) {
                    v.set(pos.getX(i), pos.getY(i), pos.getZ(i)).applyMatrix4(child.matrixWorld);
                    const key = `${Math.floor(v.x / 128)},${Math.floor(v.z / 128)}`;
                    if (!cells.has(key)) cells.set(key, new THREE.Box3());
                    cells.get(key).expandByPoint(v);
                }
                for (const box of cells.values()) {
                    // skip decorative ladders lying on the ground (not climbable)
                    if (box.max.y - box.min.y < 80) continue;
                    box.expandByVector(new THREE.Vector3(22, 6, 22));
                    this.ladderZones.push(box);
                }
            } else if (/breakable/.test(name)) {
                const box = new THREE.Box3().setFromObject(child);
                box.expandByScalar(CS2_BREAK_MARGIN);
                this.breakables.push({ mesh: child, box, broken: false });
            }
        });
        console.log(`Special meshes: ${this.ladderZones.length} ladder zones, ${this.breakables.length} breakables`);
    }

    // Remove particle/effect meshes the VRF export turned into solid geometry
    // (e.g. Mirage's ambient dust volume "effects/smoke/dust_002" becomes a
    // giant grey wall over the sky that also blocks grenades). Must run BEFORE
    // optimizeMaterials (which drops the vmat path) and buildCollider.
    stripEffectMeshes(rootObj) {
        const isEffectMat = (mat) => {
            const vmat = (mat?.userData?.vmat?.Name || '').toLowerCase();
            return /^materials\/(effects\/smoke|particle)\//.test(vmat);
        };
        const toRemove = [];
        rootObj.traverse((child) => {
            if (!child.isMesh) return;
            const mats = Array.isArray(child.material) ? child.material : [child.material];
            if (mats.length && mats.every(isEffectMat)) toRemove.push(child);
        });
        for (const mesh of toRemove) {
            console.log(`Stripped effect mesh: ${mesh.name}`);
            mesh.parent.remove(mesh);
        }
        if (toRemove.length) console.log(`Removed ${toRemove.length} effect mesh(es) from map`);
    }

    // Replace SkinnedMesh without valid skeleton (common in ripped exports)
    fixSkinnedMeshes(rootObj) {
        const toReplace = [];
        rootObj.traverse((child) => { if (child.isSkinnedMesh) toReplace.push(child); });
        for (const skinned of toReplace) {
            const normalMesh = new THREE.Mesh(skinned.geometry, skinned.material);
            normalMesh.name = skinned.name;
            normalMesh.position.copy(skinned.position);
            normalMesh.rotation.copy(skinned.rotation);
            normalMesh.scale.copy(skinned.scale);
            skinned.parent.add(normalMesh);
            skinned.parent.remove(skinned);
        }
    }

    // Swap PBR materials for cheap Lambert ones
    optimizeMaterials(rootObj, mapDef = {}) {
        let meshCount = 0;
        rootObj.traverse((child) => {
            if (!child.isMesh) return;
            meshCount++;
            child.castShadow = false;
            child.receiveShadow = false;
            if (!child.material) return;

            const materials = Array.isArray(child.material) ? child.material : [child.material];
            const newMaterials = materials.map(mat => {
                // Per-map warm tint: inferno's CS2 look comes from golden
                // baked light we strip. A subtle warm multiply on the base
                // colour nudges the flat render toward that tone.
                const baseTint = mapDef.warmTint || 0xffffff;
                const optimalMat = new THREE.MeshLambertMaterial({
                    map: mat.map || null,
                    color: mat.map ? baseTint : (mat.color || new THREE.Color(0xcccccc)),
                    transparent: mat.transparent || false,
                    opacity: mat.opacity !== undefined ? mat.opacity : 1.0,
                    alphaTest: mat.alphaTest || 0,
                    side: THREE.DoubleSide,
                });
                optimalMat.name = mat.name || ''; // keep for collider filtering
                const name = (mat.name || '').toLowerCase();
                // Dark window glass: CS2 shows reflections/interior through these
                // panes, but flat-shaded the dark texture renders as ugly black
                // squares. Replace with a flat pale glass tint (drop the texture)
                // so windows read as lit panes, closer to the in-game look.
                if (mapDef.lightenWindows && mapDef.lightenWindows.test(mat.name || '')) {
                    optimalMat.map = null;
                    optimalMat.color = new THREE.Color(0x9fb0bd); // pale blue-grey glass
                    optimalMat.transparent = false;
                    return optimalMat;
                }
                // Decals/overlays (stains, wear, signs, sprays) have SOFT alpha
                // and sit co-planar with walls: alphaTest 0.5 erases them and
                // plain blending z-fights. Real blend + polygon offset keeps
                // them visible — they are the wall detail lineups aim at.
                // ONLY genuine thin decals — NOT blend walls. Broad tokens like
                // "overlay" / "_dirt_" catch solid blend-wall materials
                // (old_plaster_blend_01_overlay, concrete_dirt_blend) and make
                // them see-through. Match decal-specific names and the
                // "overlay_ground/overlay_wall" DECAL prefixes, never the
                // "_overlay" blend-variant SUFFIX.
                if (mat.map && /decal|_spray|graffiti|poster|wall_stain|overlay_ground|overlay_wall|striping|signage|paint_patch|ghost_sign|bombsite_signs/.test(name)) {
                    // Soft-alpha decals: NO alphaTest — a threshold turns the
                    // soft gradient into a hard smeared rectangle. Pure blend +
                    // polygon offset lets the gradient fade smoothly.
                    optimalMat.transparent = true;
                    optimalMat.alphaTest = 0;
                    optimalMat.depthWrite = false;
                    optimalMat.polygonOffset = true;
                    optimalMat.polygonOffsetFactor = -2;
                    optimalMat.polygonOffsetUnits = -2;
                } else if (mat.map && (name.includes('foliage') || name.includes('tree') || name.includes('fence') || mat.transparent)) {
                    optimalMat.transparent = false;
                    optimalMat.alphaTest = 0.5;
                }
                // Source 2 foliage shader stores wind-sway data in COLOR_0,
                // not albedo tint — using it as color renders tarps/plants black
                const shader = mat.userData?.vmat?.ShaderName || '';
                if (mat.vertexColors && shader !== 'csgo_foliage.vfx') optimalMat.vertexColors = true;
                // 2-way blend walls/floors: layer2 color rides in the emissive
                // slot (packed by optimize-map.mjs) and _TEXCOORD_4 carries the
                // per-vertex blend weight. Modulation mask, when packed, lives
                // in layer2 alpha and shapes the reveal like the game shader;
                // without it a smoothstep on the weight approximates the look.
                if (mat.emissiveMap && mat.userData?.vmat?.TextureParams?.g_tLayer2Color) {
                    const layer2 = mat.emissiveMap;
                    optimalMat.onBeforeCompile = (sh) => {
                        sh.uniforms.layer2Map = { value: layer2 };
                        sh.vertexShader = sh.vertexShader
                            .replace('#include <common>', '#include <common>\nattribute vec4 _texcoord_4;\nvarying float vLayerBlend;')
                            .replace('#include <uv_vertex>', '#include <uv_vertex>\nvLayerBlend = _texcoord_4.x;');
                        sh.fragmentShader = sh.fragmentShader
                            .replace('#include <common>', '#include <common>\nuniform sampler2D layer2Map;\nvarying float vLayerBlend;')
                            .replace('#include <map_fragment>', `#include <map_fragment>
{
    vec4 l2 = texture2D(layer2Map, vMapUv);
    float w = clamp(vLayerBlend, 0.0, 1.0);
    float t = (l2.a < 0.999)
        ? clamp((w + l2.a - 1.0) / 0.25, 0.0, 1.0)
        : smoothstep(0.05, 0.6, w);
    diffuseColor.rgb = mix(diffuseColor.rgb, l2.rgb, t);
}`);
                    };
                    optimalMat.customProgramCacheKey = () => 'cs2blend';
                }
                return optimalMat;
            });
            child.material = Array.isArray(child.material) ? newMaterials : newMaterials[0];
        });
        console.log(`Materials optimized on ${meshCount} meshes`);
    }

    // Is this point over a dirt/sand floor cell? (per-map grid baked by
    // tools/build-softground.mjs; shared verbatim with the headless harness)
    isSoftGround(x, z) {
        const sg = this.softGround;
        if (!sg) return false;
        const ix = Math.floor((x - sg.minX) / sg.cell);
        const iz = Math.floor((z - sg.minZ) / sg.cell);
        return sg.rows[iz]?.[ix] === '1';
    }

    // Merge the given subtree into one static geometry and build a BVH over it.
    // Physics always collides with the FULL map, even when a region hides visuals.
    buildCollider(rootObj, patches = null) {
        const t0 = performance.now();
        rootObj.updateMatrixWorld(true);

        // Bake every mesh into world space, position attribute only.
        // Positions are copied into Float32 via getX/getY/getZ so quantized
        // (int16/normalized) attributes survive the world transform.
        const geometries = [];
        rootObj.traverse((child) => {
            if (!child.isMesh || !child.geometry.attributes.position) return;
            if (/breakable/.test(child.name.toLowerCase())) return; // nades smash through glass
            // Non-solid to grenades in CS2: whole trees (trunks included),
            // railings (metalwall031a = Mirage rail bars), rooftop antennas
            // and dishes (roof_dish bucket), telephone poles, all wiring, and
            // cloth (B apps courtyard tarps — smokes fly through into the
            // courtyard). "trees" not "tree": /tree/ matches "street".
            const PASS = /branches|foliage|leaves|trees|palm|bark|metalrail|metalwall031|roof_dish|dishestibet|telephone_pole|electric_cables|wall_wires|wirespout|tarp|cloth|awning/i;
            if (PASS.test(child.name)) return;
            const mats = Array.isArray(child.material) ? child.material : [child.material];
            if (mats.length && mats.every(m => PASS.test(m?.name || ''))) return;
            const g = child.geometry.index ? child.geometry.toNonIndexed() : child.geometry;
            const src = g.attributes.position;
            const arr = new Float32Array(src.count * 3);
            for (let i = 0; i < src.count; i++) {
                arr[i * 3] = src.getX(i);
                arr[i * 3 + 1] = src.getY(i);
                arr[i * 3 + 2] = src.getZ(i);
            }
            const stripped = new THREE.BufferGeometry();
            stripped.setAttribute('position', new THREE.BufferAttribute(arr, 3));
            stripped.applyMatrix4(child.matrixWorld);
            geometries.push(stripped);
        });
        // hand-measured collision fixups (world-space boxes)
        if (patches) {
            for (const p of patches) {
                const size = [p.max[0] - p.min[0], p.max[1] - p.min[1], p.max[2] - p.min[2]];
                const g = new THREE.BoxGeometry(size[0], size[1], size[2]).toNonIndexed();
                g.translate(
                    (p.min[0] + p.max[0]) / 2,
                    (p.min[1] + p.max[1]) / 2,
                    (p.min[2] + p.max[2]) / 2
                );
                const stripped = new THREE.BufferGeometry();
                stripped.setAttribute('position', g.attributes.position.clone());
                geometries.push(stripped);
            }
        }

        const merged = mergeGeometries(geometries, false);
        merged.computeBoundsTree();
        merged.computeBoundingBox();

        // DoubleSide so raycasts hit geometry regardless of triangle winding
        this.collider = new THREE.Mesh(merged, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
        this.collider.visible = false;

        const wire = new THREE.Mesh(merged, new THREE.MeshBasicMaterial({
            color: 0x00ff88, wireframe: true, transparent: true, opacity: 0.15,
        }));
        wire.visible = false;
        this.colliderVisualizer = wire;
        this.scene.add(wire);

        console.log(`Collider BVH built in ${(performance.now() - t0).toFixed(0)}ms`,
            `(${(merged.attributes.position.count / 3).toLocaleString()} tris)`);
    }

    // Change the target HU size of the loaded map and rebuild the collider
    // (only for maps without an exact scale)
    rescale(targetSize) {
        if (!this.loadedMap || !this.baseHorizontal) return;
        this.loadedMap.scale.setScalar(targetSize / this.baseHorizontal);
        this.loadedMap.updateMatrixWorld(true);
        if (this.collider) {
            this.collider.geometry.disposeBoundsTree();
            this.collider.geometry.dispose();
        }
        if (this.colliderVisualizer) {
            this.scene.remove(this.colliderVisualizer);
            this.colliderVisualizer.material.dispose();
        }
        this.buildCollider(this.loadedMap);
    }

    // Build the player and grenade colliders from the game's real world
    // physics (world_physics.vmdl export). Group membership follows the
    // game's rules:
    //   - physics_group_* / passbullets / sky : solid for everyone
    //   - physics_csgo_grenadeclip            : grenades only
    //   - physics_npcclip_playerclip          : players only
    //   - physics_ladder_*                    : neither (ladder zones handle it)
    //   - physics_group_glass                 : players only (nades smash through)
    async buildGameCollision(path, nadePassZones, nadeCeilingY, playerPatches) {
        const gltf = await this.loader.loadAsync(path);
        this.buildGameCollisionFromRoot(gltf.scene, nadePassZones, nadeCeilingY, playerPatches);
    }

    // Split out from buildGameCollision so the headless physics tests can feed
    // in a GLB parsed off disk and exercise the exact collision the game uses.
    // Defaults are the MIRAGE calibration values so the harness (which loads
    // mirage without a mapDef) keeps its demo-fitted behavior; the app passes
    // per-map values — the zones are hand-measured mirage holes and must NEVER
    // leak onto other maps.
    buildGameCollisionFromRoot(root, nadePassZones = MIRAGE_NADE_PASS_ZONES, nadeCeilingY = 650, playerPatches = null) {
        const t0 = performance.now();
        root.updateMatrixWorld(true);

        const playerGeos = [], nadeGeos = [];
        const nadeGroups = []; // { name, faceStart } — face ranges in merge order
        let nadeFaces = 0;
        root.traverse((child) => {
            if (!child.isMesh || !child.geometry.attributes.position) return;
            let name = child.name, p = child.parent;
            while (p) { name = p.name + '/' + name; p = p.parent; }
            if (/ladder/i.test(name)) return;
            const isGrenadeClip = /grenadeclip/i.test(name);
            const isPlayerClip = /playerclip|npcclip/i.test(name);
            const isGlass = /group_glass/i.test(name);
            const isSky = /physics_sky/i.test(name);

            const g = child.geometry.index ? child.geometry.toNonIndexed() : child.geometry;
            const src = g.attributes.position;
            const arr = new Float32Array(src.count * 3);
            for (let i = 0; i < src.count; i++) {
                arr[i * 3] = src.getX(i);
                arr[i * 3 + 1] = src.getY(i);
                arr[i * 3 + 2] = src.getZ(i);
            }
            const stripped = new THREE.BufferGeometry();
            stripped.setAttribute('position', new THREE.BufferAttribute(arr, 3));
            stripped.applyMatrix4(child.matrixWorld);

            // sky hulls are solid for NOBODY here: 57 of 392 real demo smoke
            // trajectories fly straight through the physics_sky mesh (crossings
            // cluster at its z=704 ceiling layer), so CS2 grenades don't
            // collide with it — and a player spawn raycast from above would
            // otherwise land ON the sky ("born in the air").
            if (!isGrenadeClip && !isSky) playerGeos.push(stripped);
            if (!isPlayerClip && !isGlass && !isSky) {
                // Invisible physics seals over sparse visual geometry that CS2
                // grenades demonstrably pass (csnades "Left Arch from Back
                // Alley": the nade flies over the arch wall and drops straight
                // through the plank canopy onto top short). NADE collider only.
                const NADE_PASS_ZONES = nadePassZones;
                // same story for the invisible "world top" faces (~y 700)
                // hiding inside regular world groups — real smokes cross that
                // height band freely, so drop those faces from the collider
                let g2 = stripped;
                const pos2 = stripped.attributes.position;
                const inZone = (x, y, z) => NADE_PASS_ZONES.some((b) =>
                    x >= b.minX && x <= b.maxX && y >= b.minY && y <= b.maxY && z >= b.minZ && z <= b.maxZ);
                let needsFilter = false;
                for (let i = 0; i < pos2.count * 3; i += 3) {
                    if (pos2.array[i + 1] > nadeCeilingY || inZone(pos2.array[i], pos2.array[i + 1], pos2.array[i + 2])) { needsFilter = true; break; }
                }
                if (needsFilter) {
                    const kept = [];
                    for (let f = 0; f < pos2.count; f += 3) {
                        const a = pos2.array, o = f * 3;
                        const y0 = a[o + 1], y1 = a[o + 4], y2 = a[o + 7];
                        if (y0 > nadeCeilingY && y1 > nadeCeilingY && y2 > nadeCeilingY) continue; // ceiling face
                        // centroid rule: collision hulls use huge triangles, so
                        // requiring every vertex inside a zone lets slabs that
                        // merely CROSS it survive (the sloped hull over the
                        // short arches spans 240u). The floor below a zone's
                        // bottom stays safe: its centroids sit under minY.
                        const cx = (a[o] + a[o + 3] + a[o + 6]) / 3;
                        const cy = (y0 + y1 + y2) / 3;
                        const cz = (a[o + 2] + a[o + 5] + a[o + 8]) / 3;
                        if (inZone(cx, cy, cz)) continue;
                        for (let k = 0; k < 9; k++) kept.push(a[o + k]);
                    }
                    g2 = new THREE.BufferGeometry();
                    g2.setAttribute('position', new THREE.BufferAttribute(new Float32Array(kept), 3));
                }
                nadeGeos.push(g2);
                nadeGroups.push({ name: child.name, faceStart: nadeFaces });
                nadeFaces += g2.attributes.position.count / 3;
            }
        });
        this.nadeGroups = nadeGroups;

        // Hand-measured standable caps (world-space boxes, PLAYER only): spots
        // that are climbable in CS2 but whose exported hull is a steep slab
        // the player slides off (e.g. the leaning dust2 pallet). Grenades keep
        // bouncing off the real hull, matching the game.
        if (playerPatches) {
            for (const p of playerPatches) {
                const g = new THREE.BoxGeometry(
                    p.max[0] - p.min[0], p.max[1] - p.min[1], p.max[2] - p.min[2]).toNonIndexed();
                g.translate((p.min[0] + p.max[0]) / 2, (p.min[1] + p.max[1]) / 2, (p.min[2] + p.max[2]) / 2);
                const stripped = new THREE.BufferGeometry();
                stripped.setAttribute('position', g.attributes.position.clone());
                playerGeos.push(stripped);
            }
        }

        const buildMesh = (geos) => {
            const merged = mergeGeometries(geos, false);
            merged.computeBoundsTree();
            merged.computeBoundingBox();
            const mesh = new THREE.Mesh(merged, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
            mesh.visible = false;
            return mesh;
        };
        this.collider = buildMesh(playerGeos);
        this.nadeCollider = buildMesh(nadeGeos);

        const wire = new THREE.Mesh(this.collider.geometry, new THREE.MeshBasicMaterial({
            color: 0x00ff88, wireframe: true, transparent: true, opacity: 0.15,
        }));
        wire.visible = false;
        this.colliderVisualizer = wire;
        this.scene.add(wire);

        console.log(`Game collision built in ${(performance.now() - t0).toFixed(0)}ms:`,
            `player ${(this.collider.geometry.attributes.position.count / 3).toLocaleString()} tris,`,
            `nade ${(this.nadeCollider.geometry.attributes.position.count / 3).toLocaleString()} tris`);
    }

    // Swept "sphere" for the flying grenade: the centre ray plus four rays
    // offset perpendicular to the travel by the projectile radius. CS2 traces
    // a hull, and a single centre ray misses lip/edge grazes by 1-2u — which
    // is exactly the margin razor-edge lineups (roof edge, window ledge) are
    // decided by. Returns the earliest hit across the five rays.
    sweepNade(origin, direction, far, radius) {
        let best = this.raycastNade(origin, direction, far);
        _sweepA.set(0, 1, 0);
        if (Math.abs(direction.y) > 0.95) _sweepA.set(1, 0, 0);
        _sweepA.cross(direction).normalize();
        _sweepB.crossVectors(direction, _sweepA).normalize();
        for (const [va, ka] of [[_sweepA, 1], [_sweepA, -1], [_sweepB, 1], [_sweepB, -1]]) {
            _sweepO.copy(origin).addScaledVector(va, ka * radius);
            const h = this.raycastNade(_sweepO, direction, far);
            // near-zero offset-ray hits mean we're already brushing that
            // surface (skimming the ground) — the centre ray owns those
            if (h && h.distance > radius * 2 && (!best || h.distance < best.distance)) best = h;
        }
        return best;
    }

    // Raycast for GRENADES: the game's grenade collision when available.
    // The hit gets .surfaceGroup (physics_group_* name) for per-surface
    // elasticity, resolved from the merged geometry's face ranges.
    raycastNade(origin, direction, far) {
        if (!this.nadeCollider) return this.raycast(origin, direction, far);
        _raycaster.set(origin, direction);
        _raycaster.far = far;
        _raycaster.firstHitOnly = true;
        const hits = _raycaster.intersectObject(this.nadeCollider);
        if (!hits.length) return null;
        const hit = hits[0];
        if (this.nadeGroups && hit.faceIndex !== undefined) {
            let lo = 0, hi = this.nadeGroups.length - 1;
            while (lo < hi) {
                const mid = (lo + hi + 1) >> 1;
                if (this.nadeGroups[mid].faceStart <= hit.faceIndex) lo = mid;
                else hi = mid - 1;
            }
            hit.surfaceGroup = this.nadeGroups[lo].name;
        }
        return hit;
    }

    // Raycast helper against the collider. Returns first hit or null.
    raycast(origin, direction, far) {
        if (!this.collider) return null;
        _raycaster.set(origin, direction);
        _raycaster.far = far;
        _raycaster.firstHitOnly = true;
        const hits = _raycaster.intersectObject(this.collider);
        return hits.length ? hits[0] : null;
    }

    // Hide meshes whose world bbox doesn't intersect the region (visual only)
    clipToRegion(rootObj, region) {
        const clipBox = new THREE.Box3(
            new THREE.Vector3(region.min.x, region.min.y, region.min.z),
            new THREE.Vector3(region.max.x, region.max.y, region.max.z)
        );
        let hidden = 0;
        rootObj.traverse((child) => {
            if (!child.isMesh) return;
            const meshBox = new THREE.Box3().setFromObject(child);
            child.visible = clipBox.intersectsBox(meshBox);
            if (!child.visible) hidden++;
        });
        console.log(`Region clip: hidden ${hidden} meshes`);
    }

    reClipMap(region) {
        if (!this.visualRoot) return;
        this.visualRoot.traverse((child) => { if (child.isMesh) child.visible = true; });
        if (region) this.clipToRegion(this.visualRoot, region);
    }
}

const _raycaster = new THREE.Raycaster();
const _sweepA = new THREE.Vector3(), _sweepB = new THREE.Vector3(), _sweepO = new THREE.Vector3();
const CS2_BREAK_MARGIN = 3;
