# NeoDEM. Apache License, Version 2.0 (same terms as the surrounding Unitree checkout).
"""Every number in the `Isaac-Factory-PauseRoom-G129-Dex3-Wholebody` scene, and nothing else.

WHY THIS FILE EXISTS SEPARATELY FROM THE SCENE CFG
--------------------------------------------------
`base_scene_factory_pauseroom.py` cannot be imported without Isaac Lab, and Isaac Lab
cannot be imported without a GPU and a Kit app. That would leave the geometry -- the part
that is actually easy to get wrong, and expensive to discover wrong 2 minutes into a
launch -- unverifiable except by launching the simulator.

So the geometry lives HERE, in a module that imports nothing but `math` and `os` --
`os` only to read the one environment variable that selects the spawn pose, see
`robot_spawn` below; there is nothing here that touches a GPU, a network or a USD. The
scene cfg
reads it, and `verify_factory_scene_offline.py` reads the same constants and checks them
with real arithmetic on a machine with no GPU. The two cannot drift, because there is one
copy of each number.

COORDINATE FRAME
----------------
World frame, +z up, metres. The task runs with `num_envs=1`, so the single env origin is
the world origin and every coordinate below is simultaneously an env-local and a world
coordinate. (With num_envs > 1 the `/World/envs/env_.*` content is offset per env; the
ground slab and the cameras, which live outside `/World/envs`, are not. This scene is
authored for num_envs=1 only -- see the README.)

QUATERNIONS -- READ THIS BEFORE COPYING ANY `rot=`
--------------------------------------------------
Isaac Lab 3.0 in this checkout stores `InitialStateCfg.rot` and `CameraCfg.OffsetCfg.rot`
as **(x, y, z, w)**. That is not a guess:

    IsaacLab30/source/isaaclab/isaaclab/assets/asset_base_cfg.py:37-40
        rot: tuple[float, float, float, float] = (0.0, 0.0, 0.0, 1.0)
        \"\"\"Quaternion rotation (x, y, z, w) of the root in simulation world frame.\"\"\"
    IsaacLab30/source/isaaclab/isaaclab/sensors/camera/camera_cfg.py:46-47
        rot: ... = (0.0, 0.0, 0.0, 1.0)
        \"\"\"Quaternion rotation (x, y, z, w) w.r.t. the parent frame.\"\"\"

Unitree's own cfgs are 2.x-era and write (w, x, y, z); copying one of their literals
lands the prim rotated 180 deg about X (see `robot-agent/hardware/isaac_capture.py:35-39`).

The ONE exception is `G1RobotPresets.*`, which takes (w, x, y, z) and reorders internally
at `tasks/common_config/robot_configs.py:230-239`. So the robot's `init_rot` is WXYZ and
everything else in this scene is XYZW. Both helpers below are named for their order.
"""

from __future__ import annotations

import math
import os

# ---------------------------------------------------------------------------------------
# Quaternion helpers. Every caller must say which order it wants in the function name.
# ---------------------------------------------------------------------------------------


def yaw_quat_xyzw(deg: float) -> tuple[float, float, float, float]:
    """Rotation of `deg` about world +z, as (x, y, z, w) -- Isaac Lab 3.0 order."""
    h = math.radians(deg) * 0.5
    return (0.0, 0.0, math.sin(h), math.cos(h))


def yaw_quat_wxyz(deg: float) -> tuple[float, float, float, float]:
    """Rotation of `deg` about world +z, as (w, x, y, z) -- the order `G1RobotPresets` wants."""
    h = math.radians(deg) * 0.5
    return (math.cos(h), 0.0, 0.0, math.sin(h))


IDENTITY_XYZW: tuple[float, float, float, float] = (0.0, 0.0, 0.0, 1.0)
"""Identity in Isaac Lab 3.0 order. NOT (1, 0, 0, 0) -- that is a 180 deg roll about X here."""


def _norm(v: tuple[float, float, float]) -> tuple[float, float, float]:
    n = math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2])
    if n == 0.0:
        raise ValueError("cannot normalise a zero vector")
    return (v[0] / n, v[1] / n, v[2] / n)


def _cross(a, b):
    return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])


def look_at_quat_xyzw_ros(eye, target) -> tuple[float, float, float, float]:
    """Orientation, as (x, y, z, w), that points a ROS-convention camera at `target`.

    `CameraBaseCfg.get_camera_config` hardcodes `convention="ros"`, in which the camera's
    own +Z is forward, +Y is DOWN and +X is right (camera_cfg.py:49-56). So the rotation
    matrix is the columns [right | down | forward] expressed in world, which is what this
    builds before converting to a quaternion.

    Deriving this rather than hand-writing a literal is deliberate: a look-at is checkable
    (the offline verifier re-rotates +Z by the result and compares it against the
    eye->target direction), whereas a pasted four-tuple is not.
    """
    f = _norm((target[0] - eye[0], target[1] - eye[1], target[2] - eye[2]))
    up = (0.0, 0.0, 1.0)
    if abs(f[2]) > 0.999:  # looking straight down/up -- +z is degenerate as the up hint
        up = (0.0, 1.0, 0.0)
    r = _norm(_cross(f, up))
    d = _cross(f, r)  # right x down == forward, i.e. [r|d|f] is right-handed
    m = ((r[0], d[0], f[0]), (r[1], d[1], f[1]), (r[2], d[2], f[2]))
    t = m[0][0] + m[1][1] + m[2][2]
    if t > 0.0:
        s = math.sqrt(t + 1.0) * 2.0
        w, x, y, z = 0.25 * s, (m[2][1] - m[1][2]) / s, (m[0][2] - m[2][0]) / s, (m[1][0] - m[0][1]) / s
    elif m[0][0] > m[1][1] and m[0][0] > m[2][2]:
        s = math.sqrt(1.0 + m[0][0] - m[1][1] - m[2][2]) * 2.0
        w, x, y, z = (m[2][1] - m[1][2]) / s, 0.25 * s, (m[0][1] + m[1][0]) / s, (m[0][2] + m[2][0]) / s
    elif m[1][1] > m[2][2]:
        s = math.sqrt(1.0 + m[1][1] - m[0][0] - m[2][2]) * 2.0
        w, x, y, z = (m[0][2] - m[2][0]) / s, (m[0][1] + m[1][0]) / s, 0.25 * s, (m[1][2] + m[2][1]) / s
    else:
        s = math.sqrt(1.0 + m[2][2] - m[0][0] - m[1][1]) * 2.0
        w, x, y, z = (m[1][0] - m[0][1]) / s, (m[0][2] + m[2][0]) / s, (m[1][2] + m[2][1]) / s, 0.25 * s
    n = math.sqrt(x * x + y * y + z * z + w * w)
    return (x / n, y / n, z / n, w / n)


