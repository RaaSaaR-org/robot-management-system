#!/usr/bin/env python3
"""Check the factory + pause-room Isaac scene WITHOUT Isaac, without a GPU, without a network.

Why this exists
---------------
Launching this scene costs about two minutes and a GPU, and only one `sim_main.py` may run
on this box at a time (its exit handler SIGKILLs every other one). So the failures that are
cheap to make and expensive to find -- a wall that does not meet its neighbour, a doorway
the robot is 4 cm too wide for, an apple that starts inside the plate, an asset path that
silently resolves to an HTTPS fetch -- are all checked here, on plain CPython.

What it can and cannot see
--------------------------
It proves the GEOMETRY and the ASSET REFERENCES. It cannot prove that the scene builds:
nothing here instantiates an Isaac Lab cfg, so a wrong keyword argument, a renamed spawner
or a USD that loads but is scaled wrongly all survive this check. The README lists what
stays unverified until the orchestrator launches it.

How it reads the scene
----------------------
Two different mechanisms, for two different reasons:

* `common_scene/factory_pauseroom_layout.py` is IMPORTED for real (importlib, by path). It
  imports nothing but `math`, which is the entire reason it was split out of the cfg: the
  numbers the simulator will use are the numbers this file does arithmetic on. No parsing,
  no drift.
* `common_scene/base_scene_factory_pauseroom.py` and the env cfg CANNOT be imported -- they
  need `isaaclab`, which needs a Kit app and a GPU. Those two are parsed with `ast`, which
  is enough for the questions asked of them: which prim paths are declared, and whether any
  remote URL or nucleus symbol appears in executable code. `ast` also drops comments for
  free, so the long explanations in those files about why nucleus paths are avoided do not
  themselves trip the "no remote URL" check; docstrings are excluded explicitly.

Usage
-----
    python3 verify_factory_scene_offline.py [--checkout /path/to/unitree_sim_isaaclab]

The checkout path is only needed for the "asset exists on disk" check. It is also read from
$UNITREE_SIM_CHECKOUT or $PROJECT_ROOT. Without it that one check reports SKIP (loudly) and
everything else still runs.

Exit status: 0 if no check FAILED, 1 otherwise.

@status new -- offline verifier for isaac_scenes/, not part of the shipped robot software
"""

from __future__ import annotations

import argparse
import ast
import importlib.util
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
LAYOUT_PY = os.path.join(HERE, "common_scene", "factory_pauseroom_layout.py")
SCENE_PY = os.path.join(HERE, "common_scene", "base_scene_factory_pauseroom.py")
TASK_DIR = os.path.join(HERE, "g1_tasks", "factory_pause_room_g1_29dof_dex3_wholebody")
ENVCFG_PY = os.path.join(TASK_DIR, "factory_pause_room_g1_29dof_dex3_hw_env_cfg.py")
TASKINIT_PY = os.path.join(TASK_DIR, "__init__.py")

GYM_ID = "Isaac-Factory-PauseRoom-G129-Dex3-Wholebody"

# Prim paths that must exist exactly once and therefore must NOT sit under /World/envs,
# because `replicate_physics=True` clones everything that does.
EXPECTED_SINGLETONS = {
    SCENE_PY: {
        "/World/GroundPlane",
        "/World/light",
        "/World/sun",
        "/World/PerspectiveCamera",
        "/World/PauseRoomCam",
    },
    ENVCFG_PY: {
        "/World/FilmCam",
    },
}

# Anything that would drag the scene onto the network at first use.
FORBIDDEN_STRINGS = ("http://", "https://", "omniverse://", "s3://", "ftp://")
FORBIDDEN_NAMES = (
    "ISAAC_NUCLEUS_DIR",
    "ISAACLAB_NUCLEUS_DIR",
    "NVIDIA_NUCLEUS_DIR",
    "NUCLEUS_ASSET_ROOT_DIR",
    # GroundPlaneCfg's default usd_path IS a nucleus URL
    # (IsaacLab30/.../from_files_cfg.py:218), so using it at all is a network dependency.
    "GroundPlaneCfg",
)

EPS = 1e-9


