#!/usr/bin/env python3
"""Odometry maths for the Isaac bridge: measured yaw; x/y and velocity from the
sim's true root state while `rt/sim_state` is fresh, dead reckoned as the fallback.

@file isaac_odom.py
@description Pure-Python helpers shared by `isaac_loco_bridge.py` and its offline
    verifier. No DDS, no Isaac, no numpy -- just `math` -- so the whole odometry
    path can be exercised on a laptop in milliseconds.
@feature hardware

WHAT IS MEASURED AND WHAT IS NOT -- read this before trusting a pose
--------------------------------------------------------------------
`yaw` is MEASURED. It comes from `rt/lowstate`'s `imu_state.quaternion`, which the
Isaac sim publishes from the articulation's real base orientation. It is as good as
the sim's own state.

`x`, `y` AND THE VELOCITY have TWO possible sources, and which one produced a given
frame is not a detail -- they differ by two orders of magnitude when the robot is not
tracking its command (TASK-231):

  * GROUND TRUTH (`parse_sim_state`, preferred). The sim publishes its whole scene
    state as JSON on `rt/sim_state` at ~70 Hz, and it carries the articulation's TRUE
    world root pose AND its true world root velocity. Nothing here estimates
    anything: the numbers on the wire are the numbers Isaac is simulating. Only a
    simulator can do this; on a real G1 the sidecar reads real odometry and none of
    this file runs.
  * DEAD RECKONING (`DeadReckoner`, the fallback). Integrates the velocity the bridge
    itself COMMANDED, so it accumulates every difference between what was asked for
    and what the locomotion policy delivered -- slip, unmodelled turn-rate asymmetry,
    a policy that saturates -- and it NEVER self-corrects. On this path the published
    velocity IS the command, rotated into the world frame.

How badly the second one lies is measured, not theoretical. On 2026-08-30 the factory
rig was commanded 8.00 m forward: dead reckoning reported 7.995 m travelled while the
sim's true root pose moved 0.113 m. Wrong by a factor of 71, and nothing downstream
could tell, because dead reckoning reports ~100% of the command BY CONSTRUCTION -- it
is the command, played back. Every "N% of commanded" figure derived from it is
circular. Treat it as "roughly how far we have asked the robot to travel", never as
an absolute position.

Rotating the commanded body-frame velocity by the MEASURED yaw (rather than by an
integrated yaw command) is the one thing that makes dead reckoning better than pure
open loop: heading error does not compound into position error.

VELOCITY IS PART OF THAT, NOT AN EXCEPTION TO IT. The first half of the TASK-231 fix
took x/y off `rt/sim_state` and left `OdomFrame.vx_world`/`vy_world` as the commanded
velocity rotated by the measured yaw -- so a frame stamped "ground truth" still handed
its reader the command back, one field over, at the 71x error below. Ground truth
carries `root_velocity` in the same articulation payload as `root_pose`, so on a
ground-truth frame the velocity and the yaw rate come from there too, and the wire
marker means what it says for the WHOLE message.

`yaw` is the one field that never changes source: it is measured off `rt/lowstate` on
both paths (see `OdomIntegrator.tick`). `yaw_speed` is measured on both paths as well,
but differently -- the sim's own body yaw rate on a ground-truth frame, the difference
of two measured headings on a dead-reckoned one -- and it is never the commanded turn
rate on either.

Because the two sources differ that much, a SILENT switch between them is the worst
outcome available here -- worse than either alone. So the source is carried on every
`OdomFrame` (`.source`), stamped into `SportModeState_.error_code` on the wire
(`odom_error_code`), and announced by the bridge whenever it changes.

WHICH FRAME IS A GIVEN NUMBER IN
--------------------------------
Dead reckoning starts at zero, so without help the published x/y are in an ODOM frame
whose origin is "wherever the robot happened to be standing when the bridge started".
Agent Mode's place graph (`sim_evaluator/places/*.json`) is in WORLD metres. Those two
frames were silently assumed to be the same one, and on the factory rig they are 4.5 m
apart: the robot spawns at world (4.00, -2.00), the bridge published (0.00, 0.00), and
`RobotStateManager` resolved the robot into FACTORY-CENTRE -- a place it was nowhere
near. A `goto` from there applies a world displacement to an odom-origin pose and
walks into a wall.

`OdomIntegrator(origin=(x, y))` closes that gap. The rule, and it is one rule:

    * anything read off a `DeadReckoner` (`reckoner.x`, `reckoner.y`, `.distance`)
      is in the ODOM frame -- displacement since the bridge started;
    * anything on an `OdomFrame`, i.e. everything that reaches the wire, is in the
      WORLD frame.

X AND Y ONLY. `yaw` is already world-absolute -- it is measured from the sim's own base
orientation, not integrated -- so it is NOT offset by the origin and must never be.
Adding an "obvious" yaw term for symmetry would rotate every heading the agent reads,
which is a far worse bug than the one this fixes and a far quieter one: positions would
still look plausible while every goto veered off by a constant angle.

DEAD RECKONING ONLY, TOO. The origin exists because dead reckoning starts at zero.
GROUND TRUTH IS ALREADY IN WORLD COORDINATES -- `rt/sim_state` reports the scene's own
world root pose (`num_envs=1`, so the env origin is zero) -- so the origin must NOT be
added to it. Adding both is the single most likely way to get TASK-231 wrong, and it is
quiet: the robot would be published a spawn-offset away from where it is, exactly the
defect the origin was introduced to fix, in the opposite direction. The origin survives
as the fallback anchor and nothing more; see `OdomIntegrator._world_anchor`.

Quaternion order
----------------
A real G1 reports `(w, x, y, z)`. This sim does not: with NeoDEM patch `0002`
applied, `imu_state.quaternion` arrives as `(x, y, z, w)` -- Isaac Lab 3.0 is XYZW
throughout (identity is `(0,0,0,1)`), and the vendor's 2.x-era plumbing does not
convert it. `isaac_yaw_sweep.py` verified `xyzw` against a real turn, so that is the
default here too. Reading it as `wxyz` does not merely offset the answer: it makes
the reported heading swing with ROLL while the true yaw sits still (see
`verify_isaac_odom_offline.py`, check 2), which looks exactly like a drifting robot.

`rt/sim_state`'s `root_pose` is XYZW as well, and that is measured rather than assumed:
the scene's unrotated door publishes `[..., 0, 0, 0, 1]` (identity is `(0,0,0,1)` in
XYZW and `(1,0,0,0)` in WXYZ), and read as XYZW the robot's ground-truth heading agreed
with the `rt/lowstate` one to 0.4 deg on the live rig, where WXYZ disagreed by 4 deg and
both readings were wrong. `SIM_STATE_QUAT_ORDER` is the one place that choice is made.
"""
from __future__ import annotations