def rotate_xyzw(q, v):
    """Rotate vector `v` by quaternion `q` given as (x, y, z, w). For the offline checks."""
    x, y, z, w = q
    qv = (x, y, z)
    t = _cross(qv, v)
    t = (t[0] + w * v[0], t[1] + w * v[1], t[2] + w * v[2])
    t2 = _cross(qv, t)
    return (v[0] + 2 * t2[0], v[1] + 2 * t2[1], v[2] + 2 * t2[2])


# ---------------------------------------------------------------------------------------
# The floor.
#
# NOT `GroundPlaneCfg()`. Its default `usd_path` is
#   f"{ISAAC_NUCLEUS_DIR}/Environments/Grid/default_environment.usd"
# (IsaacLab30/.../sim/spawners/from_files/from_files_cfg.py:218) and ISAAC_NUCLEUS_DIR
# resolves to https://omniverse-content-production.s3-us-west-2.amazonaws.com/Assets/Isaac/6.0/Isaac
# (IsaacLab30/apps/isaaclab.python.kit:310). That is an HTTPS fetch at first use. This
# scene has a hard requirement to load with the network unplugged, so the floor is a local
# static box collider instead -- same prim path, same job, no download.
#
# It is 26 x 18 m: 1 m wider than the outer wall footprint on every side, so the robot can
# never reach an edge. Its TOP face is at exactly z = 0.0, which is what makes the robot's
# z = 0.8 spawn height mean the same thing here as in the move_cylinder scene.
#
# THE PRIM PATH IS OUTSIDE /World/envs ON PURPOSE. With replicate_physics=True everything
# under /World/envs/env_.* is cloned per env; a floor is not per-env furniture. This is the
# TASK-223 rule -- see base_scene_pickplace_cylindercfg_wholebody.py:78-96, where a missing
# floor made the G1 free-fall to -39 km while still reporting itself perfectly upright.
# ---------------------------------------------------------------------------------------
GROUND_PRIM_PATH = "/World/GroundPlane"
GROUND = {"pos": (0.0, 0.0, -0.20), "size": (26.0, 18.0, 0.40)}
GROUND_TOP_Z = GROUND["pos"][2] + GROUND["size"][2] * 0.5  # == 0.0

# ---------------------------------------------------------------------------------------
# The factory hall. 24 x 16 m of clear interior floor.
# ---------------------------------------------------------------------------------------
WALL_THICKNESS = 0.20
HALL_HEIGHT = 4.00
HALL = {"x_min": -12.0, "x_max": 12.0, "y_min": -8.0, "y_max": 8.0}
"""Interior extent (the inner faces of the perimeter walls)."""

# ---------------------------------------------------------------------------------------
# The pause room: a 4 x 4 m walled side room in the +x/+y corner. Its north and east walls
# ARE the hall's north and east walls; only the west and south walls are new partitions.
# The south wall carries the doorway.
# ---------------------------------------------------------------------------------------
PAUSE_HEIGHT = 3.00
PAUSE_ROOM = {"x_min": 8.0, "x_max": 12.0, "y_min": 4.0, "y_max": 8.0}
DOOR = {
    "centre": (10.00, 3.90),
    "width": 1.40,          # clear opening, x in [9.30, 10.70]
    "clear_height": 2.20,   # underside of the lintel; the G1 is ~1.32 m tall
}

# ---------------------------------------------------------------------------------------
# THE DOOR ITSELF -- a POWERED, AUTOMATIC, TWO-LEAF SLIDING DOOR.
#
# Why powered and automatic, and not a handle the robot opens: making a humanoid operate a
# door handle is its own research problem (contact-rich, bimanual, and nothing in this
# stack has a policy for it). A real factory pause room has an automatic door precisely so
# that people carrying things do not have to. So does this one: it senses the robot and
# opens. The robot never touches it.
#
# Why SLIDING and not hinged: a hinged leaf sweeps an arc through the space in front of
# the doorway -- exactly where a 1.32 m humanoid is standing when the door decides to open.
# Sliding leaves retract along the wall and never occupy any space the robot walks through.
#
# The leaves are REAL ARTICULATED GEOMETRY, not a prop that vanishes: two rigid bodies on
# prismatic joints inside `pause_room_door.usda`, with colliders. Shut, they close the
# doorway; a robot walking into them hits them. See `make_pause_room_door_usda.py`, which
# GENERATES that USD from the constants below so the two cannot drift.
#
# Everything here is derived from DOOR: a leaf is half the opening (plus a small overlap
# onto its jamb so the shut door has no seam gap), and its travel is exactly half the
# opening, which is what restores the full declared clear width when open.
# ---------------------------------------------------------------------------------------
DOOR_LEAF = {
    # How far each leaf overlaps its jamb when shut. Without it the two leaves and the two
    # jambs meet on exactly coincident planes, and a shut door has three zero-width seams
    # that a contact solver may or may not treat as closed. 20 mm is a real door's overlap.
    # Note it removes TWO of those three: the leaf-to-jamb seams. The leaf-to-leaf seam at
    # the middle of the doorway is still exactly zero-width -- it has to be, or the shut
    # door would have a gap -- so the two leaves are permanently inside each other's PhysX
    # contact offset. The offline verifier reports that number rather than hiding it.
    "jamb_overlap": 0.02,
    # Leaf panel thickness. Thin because the leaves hang off a header rail and carry no
    # load; thick enough to be a solid collider rather than a shell.
    "thickness": 0.06,
    # Gap under the leaf. A real sliding door does not scrape the floor, and a leaf resting
    # on the floor collider would fight it every step.
    "floor_gap": 0.02,
    # Gap between the top of the leaf and the underside of the lintel, for the same reason.
    "head_gap": 0.02,
    # The leaves hang on the PAUSE-ROOM side of the partition (its +y face), so they slide
    # clear of the wall instead of through it. This is the leaf mid-plane's offset from
    # that face, i.e. half the leaf thickness -> the leaf's near face is flush with it.
    "wall_face_offset": 0.03,
    # Header rail: the fixed base link of the articulation, above the doorway. It is what
    # the prismatic joints hang from, and it is the reason the articulation has a body to
    # be world-fixed to. Its underside sits at the declared clear height, so it never
    # intrudes on the walking envelope.
    "rail_height": 0.08,
    "rail_thickness": 0.06,
}