# ==========================================================================================
# tiny check harness
# ==========================================================================================
class Report:
    def __init__(self) -> None:
        self.rows: list[tuple[str, str, str]] = []

    def _add(self, status: str, name: str, detail: str) -> None:
        self.rows.append((status, name, detail))
        mark = {"PASS": "PASS", "FAIL": "FAIL", "SKIP": "SKIP"}[status]
        print(f"  [{mark}] {name}" + (f"\n         {detail}" if detail else ""))

    def ok(self, name: str, detail: str = "") -> None:
        self._add("PASS", name, detail)

    def bad(self, name: str, detail: str = "") -> None:
        self._add("FAIL", name, detail)

    def skip(self, name: str, detail: str = "") -> None:
        self._add("SKIP", name, detail)

    def check(self, cond: bool, name: str, detail: str = "") -> bool:
        (self.ok if cond else self.bad)(name, detail)
        return bool(cond)

    @property
    def failed(self) -> int:
        return sum(1 for s, _, _ in self.rows if s == "FAIL")

    @property
    def skipped(self) -> int:
        return sum(1 for s, _, _ in self.rows if s == "SKIP")

    @property
    def passed(self) -> int:
        return sum(1 for s, _, _ in self.rows if s == "PASS")


def section(title: str) -> None:
    print(f"\n{title}\n{'-' * len(title)}")


# ==========================================================================================
# loading
# ==========================================================================================
def load_layout(path: str):
    spec = importlib.util.spec_from_file_location("factory_pauseroom_layout", path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot load {path}")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def parse(path: str) -> ast.Module:
    with open(path, encoding="utf-8") as fh:
        return ast.parse(fh.read(), filename=path)


def docstring_nodes(tree: ast.AST) -> set[int]:
    """id()s of the Constant nodes that are docstrings, so they can be excluded."""
    out: set[int] = set()
    for node in ast.walk(tree):
        if isinstance(node, (ast.Module, ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef)):
            body = getattr(node, "body", None)
            if body and isinstance(body[0], ast.Expr) and isinstance(body[0].value, ast.Constant) \
                    and isinstance(body[0].value.value, str):
                out.add(id(body[0].value))
    return out


def code_strings(tree: ast.AST) -> list[str]:
    """Every string literal that is NOT a docstring. Comments are already gone."""
    skip = docstring_nodes(tree)
    return [n.value for n in ast.walk(tree)
            if isinstance(n, ast.Constant) and isinstance(n.value, str) and id(n) not in skip]


def code_names(tree: ast.AST) -> set[str]:
    """Every bare name and attribute name referenced in code."""
    out: set[str] = set()
    for n in ast.walk(tree):
        if isinstance(n, ast.Name):
            out.add(n.id)
        elif isinstance(n, ast.Attribute):
            out.add(n.attr)
        elif isinstance(n, ast.alias):
            out.add(n.name.split(".")[-1])
            if n.asname:
                out.add(n.asname)
        elif isinstance(n, ast.ImportFrom) and n.module:
            out.update(n.module.split("."))
    return out


# ==========================================================================================
# geometry helpers
# ==========================================================================================
def blocking_boxes(L, z_lo: float = 0.0, z_hi: float | None = None) -> list[tuple[float, float, float, float]]:
    """(x0, x1, y0, y1) footprints of walls that a walking robot would actually hit.

    A box only counts if its z-range overlaps [z_lo, z_hi]. That is what lets the doorway
    lintel be a wall for rendering and not a wall for walking through.
    """
    if z_hi is None:
        z_hi = L.WALK_CLEARANCE_Z
    out = []
    for box in L.WALLS.values():
        (x0, x1), (y0, y1), (bz0, bz1) = L.box_extent(box)
        if bz1 > z_lo + EPS and bz0 < z_hi - EPS:
            out.append((x0, x1, y0, y1))
    return out


def _covered(px: float, py: float, boxes) -> bool:
    return any(x0 - EPS <= px <= x1 + EPS and y0 - EPS <= py <= y1 + EPS
               for x0, x1, y0, y1 in boxes)


def perimeter_openings(rect: dict, boxes, step: float = 0.01, probe: float = 0.02):
    """Find the gaps in the wall ring around an interior rectangle.

    Walks each of the four boundary lines just OUTSIDE the interior (by `probe`) and
    records the maximal runs of sampled points that no blocking box covers. Returns
    [(side, start, end, length)], with start/end along that side's free axis.
    """
    sides = [
        ("south", "x", rect["x_min"], rect["x_max"], rect["y_min"] - probe, False),
        ("north", "x", rect["x_min"], rect["x_max"], rect["y_max"] + probe, False),
        ("west", "y", rect["y_min"], rect["y_max"], rect["x_min"] - probe, True),
        ("east", "y", rect["y_min"], rect["y_max"], rect["x_max"] + probe, True),
    ]
    openings = []
    for name, _axis, lo, hi, fixed, vertical in sides:
        n = max(2, int(round((hi - lo) / step)) + 1)
        run_start = None
        prev_t = lo
        for i in range(n):
            t = lo + (hi - lo) * i / (n - 1)
            px, py = (fixed, t) if vertical else (t, fixed)
            free = not _covered(px, py, boxes)
            if free and run_start is None:
                run_start = t
            elif not free and run_start is not None:
                openings.append((name, run_start, prev_t, prev_t - run_start))
                run_start = None
            prev_t = t
        if run_start is not None:
            openings.append((name, run_start, hi, hi - run_start))
    # discard sub-millimetre sampling artefacts at the very ends of a side
    return [o for o in openings if o[3] > 0.005]


def point_seg_distance(p, a, b) -> float:
    ax, ay = a
    bx, by = b
    px, py = p
    dx, dy = bx - ax, by - ay
    den = dx * dx + dy * dy
    t = 0.0 if den == 0 else max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / den))
    return math.hypot(px - (ax + t * dx), py - (ay + t * dy))


