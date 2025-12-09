import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MapLoader } from './mapLoader.js';


// Scene
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87ceeb);
scene.fog = new THREE.Fog(0x87ceeb, 0, 750);

// Camera
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(0, 2, 5);

// Renderer
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
document.getElementById('canvas-container').appendChild(renderer.domElement);

// Controls
const controls = new PointerLockControls(camera, renderer.domElement);

renderer.domElement.addEventListener('click', () => controls.lock());
controls.addEventListener('lock', () => document.getElementById('info').style.display = 'none');
controls.addEventListener('unlock', () => document.getElementById('info').style.display = 'block');

// Lighting
scene.add(new THREE.AmbientLight(0xffffff, 0.6));
const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
dirLight.position.set(50, 100, 50);
scene.add(dirLight);

// Load map
const mapLoader = new MapLoader(scene);
let map = null;

// Try Rapier, fallback to simple
let physics = null;
let smokeSystem = null;

try {
    const { RapierPhysics } = await import('./rapier-physics.js');
    physics = new RapierPhysics();
    await physics.init();
    
    if (physics.initialized) {
        const { SmokeSystemRapier } = await import('./smoke-rapier.js');
        smokeSystem = new SmokeSystemRapier(scene, physics);
        console.log('✅ Using Rapier physics');
    }
} catch (e) {
    console.log('⚠️ Rapier failed, using simple physics');
}

if (!smokeSystem) {
    const { SmokeSystem } = await import('./smoke-simple.js');
    smokeSystem = new SmokeSystem(scene);
}

let mapGroundY = 0;

async function loadMap() {
    try {
        map = await mapLoader.loadMap('/maps/dust2.glb');
        console.log('Map loaded!');
        
        // Calculate map ground level
        const box = new THREE.Box3().setFromObject(map);
        mapGroundY = box.min.y;
        console.log('Map ground Y:', mapGroundY);
        console.log('Map bounds:', box.min, box.max);
        
        // Position camera ABOVE ground level (add extra height)
        camera.position.y = mapGroundY + 10; // Start 10 units above ground
        console.log('Camera starting at Y:', camera.position.y);
        
        // Add map collision to Rapier if available
        if (physics && physics.addMapCollision) {
            physics.addMapCollision(map);
        }
        
        // Find ladders in the map (meshes with "ladder" in name)
        map.traverse((child) => {
            if (child.isMesh && child.name.toLowerCase().includes('ladder')) {
                const box = new THREE.Box3().setFromObject(child);
                ladderZones.push(box);
                console.log('🪜 Found ladder:', child.name, box);
            }
        });
        
        console.log(`Found ${ladderZones.length} ladders`);
        
        // Scale slider
        const slider = document.getElementById('scale-slider');
        const value = document.getElementById('scale-value');
        slider.addEventListener('input', (e) => {
            const s = parseFloat(e.target.value);
            map.scale.set(s, s, s);
            value.textContent = s.toFixed(1);
            
            // Recalculate ground
            const newBox = new THREE.Box3().setFromObject(map);
            mapGroundY = newBox.min.y;
            console.log('New ground Y:', mapGroundY);
        });
    } catch (e) {
        console.log('No map found');
    }
}

loadMap();

// Movement
const moveSpeed = 6;
const keys = { w: false, a: false, s: false, d: false, shift: false, ctrl: false, space: false };

// Grenade in hand (placeholder)
let grenadeInHand = null;
let hasSmoke = false;

async function createGrenadeInHand() {
    const loader = new GLTFLoader();
    
    try {
        const gltf = await loader.loadAsync('/models/smoke_grenade.glb');
        grenadeInHand = gltf.scene;
        grenadeInHand.scale.set(0.002, 0.002, 0.002); // 2x bigger (zoomed in)
        console.log('✅ GLB grenade model loaded for hand');
    } catch (e) {
        console.log('⚠️ GLB load failed, using placeholder:', e.message);
        // Fallback to placeholder
        const geometry = new THREE.SphereGeometry(0.03, 8, 8);
        const material = new THREE.MeshStandardMaterial({ 
            color: 0x888888,
            metalness: 0.8,
            roughness: 0.2
        });
        grenadeInHand = new THREE.Mesh(geometry, material);
    }
    
    grenadeInHand.visible = false;
    
    // Add to camera so it moves with view
    scene.add(camera);
    camera.add(grenadeInHand);
    grenadeInHand.position.set(0.12, -0.12, -0.25); // Closer to camera, more visible
    grenadeInHand.rotation.set(0.3, -0.3, 0.1); // Better angle
    
    console.log('✅ Grenade in hand ready');
}

createGrenadeInHand();

// Physics
let velocityY = 0;
const gravity = -20;
const jumpForce = 7;
let isOnGround = true;

// Head bobbing
let bobPhase = 0;
const bobSpeed = 3; // Slower, more realistic
const bobAmount = 0.008; // Very subtle
let currentBobAmount = 0;

