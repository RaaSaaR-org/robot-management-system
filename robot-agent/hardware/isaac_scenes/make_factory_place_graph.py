#!/usr/bin/env python3
# NeoDEM. Apache License, Version 2.0 (same terms as the surrounding Unitree checkout).
"""Generate `sim_evaluator/places/places.factory_pauseroom.json` from the scene layout.

WHY A GENERATOR AND NOT A HAND-WRITTEN JSON
-------------------------------------------
`table_front` was hand-typed once, at `(10.00, 5.35)`. It was 0.4 m wrong: from there the
apple is 0.926 m from the pelvis and 0.992 m from the shoulder, against a 0.55 m
`GRASP_REACH_BUDGET`. Nothing caught it, because every check asked about the apple, the
plate and the table, and none of them mentioned the robot. It is now DERIVED, by
`standing_spot_for_grasp()`, and the whole point of this file is that the place graph
Agent Mode navigates on is derived from the same call rather than transcribed beside it.

So: no coordinate below is typed. Every one is read from
`common_scene/factory_pauseroom_layout.py` -- the module that imports nothing but `math`
and `os` precisely so that tools like this one can read the simulator's own numbers. Run
`--check` (as `verify_factory_scene_offline.py` section 18 does) and a layout edit that was
not propagated is a failure instead of a surprise.

WHAT THE CONSUMER SCHEMA CAN CARRY, AND WHAT IT CANNOT
------------------------------------------------------
The consumer is `parsePlaceGraph` in `robot-agent/src/agent-mode/place-resolver.ts`. It is
strict, and it is strict by REBUILDING a whitelisted object rather than by rejecting extra
keys -- so a field it does not know is dropped in silence. Three things this scene knows
therefore do not survive the load, and inventing a field for them would be worse than
having none, because the robot would then fail for an unexplained reason:

1. **ARRIVAL HEADING. It does not survive. There is nowhere to put it.**
   `PLACE_HEADINGS` in the layout declares 90 deg (world +y) at `pause_room_door` and at
   `table_front`, and `TABLE_APPROACH_YAW_DEG` is the single source of both. The `Place`
   interface (place-resolver.ts:84-95) has no heading field, and `navigateToPlaceInner`
   never issues a final alignment turn: its last commanded turn is the heading of the last
   PATH segment, so a robot entering `TABLE-FRONT` from the door arrives facing roughly
   into the room, not at the table. Every reach number in the layout is computed at 90 deg.
   **The mission plan must append an explicit `turn` block after the `goto`** (or use a
   patrol checkpoint, whose `headingDeg` + `capture` is the only arrival-heading mechanism
   that exists). Section 18 of the verifier asserts these headings are NOT in the JSON, so
   that nobody later "fixes" this by adding a key the loader eats.

2. **ARRIVAL PRECISION.** A resolved place becomes a single goal POINT plus a containment
   test: arrival is `pointInPolygon(pose) && distanceToBoundary >= 0.30 && dist(pose,
   centroid) <= 1.00` (navigator.ts:198, :204, :389-392). The tolerance is a metre against
   a 0.55 m reach budget, and the polygon cannot be shrunk to fix it -- a polygon with an
   inradius below 0.30 m can never be arrived in at all, and one with an inradius EQUAL to
   0.30 m is no better: its arrival region is the single point at its centre. `goto
   TABLE-FRONT` therefore delivers the robot to the neighbourhood of the table, NOT onto
   the grasp spot; the residual (see the run output) is a walk the mission must append
   explicitly. Not a refinement of the goto, either: the arrival region reaches y = 5.70
   and the apple is out of budget south of y = 5.79, so no pose `goto` can call arrived is
   a pose the arm can grasp from. What the polygon CAN do is make that walk as short and
   as certain as an arrivable place allows, which is what TABLE_FRONT_HALF_Y_M is for.

3. **THE DOOR.** There is no field for a doorway, a clear opening, a leaf sweep or an edge
   between places -- despite the name, the file is a flat list of floor polygons with no
   adjacency. The 1.40 m opening reaches the planner only through the live lidar occupancy
   map. What the graph CAN do about the door is give it a goal of its own, which is why
   `PAUSE-ROOM-DOOR-APPROACH` exists; see below.

WHY THERE ARE NO KEEPOUTS
-------------------------
The loader does consume `keepout`, in two places, and both of them would break this
mission if it were used here:

* The geofence inflates every keepout by `DEFAULT_KEEPOUT_MARGIN_M = 0.5` m and turns a
  breach into a `zone_violation` protective stop (geofence.ts:29, :96-150). `table_front`
  stands 0.16 m from the table's near face BY DESIGN. Fencing the table would protective-
  stop the robot at the exact moment it arrived to grasp, and releasing the latch needs a
  further 0.25 m.
* The path planner is handed the same polygons with the same 0.5 m margin plus a 0.40 m
  robot disc (agent-mode-controller.ts:1259-1271). Fencing the partitions would leave
  1.40 - 2 x 0.5 = 0.40 m of the doorway against a 0.80 m disc: the door would be sealed,
  `planPath` would answer `no-path`, and the pre-walk check would refuse the approach.

Walls, columns, crates, the door leaves and the table all reach the planner through the
lidar occupancy map instead, which is where the code expects to find them. `landmarks` is
parsed and read by nobody (place-resolver.ts:284), so it is emitted empty.

PLACES MAY NOT OVERLAP, AND TWO OF THEM WANTED THE SAME FLOOR
-------------------------------------------------------------
`PlaceTracker.findPlace` is written to a non-overlap invariant -- "the graphs are authored
non-overlapping (verified on a 0.05 m grid), so at most one place matches"
(place-resolver.ts:612-623) -- and its deepest-margin tie-break exists only so a graph that
breaks the invariant still resolves deterministically rather than by array order. The
ARRIVAL regions matter more than the polygons: `goto` tests `inside(pose)` against ONE
place, so two overlapping arrival regions mean a single pose counts as arrived in both, and
`goto TABLE-FRONT` can report success with the robot standing somewhere else. `build_places`
now refuses to emit either kind of overlap.

That bit: `pause_room_centre` (10.00, 5.20) and `table_front` are 0.64 m apart in a room
that is 2.00 m deep, and the first lies INSIDE the second's polygon. Only one of them can
own that floor, and it is the one the mission grasps from. See `NOT_EMITTED`.

WHY `pause_room_door` IS NOT A PLACE, AND WHAT REPLACES IT
----------------------------------------------------------
`PLACES["pause_room_door"]` is (10.00, 3.90) -- the MID-PLANE OF THE PARTITION, whose y
extent is [3.80, 4.00]. It is a gate point to pass through, not a spot to stand on: it is
0.100 m from a shut leaf against a 0.40 m body pad, so a robot placed there starts inside
a 25 kg door. A polygon centred on it would declare wall to be floor.

It is replaced by `PAUSE-ROOM-DOOR-APPROACH`: the apron of floor immediately SOUTH of the
partition, centred on the door's own centreline, narrow enough that its whole arrival
region lies inside the 1.40 m aperture. That is the waypoint the doorway analysis asked
for. The previous run jammed at (10.607, 3.442) -- 0.120 m past the body radius from
`pause_wall_south_right` -- because a single straight leg from the spawn to a goal BEHIND
the door lets cross-track error build across 8 m and then aims diagonally into the frame.
Making the approach its own goal means the last bearing before the throat is measured from
the centreline, and it also widens the long lane's tightest clearance from 0.169 m past the
body radius to roughly 0.59 m (section 18 measures it).

With `PAUSE-ROOM-CENTRE` gone the route is ROBOT-START -> HALL-MIDWAY ->
PAUSE-ROOM-DOOR-APPROACH -> TABLE-FRONT. The last leg is 2.4 m through the open doorway,
comfortably inside one `goto`'s stage budget, and it is the only leg that was ever served by
the dropped waypoint.

`HALL-MIDWAY` exists for the stage budget, not for geometry: it is the exact midpoint of
the first lane, so it adds no detour, and it splits an 8 m crossing into two `goto` legs
that each get their own `AGENT_MAX_NAV_STAGES` budget. At the measured 31% of commanded
travel the default 12 stages buy about 7.5 m, which does not reach in one leg.

USING IT
--------
    python3 make_factory_place_graph.py            # rewrite the JSON
    python3 make_factory_place_graph.py --check    # exit 1 if it is out of date

Agent Mode only sees it when `PLACE_GRAPH_PATH` names it (config.ts:795; empty by
default, and a relative path resolves against the robot-agent process cwd). It also needs
`AGENT_NAV_PLANNER=grid`, or `navigateToPlace` refuses outright. See README.md.

@status new -- authoring tool for isaac_scenes/, not part of the shipped robot software
"""