# ==========================================================================================
# checks
# ==========================================================================================
def check_files(rep: Report) -> bool:
    section("0. the deliverable's own files")
    ok = True
    for path in (LAYOUT_PY, SCENE_PY, ENVCFG_PY, TASKINIT_PY):
        ok &= rep.check(os.path.isfile(path), f"exists: {os.path.relpath(path, HERE)}")
    for name in ("__init__.py", "observations.py", "rewards.py", "terminations.py"):
        p = os.path.join(TASK_DIR, "mdp", name)
        ok &= rep.check(os.path.isfile(p), f"exists: {os.path.relpath(p, HERE)}")
    return ok


def check_assets(rep: Report, L, checkout: str | None) -> None:
    section("1. every referenced asset exists on disk")
    if not checkout:
        rep.skip("USD props resolve to real files",
                 "no checkout path: pass --checkout, or set $UNITREE_SIM_CHECKOUT / $PROJECT_ROOT")
        return
    rep.check(os.path.isdir(checkout), "checkout directory exists", checkout)
    for key, prop in sorted(L.USD_PROPS.items()):
        full = os.path.join(checkout, prop["rel_path"])
        rep.check(os.path.isfile(full), f"asset on disk: {key}", prop["rel_path"])


def check_no_remote(rep: Report, paths) -> None:
    section("2. nothing reaches the network")
    for path in paths:
        tree = parse(path)
        rel = os.path.relpath(path, HERE)
        hits = [s for s in code_strings(tree)
                if any(f in s for f in FORBIDDEN_STRINGS)]
        rep.check(not hits, f"no URL in code strings: {rel}",
                  "" if not hits else f"found {hits!r}")
        names = code_names(tree)
        bad = sorted(names & set(FORBIDDEN_NAMES))
        rep.check(not bad, f"no nucleus/remote-by-default symbol: {rel}",
                  "" if not bad else f"references {bad!r}")


def check_prim_paths(rep: Report, L) -> None:
    section("3. what is cloned per env, and what is not")
    rep.check(not L.GROUND_PRIM_PATH.startswith("/World/envs"),
              "the ground plane is declared OUTSIDE /World/envs",
              f"{L.GROUND_PRIM_PATH} -- replicate_physics=True clones /World/envs/env_.* "
              "per env; TASK-223 lost the floor to exactly this")
    for path, expected in EXPECTED_SINGLETONS.items():
        tree = parse(path)
        rel = os.path.relpath(path, HERE)
        prims = {s for s in code_strings(tree) if s.startswith("/World")}
        # The floor's prim path is passed as the imported constant GROUND_PRIM_PATH, not as
        # a literal, so resolve it from the layout module rather than reporting it missing.
        if "GROUND_PRIM_PATH" in code_names(tree):
            prims.add(L.GROUND_PRIM_PATH)
        singles = {p for p in prims if not p.startswith("/World/envs")}
        rep.check(singles == expected, f"singleton prim paths in {rel}",
                  f"found {sorted(singles)}" if singles != expected
                  else f"{sorted(singles)}")
        cloned = sorted(prims - singles)
        rep.check(all(p.startswith("/World/envs/env_.*/") for p in cloned),
                  f"every cloned prim path is well formed: {rel}",
                  f"{len(cloned)} paths under /World/envs/env_.*/")


