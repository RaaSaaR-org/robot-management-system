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
  imports nothing but `math` and `os`, which is the entire reason it was split out of the cfg: the
  numbers the simulator will use are the numbers this file does arithmetic on. No parsing,
  no drift.
* `common_scene/base_scene_factory_pauseroom.py` and the env cfg CANNOT be imported -- they
  need `isaaclab`, which needs a Kit app and a GPU. Those two are parsed with `ast`, which
  is enough for the questions asked of them: which prim paths are declared, and whether any
  remote URL or nucleus symbol appears in executable code. `ast` also drops comments for
  free, so the long explanations in those files about why nucleus paths are avoided do not
  themselves trip the "no remote URL" check; docstrings are excluded explicitly.
* `common_scene/pause_room_door.usda` -- the door's geometry -- is checked by RE-GENERATING
  it. `make_pause_room_door_usda.py` imports the same layout module and emits the file; if
  the checked-in copy differs by one byte, section 14 fails. That is what stops the door
  from quietly ceasing to fit its own doorway when a wall moves.

The two defects this file is a direct response to
-------------------------------------------------
1. `table_front` was hand-typed at (10.00, 5.35) -- 0.926 m from the apple horizontally,
   0.992 m shoulder-to-apple, against roughly 0.53 m of usable G1 arm. The robot could not
   touch its own target from its own authored good spot.
2. Nothing here checked. Every manipulation check asked about the apple, the plate and the
   table, and none of them ever mentioned the robot. Section 12 is the check that was
   missing; section 11's old "leaves standing room in front of the table" test actively
   rewarded standing FURTHER away, which is the wrong direction.

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

# The MuJoCo twin of the robot. Not part of the scene -- it is the artefact the layout
# module's shoulder, arm and foot constants were MEASURED off, and section 16 re-derives
# them from it so a typo in one of those numbers cannot pass unnoticed. See the long
# comment on `check_robot_model`.
MJCF_G1 = os.path.join(HERE, "..", "sim_evaluator", "mjcf", "g1_dex3", "g1_43dof_fixedbase.xml")

# ------------------------------------------------------------------------------------------
# How much room a walking G1 is charged.
#
# The G1's widest static dimension is its shoulder span, ~0.45 m, so its circumscribed
# radius standing still is ~0.225 m. `G1_BODY_RADIUS` rounds that up to 0.25 for the sway
# a walking gait adds. This is a DIFFERENT number from the 1.0 m charged to the USD props
# below, and for a different reason: 0.25 is what the robot *is*, 1.0 is what an unreadable
# USD footprint *might be*.
#
# `ROUTE_MARGIN` is then how much daylight a route has to leave beyond the robot's own
# width to count as clear. `SPAWN_MARGIN` is larger because a spawn pose is placed, not
# walked to, and there is no reason to place one anywhere near geometry; 0.25 + 0.15 = 0.40
# is exactly the pad the spawn check used before it was given a derivation.
# ------------------------------------------------------------------------------------------
G1_BODY_RADIUS = 0.25
ROUTE_MARGIN = 0.10
SPAWN_MARGIN = 0.15

# The USD props are placed by their origins and their bounding boxes are not readable
# offline, so every check that involves one charges it this half-extent. It is deliberately
# generous: the vendor's own two-PackingTable call site
# (`base_scene_pickplace_cylindercfg_wholebody.py:35-53`) puts their origins 1.84 m apart,
# so the real half-extent is at most 0.92 m and is probably a good deal less. Charging the
# larger number means a PASS here is a real statement and a FAIL is worth investigating.
PROP_HALF_EXTENT = 1.0
PROP_ROUTE_CLEARANCE = 0.60   # clearance a prop must leave beside a walking route
PROP_PAIR_CLEARANCE = 0.10    # clearance a prop must leave against any other body

# The tallest a prop table is assumed to stand, for deciding which declared boxes it could
# possibly collide with. All five props are tables; the tallest thing in the checkout's
# `assets/objects/` that any of them could be is well under a metre.
PROP_ASSUMED_HEIGHT = 1.0

# Radius of the G1's foot contact spheres, from the MJCF's `default class="foot"`
# (`<geom type="sphere" size="0.005" .../>`). Section 16 adds it to the forward sphere
# offset to get the real forward foot reach.
FOOT_SPHERE_RADIUS = 0.005


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


# ------------------------------------------------------------------------------------------
# Segment vs axis-aligned rectangle, in the floor plane.
#
# WHY THIS EXISTS, AND WHY THE CIRCLE MODEL COULD NOT BE STRETCHED TO COVER WALLS
# ------------------------------------------------------------------------------
# The route check used to model every obstacle as a point plus `half = max(w, d) / 2`,
# i.e. a circle. That is fine for a column and tolerable for a crate, and it is the only
# thing available for a USD prop whose footprint cannot be read offline. It is useless for
# a wall: `wall_south` is 24.4 m long, so its circle has a radius of 12.2 m and every route
# in the hall is "inside" it. Rather than write a check that fails on correct geometry, the
# original author excluded every wall by name -- which meant the straight line from the
# spawn to the door was never tested against any wall at all, and a spawn moved to the far
# side of `pause_wall_west` still reported a clear route.
#
# So walls (and the columns, crates and the table, whose footprints are all known exactly)
# get the real test: the true minimum distance between the travelled segment and the
# obstacle's actual rectangle. No door aperture has to be carved out by hand for this,
# because the aperture is a genuine hole in the geometry -- `pause_wall_south_left` stops
# at x = 9.30 and `pause_wall_south_right` starts at x = 10.70, and the lintel over the
# gap starts above `WALK_CLEARANCE_Z` and is filtered out by `blocking_boxes`. A route that
# ends at the door centre therefore measures its clearance against the two JAMBS, which is
# the physically meaningful question.
# ------------------------------------------------------------------------------------------
def point_rect_distance(p, rect) -> float:
    """Distance from a point to an axis-aligned rectangle ((x0, x1), (y0, y1)). 0 if inside."""
    (x0, x1), (y0, y1) = rect
    return math.hypot(max(x0 - p[0], 0.0, p[0] - x1), max(y0 - p[1], 0.0, p[1] - y1))


def seg_rect_intersects(a, b, rect) -> bool:
    """Separating-axis test between a segment and an axis-aligned rectangle.

    Three candidate axes suffice for two convex 2-D shapes when one of them is a segment:
    the rectangle's own two axes, and the segment's normal. Both segment endpoints project
    to the SAME value on that normal (the normal is perpendicular to the segment), so the
    third test is "does the rectangle's projected interval contain that one value".
    """
    (x0, x1), (y0, y1) = rect
    if max(a[0], b[0]) < x0 or min(a[0], b[0]) > x1:
        return False
    if max(a[1], b[1]) < y0 or min(a[1], b[1]) > y1:
        return False
    dx, dy = b[0] - a[0], b[1] - a[1]
    if dx == 0.0 and dy == 0.0:
        return True  # degenerate segment: the two range tests already answered it
    nx, ny = -dy, dx
    s = nx * a[0] + ny * a[1]
    proj = [nx * cx + ny * cy for cx in (x0, x1) for cy in (y0, y1)]
    return min(proj) <= s <= max(proj)


def seg_rect_distance(a, b, rect) -> float:
    """True minimum distance between segment [a, b] and an axis-aligned rectangle.

    0.0 when they intersect. Otherwise the closest pair is either an endpoint of the
    segment against the rectangle, or a corner of the rectangle against the segment --
    the standard result for two disjoint convex polygons, and cheap enough to just
    enumerate.
    """
    if seg_rect_intersects(a, b, rect):
        return 0.0
    (x0, x1), (y0, y1) = rect
    best = min(point_rect_distance(a, rect), point_rect_distance(b, rect))
    for corner in ((x0, y0), (x0, y1), (x1, y0), (x1, y1)):
        best = min(best, point_seg_distance(corner, a, b))
    return best


def box_overlap_depth(ea, eb) -> float:
    """How deeply two axis-aligned boxes interpenetrate, in metres.

    Takes two `box_extent` triples. Positive means real interpenetration on every axis, and
    the number returned is the depth on the axis where they overlap LEAST -- i.e. how far
    one would have to move to separate them. Zero or negative means they touch or are
    apart, which is what abutting walls do by design.
    """
    return min(min(a1, b1) - max(a0, b0) for (a0, a1), (b0, b1) in zip(ea, eb))


def walking_rects(L, exclude=()) -> list[tuple[str, tuple]]:
    """(name, rect) for every static box a walking G1 would collide with.

    Everything in `all_static_boxes()` whose z-range reaches into the walking envelope,
    plus the door leaves at FULL OPEN. The open leaves belong here: by the time the robot
    is anywhere near the doorway the presence sensor has had it open for many seconds
    (section 13 proves the stroke finishes first), so the open leaf positions -- not the
    shut ones -- are the geometry a walking route has to miss.
    """
    out = []
    for name, box in L.all_static_boxes().items():
        if name in exclude:
            continue
        (x0, x1), (y0, y1), (z0, z1) = L.box_extent(box)
        if z1 > EPS and z0 < L.WALK_CLEARANCE_Z - EPS:
            out.append((name, ((x0, x1), (y0, y1))))
    for name, box in L.door_leaf_boxes(1.0).items():
        (x0, x1), (y0, y1), (z0, z1) = L.box_extent(box)
        if z1 > EPS and z0 < L.WALK_CLEARANCE_Z - EPS:
            out.append((f"{name} (open)", ((x0, x1), (y0, y1))))
    return out


def tightest_rect(L, a, b, exclude=()):
    """(name, distance) of the static box nearest the segment [a, b]. Exact, not circular."""
    worst = None
    for name, rect in walking_rects(L, exclude):
        d = seg_rect_distance(a, b, rect)
        if worst is None or d < worst[1]:
            worst = (name, d)
    return worst


def tightest_prop(L, a, b):
    """(name, clearance) of the USD prop nearest the segment [a, b], circle model.

    Their footprints are not readable offline, so they keep the point-plus-generous-radius
    treatment. This is the ONE place that model is still the best available, rather than a
    shortcut around geometry that is right there in the layout module.
    """
    worst = None
    for name, prop in L.USD_PROPS.items():
        clear = point_seg_distance((prop["pos"][0], prop["pos"][1]), a, b) - PROP_HALF_EXTENT
        if worst is None or clear < worst[1]:
            worst = (name, clear)
    return worst