from __future__ import annotations

import argparse
import importlib.util
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
LAYOUT_PY = os.path.join(HERE, "common_scene", "factory_pauseroom_layout.py")
OUT_JSON = os.path.join(HERE, "..", "sim_evaluator", "places", "places.factory_pauseroom.json")

# ------------------------------------------------------------------------------------------
# The consumer's constants, mirrored.
#
# These four are NOT ours to choose -- they are asserted or applied by
# `robot-agent/src/agent-mode/place-resolver.ts` and `navigator.ts`, and a mismatch is
# rejected rather than adapted. They are mirrored here because this file has to size
# polygons against them, and `verify_factory_scene_offline.py` re-reads the two numeric ones
# straight out of `navigator.ts` so the copies cannot drift.
# ------------------------------------------------------------------------------------------
GRAPH_VERSION = 1                                  # place-resolver.ts:30, strict !==
FRAME_UNITS = "m"                                  # place-resolver.ts:24, asserted
FRAME_YAW_CONVENTION = "deg,+x=0,CCW+"             # place-resolver.ts:27, asserted
FRAME_KIND = "sim"                                 # place-frame.ts:79-88 -- anything else
                                                   # leaves the frame UNREGISTERED, and an
                                                   # unregistered frame yields zero
                                                   # goto-able places at all.
