import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { CS2, tuning } from './physicsConfig.js';

const _dir = new THREE.Vector3();
const _move = new THREE.Vector3();
const _normal = new THREE.Vector3();
const _bounceN = new THREE.Vector3();
const _bounceT = new THREE.Vector3();
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
        this.trails = [];
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

        const nade = {
            mesh,
            position: mesh.position,
            velocity,
            rolling: false,
            age: 0,
            trail: null,
            trailCount: 0,
            trailTick: 0,
        };
        this.projectiles.push(nade);
        this.startTrail(nade);
    }

    tick(dt) {
        for (let i = this.projectiles.length - 1; i >= 0; i--) {
            const nade = this.projectiles[i];
            const alive = this.stepProjectile(nade, dt);
            if (!alive || (nade.trailTick++ % 2 === 0)) this.recordTrailPoint(nade);
            if (!alive) {
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
        if (nade.age > 10) return false; // CS2 cap: smoke pops ~10s after the
                                         // throw even if still moving (the
                                         // cs2utils window lineup: 9.999s)

        // Source half-gravity integration (half before the move, half at the
        // end of the step) — plain Euler flies measurably lower and shorter
        if (!nade.rolling) {
            vel.y -= CS2.gravity * tuning.nadeGravityScale * dt * 0.5;
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
            const hit = this.mapLoader.raycastNade(pos, _dir, dist + CS2.nadeRadius);
            if (hit) {
                // Land just off the surface
                pos.addScaledVector(_dir, Math.max(hit.distance - CS2.nadeRadius, 0));

                _normal.copy(hit.face.normal);
                if (_normal.dot(_dir) > 0) _normal.negate(); // DoubleSide faces

                // CS2 grenades bounce off simple axis-aligned clip hulls; our
                // collider is the visual mesh whose decorative bevels/trims
                // deflect bounces sideways. Snap near-axis normals (<~12°)
                // to the axis — real ramps and slanted walls stay untouched.
                {
                    const ax = Math.abs(_normal.x), ay = Math.abs(_normal.y), az = Math.abs(_normal.z);
                    const m = Math.max(ax, ay, az);
                    if (m > 0.978) {
                        if (m === ax) _normal.set(Math.sign(_normal.x), 0, 0);
                        else if (m === ay) _normal.set(0, Math.sign(_normal.y), 0);
                        else _normal.set(0, 0, Math.sign(_normal.z));
                    }
                }

                // Bounce with incidence-dependent restitution: glancing hits
                // (fast along the surface) rebound with the full 0.45, steep
                // head-on drops crush their rebound (glance² falloff) — this
                // is what makes rooftop drops die in small hops while skimming
                // bounces carry, with one formula. Tangential always keeps
                // 0.45 (Valve). Upward rebound additionally capped.
                const into = vel.dot(_normal);
                _bounceN.copy(_normal).multiplyScalar(into);
                _bounceT.copy(vel).sub(_bounceN);
                const glance = Math.min(1, _bounceT.length() / Math.max(1, -into));
                vel.copy(_bounceT).multiplyScalar(tuning.elasticity)
                    .addScaledVector(_normal, -into * tuning.elasticity * glance * glance);
                if (vel.y > CS2.nadeBounceVyCap) vel.y = CS2.nadeBounceVyCap;

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
                    const ground = this.mapLoader.raycastNade(pos, _down, CS2.nadeRadius + 4);
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
        } else {
            vel.y -= CS2.gravity * tuning.nadeGravityScale * dt * 0.5; // second half-step
            if (nade.mesh) nade.mesh.rotateX(-0.15); // tumble in flight
        }

        return true;
    }

    // ---- CS2-style grenade trail: a line is drawn along the path the nade
    // actually flew and stays visible so you can study the lineup
    startTrail(nade) {
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(TRAIL_MAX * 3), 3));
        geo.setDrawRange(0, 0);
        const line = new THREE.Line(geo, new THREE.LineBasicMaterial({
            color: 0xf5b83d, transparent: true, opacity: 0.85,
        }));
        line.frustumCulled = false;
        this.scene.add(line);
        nade.trail = line;
        nade.trailCount = 0;
        this.trails.push(line);
        while (this.trails.length > MAX_TRAILS) {
            const old = this.trails.shift();
            this.scene.remove(old);
            old.geometry.dispose();
            old.material.dispose();
        }
        this.recordTrailPoint(nade);
    }

    recordTrailPoint(nade) {
        if (!nade.trail || nade.trailCount >= TRAIL_MAX) return;
        const attr = nade.trail.geometry.attributes.position;
        attr.setXYZ(nade.trailCount++, nade.position.x, nade.position.y, nade.position.z);
        attr.needsUpdate = true;
        nade.trail.geometry.setDrawRange(0, nade.trailCount);
    }

    clearTrails() {
        for (const t of this.trails) {
            this.scene.remove(t);
            t.geometry.dispose();
            t.material.dispose();
        }
        this.trails = [];
        for (const nade of this.projectiles) nade.trail = null;
    }

    detonate(nade) {
        const p = nade.position;
        console.log(`Smoke detonated at ${p.x.toFixed(0)} ${p.y.toFixed(0)} ${p.z.toFixed(0)}`);
        this.createSmoke(p.clone());
    }

    // CS2-style cloud: dense cream billow ~290u wide that hugs the ground and
    // never expands through walls (each particle capped by a raycast).
    // Two particle layers: big puffs for the body + smaller ones for detail.
    createSmoke(groundPos) {
        if (this.smokes.length >= this.maxSmokes) {
            this.removeSmoke(this.smokes[0]);
        }

        // cloud center floats above the detonation point; bottom fills to floor
        const center = groundPos.clone();
        center.y += CS2.smokeRadius * 0.4;
        const R = CS2.smokeRadius;

        const makeLayer = (count, size, opacity, color, rMin) => {
            const positions = new Float32Array(count * 3);
            const particles = [];
            for (let i = 0; i < count; i++) {
                _dir.set(
                    Math.random() * 2 - 1,
                    (Math.random() * 2 - 1) * 0.58,
                    Math.random() * 2 - 1
                ).normalize();

                let target = R * Math.cbrt(rMin + (1 - rMin) * Math.random());
                const hit = this.mapLoader.raycastNade(center, _dir, target + 10);
                if (hit) target = Math.max(hit.distance - 10, 4);

                particles.push({
                    dir: _dir.clone(),
                    target,
                    swirlPhase: Math.random() * Math.PI * 2,
                    swirlSpeed: 0.2 + Math.random() * 0.4,
                });
                positions[i * 3] = center.x;
                positions[i * 3 + 1] = groundPos.y + 2;
                positions[i * 3 + 2] = center.z;
            }
            const geometry = new THREE.BufferGeometry();
            geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
            const material = new THREE.PointsMaterial({
                color, size,
                map: getSmokeSprite(),
                transparent: true,
                opacity,
                depthWrite: false,
                sizeAttenuation: true,
            });
            const mesh = new THREE.Points(geometry, material);
            this.scene.add(mesh);
            return { mesh, geometry, material, particles, baseOpacity: opacity };
        };

        const layers = [
            makeLayer(500, 130, 0.96, 0xdad4c6, 0.10), // big cream body puffs
            makeLayer(450, 70, 0.9, 0xc9c3b4, 0.30),   // smaller darker detail
        ];

        this.smokes.push({
            layers, center,
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
            const fadeStart = CS2.smokeDurationMs - 3000;
            const fade = elapsed > fadeStart ? 1 - (elapsed - fadeStart) / 3000 : 1;

            const c = smoke.center;
            const floorY = smoke.floorY + 2;
            for (const layer of smoke.layers) {
                const pos = layer.geometry.attributes.position.array;
                for (let j = 0; j < layer.particles.length; j++) {
                    const pt = layer.particles[j];
                    const d = pt.target * bloom;
                    const swirl = Math.sin(smoke.time * pt.swirlSpeed + pt.swirlPhase) * 6;
                    pos[j * 3] = c.x + pt.dir.x * d + swirl;
                    pos[j * 3 + 1] = Math.max(c.y + pt.dir.y * d, floorY) + Math.abs(swirl) * 0.3;
                    pos[j * 3 + 2] = c.z + pt.dir.z * d - swirl;
                }
                layer.geometry.attributes.position.needsUpdate = true;
                layer.material.opacity = layer.baseOpacity * fade;
            }
        }
    }

    removeSmoke(smoke) {
        for (const layer of smoke.layers) {
            this.scene.remove(layer.mesh);
            layer.geometry.dispose();
            layer.material.dispose();
        }
        const idx = this.smokes.indexOf(smoke);
        if (idx !== -1) this.smokes.splice(idx, 1);
    }

    clearAllSmokes() {
        while (this.smokes.length) this.removeSmoke(this.smokes[0]);
        this.clearTrails();
    }

    get activeSmokeCount() {
        return this.smokes.length;
    }
}

const _down = new THREE.Vector3(0, -1, 0);
const TRAIL_MAX = 640;
const MAX_TRAILS = 4;

// Puffy "cauliflower" sprite: several overlapping soft blobs instead of one
// smooth circle, so overlapping particles read as billowing CS2-style smoke
let _smokeSprite = null;
function getSmokeSprite() {
    if (_smokeSprite) return _smokeSprite;
    const S = 128;
    const c = document.createElement('canvas');
    c.width = c.height = S;
    const ctx = c.getContext('2d');

    const blob = (x, y, r, a) => {
        const g = ctx.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, `rgba(255,255,255,${a})`);
        g.addColorStop(0.65, `rgba(255,255,255,${a * 0.55})`);
        g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
    };

    // main body
    blob(S / 2, S / 2, S * 0.42, 0.95);
    // surrounding puffs (fixed pseudo-random layout)
    const puffs = [
        [0.34, 0.36, 0.20], [0.66, 0.34, 0.17], [0.30, 0.62, 0.18],
        [0.68, 0.64, 0.20], [0.50, 0.28, 0.16], [0.50, 0.72, 0.16],
        [0.26, 0.48, 0.14], [0.74, 0.48, 0.14],
    ];
    for (const [px, py, pr] of puffs) blob(px * S, py * S, pr * S, 0.85);

    _smokeSprite = new THREE.CanvasTexture(c);
    return _smokeSprite;
}