def check_lane(rep: Report, L, label: str, a, b, exclude=(), props: bool = True) -> None:
    """Assert that a straight walk from `a` to `b` fits, against real wall rectangles."""
    name, d = tightest_rect(L, a, b, exclude)
    clear = d - G1_BODY_RADIUS
    how = ("the line passes THROUGH it" if d <= EPS
           else f"{clear:.3f} m past a {G1_BODY_RADIUS:.2f} m body radius")
    rep.check(clear >= ROUTE_MARGIN,
              f"walls, columns and crates clear the {label} lane",
              f"tightest is {name} at {d:.3f} m from the line ({how}), "
              f"needs {ROUTE_MARGIN:.2f} m"
              + (f"; excluded: {', '.join(exclude)}" if exclude else ""))
    if props:
        pname, pclear = tightest_prop(L, a, b)
        rep.check(pclear >= PROP_ROUTE_CLEARANCE,
                  f"USD props clear the {label} lane",
                  f"tightest is {pname} at {pclear:.2f} m of clearance, charged a "
                  f"generous {PROP_HALF_EXTENT:.1f} m half-extent since USD footprints "
                  "are not readable offline")


# ==========================================================================================
# reading the MuJoCo twin
#
# The layout module's shoulder, arm and foot constants were all MEASURED off
# `../sim_evaluator/mjcf/g1_dex3/g1_43dof_fixedbase.xml`, and every one of them was a
# hand-typed literal justified by a comment. These three functions let section 16 re-derive
# them instead. The walk composes real rigid transforms -- MuJoCo expresses a child body's
# `pos` in its PARENT's frame and its `quat` as the parent-to-child rotation, so summing
# components across a body that carries a quat is wrong, and doing exactly that is how the
# layout module came to believe the G1's ankle sits 53 mm behind its pelvis when it sits
# directly beneath it.
# ==========================================================================================
def _quat_rotate_wxyz(q, v):
    """Rotate `v` by an MJCF quaternion given as (w, x, y, z)."""
    w, x, y, z = q
    t = (2.0 * (y * v[2] - z * v[1]),
         2.0 * (z * v[0] - x * v[2]),
         2.0 * (x * v[1] - y * v[0]))
    return (v[0] + w * t[0] + (y * t[2] - z * t[1]),
            v[1] + w * t[1] + (z * t[0] - x * t[2]),
            v[2] + w * t[2] + (x * t[1] - y * t[0]))


def _quat_mul_wxyz(a, b):
    aw, ax, ay, az = a
    bw, bx, by, bz = b
    return (aw * bw - ax * bx - ay * by - az * bz,
            aw * bx + ax * bw + ay * bz - az * by,
            aw * by - ax * bz + ay * bw + az * bx,
            aw * bz + ax * by - ay * bx + az * bw)


def load_mjcf_bodies(path: str) -> dict:
    """{body name: (parent name, pos, quat_wxyz, [(geom class, geom pos), ...])}."""
    import xml.etree.ElementTree as ET

    def triple(text, default=(0.0, 0.0, 0.0)):
        return tuple(float(v) for v in text.split()) if text else default

    out: dict = {}

    def walk(node, parent):
        for b in node.findall("body"):
            name = b.get("name")
            out[name] = (
                parent,
                triple(b.get("pos")),
                triple(b.get("quat"), (1.0, 0.0, 0.0, 0.0)),
                [(g.get("class"), triple(g.get("pos"))) for g in b.findall("geom")],
            )
            walk(b, name)

    for wb in ET.parse(path).getroot().iter("worldbody"):
        walk(wb, None)
    return out


def mjcf_pose_in(bodies: dict, name: str, root: str):
    """(position, quat) of `name` in `root`'s frame, with every joint at zero."""
    chain, cur = [], name
    while cur is not None and cur != root:
        chain.append(cur)
        cur = bodies[cur][0]
    if cur != root:
        raise KeyError(f"{name} is not a descendant of {root}")
    p, q = (0.0, 0.0, 0.0), (1.0, 0.0, 0.0, 0.0)
    for link in reversed(chain):
        _, lp, lq, _ = bodies[link]
        r = _quat_rotate_wxyz(q, lp)
        p = (p[0] + r[0], p[1] + r[1], p[2] + r[2])
        q = _quat_mul_wxyz(q, lq)
    return p, q


def mjcf_chain_length(bodies: dict, names) -> float:
    """Sum of the link offsets' lengths -- how far a serial chain reaches, dead straight."""
    return sum(math.dist((0.0, 0.0, 0.0), bodies[n][1]) for n in names)


# ==========================================================================================
# checks
# ==========================================================================================
def check_files(rep: Report) -> bool:
    section("0. the deliverable's own files")
    ok = True
    for path in (LAYOUT_PY, SCENE_PY, ENVCFG_PY, TASKINIT_PY):
        ok &= rep.check(os.path.isfile(path), f"exists: {os.path.relpath(path, HERE)}")
    for name in ("__init__.py", "observations.py", "pause_door.py", "rewards.py",
                 "terminations.py"):
        p = os.path.join(TASK_DIR, "mdp", name)
        ok &= rep.check(os.path.isfile(p), f"exists: {os.path.relpath(p, HERE)}")
    # The door's geometry and its generator. Both are install-map entries; section 14
    # checks their contents, this only proves they are here at all.
    for name in ("pause_room_door.usda", "make_pause_room_door_usda.py"):
        p = os.path.join(HERE, "common_scene", name)
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
    check_no_remote_paths(rep, paths)