import json
import math
from typing import NamedTuple

# (index of w, x, y, z) within the 4-float buffer on the wire.
QUAT_ORDERS = {"wxyz": (0, 1, 2, 3), "xyzw": (3, 0, 1, 2), "scrambled": (2, 3, 0, 1)}

# Verified against a commanded turn by isaac_yaw_sweep.py -- see the module docstring.
DEFAULT_QUAT_ORDER = "xyzw"

# The field names `g1_sidecar.py` reads off a SportModeState_ from rt/odommodestate.
# Confirmed at `_odom_from_dds()` -> `_pose_from(msg.position, msg.imu_state.rpy)`;
# `_get_state_readonly` additionally surfaces `velocity` and `yaw_speed`. A message
# missing `position` or `imu_state.rpy` is refused by the sidecar (it 503s rather
# than fabricating a pose), so these two are mandatory, not decorative.
SIDECAR_ODOM_FIELDS = ("position", "imu_state.rpy")

# Stamped into SportModeState_.error_code as a PROVENANCE MARKER, not a fault.
# SportModeState_ has no string field, so this is the only place a "this pose is
# part guesswork" flag fits. Nothing in NeoDEM reads error_code today; a future
# consumer that treats a non-zero code as "do not trust this" would be reaching the
# right conclusion about x/y, which is why this was chosen over overloading
# `gait_type` or `mode` with a meaning they do not have.
ODOM_ERROR_CODE_DEAD_RECKONED = 0xDEAD

# ...and its counterpart, for a message whose x/y AND velocity came verbatim off
# `rt/sim_state`.
# DELIBERATELY NOT 0. A pose carrying 0 would be indistinguishable from a real G1's
# healthy SportModeState_ and from a message published by anything else on the bus;
# 0x600D says "this specific bridge, and the good source". The two codes differ in
# every hex digit, so a capture that shows both is unambiguous even when read as a
# decimal (57005 vs 24589).
ODOM_ERROR_CODE_GROUND_TRUTH = 0x600D

# The two values `OdomFrame.source` may take. Strings, not a bool, because they end
# up in log lines an operator reads at 3 a.m.; `not is_dead_reckoned` is the kind of
# thing that gets inverted in a refactor without anybody noticing.
ODOM_SOURCE_GROUND_TRUTH = "ground-truth"
ODOM_SOURCE_DEAD_RECKONED = "dead-reckoned"
ODOM_SOURCE_ERROR_CODES = {
    ODOM_SOURCE_GROUND_TRUTH: ODOM_ERROR_CODE_GROUND_TRUTH,
    ODOM_SOURCE_DEAD_RECKONED: ODOM_ERROR_CODE_DEAD_RECKONED,
}

# Where the sim's own scene state arrives (`sim_main.py`'s main loop -> `SimStateDDS`
# -> `rt/sim_state`), and the layout of the quaternion in it. Measured on the live rig
# at ~70 Hz, ~2.9 KB per message, ~17 us to parse -- cheap enough to parse every
# message on the DDS listener thread rather than sampling it.
SIM_STATE_TOPIC = "rt/sim_state"
SIM_STATE_QUAT_ORDER = "xyzw"
# The articulation whose root pose is the robot's. `sim_main.py` serialises
# `env.scene.get_state()`, whose "articulation" map also holds scene furniture
# (`pause_room_door` on the factory rig), so the key matters.
SIM_STATE_BODY = "robot"


def odom_error_code(source: str) -> int:
    """The `SportModeState_.error_code` provenance marker for a frame's source.

    Refuses an unknown source rather than defaulting to either code: a pose that
    claimed ground truth while being dead reckoned is precisely the failure TASK-231
    exists to make impossible, and defaulting the other way would fire the "do not
    trust x/y" marker on poses that are exact.
    """
    try:
        return ODOM_SOURCE_ERROR_CODES[source]
    except KeyError:
        raise ValueError(
            f"unknown odometry source {source!r} -- expected one of "
            f"{sorted(ODOM_SOURCE_ERROR_CODES)}") from None