DOOR_LEAF_TRAVEL = DOOR["width"] / 2
"""Stroke of ONE leaf, metres. Half the opening, because two leaves share it."""

DOOR_LEAF_WIDTH = DOOR["width"] / 2 + DOOR_LEAF["jamb_overlap"]
"""Width of ONE leaf. Half the opening plus the jamb overlap."""

DOOR_LEAF_HEIGHT = DOOR["clear_height"] - DOOR_LEAF["floor_gap"] - DOOR_LEAF["head_gap"]
"""Leaf height: the clear opening less the floor and head gaps."""

DOOR_WALL_FACE_Y = DOOR["centre"][1] + WALL_THICKNESS / 2
"""The pause-room-side face of the south partition -- the plane the leaves slide along."""

DOOR_ORIGIN = (DOOR["centre"][0], DOOR_WALL_FACE_Y + DOOR_LEAF["wall_face_offset"], 0.0)
"""World placement of the door articulation. Its own local frame has x along the slide
axis, +y into the pause room, and z = 0 on the floor, so every number in the USD is a
signed offset from the middle of the doorway at floor level."""

# Joint names. These are the names in `pause_room_door.usda`, the names the actuator cfg
# matches, and the names anything driving the door at runtime must use. `door_left_joint`
# and `door_right_joint` are deliberately the SAME names the checkout's own articulated
# prop uses (`base_scene_pick_redblock_into_drawer.py:107-108`), so the one prior art in
# this repo for driving a door reads across unchanged.
DOOR_JOINTS = ("door_left_joint", "door_right_joint")

DOOR_USD_FILENAME = "pause_room_door.usda"
"""The door's USD, generated by `make_pause_room_door_usda.py` from the constants here.

It is USDA (text), not USDC, on purpose: it is 6.8 kB of reviewable ASCII, it diffs, and
it needs no tooling to read. It is resolved by `base_scene_factory_pauseroom.py` relative to
that module's own directory -- NOT via PROJECT_ROOT -- so it installs into the checkout as
one more file in `tasks/common_scene/` and needs no nucleus, no network and no env var.
"""

DOOR_LEAF_MASS = 25.0
"""Mass of one leaf, kg. A 0.72 x 0.06 x 2.16 m panel; a real glazed sliding leaf of that
size is 20-30 kg. It matters only through the actuator: too light and a contact flings the
leaf, too heavy and the drive gains below cannot hold it."""

DOOR_RAIL_MASS = 40.0
"""Mass of the header rail. Irrelevant to the physics -- the rail is world-fixed by the
articulation's root joint -- but PhysX wants a non-zero mass on every link."""

DOOR_DRIVE = {
    # Position drive on each prismatic joint. Stiff enough that a leaf holds its commanded
    # position against a shove from a 35 kg humanoid, soft enough not to explode on the
    # first contact. `max_force` caps that: at 200 N the door pushes, but it cannot launch
    # anything, which keeps a bumped door from becoming a scene-ending event.
    "stiffness": 800.0,
    "damping": 120.0,
    "max_force": 200.0,
}

# Both leaves slide along the local +x axis, so the left leaf's open direction is NEGATIVE.
# Keeping one axis for both (rather than mirroring one leaf's joint frame) means the USD
# has no rotated joint frames to get wrong; the sign lives here instead, in one place.
DOOR_JOINT_SIGN = {"door_left_joint": -1.0, "door_right_joint": +1.0}

# ---------------------------------------------------------------------------------------
# The door's automation. A real automatic door has a presence sensor with a few metres of
# range and hysteresis, so it does not chatter when someone stands on the threshold.
#
# The radii are generous because the measured walk speed in this scene is ~0.11 m/s (see
# the README's live-sim section). Two arrival times, and it is worth naming which is which
# because they differ by a factor of 1.4: from the 2.50 m trigger radius to the door CENTRE
# is 22.7 s, and to the near EDGE of the opening -- the first point at which a leaf could
# be in the way, and therefore the binding one -- is (2.50 - 0.70) / 0.11 = 16.4 s. The
# leaves need 1.17 s. The verifier asserts against the edge figure.
# That is the point -- the robot must never have to wait, let alone push.
# ---------------------------------------------------------------------------------------
DOOR_AUTOMATION = {
    "open_radius": 2.50,   # start opening when the robot is this close to the door centre
    "shut_radius": 3.20,   # ...and only shut again beyond this. 0.70 m of hysteresis.
    "leaf_speed": 0.60,    # m/s of leaf travel -> a full 0.70 m stroke in 1.17 s
}


def door_joint_targets(openness: float) -> dict[str, float]:
    """Joint positions, in metres, for an openness of 0 (shut) to 1 (fully open).

    This is the ONE place the openness scalar becomes joint coordinates. Anything driving
    the door at runtime should call it rather than re-deriving the signs.
    """
    u = min(1.0, max(0.0, float(openness)))
    return {name: DOOR_JOINT_SIGN[name] * u * DOOR_LEAF_TRAVEL for name in DOOR_JOINTS}


def door_joint_limits() -> dict[str, tuple[float, float]]:
    """(lower, upper) travel limit of each leaf joint, metres. Shut is always 0."""
    out = {}
    for name in DOOR_JOINTS:
        s = DOOR_JOINT_SIGN[name] * DOOR_LEAF_TRAVEL
        out[name] = (min(0.0, s), max(0.0, s))
    return out


