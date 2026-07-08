# Kako dodati CS2 mapu

Pipeline: CS2 fajlovi → Source 2 Viewer (glTF export) → `tools/optimize-map.mjs` → app.

## 1. Nabavi CS2 map fajl

**Ako imaš CS2 instaliran (PC):** mapa je u
`Steam/steamapps/common/Counter-Strike Global Offensive/game/csgo/maps/de_<mapa>.vpk`

**Ako nemaš:** CS2 je free-to-play, pa se pojedinačni fajl može skinuti sa Steam servera
(alat je već u `tools/depotdownloader/`):

```bash
cd tools
# uredi filelist.txt (npr. regex:game/csgo/maps/de_dust2\.vpk)
./depotdownloader/DepotDownloader -app 730 -depot 2347770 -filelist filelist.txt -dir cs2files -qr
# -qr = login skeniranjem QR koda Steam Mobile aplikacijom
```

## 2. Exportuj u glTF (Source 2 Viewer)

GUI verzija (Windows) ili CLI (već u `tools/vrf/`):

```bash
./tools/vrf/Source2Viewer-CLI -i de_mirage.vpk -e "maps/de_mirage/world.vmap_c" -o export -d
```

Rezultat: `de_<mapa>_d.glb` + gomila PNG tekstura u istom folderu (300-500MB).
Sirove exporte drži u `map-sources/` (gitignored, NE u `public/`!).

## 3. Optimizuj za web

```bash
node tools/optimize-map.mjs map-sources/de_mirage/de_mirage_d.glb public/maps/mirage.glb --texsize 1024 --ratio 1.0
```

- ~430MB → ~35MB: teksture u WebP 1024px, samo color mape, meshopt kompresija,
  spajanje mesheva po materijalu (3400 → ~370 draw calls)
- `--ratio` < 1 uključuje simplifikaciju geometrije — OPREZ: ispod ~0.8 zna
  pojesti zidove/podove (rupe!), zato je default preporuka 1.0
- Skript automatski briše blocklight/shadowmesh utility geometriju

## 4. Registruj mapu

U `mapLoader.js` dodaj u `MAPS`:

```js
mirage: { path: '/maps/mirage.glb', scale: 1 / 0.0254, zUp: false },
```

- VRF exportuje u metrima → `scale: 1/0.0254` vraća u Hammer jedinice (tačno 1:1)
- Za mape nepoznatog porijekla (Sketchfab ripovi): umjesto `scale` daj
  `targetSize: <širina mape u HU>` pa kalibriši kroz GUI
- Baked svjetla iz GLB-a (sunce intenziteta 2000+!) loader automatski uklanja

## Poznata ograničenja

- VRF `_physics.glb` sadrži samo entitete (buyzone, propovi), NE world koliziju —
  zato se collider gradi iz vizuelne geometrije (BVH build ~8s pri učitavanju)
- Blend materijali (podovi) prikazuju samo prvi layer teksture
- Vegetacija se renderuje tamno (alpha/tint problem) — kozmetički