def check_gym_id(rep: Report) -> None:
    section("4. gym registration")
    tree = parse(TASKINIT_PY)
    ids = [s for s in code_strings(tree) if s.startswith("Isaac-")]
    rep.check(ids == [GYM_ID], "task id", f"{ids}")
    rep.check("Wholebody" in GYM_ID,
              "id contains 'Wholebody'",
              "sim_main.py:476-479 keys off that substring to force action_source="
              "'dds_wholebody'; without it the DDS provider never drives the robot")


def check_hall(rep: Report, L) -> None:
    section("5. the factory hall encloses")
    boxes = blocking_boxes(L)
    openings = perimeter_openings(L.HALL, boxes)
    rep.check(not openings, "hall perimeter has no gap below 2.0 m",
              "" if not openings else f"open runs: {openings}")
    w = L.HALL["x_max"] - L.HALL["x_min"]
    d = L.HALL["y_max"] - L.HALL["y_min"]
    rep.check(w * d >= 24.0 * 16.0 - EPS, "clear interior floor",
              f"{w:.1f} x {d:.1f} m = {w * d:.0f} m^2")
    # the floor must extend past the walls on every side
    (gx0, gx1), (gy0, gy1), (gz0, gz1) = L.box_extent(L.GROUND)
    wall_x = [v for b in L.WALLS.values() for v in L.box_extent(b)[0]]
    wall_y = [v for b in L.WALLS.values() for v in L.box_extent(b)[1]]
    rep.check(gx0 < min(wall_x) and gx1 > max(wall_x) and gy0 < min(wall_y) and gy1 > max(wall_y),
              "floor extends beyond every wall",
              f"floor x[{gx0:.1f},{gx1:.1f}] y[{gy0:.1f},{gy1:.1f}] vs walls "
              f"x[{min(wall_x):.1f},{max(wall_x):.1f}] y[{min(wall_y):.1f},{max(wall_y):.1f}]")
    rep.check(abs(L.GROUND_TOP_Z) < 1e-9, "floor top face is at exactly z = 0",
              f"z = {L.GROUND_TOP_Z}")


def check_pause_room(rep: Report, L) -> None:
    section("6. the pause room encloses, with exactly one door")
    boxes = blocking_boxes(L)
    openings = perimeter_openings(L.PAUSE_ROOM, boxes)
    rep.check(len(openings) == 1, "exactly one opening in the pause-room wall ring",
              f"{[(o[0], round(o[1], 3), round(o[2], 3), round(o[3], 3)) for o in openings]}")
    if len(openings) != 1:
        return
    side, lo, hi, width = openings[0]
    rep.check(side == "south", "the opening is on the south wall (faces the factory floor)",
              f"side={side}")
    rep.check(width >= 1.0, "doorway clear width >= 1.0 m (the G1 is ~0.45 m across)",
              f"measured {width:.3f} m, declared {L.DOOR['width']:.2f} m, x in [{lo:.2f},{hi:.2f}]")
    rep.check(abs(L.DOOR["width"] - width) < 0.03,
              "the declared door width matches the wall geometry",
              f"declared {L.DOOR['width']:.3f}, measured {width:.3f}")
    cx = (lo + hi) / 2
    rep.check(abs(cx - L.DOOR["centre"][0]) < 0.03, "the declared door centre matches",
              f"declared x={L.DOOR['centre'][0]:.2f}, measured x={cx:.3f}")
    # the lintel must not intrude on the walking envelope
    (lx0, lx1), (ly0, ly1), (lz0, lz1) = L.box_extent(L.WALLS["pause_door_lintel"])
    rep.check(lz0 >= L.DOOR["clear_height"] - EPS,
              "the door lintel starts above the declared clear height",
              f"lintel underside z={lz0:.2f}, clear height {L.DOOR['clear_height']:.2f}, "
              "G1 standing height ~1.32 m")
    pw = L.PAUSE_ROOM["x_max"] - L.PAUSE_ROOM["x_min"]
    pd = L.PAUSE_ROOM["y_max"] - L.PAUSE_ROOM["y_min"]
    rep.check(pw >= 3.5 and pd >= 3.5, "pause room is roughly 4 x 4 m", f"{pw:.1f} x {pd:.1f} m")
    rep.check(L.PAUSE_ROOM["x_min"] >= L.HALL["x_min"] and L.PAUSE_ROOM["x_max"] <= L.HALL["x_max"]
              and L.PAUSE_ROOM["y_min"] >= L.HALL["y_min"] and L.PAUSE_ROOM["y_max"] <= L.HALL["y_max"],
              "the pause room is inside the hall footprint")