// Smooth movement
let currentVelocity = new THREE.Vector3();
const acceleration = 30;
const friction = 15;

// Ladder system
let ladderZones = []; // Array of ladder bounding boxes
let isOnLadder = false;
const ladderClimbSpeed = 4;

document.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    if (k in keys) keys[k] = true;
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') keys.shift = true;
    if (e.code === 'ControlLeft' || e.code === 'ControlRight') keys.ctrl = true;
    if (e.code === 'Space' && isOnGround) {
        velocityY = jumpForce;
        isOnGround = false;
    }
    
    // Pull out smoke grenade
    if (e.key === '4' || e.key === '4') {
        hasSmoke = !hasSmoke;
        grenadeInHand.visible = hasSmoke;
        console.log(hasSmoke ? '💨 Smoke equipped' : '🔫 Weapon equipped');
    }
});

// Throw system - drži pa pusti
const throwPower = 40; // Max power
let isHoldingThrow = false;
let throwButton = null; // 0 = left, 2 = right

// Mouse down - pripremi bacanje
document.addEventListener('mousedown', (e) => {
    if ((e.button === 0 || e.button === 2) && controls.isLocked && grenadeInHand.visible) {
        isHoldingThrow = true;
        throwButton = e.button;
        console.log('🎯 Ready to throw... (Press SPACE for jump throw)');
    }
});

// Mouse up - baci smoke kad pustiš
document.addEventListener('mouseup', (e) => {
    if (e.button === throwButton && isHoldingThrow && controls.isLocked && grenadeInHand.visible) {
        isHoldingThrow = false;
        
        // Check if space is held for jump throw
        const isJumpThrow = keys.space;
        let power = 0;
        
        if (throwButton === 0) {
            // Left click - full power
            power = throwPower;
        } else if (throwButton === 2) {
            // Right click - underhand (60% power)
            power = throwPower * 0.6;
        }
        
        // Jump throw adds 50% more power
        if (isJumpThrow) {
            power *= 1.5;
            console.log('🚀 JUMP THROW! (+50% power)');
        }
        
        throwSmoke(power);
        throwButton = null;
    }
});

// Prevent context menu on right click
document.addEventListener('contextmenu', (e) => {
    if (controls.isLocked) e.preventDefault();
});

function throwSmoke(power) {
    if (!hasSmoke) {
        console.log('❌ No smoke equipped! Press 4 to equip.');
        return;
    }
    
    const direction = new THREE.Vector3();
    camera.getWorldDirection(direction);
    
    const startPos = camera.position.clone().add(direction.clone().multiplyScalar(0.5));
    
    // Check if using Rapier (has physics property) or simple
    if (smokeSystem.physics) {
        // Rapier version (3 params)
        smokeSystem.throwSmoke(startPos, direction, power);
    } else {
        // Simple version (5 params with groundY and map for collision)
        smokeSystem.throwSmoke(startPos, direction, power, mapGroundY, map);
    }
    console.log(`💨 Smoke thrown with power ${power.toFixed(1)}!`);
    
    grenadeInHand.visible = false;
    hasSmoke = false;
    setTimeout(() => {
        hasSmoke = true;
        if (grenadeInHand) grenadeInHand.visible = true;
    }, 500);
}

document.addEventListener('keyup', (e) => {
    const k = e.key.toLowerCase();
    if (k in keys) keys[k] = false;
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') keys.shift = false;
    if (e.code === 'ControlLeft' || e.code === 'ControlRight') keys.ctrl = false;
});

// Raycaster for collision
const raycaster = new THREE.Raycaster();

function checkCollision(pos, dir, distance) {
    if (!map) return false;
    raycaster.set(pos, dir);
    raycaster.far = distance;
    const hits = raycaster.intersectObject(map, true);
    return hits.length > 0 && hits[0].distance < distance;
}

function checkGround(pos) {
    if (!map) return { hit: true, groundY: 0 };
    
    // Use raycasting to find ground
    raycaster.set(pos, new THREE.Vector3(0, -1, 0));
    raycaster.far = 100;
    const hits = raycaster.intersectObject(map, true);
    
    if (hits.length > 0) {
        return { hit: true, groundY: hits[0].point.y };
    }
    
    // Fallback to map minimum Y
    return { hit: true, groundY: mapGroundY };
}

function checkLadder(pos) {
    // Check if player is inside any ladder zone
    for (const ladderBox of ladderZones) {
        if (ladderBox.containsPoint(pos)) {
            return true;
        }
    }
    return false;
}

// Animation
const clock = new THREE.Clock();

