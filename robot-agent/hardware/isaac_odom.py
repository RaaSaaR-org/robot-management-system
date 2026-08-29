#!/usr/bin/env python3
"""Odometry maths for the Isaac bridge: measured yaw, dead-reckoned x/y.

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

`x` and `y` are NOT measured. Unitree's `unitree_sim_isaaclab` publishes no
ground-truth base position on DDS at all, so position here is DEAD RECKONED by
integrating the velocity the bridge itself commanded. It therefore accumulates every
difference between what was asked for and what the locomotion policy delivered --
slip, unmodelled turn-rate asymmetry, a policy that saturates -- and it NEVER
self-corrects. Treat it as "roughly how far we have asked the robot to travel",
never as an absolute position. Relative displacement over a few seconds is the most
it can support; a map anchored to it will drift without bound.

Rotating the commanded body-frame velocity by the MEASURED yaw (rather than by an
integrated yaw command) is the one thing that makes it better than pure open loop:
heading error does not compound into position error.

Quaternion order
----------------
A real G1 reports `(w, x, y, z)`. This sim does not: with NeoDEM patch `0002`
applied, `imu_state.quaternion` arrives as `(x, y, z, w)` -- Isaac Lab 3.0 is XYZW
throughout (identity is `(0,0,0,1)`), and the vendor's 2.x-era plumbing does not
convert it. `isaac_yaw_sweep.py` verified `xyzw` against a real turn, so that is the
default here too. Reading it as `wxyz` does not merely offset the answer: it makes
the reported heading swing with ROLL while the true yaw sits still (see
`verify_isaac_odom_offline.py`, check 2), which looks exactly like a drifting robot.
"""
from __future__ import annotations

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
    """One pose ready to go on the wire. `x`/`y` dead reckoned, `yaw` measured."""
    x: float
    y: float
    yaw: float              # wrapped, as a real G1 reports it
    yaw_continuous: float   # unwrapped, for anything that differences it
    vx_world: float
    vy_world: float
    yaw_speed: float


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
    """

    def __init__(self, publish_period: float, stale_after: float,
                 command_stale_after: float, x0: float = 0.0, y0: float = 0.0) -> None:
        self.publish_period = float(publish_period)
        self.stale_after = float(stale_after)
        self.command_stale_after = float(command_stale_after)
        self.tracker = YawTracker()
        self.reckoner = DeadReckoner(x0, y0)
        self.starved = True          # nothing seen yet counts as starved, so the
                                     # first sample logs "acquired" rather than silence
        self._last_t: float | None = None
        self._prev_cont: float | None = None
        self._last_pub: float | None = None

    def tick(self, now: float, yaw_sample, command) -> OdomFrame | None:
        """Advance to `now`; return a frame when one is due, else None.

        `yaw_sample` is `(wrapped_yaw, monotonic_recv_time)` or None; `command` is
        `(vx, vy, monotonic_time_published)`.
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

        if self._last_pub is not None and now - self._last_pub < self.publish_period:
            return None
        self._last_pub = now
        c, s = math.cos(cont), math.sin(cont)
        return OdomFrame(self.reckoner.x, self.reckoner.y, yaw_sample[0], cont,
                         vx * c - vy * s, vx * s + vy * c, yaw_speed)


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
    fidelity the dead-reckoned x/y does not have.

    `velocity` is the COMMANDED velocity rotated into the world frame, not a
    measured one -- it is the exact quantity whose integral produced x/y, so a
    consumer differencing the position and a consumer reading the velocity get a
    consistent (and consistently optimistic) story.
    """
    msg.stamp.sec = int(stamp_s)
    msg.stamp.nanosec = int((stamp_s % 1.0) * 1e9)
    msg.error_code = int(error_code)
    # x/y are DEAD RECKONED from the commanded velocity. They drift without bound
    # and must not be trusted as an absolute position. yaw, and only yaw, is measured.
    msg.position = [float(x), float(y), 0.0]
    msg.velocity = [float(vx_world), float(vy_world), 0.0]
    msg.yaw_speed = float(yaw_speed)
    msg.imu_state.rpy = [0.0, 0.0, float(yaw)]
    return msg
