import * as CANNON from 'cannon-es';
import * as THREE from 'three';

export class PhysicsWorld {
    constructor() {
        // Create physics world
        this.world = new CANNON.World();
        this.world.gravity.set(0, -20, 0); // CS2 gravity (800 units/s² scaled)
        this.world.broadphase = new CANNON.NaiveBroadphase();
        this.world.solver.iterations = 10;
        
        // CS2 Player constants
        this.PLAYER_HEIGHT_STAND = 1.8; // Standing height
        this.PLAYER_HEIGHT_CROUCH = 1.2; // Crouching height
        this.PLAYER_RADIUS = 0.32; // Player capsule radius
        this.EYE_HEIGHT_STAND = 1.62; // Eye height when standing
        this.EYE_HEIGHT_CROUCH = 1.08; // Eye height when crouching
        
        // Movement speeds (CS2 values - CORRECTED)
        this.SPEED_RUN = 6.5; // 250 units/s - DEFAULT running
        this.SPEED_WALK = 3.25; // 130 units/s - SHIFT walking (silent)
        this.SPEED_CROUCH = 2.6; // 85 units/s - Crouching
        this.JUMP_FORCE = 7.5; // Jump velocity
        this.AIR_ACCELERATE = 12; // Air control
        this.GROUND_ACCELERATE = 10; // Ground acceleration
        this.FRICTION = 5.2; // Ground friction
        this.STOP_SPEED = 1.3; // Speed below which friction applies
        
        // Player state
        this.isCrouching = false;
        this.isWalking = false; // SHIFT = walk (not sprint!)
        this.isOnGround = false;
        this.currentEyeHeight = this.EYE_HEIGHT_STAND;
        
        // Player physics body (capsule approximated with cylinder)
        const playerShape = new CANNON.Cylinder(
            this.PLAYER_RADIUS,
            this.PLAYER_RADIUS,
            this.PLAYER_HEIGHT_STAND,
            8
        );
        
        this.playerBody = new CANNON.Body({
            mass: 80,
            shape: playerShape,
            linearDamping: 0,
            angularDamping: 1,
            fixedRotation: true,
            material: new CANNON.Material({ friction: 0.0 })
        });
        this.playerBody.position.set(0, 3, 5); // Start at reasonable height
        this.world.addBody(this.playerBody);
        
        // Ground (temporary) - large plane at y=0
        const groundShape = new CANNON.Plane();
        this.groundBody = new CANNON.Body({ 
            mass: 0,
            material: new CANNON.Material({ friction: 0.3 })
        });
        this.groundBody.addShape(groundShape);
        this.groundBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
        this.groundBody.position.set(0, 0, 0);
        this.world.addBody(this.groundBody);
        
        console.log('Ground plane added at y=0');
        
        // Ground detection
        this.groundCheckDistance = 0.1;
        this.updateGroundStatus();
    }
    
    updateGroundStatus() {
        // Check if player is on ground using raycast
        const rayStart = new CANNON.Vec3(
            this.playerBody.position.x,
            this.playerBody.position.y,
            this.playerBody.position.z
        );
        const rayEnd = new CANNON.Vec3(
            this.playerBody.position.x,
            this.playerBody.position.y - (this.PLAYER_HEIGHT_STAND / 2 + this.groundCheckDistance),
            this.playerBody.position.z
        );
        
        const result = new CANNON.RaycastResult();
        this.world.raycastClosest(rayStart, rayEnd, {}, result);
        
        this.isOnGround = result.hasHit;
    }
    
    clearMapCollision() {
        // Remove all map collision bodies
        if (this.mapBodies) {
            this.mapBodies.forEach(body => {
                this.world.removeBody(body);
            });
        }
        this.mapBodies = [];
    }
    
    addMapCollision(map) {
        // Initialize map bodies array
        if (!this.mapBodies) {
            this.mapBodies = [];
        }
        
        // DON'T remove ground - keep it as fallback
        console.log('Adding map collision...');
        console.log('Map scale:', map.scale);
        console.log('Map position:', map.position);
        let meshCount = 0;
        let skippedCount = 0;
        
        // Force update all matrices
        map.updateMatrixWorld(true);
        
        // Add collision for each mesh in the map
        map.traverse((child) => {
            if (child.isMesh) {
                // Skip very small meshes (details)
                const bbox = child.geometry.boundingBox;
                if (bbox) {
                    const size = new THREE.Vector3();
                    bbox.getSize(size);
                    
                    // Skip if too small (less than 10cm in any dimension)
                    if (size.x < 0.1 || size.y < 0.1 || size.z < 0.1) {
                        skippedCount++;
                        return;
                    }
                }
                
                const body = this.addMeshCollision(child);
                if (body) {
                    this.mapBodies.push(body);
                    meshCount++;
                }
            }
        });
        
        console.log('Total collision meshes added:', meshCount);
        console.log('Skipped small meshes:', skippedCount);
        
        if (meshCount === 0) {
            console.warn('No collision meshes found! Ground plane will be used.');
        } else {
            console.log('Map collision loaded successfully!');
        }
    }
    
