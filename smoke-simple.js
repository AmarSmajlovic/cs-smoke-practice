import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export class SmokeSystem {
    constructor(scene) {
        this.scene = scene;
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
            this.grenadeModelGLB.scale.set(0.002, 0.002, 0.002);
            console.log('✅ Smoke grenade GLB model loaded!');
        } catch (e) {
            console.log('⚠️ No GLB model found, using placeholder sphere');
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
    
    throwSmoke(position, direction, power, groundY = 0, map = null) {
        console.log('🎯 Throwing smoke (slower)');
        
        const grenade = this.getGrenadeModel();
        grenade.position.copy(position);
        this.scene.add(grenade);
        
        // Throw speed - dalje odleti
        const velocity = direction.clone().multiplyScalar(power * 0.7); // 0.7 = dalje leti
        const gravity = -20; // Slightly less gravity for slower arc
        let groundBounces = 0; // Only count ground bounces
        const maxGroundBounces = 2;
        
        // Raycaster for collision detection
        const raycaster = new THREE.Raycaster();
        const grenadeRadius = 0.05;
        
        // Rotation tracking - okreće se na osnovu pređene distance
        let totalDistance = 0;
        let lastRotation = 0;
        const rotationInterval = 2.5; // Svaka 2.5 metra se okrene jednom
        
        const animate = () => {
            const dt = 0.016; // ~60fps
            
            // Apply gravity
            velocity.y += gravity * dt;
            
            // Store old position for collision detection
            const oldPos = grenade.position.clone();
            
            // Move grenade
            grenade.position.x += velocity.x * dt;
            grenade.position.y += velocity.y * dt;
            grenade.position.z += velocity.z * dt;
            
            // Calculate distance traveled
            const distanceMoved = grenade.position.distanceTo(oldPos);
            totalDistance += distanceMoved;
            
            // Rotate based on distance (svaka 2-3 metra jednom)
            if (totalDistance - lastRotation >= rotationInterval) {
                lastRotation = totalDistance;
            }
            const rotationProgress = (totalDistance - lastRotation) / rotationInterval;
            grenade.rotation.x = lastRotation * 2.5 + rotationProgress * Math.PI * 2;
            grenade.rotation.y = lastRotation * 1.8 + rotationProgress * Math.PI * 1.5;
            
            // Check for wall collisions (side collisions)
            if (map) {
                // Check horizontal directions for walls
                const directions = [
                    new THREE.Vector3(1, 0, 0),   // Right
                    new THREE.Vector3(-1, 0, 0),  // Left
                    new THREE.Vector3(0, 0, 1),   // Forward
                    new THREE.Vector3(0, 0, -1)   // Back
                ];
                
                for (const dir of directions) {
                    raycaster.set(grenade.position, dir);
                    raycaster.far = grenadeRadius + 0.05;
                    const hits = raycaster.intersectObject(map, true);
                    
                    if (hits.length > 0 && hits[0].distance < grenadeRadius + 0.05) {
                        // Wall hit - bounce off
                        const normal = hits[0].face.normal.clone();
                        normal.transformDirection(hits[0].object.matrixWorld);
                        
                        // Reflect velocity - jače odbijanje od zida
                        const dot = velocity.dot(normal);
                        velocity.x -= 2 * dot * normal.x * 0.85; // 0.85 = jače odbijanje
                        velocity.z -= 2 * dot * normal.z * 0.85;
                        
                        console.log('🧱 Wall bounce (stronger)');
                        
                        // Move grenade away from wall
                        grenade.position.add(normal.multiplyScalar(0.1));
                    }
                }
            }
            
            // Ground/floor collision detection (downward raycast) - bolji detection
            if (velocity.y < 0) {
                raycaster.set(grenade.position, new THREE.Vector3(0, -1, 0));
                raycaster.far = grenadeRadius + 0.2; // Duži raycast za bolji detection
                
                let hitGround = false;
                let hitY = groundY;
                
                // Check map collision first (prioritet)
                if (map) {
                    const hits = raycaster.intersectObject(map, true);
                    if (hits.length > 0 && hits[0].distance < grenadeRadius + 0.2) {
                        hitGround = true;
                        hitY = hits[0].point.y;
                    }
                }
                
                // Also check global ground level (fallback)
                if (!hitGround && grenade.position.y <= groundY + grenadeRadius + 0.1) {
                    hitGround = true;
                    hitY = groundY;
                }
                
                if (hitGround) {
                    grenade.position.y = hitY + grenadeRadius + 0.05; // Malo iznad poda
                    
                    groundBounces++;
                    console.log(`🏀 Ground bounce #${groundBounces} (velocity: ${velocity.y.toFixed(2)})`);
                    
                    // Check if should explode after 2 ground bounces
                    if (groundBounces >= maxGroundBounces) {
                        console.log('💥 Smoke deployed after 2 bounces!');
                        this.createSmoke(grenade.position.clone(), hitY);
                        this.scene.remove(grenade);
                        return;
                    }
                    
                    // Realistic bounce physics
                    velocity.y *= -0.4; // Bounce coefficient
                    velocity.x *= 0.7; // Friction on ground
                    velocity.z *= 0.7;
                    
                    // Add slight random spin on bounce
                    velocity.x += (Math.random() - 0.5) * 0.3;
                    velocity.z += (Math.random() - 0.5) * 0.3;
                }
            }
            
            // Stop if velocity too low and on ground
            if (grenade.position.y <= groundY + grenadeRadius + 0.05 && velocity.length() < 0.4) {
                console.log('💥 Stopped on ground');
                this.createSmoke(grenade.position.clone(), groundY);
                this.scene.remove(grenade);
                return;
            }
            
            requestAnimationFrame(animate);
        };
        
        animate();
    }
    
    createSmoke(position, groundY) {
        console.log('💨 Creating realistic CS2-style smoke at:', position);
        
        const smokePos = position.clone();
        smokePos.y = groundY; // Direktno na podu
        
        const particleCount = 1800; // Manji dim - manje čestica
        const particles = new THREE.BufferGeometry();
        const positions = new Float32Array(particleCount * 3);
        const velocities = [];
        const sizes = new Float32Array(particleCount);
        
        for (let i = 0; i < particleCount; i++) {
            const i3 = i * 3;
            
            // Start in small circle ON ground level
            const theta = Math.random() * Math.PI * 2;
            const r = Math.random() * 0.25;
            
            positions[i3] = smokePos.x + r * Math.cos(theta);
            positions[i3 + 1] = smokePos.y; // Sve čestice počinju od poda
            positions[i3 + 2] = smokePos.z + r * Math.sin(theta);
            
            // Varied particle sizes - manji
            sizes[i] = 2.0 + Math.random() * 2.5;
            
            // Širenje u svim pravcima - oblak
            const angle = Math.random() * Math.PI * 2;
            const outwardSpeed = 1.3 + Math.random() * 1.5;
            const upwardSpeed = 0.8 + Math.random() * 1.2; // Sporije se diže
            
            velocities.push({
                x: Math.cos(angle) * outwardSpeed,
                y: upwardSpeed, // Diže se polako
                z: Math.sin(angle) * outwardSpeed,
                minY: groundY, // Ne ide ispod poda
                turbulence: Math.random() * 0.6,
                swirl: Math.random() * Math.PI * 2
            });
        }
        
        particles.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        particles.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
        
        const material = new THREE.PointsMaterial({
            color: 0x808080, // Siv (gray) - ne bijel
            size: 3.0, // Manji size
            transparent: true,
            opacity: 0.6, // Manje opacity = manje gust
            depthWrite: false,
            depthTest: true,
            blending: THREE.NormalBlending,
            sizeAttenuation: true,
            vertexColors: false
        });
        
        const smoke = new THREE.Points(particles, material);
        this.scene.add(smoke);
        
        const startTime = Date.now();
        const duration = 18000; // 18 seconds like CS2
        const expandSpeed = 1.4; // Sporije širenje
        const maxRadius = 8; // Manji radius
        let time = 0;
        
        const animateSmoke = () => {
            const elapsed = Date.now() - startTime;
            const progress = elapsed / duration;
            
            if (progress >= 1) {
                this.scene.remove(smoke);
                particles.dispose();
                material.dispose();
                console.log('💨 Smoke dissipated');
                return;
            }
            
            time += 0.016;
            const positions = particles.attributes.position.array;
            
            for (let i = 0; i < particleCount; i++) {
                const i3 = i * 3;
                const vel = velocities[i];
                
                // Distance from center
                const dx = positions[i3] - smokePos.x;
                const dy = positions[i3 + 1] - smokePos.y;
                const dz = positions[i3 + 2] - smokePos.z;
                const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
                
                // Expand smoke cloud - oblak
                if (dist < maxRadius) {
                    // Turbulence za sve pravce
                    const turbX = Math.sin(time * 1.5 + vel.swirl + i * 0.05) * vel.turbulence;
                    const turbZ = Math.cos(time * 1.5 + vel.swirl + i * 0.05) * vel.turbulence;
                    const turbY = Math.sin(time * 0.8 + i * 0.03) * vel.turbulence * 0.5;
                    
                    positions[i3] += (vel.x + turbX) * 0.016 * expandSpeed;
                    positions[i3 + 1] += (vel.y + turbY) * 0.016 * expandSpeed;
                    positions[i3 + 2] += (vel.z + turbZ) * 0.016 * expandSpeed;
                }
                
                // Ne dozvoli da ide ispod poda
                if (positions[i3 + 1] < vel.minY) {
                    positions[i3 + 1] = vel.minY;
                    vel.y = Math.max(0, vel.y); // Odbije se od poda
                }
                
                // Slow down over time (air resistance)
                vel.x *= 0.988;
                vel.y *= 0.992; // Y se sporije usporava (diže se)
                vel.z *= 0.988;
            }
            
            particles.attributes.position.needsUpdate = true;
            
            // Gradual fade out in last 40%
            if (progress > 0.6) {
                material.opacity = 0.65 * (1 - (progress - 0.6) / 0.4);
            }
            
            requestAnimationFrame(animateSmoke);
        };
        
        animateSmoke();
        this.activeSmokes.push(smoke);
    }
}