def parse_odom_origin(text):
    """Parse an `X,Y` odometry origin in WORLD metres into a `(x, y)` float pair.

    Lives here rather than in `isaac_loco_bridge.py` for the same reason the rest of
    this module does: the bridge imports `unitree_sdk2py` at module scope and cannot be
    imported by the offline verifier, and a value this load-bearing must be testable
    without DDS.

    REFUSES a malformed value, naming it, rather than falling back to (0, 0). A silent
    fallback is exactly the defect this whole feature exists to fix -- an origin of zero
    is not a neutral default, it is a claim that the robot started at the world origin,
    and the only thing worse than an unset origin is a mistyped one that reads as unset.
    """
    raw = str(text).strip()
    parts = [p.strip() for p in raw.split(",")]
    if len(parts) != 2:
        raise ValueError(
            f"odom origin {text!r} is not X,Y -- expected two comma-separated numbers "
            f"in WORLD metres (e.g. '4.0,-2.0'), got {len(parts)} field(s).")
    out = []
    for label, part in zip(("X", "Y"), parts):
        try:
            v = float(part)
        except (TypeError, ValueError):
            raise ValueError(
                f"odom origin {text!r} has a non-numeric {label} component "
                f"({part!r}).") from None
        if not math.isfinite(v):
            # inf/nan parse fine as floats and would poison every published pose from
            # the first tick onwards, with nothing downstream saying where it came from.
            raise ValueError(
                f"odom origin {text!r} has a non-finite {label} component ({part!r}).")
        out.append(v)
    return (out[0], out[1])


def yaw_from_quaternion(quat, order: str = DEFAULT_QUAT_ORDER) -> float:
    """Yaw in radians, wrapped to (-pi, pi], from a 4-float quaternion buffer.

    `order` names the layout of the buffer (see QUAT_ORDERS), or may be a
    (iw, ix, iy, iz) index tuple. The formula is the standard ZYX yaw and matches
    `isaac_yaw_sweep.py::on_state` exactly -- deliberately, so a heading measured by
    the sweep tool and a heading published by the bridge cannot disagree.

    Wrapped, not continuous: a real G1's `imu_state.rpy[2]` comes out of a quaternion
    and is therefore wrapped, `sim_g1_dds` wraps its own (`measured_pose`), and
    consumers difference it. Use `YawTracker` when a continuous angle is wanted.
    """
    perm = QUAT_ORDERS[order] if isinstance(order, str) else tuple(order)
    if len(perm) != 4:
        raise ValueError(f"quaternion order must have 4 indices, got {perm!r}")
    f = [float(v) for v in quat]
    if len(f) != 4:
        raise ValueError(f"quaternion must have 4 components, got {len(f)}")
    iw, ix, iy, iz = perm
    w, x, y, z = f[iw], f[ix], f[iy], f[iz]
    return math.atan2(2.0 * (w * z + x * y), 1.0 - 2.0 * (y * y + z * z))


class GroundTruthPose(NamedTuple):
    """The sim's TRUE world root pose AND velocity for one body, as parsed.

    Every field is world-frame and MEASURED -- there is no estimation anywhere in the
    path that produced it, and `--odom-origin` must never be added to `x`/`y` (see the
    module docstring). `yaw` is derived from `quat` in `SIM_STATE_QUAT_ORDER` and is
    wrapped to (-pi, pi], like every other yaw in this file.

    The velocity fields are what stops a "ground truth" frame from publishing the
    COMMAND in `SportModeState_.velocity` (TASK-231's second half). They are REQUIRED
    positionally, with no default, for the same reason `OdomFrame.source` has a
    pessimistic one: a caller that has not got a velocity must be made to say so at
    the point of construction rather than quietly ship a zero that reads as measured.

    `vx`/`vy` are the base's linear velocity in the WORLD frame -- already rotated,
    unlike the body-frame command the dead reckoner integrates -- so they drop into
    `OdomFrame.vx_world`/`vy_world` unchanged. `yaw_rate` is the world-frame angular
    velocity about z; for a base that is upright to within a few degrees, as a walking
    G1 is, that is its yaw rate to well under a percent. `twist` is the whole
    `[vx, vy, vz, wx, wy, wz]` row verbatim, the way `quat` keeps the whole
    quaternion: this file publishes a planar base, and a debugger should still be able
    to see what the sim actually said.
    """
    x: float
    y: float
    z: float
    yaw: float
    quat: tuple      # verbatim, in the order it arrived (see SIM_STATE_QUAT_ORDER)
    vx: float        # world-frame linear velocity, m/s
    vy: float
    yaw_rate: float  # world-frame angular velocity about z, rad/s
    twist: tuple     # verbatim [vx, vy, vz, wx, wy, wz]


# The per-body arrays `parse_sim_state` reads out of an articulation: how wide each
# row is and what is in it. Both are indexed by environment (num_envs = 1 here), and
# both are read through `_root_row` so that the velocity cannot end up validated more
# loosely than the pose -- an unchecked number that reaches the wire looking measured
# is the whole of TASK-231's second half.
_ROOT_ROWS = {
    "root_pose": (7, "[x, y, z, qx, qy, qz, qw]"),
    "root_velocity": (6, "[vx, vy, vz, wx, wy, wz], WORLD frame"),
}


def _root_row(art: dict, body: str, field: str) -> list:
    """Env 0's row of `art[field]` as finite floats, or a named `ValueError`.

    Same contract as `parse_sim_state` itself: `ValueError` for every malformed shape,
    never a partial or zeroed row. Never a `KeyError`/`TypeError`/`IndexError`.
    """
    width, layout = _ROOT_ROWS[field]
    rows = art.get(field)
    if not isinstance(rows, (list, tuple)) or not rows:
        raise ValueError(
            f"{SIM_STATE_TOPIC} articulation {body!r} has no non-empty {field!r}")
    row = rows[0]                        # num_envs = 1; see parse_sim_state
    if not isinstance(row, (list, tuple)) or len(row) != width:
        raise ValueError(
            f"{SIM_STATE_TOPIC} articulation {body!r} {field}[0] must have {width} "
            f"components {layout}, got "
            f"{len(row) if isinstance(row, (list, tuple)) else type(row).__name__}")
    try:
        vals = [float(v) for v in row]
    except (TypeError, ValueError):
        raise ValueError(
            f"{SIM_STATE_TOPIC} articulation {body!r} {field}[0] is not numeric: "
            f"{row!r}") from None
    if not all(math.isfinite(v) for v in vals):
        # A NaN reaches the wire looking like any other float and poisons every
        # consumer that differences it. Refuse it the way parse_odom_origin refuses a
        # non-finite origin: fall back to dead reckoning rather than publish it.
        raise ValueError(
            f"{SIM_STATE_TOPIC} articulation {body!r} {field}[0] has a non-finite "
            f"component: {vals!r}")
    return vals


