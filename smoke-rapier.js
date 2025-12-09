import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export class SmokeSystemRapier {
    constructor(scene, physics) {
        this.scene = scene;
        this.physics = physics;
        this.activeSmokes = [];
        this.grenadeModel = this.createGrenadeModel();
        this.grenadeModelGLB = null;
        this.loadGrenadeModel();
    }
    
    async loadGrenadeModel() {
        const loader = new GLTFLoader();
        try {
            const gltf = await loader.loadAsync('/models/smoke_grenade.glb');
            this.grenadeModelGLB = gltf.scene;
            this.grenadeModelGLB.scale.set(0.004, 0.004, 0.004);
            console.log('✅ Grenade model loaded');
        } catch (e) {
            console.log('⚠️ Using placeholder');
        }
    }
    
    createGrenadeModel() {
        const geometry = new THREE.SphereGeometry(0.05, 8, 8);
        const material = new THREE.MeshStandardMaterial({ 
            color: 0x555555,
            metalness: 0.8,
            roughness: 0.2
        });
        return new THREE.Mesh(geometry, material);
    }
    
    getGrenadeModel() {
        if (this.grenadeModelGLB) {
            return this.grenadeModelGLB.clone();
        }
        return this.grenadeModel.clone();
    }
    
    throwSmoke(position, direction, power) {
        console.log('🎯 Throwing smoke with Rapier physics');
        
        // Create visual grenade
        const grenade = this.getGrenadeModel();
        grenade.position.copy(position);
        this.scene.add(grenade);
        
        // Create physics body
        const velocity = direction.clone().multiplyScalar(power * 0.7);
        const physicsBody = this.physics.createGrenade(position, velocity);
        
        if (!physicsBody) {
            console.error('Failed to create physics body');
            this.scene.remove(grenade);
            return;
        }
        
        let bounceCount = 0;
        let lastVelY = 0;
        const maxBounces = 2;
        
        const animate = () => {
            if (!physicsBody) return;
            
            // Update visual from physics
            const pos = this.physics.getBodyPosition(physicsBody);
            const rot = this.physics.getBodyRotation(physicsBody);
            const vel = this.physics.getBodyVelocity(physicsBody);
            
            grenade.position.copy(pos);
            grenade.quaternion.copy(rot);
            
            // Detect bounce (velocity changed from negative to positive)
            if (lastVelY < -1 && vel.y > 0) {
                bounceCount++;
                console.log('🏀 Bounce #' + bounceCount);
                
                if (bounceCount >= maxBounces) {
                    console.log('💥 Smoke deployed!');
                    this.createSmoke(pos);
                    this.scene.remove(grenade);
                    this.physics.removeBody(physicsBody);
                    return;
                }
            }
            
            lastVelY = vel.y;
            
            // Stop if resting
            if (vel.length() < 0.3 && pos.y < 2) {
                console.log('💥 Stopped');
                this.createSmoke(pos);
                this.scene.remove(grenade);
                this.physics.removeBody(physicsBody);
                return;
            }
            
            requestAnimationFrame(animate);
        };
        
        animate();
    }
    
    createSmoke(position) {
        console.log('💨 Creating smoke cloud');
        
        const smokePos = position.clone();
        smokePos.y += 1;
        
        // Create multiple smoke spheres for better effect
        const smokeGroup = new THREE.Group();
        const numSpheres = 15;
        
        for (let i = 0; i < numSpheres; i++) {
            const geometry = new THREE.SphereGeometry(1.5, 16, 16);
            const material = new THREE.MeshStandardMaterial({
                color: 0xcccccc,
                transparent: true,
                opacity: 0.3,
                depthWrite: false
            });
            
            const sphere = new THREE.Mesh(geometry, material);
            sphere.position.set(
                (Math.random() - 0.5) * 2,
                Math.random() * 2,
                (Math.random() - 0.5) * 2
            );
            smokeGroup.add(sphere);
        }
        
        smokeGroup.position.copy(smokePos);
        this.scene.add(smokeGroup);
        
        // Animate smoke
        const startTime = Date.now();
        const duration = 18000;
        
        const animateSmoke = () => {
            const elapsed = Date.now() - startTime;
            const progress = elapsed / duration;
            
            if (progress >= 1) {
                this.scene.remove(smokeGroup);
                return;
            }
            
            // Expand and fade
            const scale = 1 + progress * 3;
            smokeGroup.scale.set(scale, scale, scale);
            
            smokeGroup.children.forEach((sphere, i) => {
                sphere.material.opacity = 0.3 * (1 - progress);
                sphere.position.y += 0.01;
            });
            
            requestAnimationFrame(animateSmoke);
        };
        
        animateSmoke();
    }
}