def check_manipulation(rep: Report, L) -> None:
    section("7. the apple / plate / table setup")
    (tx0, tx1), (ty0, ty1), (tz0, tz1) = L.box_extent(L.TABLE)
    rep.check(abs(L.TABLE_TOP_Z - 0.75) < 1e-9, "table top at z = 0.75 (matches the MJCF)",
              f"z = {L.TABLE_TOP_Z}")
    rep.check(abs(tz0) < 1e-9, "the table stands on the floor", f"underside z = {tz0}")
    rep.check(tx0 >= L.PAUSE_ROOM["x_min"] and tx1 <= L.PAUSE_ROOM["x_max"]
              and ty0 >= L.PAUSE_ROOM["y_min"] and ty1 <= L.PAUSE_ROOM["y_max"],
              "the table is inside the pause room",
              f"table x[{tx0:.2f},{tx1:.2f}] y[{ty0:.2f},{ty1:.2f}]")

    px, py, pz = L.PLATE["pos"]
    pr, ph = L.PLATE["radius"], L.PLATE["height"]
    plate_bottom = pz - ph / 2
    rep.check(abs(plate_bottom - L.TABLE_TOP_Z) < 1e-6, "the plate rests ON the table top",
              f"plate underside z = {plate_bottom:.4f}, table top z = {L.TABLE_TOP_Z:.4f}")
    rep.check(px - pr >= tx0 and px + pr <= tx1 and py - pr >= ty0 and py + pr <= ty1,
              "the whole plate is within the table footprint",
              f"plate x[{px - pr:.3f},{px + pr:.3f}] y[{py - pr:.3f},{py + pr:.3f}]")

    ax, ay, az = L.APPLE["pos"]
    ar = L.APPLE["radius"]
    apple_bottom = az - ar
    rep.check(apple_bottom >= L.TABLE_TOP_Z - EPS, "the apple starts ABOVE the table top",
              f"apple underside z = {apple_bottom:.4f}, table top z = {L.TABLE_TOP_Z:.4f} "
              f"(a {1000 * (apple_bottom - L.TABLE_TOP_Z):.1f} mm settle drop)")
    rep.check(apple_bottom - L.TABLE_TOP_Z < 0.05, "...but not dropped from a height",
              f"{1000 * (apple_bottom - L.TABLE_TOP_Z):.1f} mm")
    rep.check(ax - ar >= tx0 and ax + ar <= tx1 and ay - ar >= ty0 and ay + ar <= ty1,
              "the whole apple is within the table footprint",
              f"apple x[{ax - ar:.3f},{ax + ar:.3f}] y[{ay - ar:.3f},{ay + ar:.3f}] "
              f"vs table x[{tx0:.2f},{tx1:.2f}] y[{ty0:.2f},{ty1:.2f}]")
    d = math.hypot(ax - px, ay - py)
    rep.check(d > pr + ar, "the apple does NOT start inside/on the plate",
              f"centre distance {d:.4f} m > plate r {pr} + apple r {ar} = {pr + ar:.4f} m; "
              "a place task whose object starts at the goal scores nothing")
    rep.check(d < 0.60, "...but is within reach of it", f"{d:.3f} m apart")
    # `reset_object_self` re-samples the apple over +/-jx, +/-jy. Both invariants above must
    # still hold at the worst corner of that box, not just at the nominal spawn.
    jx, jy = L.APPLE_RESET_JITTER["x"], L.APPLE_RESET_JITTER["y"]
    worst = math.hypot(abs(ax - px) - jx, abs(ay - py) - jy)
    rep.check(worst > pr + ar, "the reset jitter box never puts the apple on the plate",
              f"jitter +/-{jx} x, +/-{jy} y -> worst-case centre distance {worst:.4f} m "
              f"vs {pr + ar:.4f} m of touching")
    rep.check(ax - ar - jx >= tx0 and ax + ar + jx <= tx1
              and ay - ar - jy >= ty0 and ay + ar + jy <= ty1,
              "the reset jitter box never puts the apple off the table")


