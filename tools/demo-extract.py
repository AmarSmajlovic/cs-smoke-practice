#!/usr/bin/env python3
# CS2 demo -> mirage_pairs.json: the throw/landing ground truth the physics
# harness scores against.
#
#   pip install "demoparser2" "pandas<3"     # pandas 3's Arrow strings crash it
#   python3 tools/demo-extract.py public/demos/<demo>.dem tools/mirage_pairs.json
#
# grenade_thrown carries the thrower's position, view angles and velocity;
# smokegrenade_detonate carries where the smoke popped. Each smoke throw is
# matched to the thrower's next detonation.
#
# demoparser2 segfaults if two events are parsed in one process (observed on a
# 257MB demo, both parse_event twice and parse_events plural), so each event is
# parsed in its own subprocess and joined here.
import subprocess
import sys
import json
import math

# Must precede demoparser2: its native extension corrupts memory (Rust panic /
# SIGABRT in parse_event) if pandas isn't imported before the parser is built.
import pandas  # noqa: F401

THROWN_PROPS = ["X", "Y", "Z", "pitch", "yaw", "velocity_X", "velocity_Y", "velocity_Z"]


def parse_one(demo, event):
    from demoparser2 import DemoParser
    p = DemoParser(demo)
    if event == "grenade_thrown":
        # The bare parse first is not cosmetic: parsing grenade_thrown with
        # player props as the very first call segfaults this build, while a
        # plain parse followed by the prop parse on the same object is stable.
        p.parse_event(event)
        df = p.parse_event(event, player=THROWN_PROPS)
    else:
        df = p.parse_event(event)
    # Emit the whole frame and let the parent filter in plain Python. A pandas
    # boolean mask over the Arrow-backed 'weapon' string column aborts the
    # process here (SIGABRT), so no filtering happens on this side.
    sys.stdout.write(df.to_json(orient="records"))


def main():
    # subprocess mode: parse a single event, emit JSON on stdout
    if len(sys.argv) == 4 and sys.argv[1] == "--one":
        parse_one(sys.argv[2], sys.argv[3])
        return

    if len(sys.argv) != 3:
        sys.exit("usage: demo-extract.py <demo.dem> <out.json>")
    demo, out = sys.argv[1], sys.argv[2]

    # demoparser2's native extension corrupts memory nondeterministically on
    # Python 3.14 (segfault, or a garbage-sized allocation abort) — the same
    # call succeeds on a later try. Python 3.11/3.12, which have stable
    # prebuilt wheels, are far more reliable; the retry is a fallback so 3.14
    # still gets there eventually.
    def run(event):
        for attempt in range(8):
            r = subprocess.run([sys.executable, __file__, "--one", demo, event],
                               capture_output=True, text=True)
            if r.returncode == 0 and r.stdout.strip():
                return json.loads(r.stdout)
            print(f"  {event}: attempt {attempt + 1} failed (rc={r.returncode}), retrying")
        sys.exit(f"parsing {event} failed after 8 attempts — try Python 3.11/3.12")

    thrown = [r for r in run("grenade_thrown") if r["weapon"] == "smokegrenade"]
    thrown.sort(key=lambda r: r["tick"])
    det = sorted(run("smokegrenade_detonate"), key=lambda r: r["tick"])
    print(f"smoke throws: {len(thrown)}   detonations: {len(det)}")

    pairs, used = [], set()
    for t in thrown:
        cand = [(i, d) for i, d in enumerate(det)
                if i not in used and d["user_steamid"] == t["user_steamid"] and d["tick"] > t["tick"]]
        if not cand:
            continue
        i, d = cand[0]
        used.add(i)
        pairs.append({
            "thrower": t["user_name"], "throw_tick": t["tick"], "det_tick": d["tick"],
            "px": t["user_X"], "py": t["user_Y"], "pz": t["user_Z"],
            "pitch": t["user_pitch"], "yaw": t["user_yaw"],
            "vx": t["user_velocity_X"], "vy": t["user_velocity_Y"], "vz": t["user_velocity_Z"],
            "dx": d["x"], "dy": d["y"], "dz": d["z"],
            "dist": math.hypot(d["x"] - t["user_X"], d["y"] - t["user_Y"]),
        })

    with open(out, "w") as f:
        json.dump(pairs, f, indent=1)
    print(f"{len(pairs)} pairs -> {out}")


if __name__ == "__main__":
    main()
