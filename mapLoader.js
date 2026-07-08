import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import {
    computeBoundsTree,
    disposeBoundsTree,
    acceleratedRaycast,
} from 'three-mesh-bvh';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

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
export const MAPS = {
    // VRF exports in meters (0.0254 m per Hammer unit) -> back to HU
    mirage: {
        name: 'de_mirage',
        path: '/maps/mirage.glb',
        scale: 1 / 0.0254,
        zUp: false,
        // buyzone centers extracted from the VRF physics export (world HU x/z)
        spawns: {
            T: { x: -136, z: 1248 },
            CT: { x: -1864, z: -1824 },
        },
    },
    dust2: { name: 'de_dust2', path: '/maps/dust2.glb', targetSize: 4300, zUp: false },
};

export class MapLoader {
    constructor(scene) {
        this.scene = scene;
        this.loader = new GLTFLoader();
        this.loader.setMeshoptDecoder(MeshoptDecoder);
        this.loadedMap = null;         // root group (visual + physics)
        this.visualRoot = null;        // visible geometry only
        this.collider = null;          // merged static mesh with a BVH, used by ALL physics
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
        this.optimizeMaterials(visual);

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

        this.collectSpecialMeshes(visual);
        this.buildCollider(physicsRoot || visual);

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
    optimizeMaterials(rootObj) {
        let meshCount = 0;
        rootObj.traverse((child) => {
            if (!child.isMesh) return;
            meshCount++;
            child.castShadow = false;
            child.receiveShadow = false;
            if (!child.material) return;

            const materials = Array.isArray(child.material) ? child.material : [child.material];
            const newMaterials = materials.map(mat => {
                const optimalMat = new THREE.MeshLambertMaterial({
                    map: mat.map || null,
                    color: mat.map ? 0xffffff : (mat.color || new THREE.Color(0xcccccc)),
                    transparent: mat.transparent || false,
                    opacity: mat.opacity !== undefined ? mat.opacity : 1.0,
                    alphaTest: mat.alphaTest || 0,
                    side: THREE.DoubleSide,
                });
                const name = (mat.name || '').toLowerCase();
                if (mat.map && (name.includes('foliage') || name.includes('tree') || name.includes('fence') || mat.transparent)) {
                    optimalMat.transparent = false;
                    optimalMat.alphaTest = 0.5;
                }
                if (mat.vertexColors) optimalMat.vertexColors = true;
                return optimalMat;
            });
            child.material = Array.isArray(child.material) ? newMaterials : newMaterials[0];
        });
        console.log(`Materials optimized on ${meshCount} meshes`);
    }

    // Merge the given subtree into one static geometry and build a BVH over it.
    // Physics always collides with the FULL map, even when a region hides visuals.
    buildCollider(rootObj) {
        const t0 = performance.now();
        rootObj.updateMatrixWorld(true);

        // Bake every mesh into world space, position attribute only.
        // Positions are copied into Float32 via getX/getY/getZ so quantized
        // (int16/normalized) attributes survive the world transform.
        const geometries = [];
        rootObj.traverse((child) => {
            if (!child.isMesh || !child.geometry.attributes.position) return;
            if (/breakable/.test(child.name.toLowerCase())) return; // nades smash through glass
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
const CS2_BREAK_MARGIN = 3;
