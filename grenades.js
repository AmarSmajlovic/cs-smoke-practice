import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { CS2, tuning } from './physicsConfig.js';

const _dir = new THREE.Vector3();
const _move = new THREE.Vector3();
const _normal = new THREE.Vector3();
const _end = new THREE.Vector3();
const _segBox = new THREE.Box3();

// Smoke grenade projectiles + smoke clouds. Projectiles are simulated at a fixed
// tick (call tick() from the physics loop); clouds animate per frame (call update()).
export class GrenadeSystem {
    constructor(scene, mapLoader) {
        this.scene = scene;
        this.mapLoader = mapLoader;
        this.projectiles = [];
        this.smokes = [];
        this.maxSmokes = 3;
        this.grenadeModelGLB = null;
        this.loadGrenadeModel();
    }

    async loadGrenadeModel() {
        try {
            const gltf = await new GLTFLoader().loadAsync('/models/smoke_grenade.glb');
            this.grenadeModelGLB = gltf.scene;
            console.log('Smoke grenade GLB model loaded');
        } catch (e) {
            console.log('No grenade GLB, using placeholder sphere');
        }
    }

    makeGrenadeMesh() {
        if (this.grenadeModelGLB) {
            const m = this.grenadeModelGLB.clone();
            m.scale.setScalar(0.08); // model was authored for meter-scale worlds
            return m;
        }
        return new THREE.Mesh(
            new THREE.SphereGeometry(CS2.nadeRadius, 10, 10),
            new THREE.MeshLambertMaterial({ color: 0x4a5d4a })
        );
    }

    // CS2 throw math: pitch biased up to 10° above the crosshair, speed scaled
    // by throw strength (1 = left click, 0.5 = both, 0 = right click), plus
    // 1.25x of the player's current velocity (this IS the jumpthrow).
    computeThrow(eyePos, viewForwardHorizontal, sourcePitchDeg, strength, playerVelocity, outPos, outVel) {
        let pitch = THREE.MathUtils.clamp(sourcePitchDeg, -90, 90);
        pitch -= CS2.nadePitchBias * (90 - Math.abs(pitch)) / 90;
        const p = THREE.MathUtils.degToRad(pitch);

        _dir.copy(viewForwardHorizontal).multiplyScalar(Math.cos(p));
        _dir.y = -Math.sin(p); // Source: negative pitch looks up
        _dir.normalize();

        const speed = tuning.throwSpeed * (0.3 + 0.7 * strength);
        outVel.copy(_dir).multiplyScalar(speed).addScaledVector(playerVelocity, tuning.velInherit);
        outPos.copy(eyePos).addScaledVector(_dir, CS2.nadeSpawnForward);
    }

    throwGrenade(eyePos, viewForwardHorizontal, sourcePitchDeg, strength, playerVelocity) {
        const mesh = this.makeGrenadeMesh();
        const velocity = new THREE.Vector3();
        this.computeThrow(eyePos, viewForwardHorizontal, sourcePitchDeg, strength, playerVelocity, mesh.position, velocity);
        this.scene.add(mesh);

        this.projectiles.push({
            mesh,
            position: mesh.position,
            velocity,
            rolling: false,
            age: 0,
        });
    }

    tick(dt) {
        for (let i = this.projectiles.length - 1; i >= 0; i--) {
            const nade = this.projectiles[i];
            if (!this.stepProjectile(nade, dt)) {
                this.detonate(nade);
                this.scene.remove(nade.mesh);
                this.projectiles.splice(i, 1);
            }
        }
    }