def check_no_remote_paths(rep: Report, paths) -> None:
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
    # Against the id read out of __init__.py, NOT against GYM_ID. `"Wholebody" in GYM_ID`
    # only ever asked whether this file's own literal contained a substring of itself.
    rep.check(bool(ids) and "Wholebody" in ids[0],
              "the REGISTERED id contains 'Wholebody'",
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
    # This used to read `w * d >= 24.0 * 16.0`, which is a tautology: both factors come
    # from HALL, and HALL declares 24 x 16, so the assertion could only ever restate its
    # own input. The question worth asking is whether the interior HALL claims is the
    # interior the four perimeter wall boxes actually enclose -- two independently written
    # sets of numbers, either of which can be edited without the other. The area is then
    # reported rather than asserted.
    faces = {
        "x_min": L.box_extent(L.WALLS["wall_west"])[0][1],
        "x_max": L.box_extent(L.WALLS["wall_east"])[0][0],
        "y_min": L.box_extent(L.WALLS["wall_south"])[1][1],
        "y_max": L.box_extent(L.WALLS["wall_north"])[1][0],
    }
    off = {k: v - L.HALL[k] for k, v in faces.items()}
    rep.check(all(abs(v) < 1e-9 for v in off.values()),
              "the declared hall interior is the one the perimeter walls enclose",
              f"HALL {  {k: round(L.HALL[k], 3) for k in faces} } vs inner wall faces "
              f"{  {k: round(v, 3) for k, v in faces.items()} } "
              f"-> {w:.1f} x {d:.1f} m = {w * d:.0f} m^2 of clear floor")
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
    pw = L.PAUSE_ROOM["x_max"] - L.PAUSE_ROOM["x_min"]
    pd = L.PAUSE_ROOM["y_max"] - L.PAUSE_ROOM["y_min"]
    # `pw >= 3.5 and pd >= 3.5` was a tautology over PAUSE_ROOM's own constants and could
    # not fail. The real question is the same one section 5 asks of the hall: are the four
    # sides PAUSE_ROOM declares the four surfaces that are actually there? Its west and
    # south sides are new partitions; its north and east sides ARE the hall's walls, so
    # those are checked against HALL rather than against a partition that does not exist.
    proom = {
        "x_min": L.box_extent(L.WALLS["pause_wall_west"])[0][1],
        "y_min": L.box_extent(L.WALLS["pause_wall_south_left"])[1][1],
        "x_max": L.HALL["x_max"],
        "y_max": L.HALL["y_max"],
    }
    rep.check(all(abs(v - L.PAUSE_ROOM[k]) < 1e-9 for k, v in proom.items()),
              "the declared pause-room interior is the one its partitions and the hall walls enclose",
              f"PAUSE_ROOM { {k: round(L.PAUSE_ROOM[k], 3) for k in proom} } vs enclosing "
              f"faces { {k: round(v, 3) for k, v in proom.items()} } -> {pw:.1f} x {pd:.1f} m")
    rep.check(abs(L.box_extent(L.WALLS["pause_wall_south_right"])[1][1] - L.PAUSE_ROOM["y_min"]) < 1e-9,
              "both south partitions stand on the same line",
              "a doorway whose two jambs are in different walls is not a doorway")

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
    # Clamp each axis at zero. `abs(offset) - jitter` goes NEGATIVE once the jitter can
    # carry the apple past the plate on that axis, and `hypot` then squares the sign away
    # and reports a distance that is too LARGE -- i.e. the check would understate an
    # overlap in exactly the case where the overlap is worst. Today the offsets (0.17,
    # 0.095) dwarf the jitter (0.03, 0.03) so it never bites; it is a latent trap, not a
    # live bug, and it costs two `max` calls to disarm.
    worst = math.hypot(max(0.0, abs(ax - px) - jx), max(0.0, abs(ay - py) - jy))
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

    # ---- nothing may sit on the straight line the robot would take to the door ---------
    #
    # This test used to skip every box whose name began "wall_", "pause_wall_" or
    # "pause_door", plus the table. The exclusion was not laziness -- the circle model it
    # used turns a 24 m wall into a 12 m disc, which fails on correct geometry -- but the
    # consequence was that no wall was ever tested, and a spawn moved to (4.0, 6.0), whose
    # straight line to the door runs clean through `pause_wall_west`, still reported a
    # clear route. Walls now get an exact segment-vs-rectangle test (see
    # `seg_rect_distance`), so nothing has to be excluded here at all: the doorway is a
    # real gap between two partition boxes, and the lintel over it is above
    # WALK_CLEARANCE_Z and already filtered out.
    lane_a, lane_b = (rx, ry), L.DOOR["centre"]
    check_lane(rep, L, "spawn -> door", lane_a, lane_b)

    # and the robot must not spawn inside anything
    spawn_pad = G1_BODY_RADIUS + SPAWN_MARGIN
    inside = None
    for name, rect in walking_rects(L):
        d = point_rect_distance((rx, ry), rect)
        if d < spawn_pad and (inside is None or d < inside[1]):
            inside = (name, d)
    rep.check(inside is None, "the robot does not spawn inside geometry",
              f"{spawn_pad:.2f} m ({G1_BODY_RADIUS:.2f} m body radius + "
              f"{SPAWN_MARGIN:.2f} m, because a spawn pose is placed rather than walked "
              "to) clear of every box"
              if inside is None else f"only {inside[1]:.3f} m from {inside[0]}")

    check_selectable_spawns(rep, L, spawn_pad)


def check_selectable_spawns(rep: Report, L, spawn_pad: float) -> None:
    """Everything above measures ONE pose. `NEODEM_ROBOT_SPAWN` means there are several.

    The scene can now be launched with the robot standing at a named place instead of at
    the authored start -- that is how a manipulation test skips a walk that does not work
    yet (TASK-228: the robot jams on the door frame). The spawn that ships is therefore no
    longer necessarily the spawn that was checked, which is the same shape of gap as
    section 12's: a guarantee that holds only for the default is not a guarantee about the
    scene. So every selectable spawn gets the checks the default one gets.

    `pause_table` is excluded from the clearance test for the same reason section 12
    excludes it: `table_front` is DERIVED to stand TABLE_STANDOFF = 0.16 m off the table's
    near face, which is inside any body radius worth charging. What must not foul the table
    is the FEET, and section 11 asserts that directly against FOOT_FRONT_REACH.
    """
    print()
    default = L.robot_spawn("")
    rep.check(default["pos"] is L.ROBOT["pos"]
              and default["yaw_deg"] == L.ROBOT["yaw_deg"]
              and default["name"] is None,
              f"an unset {L.ROBOT_SPAWN_ENV_VAR} reproduces the authored pose EXACTLY",
              f"robot_spawn('') -> pos {default['pos']} yaw {default['yaw_deg']} "
              f"vs ROBOT pos {L.ROBOT['pos']} yaw {L.ROBOT['yaw_deg']} -- identical "
              "objects, not merely equal numbers, so the default launch path is the one "
              "every check above measured")

    names = L.selectable_spawns()
    rep.check(bool(names) and all(n in L.PLACES and n in L.PLACE_HEADINGS for n in names),
              "a spawn is selectable only where a place declares BOTH a point and a heading",
              f"selectable: {', '.join(names)}; PLACES without a heading are refused "
              f"({', '.join(sorted(set(L.PLACES) - set(L.PLACE_HEADINGS)))}) because a "
              "point is not a pose")

    # The two ways to get it wrong must both raise. A resolver that silently fell back to
    # the authored pose on a typo would put the robot 8 m from where the operator meant and
    # nothing downstream would say so -- the failure would surface as a manipulation that
    # missed, which is the most expensive place to discover a spawn bug.
    for bad, why in (("not_a_place", "a name that is in neither dict"),
                     (sorted(set(L.PLACES) - set(L.PLACE_HEADINGS))[0],
                      "a place with coordinates but no heading")):
        try:
            L.robot_spawn(bad)
        except ValueError as exc:
            msg = str(exc)
            rep.check(L.ROBOT_SPAWN_ENV_VAR in msg and bad in msg
                      and all(n in msg for n in names),
                      f"{L.ROBOT_SPAWN_ENV_VAR}={bad!r} is REFUSED, not silently defaulted",
                      f"{why}; the message names the variable, the value and all "
                      f"{len(names)} selectable spawns")
        else:
            rep.bad(f"{L.ROBOT_SPAWN_ENV_VAR}={bad!r} is REFUSED, not silently defaulted",
                    f"{why} -- but robot_spawn() returned a pose instead of raising")

    for name in names:
        spawn = L.robot_spawn(name)
        x, y, z = spawn["pos"]
        rep.check((x, y) == L.PLACES[name]
                  and spawn["yaw_deg"] == L.PLACE_HEADINGS[name]
                  and z == L.ROBOT["pos"][2],
                  f"spawn '{name}' is the authored place, at the authored spawn HEIGHT",
                  f"({x:.3f}, {y:.3f}) from PLACES, yaw {spawn['yaw_deg']:.0f} deg from "
                  f"PLACE_HEADINGS, z = {z:.2f} from ROBOT -- a place carries no height "
                  "and must not invent one")

        worst = None
        for bname, rect in walking_rects(L, exclude=("pause_table",)):
            d = point_rect_distance((x, y), rect)
            if worst is None or d < worst[1]:
                worst = (bname, d)
        rep.check(worst[1] >= spawn_pad,
                  f"spawn '{name}' does not place the robot inside geometry",
                  f"nearest is {worst[0]} at {worst[1]:.3f} m, against a {spawn_pad:.2f} m "
                  f"pad ({G1_BODY_RADIUS:.2f} m body radius + {SPAWN_MARGIN:.2f} m, "
                  "because a spawn pose is placed rather than walked to); the table is "
                  "excluded -- standing 0.16 m off it is the design, and section 11 checks "
                  "the feet against it")

        rep.check(L.HALL["x_min"] < x < L.HALL["x_max"]
                  and L.HALL["y_min"] < y < L.HALL["y_max"],
                  f"spawn '{name}' is inside the building", f"({x:.2f}, {y:.2f})")

    # ---- the SHUT door, which a spawn does not get to assume away ----------------------
    #
    # `walking_rects` models the door leaves at FULL OPEN, and for a ROUTE that is right:
    # by the time the robot walks up to the doorway the presence sensor has had the leaves
    # open for many seconds. A spawn is placed at t = 0, when the leaves are shut and the
    # driver's openness is still 0.0 (`PauseDoorDriver.__init__`), and the stroke then
    # takes 1.17 s. So the shut leaves are real geometry for a spawn and only for a spawn.
    #
    # This is not a hypothetical: `pause_room_door` is selectable -- it is in PLACES and it
    # declares a heading -- and it sits 0.100 m from a shut leaf, well inside the 0.40 m
    # pad. Its heading exists so a route can pass THROUGH the doorway facing the table, not
    # so anything can stand there. Spawning at it would start the robot interpenetrating a
    # 25 kg leaf on a stiff position drive.
    #
    # The assertion is therefore about the SET, not about one name: exactly one selectable
    # spawn fouls the shut door, and it is the doorway itself. That fires if a new place
    # acquires a heading somewhere in the door's swept box, and it fires again if
    # `pause_room_door` is ever made standable or dropped -- either way the comment above
    # would be stale, and a stale comment about the spawn is what this section exists for.
    shut_rects = [(n, (L.box_extent(b)[0], L.box_extent(b)[1]))
                  for n, b in L.door_leaf_boxes(0.0).items()]
    clearances = {}
    for name in names:
        x, y, _ = L.robot_spawn(name)["pos"]
        clearances[name] = min(point_rect_distance((x, y), r) for _, r in shut_rects)
    fouls = tuple(n for n in names if clearances[n] < spawn_pad)
    rep.check(fouls == ("pause_room_door",),
              "the only selectable spawn that starts inside the SHUT door is the doorway itself",
              "shut-leaf clearance: "
              + "; ".join(f"{n} {clearances[n]:.3f} m" for n in names)
              + f" against the same {spawn_pad:.2f} m pad. 'pause_room_door' declares a "
              "heading so a route can walk THROUGH it, not so anything can stand in it -- "
              "it is a waypoint, not a manipulation spawn. 'table_front' is the spawn this "
              "feature exists for and it clears the shut leaves outright.")


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
    # NOTE: the check that used to live here asked for MORE than 0.4 m of standing room in
    # front of the table, and passed on the old (10.00, 5.35) with 0.65 m. It was the wrong
    # question in the wrong direction: standing further back is not safer, it is what put
    # the apple out of reach. The clearance is now asserted to EQUAL the declared standoff,
    # and section 12 asks whether the robot can actually reach anything from here.
    rep.check(abs((ty0 - fy) - L.TABLE_STANDOFF) < 1e-9,
              "'table_front' stands exactly the declared standoff from the table",
              f"{ty0 - fy:.3f} m from the table's near face, declared "
              f"TABLE_STANDOFF = {L.TABLE_STANDOFF:.3f} m")
    rep.check(L.TABLE_STANDOFF >= L.FOOT_FRONT_REACH,
              "...and that standoff clears the robot's own feet",
              f"standoff {L.TABLE_STANDOFF:.3f} m vs feet reaching "
              f"{L.FOOT_FRONT_REACH:.3f} m ahead of the pelvis "
              f"-> {L.TABLE_STANDOFF - L.FOOT_FRONT_REACH:.3f} m to spare")
    rep.check(abs(fx - (L.APPLE["pos"][0] + L.GRASP_LATERAL_OFFSET)) < 1e-9,
              "'table_front' is derived from the apple, not hand-typed",
              f"apple x {L.APPLE['pos'][0]:.3f} + lateral offset "
              f"{L.GRASP_LATERAL_OFFSET:.3f} = {fx:.3f}")


def check_reach(rep: Report, L) -> None:
    """THE CHECK THAT WAS MISSING.

    The scene's first version declared `table_front` at (10.00, 5.35) and nothing anywhere
    compared it to where the apple is. It was 0.926 m from the pelvis and 0.992 m from the
    shoulder -- roughly twice a G1's usable arm -- and every other check passed, because
    every other check asked about the apple and the table without ever mentioning the
    robot. This section is the one that closes that: it measures shoulder-to-target
    distances against an explicit, documented budget.
    """
    section("12. the robot can actually reach the apple from where it is told to stand")
    stand = L.PLACES["table_front"]
    yaw = L.TABLE_APPROACH_YAW_DEG
    apple = tuple(L.APPLE["pos"])
    plate = (L.PLATE["pos"][0], L.PLATE["pos"][1],
             L.PLATE["pos"][2] + L.PLATE["height"] / 2)   # the rim: where a place lands
    lo_z, hi_z = L.BASE_HEIGHT_BAND

    rep.check(L.GRASP_REACH_BUDGET <= L.ARM_REACH_TO_FINGERTIP,
              "the reach budget is inside the arm's geometric limit",
              f"budget {L.GRASP_REACH_BUDGET:.3f} m vs "
              f"{L.ARM_REACH_TO_FINGERTIP:.3f} m shoulder-to-fingertip with the arm "
              f"straight (summed from g1_43dof_fixedbase.xml); grasp centre "
              f"(the knuckle) is at {L.ARM_REACH_TO_KNUCKLE:.3f} m")
    # ...and the budget is deliberately PAST the knuckle, which is worth stating out loud
    # rather than leaving as an arithmetic accident. Everything between 0.533 and 0.550 is
    # reachable only with the arm essentially straight, or by pitching the waist and
    # bending the knees toward the table -- which a free-standing G1 can do and both fixed-
    # base reference scenes cannot. The bound below is what stops that slack from growing
    # silently: the budget may sit beyond the knuckle, but not by more than 0.02 m.
    over = L.GRASP_REACH_BUDGET - L.ARM_REACH_TO_KNUCKLE
    rep.check(over <= 0.02,
              "the budget is at most 20 mm past straight-arm knuckle range",
              f"budget {L.GRASP_REACH_BUDGET:.3f} m is {1000 * over:+.1f} mm past the "
              f"{L.ARM_REACH_TO_KNUCKLE:.3f} m knuckle distance -- the old check printed "
              "this number in its detail string and never compared anything to it, which "
              "is the same shape of miss as the section 11 bug")

    # The two configurations in which a G1 + Dex3 is KNOWN to pick an object off a table.
    # Recomputed here, from this module's own shoulder constants, rather than quoted -- if
    # SHOULDER_ABOVE_PELVIS is ever edited, these move too and the budget is re-justified.
    for label, pelvis, obj, src in (
        ("vendor pick_place_cylinder_g1_29dof_dex3", (-0.15, 0.0, 0.76), (-0.35, 0.40, 0.84),
         "base_scene_pickplace_cylindercfg.py:95 + robot_configs.py:274"),
        ("MJCF twin g1_apple_pnp_scene.xml", (-0.15, 0.0, 0.76), (-0.22, 0.46, 0.789),
         "sim_evaluator/mjcf/g1_apple_pnp_scene.xml:128"),
    ):
        d = L.grasp_reach((pelvis[0], pelvis[1]), pelvis[2], 90.0, obj)
        rep.check(d <= L.GRASP_REACH_BUDGET,
                  f"the budget covers a WORKING reference: {label}",
                  f"shoulder->object {d:.3f} m <= budget {L.GRASP_REACH_BUDGET:.3f} m  ({src})")

    # The scene itself, at both ends of the observed base-height band.
    worst_apple = 0.0
    for base_z in (lo_z, hi_z):
        d = L.grasp_reach(stand, base_z, yaw, apple)
        worst_apple = max(worst_apple, d)
        rep.check(d <= L.GRASP_REACH_BUDGET,
                  f"the apple is in reach at base_z = {base_z:.3f} m",
                  f"shoulder->apple {d:.3f} m vs budget {L.GRASP_REACH_BUDGET:.3f} m")
    for base_z in (lo_z, hi_z):
        d = L.grasp_reach(stand, base_z, yaw, plate)
        rep.check(d <= L.GRASP_REACH_BUDGET,
                  f"the plate is in reach at base_z = {base_z:.3f} m",
                  f"shoulder->plate rim {d:.3f} m vs budget {L.GRASP_REACH_BUDGET:.3f} m "
                  "(the apple has to be PUT somewhere too)")

    # ...and at every corner of the box the reset event re-samples the apple over. The
    # standing spot is fixed before the apple is jittered, so the nominal spawn being
    # reachable proves nothing about the episode that actually runs.
    jx, jy = L.APPLE_RESET_JITTER["x"], L.APPLE_RESET_JITTER["y"]
    worst, worst_at = 0.0, None
    per_height = {}
    for sx in (-jx, jx):
        for sy in (-jy, jy):
            for base_z in (lo_z, hi_z):
                d = L.grasp_reach(stand, base_z, yaw,
                                  (apple[0] + sx, apple[1] + sy, apple[2]))
                per_height[base_z] = max(per_height.get(base_z, 0.0), d)
                if d > worst:
                    worst, worst_at = d, (sx, sy, base_z)
    rep.check(worst <= L.GRASP_REACH_BUDGET,
              "the apple stays in reach at every corner of the reset-jitter box",
              f"worst {worst:.3f} m at dx={worst_at[0]:+.2f} dy={worst_at[1]:+.2f} "
              f"base_z={worst_at[2]:.3f} vs budget {L.GRASP_REACH_BUDGET:.3f} m")

    # THE BUDGET IS NOT THE ARM. Every check above compares against GRASP_REACH_BUDGET,
    # and the budget is 17 mm beyond ARM_REACH_TO_KNUCKLE -- so "within budget" and
    # "within a straight arm" are not the same statement, and the checks above only ever
    # made the first one. Made explicit here, at both ends of the height band, because the
    # two ends answer differently and the difference is the interesting part:
    #
    #   * at 0.725 m -- the settled crouch the README's live run says the robot is
    #     actually in after a walk command stops -- the worst jitter corner is comfortably
    #     inside straight-arm knuckle range. That is asserted.
    #   * at 0.790 m -- standing tall -- it is a few millimetres OUTSIDE it, and is
    #     reachable only with the arm essentially straight, or by leaning. That is
    #     asserted too, but against the fingertip, with the overage reported.
    rep.check(per_height[lo_z] <= L.ARM_REACH_TO_KNUCKLE,
              "at the settled crouch, the worst jitter corner is inside straight-arm "
              "KNUCKLE range",
              f"{per_height[lo_z]:.4f} m at base_z {lo_z:.3f} vs "
              f"{L.ARM_REACH_TO_KNUCKLE:.3f} m -- "
              f"{1000 * (L.ARM_REACH_TO_KNUCKLE - per_height[lo_z]):.1f} mm to spare")
    rep.check(per_height[hi_z] <= L.ARM_REACH_TO_FINGERTIP,
              "standing tall, the worst jitter corner is at least inside FINGERTIP range",
              f"{per_height[hi_z]:.4f} m at base_z {hi_z:.3f} is "
              f"{1000 * (per_height[hi_z] - L.ARM_REACH_TO_KNUCKLE):+.1f} mm past the "
              f"{L.ARM_REACH_TO_KNUCKLE:.3f} m knuckle distance and "
              f"{1000 * (L.ARM_REACH_TO_FINGERTIP - per_height[hi_z]):.1f} mm inside the "
              f"{L.ARM_REACH_TO_FINGERTIP:.3f} m fingertip limit -- the standing end of "
              "the band needs a straight arm or a lean; the crouched end does not")

    # A blunt horizontal number, because that is the one a human eyeballs on the map.
    horiz = math.hypot(stand[0] - apple[0], stand[1] - apple[1])
    rep.check(horiz < 0.60, "horizontal pelvis->apple distance is arm-sized",
              f"{horiz:.3f} m  (the hand-typed (10.00, 5.35) this replaced: 0.926 m)")

    # The waypoint must NOT be mistaken for a manipulation pose.
    cx, cy = L.PLACES["pause_room_centre"]
    d_centre = L.grasp_reach((cx, cy), hi_z, yaw, apple)
    rep.check(d_centre > L.GRASP_REACH_BUDGET,
              "'pause_room_centre' is a waypoint, NOT a place to reach from",
              f"shoulder->apple {d_centre:.3f} m from there -- documented as out of reach "
              "on purpose, so nobody re-uses it as a standing spot")

    # Standing at the table must not put the robot inside the table.
    (tx0, tx1), (ty0, ty1), (_tz0, tz1) = L.box_extent(L.TABLE)
    rep.check(stand[1] + L.FOOT_FRONT_REACH <= ty0 + EPS,
              "the robot's feet do not foul the table box",
              f"toes reach y = {stand[1] + L.FOOT_FRONT_REACH:.3f}, table near face "
              f"y = {ty0:.2f}")
    rep.check(tx0 <= stand[0] <= tx1,
              "the robot stands square to the table, not off its end",
              f"stand x {stand[0]:.2f} within table x[{tx0:.2f},{tx1:.2f}]")

    # ---- the target has to be in FRONT of the robot, not merely near it ----------------
    #
    # `grasp_reach` is a scalar shoulder-to-target distance, and yaw only moves the
    # shoulder +/-0.10 m sideways -- so every distance check above survives turning the
    # robot to face anywhere at all. Setting TABLE_APPROACH_YAW_DEG to 0, which stands the
    # robot side-on with the apple across its body, changed nothing. A sphere is not a
    # workspace: an arm reaches forward, and `PLACE_HEADINGS` already documents that the
    # heading at this place is load-bearing. These are the checks that make it so.
    a = math.radians(yaw)
    fwd_v, left_v = (math.cos(a), math.sin(a)), (-math.sin(a), math.cos(a))

    def body_frame(target):
        v = (target[0] - stand[0], target[1] - stand[1])
        return (v[0] * fwd_v[0] + v[1] * fwd_v[1], v[0] * left_v[0] + v[1] * left_v[1])

    apple_fwd, apple_left = body_frame(apple)
    plate_fwd, plate_left = body_frame(plate)
    for label, (f_, l_) in (("apple", (apple_fwd, apple_left)), ("plate", (plate_fwd, plate_left))):
        rep.check(f_ >= 0.15, f"the {label} is in front of the robot, not beside it",
                  f"{f_:+.3f} m ahead, {l_:+.3f} m to the left, at yaw {yaw:.0f} deg")
    bearing_err = abs(math.degrees(math.atan2(apple_left, apple_fwd)))
    rep.check(bearing_err <= 45.0,
              "the robot's heading at 'table_front' actually points at the apple",
              f"{bearing_err:.1f} deg off the facing direction, against a "
              f"TABLE_APPROACH_YAW_DEG of {yaw:.0f}")
    rep.check(abs(apple_left - L.GRASP_LATERAL_OFFSET) < 1e-9,
              "the apple falls exactly GRASP_LATERAL_OFFSET to the robot's LEFT",
              f"{apple_left:.3f} m vs declared {L.GRASP_LATERAL_OFFSET:.3f} m -- the spot "
              "is derived to make this true, so it only stays true while the arrival "
              "heading is the one the derivation assumed")
    rep.check(plate_left < apple_left,
              "...and the plate is to the apple's right, as in the training frames",
              f"plate {plate_left:+.3f} m vs apple {apple_left:+.3f} m in the body frame; "
              "every episode in the source dataset is a left-hand grasp with the place "
              "target outboard to the right")

    # ---- and it must be able to get there ----------------------------------------------
    rep.check(L.PAUSE_ROOM["x_min"] < stand[0] < L.PAUSE_ROOM["x_max"]
              and L.PAUSE_ROOM["y_min"] < stand[1] < L.PAUSE_ROOM["y_max"],
              "'table_front' is inside the pause room", f"({stand[0]:.2f}, {stand[1]:.2f})")
    leaves = L.door_leaf_boxes(1.0)
    clear = min(abs(stand[1] - L.box_extent(b)[1][1]) for b in leaves.values())
    rep.check(clear > 0.5, "'table_front' is clear of the open door leaves",
              f"{clear:.2f} m from the leaves' plane at y = "
              f"{L.box_extent(next(iter(leaves.values())))[1][1]:.2f}")

    # The standing spot itself, and the second leg of the walk, against real rectangles --
    # the same treatment section 8 gives the first leg. Before this, `table_front` was
    # tested only against the pause room's bounding box, with no body radius at all: a
    # crate dropped exactly on the standing spot, or a new partition built across the path
    # from the doorway to the table, passed every check in this file.
    #
    # `pause_table` is excluded from BOTH, and that exclusion is the point of the scene
    # rather than a hole in the check: the robot is deliberately told to stand
    # TABLE_STANDOFF = 0.16 m from the table's near face, which is inside any body radius
    # worth charging. What must not foul the table is the FEET, and that is asserted
    # directly, a few lines above, against FOOT_FRONT_REACH.
    stand_worst = None
    for name, rect in walking_rects(L, exclude=("pause_table",)):
        d = point_rect_distance(stand, rect)
        if stand_worst is None or d < stand_worst[1]:
            stand_worst = (name, d)
    rep.check(stand_worst[1] >= G1_BODY_RADIUS + ROUTE_MARGIN,
              "'table_front' has room for the robot's own body",
              f"nearest is {stand_worst[0]} at {stand_worst[1]:.3f} m, against a "
              f"{G1_BODY_RADIUS:.2f} m body radius + {ROUTE_MARGIN:.2f} m "
              "(the table itself is excluded -- standing 0.16 m off it is the design, and "
              "the feet are checked against it separately)")
    check_lane(rep, L, "door -> table_front", L.DOOR["centre"], stand,
               exclude=("pause_table",), props=False)


def check_door(rep: Report, L) -> None:
    section("13. the pause-room door is a real, powered, articulated door")
    dx = L.DOOR["centre"][0]
    jamb_lo = dx - L.DOOR["width"] / 2
    jamb_hi = dx + L.DOOR["width"] / 2

    # -- the geometry actually closes the hole -------------------------------------------
    shut = L.door_leaf_boxes(0.0)
    spans = sorted(L.box_extent(b)[0] for b in shut.values())
    covered_lo = min(s[0] for s in spans)
    covered_hi = max(s[1] for s in spans)
    # two leaves, sorted; they must meet or overlap in the middle, with no gap between them
    gap = spans[1][0] - spans[0][1]
    rep.check(covered_lo <= jamb_lo + EPS and covered_hi >= jamb_hi - EPS and gap <= EPS,
              "SHUT, the leaves cover the whole declared opening",
              f"leaves cover x[{covered_lo:.3f},{covered_hi:.3f}] over an opening of "
              f"x[{jamb_lo:.2f},{jamb_hi:.2f}]; leaf-to-leaf gap {gap * 1000:.1f} mm -- "
              "which is a sealed door and also a zero-clearance collider pair, inside "
              "PhysX's 0.02 m default contact offset, since leaf-leaf collision is not "
              "filtered (the joints' collisionEnabled=0 only filters leaf-to-rail)")
    rep.check(abs(L.door_clear_width(0.0)) < EPS,
              "SHUT, the doorway offers zero clear width",
              "a robot walking into it hits 2 x 25 kg of box collider, not a hole")

    # -- and gets out of the way completely ----------------------------------------------
    openb = L.door_leaf_boxes(1.0)
    ospans = sorted(L.box_extent(b)[0] for b in openb.values())
    rep.check(ospans[0][1] <= jamb_lo + EPS and ospans[1][0] >= jamb_hi - EPS,
              "OPEN, neither leaf intrudes on the opening",
              f"leaf edges at x = {ospans[0][1]:.3f} and {ospans[1][0]:.3f}, "
              f"jambs at {jamb_lo:.2f} and {jamb_hi:.2f}")
    rep.check(abs(L.door_clear_width(1.0) - L.DOOR["width"]) < 1e-9,
              "OPEN, the full declared clear width is restored",
              f"{L.door_clear_width(1.0):.3f} m == DOOR['width'] {L.DOOR['width']:.2f} m")
    # an open leaf must be parked over its own partition, not sticking into the room
    for name, seg, wall in ((L.DOOR_JOINTS[0], ospans[0], "pause_wall_south_left"),
                            (L.DOOR_JOINTS[1], ospans[1], "pause_wall_south_right")):
        (wx0, wx1), _, _ = L.box_extent(L.WALLS[wall])
        rep.check(wx0 - EPS <= seg[0] and seg[1] <= wx1 + EPS,
                  f"OPEN, {name}'s leaf parks over {wall}",
                  f"leaf x[{seg[0]:.2f},{seg[1]:.2f}] within wall x[{wx0:.2f},{wx1:.2f}] "
                  "-- a leaf hanging past the partition would be a new obstacle")

    # -- it blocks the height a robot walks through --------------------------------------
    (_, _, (lz0, lz1)) = L.box_extent(shut[L.DOOR_JOINTS[0]])
    rep.check(lz0 <= 0.05 and lz1 >= L.WALK_CLEARANCE_Z,
              "the leaves span the whole walking envelope",
              f"leaf z[{lz0:.3f},{lz1:.3f}] vs WALK_CLEARANCE_Z {L.WALK_CLEARANCE_Z:.2f} m; "
              f"{lz0 * 1000:.0f} mm floor gap so it does not scrape")
    rep.check(lz1 <= L.DOOR["clear_height"] + EPS,
              "the leaves fit under the lintel",
              f"leaf top z = {lz1:.3f}, lintel underside z = {L.DOOR['clear_height']:.2f}")

    # -- the leaves slide along the wall, not through it ---------------------------------
    #
    # This bound is TWO-SIDED on purpose. `ly0 >= wy1` alone says only that the leaves are
    # not inside the partition; it says nothing about how far in front of it they hang, so
    # moving DOOR_ORIGIN 0.6 m into the pause room -- which parks two 25 kg panels in mid
    # air, across the space the robot walks through, attached to nothing visible -- passed
    # every check in this file. The upper bound is what makes "hangs ON the wall" an
    # assertion rather than a description.
    #
    # Note also what the lower bound is worth: the leaf's near face and the partition's far
    # face are at the same y to six decimal places, so the clearance between them is
    # exactly 0.000 m for the whole stroke. That is inside PhysX's default 0.02 m contact
    # offset, so the pair generates contacts continuously. It is a jitter and performance
    # risk rather than a correctness one, and closing it means raising
    # DOOR_LEAF["wall_face_offset"] and regenerating the door USD -- see the README.
    LEAF_MOUNT_TOLERANCE = 0.05
    (_, (ly0, ly1), _) = L.box_extent(shut[L.DOOR_JOINTS[0]])
    (_, (wy0, wy1), _) = L.box_extent(L.WALLS["pause_wall_south_left"])
    rep.check(wy1 - EPS <= ly0 <= wy1 + LEAF_MOUNT_TOLERANCE + EPS,
              "the leaves hang FLUSH on the pause-room face of the partition",
              f"leaf y[{ly0:.3f},{ly1:.3f}] against a partition ending at y = {wy1:.2f} "
              f"-> {1000 * (ly0 - wy1):.0f} mm of standoff, allowed 0 to "
              f"{1000 * LEAF_MOUNT_TOLERANCE:.0f} mm; a leaf further out is a free-"
              "standing obstacle in the walk-through, and at 0 mm the leaf-to-wall pair "
              "sits inside PhysX's 0.02 m default contact offset")
    rail = L.door_rail_box()
    (rx0, rx1), (ry0, ry1), (rz0, rz1) = L.box_extent(rail)
    rep.check(rx0 <= ospans[0][0] + EPS and rx1 >= ospans[1][1] - EPS,
              "the header rail spans both leaves at full travel",
              f"rail x[{rx0:.2f},{rx1:.2f}] covers open leaves "
              f"x[{ospans[0][0]:.2f},{ospans[1][1]:.2f}]")
    rep.check(rz0 >= L.DOOR["clear_height"] - EPS,
              "the header rail is above the declared clear height",
              f"rail underside z = {rz0:.2f} vs clear height "
              f"{L.DOOR['clear_height']:.2f} -- it never narrows the doorway")

    # -- the joints ----------------------------------------------------------------------
    limits = L.door_joint_limits()
    rep.check(set(limits) == set(L.DOOR_JOINTS), "both leaf joints are declared",
              f"{sorted(limits)}")
    for name, (lo, hi) in sorted(limits.items()):
        rep.check(abs((hi - lo) - L.DOOR_LEAF_TRAVEL) < 1e-9 and lo <= 0.0 <= hi,
                  f"{name}: travel is one half-opening and 0 is SHUT",
                  f"limits [{lo:+.3f}, {hi:+.3f}] m, travel {L.DOOR_LEAF_TRAVEL:.3f} m")
    shut_t = L.door_joint_targets(0.0)
    open_t = L.door_joint_targets(1.0)
    rep.check(all(abs(v) < EPS for v in shut_t.values()),
              "openness 0 maps to joint coordinate 0 on both leaves", f"{shut_t}")
    rep.check(all(abs(abs(v) - L.DOOR_LEAF_TRAVEL) < 1e-9 for v in open_t.values())
              and open_t[L.DOOR_JOINTS[0]] * open_t[L.DOOR_JOINTS[1]] < 0,
              "openness 1 drives the two leaves in OPPOSITE directions",
              f"{ {k: round(v, 3) for k, v in open_t.items()} } -- same-sign targets would "
              "slide both leaves the same way and leave the doorway half shut")
    for u in (-0.5, 0.0, 0.37, 1.0, 1.5):
        t = L.door_joint_targets(u)
        ok = all(min(limits[n]) - EPS <= t[n] <= max(limits[n]) + EPS for n in t)
        rep.check(ok, f"openness {u:+.2f} stays inside the joint limits",
                  f"{ {k: round(v, 3) for k, v in t.items()} } (out-of-range openness is clamped)")

    # -- the presence sensor -------------------------------------------------------------
    a = L.DOOR_AUTOMATION
    rep.check(a["shut_radius"] > a["open_radius"],
              "the presence sensor has hysteresis",
              f"opens within {a['open_radius']:.2f} m, shuts beyond {a['shut_radius']:.2f} m "
              f"-> {a['shut_radius'] - a['open_radius']:.2f} m band; without it a robot "
              "standing on the threshold makes the leaves chatter")
    rep.check(L.door_should_open(L.DOOR["centre"], False),
              "standing in the doorway opens the door")
    rep.check(not L.door_should_open(L.PLACES["robot_start"], False),
              "the door is shut when the robot is across the hall",
              f"robot_start is {math.dist(L.PLACES['robot_start'], L.DOOR['centre']):.2f} m away")
    rep.check(L.door_should_open(L.PLACES["table_front"], False),
              "the door is open while the robot is at the table -- it can get out again",
              f"table_front is {math.dist(L.PLACES['table_front'], L.DOOR['centre']):.2f} m "
              "from the doorway")
    # hysteresis in both directions, at a distance between the two radii
    mid = (a["open_radius"] + a["shut_radius"]) / 2
    probe = (L.DOOR["centre"][0], L.DOOR["centre"][1] - mid)
    rep.check(L.door_should_open(probe, True) and not L.door_should_open(probe, False),
              "between the radii the door holds whatever state it is in",
              f"probed at {mid:.2f} m")

    # -- the door opens BEFORE the robot gets there --------------------------------------
    stroke_s = L.DOOR_LEAF_TRAVEL / a["leaf_speed"]
    # measured walk speed in this scene, from the README's live-sim section
    walk_speed = 0.11
    # NAME THE REFERENCE POINT. There are two defensible "time to arrive" numbers and they
    # differ by a factor of 1.4: trigger radius to the door CENTRE is 2.50 / 0.11 = 22.7 s
    # (that is the figure DOOR_AUTOMATION's comment quotes), and trigger radius to the near
    # EDGE of the doorway -- the first point at which a leaf could be in the way -- is
    # (2.50 - 0.70) / 0.11 = 16.4 s. This check uses the edge, because it is the earlier
    # and therefore the binding one.
    to_edge = a["open_radius"] - L.DOOR["width"] / 2
    arrive_s = to_edge / walk_speed
    rep.check(stroke_s < arrive_s,
              "the leaves finish opening before the robot reaches the doorway EDGE",
              f"full stroke {stroke_s:.2f} s vs {arrive_s:.1f} s to cover the "
              f"{to_edge:.2f} m from the trigger radius to the near edge of the opening "
              f"at the measured {walk_speed:.2f} m/s "
              f"({a['open_radius'] / walk_speed:.1f} s to the door centre) -- the robot "
              "never has to stop, and never has to push")
    # and the rate limiter must actually converge
    u, dt, n = 0.0, 0.02, 0
    while u < 1.0 - 1e-9 and n < 10000:
        u = L.door_advance_openness(u, True, dt)
        n += 1
    rep.check(u >= 1.0 - 1e-9 and abs(n * dt - stroke_s) < 2 * dt,
              "the leaf rate limiter reaches fully open in the time it claims",
              f"{n} steps of {dt} s = {n * dt:.2f} s vs {stroke_s:.2f} s predicted")
    u, n = 1.0, 0
    while u > 1e-9 and n < 10000:
        u = L.door_advance_openness(u, False, dt)
        n += 1
    rep.check(u <= 1e-9, "...and shuts again", f"{n * dt:.2f} s")

    # -- the shut door really is the room's fourth wall ----------------------------------
    #
    # Section 6's `perimeter_openings` sweep cannot see this: it probes the wall plane at
    # y = PAUSE_ROOM.y_min - 0.02, and the leaves hang on the room side at y >= 4.00, so
    # they are simply not on the line it samples. That is correct -- the leaves are not
    # part of the wall -- but it means "is the room sealed when the door is shut?" has to
    # be asked separately, which is what this does: union the x-intervals that block the
    # room's whole south side at walking height and check for holes.
    def _south_blockers(leaf_openness: float):
        out = []
        for name, box in L.WALLS.items():
            (x0, x1), (y0, y1), (z0, z1) = L.box_extent(box)
            # only the segments that sit ON the south boundary, below head height
            if y0 <= L.DOOR["centre"][1] <= y1 and z0 < L.WALK_CLEARANCE_Z - EPS:
                out.append((x0, x1))
        for box in L.door_leaf_boxes(leaf_openness).values():
            (x0, x1), _, (z0, z1) = L.box_extent(box)
            if z0 < L.WALK_CLEARANCE_Z - EPS and z1 > EPS:
                out.append((x0, x1))
        return out

    def _holes(intervals, lo, hi):
        gaps, cursor = [], lo
        for x0, x1 in sorted(intervals):
            if x0 > cursor + EPS:
                gaps.append((cursor, min(x0, hi)))
            cursor = max(cursor, x1)
            if cursor >= hi:
                break
        if cursor < hi - EPS:
            gaps.append((cursor, hi))
        return [g for g in gaps if g[1] - g[0] > 0.005]

    px0, px1 = L.PAUSE_ROOM["x_min"], L.PAUSE_ROOM["x_max"]
    shut_holes = _holes(_south_blockers(0.0), px0, px1)
    rep.check(not shut_holes,
              "SHUT, the door completes the pause room's south wall with no gap",
              f"walls + leaves block the whole of x[{px0:.1f},{px1:.1f}] below "
              f"{L.WALK_CLEARANCE_Z:.1f} m"
              if not shut_holes else f"holes at {[(round(a, 3), round(b, 3)) for a, b in shut_holes]}")
    open_holes = _holes(_south_blockers(1.0), px0, px1)
    rep.check(len(open_holes) == 1
              and abs((open_holes[0][1] - open_holes[0][0]) - L.DOOR["width"]) < 0.01,
              "OPEN, exactly one gap re-appears, and it is the doorway",
              f"{[(round(a, 3), round(b, 3)) for a, b in open_holes]} -> "
              f"{sum(b - a for a, b in open_holes):.3f} m, declared "
              f"{L.DOOR['width']:.2f} m")


def check_door_usd(rep: Report, L) -> None:
    section("14. the generated door USD matches the layout, and reaches nothing remote")
    usda = os.path.join(HERE, "common_scene", L.DOOR_USD_FILENAME)
    gen_py = os.path.join(HERE, "common_scene", "make_pause_room_door_usda.py")
    if not rep.check(os.path.isfile(usda), f"exists: common_scene/{L.DOOR_USD_FILENAME}"):
        return
    if not rep.check(os.path.isfile(gen_py), "exists: common_scene/make_pause_room_door_usda.py"):
        return

    with open(usda, encoding="utf-8") as fh:
        text = fh.read()

    # THE anti-drift check: regenerate from the layout module and compare. If someone edits
    # DOOR["width"] and forgets to regenerate, the door stops matching its own doorway --
    # and this is the only thing that would notice, because the USD is opaque to every
    # other check here.
    spec = importlib.util.spec_from_file_location("make_pause_room_door_usda", gen_py)
    gen = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(gen)
    expected = gen.build_usda(L)
    rep.check(expected == text,
              "the checked-in USD is exactly what the layout module generates",
              f"{len(text)} bytes; regenerate with "
              "`python3 common_scene/make_pause_room_door_usda.py`")

    hits = [f for f in FORBIDDEN_STRINGS if f in text]
    rep.check(not hits, f"no URL in {L.DOOR_USD_FILENAME}", f"found {hits}" if hits else "")
    rep.check("references" not in text and "payload" not in text,
              "the door USD has no external references or payloads",
              "it is self-contained: three Cubes, two prismatic joints, one fixed joint")
    rep.check("metersPerUnit = 1" in text,
              "the door USD is authored in METRES",
              "cabinet_collider.usd is metersPerUnit = 0.01; a scale mismatch would make "
              "the door 100x wrong and is invisible until it renders")

    for token in ("PhysicsArticulationRootAPI", "PhysicsFixedJoint",
                  "PhysicsRigidBodyAPI", "PhysicsCollisionAPI", "PhysicsDriveAPI:linear"):
        rep.check(token in text, f"the door USD declares {token}",
                  "" if token != "PhysicsDriveAPI:linear"
                  else "without a drive API the joints import as unactuated DOFs and "
                       "ImplicitActuatorCfg has nothing to configure")
    for name in L.DOOR_JOINTS:
        rep.check(f'def PhysicsPrismaticJoint "{name}"' in text,
                  f"the door USD declares the prismatic joint {name}",
                  "the name must match DOOR_JOINTS, the actuator cfg and the runtime driver")
    rep.check(text.count("PhysicsCollisionAPI") >= 3,
              "every door part is a collider, not a visual-only prop",
              f"{text.count('PhysicsCollisionAPI')} colliders: two leaves and the rail")

    # The scene cfg must reach it without PROJECT_ROOT and without a nucleus path.
    tree = parse(SCENE_PY)
    names = code_names(tree)
    rep.check("DOOR_USD_FILENAME" in names and "ArticulationCfg" in names,
              "the scene cfg spawns the door as an ArticulationCfg from that file",
              "an AssetBaseCfg would give a door-shaped prop with no joints")
    rep.check("ImplicitActuatorCfg" in names,
              "...with an actuator on the leaves",
              "an articulation with no actuator cannot be commanded, only shoved")


def check_body_clearance(rep: Report, L) -> None:
    """NOBODY EVER ASKED WHETHER TWO SCENE OBJECTS OCCUPY THE SAME SPACE.

    Every geometric check in this file, before this one, measured a scene object against
    the ROBOT -- against its spawn pose, its route, its standing spot, its arm. Nothing
    measured a scene object against another scene object. So a crate could be authored
    inside a packing table and the whole file would still report 142 passes; the failure
    would surface only as visible interpenetration in a still, and only if anyone looked
    at that corner of the hall.

    That is not hypothetical. `packing_table_a` sits at (-9.00, -6.50) and the crate that
    used to be at (-10.5, -6.0) had its near face at x = -10.00 -- the prop origin was
    EXACTLY 1.00 m from it, against the 1.00 m half-extent this file charges every prop.
    By the verifier's own model they touched. The crate was moved rather than the model
    loosened; see the layout module's CRATES comment.

    Two populations, two treatments, for the same reason as the route check:

      * boxes whose footprints are declared here (walls, columns, crates, the table, the
        door leaves) get an exact axis-aligned overlap test, and are allowed to TOUCH --
        abutting geometry is how a room is built;
      * USD props, whose real footprints cannot be read offline, get the point-plus-
        generous-half-extent treatment and are required to keep PROP_PAIR_CLEARANCE of
        daylight, because "touching" is not a meaningful statement about a number that is
        an upper bound in the first place.
    """
    section("15. no two bodies occupy the same space")

    static = [(name, L.box_extent(box)) for name, box in L.all_static_boxes().items()]
    static.append(("door_rail", L.box_extent(L.door_rail_box())))

    # Wall-against-wall is excluded, and only wall-against-wall. The partitions are
    # authored to intersect at their corners -- `pause_wall_west` and
    # `pause_wall_south_left` share a 0.20 x 0.20 m column of space where they meet, which
    # is what a corner IS. Every other pairing is a real question.
    #
    # The door is swept TWICE, once at each end of its travel, as two separate worlds. The
    # obvious "put both poses in one list" is wrong and says so loudly if you try it: a
    # leaf at openness 0 overlaps the same leaf at openness 1 by 20 mm, because they are
    # the same rigid body 0.70 m apart, not two bodies.
    wall_names = set(L.WALLS)
    worst = None
    for u, tag in ((0.0, "shut"), (1.0, "open")):
        world = list(static)
        for name, box in L.door_leaf_boxes(u).items():
            world.append((f"{name} ({tag})", L.box_extent(box)))
        for i in range(len(world)):
            for j in range(i + 1, len(world)):
                na, ea = world[i]
                nb, eb = world[j]
                if na in wall_names and nb in wall_names:
                    continue
                d = box_overlap_depth(ea, eb)
                if worst is None or d > worst[2]:
                    worst = (na, nb, d)
    n = len(static) + 2
    rep.check(worst is not None and worst[2] <= EPS,
              "no two declared boxes interpenetrate, door shut or open",
              f"deepest pairing is {worst[0]} / {worst[1]} at "
              f"{1000 * worst[2]:+.1f} mm (negative or zero = apart or touching; walls are "
              f"allowed to meet at corners and only wall-wall pairs are exempt); "
              f"{n} boxes, {n * (n - 1)} pairs over two door states")

    # Props against declared boxes. Restricted to boxes that reach into the height a prop
    # table occupies -- charging the door lintel, whose underside is at 2.20 m, against a
    # 0.75 m table would be arithmetic about nothing.
    need = PROP_HALF_EXTENT + PROP_PAIR_CLEARANCE
    tight = None
    for pname, prop in sorted(L.USD_PROPS.items()):
        origin = (prop["pos"][0], prop["pos"][1])
        for bname, box in L.all_static_boxes().items():
            (x0, x1), (y0, y1), (z0, z1) = L.box_extent(box)
            if z0 >= PROP_ASSUMED_HEIGHT:
                continue
            d = point_rect_distance(origin, ((x0, x1), (y0, y1)))
            if tight is None or d < tight[2]:
                tight = (pname, bname, d)
    rep.check(tight is not None and tight[2] >= need,
              "every USD prop keeps clear of every declared box",
              f"tightest is {tight[0]} -> {tight[1]} at {tight[2]:.3f} m from the prop "
              f"origin, needs {need:.2f} m ({PROP_HALF_EXTENT:.1f} m assumed half-extent + "
              f"{PROP_PAIR_CLEARANCE:.2f} m). THE HALF-EXTENT IS AN ASSUMPTION: the USDs' "
              f"bounding boxes are not readable offline, and 1.0 m is an upper bound taken "
              f"from the vendor placing two PackingTables 1.84 m apart, so the real "
              f"clearance here is probably {tight[2] - 0.92:.2f} m or better and could in "
              f"principle be worse")

    tight_pp = None
    for pa, pb in [(a, b) for i, a in enumerate(sorted(L.USD_PROPS))
                   for b in sorted(L.USD_PROPS)[i + 1:]]:
        d = math.dist(L.USD_PROPS[pa]["pos"][:2], L.USD_PROPS[pb]["pos"][:2])
        if tight_pp is None or d < tight_pp[2]:
            tight_pp = (pa, pb, d)
    need_pp = 2 * PROP_HALF_EXTENT + PROP_PAIR_CLEARANCE
    rep.check(tight_pp is not None and tight_pp[2] >= need_pp,
              "no two USD props overlap each other",
              f"closest pair is {tight_pp[0]} / {tight_pp[1]} at {tight_pp[2]:.2f} m "
              f"origin to origin, needs {need_pp:.2f} m")


def check_robot_model(rep: Report, L) -> None:
    """THE ROBOT\'S OWN DIMENSIONS ARE THE ONE SET OF NUMBERS NOTHING CHECKED.

    Section 12 measures the scene against `SHOULDER_ABOVE_PELVIS`, `ARM_REACH_TO_KNUCKLE`,
    `ARM_REACH_TO_FINGERTIP` and `FOOT_FRONT_REACH`, and its verdict is only as good as
    those four numbers. They are all hand-typed literals whose derivations live in
    comments, and a comment cannot be run. Setting `FOOT_FRONT_REACH` to 0.01, or
    `ARM_REACH_TO_KNUCKLE` to 0.20, left every check in this file passing -- which is the
    same failure mode as the one that shipped an unreachable apple, one level down.

    The artefact those numbers were measured off is in this repo:
    `../sim_evaluator/mjcf/g1_dex3/g1_43dof_fixedbase.xml`, the MuJoCo twin. So this
    section re-derives them from it, by walking the kinematic chain with real rigid
    transforms rather than summing components, and asserts the literals against what comes
    back. Same rule as everywhere else here: a number the simulator uses should be a number
    something recomputed.
    """
    section("16. the robot constants the reach check depends on")
    if not os.path.isfile(MJCF_G1):
        rep.skip("the G1 MJCF is available to re-derive the arm and foot constants",
                 f"not found at {os.path.relpath(MJCF_G1, HERE)}")
        return
    bodies = load_mjcf_bodies(MJCF_G1)
    rel = os.path.relpath(MJCF_G1, HERE)

    # -- the shoulder, in the pelvis frame ------------------------------------------------
    sp, _sq = mjcf_pose_in(bodies, "left_shoulder_pitch_link", "pelvis")
    rep.check(abs(sp[2] - L.SHOULDER_ABOVE_PELVIS) < 1e-6,
              "SHOULDER_ABOVE_PELVIS is what the MJCF says it is",
              f"declared {L.SHOULDER_ABOVE_PELVIS:.5f} m, re-derived {sp[2]:.5f} m from "
              f"{rel}")
    rep.check(abs(sp[1] - L.SHOULDER_LATERAL) < 1e-6,
              "SHOULDER_LATERAL is what the MJCF says it is",
              f"declared {L.SHOULDER_LATERAL:.5f} m, re-derived {sp[1]:.5f} m")
    rep.check(abs(sp[0]) < 1e-4,
              "...and the shoulder really does sit directly above the pelvis in x",
              f"{1000 * sp[0]:+.3f} mm -- the waist-roll and shoulder-pitch x offsets "
              "cancel, which is what lets `shoulder_pos` ignore fore-aft entirely")

    # -- the arm, straightened -------------------------------------------------------------
    # Sum of the link offsets' LENGTHS: the furthest a serial chain can reach is the sum of
    # its segment lengths, achieved with every joint straight. This is an upper bound on
    # reach and is exactly what ARM_REACH_TO_* claim to be.
    to_knuckle = ["left_shoulder_roll_link", "left_shoulder_yaw_link", "left_elbow_link",
                  "left_wrist_roll_link", "left_wrist_pitch_link", "left_wrist_yaw_link",
                  "left_hand_middle_0_link"]
    to_tip = to_knuckle + ["left_hand_middle_1_link", "left_hand_middle_finger_tip"]
    knuckle = mjcf_chain_length(bodies, to_knuckle)
    tip = mjcf_chain_length(bodies, to_tip)
    rep.check(abs(knuckle - L.ARM_REACH_TO_KNUCKLE) < 1e-3,
              "ARM_REACH_TO_KNUCKLE is the MJCF chain length shoulder -> middle knuckle",
              f"declared {L.ARM_REACH_TO_KNUCKLE:.3f} m, re-derived {knuckle:.4f} m over "
              f"{len(to_knuckle)} links")
    rep.check(abs(tip - L.ARM_REACH_TO_FINGERTIP) < 1e-3,
              "ARM_REACH_TO_FINGERTIP is the MJCF chain length shoulder -> fingertip",
              f"declared {L.ARM_REACH_TO_FINGERTIP:.3f} m, re-derived {tip:.4f} m over "
              f"{len(to_tip)} links -- nothing can be touched beyond this, ever")

    # -- the feet ---------------------------------------------------------------------------
    # This one CORRECTED the layout module rather than confirming it. Its comment derived
    # the ankle as "0.0533 m BEHIND the pelvis (hip_yaw +0.025001 x, knee -0.078273 x)",
    # which adds two x components that are expressed in DIFFERENT frames: `left_hip_roll_link`
    # carries quat (0.996179, 0, -0.0873386, 0) and `left_knee_link` carries its exact
    # inverse, so the two rotations cancel and the ankle lands within 21 micrometres of
    # directly below the pelvis. Walking the chain properly puts the toe spheres 0.125 m
    # ahead of the pelvis, not 0.072 m. FOOT_FRONT_REACH = 0.13 survives -- barely, with
    # 5 mm rather than the 58 mm its comment claimed.
    ankle, _aq = mjcf_pose_in(bodies, "left_ankle_roll_link", "pelvis")
    foot_geoms = [g for g in bodies["left_ankle_roll_link"][3] if g[0] == "foot"]
    toe_x = max(g[1][0] for g in foot_geoms) if foot_geoms else 0.0
    derived_foot = ankle[0] + toe_x + FOOT_SPHERE_RADIUS
    rep.check(L.FOOT_FRONT_REACH >= derived_foot - 1e-9,
              "FOOT_FRONT_REACH covers the MJCF's actual forward foot contact",
              f"declared {L.FOOT_FRONT_REACH:.3f} m vs {derived_foot:.4f} m re-derived "
              f"(ankle-roll origin {1000 * ankle[0]:+.2f} mm from the pelvis in x, "
              f"forward contact spheres at +{toe_x:.3f} m, r = {FOOT_SPHERE_RADIUS} m) "
              f"-> {1000 * (L.FOOT_FRONT_REACH - derived_foot):.1f} mm of margin")
    rep.check(L.FOOT_FRONT_REACH < L.TABLE_STANDOFF,
              "...and the standoff still beats it once the correct number is used",
              f"standoff {L.TABLE_STANDOFF:.3f} m vs foot reach {L.FOOT_FRONT_REACH:.3f} m")

    # -- the two bands the rest of the file trusts -----------------------------------------
    rep.check(L.WALK_CLEARANCE_Z >= 1.32 + 0.30 and L.WALK_CLEARANCE_Z <= L.HALL_HEIGHT,
              "WALK_CLEARANCE_Z is above a standing G1 and below the roofline",
              f"{L.WALK_CLEARANCE_Z:.2f} m vs a ~1.32 m robot and {L.HALL_HEIGHT:.2f} m "
              "walls -- it is the height below which geometry counts as blocking, so a "
              "small value silently deletes obstacles from sections 5, 6, 8 and 13")
    lo_z, hi_z = L.BASE_HEIGHT_BAND
    rep.check(lo_z < hi_z and (hi_z - lo_z) >= 0.05,
              "BASE_HEIGHT_BAND is a band, not a point",
              f"[{lo_z:.3f}, {hi_z:.3f}] m spans {1000 * (hi_z - lo_z):.0f} mm; collapsing "
              "it to one height would silently drop half of section 12's cases")
    rep.check(abs(lo_z - 0.725) < 1e-9 and abs(hi_z - 0.790) < 1e-9,
              "...and it is still the pair of heights the live run actually logged",
              "0.790 m standing (step=50 base_z=+0.78979), 0.725 m in the settled "
              "one-legged crouch -- see the README's live-sim section")


def check_door_driver(rep: Report, L) -> None:
    """THE DRIVER WAS A FILENAME TO THIS FILE, AND NOTHING ELSE.

    Section 0 asserts that `mdp/pause_door.py` exists. That was the entire relationship
    between the offline verifier and the code that actually moves the door: a syntax error
    in the driver, a renamed entry point, or a `door` observation group quietly deleted
    from the env cfg all passed every check here, and would have surfaced two minutes into
    a launch as a door that never opens.

    The driver cannot be IMPORTED offline -- it needs `torch` and the checkout's
    `tasks.common_scene` on the path -- so this section reads it with `ast`, the same way
    sections 2 and 3 read the cfg modules. That is enough to answer the questions worth
    asking: does it parse, does it still define the entry points the env cfg calls by name,
    is the `door` group still wired up, and is the door term still OUT of the `policy`
    group, which is the DDS contract the rest of the stack reads.
    """
    section("17. the door driver is wired into the task")
    mdp_dir = os.path.join(TASK_DIR, "mdp")
    trees = {}
    for name in ("__init__.py", "observations.py", "pause_door.py", "rewards.py",
                 "terminations.py"):
        path = os.path.join(mdp_dir, name)
        try:
            trees[name] = parse(path)
            ok, detail = True, ""
        except SyntaxError as exc:
            ok, detail = False, f"{exc.__class__.__name__}: {exc}"
        rep.check(ok, f"mdp/{name} parses", detail)
    if "pause_door.py" not in trees or "__init__.py" not in trees:
        return

    door_names = code_names(trees["pause_door.py"])
    defined = {n.name for n in ast.walk(trees["pause_door.py"])
               if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))}
    assigned = {t.id for n in ast.walk(trees["pause_door.py"])
                if isinstance(n, ast.Assign) for t in n.targets if isinstance(t, ast.Name)}
    for entry in ("pause_door_state", "set_pause_door"):
        rep.check(entry in defined, f"mdp/pause_door.py still defines {entry}()",
                  "the env cfg calls it by name through `mdp.`, so a rename is a "
                  "build-time AttributeError, not a type error")
    rep.check("OBS_DIM" in assigned, "mdp/pause_door.py still declares OBS_DIM",
              "the width of the door observation row is declared once, in the driver; "
              "no consumer hardcodes it")

    reexported = any(isinstance(n, ast.ImportFrom) and n.module == "pause_door"
                     for n in ast.walk(trees["__init__.py"]))
    rep.check(reexported, "mdp/__init__.py re-exports the door driver",
              "`from .pause_door import *` is what makes `mdp.pause_door_state` resolve "
              "in the env cfg")

    env_tree = parse(ENVCFG_PY)
    env_names = code_names(env_tree)
    rep.check("pause_door_state" in env_names,
              "the env cfg still references pause_door_state",
              "the observation manager is the ONLY per-step hook reachable from inside "
              "this task package in a *Wholebody* run (env.step() is never called), so "
              "losing this term means the door never moves")
    groups = {t.target.id for n in ast.walk(env_tree) if isinstance(n, ast.ClassDef)
              for t in n.body if isinstance(t, ast.AnnAssign) and isinstance(t.target, ast.Name)}
    rep.check("door" in groups, "the env cfg still declares a `door` observation group",
              f"observation/scene group attributes found: {sorted(groups)}")

    # ...and the door term must stay OUT of the policy group. `policy` is the wholebody DDS
    # contract: whatever is in it is what the provider serialises and ships over the wire.
    # Appending a six-float door row to it would not raise anything -- it would silently
    # change the shape of the observation the rest of the stack reads.
    policy = [n for n in ast.walk(env_tree)
              if isinstance(n, ast.ClassDef) and n.name == "PolicyCfg"]
    rep.check(bool(policy), "the env cfg still has a PolicyCfg group")
    if policy:
        rep.check("pause_door_state" not in code_names(policy[0]),
                  "...and the door term is NOT in it",
                  "the `policy` group is the DDS contract; the door lives in its own "
                  "group so that adding it changed nothing on the wire")

    for override in ("open_pause_door", "close_pause_door", "auto_pause_door"):
        rep.check(override in code_strings(env_tree),
                  f"the manual override `{override}` is still registered",
                  "an evaluation that wants to pin the door -- e.g. to test the robot "
                  "arriving at a shut one -- needs all three")

    check_no_remote_paths(rep, [os.path.join(mdp_dir, n) for n in trees])


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
        ("door articulation", f"({L.DOOR_ORIGIN[0]:.2f}, {L.DOOR_ORIGIN[1]:.2f}, {L.DOOR_ORIGIN[2]:.2f})",
         f"2 sliding leaves {L.DOOR_LEAF_WIDTH:.2f} x {L.DOOR_LEAF['thickness']:.2f} x "
         f"{L.DOOR_LEAF_HEIGHT:.2f}, travel {L.DOOR_LEAF_TRAVEL:.2f} m each"),
        ("table_front (stand)", f"({L.PLACES['table_front'][0]:.2f}, {L.PLACES['table_front'][1]:.2f})",
         f"yaw {L.TABLE_APPROACH_YAW_DEG:.0f} deg, {L.TABLE_STANDOFF:.2f} m off the table"),
    ]
    w = max(len(r[0]) for r in rows)
    for name, pos, note in rows:
        print(f"  {name.ljust(w)}  {pos:<26}  {note}")
    print("\n  named places:")
    selectable = set(L.selectable_spawns())
    for name, (x, y) in sorted(L.PLACES.items()):
        head = L.PLACE_HEADINGS.get(name)
        tag = f"   arrive facing {head:.0f} deg" if head is not None else ""
        tag += "   [selectable spawn]" if name in selectable else ""
        print(f"    {name.ljust(20)} ({x:6.2f}, {y:6.2f}){tag}")

    # What THIS process would spawn, which is not necessarily the authored pose: the
    # verifier reads the same environment variable the scene does, so a run with
    # NEODEM_ROBOT_SPAWN set says so here rather than leaving the reader to assume.
    set_to = os.environ.get(L.ROBOT_SPAWN_ENV_VAR, "") or "<unset>"
    try:
        live = L.robot_spawn()
    except ValueError as exc:
        # Reported rather than raised: a bad spawn name says nothing about the geometry,
        # and losing the RESULT line of a 200-check run to a traceback would hide every
        # answer this file just computed behind one shell-level typo.
        print(f"\n  {L.ROBOT_SPAWN_ENV_VAR}={set_to} -> REFUSED: {exc}")
    else:
        where = "the authored ROBOT pose" if live["name"] is None else f"'{live['name']}'"
        print(f"\n  {L.ROBOT_SPAWN_ENV_VAR}={set_to}"
              f" -> spawn at {where}: ({live['pos'][0]:.2f}, {live['pos'][1]:.2f}, "
              f"{live['pos'][2]:.2f}) yaw {live['yaw_deg']:.0f} deg")

    print("\n  reach from 'table_front' (shoulder to target, over the observed base-height band):")
    stand = L.PLACES["table_front"]
    apple = tuple(L.APPLE["pos"])
    for base_z in L.BASE_HEIGHT_BAND:
        print(f"    base_z {base_z:.3f} m -> apple "
              f"{L.grasp_reach(stand, base_z, L.TABLE_APPROACH_YAW_DEG, apple):.3f} m")
    print(f"    budget {L.GRASP_REACH_BUDGET:.3f} m; arm is {L.ARM_REACH_TO_KNUCKLE:.3f} m "
          f"to the knuckle, {L.ARM_REACH_TO_FINGERTIP:.3f} m to the fingertip")

    print("\n  automatic door:")
    a = L.DOOR_AUTOMATION
    print(f"    opens within {a['open_radius']:.2f} m of ({L.DOOR['centre'][0]:.2f}, "
          f"{L.DOOR['centre'][1]:.2f}), shuts beyond {a['shut_radius']:.2f} m")
    print(f"    leaf speed {a['leaf_speed']:.2f} m/s -> full stroke in "
          f"{L.DOOR_LEAF_TRAVEL / a['leaf_speed']:.2f} s")
    for u in (0.0, 1.0):
        boxes = L.door_leaf_boxes(u)
        spans = sorted(L.box_extent(b)[0] for b in boxes.values())
        print(f"    openness {u:.0f}: leaves x[{spans[0][0]:.2f},{spans[0][1]:.2f}] and "
              f"x[{spans[1][0]:.2f},{spans[1][1]:.2f}] -> clear width "
              f"{L.door_clear_width(u):.2f} m")


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
    check_reach(rep, L)
    check_door(rep, L)
    check_door_usd(rep, L)
    check_body_clearance(rep, L)
    check_robot_model(rep, L)
    check_door_driver(rep, L)

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