FRAME_ID = "factory-pauseroom-sim"                 # free text; it names the map
PLACE_SOURCE = "surveyed"                          # types.ts:279 closed set. These
                                                   # coordinates come from the scene's own
                                                   # authored geometry, which is as
                                                   # surveyed as a simulation gets.

PLACE_ENTRY_MARGIN_M = 0.30
"""How far inside its polygon a pose must be to count as in the place (navigator.ts:198).

Load-bearing for the polygon SIZE, in a direction that is easy to get backwards: a polygon
whose inradius is below this can never be arrived in, however close the robot gets to its
centre -- and one whose inradius EQUALS it is no better, since its arrival region is then
the single point at its centre and no walking robot ever samples a pose on it. Sizes are
strictly greater, always.
"""

PLACE_ARRIVAL_M = 1.00
"""And how close to the centroid, as well as inside (navigator.ts:204). Reported, not used
to size anything -- at these polygon sizes the containment test always binds first."""

ARRIVAL_PATCH_HALF_M = 0.20
"""Half-width of the region a pose may actually arrive in, over and above the entry margin.

The one number here that is a choice rather than a consequence. At 0 the arrival region is
a single point and the robot would walk past a place it is standing in; 0.20 gives a
0.40 x 0.40 m patch, which is a few centimetres wider than the G1's own footprint and is
what makes arrival reachable at the measured 31%-of-commanded travel.
"""

PLACE_HALF_M = PLACE_ENTRY_MARGIN_M + ARRIVAL_PATCH_HALF_M
"""Half-side of an emitted polygon where nothing constrains it: 0.50 m, a 1.00 m square."""

MIN_STAGE_M = 0.30
"""The shortest walk the navigator will ever command, metres (navigator.ts:51).

Mirrored here, and re-read out of `navigator.ts` by section 18 of the verifier, because it
is what floors the DEPTH of a place the robot walks into head-on: every stage is at least
this long, so an arrival band shallower than one stage can be stepped clean over -- the
robot would go from short of the place to past it without ever sampling a pose inside it.
"""

TABLE_FRONT_HALF_Y_M = PLACE_ENTRY_MARGIN_M + MIN_STAGE_M / 2
"""Half-DEPTH of TABLE-FRONT alone: 0.45 m, against 0.50 m in every other place.

TABLE-FRONT is the one place whose north edge is pinned (by the table) while its goal wants
to be as far north as possible, so its depth is the one dimension in this file that is a
real trade rather than a default. Fixing the north edge at the table's near face `F`:

    polygon  y in [F - 2h, F]      centroid y = F - h        residual = h - TABLE_STANDOFF
    arrival  y in [F - 2h + 0.30, F - 0.30]   depth 2h - 0.60

  * h = 0.50 (PLACE_HALF_M): goal 0.340 m short of the grasp spot, and the robot walking in
    from the south enters the arrival band at F - 0.70, i.e. 0.540 m short. Measured.
  * h = 0.30 (PLACE_ENTRY_MARGIN_M, "the smallest the navigator permits"): goal 0.140 m
    short -- and the arrival band is 0.000 m deep. `inside()` is
    `pointInPolygon && distanceToBoundary >= 0.30` (navigator.ts:389-391), so at h = 0.30
    the ONLY qualifying pose is the exact centroid. A place with an inradius EQUAL to the
    entry margin can no more be arrived in than one below it: `goto TABLE-FRONT` would
    never report arrival at all, and the mission would fail at the goto instead of at the
    grasp. Do not use it.
  * h = 0.30 + MIN_STAGE_M/2 = 0.45: the shallowest band the navigator's own smallest
    move cannot step over, 0.30 m deep. Goal 0.290 m short, entered at 0.440 m short.

The x half-width stays PLACE_HALF_M: nothing constrains it, and x is where the measured
cross-track error lives.
"""

COORD_DP = 3
"""Millimetres. Emitted coordinates are rounded to this.

Not cosmetic: the layout's derived values carry float noise (the doorway width computed
from wall extents is 1.3999999999999986, and 10.17 + 0.07 is 10.240000000000002). Rounding
at emit time keeps the file byte-stable across machines, which is what makes `--check` a
comparison of intent rather than of last bits. Section 18 compares against the layout with
a tolerance of half a millimetre for exactly this reason.
"""

