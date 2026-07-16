# Fizika: automatski testovi na stvarnim CS2 podacima

Regresijski i kalibracijski testovi granate voze **stvarni** `GrenadeSystem` i
`MapLoader` (ne kopiju fizike) protiv ground trutha izvučenog iz pro demoa.
Jedan prolaz je ~0.5s, pa "loop dok svi ne prođu" ide u čistom Node-u.

## Pipeline

```
CS2 demo (.dem)
  ├─ tools/demo-extract.py   → tools/mirage_pairs.json   (bacanje → mjesto pada, 112 parova)
  └─ tools/demo-traj/        → tools/smoke_traj.json      (putanja svake granate, tik-po-tik + odbijanja)
                                     ↓
                          tools/*.mjs (voze grenades.js + mapLoader.js)
```

`mirage_pairs.json` se commituje (34 KB, ground truth). Demo (257 MB),
`smoke_traj.json` (10 MB) i Go binary su gitignored — regenerišu se:

```bash
# tačke pada (Python 3.11/3.12 — demoparser2 nije stabilan na 3.14)
python3.12 -m venv env && ./env/bin/pip install "demoparser2" "pandas<3"
./env/bin/python tools/demo-extract.py public/demos/<demo>.dem tools/mirage_pairs.json

# putanje + odbijanja (Go, stabilno, ~11s)
cd tools/demo-traj && go build -o demotraj . && ./demotraj ../../public/demos/<demo>.dem ../smoke_traj.json
```

## Skripte

| skripta | šta radi |
|---|---|
| `physics-test.mjs`   | glavni gate: greška do stvarne detonacije, po vrsti bacanja |
| `physics-filter.mjs` | izbacuje bacanja čija putanja prolazi kroz igrača (kontaminirana) |
| `bounce-measure.mjs` | mjeri restituciju odbijanja iz putanja |
| `physics-calib.mjs`  | sweep jumpthrow parametara |
| `physics-speed.mjs`  | mjeri impliciranu brzinu bacanja po uglu |
| `harness.mjs`        | zajednička osnova (učitavanje kolizije, throwFrom, simulateToRest) |

## Šta su podaci pokazali (mjereno, ne pogađano)

- **Brzina bacanja 685 tačna** — 73 nezavisna bacanja, bez zavisnosti od pitcha.
- **Restitucija 0.45 tačna** i za normalu i za tangentu (361 odbijanje), i **konstantna
  po uglu upada**. Zato je uklonjen `glance²` faktor koji je gušio odskok strmih
  padova — median greške 89u → 36u, bacanja u kretanju 52% → 84% unutar 50u.
- **Koordinate:** demo je Source Z-up (x naprijed); app Y-up. `naš x = game y`,
  `naš z = game x`, visina ista (isto preslikavanje kao setpos import).

## Jumpthrow — dijagnoza na 4 demoa (113 jumpthrowova)

Median ~256u, ALI fizika NIJE kriva. Utvrđeno mjerenjem iz putanja:
- **Launch intenzitet OK:** inherit **1.3** (mjereno — ostatak `v0 − 1.3·vPlayer`
  najčistije sjeda na 685). Zato je velInherit 1.25→1.3.
- **Launch smjer OK:** pitch bias 7.3° = isti kao stoji/kretanje, yaw greška 0°.
- **`jumpthrow-replay.mjs`: sa STVARNOM launch iz putanje, jumpthrow sleti 22u** —
  isto kao obična bacanja. Let/odbijanje/kotrljanje rade i za strme visoke lukove.
- Krivac: **rekonstrukcija trenutka otpuštanja.** Granata napusti ruku par tikova
  nakon eventa (player je već skočio više) → launch pozicija -22u/-33u; u strmom
  luku se to pojača ~8×. A pro igrači koriste RAZLIČITE jumpthrow tehnike, pa
  tajming varira od bacanja do bacanja — nema jedne konstante (svaki release/
  velInherit sweep = šum). Zato se jumpthrow NE može univerzalno rekonstruisati iz
  (setpos, setang, strength); treba app da replicira JEDAN konzistentan bind, što
  je zaseban problem od kalibracije fizike — verifikovati kontrolisano (isti bind
  u CS2 i u appu), ne iz raznolikih demoa.

Bacanja iz mjesta i u kretanju: **22u median, 86% unutar radijusa dima** (272
bacanja, 4 demoa).

## Više demoa

`harness.loadAllPairs()` spaja sve `tools/demo-data/*.pairs.json`. `jumpthrow-*.mjs`
rade preko svih demoa. Pairs se commituju (mali), `.traj.json` su gitignored
(regeneriši Go parserom).