    // One physics step for a grenade state {position, velocity, rolling, age}.
    // Returns false when the grenade comes to rest (=> detonate).
    // interactive=false is used for the trajectory preview: identical path,
    // but glass isn't actually broken.
    stepProjectile(nade, dt, interactive = true) {
        const pos = nade.position;
        const vel = nade.velocity;
        nade.age += dt;
        if (nade.age > 20) return false; // safety net

        if (!nade.rolling) {
            vel.y -= CS2.gravity * tuning.nadeGravityScale * dt;
        }

        _move.copy(vel).multiplyScalar(dt);
        const dist = _move.length();
        if (dist > 1e-6) {
            // breakable glass: smash through, keep flying (slight speed loss)
            for (const b of this.mapLoader.breakables) {
                if (b.broken || (nade.passed && nade.passed.has(b))) continue;
                _segBox.setFromPoints([pos, _end.copy(pos).add(_move)]).expandByScalar(CS2.nadeRadius);
                if (b.box.intersectsBox(_segBox)) {
                    if (interactive) {
                        b.broken = true;
                        b.mesh.visible = false;
                    } else if (nade.passed) {
                        nade.passed.add(b);
                    }
                    vel.multiplyScalar(0.9);
                }
            }
            _dir.copy(_move).divideScalar(dist);
            const hit = this.mapLoader.raycast(pos, _dir, dist + CS2.nadeRadius);
            if (hit) {
                // Land just off the surface
                pos.addScaledVector(_dir, Math.max(hit.distance - CS2.nadeRadius, 0));

                _normal.copy(hit.face.normal);
                if (_normal.dot(_dir) > 0) _normal.negate(); // DoubleSide faces

                // Reflect and lose energy (Source: clip w/ overbounce 2, then * elasticity)
                const into = vel.dot(_normal);
                vel.addScaledVector(_normal, -2 * into);
                vel.multiplyScalar(tuning.elasticity);

                const isFloor = _normal.y > 0.7;
                const speed = vel.length();

                if (isFloor && speed < 25) return false; // at rest -> detonate

                if (isFloor && Math.abs(vel.y) < 60) {
                    // Too slow to keep bouncing: roll along the ground
                    nade.rolling = true;
                    vel.y = 0;
                }
            } else {
                pos.add(_move);
                if (nade.rolling) {
                    // Still on the ground? If not, resume flying (rolled off an edge)
                    const ground = this.mapLoader.raycast(pos, _down, CS2.nadeRadius + 4);
                    if (ground) {
                        pos.y = ground.point.y + CS2.nadeRadius;
                    } else {
                        nade.rolling = false;
                    }
                }
            }
        }

        if (nade.rolling) {
            // Ground friction while rolling
            const speed = Math.hypot(vel.x, vel.z);
            const newSpeed = Math.max(0, speed - 350 * dt);
            if (newSpeed < 15) return false; // stopped -> detonate
            const s = newSpeed / speed;
            vel.x *= s;
            vel.z *= s;
        } else if (nade.mesh) {
            nade.mesh.rotateX(-0.15); // tumble in flight
        }

        return true;
    }

