# SMOKEPRACTICE

**Practice CS2 smoke lineups in your browser — no game needed.**

Live at **[smokepractice.com](https://smokepractice.com)**

A free practice sandbox: throw smoke grenades on real CS2 map geometry with
physics calibrated against actual match demos. Jumpthrow binds, trajectory
trails, saveable/shareable lineups, and full CS2 console interop
(`setpos`/`setang` strings paste right in). Works on desktop and mobile.

## Features

- **Demo-calibrated physics** — throw speed, per-axis velocity inheritance,
  bounce elasticity and jumpthrow release timing were fitted against grenade
  trajectories parsed from real CS2 demos (see `tools/`)
- **Source-style movement** — friction / accelerate / air control with real
  CS2 values (245 u/s with a nade out, 64 Hz fixed tick)
- **Jumpthrow on one key** — tick-consistent release like a real bind, plus a
  peak-jumpthrow variant
- **Lineup tools** — every throw leaves a trail, a picture-in-picture cam
  follows the nade, and an aim solver can compute the exact pitch/yaw to land
  a smoke on a marked spot
- **CS2 console interop** — press P to copy your position as a
  `setpos ...; setang ...` string; paste any such string (cs2utils.com,
  a friend's getpos) to teleport to it
- **Share lineups as links** — no account, stored in localStorage

## Development

```bash
npm install
npm run dev
```

### A note on game assets

The map geometry and viewmodel/grenade models are extracted from
Counter-Strike 2 and remain Valve's property, so they are not part of the
git history — the app loads them from this repo's release assets
(`ASSET_BASE` in `physicsConfig.js`), and they will be removed immediately
on request from the rights holder. The extraction pipeline for adding more
maps (Source 2 Viewer → glTF → optimization scripts in `tools/`) is
documented in [`MAP_GUIDE.md`](MAP_GUIDE.md).

## Physics calibration

The interesting part of this project lives in `tools/`: scripts that parse
real CS2 demos (demoparser2 / demoinfocs-golang), extract grenade launch
velocities and bounce pairs, and fit the physics constants against them.
`tools/PHYSICS_TESTS.md` describes the verification gate — lineups thrown in
the app are compared against where they land in the real demos.

## Contributing

Issues and PRs welcome. The most valuable reports are lineups that land
differently than in-game — include the position string (press P in game)
and what you expected.

## License

[GPL-3.0](LICENSE). Not affiliated with, endorsed by, or sponsored by Valve
Corporation. Counter-Strike, CS2 and all related assets are trademarks
and/or property of Valve Corporation; this is a free, non-commercial
fan-made practice tool.