function animate() {
    requestAnimationFrame(animate);
    const delta = clock.getDelta();

    if (controls.isLocked) {
        // Speed
        let speed = moveSpeed;
        if (keys.shift) speed = 3; // Walk
        if (keys.ctrl) speed = 2.5; // Crouch
        
        // Direction
        const forward = new THREE.Vector3();
        const right = new THREE.Vector3();
        
        camera.getWorldDirection(forward);
        forward.y = 0;
        forward.normalize();
        
        right.crossVectors(forward, new THREE.Vector3(0, 1, 0));
        
        // Calculate movement
        const moveDir = new THREE.Vector3();
        if (keys.w) moveDir.add(forward);
        if (keys.s) moveDir.sub(forward);
        if (keys.d) moveDir.add(right);
        if (keys.a) moveDir.sub(right);
        
        const isMoving = moveDir.length() > 0;
        
        // Smooth acceleration
        if (isMoving) {
            moveDir.normalize();
            const targetVelocity = moveDir.multiplyScalar(speed);
            
            // Accelerate towards target velocity
            currentVelocity.x += (targetVelocity.x - currentVelocity.x) * acceleration * delta;
            currentVelocity.z += (targetVelocity.z - currentVelocity.z) * acceleration * delta;
        } else {
            // Apply friction when not moving
            currentVelocity.x *= Math.max(0, 1 - friction * delta);
            currentVelocity.z *= Math.max(0, 1 - friction * delta);
        }
        
        // Apply velocity with collision
        const moveVec = currentVelocity.clone().multiplyScalar(delta);
        const oldPos = camera.position.clone();
        
        // Try X movement
        camera.position.x += moveVec.x;
        if (checkCollision(camera.position, new THREE.Vector3(Math.sign(moveVec.x), 0, 0), 0.5)) {
            camera.position.x = oldPos.x;
            currentVelocity.x = 0; // Stop horizontal velocity on collision
        }
        
        // Try Z movement
        camera.position.z += moveVec.z;
        if (checkCollision(camera.position, new THREE.Vector3(0, 0, Math.sign(moveVec.z)), 0.5)) {
            camera.position.z = oldPos.z;
            currentVelocity.z = 0; // Stop horizontal velocity on collision
        }
        
        // Head bobbing based on actual velocity
        const actualSpeed = Math.sqrt(currentVelocity.x ** 2 + currentVelocity.z ** 2);
        if (isMoving && isOnGround && actualSpeed > 0.1) {
            
            bobPhase += bobSpeed * delta * actualSpeed;
            const targetBob = Math.sin(bobPhase) * bobAmount;
            currentBobAmount += (targetBob - currentBobAmount) * 10 * delta;
            
            // Apply bobbing to grenade in hand - forward/backward like walking (slower)
            if (grenadeInHand && grenadeInHand.visible) {
                grenadeInHand.position.z = -0.25 + Math.sin(bobPhase) * 0.01; // Forward/backward (slower)
                grenadeInHand.position.y = -0.12 + Math.abs(Math.sin(bobPhase)) * 0.005; // Slight up/down
            }
        } else {
            // Smooth out bobbing when not moving
            currentBobAmount *= 0.9;
            bobPhase = 0;
        }
        
        // Reset grenade position when not moving
        if (!isMoving && grenadeInHand && grenadeInHand.visible) {
            grenadeInHand.position.z = -0.25;
            grenadeInHand.position.y = -0.12;
        } else {
            // Smooth out bobbing when not moving
            currentBobAmount *= 0.9;
            bobPhase = 0;
        }
        
        // Check if on ladder
        isOnLadder = checkLadder(camera.position);
        
        if (isOnLadder) {
            // Ladder climbing mode
            velocityY = 0; // Cancel gravity
            
            // Vertical movement on ladder
            if (keys.w) {
                camera.position.y += ladderClimbSpeed * delta; // Climb up
            }
            if (keys.s) {
                camera.position.y -= ladderClimbSpeed * delta; // Climb down
            }
            
            // Can jump off ladder
            if (keys.space) {
                velocityY = jumpForce;
                isOnLadder = false;
            }
            
            isOnGround = false; // Not on ground while on ladder
        } else {
            // Normal gravity
            velocityY += gravity * delta;
            camera.position.y += velocityY * delta;
        }
        
        // Ground check
        const ground = checkGround(camera.position);
        const baseHeight = keys.ctrl ? 1.5 : 2.5;
        
        if (ground.hit) {
            const targetY = ground.groundY + baseHeight + currentBobAmount;
            if (camera.position.y <= targetY) {
                camera.position.y = targetY;
                velocityY = 0;
                isOnGround = true;
            }
        } else {
            isOnGround = false;
        }
        
        // Absolute minimum - don't fall below map ground
        const absoluteMin = mapGroundY + baseHeight;
        if (camera.position.y < absoluteMin) {
            camera.position.y = absoluteMin + currentBobAmount;
            velocityY = 0;
            isOnGround = true;
        }
    }

    // Update physics if available
    if (physics && physics.update) {
        physics.update(delta);
    }
    
    renderer.render(scene, camera);
}

animate();

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});