# Layout places that are deliberately NOT emitted, with the reason. The generator refuses to
# run if `PLACES` grows a key that is neither emitted nor listed here -- enumerated rather
# than globbed, so a new place cannot quietly acquire or quietly lose a polygon.
NOT_EMITTED: dict[str, str] = {
    "pause_room_door": (
        "the mid-plane of the partition (y 3.80..4.00) and 0.100 m from a shut leaf; a gate "
        "point to pass through, not a spot to stand on. PAUSE-ROOM-DOOR-APPROACH replaces it."
    ),
    "pause_room_centre": (
        "(10.00, 5.20) is INSIDE TABLE-FRONT's polygon (x 9.74..10.74, y 5.10..6.00), and "
        "the two names describe one piece of floor: the room offers 2.00 m of depth between "
        "the partition's north face (y 4.00) and the table (y 6.00), and TABLE-FRONT needs "
        "0.90 m of it. Emitting both put a 0.53 m^2 overlap in the graph WITH THEIR ARRIVAL "
        "REGIONS OVERLAPPING TOO, so one pose satisfied the arrival predicate for both and "
        "`goto TABLE-FRONT` could report success with the robot standing in "
        "PAUSE-ROOM-CENTRE -- against the non-overlap invariant PlaceTracker.findPlace is "
        "written to (place-resolver.ts:612-623). The layout's own docstring calls this a "
        "way-in waypoint and not a manipulation pose, and the way in is already a place: "
        "PAUSE-ROOM-DOOR-APPROACH, on the doorway centreline, leaves a 2.4 m final leg well "
        "inside one goto's stage budget. Moving it instead was rejected -- the only free "
        "band is y 4.05..5.05, whose polygon would not contain the layout's own "
        "PLACES['pause_room_centre'], which is exactly the transcription drift this "
        "generator exists to prevent."
    ),
}


def load_layout(path: str = LAYOUT_PY):
    """Import the layout module by path, so this works in-repo and installed alike."""
    spec = importlib.util.spec_from_file_location("factory_pauseroom_layout", path)
    if spec is None or spec.loader is None:  # pragma: no cover - only if the file moved
        raise RuntimeError(f"cannot load {path}")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


# ==========================================================================================
# polygons
# ==========================================================================================
def _round(v: float) -> float:
    r = round(v, COORD_DP)
    return 0.0 if r == 0.0 else r  # kill "-0.0"


def _rect(cx: float, cy: float, half_x: float, half_y: float | None = None) -> list[list[float]]:
    """A rectangle as a CCW ring, implicitly closed -- the last vertex is NOT the first again.

    Square unless `half_y` says otherwise; only TABLE-FRONT needs the second half-size, and
    it needs it because the table pins its north edge (see TABLE_FRONT_HALF_Y_M).

    CCW in this frame (+x right, +y up) is SW, SE, NE, NW. `parsePlaceGraph` does not
    enforce winding and neither the ray cast nor the shoelace centroid cares, but the
    interface documents CCW (place-resolver.ts:89) and a ring that says what it means costs
    nothing.
    """
    if half_y is None:
        half_y = half_x
    x0, x1 = _round(cx - half_x), _round(cx + half_x)
    y0, y1 = _round(cy - half_y), _round(cy + half_y)
    return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]


def _centre_of(polygon) -> tuple[float, float]:
    """The point `goto` actually drives to: the SHOELACE centroid of the emitted ring.

    Computed the way `placeGoal` computes it (navigator.ts:236-244) and from the ROUNDED
    vertices, because the navigator drives to the centroid of the polygon it actually
    loaded. A bounding-box midpoint agrees with this for every rectangle in this file, and
    would stop agreeing the moment a polygon stopped being one -- so the report would then
    name a goal the robot never walks to. Section 18 of the verifier compares the two.

    `placeGoal` falls back to a sampled interior point when the centroid lands OUTSIDE the
    ring (a concave place); every ring here is convex, so that branch cannot be reached, and
    it is not reimplemented.
    """
    area = cx = cy = 0.0
    n = len(polygon)
    for i in range(n):
        xi, yi = polygon[i]
        xj, yj = polygon[i - 1]
        f = xj * yi - xi * yj
        area += f
        cx += (xj + xi) * f
        cy += (yj + yi) * f
    if abs(area) <= 1e-9:  # pragma: no cover - a degenerate ring is a bug, not a shape
        raise RuntimeError(f"degenerate polygon has no centroid: {polygon}")
    return (cx / (3 * area), cy / (3 * area))


def _extent(polygon) -> tuple[tuple[float, float], tuple[float, float]]:
    """((x0, x1), (y0, y1)) of a ring. Every ring here is an axis-aligned rectangle."""
    xs = [v[0] for v in polygon]
    ys = [v[1] for v in polygon]
    return ((min(xs), max(xs)), (min(ys), max(ys)))


def arrival_region(polygon, margin: float = PLACE_ENTRY_MARGIN_M):
    """The set of poses that count as ARRIVED in this place, as an extent.

    `inside()` is `pointInPolygon(pose) && distanceToBoundary >= margin` (navigator.ts:198,
    :389-391), which for a rectangle is the rectangle inset by `margin` on every side. An
    empty or degenerate result is not a small place, it is a place `goto` can never report
    arrival in -- so this returns the raw numbers and lets the caller judge.
    """
    (x0, x1), (y0, y1) = _extent(polygon)
    return ((x0 + margin, x1 - margin), (y0 + margin, y1 - margin))


