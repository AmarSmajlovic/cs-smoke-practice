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

    // Grenade projectile — speed/bias calibrated on the csnades "Stairs from
    // A Ramp" reference (standing Left Click, machine setpos): it pins the
    // throw speed with no jump-inherit degeneracy. First touch lands 10u,
    // rest 15u from reference with 685/bias 8.
    nadeBaseThrowSpeed: 685,    // CSGO code says 750*0.9=675; CS2 measures ~685 on two machine references (stairs 11u, ramp roof 2u)
    nadeGravityScale: 0.4,      // grenade projectiles use 0.4 * sv_gravity
    nadeElasticity: 0.45,       // bounce: tangential (along-surface) speed kept
    nadeElasticityVert: 0.45,  // uniform per Valve code (kept as a GUI knob)   // bounce: normal (out of surface) restitution
    // CS2 is subtick: a jumpthrow bind releases ~60ms after the jump, between
    // our 64Hz ticks — the scripted jumpthrow uses this exact time for the
    // inherited velocity (calibrated on the cs2utils window smoke)
    jumpthrowReleaseTime: 0.125,
    nadeVelInherit: 1.25,        // player velocity added to the throw. CSGO used
                                // 1.25; CS2 nerfed it — calibrated against the
                                // cs2utils window jumpthrow (first touch lands
                                // 5u from reference with 1.0 + instant release)
    nadeBounceVyCap: 200,       // max upward speed after a bounce — Source
                                // grenades never rebound high even from huge
                                // falls ("3 small hops" on rooftop landings)
    nadeRadius: 2,              // projectile collision radius
    nadeSpawnForward: 16,       // spawn distance in front of the eyes
    nadePitchBias: 10,           // degrees thrown above the crosshair when aiming
                                // level (calibrated with the throw speed)

    // Smoke cloud
    smokeRadius: 144,
    smokeDurationMs: 19700,
};

// Live-tunable copies for the debug GUI (calibration against in-game throws).
export const tuning = {
    throwSpeed: CS2.nadeBaseThrowSpeed,
    nadeGravityScale: CS2.nadeGravityScale,
    elasticity: CS2.nadeElasticity,
    elasticityVert: CS2.nadeElasticityVert,
    velInherit: CS2.nadeVelInherit,
};