def door_leaf_boxes(openness: float) -> dict[str, dict]:
    """The two leaves as {"pos", "size"} world boxes at a given openness.

    Used by the offline verifier to prove, by interval arithmetic rather than by faith,
    that the shut door really covers the opening and the open door really clears it.
    """
    u = min(1.0, max(0.0, float(openness)))
    cx = DOOR["centre"][0]
    y = DOOR_ORIGIN[1]
    z = DOOR_LEAF["floor_gap"] + DOOR_LEAF_HEIGHT / 2
    size = (DOOR_LEAF_WIDTH, DOOR_LEAF["thickness"], DOOR_LEAF_HEIGHT)
    out = {}
    for name in DOOR_JOINTS:
        # Shut, a leaf's inner edge is at the doorway centre; it slides outward by u*travel.
        shut_centre = cx + DOOR_JOINT_SIGN[name] * DOOR_LEAF_WIDTH / 2
        out[name] = {"pos": (shut_centre + DOOR_JOINT_SIGN[name] * u * DOOR_LEAF_TRAVEL, y, z),
                     "size": size}
    return out


def door_rail_box() -> dict:
    """The header rail: the articulation's fixed base link, above the doorway.

    Long enough to span the doorway plus both leaves' full travel, so an open leaf is
    always still under it.
    """
    return {
        "pos": (DOOR["centre"][0], DOOR_ORIGIN[1],
                DOOR["clear_height"] + DOOR_LEAF["rail_height"] / 2),
        "size": (DOOR["width"] + 2 * DOOR_LEAF_TRAVEL + 2 * DOOR_LEAF["jamb_overlap"],
                 DOOR_LEAF["rail_thickness"], DOOR_LEAF["rail_height"]),
    }


def door_clear_width(openness: float) -> float:
    """How much clear width the doorway actually offers at this openness, metres.

    Linear, because each leaf uncovers exactly its own half: at u the gap between the two
    leaves is 2 * u * DOOR_LEAF_TRAVEL == u * DOOR["width"], and at u = 1 the leaf edges
    land exactly on the jambs, so the gap is never limited by anything else.
    """
    u = min(1.0, max(0.0, float(openness)))
    return u * DOOR["width"]


def door_should_open(robot_xy: tuple[float, float], currently_open: bool) -> bool:
    """The presence sensor, as a pure function. True == command the door open.

    Hysteresis: it opens inside `open_radius` and only shuts again outside `shut_radius`,
    so a robot loitering at the threshold does not make the leaves oscillate.
    """
    d = math.hypot(robot_xy[0] - DOOR["centre"][0], robot_xy[1] - DOOR["centre"][1])
    if d <= DOOR_AUTOMATION["open_radius"]:
        return True
    if d >= DOOR_AUTOMATION["shut_radius"]:
        return False
    return bool(currently_open)


def door_advance_openness(current: float, want_open: bool, dt: float) -> float:
    """Move `current` openness toward the commanded end state at the leaves' real speed.

    A door is not a teleport. Rate-limiting here (rather than commanding the end position
    and letting the actuator sort it out) means the leaves are *asked* to move at their
    real speed; the openness that gets logged is read back from the joints by
    `pause_door.py`.

    That distinction is the whole of a defect this scene already shipped once. This
    docstring used to claim the rate limiter meant "the openness scalar that gets logged
    and scored is the openness the leaves are actually at" -- which it never did. A
    commanded value is a command; a leaf that jams, lags or is shoved does not report it.
    The claim is true today only because the driver MEASURES `door.data.joint_pos` and
    reports that instead. Rate-limiting alone would never have made it true.
    """
    if DOOR_LEAF_TRAVEL <= 0.0:
        return 1.0 if want_open else 0.0
    step = DOOR_AUTOMATION["leaf_speed"] * max(0.0, dt) / DOOR_LEAF_TRAVEL
    target = 1.0 if want_open else 0.0
    if current < target:
        return min(target, current + step)
    return max(target, current - step)

# Static boxes: name -> {"pos": (x, y, z) centre, "size": (sx, sy, sz) full extents}.
# The verifier reconstructs the room from exactly this dict, so a wall that is not here
# does not exist as far as the enclosure check is concerned.
WALLS: dict[str, dict] = {
    # --- factory perimeter, 4 m tall. N/S run long so they cap the E/W walls' ends.
    "wall_south": {"pos": (0.00, -8.10, 2.00), "size": (24.40, 0.20, 4.00)},
    "wall_north": {"pos": (0.00, 8.10, 2.00), "size": (24.40, 0.20, 4.00)},
    "wall_west": {"pos": (-12.10, 0.00, 2.00), "size": (0.20, 16.00, 4.00)},
    "wall_east": {"pos": (12.10, 0.00, 2.00), "size": (0.20, 16.00, 4.00)},
    # --- pause-room partitions, 3 m tall.
    # West partition: x in [7.8, 8.0], y from 3.8 up to the hall's north inner face at 8.0.
    "pause_wall_west": {"pos": (7.90, 5.90, 1.50), "size": (0.20, 4.20, 3.00)},
    # South partition, in two pieces with the doorway between them:
    #   left  x in [7.80,  9.30]   gap x in [9.30, 10.70]   right x in [10.70, 12.00]
    "pause_wall_south_left": {"pos": (8.55, 3.90, 1.50), "size": (1.50, 0.20, 3.00)},
    "pause_wall_south_right": {"pos": (11.35, 3.90, 1.50), "size": (1.30, 0.20, 3.00)},
    # Lintel over the doorway. Its underside is at z = 2.20, so it does not narrow the
    # opening anywhere the robot can reach; the verifier ignores segments that start above
    # WALK_CLEARANCE_Z for exactly this reason.
    "pause_door_lintel": {"pos": (10.00, 3.90, 2.60), "size": (1.40, 0.20, 0.80)},
}

WALK_CLEARANCE_Z = 2.00
"""Height below which geometry counts as blocking a walking G1 (it is ~1.32 m tall)."""