def _overlap(a, b) -> tuple[float, float]:
    """(x, y) overlap of two extents. Both positive means the two areas intersect."""
    return (min(a[0][1], b[0][1]) - max(a[0][0], b[0][0]),
            min(a[1][1], b[1][1]) - max(a[1][0], b[1][0]))


class PlaceSpec:
    """One emitted place, plus the provenance JSON has no room for.

    A plain class and not a `@dataclass`, deliberately: this module is imported BY PATH
    (`importlib.util.spec_from_file_location`) by `verify_factory_scene_offline.py`, and
    `@dataclass` resolves its annotations through `sys.modules[cls.__module__]`, which for a
    by-path import is not there. It fails at import with an `AttributeError` about NoneType,
    which reads like anything but "you used a dataclass".
    """

    def __init__(self, id: str, name: str, place_type: str, polygon: list[list[float]],
                 derivation: str, role: str, layout_key: str | None = None) -> None:
        self.id = id
        self.name = name
        self.place_type = place_type
        self.polygon = polygon
        self.derivation = derivation
        self.role = role
        self.layout_key = layout_key
        self.landmarks: list = []

    @property
    def centre(self) -> tuple[float, float]:
        return _centre_of(self.polygon)

    def to_json_obj(self) -> dict:
        return {
            "id": self.id,
            "name": self.name,
            "placeType": self.place_type,
            "floor": 0,  # knownPlaces() filters `p.floor === 0`; nothing else is goto-able
            "polygon": self.polygon,
            "source": PLACE_SOURCE,
            "keepout": False,
            "landmarks": self.landmarks,
        }


