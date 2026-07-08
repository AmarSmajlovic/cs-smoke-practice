import * as THREE from 'three';
import { CS2 } from './physicsConfig.js';

const _upVector = new THREE.Vector3(0, 1, 0);
const _tempBox = new THREE.Box3();
const _tempSegment = new THREE.Line3();
const _tempVector = new THREE.Vector3();
const _tempVector2 = new THREE.Vector3();
const _triPoint = new THREE.Vector3();
const _capsulePoint = new THREE.Vector3();
const _wishdir = new THREE.Vector3();
const _delta = new THREE.Vector3();

// Source-style player: friction -> accelerate -> gravity -> move -> capsule depenetration.
// All units are Hammer units; runs at a fixed tick.
export class Player {
    constructor() {
        this.position = new THREE.Vector3();   // feet
        this.velocity = new THREE.Vector3();   // HU/s
        this.onGround = false;
        this.ducking = false;
        this.onLadder = false;
        this.noclip = false;
        this.lastClimb = 0;
        this.eyeCurrent = CS2.eyeStand;        // smoothed (CS2 duck transition)
        this.lastPush = new THREE.Vector3(); // debug: last collision pushout
    }

    get eyeHeight() {
        return this.eyeCurrent;
    }

    get hullHeight() {
        return this.ducking ? CS2.hullHeightCrouch : CS2.hullHeightStand;
    }

    getEyePosition(target) {
        return target.copy(this.position).setY(this.position.y + this.eyeHeight);
    }

    spawn(x, y, z) {
        this.position.set(x, y, z);
        this.velocity.set(0, 0, 0);
        this.onGround = false;
        this.onLadder = false;
    }

    // input: { forwardMove, sideMove ∈ [-1,1], jump, duck, walk }
    // viewForward/viewRight: horizontal unit vectors from the camera yaw
    // viewFull: actual 3D camera forward (for ladder climb direction)
    // ladderZones: Box3[] climbable volumes
    update(dt, input, viewForward, viewRight, collider, viewFull = null, ladderZones = null) {
        this.ducking = input.duck;

        // Smooth duck transition (~0.3s, like CS2 — instant snap feels wrong)
        const eyeTarget = this.ducking ? CS2.eyeCrouch : CS2.eyeStand;
        this.eyeCurrent += (eyeTarget - this.eyeCurrent) * Math.min(1, dt * 14);

        // Noclip: fly freely through everything (CS2 practice-style)
        if (this.noclip) {
            const speed = input.walk ? 220 : 760;
            this.velocity.set(0, 0, 0)
                .addScaledVector(viewFull || viewForward, input.forwardMove * speed)
                .addScaledVector(viewRight, input.sideMove * speed);
            if (input.jump) this.velocity.y += speed * 0.8;
            if (input.duck) this.velocity.y -= speed * 0.8;
            this.position.addScaledVector(this.velocity, dt);
            this.onGround = false;
            this.onLadder = false;
            return;
        }

        // Ladder volume check (feet-center and chest points). Standing on the
        // ground at the base only grabs the ladder when pushing W and looking
        // up at it — otherwise you can walk away normally.
        const wasOnLadder = this.onLadder;
        let activeZone = null;
        if (ladderZones && ladderZones.length) {
            _tempVector.copy(this.position).setY(this.position.y + 36);
            activeZone = ladderZones.find(z =>
                z.containsPoint(this.position) || z.containsPoint(_tempVector)) || null;
        }
        const lookY = viewFull ? viewFull.y : 0;
        // At the very bottom of the zone while looking down, let go so normal
        // physics can land the capsule on the floor (prevents hover-lock)
        const atBottom = activeZone && this.position.y <= activeZone.min.y + 6 && lookY <= 0.15;
        this.onLadder = !!activeZone && !atBottom &&
            (!this.onGround || (input.forwardMove > 0 && lookY > 0.15));
        this.ladderZone = activeZone;

        if (this.onLadder) {
            this.updateLadder(dt, input, viewForward, viewRight, viewFull, collider);
            return;
        }
        if (wasOnLadder && this.lastClimb > 0) {
            // climbed off the top: nudge up and forward so we land on the ledge
            this.velocity.y = Math.max(this.velocity.y, 140);
            this.velocity.addScaledVector(viewForward, 90);
            this.lastClimb = 0;
        }

        // Sleep when idle on the ground: skip gravity/collision entirely so the
        // contact-bias depenetration can't slowly drift the player (worst on
        // ledges, where the pushout direction isn't vertical)
        const wantsMove = input.forwardMove !== 0 || input.sideMove !== 0 || input.jump;
        if (this.onGround && !wantsMove && Math.hypot(this.velocity.x, this.velocity.z) < 2) {
            this.velocity.set(0, 0, 0);
            return;
        }

        let wishspeed = CS2.maxspeed;
        if (input.duck) wishspeed *= CS2.crouchFactor;
        else if (input.walk) wishspeed *= CS2.walkFactor;

        _wishdir.set(0, 0, 0)
            .addScaledVector(viewForward, input.forwardMove)
            .addScaledVector(viewRight, input.sideMove);
        if (_wishdir.lengthSq() > 0) _wishdir.normalize();

        // Friction (ground only)
        if (this.onGround) {
            const speed = Math.hypot(this.velocity.x, this.velocity.z);
            if (speed > 0.1) {
                const control = Math.max(speed, CS2.stopspeed);
                const drop = control * CS2.friction * dt;
                const scale = Math.max(0, speed - drop) / speed;
                this.velocity.x *= scale;
                this.velocity.z *= scale;
            } else {
                this.velocity.x = 0;
                this.velocity.z = 0;
            }
        }

        // Accelerate
        if (this.onGround) {
            this.accelerate(_wishdir, wishspeed, CS2.accelerate, dt);
        } else {
            const cappedSpeed = Math.min(wishspeed, CS2.airSpeedCap);
            this.airAccelerate(_wishdir, wishspeed, cappedSpeed, CS2.airaccelerate, dt);
        }

        // Jump
        if (input.jump && this.onGround) {
            this.velocity.y = CS2.jumpImpulse;
            this.onGround = false;
        }

        // Gravity — while grounded keep a small downward bias so the capsule
        // stays in contact with the floor (prevents onGround flicker)
        if (this.onGround) {
            this.velocity.y = -CS2.gravity * dt;
        } else {
            this.velocity.y = Math.max(this.velocity.y - CS2.gravity * dt, -3500);
        }

        // Integrate + collide in substeps so fast falls can't tunnel
        // through thin geometry (substep displacement stays under half a radius)
        if (collider) {
            const moveLen = this.velocity.length() * dt;
            const steps = Math.max(1, Math.min(8, Math.ceil(moveLen / (CS2.hullRadius * 0.5))));
            const sdt = dt / steps;
            for (let i = 0; i < steps; i++) {
                this.position.addScaledVector(this.velocity, sdt);
                this.collide(collider, sdt);
            }
        } else {
            this.position.addScaledVector(this.velocity, dt);
        }

        // Safety: fell out of the world
        if (this.position.y < -10000) {
            this.velocity.set(0, 0, 0);
            this.position.y = 500;
        }
    }