# ---------------------------------------------------------------------------------------
# Structural columns. Two rows at y = +/-4, which turns one empty box into a central lane
# plus two side aisles. Deliberately absent from x >= 8: that is the pause room.
# ---------------------------------------------------------------------------------------
COLUMN_SIZE = (0.35, 0.35, 4.00)
COLUMNS: dict[str, dict] = {
    f"column_{i:02d}": {"pos": (x, y, 2.00), "size": COLUMN_SIZE}
    for i, (x, y) in enumerate(
        [(-8.0, -4.0), (-4.0, -4.0), (0.0, -4.0), (4.0, -4.0),
         (-8.0, 4.0), (-4.0, 4.0), (0.0, 4.0), (4.0, 4.0)]
    )
}

# ---------------------------------------------------------------------------------------
# Palletised crates, as static primitive boxes. Dressing, and something for a future
# ray-cast / occupancy map to find.
#
# THE WEST ROW USED TO START AT y = -6.0, AND THAT CRATE TOUCHED `packing_table_a`.
# The crate's near face was at x = -10.00 and the prop's origin is at x = -9.00, i.e.
# EXACTLY 1.00 m apart -- against the 1.00 m half-extent the offline verifier charges every
# USD prop, because these assets' real bounding boxes cannot be read without Isaac. By the
# scene's own model the two bodies were in contact; the true clearance was somewhere
# between 0 and about 8 cm, depending on a footprint nobody here can measure. Both bodies
# are static, so nothing would have exploded -- it would simply have rendered as a crate
# growing out of a packing table, and nothing in this repo would have said so.
#
# The crate moved one row pitch north instead, to y = -3.2. That keeps the row's x, keeps
# the 1.4 m pitch and the 0.4 m crate-to-crate gap, and puts 2.97 m between the prop origin
# and the crate. `check_body_clearance` in the offline verifier is what now holds this.
# ---------------------------------------------------------------------------------------
CRATE_SIZE = (1.00, 1.00, 0.90)
CRATES: dict[str, dict] = {
    f"crate_{i:02d}": {"pos": (x, y, 0.45), "size": CRATE_SIZE}
    for i, (x, y) in enumerate(
        [(-10.5, -4.6), (-10.5, -3.2), (-10.5, 1.0), (-10.5, 2.4), (-2.0, 0.0), (-2.0, 1.2)]
    )
}

# ---------------------------------------------------------------------------------------
# Dressing from USDs that are ON DISK IN THE CHECKOUT. Paths are relative to PROJECT_ROOT,
# which `sim_main.py:8-9` sets to the checkout root. Nothing here is a nucleus/HTTPS path.
#
# All five are already spawned by shipping scenes, which is the only reason they are
# trusted: PackingTable{,_1,_2} by base_scene_pickplace_cylindercfg_wholebody.py:35-53 and
# table_with_yellowbox.usd by base_scene_pickplace_redblock.py:35-43. The z = -0.2 is
# copied from those call sites -- these assets' origins sit 0.2 m above their own feet.
#
# `assets/objects/drawers/drawer.usd` and the two small_warehouse USDs also exist on disk
# and are deliberately NOT used; the README says why.
# ---------------------------------------------------------------------------------------
USD_PROPS: dict[str, dict] = {
    "packing_table_a": {"rel_path": "assets/objects/PackingTable/PackingTable.usd",
                        "pos": (-9.00, -6.50, -0.20)},
    "packing_table_b": {"rel_path": "assets/objects/PackingTable_1/PackingTable.usd",
                        "pos": (-9.00, 5.50, -0.20)},
    "packing_table_c": {"rel_path": "assets/objects/PackingTable_2/PackingTable.usd",
                        "pos": (0.00, 6.50, -0.20)},
    "yellowbox_table_a": {"rel_path": "assets/objects/table_with_yellowbox.usd",
                          "pos": (-3.50, -6.50, -0.20)},
    "yellowbox_table_b": {"rel_path": "assets/objects/table_with_yellowbox.usd",
                          "pos": (5.00, -6.50, -0.20)},
}

# ---------------------------------------------------------------------------------------
# The manipulation setup inside the pause room.
#
# Dimensions are lifted from robot-agent/hardware/sim_evaluator/mjcf/g1_apple_pnp_scene.xml
# so the MuJoCo and Isaac versions of this task stay comparable. The MJCF's table is a box
# of half-extents (0.61, 0.60, 0.375) with its top at z = 0.75; the apple and the plate sit
# near the table's front edge, on the side the robot approaches from.
#
# The MJCF places them at world (-0.22, 0.46) and (-0.05, 0.365) with the table centred at
# (-0.39, 0.80). Only the OFFSETS from the table centre survive the move into this scene:
#     apple - table = (+0.17, -0.34)      plate - table = (+0.34, -0.435)
# and the table is oriented the same way (its front edge faces -y, the robot approaches
# from -y), so those offsets transfer unrotated.
# ---------------------------------------------------------------------------------------
TABLE = {"pos": (10.00, 6.60, 0.375), "size": (1.22, 1.20, 0.75)}
TABLE_TOP_Z = TABLE["pos"][2] + TABLE["size"][2] * 0.5  # == 0.75, as in the MJCF

# White 19 cm dish. MuJoCo's cylinder `size="0.095 0.01"` is (radius, HALF height), so the
# full height is 0.02 and the centre sits at 0.76 -> top at 0.77. Static: this is the
# target of the place, not a manipuland.
PLATE = {"pos": (10.34, 6.165, 0.76), "radius": 0.095, "height": 0.02,
         "colour": (0.886, 0.888, 0.912)}

# The apple. The MJCF uses an ellipsoid (0.04, 0.04, 0.036); Isaac Lab has no ellipsoid
# spawner, so this is a SphereCfg of r = 0.04 -- 4 mm taller than the MJCF apple and
# perfectly round. That is an accepted approximation, not an oversight.
#
# Spawned 5 mm clear of the table top (centre 0.795 = 0.75 + 0.04 + 0.005) so it settles
# rather than starting interpenetrating. Friction 1.2 is carried over from the MJCF, where
# the low-friction version rolled more than a metre off the table on any grazing contact
# and ended episodes the policy could otherwise have retried.
APPLE = {"pos": (10.17, 6.26, 0.795), "radius": 0.04, "mass": 0.18,
         "friction": 1.2, "restitution": 0.0, "colour": (0.86, 0.24, 0.16)}