def build_places(L) -> list[PlaceSpec]:
    """Every emitted place, derived from `L`. The order is the mission order."""

    # --- consistency the layout does not assert about itself -------------------------------
    # `PLACES["robot_start"]` and `ROBOT["pos"][:2]` are independent literals of the same
    # point, and so are `PLACES["pause_room_door"]` and `DOOR["centre"]`. Neither pair is
    # derived from the other, so both can drift. Refuse rather than pick one.
    if tuple(L.PLACES["robot_start"]) != tuple(L.ROBOT["pos"][:2]):
        raise RuntimeError(
            f"PLACES['robot_start'] {L.PLACES['robot_start']} and ROBOT['pos'][:2] "
            f"{tuple(L.ROBOT['pos'][:2])} are the same point authored twice, and they have "
            "drifted apart. Fix the layout; this tool will not guess which one is the spawn."
        )
    if tuple(L.PLACES["pause_room_door"]) != tuple(L.DOOR["centre"]):
        raise RuntimeError(
            f"PLACES['pause_room_door'] {L.PLACES['pause_room_door']} and DOOR['centre'] "
            f"{tuple(L.DOOR['centre'])} have drifted apart."
        )
    if 2 * PLACE_HALF_M > L.DOOR["width"]:
        raise RuntimeError(
            f"a {2 * PLACE_HALF_M:.2f} m place does not fit a {L.DOOR['width']:.2f} m "
            "doorway -- the door approach would extend past its own jambs"
        )

    specs: list[PlaceSpec] = []

    def open_floor(layout_key: str, pid: str, name: str, place_type: str, why: str) -> PlaceSpec:
        cx, cy = L.PLACES[layout_key]
        return PlaceSpec(
            id=pid, name=name, place_type=place_type,
            polygon=_rect(cx, cy, PLACE_HALF_M),
            derivation=f"PLACES['{layout_key}'] = ({cx:.3f}, {cy:.3f}), squared off at "
                       f"+/-{PLACE_HALF_M:.2f} m",
            role=why, layout_key=layout_key,
        )

    # 1. The authored spawn. Named so a mission can send the robot back to where it started.
    specs.append(open_floor(
        "robot_start", "ROBOT-START", "Robot Start", "staging",
        "where the robot spawns; the first leg starts here",
    ))

    # 2/3. The two open-floor landmarks the layout already names. Neither is on the mission
    # route -- `factory_centre` is BEHIND the robot relative to the door, and routing through
    # it would add about 4.5 m of backtrack -- but both are honest floor and a plan or a
    # patrol may want them by name.
    specs.append(open_floor(
        "factory_centre", "FACTORY-CENTRE", "Factory Centre", "aisle",
        "central lane between the two column rows; NOT on the door route",
    ))
    specs.append(open_floor(
        "west_aisle", "WEST-AISLE", "West Aisle", "aisle",
        "far end of the hall; NOT on the door route",
    ))

    # 4. The door approach: the apron of floor immediately south of the partition, on the
    # door's own centreline. Derived from DOOR, never from PLACES['pause_room_door'].
    door_x = L.DOOR["centre"][0]
    partition_south_face_y = L.DOOR["centre"][1] - L.WALL_THICKNESS / 2
    approach = PlaceSpec(
        id="PAUSE-ROOM-DOOR-APPROACH", name="Pause Room Door Approach",
        place_type="corridor",
        polygon=_rect(door_x, partition_south_face_y - PLACE_HALF_M, PLACE_HALF_M),
        derivation=(
            f"DOOR['centre'].x = {door_x:.3f} for the centreline; the north edge is the "
            f"partition's south face, DOOR['centre'].y - WALL_THICKNESS/2 = "
            f"{partition_south_face_y:.3f}; depth {2 * PLACE_HALF_M:.2f} m southward"
        ),
        role=("the waypoint that puts the last bearing before the throat on the doorway "
              "centreline instead of diagonally at a goal behind the door"),
    )

    # 5. Halfway along the first lane. Purely a stage-budget split; the point is the exact
    # midpoint of the two goals it sits between, so it bends the route by nothing.
    sx, sy = specs[0].centre
    ax, ay = approach.centre
    specs.append(PlaceSpec(
        id="HALL-MIDWAY", name="Hall Midway", place_type="corridor",
        polygon=_rect((sx + ax) / 2, (sy + ay) / 2, PLACE_HALF_M),
        derivation=(f"exact midpoint of ROBOT-START ({sx:.3f}, {sy:.3f}) and "
                    f"PAUSE-ROOM-DOOR-APPROACH ({ax:.3f}, {ay:.3f})"),
        role=("splits the 8 m crossing into two goto legs so each gets its own "
              "AGENT_MAX_NAV_STAGES budget; adds no detour"),
    ))
    specs.append(approach)

    # 6. The floor in front of the table -- the last place, and the only one both of whose
    # coordinates come from `standing_spot_for_grasp()`. The north edge is the grasp spot
    # plus the standoff that put it there, which IS the table's near face; deriving it that
    # way rather than from TABLE directly is what makes the spot LOAD-BEARING. Before, the
    # y half of the call's return value was computed and then dropped, so TABLE_STANDOFF
    # could move without a single emitted number changing and `--check` still said OK.
    stand_x, stand_y = L.standing_spot_for_grasp()
    north_edge = stand_y + L.TABLE_STANDOFF
    table_near_y = L.TABLE["pos"][1] - L.TABLE["size"][1] / 2
    if abs(north_edge - table_near_y) > 0.5 * 10 ** -COORD_DP:
        raise RuntimeError(
            f"standing_spot_for_grasp().y + TABLE_STANDOFF = {north_edge:.6f} but the "
            f"table's near face is at {table_near_y:.6f}. These are the same edge derived "
            "two ways; they have drifted apart, and this tool will not pick one."
        )
    specs.append(PlaceSpec(
        id="TABLE-FRONT", name="Table Front", place_type="cell",
        polygon=_rect(stand_x, north_edge - TABLE_FRONT_HALF_Y_M,
                      PLACE_HALF_M, TABLE_FRONT_HALF_Y_M),
        derivation=(
            f"standing_spot_for_grasp() = ({stand_x:.3f}, {stand_y:.3f}): x is the "
            f"centreline, and y + TABLE_STANDOFF {L.TABLE_STANDOFF:.2f} = {north_edge:.3f} "
            f"is the north edge (= the table's near face, {table_near_y:.3f}); depth "
            f"2 x {TABLE_FRONT_HALF_Y_M:.2f} m southward, width "
            f"2 x {PLACE_HALF_M:.2f} m -- the depth is capped so the arrival band is "
            f"{2 * (TABLE_FRONT_HALF_Y_M - PLACE_ENTRY_MARGIN_M):.2f} m rather than the "
            f"{2 * (PLACE_HALF_M - PLACE_ENTRY_MARGIN_M):.2f} m a square would give"
        ),
        role=("the goto target for the manipulation leg. Its centroid is NOT the grasp "
              "spot -- see the residual below"),
        layout_key="table_front",
    ))

    # --- nothing in PLACES may be silently forgotten ---------------------------------------
    emitted = {s.layout_key for s in specs if s.layout_key}
    accounted = emitted | set(NOT_EMITTED)
    missing = sorted(set(L.PLACES) - accounted)
    if missing:
        raise RuntimeError(
            f"PLACES has {len(missing)} entr{'y' if len(missing) == 1 else 'ies'} this tool "
            f"neither emits nor explains: {', '.join(missing)}. Add a PlaceSpec for it or a "
            "NOT_EMITTED reason. A place that quietly loses its polygon is a `goto` that "
            "fails by name at run time."
        )
    stale = sorted(set(NOT_EMITTED) - set(L.PLACES))
    if stale:
        raise RuntimeError(f"NOT_EMITTED explains places that no longer exist: {', '.join(stale)}")

    # --- no two places may claim the same floor -------------------------------------------
    # `PlaceTracker.findPlace` is written to a non-overlap invariant (place-resolver.ts:
    # 612-623: "the graphs are authored non-overlapping"), and its deepest-margin tie-break
    # exists only so a graph that breaks it still resolves deterministically. The ARRIVAL
    # regions matter even more than the polygons: two of those overlapping means one pose
    # satisfies `goto`'s arrival predicate for BOTH places, and a `goto` can then report
    # success while the robot stands in the other one -- a failure that looks like a
    # success, which is the one kind this file exists to make impossible.
    for i, a in enumerate(specs):
        for b in specs[i + 1:]:
            ox, oy = _overlap(_extent(a.polygon), _extent(b.polygon))
            if ox > 0 and oy > 0:
                raise RuntimeError(
                    f"'{a.id}' and '{b.id}' overlap by {ox:.3f} x {oy:.3f} m "
                    f"({ox * oy:.3f} m^2). Two places cannot own the same floor: "
                    "PlaceTracker.findPlace assumes they do not, and overlapping arrival "
                    "regions let one `goto` report arrival in the other place."
                )
            ox, oy = _overlap(arrival_region(a.polygon), arrival_region(b.polygon))
            if ox > 0 and oy > 0:
                raise RuntimeError(
                    f"the ARRIVAL regions of '{a.id}' and '{b.id}' overlap by "
                    f"{ox:.3f} x {oy:.3f} m even though their polygons do not -- one pose "
                    "would count as arrived in both."
                )
    # --- and every place must be arrivable at all -----------------------------------------
    for s in specs:
        (ax0, ax1), (ay0, ay1) = arrival_region(s.polygon)
        if ax1 - ax0 <= 0 or ay1 - ay0 <= 0:
            raise RuntimeError(
                f"'{s.id}' has a {max(ax1 - ax0, 0.0):.3f} x {max(ay1 - ay0, 0.0):.3f} m "
                f"arrival region: a pose must be {PLACE_ENTRY_MARGIN_M:.2f} m INSIDE the "
                "polygon before `goto` calls it arrived, so this place can never be "
                "arrived in, however close the robot gets to its centre."
            )
    return specs


