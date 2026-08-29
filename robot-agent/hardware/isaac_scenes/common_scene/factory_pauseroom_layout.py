# NeoDEM. Apache License, Version 2.0 (same terms as the surrounding Unitree checkout).
"""Every number in the `Isaac-Factory-PauseRoom-G129-Dex3-Wholebody` scene, and nothing else.

WHY THIS FILE EXISTS SEPARATELY FROM THE SCENE CFG
--------------------------------------------------
`base_scene_factory_pauseroom.py` cannot be imported without Isaac Lab, and Isaac Lab
cannot be imported without a GPU and a Kit app. That would leave the geometry -- the part
that is actually easy to get wrong, and expensive to discover wrong 2 minutes into a
launch -- unverifiable except by launching the simulator.

So the geometry lives HERE, in a module that imports nothing but `math`. The scene cfg
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
# ---------------------------------------------------------------------------------------
CRATE_SIZE = (1.00, 1.00, 0.90)
CRATES: dict[str, dict] = {
    f"crate_{i:02d}": {"pos": (x, y, 0.45), "size": CRATE_SIZE}
    for i, (x, y) in enumerate(
        [(-10.5, -6.0), (-10.5, -4.6), (-10.5, 1.0), (-10.5, 2.4), (-2.0, 0.0), (-2.0, 1.2)]
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
# Named places, for the place graph the orchestrator will write later.
# ---------------------------------------------------------------------------------------
PLACES: dict[str, tuple[float, float]] = {
    "robot_start": (4.00, -2.00),
    "factory_centre": (0.00, 0.00),
    "west_aisle": (-8.00, 0.00),
    "pause_room_door": (10.00, 3.90),
    "pause_room_centre": (10.00, 5.20),
    "table_front": (10.00, 5.35),
}

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
