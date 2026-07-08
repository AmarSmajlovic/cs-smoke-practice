// CS2 constants — everything in Hammer units (1 unit = 0.75 inch... actually 1u = 1/16 ft).
// The world is scaled so 1 world unit == 1 Hammer unit, so these apply directly.

export const CS2 = {
    TICK: 1 / 64,               // CS2 tick rate (sub-tick aside, physics is 64/s)

    // Player movement (sv_* defaults)
    gravity: 800,               // sv_gravity
    friction: 5.2,              // sv_friction
    stopspeed: 80,              // sv_stopspeed
    accelerate: 5.5,            // sv_accelerate
    airaccelerate: 12,          // sv_airaccelerate
    airSpeedCap: 30,            // wishspeed cap while airborne (Source air control)
    maxspeed: 245,              // run speed holding a grenade (knife = 250)
    walkFactor: 0.52,           // +speed (shift) modifier
    crouchFactor: 0.34,         // crouch modifier
    jumpImpulse: 301.993,       // vertical velocity on jump

    ladderSpeed: 150,           // vertical climb speed on ladders

    // Player hull / eyes
    hullRadius: 16,             // player hull is 32x32
    hullHeightStand: 72,
    hullHeightCrouch: 54,
    eyeStand: 64.093,
    eyeCrouch: 46.076,

    // Grenade projectile
    nadeBaseThrowSpeed: 675,    // 750 (weapon ThrowVelocity) * 0.9
    nadeGravityScale: 0.4,      // grenade projectiles use 0.4 * sv_gravity
    nadeElasticity: 0.45,       // bounce energy retained
    nadeVelInherit: 1.25,       // player velocity added to throw (jumpthrow bonus)
    nadeRadius: 2,              // projectile collision radius
    nadeSpawnForward: 16,       // spawn distance in front of the eyes
    nadePitchBias: 10,          // degrees thrown above the crosshair when aiming level

    // Smoke cloud
    smokeRadius: 144,
    smokeDurationMs: 19700,
};

// Live-tunable copies for the debug GUI (calibration against in-game throws).
export const tuning = {
    throwSpeed: CS2.nadeBaseThrowSpeed,
    nadeGravityScale: CS2.nadeGravityScale,
    elasticity: CS2.nadeElasticity,
    velInherit: CS2.nadeVelInherit,
};
