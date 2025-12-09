import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export class SmokeSystem {
    constructor(scene) {
        this.scene = scene;
        this.activeSmokes = [];
        this.grenadeModel = this.createGrenadeModel();
        this.grenadeModelGLB = null;
        
        // Try to load GLB model
        this.loadGrenadeModel();
    }
    
    async loadGrenadeModel() {
        const loader = new GLTFLoader();
        try {
            const gltf = await loader.loadAsync('/models/smoke_grenade.glb');
            this.grenadeModelGLB = gltf.scene;
            
            // Scale for thrown grenade (2x bigger)
            this.grenadeModelGLB.scale.set(0.004, 0.004, 0.004);
            
            console.log('✅ Smoke grenade GLB model loaded!');
        } catch (e) {
            console.log('⚠️ No GLB model found, using placeholder sphere');
        }
    }
    
    createGrenadeModel() {
        // Simple grenade placeholder (sphere)
        const geometry = new THREE.SphereGeometry(0.05, 8, 8);
        const material = new THREE.MeshStandardMaterial({ 
            color: 0x555555,
            metalness: 0.8,
            roughness: 0.2
        });
        return new THREE.Mesh(geometry, material);
    }
    
    getGrenadeModel() {
        // Use GLB model if loaded, otherwise use placeholder
        if (this.grenadeModelGLB) {
            return this.grenadeModelGLB.clone();
        }
        return this.grenadeModel.clone();
    }
    
    throwSmoke(position, direction, power, mapGroundY = 0, map = null) {
        console.log('🎯 Throwing smoke from:', position, 'direction:', direction, 'power:', power);
        
        // Create grenade instance (use GLB if available)
        const grenade = this.getGrenadeModel();
        grenade.position.copy(position);
        this.scene.add(grenade);
        
        console.log('✅ Grenade added to scene at:', grenade.position);
        
        // Physics - longer flight
        const velocity = direction.clone().multiplyScalar(power * 1.2); // Faster throw for longer distance
        const gravity = -12; // Less gravity for longer flight
        let groundBounceCount = 0; // Count only ground bounces
        const maxGroundBounces = 2; // Explode after 2 ground bounces (like CS2)
        const startTime = Date.now();
        const maxTime = 10000; // 10 seconds max (safety)
        
        // Raycaster for map collision
        const raycaster = new THREE.Raycaster();
        raycaster.far = 1;
        
        // Animate grenade
        const animateGrenade = () => {
            const elapsed = Date.now() - startTime;
            
            // Check if should explode (only by time, not bounces)
            if (elapsed >= maxTime) {
                console.log('⏰ Grenade timeout, exploding');
                this.createSmoke(grenade.position.clone(), map);
                this.scene.remove(grenade);
                return;
            }
            
            // Apply physics
            velocity.y += gravity * 0.016;
            const moveVec = velocity.clone().multiplyScalar(0.016);
            
            // Forward flip rotation (2-3 rotations during flight)
            grenade.rotation.x += 0.15; // Forward flip
            grenade.rotation.z += 0.02; // Slight side spin
            
            // Try to move
            const newPos = grenade.position.clone().add(moveVec);
            let didCollide = false;
            
            // Check ground collision
            if (map) {
                raycaster.set(newPos, new THREE.Vector3(0, -1, 0));
                raycaster.far = 1;
                const groundHits = raycaster.intersectObject(map, true);
                
                if (groundHits.length > 0) {
                    const groundY = groundHits[0].point.y;
                    
                    // If we're going to go below ground, bounce
                    if (newPos.y < groundY + 0.05) {
                        newPos.y = groundY + 0.05;
                        
                        if (velocity.y < -0.5) {
                            groundBounceCount++;
                            console.log('🏀 Ground bounce #' + groundBounceCount);
                            
                            if (groundBounceCount >= maxGroundBounces) {
                                console.log('💥 Exploded after ' + groundBounceCount + ' bounces!');
                                this.createSmoke(newPos, map, groundY);
                                this.scene.remove(grenade);
                                return;
                            }
                        }
                        
                        velocity.y *= -0.5;
                        velocity.x *= 0.85;
                        velocity.z *= 0.85;
                        didCollide = true;
                        
                        // Stop if too slow
                        if (Math.abs(velocity.y) < 0.3 && velocity.length() < 1) {
                            console.log('💥 Stopped on ground');
                            this.createSmoke(newPos, map, groundY);
                            this.scene.remove(grenade);
                            return;
                        }
                    }
                }
            }
            
            // Check wall collision
            if (map && !didCollide) {
                const moveDir = moveVec.clone().normalize();
                raycaster.set(grenade.position, moveDir);
                raycaster.far = moveVec.length() + 0.1;
                const wallHits = raycaster.intersectObject(map, true);
                
                if (wallHits.length > 0 && wallHits[0].distance < moveVec.length()) {
                    // Hit wall - reflect velocity
                    const normal = wallHits[0].face.normal;
                    velocity.reflect(normal).multiplyScalar(0.7);
                    console.log('💥 Wall bounce');
                    didCollide = true;
                    
                    // Don't move into wall
                    newPos.copy(grenade.position);
                }
            }
            
            // Update position
            grenade.position.copy(newPos);
            
            // Fallback - don't go below absolute minimum
            const absoluteMin = Math.max(mapGroundY + 0.1, -50);
            if (grenade.position.y < absoluteMin) {
                grenade.position.y = absoluteMin;
                
                if (velocity.y < -0.5) {
                    groundBounceCount++;
                    console.log('🏀 Fallback bounce #' + groundBounceCount);
                    
                    if (groundBounceCount >= maxGroundBounces) {
                        console.log('💥 Exploded (fallback)!');
                        this.createSmoke(grenade.position.clone(), map);
                        this.scene.remove(grenade);
                        return;
                    }
                }
                
                velocity.y *= -0.5;
                velocity.x *= 0.85;
                velocity.z *= 0.85;
            }
            
            requestAnimationFrame(animateGrenade);
        };
        
        animateGrenade();
    }
    
    createSmoke(position, _map = null, groundY = null) {
        console.log('💨 Smoke deployed at:', position, 'groundY:', groundY);
        
        // Smoke starts directly from ground (no gap)
        const smokePos = position.clone();
        // Use actual ground Y if provided, otherwise use grenade position
        if (groundY !== null) {
            smokePos.y = groundY; // Use exact ground Y
            console.log('✅ Using groundY:', groundY);
        } else {
            smokePos.y -= 1.5; // Spusti dole
            console.log('⚠️ No groundY, using position.y - 1.5:', smokePos.y);
        }
        console.log('🎯 Final smokePos.y:', smokePos.y);
        
        // Smoke particle system - spherical cloud
        const particleCount = 2000; // More particles for denser smoke
        const particles = new THREE.BufferGeometry();
        const positions = new Float32Array(particleCount * 3);
        const velocities = [];
        const initialRadius = 0.5;
        
        // Initialize particles starting from ground level
        for (let i = 0; i < particleCount; i++) {
            const i3 = i * 3;
            
            // Start all particles at ground level in a small circle
            const theta = Math.random() * Math.PI * 2;
            const r = Math.random() * initialRadius;
            
            positions[i3] = smokePos.x + r * Math.cos(theta);
            positions[i3 + 1] = smokePos.y; // All particles start exactly at ground level
            positions[i3 + 2] = smokePos.z + r * Math.sin(theta);
            
            // All particles stay on ground - only expand horizontally
            velocities.push({
                x: (Math.random() - 0.5) * 1.5,
                y: 0, // No vertical movement at all
                z: (Math.random() - 0.5) * 1.5,
                minY: smokePos.y // Don't go below ground level
            });
        }
        
        particles.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        
        // Smoke material - thicker, more opaque
        const material = new THREE.PointsMaterial({
            color: 0xcccccc,
            size: 2.0, // Bigger particles
            transparent: true,
            opacity: 0.9,
            depthWrite: false,
            depthTest: true,
            blending: THREE.NormalBlending,
            sizeAttenuation: true
        });
        
        const smoke = new THREE.Points(particles, material);
        this.scene.add(smoke);
        
        // Smoke animation
        const startTime = Date.now();
        const duration = 18000; // 18 seconds like CS2
        const expandSpeed = 2; // Slower expansion
        const maxRadius = 8; // Maximum smoke radius
        
        const animateSmoke = () => {
            const elapsed = Date.now() - startTime;
            const progress = elapsed / duration;
            
            if (progress >= 1) {
                // Remove smoke
                this.scene.remove(smoke);
                particles.dispose();
                material.dispose();
                const index = this.activeSmokes.indexOf(smoke);
                if (index > -1) this.activeSmokes.splice(index, 1);
                return;
            }
            
            // Update particles
            const positions = particles.attributes.position.array;
            for (let i = 0; i < particleCount; i++) {
                const i3 = i * 3;
                const vel = velocities[i];
                
                // Check distance from center
                const dx = positions[i3] - smokePos.x;
                const dy = positions[i3 + 1] - smokePos.y;
                const dz = positions[i3 + 2] - smokePos.z;
                const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
                
                // Only expand if within max radius
                if (dist < maxRadius) {
                    const oldX = positions[i3];
                    const oldY = positions[i3 + 1];
                    const oldZ = positions[i3 + 2];
                    
                    // Calculate new position
                    const newX = oldX + vel.x * 0.016 * expandSpeed;
                    const newY = oldY + vel.y * 0.016 * expandSpeed;
                    const newZ = oldZ + vel.z * 0.016 * expandSpeed;
                    
                    // Simple boundary check instead of raycasting (much faster)
                    // Keep smoke within radius from spawn point
                    positions[i3] = newX;
                    positions[i3 + 1] = newY;
                    positions[i3 + 2] = newZ;
                }
                
                // Force all particles to stay on ground
                positions[i3 + 1] = vel.minY; // Always keep on ground level
                
                // Slow down horizontal movement only
                vel.x *= 0.98;
                vel.z *= 0.98;
            }
            
            particles.attributes.position.needsUpdate = true;
            
            // Fade out
            if (progress > 0.7) {
                material.opacity = 0.6 * (1 - (progress - 0.7) / 0.3);
            }
            
            requestAnimationFrame(animateSmoke);
        };
        
        animateSmoke();
        this.activeSmokes.push(smoke);
    }
    
    update(_delta) {
        // Update active smokes if needed
    }
}