    addMeshCollision(mesh) {
        // Get world position and scale
        mesh.updateMatrixWorld(true);
        
        const geometry = mesh.geometry;
        if (!geometry.attributes.position) {
            console.warn('Mesh has no position attribute:', mesh.name);
            return null;
        }
        
        // Calculate bounding box in world space
        geometry.computeBoundingBox();
        const bbox = geometry.boundingBox.clone();
        
        // Get world position, rotation, scale
        const worldPos = new THREE.Vector3();
        const worldQuat = new THREE.Quaternion();
        const worldScale = new THREE.Vector3();
        mesh.matrixWorld.decompose(worldPos, worldQuat, worldScale);
        
        // Calculate box size in world space
        const size = new THREE.Vector3();
        bbox.getSize(size);
        size.multiply(worldScale);
        
        // Calculate center in world space
        const center = new THREE.Vector3();
        bbox.getCenter(center);
        center.applyMatrix4(mesh.matrixWorld);
        
        // Create box shape
        const shape = new CANNON.Box(new CANNON.Vec3(
            Math.abs(size.x) / 2,
            Math.abs(size.y) / 2,
            Math.abs(size.z) / 2
        ));
        
        const body = new CANNON.Body({ 
            mass: 0,
            material: new CANNON.Material({ friction: 0.3 })
        });
        body.addShape(shape);
        body.position.copy(center);
        body.quaternion.copy(worldQuat);
        this.world.addBody(body);
        
        console.log('Added BOX collision for:', mesh.name, 
            'pos:', center, 
            'size:', size);
        
        return body;
    }
    
    update(delta) {
        this.world.step(1 / 60, delta, 3);
        this.updateGroundStatus();
        
        // Smooth crouch transition
        const targetEyeHeight = this.isCrouching ? this.EYE_HEIGHT_CROUCH : this.EYE_HEIGHT_STAND;
        this.currentEyeHeight += (targetEyeHeight - this.currentEyeHeight) * 10 * delta;
        
        // Apply friction when on ground
        if (this.isOnGround) {
            const speed = Math.sqrt(
                this.playerBody.velocity.x ** 2 + 
                this.playerBody.velocity.z ** 2
            );
            
            if (speed > 0) {
                const control = speed < this.STOP_SPEED ? this.STOP_SPEED : speed;
                const drop = control * this.FRICTION * delta;
                const newSpeed = Math.max(speed - drop, 0);
                const scale = newSpeed / speed;
                
                this.playerBody.velocity.x *= scale;
                this.playerBody.velocity.z *= scale;
            }
        }
    }
    
    movePlayer(direction, keys) {
        // Determine current speed based on state
        let maxSpeed = this.SPEED_RUN; // Default is running
        
        if (this.isCrouching) {
            maxSpeed = this.SPEED_CROUCH;
        } else if (this.isWalking) {
            maxSpeed = this.SPEED_WALK; // SHIFT = walk (silent)
        }
        
        // CS2-style movement with acceleration
        const wishDir = direction.clone().normalize();
        const wishSpeed = maxSpeed;
        
        if (wishDir.length() > 0) {
            const accelerate = this.isOnGround ? this.GROUND_ACCELERATE : this.AIR_ACCELERATE;
            
            // Current velocity in wish direction
            const currentSpeed = 
                this.playerBody.velocity.x * wishDir.x + 
                this.playerBody.velocity.z * wishDir.z;
            
            // Add velocity
            const addSpeed = wishSpeed - currentSpeed;
            if (addSpeed > 0) {
                const accelSpeed = Math.min(accelerate * wishSpeed * (1/60), addSpeed);
                this.playerBody.velocity.x += wishDir.x * accelSpeed;
                this.playerBody.velocity.z += wishDir.z * accelSpeed;
            }
        }
        
        // Speed cap
        const currentSpeed = Math.sqrt(
            this.playerBody.velocity.x ** 2 + 
            this.playerBody.velocity.z ** 2
        );
        
        if (currentSpeed > maxSpeed) {
            const scale = maxSpeed / currentSpeed;
            this.playerBody.velocity.x *= scale;
            this.playerBody.velocity.z *= scale;
        }
    }
    
    jump() {
        if (this.isOnGround && !this.isCrouching) {
            this.playerBody.velocity.y = this.JUMP_FORCE;
            this.isOnGround = false;
        }
    }
    
    setCrouch(crouching) {
        this.isCrouching = crouching;
        
        // Change collision shape height
        const newHeight = crouching ? this.PLAYER_HEIGHT_CROUCH : this.PLAYER_HEIGHT_STAND;
        
        // Remove old shape and add new one
        this.playerBody.shapes = [];
        const newShape = new CANNON.Cylinder(
            this.PLAYER_RADIUS,
            this.PLAYER_RADIUS,
            newHeight,
            8
        );
        this.playerBody.addShape(newShape);
    }
    
    setWalk(walking) {
        // SHIFT = walk (silent movement)
        this.isWalking = walking && !this.isCrouching;
    }
    
    getPlayerPosition() {
        return this.playerBody.position;
    }
    
    getEyeHeight() {
        return this.currentEyeHeight;
    }
}