def check_robot(rep: Report, L) -> None:
    section("8. the robot's start pose and its route")
    rx, ry, rz = L.ROBOT["pos"]
    inside_pause = (L.PAUSE_ROOM["x_min"] <= rx <= L.PAUSE_ROOM["x_max"]
                    and L.PAUSE_ROOM["y_min"] <= ry <= L.PAUSE_ROOM["y_max"])
    rep.check(not inside_pause, "the robot starts on the factory floor, not in the pause room",
              f"({rx}, {ry})")
    rep.check(L.HALL["x_min"] < rx < L.HALL["x_max"] and L.HALL["y_min"] < ry < L.HALL["y_max"],
              "the robot starts inside the hall")
    dx, dy = L.DOOR["centre"][0] - rx, L.DOOR["centre"][1] - ry
    bearing = math.degrees(math.atan2(dy, dx))
    err = abs((L.ROBOT["yaw_deg"] - bearing + 180) % 360 - 180)
    rep.check(err <= 15.0, "the robot faces roughly toward the pause-room door",
              f"yaw {L.ROBOT['yaw_deg']:.1f} deg vs bearing {bearing:.2f} deg "
              f"-> {err:.2f} deg off; walk distance {math.hypot(dx, dy):.2f} m")
    rep.check(abs(rz - 0.80) < 1e-9, "spawn height matches the working move_cylinder scene",
              f"z = {rz} above a floor whose top is z = {L.GROUND_TOP_Z}")

    # nothing may sit on the straight line the robot would take to the door
    lane_a, lane_b = (rx, ry), L.DOOR["centre"]
    worst = None
    for name, box in L.all_static_boxes().items():
        if name.startswith(("wall_", "pause_wall_", "pause_door")) or name == "pause_table":
            continue
        (x0, x1), (y0, y1), (z0, z1) = L.box_extent(box)
        if z1 < 0.05:
            continue
        cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
        half = max(x1 - x0, y1 - y0) / 2
        clear = point_seg_distance((cx, cy), lane_a, lane_b) - half
        if worst is None or clear < worst[1]:
            worst = (name, clear)
    for name, prop in L.USD_PROPS.items():
        cx, cy = prop["pos"][0], prop["pos"][1]
        clear = point_seg_distance((cx, cy), lane_a, lane_b) - 1.0  # generous prop half-extent
        if worst is None or clear < worst[1]:
            worst = (name, clear)
    rep.check(worst is not None and worst[1] >= 0.6,
              "the direct route to the door is clear of props and columns",
              f"tightest is {worst[0]} at {worst[1]:.2f} m of clearance "
              "(props charged a generous 1.0 m half-extent since their USD footprints "
              "are not readable offline)")

    # and the robot must not spawn inside anything
    for name, box in L.all_static_boxes().items():
        (x0, x1), (y0, y1), (z0, z1) = L.box_extent(box)
        if x0 - 0.4 <= rx <= x1 + 0.4 and y0 - 0.4 <= ry <= y1 + 0.4 and z1 > 0.1:
            rep.bad("the robot does not spawn inside geometry", f"overlaps {name}")
            return
    rep.ok("the robot does not spawn inside geometry", "0.4 m body radius clear of every box")