# Half-widths of the box the `reset_object_self` event re-samples the apple's start pose
# over. The env cfg reads these; so does the offline verifier, which is how the value was
# chosen: the apple starts 0.195 m from the plate centre and the plate's rim plus the
# apple's radius is 0.135 m, so a jitter of +/-0.05 x / +/-0.04 y (the move_cylinder task's
# numbers, the obvious thing to copy) puts the worst corner at 0.132 m -- the apple would
# occasionally start touching the plate it is supposed to be moved TO, silently scoring the
# episode as already-solved. +/-0.03 leaves the worst corner at 0.154 m.
APPLE_RESET_JITTER = {"x": 0.03, "y": 0.03}

# ---------------------------------------------------------------------------------------
# The robot. On the factory floor, 8.4 m from the pause-room door, facing it.
# `init_rot` is (w, x, y, z) because G1RobotPresets reorders it -- see the module docstring.
# Yaw 0 points the G1 along world +x (the same convention the MJCF scene documents when it
# bakes +90 deg to face world +y), so 45 deg aims at (10.0, 3.9) from (4.0, -2.0): the
# exact bearing is atan2(5.9, 6.0) = 44.5 deg.
# ---------------------------------------------------------------------------------------
ROBOT = {"pos": (4.00, -2.00, 0.80), "yaw_deg": 45.0}

# ---------------------------------------------------------------------------------------
# REACH. Where the robot has to stand for the apple to be pickable at all.
#
# THIS SECTION EXISTS BECAUSE THE FIRST VERSION OF THIS SCENE GOT IT WRONG. `table_front`
# was hand-typed as (10.00, 5.35) -- "0.65 m clear of the table edge", which sounds
# reasonable and is not. It put the apple 0.926 m from the pelvis and 0.992 m from the
# shoulder, against roughly 0.53 m of practical arm. The robot could not have touched its
# own target from its own authored good spot, and nothing checked. `pause_room_centre`
# (10.00, 5.20) was worse: 1.074 m and 1.131 m.
#
# So the standing spot is now DERIVED, and `verify_factory_scene_offline.py` measures the
# reach it implies. All the numbers below are measured off files in this repo or the
# checkout; none is a guess.
# ---------------------------------------------------------------------------------------

# The left shoulder-pitch joint origin, in the pelvis frame, with every joint at zero.
# Summed along the kinematic chain in
# `robot-agent/hardware/sim_evaluator/mjcf/g1_dex3/g1_43dof_fixedbase.xml`:
#     pelvis -> waist_yaw_link  (0, 0, 0)
#            -> waist_roll_link (-0.0039635, 0, 0.044)
#            -> torso_link      (0, 0, 0)
#            -> left_shoulder_pitch_link (0.0039563, 0.10022, 0.24778)
# The two x terms cancel to 7e-6 m, so the shoulder sits directly above the pelvis.
# The right shoulder is the mirror image (right_shoulder_pitch_link y = -0.10021).
SHOULDER_ABOVE_PELVIS = 0.29178
SHOULDER_LATERAL = 0.10022

# The arm, straightened, measured from the same file as the sum of the link offsets
# shoulder_pitch -> shoulder_roll -> shoulder_yaw -> elbow -> wrist_roll -> wrist_pitch
# -> wrist_yaw -> hand_middle_0 (the knuckle) -> hand_middle_1 -> fingertip:
#
#     shoulder -> wrist_yaw   0.410 m
#     shoulder -> knuckle     0.533 m   <- a grasped object sits about here
#     shoulder -> fingertip   0.627 m   <- nothing can be touched beyond this, ever
#
# The knuckle figure is the useful one: an object is held between the fingers, not
# balanced on their tips.
ARM_REACH_TO_KNUCKLE = 0.533
ARM_REACH_TO_FINGERTIP = 0.627

GRASP_REACH_BUDGET = 0.55
"""The largest shoulder->object distance this scene is allowed to design to, metres.

There is no datasheet number for "can a G1 pick this up", so this is calibrated against
the only two configurations in which a G1 + Dex3 demonstrably does pick an object off a
table, with the shoulder located by the constants above:

  * the checkout's own `pick_place_cylinder_g1_29dof_dex3`: pelvis (-0.15, 0, 0.76) at
    +90 deg yaw, cylinder at (-0.35, 0.40, 0.84) -- 0.447 m horizontally from the pelvis,
    0.463 m from the left shoulder.
    (`tasks/common_scene/base_scene_pickplace_cylindercfg.py:95`,
     `tasks/common_config/robot_configs.py:274`)
  * the MuJoCo twin this scene's table/plate/apple were copied from,
    `sim_evaluator/mjcf/g1_apple_pnp_scene.xml`: same pelvis, apple at
    (-0.22, 0.46, 0.789) -- 0.465 m horizontally, 0.531 m from the left shoulder.

0.55 sits just above the larger of those two and 0.077 m inside the 0.627 m geometric
ceiling. The slack over 0.533 is spent deliberately: a free-standing G1 can pitch its
waist and bend its knees toward the table, which both fixed-base references cannot, and
the apple's reset jitter moves the target after the standing spot is fixed.
"""

BASE_HEIGHT_BAND = (0.725, 0.79)
"""Observed pelvis heights, metres. Not nominal -- MEASURED on the live sim (2026-08-29).

0.790 is where the policy holds the base while standing (`step=50 base_z=+0.78979`).
0.725 is where it settles after a walk command stops, in a one-legged crouch. The crouch
LOWERS the shoulder, which shortens the horizontal reach for a target below shoulder
height -- so the reach check runs over the whole band, not at one convenient height.
"""

TABLE_APPROACH_YAW_DEG = 90.0
"""Heading the robot faces at `table_front`. Yaw 0 is world +x, so 90 deg is world +y --
straight at the table, which is on the far side of the room from the door."""