def build_graph(L) -> dict:
    """The whole graph as plain JSON-able data.

    Note the ABSENCE of `frame.twinId`: its mere presence makes the frame unregistered
    (place-frame.ts:68-77) and an unregistered frame yields zero goto-able places. A sim
    graph belongs to no digital twin, and defaulting one would make the twin check in
    `PlaceGraphSource` pass by accident.
    """
    return {
        "version": GRAPH_VERSION,
        "frame": {
            "id": FRAME_ID,
            "kind": FRAME_KIND,
            "units": FRAME_UNITS,
            "yawConvention": FRAME_YAW_CONVENTION,
        },
        "places": [s.to_json_obj() for s in build_places(L)],
    }


# ==========================================================================================
# rendering
#
# Hand-rolled rather than `json.dumps(indent=2)` for one reason: `indent=2` puts every
# polygon VERTEX on its own line, which turns a six-place graph into 200 lines and makes a
# diff between two versions of a polygon unreadable. The shipped graphs in this directory
# (`places.isaac_warehouse.json` and friends) keep a polygon on one line, and matching them
# means a human can see at a glance which corner moved.
# ==========================================================================================
def _num(x: float) -> str:
    s = f"{x:.{COORD_DP}f}".rstrip("0").rstrip(".")
    return "0" if s in ("", "-0") else s


def render(graph: dict) -> str:
    frame = graph["frame"]
    out = [
        "{",
        f'  "version": {graph["version"]},',
        '  "frame": {',
        f'    "id": {_json_str(frame["id"])},',
        f'    "kind": {_json_str(frame["kind"])},',
        f'    "units": {_json_str(frame["units"])},',
        f'    "yawConvention": {_json_str(frame["yawConvention"])}',
        "  },",
        '  "places": [',
    ]
    blocks = []
    for p in graph["places"]:
        poly = ", ".join("[" + _num(v[0]) + ", " + _num(v[1]) + "]" for v in p["polygon"])
        blocks.append("\n".join([
            "    {",
            f'      "id": {_json_str(p["id"])},',
            f'      "name": {_json_str(p["name"])},',
            f'      "placeType": {_json_str(p["placeType"])},',
            f'      "floor": {p["floor"]},',
            f'      "polygon": [{poly}],',
            f'      "source": {_json_str(p["source"])},',
            f'      "keepout": {"true" if p["keepout"] else "false"},',
            f'      "landmarks": []',
            "    }",
        ]))
    out.append(",\n".join(blocks))
    out.append("  ]")
    out.append("}")
    return "\n".join(out) + "\n"


def _json_str(s: str) -> str:
    return '"' + s.replace("\\", "\\\\").replace('"', '\\"') + '"'