def check_quaternions(rep: Report, L) -> None:
    section("9. quaternions are in the order this build wants")
    rep.check(L.IDENTITY_XYZW == (0.0, 0.0, 0.0, 1.0),
              "identity is (0, 0, 0, 1)",
              "Isaac Lab 3.0 asset_base_cfg.py:37 -- (1, 0, 0, 0) would be a 180 deg roll about X")
    q = L.yaw_quat_xyzw(90.0)
    v = L.rotate_xyzw(q, (1.0, 0.0, 0.0))
    rep.check(abs(v[0]) < 1e-9 and abs(v[1] - 1.0) < 1e-9,
              "yaw_quat_xyzw(90) turns +x into +y", f"-> ({v[0]:.6f}, {v[1]:.6f}, {v[2]:.6f})")
    w = L.yaw_quat_wxyz(90.0)
    rep.check(abs(w[0] - math.cos(math.pi / 4)) < 1e-9 and abs(w[3] - math.sin(math.pi / 4)) < 1e-9,
              "yaw_quat_wxyz(90) puts the scalar FIRST",
              f"{tuple(round(c, 5) for c in w)} -- this is the order G1RobotPresets wants "
              "(robot_configs.py:238-239 reorders it to XYZW itself)")
    for label, spec in (("world_camera", L.WORLD_CAMERA), ("pause_room_camera", L.PAUSE_ROOM_CAMERA)):
        q = L.look_at_quat_xyzw_ros(spec["eye"], spec["target"])
        fwd = L.rotate_xyzw(q, (0.0, 0.0, 1.0))   # ROS convention: camera looks along its +z
        down = L.rotate_xyzw(q, (0.0, 1.0, 0.0))  # ...with +y pointing down
        want = [t - e for t, e in zip(spec["target"], spec["eye"])]
        n = math.sqrt(sum(c * c for c in want))
        want = [c / n for c in want]
        err = max(abs(a - b) for a, b in zip(fwd, want))
        rep.check(err < 1e-6, f"{label}: rotating +z by the look-at gives the eye->target ray",
                  f"max component error {err:.2e}")
        rep.check(down[2] < 0.0, f"{label}: the image is not upside down",
                  f"camera +y (down) has world z = {down[2]:.4f}")


def check_camera_sightlines(rep: Report, L) -> None:
    section("10. the cameras can see what they are aimed at")
    # world_camera sits outside the hall and above it; its ray must clear the south wall.
    ex, ey, ez = L.WORLD_CAMERA["eye"]
    tx, ty, tz = L.WORLD_CAMERA["target"]
    (_wx, _wx1), (wy0, wy1), (_wz0, wz1) = L.box_extent(L.WALLS["wall_south"])
    t = (wy1 - ey) / (ty - ey)
    z_at_wall = ez + t * (tz - ez)
    rep.check(z_at_wall > wz1, "world_camera's sight-line clears the south wall",
              f"crosses y={wy1:.2f} at z={z_at_wall:.2f}, wall top z={wz1:.2f}")
    # pause_room_camera must be inside the pause room, so no partition can occlude it.
    px, py, pz = L.PAUSE_ROOM_CAMERA["eye"]
    rep.check(L.PAUSE_ROOM["x_min"] <= px <= L.PAUSE_ROOM["x_max"]
              and L.PAUSE_ROOM["y_min"] <= py <= L.PAUSE_ROOM["y_max"]
              and 0 < pz < L.PAUSE_HEIGHT,
              "pause_room_camera is inside the pause room",
              f"({px}, {py}, {pz}) in x[{L.PAUSE_ROOM['x_min']},{L.PAUSE_ROOM['x_max']}] "
              f"y[{L.PAUSE_ROOM['y_min']},{L.PAUSE_ROOM['y_max']}]")
    rep.check(pz > 1.4, "pause_room_camera is above the robot's head",
              f"z = {pz} m vs a ~1.32 m G1")


def check_places(rep: Report, L) -> None:
    section("11. the named places are where they claim to be")
    inside_room = {"pause_room_centre", "table_front"}
    for name, (x, y) in sorted(L.PLACES.items()):
        in_room = (L.PAUSE_ROOM["x_min"] <= x <= L.PAUSE_ROOM["x_max"]
                   and L.PAUSE_ROOM["y_min"] <= y <= L.PAUSE_ROOM["y_max"])
        rep.check(in_room == (name in inside_room),
                  f"place '{name}' is on the expected side of the door",
                  f"({x}, {y}) -> {'pause room' if in_room else 'factory floor'}")
    (tx0, tx1), (ty0, ty1), _ = L.box_extent(L.TABLE)
    fx, fy = L.PLACES["table_front"]
    rep.check(ty0 - fy > 0.4, "'table_front' leaves standing room in front of the table",
              f"{ty0 - fy:.2f} m from the table's front edge")