FOOT_FRONT_REACH = 0.13
"""How far ahead of the pelvis the robot's own feet reach, standing, metres.

Derived from `g1_43dof_fixedbase.xml`, and re-derived on every run by section 16 of
`verify_factory_scene_offline.py`, which walks the leg chain with real rigid transforms:
the ankle-roll link sits 0.00002 m ahead of the pelvis in the zero pose -- essentially
directly beneath it -- and the foot's forward contact spheres are at ankle + 0.12 with
r = 0.005, so the toes reach 0.125 m ahead of the pelvis.

THIS CORRECTS AN EARLIER DERIVATION THAT WAS WRONG. It read "the ankle-roll link sits
0.0533 m BEHIND the pelvis (hip_yaw +0.025001 x, knee -0.078273 x)", which adds two x
components expressed in DIFFERENT frames: `left_hip_roll_link` carries a -10.02 deg quat
about y and `left_knee_link` carries its exact inverse, so the two rotations cancel and
the offsets do not sum. The old figure of 0.0717 m was 53 mm short.

0.13 survives the correction, but the margin does not: it is 5 mm over the true 0.125 m,
not the 58 mm the old comment implied. It still covers the four contact spheres being the
contact model rather than the foot mesh, and it is still the number `TABLE_STANDOFF` has
to beat -- with 0.03 m to spare rather than 0.088 m.
"""

TABLE_STANDOFF = 0.16
"""Pelvis-to-table-near-face distance at `table_front`, metres.

The binding constraint is the FEET, not the belly: the pelvis rides at 0.725-0.79 m, and
the table top is at 0.75, so the pelvis may overhang the table edge, but the feet may not
foul the table's box (this table is a solid box down to the floor, like the MJCF twin's).

Foot reach ahead of the pelvis, walked out of `g1_43dof_fixedbase.xml` with real rigid
transforms (see FOOT_FRONT_REACH, and section 16 of the offline verifier, which redoes
the walk on every run): the ankle-roll link sits within 21 micrometres of directly BELOW
the pelvis in the zero pose -- the hip-roll and knee quats are exact inverses and cancel
-- and the forward contact spheres are 0.12 m ahead of the ankle with r = 0.005, so
0.125 m ahead of the pelvis. 0.16 leaves 0.035 m for the real foot mesh (longer than
those four spheres), for a stance that pitches forward to reach, and for the fact that a
robot that walked here stopped wherever it stopped. An earlier version of this comment
put the foot at 0.072 m and claimed 0.088 m of margin; that derivation summed x offsets
across two rotated frames and was wrong by 53 mm.

For reference the MJCF twin stands at 0.20 m. This is 0.04 m tighter, bought back in
reach: 0.20 m would put the worst jitter corner at 0.571 m, over the budget above.
"""

GRASP_LATERAL_OFFSET = 0.07
"""How far to the robot's LEFT the apple sits when it is standing at `table_front`.

From the MJCF twin, whose pelvis is at (-0.15, 0) facing +y with the apple at (-0.22,
0.46): 0.07 m of world -x, which is the robot's left. That is not incidental -- the
scene's docstring records that every episode in the source dataset is a LEFT-hand grasp,
and the plate then sits to the apple's right for the place. Keeping the sign keeps this
scene's composition the same as the frames the policy was trained on.
"""


def shoulder_pos(pelvis: tuple[float, float, float], yaw_deg: float,
                 side: str = "left") -> tuple[float, float, float]:
    """World position of one shoulder-pitch joint, given the pelvis pose."""
    a = math.radians(yaw_deg)
    lat = SHOULDER_LATERAL if side == "left" else -SHOULDER_LATERAL
    # body-left unit vector in world = +z x forward = (-sin yaw, cos yaw)
    return (pelvis[0] - math.sin(a) * lat,
            pelvis[1] + math.cos(a) * lat,
            pelvis[2] + SHOULDER_ABOVE_PELVIS)


def grasp_reach(stand_xy: tuple[float, float], base_z: float, yaw_deg: float,
                target: tuple[float, float, float], side: str = "left") -> float:
    """Distance from a shoulder to `target`, for a robot standing at `stand_xy`."""
    s = shoulder_pos((stand_xy[0], stand_xy[1], base_z), yaw_deg, side)
    return math.dist(s, target)


def standing_spot_for_grasp() -> tuple[float, float]:
    """`table_front`, derived rather than typed.

    Two constraints, one each way:
      * as close to the table as the robot's feet allow  -> y = table near face - standoff
      * lined up so the apple falls on the robot's left  -> x = apple x + lateral offset
    The robot faces +y, so "left" is world -x and the pelvis therefore goes to +x of the
    apple. Whether the result is actually reachable is not asserted here -- it is measured
    by `verify_factory_scene_offline.py`, which is the whole point.
    """
    table_near_y = TABLE["pos"][1] - TABLE["size"][1] / 2
    return (APPLE["pos"][0] + GRASP_LATERAL_OFFSET, table_near_y - TABLE_STANDOFF)


# ---------------------------------------------------------------------------------------
# Named places, for the place graph the orchestrator will write later.
#
# `table_front` is DERIVED (see above). `pause_room_centre` is a waypoint on the way in
# and is NOT a manipulation pose -- from there the apple is 1.07 m away, which is why the
# verifier only checks a reach budget at `table_front`.
# ---------------------------------------------------------------------------------------
PLACES: dict[str, tuple[float, float]] = {
    "robot_start": (4.00, -2.00),
    "factory_centre": (0.00, 0.00),
    "west_aisle": (-8.00, 0.00),
    "pause_room_door": (10.00, 3.90),
    "pause_room_centre": (10.00, 5.20),
    "table_front": standing_spot_for_grasp(),
}

PLACE_HEADINGS: dict[str, float] = {
    "pause_room_door": TABLE_APPROACH_YAW_DEG,   # walk through it facing the table
    "table_front": TABLE_APPROACH_YAW_DEG,       # face the table to reach the apple
}
"""Heading, in degrees (0 = world +x), that a place expects to be arrived at with.

Only the two places where the heading is load-bearing are listed: standing at
`table_front` facing anywhere but the table makes the reach numbers meaningless.
"""