def parse_sim_state(payload, body: str = SIM_STATE_BODY,
                    quat_order: str = SIM_STATE_QUAT_ORDER) -> GroundTruthPose:
    """Read one `rt/sim_state` message into the true world pose of `body`.

    Pure: takes the payload (the `String_.data` off the wire, or an already-decoded
    dict) rather than doing DDS itself, so `verify_isaac_odom_offline.py` can drive
    every malformed shape below on a plain `python3` with no sim in sight. The bridge
    does the subscribing; this does the believing.

    THE PAYLOAD IS JSON INSIDE JSON. `sim_main.py` builds
    `{"init_state": sim_state_to_json(env.scene.get_state()), "task_name": ...}` and
    then `json.dumps` the whole thing, so `init_state` arrives as a STRING that has to
    be parsed a second time. Reading it once and indexing straight into it gets a
    string subscript, not a dict, which is the first thing anybody writing this hits.

    Then:

        init_state.articulation[body].root_pose[0]     = [x, y, z, qx, qy, qz, qw]
        init_state.articulation[body].root_velocity[0] = [vx, vy, vz, wx, wy, wz]

    Both are indexed by environment; `num_envs` is 1 on this rig and the env origin is
    therefore zero, so element 0 is already a WORLD pose and needs no `env_origins`
    term. A multi-env run would need one, which is why the indexing is explicit here
    rather than hidden behind a `[0]` in the caller. `root_velocity` is Isaac's
    `root_vel_w`: linear then angular, already in the WORLD frame, so it needs no
    rotation either. It is read here and not only in the bridge because a "ground
    truth" frame that publishes the COMMANDED velocity next to a measured position is
    the defect TASK-231 is named for, moved one field over.

    AN UNUSABLE VELOCITY FAILS THE WHOLE MESSAGE. A payload whose `root_velocity` is
    missing, short, non-numeric or non-finite raises, exactly as a broken `root_pose`
    does, and the caller therefore falls back to dead reckoning for BOTH -- rather
    than publishing the exact position with a zeroed or commanded velocity beside it.
    The alternatives were considered and are worse: `SportModeState_` carries ONE
    provenance marker (`error_code`) for the whole message, so a frame that mixed an
    exact position with a fabricated velocity could not be labelled honestly, and a
    zero that "looks measured" is precisely what this task exists to remove. The
    degradation is loud (the bridge counts and names it, and stamps 0xDEAD), which a
    quiet mixture would not be. The shapes are not independent in practice anyway:
    both come from the same `env.scene.get_state()` row, so a missing velocity means
    the sim's publisher changed and the pose beside it deserves the same suspicion.

    There is a `_timestamp` at the top level, and it is NOT usable for freshness: it
    is whole seconds (observed `1788089208` against a wall clock of `...208.86`). Age
    is measured by the receiver's own monotonic clock, in the bridge.

    RAISES `ValueError`, naming what was wrong, for every malformed payload -- never
    `KeyError`, `TypeError`, `IndexError` or `json.JSONDecodeError`. One exception type
    means the bridge's listener has one thing to catch, and a caller cannot mistake a
    structural change in the sim's payload for a bug in its own code. It never returns
    a partial or zeroed pose: a fabricated (0, 0) here would publish the robot at the
    world origin as confidently as a real reading, and the whole point of TASK-231 is
    that a wrong position is worse than a missing one. A missing one falls back to dead
    reckoning, loudly; a wrong one does not.
    """
    if isinstance(payload, (bytes, bytearray)):
        try:
            payload = payload.decode("utf-8")
        except UnicodeDecodeError as exc:
            raise ValueError(f"{SIM_STATE_TOPIC} payload is not UTF-8 ({exc})") from None
    if isinstance(payload, str):
        try:
            doc = json.loads(payload)
        except ValueError as exc:
            raise ValueError(
                f"{SIM_STATE_TOPIC} payload is not JSON ({exc}); "
                f"first 60 chars: {payload[:60]!r}") from None
    elif isinstance(payload, dict):
        doc = payload
    else:
        raise ValueError(
            f"{SIM_STATE_TOPIC} payload must be str, bytes or dict, got "
            f"{type(payload).__name__}")
    if not isinstance(doc, dict):
        raise ValueError(
            f"{SIM_STATE_TOPIC} payload decoded to {type(doc).__name__}, not an object")

    state = doc.get("init_state")
    if state is None:
        raise ValueError(
            f"{SIM_STATE_TOPIC} payload has no 'init_state' (keys: "
            f"{sorted(doc)[:8]}) -- has sim_main.py's publisher changed?")
    if isinstance(state, (bytes, bytearray, str)):
        try:
            state = json.loads(state)
        except ValueError as exc:
            raise ValueError(
                f"{SIM_STATE_TOPIC} 'init_state' is a string but not JSON ({exc})") from None
    if not isinstance(state, dict):
        raise ValueError(
            f"{SIM_STATE_TOPIC} 'init_state' is {type(state).__name__}, not an object")

    articulations = state.get("articulation")
    if not isinstance(articulations, dict):
        raise ValueError(
            f"{SIM_STATE_TOPIC} 'init_state' has no 'articulation' object "
            f"(keys: {sorted(state)[:8]})")
    art = articulations.get(body)
    if not isinstance(art, dict):
        # Naming the articulations that ARE there turns "the robot moved to a new key"
        # from a mystery into a one-line fix; on the factory rig the map also holds
        # `pause_room_door`, so an empty map and a renamed robot look different.
        raise ValueError(
            f"{SIM_STATE_TOPIC} has no articulation {body!r} "
            f"(present: {sorted(articulations)})")
    pose = _root_row(art, body, "root_pose")
    # The velocity is validated with EXACTLY the strictness the pose is, and an
    # unusable one fails the whole message rather than only itself -- see the
    # "AN UNUSABLE VELOCITY" paragraph in this function's docstring.
    twist = _root_row(art, body, "root_velocity")
    quat = tuple(pose[3:7])
    return GroundTruthPose(pose[0], pose[1], pose[2],
                           yaw_from_quaternion(quat, quat_order), quat,
                           twist[0], twist[1], twist[5], tuple(twist))


