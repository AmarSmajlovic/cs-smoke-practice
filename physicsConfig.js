// CS2 constants — everything in Hammer units (1 unit = 0.75 inch... actually 1u = 1/16 ft).
// The world is scaled so 1 world unit == 1 Hammer unit, so these apply directly.

// Source 2 Viewer exports glTF in meters, at 0.0254 m per Hammer unit. Anything
// coming out of the VRF pipeline — maps, models — needs this to land in HU.
export const VRF_SCALE = 1 / 0.0254;

// The grenade canister is bare metal, so it draws its colour from reflected
// environment rather than from the lights. Shared by the viewmodel and the
// thrown projectile so they don't drift apart.
export const GRENADE_ENV_INTENSITY = 2.5;

// CS2-extracted binaries (maps, viewmodel, grenade) are committed in
// public/maps + public/models and served same-origin by Vercel — the old
// public smokepractice-assets CDN repo went private with the source.

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
    nadeBaseThrowSpeed: 675,    // Valve's 750*0.9. An earlier 685 came from two
                                // hand references, but against the full demo set
                                // 675 wins decisively (standing p90 426u->78u,
                                // <=50u 61%->87%) and reproduces the csnades
                                // "Jungle from Back Alley" roof-bounce path that
                                // 685 clears by 1-2u.
    nadeGravityScale: 0.4,      // grenade projectiles use 0.4 * sv_gravity
    nadeElasticity: 0.45,       // bounce: tangential (along-surface) speed kept
    nadeElasticityVert: 0.45,  // uniform per Valve code (kept as a GUI knob)   // bounce: normal (out of surface) restitution
    // HARD impacts lose far more, and the trigger is the NORMAL component of
    // the impact velocity, not total speed: real demo bounces (isolated
    // contacts, tools/bounce-speed.mjs binned by vzIn) keep tang/norm 0.45 up
    // to ~450 u/s into the surface, but only ~0.28-0.29 above ~500 (n=101).
    // Fast glancing skims (running throws: 900+ u/s total, small normal) keep
    // the full 0.45 — binning by total speed mixes the two and breaks moving
    // throws. Without this, steep fast falls (a roof bounce at vzIn ~750)
    // skip hundreds of units too far after the first touch.
    nadeElasticityHot: 0.29,
    nadeHotSpeedStart: 450,     // full 0.45 below this normal impact speed
    nadeHotSpeedEnd: 550,       // full 0.29 above this
    // Inherited player velocity: uniform 1.25 (Valve's constant). Confirmed
    // two independent ways on the demo launch velocities: 98 moving ground
    // throws pin the horizontal at 1.25 (12 u/s median, sharp minimum), and
    // the 113 jumpthrows' vertical boost of ~257 u/s is exactly
    // 1.25 * (jumpImpulse - gravity * 0.1225) — i.e. the same 1.25 applied to
    // the player's velocity at the release moment.
    nadeVelInheritH: 1.25,
    nadeVelInheritZ: 1.25,
    // A jumpthrow bind releases ~0.1075s after the jump input (measured by
    // back-integrating demo trajectories to their spawn: release sits
    // ~96-123ms after the jump; release time and throw speed are coupled, so
    // they are fit together). BOTH the spawn position and the inherited
    // velocity come from the player state at this moment. 0.1075 is the joint
    // optimum of the 113-jumpthrow demo sweep (median 28u, 70% within 50u —
    // the pure-demo minimum 0.105 scores 25u/71%, inside noise) AND the two
    // csnades machine references, which are razor-sensitive to launch height:
    // "Jungle from Back Alley" (roof graze, 18u) and "Window from Back Alley
    // B" (ledge touch -> rests ON the box at z -92, 22u). At 0.105 the window
    // throw clears the ledge by ~5u and falls under into the tunnel instead.
    jumpthrowReleaseTime: 0.1075,
    nadeBounceVyCap: 230,       // max upward speed after a bounce — Source
                                // grenades never rebound high even from huge
                                // falls ("3 small hops"). Demo hot bounces
                                // read vzOut median ~233; 235+ verifiably
                                // breaks the window-box reference, and 200
                                // (the old safe pick) killed the csnades
                                // "Left Arch from Back Alley" wall bounce,
                                // which needs >=230 to carry over the roof
                                // and drop onto short (lands 25u from the
                                // reference at 230). 230 satisfies all three.
    // Reference-calibrated bounce planes. Where a marquee lineup video's
    // measured trajectory demonstrably deviates from the flat physics-hull
    // face (the csnades "Left Arch from Back Alley" wall bounce leaves ~1-2
    // deg right of the pure mirror — P-verified touch point; demo wall
    // bounces are exact mirrors, median 0.01 deg, so this is specific to the
    // reference, not a global effect), the bounce uses this measured normal
    // instead of the axis-snapped one. App coords; normal yawed -0.5 deg
    // (full P-touch fit wants -1.0 deg, but that puts the touchdown 2u from
    // the plateau ledge and drags the rest point off the video's smoke spot
    // — -0.5 splits the difference; tune with tools/leftarch-plane-sweep).
    nadeClipPlanes: [
        {   // Back Alley arch wall panel, game y=631, x -895..-835, z 140..260
            minX: 620, maxX: 645, minY: 140, maxY: 260, minZ: -895, maxZ: -835,
            nx: -0.99996, ny: 0, nz: -0.00873,
        },
        {   // Underpass floor by the short arches: the exported hull goes flat
            // at game y<255 but the real 8.8-deg downhill (-y) ramp reaches the
            // touch point of the top-mid "spin" reference (steep fall hooks
            // ~46 deg left and carries onto short, P-verified rest 3u off).
            // Normal = the measured tilt of the adjacent exported slope face.
            minX: 238, maxX: 262, minY: -178, maxY: -160, minZ: -1130, maxZ: -1085,
            nx: -0.15303, ny: 0.98822, nz: 0,
        },
    ],
    nadeRadius: 2,              // projectile collision radius
    nadeGlassSlow: 1.0,         // speed kept when smashing breakable glass.
                                // Was 0.9, but the csnades "Window from Back
                                // Alley B" reference (glass intact, lands ON
                                // the box) only reproduces with ~no slowdown —
                                // and the headless harness has no breakables,
                                // so the demo calibration never priced one in.
    // Medium throw (LMB+RMB / standing shift+F / MED button). Valve's nominal
    // power is 0.5, but the reference lineup "setpos 814.97 -1548.99 -44.97;
    // setang -4.90 -178.50" lands a hair long at 0.5 against the in-game
    // throw; 0.49 pulls the rest point 5.2u (~10cm) shorter there
    // (tools/medium-lineup-probe.mjs sweeps the strength for that setpos).
    // The demo harness keeps scoring against nominal 0.5 (harness STRENGTHS).
    nadeMediumStrength: 0.49,
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
    velInheritH: CS2.nadeVelInheritH,
    velInheritZ: CS2.nadeVelInheritZ,
};
