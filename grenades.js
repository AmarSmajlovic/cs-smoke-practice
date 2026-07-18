import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { CS2, tuning, VRF_SCALE, GRENADE_ENV_INTENSITY, ASSET_BASE } from './physicsConfig.js';

// Smoke particle animation, injected into three's Points shader. Rebuilds the
// vertex position from the cloud centre each frame instead of reading `position`,
// which is what keeps the per-frame cost off the CPU.
const SMOKE_VERT_HEAD = `
    uniform vec3 uCenter;
    uniform float uBloom;
    uniform float uTime;
    uniform float uFloorY;
    uniform float uRadius;
    attribute vec3 aOffset;
    attribute vec2 aSwirl;
`;
// CS2 expansion: the cloud ROLLS outward from the detonation point — inner
// particles are in place immediately, the rim billows out last. Each particle
// eases along its own offset with a delay proportional to how far out it
// lives, driven by one linear uBloom 0->1.
const SMOKE_VERT_BODY = `
    float swirl = sin(uTime * aSwirl.y + aSwirl.x) * 6.0;
    float rf = clamp(length(aOffset) / uRadius, 0.0, 1.0);
    float b = clamp((uBloom - rf * 0.45) / 0.55, 0.0, 1.0);
    b = 1.0 - pow(1.0 - b, 2.0);
    vec3 transformed = uCenter + aOffset * b;
    transformed.y = max(transformed.y, uFloorY);
    transformed.x += swirl;
    transformed.z -= swirl;
    transformed.y += abs(swirl) * 0.3;
`;

