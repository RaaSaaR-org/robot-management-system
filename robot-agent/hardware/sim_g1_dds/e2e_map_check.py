"""End-to-end check: the robot-agent's occupancy map matches the room it drove.

Talks only to the robot-agent's REST API (TASK-206 `GET /robots/:id/map`), so
it exercises the whole chain sim LiDAR -> sidecar/DDS -> agent -> grid without
importing any of it. Room geometry comes from
`hardware/sim_evaluator/mjcf/g1_dex3_room_scene.xml`: walls with inner faces at
+-2.95 m (the -y wall has a 1 m doorway centred at x=1.2), table front at x=1.6.

    python e2e_map_check.py                          # drive, then validate
    python e2e_map_check.py --no-drive               # validate what the map holds now
    python e2e_map_check.py --out /tmp/e2e-map       # keep map.json / map.pgm / map.png
    python e2e_map_check.py --agent http://host:41246 --robot sim-robot-g1-edu

The drive is "turn around, walk 2 m, turn around, walk 2 m": out to (-2, 0) and
back when the robot faces +x. Walking +x instead trips the table keepout.
"""
import argparse
import base64
import json
import pathlib
import sys
import time
import urllib.error
import urllib.request

import numpy as np

ap = argparse.ArgumentParser(description="validate the robot-agent occupancy map against the sim room")
ap.add_argument("--agent", default="http://localhost:41246", help="robot-agent base URL")
ap.add_argument("--robot", default="sim-robot-g1-edu", help="robot id")
ap.add_argument("--out", metavar="DIR", help="write map.json, map.pgm (and map.png if Pillow is installed) here")
ap.add_argument("--no-drive", action="store_true", help="skip the walk; validate the current map only")
ap.add_argument("--timeout-s", type=float, default=90.0, help="max seconds to wait for the plan (default 90)")
ARGS = ap.parse_args()

BASE = f"{ARGS.agent.rstrip('/')}/api/v1/robots/{ARGS.robot}"
WALK = "turn around, then walk 2 meters forward, then turn around, then walk 2 meters forward"
TOL = 0.15  # metres: an "occupied cell within +-TOL" of the geometric surface counts

# Furniture footprints (x0, x1, y0, y1) that may legitimately hold occupied cells.
FURNITURE = [
    ("table", 1.5, 2.9, 0.2, 1.2),
    ("shelf", -1.05, 0.25, 2.5, 3.0),
    ("chair", 1.3, 1.9, -2.15, -1.55),
    ("person", -2.25, -1.55, -1.8, -1.1),
]
MAX_STRAYS = 3


def get(path, raw=False):
    with urllib.request.urlopen(BASE + path, timeout=10) as r:
        return r.read() if raw else json.load(r)


def post(path, payload=None):
    req = urllib.request.Request(
        BASE + path, data=json.dumps(payload or {}).encode(),
        headers={"Content-Type": "application/json"}, method="POST")
    with urllib.request.urlopen(req, timeout=10) as r:
        return json.load(r)