    // Ladder movement: W climbs toward where you look (up if looking up, down
    // if looking down), S the opposite; SPACE jumps off the ladder.
    // Climbing moves vertically WITHOUT capsule collision — the capsule would
    // snag on the ladder rungs and crawl at a fraction of the speed.
    updateLadder(dt, input, viewForward, viewRight, viewFull, collider) {
        this.onGround = false;

        if (input.jump) {
            // push off in view direction
            this.velocity.copy(viewFull || viewForward).multiplyScalar(230);
            this.velocity.y = Math.max(this.velocity.y, 160);
            this.onLadder = false;
            this.lastClimb = 0;
            this.position.addScaledVector(this.velocity, dt);
            if (collider) this.collide(collider, dt);
            return;
        }

        const lookY = viewFull ? viewFull.y : 0.5;
        const climbDir = lookY > -0.25 ? 1 : -1; // looking down -> W descends
        const climb = input.forwardMove * climbDir * CS2.ladderSpeed;
        this.velocity.set(0, climb, 0);
        this.lastClimb = climb;
        this.position.y += climb * dt;

        // Reached the bottom of the ladder volume while descending: hand back
        // to normal physics so the capsule lands on the floor (never below it)
        if (climb < 0 && this.ladderZone && this.position.y <= this.ladderZone.min.y + 4) {
            this.position.y = this.ladderZone.min.y + 4;
            this.velocity.set(0, 0, 0);
            this.onLadder = false;
            this.lastClimb = 0;
        }
    }

    accelerate(wishdir, wishspeed, accel, dt) {
        const currentspeed = this.velocity.dot(wishdir);
        const addspeed = wishspeed - currentspeed;
        if (addspeed <= 0) return;
        const accelspeed = Math.min(accel * wishspeed * dt, addspeed);
        this.velocity.addScaledVector(wishdir, accelspeed);
    }

    airAccelerate(wishdir, wishspeed, cappedSpeed, accel, dt) {
        const currentspeed = this.velocity.dot(wishdir);
        const addspeed = cappedSpeed - currentspeed;
        if (addspeed <= 0) return;
        const accelspeed = Math.min(accel * wishspeed * dt, addspeed);
        this.velocity.addScaledVector(wishdir, accelspeed);
    }

    // Push the player capsule out of the merged map BVH.
    collide(collider, dt) {
        const radius = CS2.hullRadius;
        // Capsule segment from bottom sphere center to top sphere center
        _tempSegment.start.copy(this.position).setY(this.position.y + radius);
        _tempSegment.end.copy(this.position).setY(this.position.y + this.hullHeight - radius);

        _tempBox.makeEmpty();
        _tempBox.expandByPoint(_tempSegment.start);
        _tempBox.expandByPoint(_tempSegment.end);
        _tempBox.min.addScalar(-radius);
        _tempBox.max.addScalar(radius);

        collider.geometry.boundsTree.shapecast({
            intersectsBounds: box => box.intersectsBox(_tempBox),
            intersectsTriangle: tri => {
                const distance = tri.closestPointToSegment(_tempSegment, _triPoint, _capsulePoint);
                if (distance < radius) {
                    const depth = radius - distance;
                    _delta.subVectors(_capsulePoint, _triPoint).normalize();
                    _tempSegment.start.addScaledVector(_delta, depth);
                    _tempSegment.end.addScaledVector(_delta, depth);
                }
            },
        });

        // New feet position from the adjusted capsule
        _tempVector.copy(_tempSegment.start).setY(_tempSegment.start.y - radius);
        _tempVector2.subVectors(_tempVector, this.position); // total pushout

        this.lastPush.copy(_tempVector2);

        // Grounded if the resolver pushed us upward against gravity
        this.onGround = _tempVector2.y > Math.abs(dt * this.velocity.y * 0.25);

        this.position.copy(_tempVector);

        if (!this.onGround) {
            // Sliding along walls/ceilings: remove velocity into the surface
            const pushLen = _tempVector2.length();
            if (pushLen > 1e-5) {
                _tempVector2.normalize();
                const into = this.velocity.dot(_tempVector2);
                if (into < 0) this.velocity.addScaledVector(_tempVector2, -into);
            }
        }
    }
}
