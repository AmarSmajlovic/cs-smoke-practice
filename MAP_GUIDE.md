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
./tools/vrf/Source2Viewer-CLI -i tools/cs2files/game/csgo/maps/de_dust2.vpk \
  -f "maps/de_dust2.vmap_c" -o map-sources/de_dust2-export \
  -d --gltf_export_format glb --gltf_export_materials --gltf_textures_adapt
```

Rezultat: `maps/de_<mapa>.glb` + gomila PNG tekstura (300-500MB).
Sirove exporte drži u `map-sources/` (gitignored, NE u `public/`!).

ZAMKE (obje su pojele po sat vremena na dust2):

- **`-f` je filepath filter, `-e` su EKSTENZIJE** — sa `-e "maps/..."` CLI tiho
  ne exportuje ništa (exit 0, prazan output). Vmap je na
  `maps/de_<mapa>.vmap_c` (root), ne `maps/de_<mapa>/world.vmap_c`.
- **Teksture mapa NISU u map vpk-u** — žive u `pak01_NNN.vpk` chunkovima, i CLI
  ih montira SAMO ako nađe `gameinfo.gi` (tools/cs2files/game/csgo/gameinfo.gi —
  minimalni ručno pisani, mounta `Game csgo`). Bez njega export prođe "uspješno"
  ali sa 0 tekstura i magenta materijalima. Koje chunkove skinuti: pokreni
  export bez tekstura, pokupi `Failed to load "...vmat_c"` iz punog loga,
  mapiraj na `fnumber` iz `pak01_dir.vpk --vpk_dir` listinga (+ vtex sa "color"
  u imenu iz istih direktorija — optimizer ionako baca sve osim color mapa).
  dust2+inferno unija: 191 chunkova ~20GB (`tools/filelist-textures.txt`).
- **`world_physics.vmdl_c` se exportuje zasebno** (isti `-f` princip) pa pakuje
  sa `tools/pack-collision.mjs` u `public/maps/<mapa>-collision.glb`.
- **Spawnovi**: dump `maps/de_<mapa>/entities/default_ents.vents_c` (isti -f/-d),
  parsiraj `info_player_*` sa `priority 0` + `enabled true`; app x = game Y,
  app z = game X, yaw = game yaw.

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

## Modeli (oružje, granate)

Isti pipeline, ali modeli NISU samostalni fajlovi — žive u `pak01_dir.vpk`, a podaci
su razbacani po `pak01_NNN.vpk` chunkovima. Ne skidaj sve (desetine GB), nego:

```bash
cd tools
# 1. samo index (~3MB)
echo 'regex:game/csgo/pak01_dir\.vpk' > filelist-nade.txt
./depotdownloader/DepotDownloader -app 730 -depot 2347770 -filelist filelist-nade.txt -dir cs2files -qr

# 2. nađi model i njegov chunk — "fnumber" JE broj chunka
./vrf/Source2Viewer-CLI -i cs2files/game/csgo/pak01_dir.vpk --vpk_dir -f "models/weapons" | grep -i smoke

# 3. skini samo potrebne chunkove (model + materijali + teksture su u različitim!)
echo 'regex:game/csgo/pak01_(140|166|185|229|262|283)\.vpk' > filelist-nade.txt
./depotdownloader/DepotDownloader -app 730 -depot 2347770 -filelist filelist-nade.txt -dir cs2files -qr

# 4. export
./vrf/Source2Viewer-CLI -i cs2files/game/csgo/pak01_dir.vpk \
  -f "weapons/models/grenade/smokegrenade/" -o ../map-sources/nade \
  -d --gltf_export_format glb --gltf_export_materials --gltf_textures_adapt

# 5. optimizuj (NE optimize-map.mjs — taj baca normal/ORM mape!)
node tools/optimize-model.mjs \
  map-sources/nade/weapons/models/grenade/smokegrenade/weapon_smokegrenade.glb \
  public/models/smoke_grenade.glb --texsize 512 --fix-orm
```

Smoke granata: `weapons/models/grenade/smokegrenade/weapon_smokegrenade.vmdl_c`
(CS2 nema odvojen v_model — isti model je i viewmodel i world model).

## Ruke, rukavice i animacije (viewmodel)

```bash
cd tools
# chunkovi za glove_fullfinger + bare_arms + viewmodel klipove
./depotdownloader/DepotDownloader -app 730 -depot 2347770 -filelist filelist-arms.txt -dir cs2files -qr

# ruke + rukavice (--gltf_export_animations NIJE opcionalan, bez njega nema kostura!)
./vrf/Source2Viewer-CLI -i cs2files/game/csgo/pak01_dir.vpk \
  -f "agents/models/shared/arms/glove_fullfinger/" -o ../map-sources/arms \
  -d --gltf_export_format glb --gltf_export_materials --gltf_textures_adapt --gltf_export_animations

