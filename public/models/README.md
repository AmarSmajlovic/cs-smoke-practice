# Models Folder

## smoke_grenade.glb

The real CS2 smoke grenade, extracted from the game files:
`weapons/models/grenade/smokegrenade/weapon_smokegrenade.vmdl_c`

Used for both the viewmodel (`main.js`) and the thrown projectile (`grenades.js`).

**Do not replace this by hand.** It comes out of the pipeline documented in
`MAP_GUIDE.md` → "Modeli", and it needs `tools/optimize-model.mjs --fix-orm` —
without that flag VRF's channel-swapped ORM makes the grenade render black.

Meshopt-compressed, so any loader for it needs `.setMeshoptDecoder(MeshoptDecoder)`.