# ==========================================================================================
# what the graph cannot say, said out loud
# ==========================================================================================
def residual_report(L, specs: list[PlaceSpec]) -> list[str]:
    """Lines naming every gap between "arrived" and "able to grasp".

    Printed on every run, not buried: each of these is a thing the mission plan has to do
    with an explicit block, and each of them was, in some earlier form, a thing that failed
    silently.
    """
    lines: list[str] = []
    by_id = {s.id: s for s in specs}
    stand = L.standing_spot_for_grasp()
    tf = by_id["TABLE-FRONT"]
    goal = tf.centre
    residual = math.dist(goal, stand)
    (ax0, ax1), (ay0, ay1) = arrival_region(tf.polygon)
    worst = max(math.dist((x, y), stand) for x in (ax0, ax1) for y in (ay0, ay1))
    lines.append(
        f"TABLE-FRONT's goal is ({goal[0]:.3f}, {goal[1]:.3f}); the grasp spot is "
        f"({stand[0]:.3f}, {stand[1]:.3f}). The mission must walk the remaining "
        f"{residual:.3f} m (up to {worst:.3f} m from the far corner of the "
        f"{ax1 - ax0:.2f} x {ay1 - ay0:.2f} m arrival patch, and the robot walking in from "
        f"the south enters that patch at y = {ay0:.3f}, {stand[1] - ay0:.3f} m short) with "
        "an explicit block -- `goto` stops anywhere inside the patch."
    )
    reach_y = reach_limit_y(L, stand[0])
    lines.append(
        f"NO pose that `goto TABLE-FRONT` can call arrived is within reach of the apple. "
        f"The patch reaches y = {ay1:.3f} at its northern edge (the table's near face less "
        f"the {PLACE_ENTRY_MARGIN_M:.2f} m entry margin), and standing on the grasp "
        f"centreline the reach budget is not met south of y = {reach_y:.3f}. The appended "
        f"walk is not a refinement of the goto, it is the {reach_y - ay1:.3f} m minimum that "
        "makes the grasp possible at all."
    )
    for key, deg in sorted(L.PLACE_HEADINGS.items()):
        lines.append(
            f"PLACE_HEADINGS['{key}'] = {deg:.1f} deg is NOT in the graph and CANNOT be: "
            "the schema has no heading field and `goto` issues no final alignment turn. "
            "Append a `turn` block, or use a patrol checkpoint's headingDeg + capture."
        )
    lines.append(
        f"No keepouts are emitted. The table stands {L.TABLE_STANDOFF:.2f} m from the grasp "
        f"spot and the doorway is {L.DOOR['width']:.2f} m wide; a 0.50 m geofence margin "
        "would stop the robot on arrival and seal the door. Walls reach the planner through "
        "the lidar occupancy map instead."
    )
    return lines


def reach_limit_y(L, x: float) -> float:
    """Southernmost y on the vertical line `x` from which the apple is still in budget.

    Solved rather than searched: at yaw 90 deg the left shoulder sits at
    (x - SHOULDER_LATERAL, y, base_z + SHOULDER_ABOVE_PELVIS), so the reach is
    sqrt(dx^2 + (apple_y - y)^2 + dz^2) and the constraint inverts directly. Taken over the
    whole observed base-height band, worst case -- a crouch lowers the shoulder, which
    shortens the horizontal reach to a target above it.
    """
    apple = L.APPLE["pos"]
    worst = None
    for base_z in L.BASE_HEIGHT_BAND:
        dx = apple[0] - (x - L.SHOULDER_LATERAL)
        dz = apple[2] - (base_z + L.SHOULDER_ABOVE_PELVIS)
        radicand = L.GRASP_REACH_BUDGET ** 2 - dx * dx - dz * dz
        if radicand <= 0:  # pragma: no cover - this centreline would be unreachable at any y
            return float("inf")
        y = apple[1] - math.sqrt(radicand)
        worst = y if worst is None else max(worst, y)
    return worst


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--check", action="store_true",
                    help="do not write; exit 1 if the checked-in file is out of date")
    args = ap.parse_args()

    L = load_layout()
    specs = build_places(L)
    text = render(build_graph(L))
    out = os.path.normpath(OUT_JSON)

    if args.check:
        if not os.path.isfile(out):
            print(f"MISSING: {out}")
            print("  the place graph has never been generated; run this tool with no arguments")
            return 1
        with open(out, encoding="utf-8") as fh:
            current = fh.read()
        if current != text:
            print(f"STALE: {out} differs from what the layout module generates")
            print("  Agent Mode navigates on the FILE, and every offline check measures the")
            print("  LAYOUT. Regenerate: python3 make_factory_place_graph.py")
            return 1
        print(f"OK: {out} is up to date ({len(specs)} places)")
        return 0

    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, "w", encoding="utf-8") as fh:
        fh.write(text)
    print(f"wrote {out} ({len(text)} bytes, {len(specs)} places)")
    for s in specs:
        cx, cy = s.centre
        print(f"  {s.id:<26} goal ({cx:7.3f}, {cy:7.3f})  {s.place_type:<8} -- {s.derivation}")
    for key, why in sorted(NOT_EMITTED.items()):
        print(f"  {'(not emitted)':<26} {key}: {why}")
    print()
    for line in residual_report(L, specs):
        print(f"  NOTE: {line}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
