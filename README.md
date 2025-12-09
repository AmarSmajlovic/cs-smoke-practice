# CS2 Smoke Practice

A Three.js-based CS2 smoke practice tool with first-person movement.

## Setup

```bash
npm install
npm run dev
```

Then open your browser to the URL shown (usually http://localhost:5173)

## Controls

- **WASD** - Move around
- **Mouse** - Look around (click to lock pointer)
- **ESC** - Unlock pointer

## Next Steps

1. Import actual CS2 map geometry (GLTF/GLB format)
2. Add smoke grenade mechanics
3. Add trajectory visualization
4. Add lineup markers
5. Add smoke simulation

## Map Import

**See MAP_GUIDE.md for detailed instructions**

Quick steps:
1. Get a CS2 map in GLB/GLTF format
2. Place in `/public/maps/` folder (e.g., `public/maps/dust2.glb`)
3. Update the map name in `main.js` if needed
4. Refresh browser

The project will use a placeholder map if no CS2 map is found.