def unwrap(seq):
    """Undo 2*pi wraps so a turn through +/-pi does not read as a huge jump.

    Copied from `isaac_yaw_sweep.py` so the offline tests here cover the helper that
    tool relies on as well.
    """
    out, off = [], 0.0
    for i, v in enumerate(seq):
        if i:
            d = v + off - out[-1]
            if d > math.pi:
                off -= 2 * math.pi
            elif d < -math.pi:
                off += 2 * math.pi
        out.append(v + off)
    return out


class YawTracker:
    """Streaming version of `unwrap()`: wrapped yaw in, continuous yaw out.

    Needed for two things that a wrapped angle gets catastrophically wrong:
      * `yaw_speed` -- differencing a wrapped yaw across the +/-pi seam reports a
        ~6.28 rad step, i.e. hundreds of rad/s of phantom rotation;
      * the mid-point heading the dead reckoner rotates its velocity by, where the
        same seam would fling the integrated position sideways for one tick.
    """

    def __init__(self) -> None:
        self.continuous: float | None = None
        self.wrapped: float | None = None

    def update(self, wrapped_yaw: float) -> float:
        """Feed one wrapped sample; return the continuous (unwrapped) yaw."""
        v = float(wrapped_yaw)
        if self.continuous is None:
            self.continuous = v
        else:
            d = v - self.continuous
            # Same rule as unwrap(): fold the step into (-pi, pi], then add it.
            d -= 2 * math.pi * math.floor((d + math.pi) / (2 * math.pi))
            self.continuous += d
        self.wrapped = v
        return self.continuous


class DeadReckoner:
    """Integrate COMMANDED body-frame velocity into a world x/y. Drifts. Say so.

    This is the half of the pose that is not measured (module docstring). It is kept
    in its own class so that nothing can accidentally present it as a measurement:
    every caller has to name it.

    The mid-point-heading formula matches `sim_g1_dds/loco_state.py` and
    `isaac_capture.py::KinematicBase`, so a trajectory integrated here and one
    integrated in the MuJoCo sim agree for the same command stream -- except that
    the heading used here is the MEASURED yaw, not an integrated one.
    """

    def __init__(self, x0: float = 0.0, y0: float = 0.0) -> None:
        self.x = float(x0)
        self.y = float(y0)
        self.distance = 0.0     # path length, for logging "how far we think we went"

    def step(self, vx: float, vy: float, dt: float, yaw: float,
             yaw_prev: float | None = None) -> None:
        """Advance by `dt` at body-frame (`vx`, `vy`) held over the interval.

        `yaw` is the CONTINUOUS measured heading at the end of the interval and
        `yaw_prev` the one at its start; the velocity is rotated by their mid-point,
        which is second-order accurate for a constant turn rate. Pass continuous
        (unwrapped) angles -- averaging two wrapped ones across the seam gives a
        heading pointing the opposite way.
        """
        dt = float(dt)
        if dt <= 0.0:
            return
        yaw_mid = float(yaw) if yaw_prev is None else 0.5 * (float(yaw) + float(yaw_prev))
        c, s = math.cos(yaw_mid), math.sin(yaw_mid)
        dx = (vx * c - vy * s) * dt
        dy = (vx * s + vy * c) * dt
        self.x += dx
        self.y += dy
        self.distance += math.hypot(dx, dy)


class OdomFrame(NamedTuple):
    """One pose AND velocity ready to go on the wire, in the WORLD frame.

    `x`/`y` and `vx_world`/`vy_world`/`yaw_speed` are either the sim's ground truth
    verbatim or dead reckoning (position shifted into the world frame, velocity the
    command rotated into it) -- `source` says which, for all of them together, and it
    is not optional garnish: the two disagreed by 71x on the rig that prompted
    TASK-231. `yaw` is measured and already world-absolute either way, so it carries
    no offset and no provenance question. If you are holding an OdomFrame you are
    holding world coordinates -- see "WHICH FRAME IS A GIVEN NUMBER IN" in the module
    docstring. (With no origin given and no ground truth, the two frames coincide,
    which is the old behaviour and is what makes that default byte-identical.)
    """
    x: float
    y: float
    yaw: float              # wrapped, as a real G1 reports it
    yaw_continuous: float   # unwrapped, for anything that differences it
    vx_world: float         # ground truth, or the command rotated -- see `source`
    vy_world: float
    yaw_speed: float        # measured on both paths; see `source` for from where
    # ODOM_SOURCE_GROUND_TRUTH or ODOM_SOURCE_DEAD_RECKONED, for THE WHOLE FRAME
    # except `yaw`/`yaw_continuous` (always measured off rt/lowstate) -- x, y and the
    # velocity all come from whichever source this names, which is what lets the
    # single message-level `error_code` on the wire be true. Last, and with a default,
    # so every existing positional construction still reads the same -- and so a frame
    # built without thinking about provenance claims the pessimistic source rather
    # than silently claiming the exact one.
    source: str = ODOM_SOURCE_DEAD_RECKONED