class Grid:
    """Decoded int8-logodds grid with world<->cell helpers."""

    def __init__(self, g):
        self.res = g["resolution"]
        self.ox, self.oy = g["originX"], g["originY"]
        self.w, self.h = g["width"], g["height"]
        q = np.frombuffer(base64.b64decode(g["cells"]), dtype=np.int8).astype(float) / 25.0
        q = q.reshape(self.h, self.w)
        self.occ = q > g["occupiedAbove"]
        self.free = q < g["freeBelow"]

    def cell(self, x, y):
        return int(np.floor((y - self.oy) / self.res)), int(np.floor((x - self.ox) / self.res))

    def in_bounds(self, x, y):
        r, c = self.cell(x, y)
        return 0 <= r < self.h and 0 <= c < self.w

    def occupied_near(self, x, y, tol=TOL):
        r, c = self.cell(x, y)
        k = int(round(tol / self.res))
        return bool(self.occ[max(r - k, 0):r + k + 1, max(c - k, 0):c + k + 1].any())

    def is_free(self, x, y):
        return self.in_bounds(x, y) and bool(self.free[self.cell(x, y)])

    def is_unknown(self, x, y):
        if not self.in_bounds(x, y):
            return True  # off-grid is unknown by definition
        r, c = self.cell(x, y)
        return not self.occ[r, c] and not self.free[r, c]

    def band(self, axis, val, lo, hi, tol=TOL):
        """(hits, n): sample points every 0.1 m along a wall/face with an occupied cell within tol."""
        hits = n = 0
        for t in np.arange(lo, hi + 1e-9, 0.1):
            x, y = (val, t) if axis == "x" else (t, val)
            n += 1
            hits += self.occupied_near(x, y, tol)
        return hits, n

    def strays(self, half=2.7):  # 2.7: the wall face at 2.95 bleeds one 0.1 m cell inward, keep it out of "interior"
        """Occupied cells inside the room that no furniture footprint explains."""
        ys, xs = np.where(self.occ)
        wx = self.ox + (xs + 0.5) * self.res
        wy = self.oy + (ys + 0.5) * self.res
        inside = (np.abs(wx) < half) & (np.abs(wy) < half)
        stray = inside.copy()
        for _, x0, x1, y0, y1 in FURNITURE:
            stray &= ~((wx >= x0) & (wx <= x1) & (wy >= y0) & (wy <= y1))
        pts = sorted({(round(float(a), 2), round(float(b), 2)) for a, b in zip(wx[stray], wy[stray])})
        return pts, int(inside.sum())


def reset_estops():
    for path in ("/safety/estop/reset", "/agent-mode/estop/reset"):
        try:
            post(path)
        except urllib.error.HTTPError as e:
            # A reset on an un-tripped e-stop may be rejected; that is fine.
            print(f"   {path} -> HTTP {e.code} (ignored)")


def drive():
    """Submit the walk and block until the plan settles. Returns the final plan or None."""
    r = post("/agent-mode/command", {"text": WALK})
    if not r.get("accepted"):
        print(f"   command not accepted: {r}")
        return None
    plan_id = r.get("planId")
    print(f"   accepted planId={plan_id}")
    end = time.time() + ARGS.timeout_s
    last = None
    while time.time() < end:
        time.sleep(1.0)
        plan = get("/agent-mode").get("plan") or {}
        if plan.get("id") != plan_id:
            continue
        status = plan.get("status")
        prog = "".join({"done": ".", "running": ">", "failed": "x", "aborted": "!", "skipped": "-"}.get(
            b.get("status"), "?") for b in plan.get("blocks", []))
        if (status, prog) != last:
            print(f"   plan {status} [{prog}]")
            last = (status, prog)
        if status in ("done", "failed", "aborted"):
            return plan
    print(f"   timed out after {ARGS.timeout_s:.0f} s")
    return None


def write_outputs(doc, pgm, grid):
    out = pathlib.Path(ARGS.out)
    out.mkdir(parents=True, exist_ok=True)
    (out / "map.json").write_text(json.dumps(doc))
    (out / "map.pgm").write_bytes(pgm)
    wrote = ["map.json", "map.pgm"]
    try:
        from PIL import Image  # optional
    except ImportError:
        Image = None
    if Image is not None:
        im = Image.open(out / "map.pgm")
        r0, c0 = grid.cell(-4, -4)
        r1, c1 = grid.cell(4, 4)
        # PGM rows run north = +y up, so the y index is flipped relative to the grid.
        im = im.crop((c0, im.height - r1, c1, im.height - r0)).resize((480, 480), Image.NEAREST)
        im.save(out / "map.png")
        wrote.append("map.png")
    print(f"   wrote {', '.join(wrote)} to {out}")


