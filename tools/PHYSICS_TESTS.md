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

## Poznato ograničenje

Jumpthrowovi promašuju (median ~250u). Stvarna početna brzina granate za skok je
~910 u/s, a model iz `throwSpeed + velInherit` ne prelazi ~730 — CS2 jumpthrow
ima boost koji model ne zna. Sweep `velInherit`/release daje šum, ne basen, pa to
nije podesivo bez mjerenja na više demoa. Bacanja iz mjesta i u kretanju su ~20-23u.