class OdomIntegrator:
    """Yaw samples + commanded velocities in, publishable `OdomFrame`s out.

    Deliberately pure: no DDS, no threads, no clock of its own -- every input is an
    argument to `tick()`. That is what lets `verify_isaac_odom_offline.py` drive the
    starvation, gap-recovery and rate-limiting behaviour on a CPU in milliseconds,
    where in the bridge those paths only occur when the sim falls over.

    The rules it encodes, all of which exist because the failure they prevent is
    worse than no odometry at all:

      * no yaw sample within `stale_after` -> `starved`, and NOTHING is emitted.
        `g1_sidecar.py` then 503s and Agent Mode falls back to open loop. A frozen
        pose instead would read to `block-executor.ts` as "the robot did not move".
      * coming back from a gap does not integrate across it: the anchor is dropped,
        so the first tick after an outage advances the position by nothing rather
        than by (outage duration x last commanded speed).
      * a command slot older than `command_stale_after` integrates as zero -- a dead
        command publisher must not keep the dead reckoner walking.
      * a ground-truth pose newer than `ground_truth_stale_after` REPLACES the
        dead-reckoned x/y AND the commanded velocity outright, and one older than that
        is not used at all. A stale true pose is a frozen one, and a frozen pose reads
        to `block-executor.ts` as "the robot did not move" just as surely as a starved
        feed does -- except that this one would keep publishing.
      * a ground-truth pose whose velocity is not finite is not used AT ALL, position
        included. `parse_sim_state` cannot produce one; a hand-built pose can, and
        publishing its exact x/y beside a fabricated velocity would put two different
        provenances under the one `error_code` the wire has. Counted in
        `ground_truth_unusable` so it is never merely dropped.

    `origin` is the WORLD position of this integrator's odom (0, 0), i.e. where the
    robot is standing when the bridge starts. `None` means "not told", which behaves
    exactly as before: odom frame published as if it were world. It applies to DEAD
    RECKONING ONLY -- ground truth is already world -- and once ground truth has been
    seen it is superseded entirely by `_world_anchor` below.

    `use_ground_truth=False` forces dead reckoning even when a pose is handed in. It
    exists so the fallback can be exercised on a rig where `rt/sim_state` is healthy
    (`--no-ground-truth`); nothing else should turn it off.

    WHY THE OFFSET IS APPLIED HERE, at the frame boundary, and not by seeding the
    DeadReckoner with it. Both would produce the same numbers on the wire. This
    placement buys one property the other does not: every stored quantity stays in
    exactly one frame, so a reader never has to ask which. `self.reckoner` is odom --
    pure displacement since start, which is what makes `reckoner.distance` a path
    length and what keeps the re-anchoring arithmetic after an outage readable as
    "advance by nothing". The returned `OdomFrame` is world. The offset appears in
    exactly one expression in this file, which is also what makes "was it applied
    twice?" a one-line audit rather than a hunt through the integration loop.
    (`DeadReckoner` keeps its own `x0`/`y0`: those seed the odom frame itself, a
    different thing, and nothing in the bridge passes them.)
    """

    def __init__(self, publish_period: float, stale_after: float,
                 command_stale_after: float,
                 origin: tuple[float, float] | None = None,
                 ground_truth_stale_after: float = 0.5,
                 use_ground_truth: bool = True) -> None:
        self.publish_period = float(publish_period)
        self.stale_after = float(stale_after)
        self.command_stale_after = float(command_stale_after)
        self.ground_truth_stale_after = float(ground_truth_stale_after)
        self.use_ground_truth = bool(use_ground_truth)
        # Kept as given -- None means "no origin was supplied", which the bridge's
        # banner reports as such. Do not normalise it to (0, 0) here: "defaulted" and
        # "explicitly told the world origin" print differently on purpose.
        self.origin = None if origin is None else (float(origin[0]), float(origin[1]))
        self._ox, self._oy = (0.0, 0.0) if self.origin is None else self.origin
        self.tracker = YawTracker()
        self.reckoner = DeadReckoner()
        self.starved = True          # nothing seen yet counts as starved, so the
                                     # first sample logs "acquired" rather than silence
        # Which source the last PUBLISHED frame used for x/y, and how many frames each
        # has produced. Read by the bridge to log the switch and the run's totals.
        # Starts pessimistic, whatever `use_ground_truth` says, so the first
        # ground-truth frame is announced as an acquisition rather than assumed.
        self.source = ODOM_SOURCE_DEAD_RECKONED
        self.ground_truth_fresh = False
        self.ground_truth_seen = False
        # Fresh poses refused for an unusable velocity (see tick()). Not expected to
        # move on a healthy rig -- parse_sim_state refuses those payloads first -- but
        # a drop that only shows up as "the source switched" is the kind of silence
        # this file exists to prevent.
        self.ground_truth_unusable = 0
        self.frames_ground_truth = 0
        self.frames_dead_reckoned = 0
        # Odom -> world offset to use WHEN GROUND TRUTH IS NOT AVAILABLE. It starts as
        # the configured origin and is re-derived from every fresh ground-truth pose,
        # which is what makes losing `rt/sim_state` a degradation rather than a
        # teleport: dead reckoning then continues from where the robot TRULY was, not
        # from the spawn plus everything the command claimed since. On the rig that
        # prompted TASK-231 the naive version would have jumped the published pose by
        # 7.9 m at the instant the topic went quiet -- through a wall, as far as Agent
        # Mode's place graph is concerned.
        self._world_anchor: tuple[float, float] | None = None
        self._last_t: float | None = None
        self._prev_cont: float | None = None
        self._last_pub: float | None = None
        # Wrapped |ground-truth yaw - measured yaw| at the last fresh ground-truth
        # tick, in radians. Two independent readings of the SAME orientation, so they
        # must agree; a large value means one of the two quaternion orders is wrong.
        # None until there is something to compare.
        self.yaw_disagreement: float | None = None

    def tick(self, now: float, yaw_sample, command, ground_truth=None) -> OdomFrame | None:
        """Advance to `now`; return a frame when one is due, else None.

        `yaw_sample` is `(wrapped_yaw, monotonic_recv_time)` or None; `command` is
        `(vx, vy, monotonic_time_published)`; `ground_truth` is
        `(GroundTruthPose, monotonic_recv_time)` or None.

        Ground truth is preferred for x/y AND for the velocity, and is used VERBATIM
        -- no origin, no filtering, no blending with the dead reckoner. Blending was
        considered and rejected: the two inputs are not two noisy measurements of the
        same thing, one is exact and the other is the command played back, and any
        weight on the second buys nothing but a number no one can reason about.

        THE VELOCITY GOES WITH THE POSITION, ALWAYS. Publishing the sim's x/y beside
        `vx*cos(yaw) - vy*sin(yaw)` -- the command, rotated -- is what the first half
        of the TASK-231 fix left behind: one message, stamped "ground truth", carrying
        an exact position and the command it was asked for. A consumer differencing
        the position and reading the velocity got two numbers that disagreed by 71x
        with nothing to say why. So on a ground-truth frame both come off
        `rt/sim_state`, and on a dead-reckoned frame both come off the command, and
        `source` (hence `error_code`) is true of the whole message.

        yaw is NOT taken from ground truth even though it is there. `rt/lowstate`'s
        heading is measured just as honestly, arrives on the feed whose staleness
        already gates publishing, and is the one `YawTracker` is differenced from --
        swapping sources mid-stream would inject a step into the published heading
        every time the topic hiccuped. The ground-truth yaw is used as a CHECK on that
        heading instead (`yaw_disagreement`).

        `yaw_speed` does follow the source, and is measured either way: the sim's own
        body yaw rate on a ground-truth frame (the same sample, and the same instant,
        as the linear velocity it sits beside -- not a one-tick difference of a
        differently-timed feed), the difference of two MEASURED headings on a
        dead-reckoned one. Neither is the commanded turn rate. The step this can put
        into `yaw_speed` at a source switch is bounded by how much the two disagree,
        which is sampling skew at 70 Hz; the switch is announced, and nothing in
        NeoDEM uses `yaw_speed` for control.
        """
        if yaw_sample is None or now - yaw_sample[1] > self.stale_after:
            self.starved = True
            self._last_t = self._prev_cont = None
            return None
        self.starved = False

        cont = self.tracker.update(yaw_sample[0])
        vx, vy, cmd_at = command
        if now - cmd_at > self.command_stale_after:
            vx = vy = 0.0

        # Freshness is decided EVERY tick, not only on the ticks that publish, so the
        # anchor below never lags the truth by up to a publish period.
        pose = None
        if self.use_ground_truth and ground_truth is not None:
            candidate, gt_at = ground_truth
            if candidate is not None and now - gt_at <= self.ground_truth_stale_after:
                pose = candidate
        if pose is not None and not all(
                math.isfinite(v) for v in (pose.x, pose.y, pose.vx, pose.vy,
                                           pose.yaw_rate)):
            # ALL OR NOTHING. One `error_code` covers the whole message, so a pose
            # whose velocity cannot be published as measured cannot have its position
            # published as measured either -- the alternative is a frame stamped
            # 0x600D carrying one exact number and one invented one, which is the
            # TASK-231 defect in a smaller box. Falling back is loud and honest; this
            # is unreachable from `parse_sim_state`, which refuses such a payload
            # outright, and exists for poses built by hand.
            self.ground_truth_unusable += 1
            pose = None
        self.ground_truth_fresh = pose is not None

        yaw_speed = 0.0
        if self._last_t is not None and self._prev_cont is not None:
            dt = now - self._last_t
            # x/y: DEAD RECKONED from the velocity we ASKED for. Only the heading it
            # is rotated by was measured. See the module docstring.
            self.reckoner.step(vx, vy, dt, cont, self._prev_cont)
            if dt > 0.0:
                # One-tick difference, unfiltered: fine for a 50 Hz sim feed, and
                # nothing in NeoDEM uses yaw_speed for control.
                yaw_speed = (cont - self._prev_cont) / dt
        self._last_t, self._prev_cont = now, cont

        if pose is not None:
            # AFTER the step, deliberately: the anchor pairs the true pose with the
            # reckoner state the fallback will continue from, so the first frame
            # published after ground truth is lost carries the last TRUE position plus
            # exactly the dead reckoning that happened since -- no one-tick step.
            self.ground_truth_seen = True
            # Re-derived every tick: odom (0, 0) maps to whatever makes the reckoner's
            # current displacement land on the true pose. This is the ONE place the
            # anchor moves, and it is why the origin is not added to ground truth --
            # the origin is only ever the anchor's initial value.
            self._world_anchor = (pose.x - self.reckoner.x, pose.y - self.reckoner.y)
            d = pose.yaw - yaw_sample[0]
            self.yaw_disagreement = abs(d - 2 * math.pi * math.floor(
                (d + math.pi) / (2 * math.pi)))

        if self._last_pub is not None and now - self._last_pub < self.publish_period:
            return None
        self._last_pub = now
        if pose is not None:
            # GROUND TRUTH, VERBATIM. Not `reckoner + anchor`, which is equal to this
            # in exact arithmetic and merely nearly equal in floating point: the number
            # published is the number Isaac holds, bit for bit, and no origin term goes
            # anywhere near it (module docstring -- ground truth is ALREADY world).
            x, y, source = pose.x, pose.y, ODOM_SOURCE_GROUND_TRUTH
            # ...AND SO IS THE VELOCITY, from the same message, already world-frame.
            # `vx`/`vy`/`yaw_speed` below are the COMMAND and must not reach a frame
            # labelled ground truth (TASK-231's second half): the whole message says
            # one thing or the other.
            vx_world, vy_world, yaw_rate = pose.vx, pose.vy, pose.yaw_rate
        else:
            # THE ONLY PLACE AN ODOM->WORLD OFFSET IS APPLIED, x and y only. It is the
            # last ground-truth anchor if there has ever been one, and the configured
            # `--odom-origin` otherwise. yaw (`yaw_sample[0]`) and `cont` are measured
            # and world-absolute already; adding an offset term to them would rotate
            # every heading the agent reads. Velocity is a derivative, so a constant
            # translation leaves it alone -- offsetting it would be the classic
            # "applied to velocities instead of positions" bug.
            ax, ay = (self._ox, self._oy) if self._world_anchor is None else self._world_anchor
            x, y, source = (self.reckoner.x + ax, self.reckoner.y + ay,
                            ODOM_SOURCE_DEAD_RECKONED)
            # The COMMAND, rotated into the world frame by the measured heading -- the
            # exact quantity whose integral produced the x/y above, which is what makes
            # this frame internally consistent. It is honest here and only here,
            # because this frame is stamped 0xDEAD. `yaw_speed` is still measured: it
            # is the difference of two rt/lowstate headings, not a commanded turn rate.
            # (The rotation is computed here rather than above because a ground-truth
            # frame has no use for it -- its velocity is already world-frame.)
            c, s = math.cos(cont), math.sin(cont)
            vx_world, vy_world, yaw_rate = vx * c - vy * s, vx * s + vy * c, yaw_speed
        self.source = source
        if source == ODOM_SOURCE_GROUND_TRUTH:
            self.frames_ground_truth += 1
        else:
            self.frames_dead_reckoned += 1
        return OdomFrame(x, y, yaw_sample[0], cont,
                         vx_world, vy_world, yaw_rate, source)


