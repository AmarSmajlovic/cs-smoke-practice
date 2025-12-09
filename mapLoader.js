import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export class MapLoader {
    constructor(scene) {
        this.scene = scene;
        this.loader = new GLTFLoader();
    }

    async loadMap(mapPath) {
        return new Promise((resolve, reject) => {
            this.loader.load(
                mapPath,
                (gltf) => {
                    const map = gltf.scene;
                    
                    // Scale UP - this map is too small
                    map.scale.set(100, 100, 100);
                    
                    // Enable shadows on all meshes
                    let meshCount = 0;
                    map.traverse((child) => {
                        console.log('Child type:', child.type, 'Name:', child.name);
                        
                        if (child.isMesh) {
                            meshCount++;
                            child.castShadow = true;
                            child.receiveShadow = true;
                            
                            // Keep original materials
                            if (child.material) {
                                child.material.wireframe = false;
                                child.material.visible = true;
                                child.material.needsUpdate = true;
                            }
                            
                            console.log('Mesh #' + meshCount + ':', child.name);
                            console.log('  Position:', child.position);
                            console.log('  Scale:', child.scale);
                            console.log('  Geometry vertices:', child.geometry.attributes.position?.count);
                            console.log('  Material:', child.material);
                        }
                    });
                    
                    console.log('Total meshes found:', meshCount);

                    this.scene.add(map);
                    
                    // Calculate bounding box to see map size
                    const box = new THREE.Box3().setFromObject(map);
                    const size = box.getSize(new THREE.Vector3());
                    const center = box.getCenter(new THREE.Vector3());
                    
                    console.log('Map loaded successfully:', mapPath);
                    console.log('Map size:', size);
                    console.log('Map center:', center);
                    console.log('Map bounds:', box.min, box.max);
                    
                    resolve(map);
                },
                (progress) => {
                    const percent = (progress.loaded / progress.total * 100).toFixed(2);
                    console.log(`Loading map: ${percent}%`);
                },
                (error) => {
                    console.error('Error loading map:', error);
                    reject(error);
                }
            );
        });
    }
}