const _dir = new THREE.Vector3();
const _off = new THREE.Vector3();
const _tan = new THREE.Vector3();
const _rand = new THREE.Vector3();
const _wall = new THREE.Vector3();
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
        // headless physics tools have no DOM/fetch pipeline — and no need
        // for the visual model; the placeholder sphere is never rendered there
        if (typeof document === 'undefined') return;
        try {
            const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
            const gltf = await loader.loadAsync(`${ASSET_BASE}/smoke_grenade.glb`);
            this.grenadeModelGLB = gltf.scene;
            this.grenadeModelGLB.traverse((o) => {
                if (o.isMesh) o.material.envMapIntensity = GRENADE_ENV_INTENSITY;
            });
            console.log('Smoke grenade GLB model loaded');
        } catch (e) {
            console.log('No grenade GLB, using placeholder sphere');
        }
    }

    makeGrenadeMesh() {
        if (this.grenadeModelGLB) {
            const m = this.grenadeModelGLB.clone();
            // The CS2 model is real-scale once out of VRF's meters: ~2.3 x 2.1 x
            // 4.6 HU, which lines up with the nadeRadius=2 collision sphere.
            m.scale.setScalar(VRF_SCALE);
            return m;
        }
        return new THREE.Mesh(
            new THREE.SphereGeometry(CS2.nadeRadius, 10, 10),
            new THREE.MeshLambertMaterial({ color: 0x4a5d4a })
        );
    }

    // CS2 throw math: pitch biased up to 10° above the crosshair, speed scaled
    // by throw strength (1 = left click, 0.5 = both, 0 = right click), plus
    // the player's velocity inherited per axis (1.05 horizontal / 0.85
    // vertical — fitted on real demo launch velocities). For a jumpthrow the
    // caller passes the velocity at the jump subtick (vy = full jumpImpulse).
    computeThrow(eyePos, viewForwardHorizontal, sourcePitchDeg, strength, playerVelocity, outPos, outVel) {
        let pitch = THREE.MathUtils.clamp(sourcePitchDeg, -90, 90);
        pitch -= CS2.nadePitchBias * (90 - Math.abs(pitch)) / 90;
        const p = THREE.MathUtils.degToRad(pitch);

        _dir.copy(viewForwardHorizontal).multiplyScalar(Math.cos(p));
        _dir.y = -Math.sin(p); // Source: negative pitch looks up
        _dir.normalize();

        const speed = tuning.throwSpeed * (0.3 + 0.7 * strength);
        outVel.copy(_dir).multiplyScalar(speed);
        outVel.x += tuning.velInheritH * playerVelocity.x;
        outVel.z += tuning.velInheritH * playerVelocity.z;
        outVel.y += tuning.velInheritZ * playerVelocity.y;
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
        return nade; // so the HUD can follow it (picture-in-picture cam)
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
                    vel.multiplyScalar(CS2.nadeGlassSlow);
                }
            }
            _dir.copy(_move).divideScalar(dist);
            // centre ray + radius standoff, NOT a swept sphere: a 5-ray hull
            // sweep was tried and measurably degraded the demo gate — CS2's
            // vphys behaves like the centre trace here
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

                // Split restitution: tangential (along-surface) speed keeps
                // `elasticity`, normal (out-of-surface) speed keeps
                // `elasticityVert`. Both measured at ~0.45 off 361 real demo
                // bounces, and — crucially — the normal ratio is flat across
                // impact angle: steep head-on drops rebound with the same 0.44
                // as glancing skims. An earlier glance² falloff crushed steep
                // rebounds to near zero and threw high/lobbed lineups long; the
                // upward cap alone (real rebound tops out ~236 u/s) is what
                // keeps rooftop drops to small hops.
                const into = vel.dot(_normal);
                _bounceN.copy(_normal).multiplyScalar(into);
                _bounceT.copy(vel).sub(_bounceN);
                // Hard FLOOR impacts keep ~0.29 instead of 0.45, triggered by
                // the normal component of the impact (steep fast falls crush;
                // fast glancing skims keep full bounce) — measured from real
                // demo floor bounces binned by vzIn (bounce-speed.mjs). Walls
                // stay at 0.45: the demo set has no fast wall data, and running
                // throws smacking walls at 900 u/s measurably keep full bounce.
                const hot = _normal.y > 0.7 ? THREE.MathUtils.clamp(
                    (-into - CS2.nadeHotSpeedStart) / (CS2.nadeHotSpeedEnd - CS2.nadeHotSpeedStart), 0, 1) : 0;
                const eT = THREE.MathUtils.lerp(tuning.elasticity, CS2.nadeElasticityHot, hot);
                const eN = THREE.MathUtils.lerp(tuning.elasticityVert, CS2.nadeElasticityHot, hot);
                vel.copy(_bounceT).multiplyScalar(eT)
                    .addScaledVector(_normal, -into * eN);
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
        // hand the trail over to the smoke: it lives while the cloud lives
        this.createSmoke(p.clone(), nade.trail);
    }

    // CS2-style cloud: a dense grey billow that hugs the ground, never expands
    // through walls, and banks along the ones it meets instead of being sliced
    // off by them. Each particle's resting offset is baked once at detonation;
    // the bloom and swirl then run entirely in the vertex shader, so animating a
    // cloud costs two uniform writes per layer per frame instead of a JS loop
    // over every particle.
    // Where a single smoke particle comes to rest, as an offset from the cloud
    // centre. Left alone it just reaches `target` along `dir`. If a wall is in
    // the way, capping it there would slice the cloud flat against the surface —
    // real smoke banks and runs along the face instead. So the reach it didn't
    // get to use is redirected into the wall's tangent plane, which is what
    // fills the corner and spreads the cloud up against walls.
    reachThroughWorld(center, dir, target, out) {
        out.copy(dir).multiplyScalar(target);
        const hit = this.mapLoader.raycastNade(center, dir, target + 4);
        if (!hit) return out;

        const stop = Math.max(hit.distance - 4, 2);
        let excess = target - stop;
        out.copy(dir).multiplyScalar(stop);
        if (excess < 1) return out;

        // Slide direction: the particle's own heading flattened onto the wall,
        // plus some scatter so a head-on cloud fans out instead of streaking.
        const n = hit.face.normal; // nadeCollider sits at identity — already world
        _tan.copy(dir).addScaledVector(n, -dir.dot(n));
        _rand.set(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1);
        _rand.addScaledVector(n, -_rand.dot(n));
        _tan.addScaledVector(_rand, 0.6);
        // Smoke leaning on a vertical wall CLIMBS it (CS2: the cloud visibly
        // runs up the face, not just sideways along it) — bias the slide up.
        if (Math.abs(n.y) < 0.5) _tan.y += 0.8 + Math.random() * 0.6;
        if (_tan.lengthSq() < 1e-6) return out;
        _tan.normalize();

        // Sliding can walk straight into the next wall of a corner, so the run
        // along the face gets the same treatment as the run out from the centre.
        _wall.copy(center).add(out);
        const slideHit = this.mapLoader.raycastNade(_wall, _tan, excess + 4);
        if (slideHit) excess = Math.max(slideHit.distance - 4, 0);

        return out.addScaledVector(_tan, excess * 0.8);
    }

    createSmoke(groundPos, trail = null) {
        if (this.smokes.length >= this.maxSmokes) {
            this.removeSmoke(this.smokes[0]);
        }

        // cloud center floats above the detonation point; bottom fills to floor
        const center = groundPos.clone();
        center.y += CS2.smokeRadius * 0.34;
        const R = CS2.smokeRadius;

        // rMin/rMax carve out the shell a layer lives in, as a fraction of R:
        // cbrt keeps the draw uniform by volume, so rMin=0,rMax=1 fills the whole
        // ball evenly and a low rMax packs a layer into the middle.
        const makeLayer = (count, size, opacity, color, rMin, rMax = 1) => {
            const positions = new Float32Array(count * 3);
            const offsets = new Float32Array(count * 3);
            const swirls = new Float32Array(count * 2);
            const colors = new Float32Array(count * 3);
            const tint = new THREE.Color(color);

            for (let i = 0; i < count; i++) {
                _dir.set(
                    Math.random() * 2 - 1,
                    (Math.random() * 2 - 1) * 0.58,
                    Math.random() * 2 - 1
                ).normalize();

                const target = R * rMax * Math.cbrt(rMin + (1 - rMin) * Math.random());
                this.reachThroughWorld(center, _dir, target, _off);

                // Ground skirt: reach that would dive below the floor spills
                // OUTWARD along it instead — CS2 smoke sits on the ground and
                // spreads, it doesn't get sliced into a flat underside.
                const below = (groundPos.y + 4) - (center.y + _off.y);
                if (below > 0) {
                    // keep a little sag so the underside isn't a laser-flat
                    // plane, and spread wide — the skirt is what sells contact
                    _off.y += below - Math.random() * 10;
                    const h = Math.hypot(_off.x, _off.z) || 1;
                    const push = below * (0.8 + Math.random() * 0.7);
                    _off.x += (_off.x / h) * push;
                    _off.z += (_off.z / h) * push;
                }

                offsets[i * 3] = _off.x;
                offsets[i * 3 + 1] = _off.y;
                offsets[i * 3 + 2] = _off.z;
                swirls[i * 2] = Math.random() * Math.PI * 2;       // phase
                swirls[i * 2 + 1] = 0.2 + Math.random() * 0.4;     // speed
                // Unused by the shader (it builds the position from uCenter +
                // aOffset), but three still wants a position attribute.
                positions[i * 3] = center.x;
                positions[i * 3 + 1] = groundPos.y + 2;
                positions[i * 3 + 2] = center.z;

                // CS2's volumetric read comes from self-shadowing: a bright
                // crown up top, dusk in the underbelly and the packed middle.
                // Bake that per particle — lit by height, opened up by radius.
                const rN = _off.length() / R;
                const hN = THREE.MathUtils.clamp(_off.y / (R * 0.62), -1, 1.4);
                const shade = Math.min(
                    0.60 + 0.14 * rN + 0.22 * (hN * 0.5 + 0.5) + Math.random() * 0.05, 1.0);
                colors[i * 3] = Math.min(tint.r * shade, 1);
                colors[i * 3 + 1] = Math.min(tint.g * shade, 1);
                colors[i * 3 + 2] = Math.min(tint.b * shade, 1);
            }

            const geometry = new THREE.BufferGeometry();
            geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
            geometry.setAttribute('aOffset', new THREE.BufferAttribute(offsets, 3));
            geometry.setAttribute('aSwirl', new THREE.BufferAttribute(swirls, 2));
            geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
            // Every position is the centre, so an automatic bounding sphere would
            // be a point and the cloud would pop out of view the moment its centre
            // left the frustum. Cover the real extent by hand.
            geometry.boundingSphere = new THREE.Sphere(center.clone(), R * 1.5);

            const material = new THREE.PointsMaterial({
                size,
                map: getSmokeSprite(),
                transparent: true,
                opacity,
                depthWrite: false,
                sizeAttenuation: true,
                vertexColors: true, // per-particle shade baked above
            });

            const layer = { baseOpacity: opacity, shader: null };
            material.onBeforeCompile = (shader) => {
                shader.uniforms.uCenter = { value: center };
                shader.uniforms.uBloom = { value: 0 };
                shader.uniforms.uTime = { value: 0 };
                shader.uniforms.uFloorY = { value: groundPos.y + 2 };
                shader.uniforms.uRadius = { value: R };
                shader.vertexShader = SMOKE_VERT_HEAD + shader.vertexShader
                    .replace('#include <begin_vertex>', SMOKE_VERT_BODY);
                layer.shader = shader;
            };
            // All layers compile to the same source; keep them on one program.
            material.customProgramCacheKey = () => 'smoke-points';

            const mesh = new THREE.Points(geometry, material);
            this.scene.add(mesh);
            return Object.assign(layer, { mesh, geometry, material });
        };

        // CS2 smoke is a near-neutral grey-white mass, not a cream haze. Three
        // layers so the cloud is opaque through the middle but still breaks up
        // at the rim: a packed core that kills all see-through, the body that
        // sets the silhouette, and finer detail puffs that give the surface
        // its billow texture (shading itself is baked per particle).
        const layers = [
            makeLayer(240, 145, 1.0, 0xd8d8d5, 0.0, 0.62),  // packed opaque core
            makeLayer(700, 110, 0.98, 0xcfcfcb, 0.10),      // body / silhouette
            makeLayer(400, 60, 0.92, 0xc6c6c2, 0.30),       // billow detail lumps
        ];

        this.smokes.push({
            layers, center, trail,
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
            // Linear ramp; the vertex shader staggers it per particle so the
            // cloud rolls outward CS2-style — core instant, rim done by ~1s
            const bloom = Math.min(elapsed / 1000, 1);
            const fadeStart = CS2.smokeDurationMs - 3000;
            const fade = elapsed > fadeStart ? 1 - (elapsed - fadeStart) / 3000 : 1;
            smoke.bloom = bloom;
            smoke.fade = fade;

            for (const layer of smoke.layers) {
                // null until the material has compiled — the cloud just sits
                // unbloomed for that one frame
                if (layer.shader) {
                    layer.shader.uniforms.uBloom.value = bloom;
                    layer.shader.uniforms.uTime.value = smoke.time;
                }
                layer.material.opacity = layer.baseOpacity * fade;
            }
        }
    }

    // How deep inside a smoke the given point is, 0..1 — drives the full-view
    // fog when the CAMERA is inside a cloud. From within, CS2 smoke reads as a
    // near-solid grey wash; sparse billboard puffs alone leave see-through
    // gaps at point-blank range no particle count can close.
    smokeFogDensity(pos) {
        let f = 0;
        const R = CS2.smokeRadius;
        for (const s of this.smokes) {
            if (!s.bloom) continue;
            const dx = pos.x - s.center.x;
            const dy = (pos.y - s.center.y) / 0.62; // cloud is a squashed ball
            const dz = pos.z - s.center.z;
            const d = Math.sqrt(dx * dx + dy * dy + dz * dz) / (R * s.bloom);
            // 0 at the rim, 1 once ~35% deep
            const k = THREE.MathUtils.clamp((1 - d) / 0.35, 0, 1);
            f = Math.max(f, k * s.fade);
        }
        return f;
    }

    removeSmoke(smoke) {
        for (const layer of smoke.layers) {
            this.scene.remove(layer.mesh);
            layer.geometry.dispose();
            layer.material.dispose();
        }
        // the lineup trail dies with its smoke
        if (smoke.trail) {
            this.scene.remove(smoke.trail);
            smoke.trail.geometry.dispose();
            smoke.trail.material.dispose();
            const ti = this.trails.indexOf(smoke.trail);
            if (ti !== -1) this.trails.splice(ti, 1);
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

    // Hold near-full alpha out to ~70% of the radius before falling off. A soft
    // linear gradient makes every particle read as a wisp; CS2 smoke reads as a
    // solid mass, so each puff needs a body with a defined edge, not a haze.
    const blob = (x, y, r, a) => {
        const g = ctx.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, `rgba(255,255,255,${a})`);
        g.addColorStop(0.55, `rgba(255,255,255,${a * 0.96})`);
        g.addColorStop(0.78, `rgba(255,255,255,${a * 0.72})`);
        g.addColorStop(0.92, `rgba(255,255,255,${a * 0.24})`);
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