def fill_odom_msg(msg, x: float, y: float, yaw: float, stamp_s: float,
                  vx_world: float = 0.0, vy_world: float = 0.0,
                  yaw_speed: float = 0.0,
                  error_code: int = ODOM_ERROR_CODE_DEAD_RECKONED):
    """Populate a `SportModeState_` for `rt/odommodestate` and return it.

    Takes the message rather than constructing one so this stays importable without
    `unitree_sdk2py` -- the offline verifier passes a stand-in with the same shape.

    Only the fields `g1_sidecar.py` actually reads are written (SIDECAR_ODOM_FIELDS
    plus the optional `velocity` / `yaw_speed` that `/state` surfaces). `position[2]`
    is 0.0 because this bridge tracks a planar base only; `imu_state.rpy` carries
    yaw alone for the same reason -- roll and pitch are available on `rt/lowstate`
    but no consumer of `/loco/odom` uses them, and copying them here would imply a
    fidelity that x/y do not have on a dead-reckoned frame.

    `velocity` and `yaw_speed` come from the SAME source as `x`/`y` -- the caller
    passes `OdomFrame.vx_world`/`vy_world`/`yaw_speed`, and `OdomIntegrator` fills
    those from `rt/sim_state` on a ground-truth frame and from the rotated command on
    a dead-reckoned one. That is what makes the single `error_code` below true of the
    whole message. It was not always: until TASK-231's second half this field carried
    the command on EVERY frame, including the ones stamped 0x600D, so a consumer
    reading a message labelled measured was handed the command back. `velocity[2]` is
    0.0 for the same reason `position[2]` is -- a planar base.

    `error_code` DEFAULTS to the dead-reckoned marker, not to the ground-truth one: a
    caller that forgets to pass provenance understates its pose rather than claiming an
    exactness it has not established.
    """
    msg.stamp.sec = int(stamp_s)
    msg.stamp.nanosec = int((stamp_s % 1.0) * 1e9)
    msg.error_code = int(error_code)
    # x/y are WORLD coordinates from whichever source `error_code` names: the sim's
    # true root pose (ODOM_ERROR_CODE_GROUND_TRUTH, exact), or dead reckoning shifted
    # into the world frame by the integrator's anchor (ODOM_ERROR_CODE_DEAD_RECKONED,
    # which drifts without bound -- an anchor fixes where the drift STARTS, not that it
    # drifts). yaw is measured either way, and is world-absolute with no offset term.
    msg.position = [float(x), float(y), 0.0]
    msg.velocity = [float(vx_world), float(vy_world), 0.0]
    msg.yaw_speed = float(yaw_speed)
    msg.imu_state.rpy = [0.0, 0.0, float(yaw)]
    return msg
