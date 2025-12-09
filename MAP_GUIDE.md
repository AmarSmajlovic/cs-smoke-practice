# How to Import CS2 Maps

## Option 1: Use Pre-converted Maps (Easiest)

1. Search for "CS2 map GLTF" or "CS2 map GLB" online
2. Download the map file (e.g., `dust2.glb`, `mirage.glb`)
3. Create a `public/maps/` folder in your project
4. Place the map file there: `public/maps/dust2.glb`
5. Update `main.js` line with the correct filename:
   ```js
   await mapLoader.loadMap('/maps/dust2.glb');
   ```

## Option 2: Convert CS2 Maps Yourself

### Tools Needed:
- **GCFScape** - Extract CS2 game files
- **Blender** - 3D modeling software
- **Blender Source Tools** - Import VMF/BSP files

### Steps:

1. **Extract CS2 Map Files**
   - Install GCFScape
   - Navigate to CS2 installation: `Steam/steamapps/common/Counter-Strike Global Offensive/game/csgo/`
   - Open `pak01_dir.vpk` with GCFScape
   - Navigate to `maps/` folder
   - Extract the `.bsp` file you want (e.g., `de_dust2.bsp`)

2. **Convert BSP to GLTF in Blender**
   - Install Blender (free)
   - Install "Blender Source Tools" addon
   - In Blender: File → Import → Source Engine (.bsp, .mdl, .smd, .qc, .vta, .dmx)
   - Select your extracted `.bsp` file
   - Wait for import (can take a while)
   - Simplify geometry if needed (CS2 maps are very detailed)
   - File → Export → glTF 2.0 (.glb)
   - Save as `dust2.glb`

3. **Optimize the Map**
   - CS2 maps are huge - you may need to:
     - Delete unnecessary details
     - Reduce polygon count
     - Remove invisible geometry
     - Bake textures to smaller sizes

4. **Place in Project**
   - Put the `.glb` file in `public/maps/`
   - Update the map path in `main.js`

## Option 3: Use Community Resources

Check these sites for pre-made CS2 map exports:
- Sketchfab (search "CS2" or "CSGO maps")
- GitHub (search "CS2 map gltf")
- GameBanana

## Quick Test

For now, the project will use a placeholder map. Once you have a real CS2 map:

1. Place it in `public/maps/your-map.glb`
2. Update `main.js`:
   ```js
   await mapLoader.loadMap('/maps/your-map.glb');
   ```
3. Refresh the browser

## Troubleshooting

- **Map too big**: Reduce polygon count in Blender
- **Textures missing**: Make sure textures are embedded in GLB
- **Map not loading**: Check browser console for errors
- **Wrong scale**: Adjust scale in Blender before export (CS2 uses Source engine units)

## Recommended Starting Map

Start with **de_dust2** - it's iconic and relatively simple compared to newer maps.