def main():
    fails = []

    print("1. Reset e-stops")
    reset_estops()

    if ARGS.no_drive:
        print("2. Drive skipped (--no-drive)")
    else:
        print(f"2. Drive: {WALK!r}")
        plan = drive()
        if plan is None:
            fails.append("plan did not finish (rejected or timed out)")
        elif plan.get("status") != "done":
            errs = [b.get("error") for b in plan.get("blocks", []) if b.get("error")]
            fails.append(f"plan ended {plan.get('status')}: {errs}")
        time.sleep(1.5)  # let the last scan integrate

    print("3. Fetch /map")
    doc = get("/map")
    status = doc.get("status") or {}
    g = doc.get("grid")
    print(f"   status={status}")
    if not g:
        fails.append("grid is null")
    if status.get("integrations", 0) == 0:
        fails.append("status.integrations == 0 -- nothing was ever integrated")
    if fails:
        print("\nFAIL:")
        for f in fails:
            print("  -", f)
        return 1
    grid = Grid(g)
    print(f"   grid {grid.w}x{grid.h} @ {grid.res} m origin=({grid.ox},{grid.oy}) "
          f"known={g['knownCells']} occupied={g['occupiedCells']} poses={g['poseCount']}")
    if ARGS.out:
        write_outputs(doc, get("/map?format=pgm", raw=True), grid)

    print("4. Walls: occupied cell within +-%.2f m along the inner face (-2.5..2.5)" % TOL)
    walls = [
        ("x=+2.95", "x", 2.95, 0.90),
        ("x=-2.95", "x", -2.95, 0.90),
        ("y=+2.95", "y", 2.95, 0.90),
        ("y=-2.95 (1 m doorway)", "y", -2.95, 0.80),
    ]
    for name, axis, val, need in walls:
        hits, n = grid.band(axis, val, -2.5, 2.5)
        frac = hits / n
        ok = frac >= need
        print(f"   {'PASS' if ok else 'FAIL'} {name}: {hits}/{n} = {frac:.0%} (need >= {need:.0%})")
        if not ok:
            fails.append(f"wall {name}: {frac:.0%} < {need:.0%}")

    print("5. Table front x=1.6, y 0.3..1.1")
    hits, n = grid.band("x", 1.6, 0.3, 1.1)
    ok = hits / n >= 0.5
    print(f"   {'PASS' if ok else 'FAIL'} {hits}/{n} = {hits / n:.0%} (need >= 50%)")
    if not ok:
        fails.append(f"table front: {hits / n:.0%} < 50%")

    print("6. Robot path y=0, x -1.8..0 is free")
    pts = [(x, 0.0) for x in np.arange(-1.8, 0.0 + 1e-9, 0.1)]
    not_free = [round(float(x), 1) for x, y in pts if not grid.is_free(x, y)]
    ok = not not_free
    print(f"   {'PASS' if ok else 'FAIL'} {len(pts) - len(not_free)}/{len(pts)} free"
          + (f"; not free at x={not_free}" if not_free else ""))
    if not ok:
        fails.append(f"path not fully free: x={not_free}")

    print("7. Outside the room (4, 0) is unknown")
    ok = grid.is_unknown(4.0, 0.0)
    print(f"   {'PASS' if ok else 'FAIL'}")
    if not ok:
        fails.append("(4,0) outside the room is not unknown")

    print(f"8. Occupied cells inside |x|,|y|<2.7 not inside a furniture box (allow <= {MAX_STRAYS})")
    strays, inside = grid.strays()
    ok = len(strays) <= MAX_STRAYS
    print(f"   {'PASS' if ok else 'FAIL'} {len(strays)} stray of {inside} occupied inside the room")
    if strays:
        print(f"   strays: {strays[:40]}{' ...' if len(strays) > 40 else ''}")
    if not ok:
        fails.append(f"{len(strays)} stray occupied cells inside the room (> {MAX_STRAYS})")

    print("9. status.frameId is set (sim reports boot_id)")
    ok = status.get("frameId") is not None
    print(f"   {'PASS' if ok else 'FAIL'} frameId={status.get('frameId')}")
    if not ok:
        fails.append("status.frameId is null")

    print()
    if fails:
        print("FAIL:")
        for f in fails:
            print("  -", f)
        return 1
    print("ALL CHECKS PASSED")
    return 0


if __name__ == "__main__":
    sys.exit(main())
