import * as THREE from 'three';

export class RapierPhysics {
    constructor() {
        this.world = null;
        this.bodies = new Map();
        this.initialized = false;
        this.RAPIER = null;
    }
    
    async init() {
        try {
            // Import Rapier dynamically
            const RAPIER = await import('@dimforge/rapier3d');
            
            // Wait for WASM to load
            await RAPIER.default.init();
            this.RAPIER = RAPIER.default;
            
            // Create physics world
            const gravity = { x: 0.0, y: -9.81, z: 0.0 };
            this.world = new this.RAPIER.World(gravity);
            
            this.initialized = true;
            console.log('✅ Rapier physics initialized');
        } catch (e) {
            console.error('❌ Rapier init failed:', e);
            console.log('Falling back to simple physics');
        }
    }
    
    addGround(y = 0) {
        if (!this.initialized) return;
        
        // Create ground plane
        const groundBodyDesc = this.RAPIER.RigidBodyDesc.fixed()
            .setTranslation(0, y, 0);
        const groundBody = this.world.createRigidBody(groundBodyDesc);
        
        const groundColliderDesc = this.RAPIER.ColliderDesc.cuboid(100, 0.1, 100)
            .setRestitution(0.3)
            .setFriction(0.5);
        this.world.createCollider(groundColliderDesc, groundBody);
        
        console.log('Ground added at Y:', y);
    }
    
    addMapCollision(map) {
        if (!this.initialized) return;
        
        console.log('Adding map collision to Rapier...');
        let count = 0;
        
        map.traverse((child) => {
            if (child.isMesh) {
                this.addMeshCollider(child);
                count++;
            }
        });
        
        console.log('Added', count, 'mesh colliders');
    }
    
    addMeshCollider(mesh) {
        mesh.updateMatrixWorld(true);
        
        // Get bounding box
        const geometry = mesh.geometry;
        geometry.computeBoundingBox();
        const bbox = geometry.boundingBox;
        
        // Get world transform
        const pos = new THREE.Vector3();
        const quat = new THREE.Quaternion();
        const scale = new THREE.Vector3();
        mesh.matrixWorld.decompose(pos, quat, scale);
        
        // Calculate size
        const size = new THREE.Vector3();
        bbox.getSize(size);
        size.multiply(scale);
        
        // Create static body
        const bodyDesc = this.RAPIER.RigidBodyDesc.fixed()
            .setTranslation(pos.x, pos.y, pos.z)
            .setRotation({ x: quat.x, y: quat.y, z: quat.z, w: quat.w });
        const body = this.world.createRigidBody(bodyDesc);
        
        // Create box collider
        const colliderDesc = this.RAPIER.ColliderDesc.cuboid(
            Math.abs(size.x) / 2,
            Math.abs(size.y) / 2,
            Math.abs(size.z) / 2
        ).setRestitution(0.4).setFriction(0.3);
        
        this.world.createCollider(colliderDesc, body);
    }
    
    createGrenade(position, velocity) {
        if (!this.initialized) return null;
        
        // Create dynamic rigid body
        const bodyDesc = this.RAPIER.RigidBodyDesc.dynamic()
            .setTranslation(position.x, position.y, position.z)
            .setLinvel(velocity.x, velocity.y, velocity.z)
            .setAngularDamping(0.5)
            .setLinearDamping(0.1);
        
        const body = this.world.createRigidBody(bodyDesc);
        
        // Create sphere collider
        const colliderDesc = this.RAPIER.ColliderDesc.ball(0.05)
            .setRestitution(0.5) // Bounciness
            .setFriction(0.4)
            .setDensity(1.0);
        
        this.world.createCollider(colliderDesc, body);
        
        return body;
    }
    
    update(deltaTime) {
        if (!this.initialized) return;
        this.world.step();
    }
    
    getBodyPosition(body) {
        const translation = body.translation();
        return new THREE.Vector3(translation.x, translation.y, translation.z);
    }
    
    getBodyRotation(body) {
        const rotation = body.rotation();
        return new THREE.Quaternion(rotation.x, rotation.y, rotation.z, rotation.w);
    }
    
    getBodyVelocity(body) {
        const vel = body.linvel();
        return new THREE.Vector3(vel.x, vel.y, vel.z);
    }
    
    removeBody(body) {
        if (this.world && body) {
            this.world.removeRigidBody(body);
        }
    }
}