# klipovi bacanja (svaki .vnmclip_c izlazi kao zaseban GLB)
./vrf/Source2Viewer-CLI -i cs2files/game/csgo/pak01_dir.vpk \
  -f "animation/anims/viewmodel/grenade/grenade_smokegrenade/" -o ../map-sources/anims \
  -d --gltf_export_format glb --gltf_export_animations

cd ..
node tools/optimize-model.mjs \
  map-sources/arms/agents/models/shared/arms/glove_fullfinger/glove_fullfinger.glb \
  public/models/arms.glb --texsize 512 --fix-orm --drop "physics|worldmodel"

A=map-sources/anims/animation/anims/viewmodel/grenade/grenade_smokegrenade
node tools/pack-anims.mjs public/models/nade_anims.glb \
  idle=$A/idle_smoke.glb draw=$A/draw_smoke.glb pullpin=$A/pullpin_smoke.glb \
  charge_high=$A/throwcharge_high_smoke.glb charge_mid=$A/throwcharge_mid_smoke.glb \
  charge_low=$A/throwcharge_low_smoke.glb throw_over=$A/throw_overhand_smoke.glb \
  throw_under=$A/throw_underhand_smoke.glb
```

Rukavica ima ~15 varijanti (`agents/models/shared/arms/glove_*`); `glove_fullfinger`
je izabrana kao default. Druga varijanta = drugi chunkovi, izlistaj ih sa `--vpk_dir`.

### Zamke kod viewmodela

- **Klip rig ≠ arms rig, a dijele imena.** U klipovima je rame `armUpperShoulder_L`,
  a `arm_upper_L` je pomoćna kost koja visi sa podlaktice; u modelu ruku
  `arm_upper_L` JESTE rame. Vezivanje po imenu naguraju animaciju pomoćne kosti na
  rame i mesh eksplodira. `pack-anims.mjs` to rješava mapom (`DROP` + `RENAME`).
- **`throwcharge_*` traju 0s** — to su jednokadarske poze koje Valveov animgraph
  blenda i drži. `pack-anims.mjs` im dodaje drugi identičan keyframe, jer
  `AnimationAction` sa nultim trajanjem se odmah završi.
- **Granata visi na kosti `wpn`, ne na šaci.** Klip je animira pravim pokretom
  otpuštanja. Njen roditelj u klipu je `root_motion` (identitet), pa prazan
  `Object3D` imena `wpn` pod korijenom riga upadne u isti okvir.
- **Rig se okreće za 180° oko Y** (`vmRot`). VRF-ova Y-up konverzija šalje Source
  +X (naprijed) u glTF +Z, a three kamera gleda niz −Z — ruke ispadnu iza glave i
  lijeva/desna zamijenjene.
- **Ugniježđeni exporti dupliraju konverziju.** Svaki VRF GLB nosi scale 0.0254 i
  onu rotaciju na korijenu. Granata pod rigom ih dobija dvaput → 0.1u speck pod
  krivim uglom. `main.js` poništava oba (`VRF_SCALE`, `nadeCancelQ`).
- **Viewmodel mora biti van `playingNow()` ograde.** Vidi se iza pause overlaya, a
  dok mixer ne prođe bar jednom stoji u bind pozi koja prekrije ekran.

### Zamke kod modela

- **`--fix-orm` je obavezan za oružja.** VRF ne može razriješiti `csgo_weapon.vfx`
  ("Failed to find shader") pa ORM pakuje kao (metalness, roughness, occlusion)
  umjesto glTF (occlusion, roughness, metalness) — model ispadne crn. Provjeri
  tako što uporediš mean svakog ORM kanala sa VRF-ovim `*_ao`/`*_rough`/`*_metal`
  PNG-ovima; ako se R poklapa sa `_metal`, export je pogođen.
- **Metal treba environment mapu.** Kanister granate je metalness ~1, a metal bez
  IBL-a renderuje crno bez obzira na svjetla. `main.js` zato postavlja
  `scene.environment` (RoomEnvironment) + `GRENADE_ENV_INTENSITY`. Mapa je sva
  Lambert pa je environment ne dotiče.
- **Skala:** isto kao mape — `VRF_SCALE` (= 1/0.0254) iz `physicsConfig.js`.
  Granata je onda 2.08 × 4.65 × 2.34 HU, što se poklapa sa `nadeRadius: 2`.
- **Orijentacija:** VRF već rotira Z-up u Y-up, model je uspravan na identitetu.
  Pozu podesi kroz Debug GUI → Viewmodel, pa prepiši `vmBase`/`vmRot`.

## Poznata ograničenja

- VRF `_physics.glb` sadrži samo entitete (buyzone, propovi), NE world koliziju —
  zato se collider gradi iz vizuelne geometrije (BVH build ~8s pri učitavanju)
- Blend materijali (podovi) prikazuju samo prvi layer teksture
- Vegetacija se renderuje tamno (alpha/tint problem) — kozmetički