def print_coordinates(L) -> None:
    section("coordinate table (world frame, metres, num_envs=1)")
    rows = [
        ("robot start", f"({L.ROBOT['pos'][0]:.2f}, {L.ROBOT['pos'][1]:.2f}, {L.ROBOT['pos'][2]:.2f})",
         f"yaw {L.ROBOT['yaw_deg']:.0f} deg, facing the pause-room door"),
        ("pause-room door centre",
         f"({L.DOOR['centre'][0]:.2f}, {L.DOOR['centre'][1]:.2f}, 0.00)",
         f"clear width {L.DOOR['width']:.2f} m, clear height {L.DOOR['clear_height']:.2f} m"),
        ("table centre", f"({L.TABLE['pos'][0]:.2f}, {L.TABLE['pos'][1]:.2f}, {L.TABLE['pos'][2]:.3f})",
         f"{L.TABLE['size'][0]:.2f} x {L.TABLE['size'][1]:.2f} x {L.TABLE['size'][2]:.2f}, "
         f"top z = {L.TABLE_TOP_Z:.2f}"),
        ("plate centre", f"({L.PLATE['pos'][0]:.3f}, {L.PLATE['pos'][1]:.3f}, {L.PLATE['pos'][2]:.3f})",
         f"r = {L.PLATE['radius']:.3f}, h = {L.PLATE['height']:.2f}, static"),
        ("apple spawn", f"({L.APPLE['pos'][0]:.3f}, {L.APPLE['pos'][1]:.3f}, {L.APPLE['pos'][2]:.3f})",
         f"r = {L.APPLE['radius']:.2f}, m = {L.APPLE['mass']:.2f} kg, dynamic"),
    ]
    w = max(len(r[0]) for r in rows)
    for name, pos, note in rows:
        print(f"  {name.ljust(w)}  {pos:<26}  {note}")
    print("\n  named places:")
    for name, (x, y) in sorted(L.PLACES.items()):
        print(f"    {name.ljust(20)} ({x:6.2f}, {y:6.2f})")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--checkout", default=None,
                    help="path to the unitree_sim_isaaclab checkout (for the asset-exists check)")
    args = ap.parse_args()

    checkout = (args.checkout
                or os.environ.get("UNITREE_SIM_CHECKOUT")
                or os.environ.get("PROJECT_ROOT"))

    print("=" * 88)
    print(f"offline verification of {GYM_ID}")
    print(f"  layout module : {os.path.relpath(LAYOUT_PY, HERE)}  (imported for real)")
    print(f"  cfg modules   : parsed with ast (they need isaaclab, which needs a GPU)")
    print(f"  checkout      : {checkout or '<not given -- asset check will SKIP>'}")
    print("=" * 88)

    rep = Report()
    if not check_files(rep):
        print("\nRESULT: FAIL -- files missing, nothing else could run")
        return 1

    L = load_layout(LAYOUT_PY)
    cfg_files = [LAYOUT_PY, SCENE_PY, ENVCFG_PY, TASKINIT_PY]

    check_assets(rep, L, checkout)
    check_no_remote(rep, cfg_files)
    check_prim_paths(rep, L)
    check_gym_id(rep)
    check_hall(rep, L)
    check_pause_room(rep, L)
    check_manipulation(rep, L)
    check_robot(rep, L)
    check_quaternions(rep, L)
    check_camera_sightlines(rep, L)
    check_places(rep, L)

    print_coordinates(L)

    print("\n" + "=" * 88)
    verdict = "FAIL" if rep.failed else ("PASS" if not rep.skipped else "PASS (with skips)")
    print(f"RESULT: {verdict}  --  {rep.passed} passed, {rep.failed} failed, {rep.skipped} skipped")
    if rep.skipped:
        print("        a SKIP is not a pass. Re-run with --checkout to close it.")
    print("        This proves geometry and asset references only. It does NOT prove the")
    print("        scene builds: nothing here instantiates an Isaac Lab cfg.")
    print("=" * 88)
    return 1 if rep.failed else 0


if __name__ == "__main__":
    sys.exit(main())