    // ---- CS2-style grenade trajectory preview (shown while holding a throw)
    ensurePreview() {
        if (this.previewLine) return;
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(PREVIEW_MAX * 3), 3));
        this.previewLine = new THREE.Line(geo, new THREE.LineBasicMaterial({
            color: 0xf5b83d, transparent: true, opacity: 0.9, depthTest: false,
        }));
        this.previewLine.renderOrder = 5;
        this.previewLine.frustumCulled = false;
        this.scene.add(this.previewLine);

        this.previewMarker = new THREE.Mesh(
            new THREE.SphereGeometry(7, 14, 14),
            new THREE.MeshBasicMaterial({ color: 0xf5b83d, transparent: true, opacity: 0.55, depthTest: false })
        );
        this.previewMarker.renderOrder = 5;
        this.scene.add(this.previewMarker);
        this.hidePreview();
    }

    updatePreview(eyePos, viewForwardHorizontal, sourcePitchDeg, strength, playerVelocity) {
        this.ensurePreview();
        this.computeThrow(eyePos, viewForwardHorizontal, sourcePitchDeg, strength, playerVelocity, _simState.position, _simState.velocity);
        _simState.rolling = false;
        _simState.age = 0;
        _simState.passed.clear();

        const attr = this.previewLine.geometry.attributes.position;
        let n = 0;
        attr.setXYZ(n++, _simState.position.x, _simState.position.y, _simState.position.z);
        let alive = true;
        for (let i = 0; i < 64 * 12 && alive && n < PREVIEW_MAX; i++) {
            alive = this.stepProjectile(_simState, CS2.TICK, false);
            if (i % 2 === 0 || !alive) {
                attr.setXYZ(n++, _simState.position.x, _simState.position.y, _simState.position.z);
            }
        }
        attr.needsUpdate = true;
        this.previewLine.geometry.setDrawRange(0, n);
        this.previewLine.visible = true;
        this.previewMarker.position.copy(_simState.position);
        this.previewMarker.visible = true;
    }

    hidePreview() {
        if (this.previewLine) this.previewLine.visible = false;
        if (this.previewMarker) this.previewMarker.visible = false;
    }

    detonate(nade) {
        const p = nade.position;
        console.log(`Smoke detonated at ${p.x.toFixed(0)} ${p.y.toFixed(0)} ${p.z.toFixed(0)}`);
        this.createSmoke(p.clone());
    }

    // CS2-style cloud: dense flattened sphere ~290u wide and ~190u tall that
    // hugs the ground, but never expands through walls — each particle's
    // travel is capped by a raycast at spawn time.
    createSmoke(groundPos) {
        if (this.smokes.length >= this.maxSmokes) {
            this.removeSmoke(this.smokes[0]);
        }

        // cloud center floats above the detonation point; bottom fills to floor
        const center = groundPos.clone();
        center.y += CS2.smokeRadius * 0.42;

        const R = CS2.smokeRadius;
        const count = 900;
        const positions = new Float32Array(count * 3);
        const particles = [];

        for (let i = 0; i < count; i++) {
            // Random direction, squashed vertically (CS2 smoke is wider than tall)
            _dir.set(
                Math.random() * 2 - 1,
                (Math.random() * 2 - 1) * 0.66,
                Math.random() * 2 - 1
            ).normalize();

            // Volume-uniform target distance, capped by geometry
            let target = R * Math.cbrt(0.12 + 0.88 * Math.random());
            const hit = this.mapLoader.raycast(center, _dir, target + 10);
            if (hit) target = Math.max(hit.distance - 10, 4);

            particles.push({
                dir: _dir.clone(),
                target,
                swirlPhase: Math.random() * Math.PI * 2,
                swirlSpeed: 0.25 + Math.random() * 0.45,
            });
            positions[i * 3] = center.x;
            positions[i * 3 + 1] = groundPos.y + 2;
            positions[i * 3 + 2] = center.z;
        }

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

        const material = new THREE.PointsMaterial({
            color: 0xb2b2b2,
            size: 95,
            map: getSmokeSprite(),
            transparent: true,
            opacity: 0.92,
            depthWrite: false,
            sizeAttenuation: true,
        });

        const mesh = new THREE.Points(geometry, material);
        this.scene.add(mesh);

        this.smokes.push({
            mesh, geometry, material, particles, center,
            floorY: groundPos.y,
            startTime: performance.now(),
            time: 0,
        });
    }

    update(delta) {
        for (let i = this.smokes.length - 1; i >= 0; i--) {
            const smoke = this.smokes[i];
            const elapsed = performance.now() - smoke.startTime;
            if (elapsed >= CS2.smokeDurationMs) {
                this.removeSmoke(smoke);
                continue;
            }

            smoke.time += delta;
            // Fast bloom like CS2: ~90% expanded within the first second
            const bloom = 1 - Math.pow(1 - Math.min(elapsed / 1100, 1), 3);

            const pos = smoke.geometry.attributes.position.array;
            const c = smoke.center;
            const floorY = smoke.floorY + 2;
            for (let j = 0; j < smoke.particles.length; j++) {
                const pt = smoke.particles[j];
                const d = pt.target * bloom;
                const swirl = Math.sin(smoke.time * pt.swirlSpeed + pt.swirlPhase) * 6;
                pos[j * 3] = c.x + pt.dir.x * d + swirl;
                pos[j * 3 + 1] = Math.max(c.y + pt.dir.y * d, floorY) + Math.abs(swirl) * 0.3;
                pos[j * 3 + 2] = c.z + pt.dir.z * d - swirl;
            }
            smoke.geometry.attributes.position.needsUpdate = true;

            // Fade out over the last 3 seconds
            const fadeStart = CS2.smokeDurationMs - 3000;
            smoke.material.opacity = elapsed > fadeStart
                ? 0.92 * (1 - (elapsed - fadeStart) / 3000)
                : 0.92;
        }
    }

    removeSmoke(smoke) {
        this.scene.remove(smoke.mesh);
        smoke.geometry.dispose();
        smoke.material.dispose();
        const idx = this.smokes.indexOf(smoke);
        if (idx !== -1) this.smokes.splice(idx, 1);
    }

    clearAllSmokes() {
        while (this.smokes.length) this.removeSmoke(this.smokes[0]);
    }

    get activeSmokeCount() {
        return this.smokes.length;
    }
}

const _down = new THREE.Vector3(0, -1, 0);
const PREVIEW_MAX = 512;
const _simState = {
    position: new THREE.Vector3(),
    velocity: new THREE.Vector3(),
    rolling: false,
    age: 0,
    passed: new Set(),
};

// Soft radial sprite so smoke particles blend into a cloud instead of squares
let _smokeSprite = null;
function getSmokeSprite() {
    if (_smokeSprite) return _smokeSprite;
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const ctx = c.getContext('2d');
    const grad = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(255,255,255,0.9)');
    grad.addColorStop(0.5, 'rgba(255,255,255,0.45)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 64, 64);
    _smokeSprite = new THREE.CanvasTexture(c);
    return _smokeSprite;
}
