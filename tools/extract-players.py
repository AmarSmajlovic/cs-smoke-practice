#!/usr/bin/env python3.12
# All-player positions at each smoke-throw tick, per demo — lets the harness
# drop throws whose path crosses a player (we don't model player collision).
#   python3.12 tools/extract-players.py
import json
import glob
import os

import pandas  # noqa: F401  (must precede demoparser2 — see demo-extract.py)
from demoparser2 import DemoParser

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

for pf in sorted(glob.glob(os.path.join(ROOT, "tools/demo-data/**/*.pairs.json"), recursive=True)):
    base = os.path.basename(pf).replace(".pairs.json", "")
    of = os.path.join(os.path.dirname(pf), base + ".players.json")
    if os.path.exists(of) and os.path.getmtime(of) >= os.path.getmtime(pf):
        print("skip (up to date):", base)
        continue
    dem = os.path.join(ROOT, "public/demos", base + ".dem")
    if not os.path.exists(dem):
        print("SKIP (no demo):", base)
        continue
    pairs = json.load(open(pf))
    ticks = sorted({p["throw_tick"] for p in pairs})
    parser = DemoParser(dem)
    df = parser.parse_ticks(["X", "Y", "Z"], ticks=ticks)
    out = [
        {"tick": int(r["tick"]), "name": str(r["name"]),
         "X": float(r["X"]), "Y": float(r["Y"]), "Z": float(r["Z"])}
        for _, r in df.iterrows()
    ]
    json.dump(out, open(of, "w"))
    print(base, "->", len(out), "player samples @", len(ticks), "ticks")