# ---------------------------------------------------------------------------------------
# WHICH of those places the robot is actually spawned at.
#
# `ROBOT` above is the authored start: on the factory floor, 8.4 m and one powered door
# from the table. Getting from there to the table is a separate unsolved problem -- the
# robot jams on the door frame (TASK-228) -- and a manipulation test does not need the
# walk, it needs the robot at the table. So the spawn is SELECTABLE at launch time.
#
# It is an environment variable rather than a cfg argument because the thing that has to
# set it is the `sim_main.py` command line, which this scene does not own and cannot add
# flags to. `ROBOT` itself stays exactly as authored: editing it to move the spawn is how
# a temporary test pose becomes the permanent one nobody remembers changing.
#
# THE RESOLVER REFUSES RATHER THAN FALLS BACK. That is the whole of the design and it is
# not defensive programming for its own sake: a value that is nearly right, accepted
# quietly, is the exact failure this scene has already had once. `table_front` was
# hand-typed at (10.00, 5.35) -- plausible, unchecked, and 0.99 m from an apple the arm
# reaches 0.55 m to (see the REACH section above). A typo'd NEODEM_ROBOT_SPAWN that fell
# back to the authored pose would present the same way: a run that looks correct until a
# manipulation the robot was never within 8 m of fails for no visible reason.
# ---------------------------------------------------------------------------------------
ROBOT_SPAWN_ENV_VAR = "NEODEM_ROBOT_SPAWN"


def selectable_spawns() -> tuple[str, ...]:
    """The names `NEODEM_ROBOT_SPAWN` accepts, sorted.

    A place is selectable only if it declares a HEADING as well as coordinates, because
    coordinates alone are not a pose. Standing at `table_front` facing the door puts the
    apple behind the robot, and every reach number in this module is computed at
    `TABLE_APPROACH_YAW_DEG`; a spawn that ignores the heading would make all of them
    describe a configuration the scene never actually starts in.
    """
    return tuple(sorted(name for name in PLACES if name in PLACE_HEADINGS))


def robot_spawn(value: str | None = None) -> dict:
    """The pose to spawn the robot at: the authored `ROBOT` by default, a named place on ask.

    Returns `{"pos": (x, y, z), "yaw_deg": float, "name": str | None}`. `name` is None when
    nothing was selected and the authored pose is being used, and the place name otherwise,
    so a caller can log which spawn it actually got rather than which one it assumed.

    `value` is read from `NEODEM_ROBOT_SPAWN` when it is not passed. The parameter exists
    so the offline verifier can exercise every branch -- including the unset one -- without
    mutating `os.environ` out from under the process it is running in.

    The height is ALWAYS `ROBOT["pos"][2]`. A named place is two coordinates and has no
    business inventing a third: 0.80 m is the spawn height the working move_cylinder scene
    uses above a floor whose top is z = 0, section 8 of the offline verifier asserts it,
    and dropping it to 0.75 destabilises the base controller at t=0 rather than saving
    50 mm of settle.

    Raises ValueError, never falls back -- see the comment above.
    """
    raw = os.environ.get(ROBOT_SPAWN_ENV_VAR, "") if value is None else value
    name = raw.strip()
    if not name:
        return {"pos": ROBOT["pos"], "yaw_deg": ROBOT["yaw_deg"], "name": None}

    options = ", ".join(selectable_spawns())
    if name not in PLACES:
        raise ValueError(
            f"{ROBOT_SPAWN_ENV_VAR}={raw!r} is not a place in this scene. "
            f"Selectable spawns: {options}. Unset {ROBOT_SPAWN_ENV_VAR} for the authored "
            f"start pose at ({ROBOT['pos'][0]:.2f}, {ROBOT['pos'][1]:.2f}), yaw "
            f"{ROBOT['yaw_deg']:.0f} deg. This refuses instead of falling back on purpose: "
            "a spawn that quietly reverts to the default puts the robot 8 m and one door "
            "away from wherever you meant, and nothing downstream says so.")
    if name not in PLACE_HEADINGS:
        raise ValueError(
            f"{ROBOT_SPAWN_ENV_VAR}={raw!r} names a place that has coordinates but no "
            f"entry in PLACE_HEADINGS, so it is a point and not a pose. Spawning there "
            "would need a heading chosen by this resolver, and a heading nobody authored "
            "is a heading nobody checked -- arriving at a table facing away from it is "
            f"not a usable pose. Selectable spawns: {options}.")

    x, y = PLACES[name]
    return {"pos": (x, y, ROBOT["pos"][2]), "yaw_deg": PLACE_HEADINGS[name], "name": name}


# ---------------------------------------------------------------------------------------
# Cameras. Both live outside /World/envs (same rule as the floor).
#
# `world_camera` is the establishing shot: high above the south wall, looking north-east
# across the hall. It is at z = 10, and the sight-line crosses the 4 m south wall at
# z = 6.65, so the wall does not occlude it. The hall has no roof, by design.
#
# `pause_room_camera` is INSIDE the pause room, in its south-west corner above head height.
# An outside camera cannot see the table: the 3 m partitions occlude anything at a shallow
# enough angle to also show the factory, so trying to serve both shots from one camera
# gives neither.
# ---------------------------------------------------------------------------------------
WORLD_CAMERA = {"eye": (-2.00, -13.50, 10.00), "target": (5.00, 1.00, 1.00)}
PAUSE_ROOM_CAMERA = {"eye": (8.60, 4.60, 2.40), "target": (10.20, 6.70, 0.85)}


def all_static_boxes() -> dict[str, dict]:
    """Every axis-aligned static box in the scene, keyed by cfg attribute name."""
    out: dict[str, dict] = {}
    out.update(WALLS)
    out.update(COLUMNS)
    out.update(CRATES)
    out["pause_table"] = {"pos": TABLE["pos"], "size": TABLE["size"]}
    return out


def box_extent(box: dict) -> tuple[tuple[float, float], tuple[float, float], tuple[float, float]]:
    """(x_min, x_max), (y_min, y_max), (z_min, z_max) of a {"pos", "size"} box."""
    (px, py, pz), (sx, sy, sz) = box["pos"], box["size"]
    return ((px - sx / 2, px + sx / 2), (py - sy / 2, py + sy / 2), (pz - sz / 2, pz + sz / 2))
