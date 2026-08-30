#!/usr/bin/env python3
"""Offline check for the Isaac bridge's odometry path (NeoDEM, TASK-203).

@file verify_isaac_odom_offline.py
@description Exercises `isaac_odom.py` -- the maths behind `isaac_loco_bridge.py`'s
    `rt/odommodestate` publisher -- with no sim, no DDS traffic, no GPU and no
    `unitree_sdk2py`. Runs in well under a second on `python3`.
@feature hardware

Why this exists as a standalone script rather than as an in-sim assertion: the GPU on
this box is serialised, an Isaac boot costs minutes, and every bug this catches is a
CPU bug. The one defect it is built around is the quaternion ORDER. This sim reports
`imu_state.quaternion` as `(x, y, z, w)` -- Isaac Lab 3.0 is XYZW throughout and the
vendor's 2.x-era plumbing does not convert -- so reading it as a real G1's `(w,x,y,z)`
produces a heading that swings with ROLL while the true yaw sits still. That failure
mode is indistinguishable, on a video or a plot, from a robot drifting off course. It
must not be able to regress quietly, so check (2) below asserts the two orderings
DISAGREE, not merely that the right one is right.

The second defect it is built around is the FRAME. x/y are dead reckoned from zero,
so the bridge published (0.00, 0.00) while the robot stood at the scene's authored
spawn, world (4.00, -2.00), and Agent Mode -- whose place graph is in world metres --
resolved the robot into a place 4.5 m away. Section (7) covers the origin that closes
that gap: unset behaves byte-identically to before, a given origin shifts x and y by
exactly that and leaves YAW alone (yaw is measured and world-absolute; offsetting it
"for symmetry" would rotate every heading the agent reads), a malformed value is
refused by name, and the published path length is unchanged -- a translation cannot
change a distance, which is what catches an offset applied twice, applied to
velocities, or applied inside the integration loop.

What this cannot check: that the sim's quaternion really is XYZW (only a live turn
settles that -- `isaac_yaw_sweep.py` did), that DDS delivers anything, that the odom
thread stays off the command thread under load, that the origin handed over on the
command line is the pose Isaac really spawned at (only a live run settles that; the
bringup script makes them one resolver call so they cannot differ), or that the
dead-reckoned position resembles where the robot physically is. It never will; that is
the point of check (4) being labelled dead reckoning -- an origin fixes where the drift
STARTS, not that it drifts.

Run:
    python3 robot-agent/hardware/verify_isaac_odom_offline.py
"""
import ast
import math
import os
import sys

_HERE = os.path.dirname(os.path.abspath(__file__))
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)

import isaac_odom  # noqa: E402

FAILURES = []

BRIDGE_PATH = os.path.join(_HERE, "isaac_loco_bridge.py")


def bridge_pure_defs(*names):
    """Lift named module-level constants and functions out of `isaac_loco_bridge.py`.

    The bridge imports `unitree_sdk2py` at module scope, so it cannot be imported
    on a plain `python3` -- which is the whole reason this file exists. Its odom
    RATE arithmetic is pure, though, and it is what decides both what the startup
    banner claims and what the publisher actually delivers, so it is executed here
    rather than re-implemented. A re-implementation would pass while the bridge
    was wrong, which is precisely the failure this section is about.
    """
    src = open(BRIDGE_PATH, encoding="utf-8").read()
    tree = ast.parse(src)
    kept = [node for node in tree.body
            if (isinstance(node, ast.FunctionDef) and node.name in names)
            or (isinstance(node, ast.Assign)
                and any(getattr(t, "id", None) in names for t in node.targets))]
    namespace = {"math": math}
    exec(compile(ast.Module(body=kept, type_ignores=[]), BRIDGE_PATH, "exec"), namespace)
    missing = [n for n in names if n not in namespace]
    if missing:
        # Fatal on the spot rather than a traceback ten checks later: every rate
        # assertion below is computed FROM these, so there is nothing left to check.
        print(f"    FAIL  isaac_loco_bridge.py defines no {', '.join(missing)}")
        print(f"FAILED: isaac_loco_bridge.py is missing {', '.join(missing)} — the odom "
              f"rate arithmetic this file verifies has been removed or renamed.")
        sys.exit(1)
    return namespace


BRIDGE = bridge_pure_defs("ODOM_TICK_HZ", "achievable_odom_rate_hz", "odom_publish_period_s")


def check(ok, label, detail=""):
    print(f"    {'PASS' if ok else 'FAIL'}  {label}" + (f"  [{detail}]" if detail else ""))
    if not ok:
        FAILURES.append(label)


def quat_wxyz(roll=0.0, pitch=0.0, yaw=0.0):
    """(w, x, y, z) for an intrinsic ZYX rotation -- the canonical ordering."""
    cr, sr = math.cos(roll / 2), math.sin(roll / 2)
    cp, sp = math.cos(pitch / 2), math.sin(pitch / 2)
    cy, sy = math.cos(yaw / 2), math.sin(yaw / 2)
    return (cr * cp * cy + sr * sp * sy,
            sr * cp * cy - cr * sp * sy,
            cr * sp * cy + sr * cp * sy,
            cr * cp * sy - sr * sp * cy)


def on_the_wire(roll=0.0, pitch=0.0, yaw=0.0):
    """The 4-float buffer THIS SIM publishes, i.e. the wxyz quaternion re-laid as xyzw."""
    w, x, y, z = quat_wxyz(roll, pitch, yaw)
    return [x, y, z, w]


class FakeIMU:
    def __init__(self):
        self.rpy = None


class FakeStamp:
    def __init__(self):
        self.sec = None
        self.nanosec = None


class FakeSportModeState:
    """Stand-in for `unitree_go.msg.dds_.SportModeState_` that records what was set.

    Only the attributes the real IDL has; anything `fill_odom_msg` invents would
    raise here rather than being silently accepted, which is the point.
    """

    __slots__ = ("stamp", "error_code", "imu_state", "position", "velocity",
                 "yaw_speed")

    def __init__(self):
        self.stamp = FakeStamp()
        self.imu_state = FakeIMU()
        self.error_code = None
        self.position = None
        self.velocity = None
        self.yaw_speed = None


print(__doc__.splitlines()[0])
print()

# --------------------------------------------------------------------------------
print("(1) yaw comes out right under xyzw, and DIFFERENT under wxyz")
for true_yaw in (0.0, math.pi / 2, -math.pi / 6, 2.5):
    buf = on_the_wire(yaw=true_yaw)
    got = isaac_odom.yaw_from_quaternion(buf, "xyzw")
    check(abs(got - true_yaw) < 1e-9,
          f"xyzw recovers yaw={math.degrees(true_yaw):+.1f} deg",
          f"{math.degrees(got):+.3f} deg")
buf = on_the_wire(yaw=math.pi / 2)
wrong = isaac_odom.yaw_from_quaternion(buf, "wxyz")
check(abs(wrong - math.pi / 2) > 1.0,
      "wxyz misreads the same buffer by more than a radian",
      f"{math.degrees(wrong):+.1f} deg instead of +90.0")
check(isaac_odom.DEFAULT_QUAT_ORDER == "xyzw",
      "xyzw is the default (isaac_yaw_sweep.py verified it against a real turn)",
      isaac_odom.DEFAULT_QUAT_ORDER)

# --------------------------------------------------------------------------------
print("\n(2) the wrong ordering fabricates heading change out of ROLL")
# A G1 walking rocks side to side. Hold the true yaw at 0 and roll +/- 10 deg: the
# correct reading is a flat line, the wrong one sweeps ~20 deg. This is the exact
# symptom the bug produces in the field -- a robot that "drifts" while walking
# straight -- so it is asserted, not just described.
rolls = [math.radians(d) for d in (-10, -5, 0, 5, 10)]
right = [isaac_odom.yaw_from_quaternion(on_the_wire(roll=r), "xyzw") for r in rolls]
wrongs = [isaac_odom.yaw_from_quaternion(on_the_wire(roll=r), "wxyz") for r in rolls]
check(max(right) - min(right) < 1e-9,
      "xyzw: heading is constant while the torso rolls",
      f"spread {math.degrees(max(right) - min(right)):.2e} deg")
check(math.degrees(max(wrongs) - min(wrongs)) > 15.0,
      "wxyz: heading swings with roll (the silent-regression symptom)",
      f"spread {math.degrees(max(wrongs) - min(wrongs)):.1f} deg")

# --------------------------------------------------------------------------------
print("\n(3) yaw unwrapping survives the +/-pi seam")
seam = [3.00, 3.10, -3.10, -3.00, -2.90]
expected = [3.00, 3.10, -3.10 + 2 * math.pi, -3.00 + 2 * math.pi, -2.90 + 2 * math.pi]
got = isaac_odom.unwrap(seam)
check(all(abs(a - b) < 1e-9 for a, b in zip(got, expected)),
      "unwrap() lifts the samples past +pi instead of jumping back",
      f"{[round(v, 3) for v in got]}")

tracker = isaac_odom.YawTracker()
streamed = [tracker.update(v) for v in seam]
check(all(abs(a - b) < 1e-9 for a, b in zip(streamed, got)),
      "YawTracker (streaming) agrees with unwrap() (batch) sample for sample")

# ... and that this is what keeps yaw_speed finite.
dt = 0.02
naive = (seam[2] - seam[1]) / dt
fixed = (streamed[2] - streamed[1]) / dt
check(abs(fixed) < 5.0, "yaw_speed across the seam stays plausible",
      f"{fixed:+.2f} rad/s")
check(abs(naive) > 250.0,
      "the same step read WRAPPED would report a physically impossible rate",
      f"{naive:+.1f} rad/s")

# The other seam, and a full turn, so the fix is not one-directional.
tracker2 = isaac_odom.YawTracker()
back = [tracker2.update(v) for v in (-3.00, -3.10, 3.10, 3.00)]
check(back[-1] < back[0] and abs(back[-1] - (3.00 - 2 * math.pi)) < 1e-9,
      "a turn the other way unwraps downwards", f"{back[-1]:+.4f} rad")
tracker3 = isaac_odom.YawTracker()
turn = [tracker3.update(isaac_odom.yaw_from_quaternion(on_the_wire(yaw=a), "xyzw"))
        for a in [i * math.pi / 8 for i in range(17)]]
check(abs(turn[-1] - 2 * math.pi) < 1e-9,
      "a full 360 deg turn accumulates to 2*pi, not back to 0",
      f"{math.degrees(turn[-1]):.2f} deg")

# --------------------------------------------------------------------------------
print("\n(4) dead-reckoned x/y for a known command sequence")
# NOT a measurement (see isaac_odom's docstring) -- this only asserts that the
# integrator does what it claims for commands whose answer can be worked out by hand.
dr = isaac_odom.DeadReckoner()
dr.step(1.0, 0.0, 1.0, 0.0, 0.0)                       # 1 m/s forward, facing +x
check(abs(dr.x - 1.0) < 1e-12 and abs(dr.y) < 1e-12,
      "1 s at vx=1 facing +x lands at (1, 0)", f"({dr.x:.3f}, {dr.y:.3f})")
dr.step(1.0, 0.0, 1.0, math.pi / 2, math.pi / 2)       # same speed, now facing +y
check(abs(dr.x - 1.0) < 1e-12 and abs(dr.y - 1.0) < 1e-12,
      "another 1 s facing +y lands at (1, 1)", f"({dr.x:.3f}, {dr.y:.3f})")
dr.step(0.0, 0.5, 1.0, math.pi / 2, math.pi / 2)       # strafe LEFT while facing +y
check(abs(dr.x - 0.5) < 1e-12 and abs(dr.y - 1.0) < 1e-12,
      "a left strafe while facing +y moves along -x (vy is body frame)",
      f"({dr.x:.3f}, {dr.y:.3f})")
check(abs(dr.distance - 2.5) < 1e-12, "path length is the sum of the three legs",
      f"{dr.distance:.3f} m")

mid = isaac_odom.DeadReckoner()
mid.step(1.0, 0.0, 1.0, math.pi / 2, 0.0)              # heading swept 0 -> 90 deg
check(abs(mid.x - math.cos(math.pi / 4)) < 1e-12 and abs(mid.y - math.sin(math.pi / 4)) < 1e-12,
      "a turning leg is integrated about the MID-POINT heading, not the endpoint",
      f"({mid.x:.4f}, {mid.y:.4f})")

zero = isaac_odom.DeadReckoner(2.0, -1.0)
zero.step(5.0, 5.0, 0.0, 0.0)
zero.step(5.0, 5.0, -0.1, 0.0)
check(zero.x == 2.0 and zero.y == -1.0 and zero.distance == 0.0,
      "a zero or negative dt moves nothing (a stalled loop must not teleport)",
      f"({zero.x:.3f}, {zero.y:.3f})")

# The whole pipeline, quaternions in and a pose out, as the bridge runs it.
print("\n(4b) quaternion stream -> pose, the way the bridge threads it together")
walk = isaac_odom.DeadReckoner()
track = isaac_odom.YawTracker()
prev = None
steps, dt = 100, 0.02                                  # 2 s at 50 Hz, 0.5 m/s forward
for i in range(steps + 1):
    yaw_true = -math.pi + 0.4 * i * dt                 # starts ON the seam and turns
    yaw_true = math.atan2(math.sin(yaw_true), math.cos(yaw_true))
    cont = track.update(isaac_odom.yaw_from_quaternion(
        on_the_wire(roll=0.08 * math.sin(i), yaw=yaw_true), "xyzw"))
    if prev is not None:
        walk.step(0.5, 0.0, dt, cont, prev)
    prev = cont
check(abs(walk.distance - 0.5 * steps * dt) < 1e-9,
      "2 s at 0.5 m/s dead-reckons 1.0 m of path regardless of the turn",
      f"{walk.distance:.4f} m")
check(abs(track.continuous - (-math.pi + 0.4 * steps * dt)) < 1e-9,
      "the heading unwraps continuously through the seam it started on",
      f"{track.continuous:+.4f} rad")

# --------------------------------------------------------------------------------
print("\n(5) the published message carries the fields g1_sidecar.py reads")
msg = FakeSportModeState()
isaac_odom.fill_odom_msg(msg, x=1.25, y=-0.5, yaw=0.75, stamp_s=1234.5,
                         vx_world=0.4, vy_world=-0.1, yaw_speed=0.2)
check(msg.position == [1.25, -0.5, 0.0], "position = [x, y, 0]", str(msg.position))
check(msg.imu_state.rpy == [0.0, 0.0, 0.75],
      "imu_state.rpy = [0, 0, yaw] -- the sidecar reads rpy[2]", str(msg.imu_state.rpy))
check(msg.velocity == [0.4, -0.1, 0.0], "velocity = the commanded world velocity",
      str(msg.velocity))
check(msg.yaw_speed == 0.2, "yaw_speed set", str(msg.yaw_speed))
check(msg.stamp.sec == 1234 and abs(msg.stamp.nanosec - 5e8) < 1e6,
      "stamp split into sec/nanosec",
      f"{msg.stamp.sec}.{msg.stamp.nanosec:09d}")
check(msg.error_code == isaac_odom.ODOM_ERROR_CODE_DEAD_RECKONED,
      "error_code stamped with the dead-reckoned provenance marker, NOT 0",
      hex(msg.error_code))

# Those names are only right because the sidecar reads them. Assert that against the
# sidecar's own source, so a change there fails HERE rather than silently on the robot.
print("\n(5b) those field names still match g1_sidecar.py's reader")
sidecar = os.path.join(_HERE, "g1_sidecar.py")
src = open(sidecar, encoding="utf-8").read()
check('TOPIC_ODOM = os.environ.get("G1_ODOM_TOPIC", "rt/odommodestate")' in src,
      "the sidecar still subscribes to rt/odommodestate by default")
check("from unitree_sdk2py.idl.unitree_go.msg.dds_ import SportModeState_" in src,
      "the sidecar still expects a unitree_go SportModeState_ on that topic")
check('getattr(msg, "position", None)' in src and '"imu_state"' in src and '"rpy"' in src,
      "the sidecar still reads position + imu_state.rpy (SIDECAR_ODOM_FIELDS)")
check(isaac_odom.SIDECAR_ODOM_FIELDS == ("position", "imu_state.rpy"),
      "SIDECAR_ODOM_FIELDS documents exactly that pair",
      str(isaac_odom.SIDECAR_ODOM_FIELDS))
# `_pose_from` refuses a message without BOTH, so an unset one is a 503, not a 0.
check('if pos is None:' in src and 'if ang is None:' in src,
      "and refuses (503) rather than defaulting a missing field to 0")

# --------------------------------------------------------------------------------
print("\n(6) OdomIntegrator: the failure paths, driven on a fake clock")
# This is the whole of `OdomPublisher._run`'s decision-making, with `now`, the yaw
# sample and the command slot supplied as arguments. Every case below is one the
# bridge only reaches when something is already going wrong in the sim.
STALE, CMD_STALE = 1.0, 0.5                     # the bridge's constants
# The publish period is the bridge's own, for the default 20 Hz against its
# 100 Hz tick -- NOT 1/20 written out by hand. Hand-writing it is how this file
# came to assert the behaviour of a 50 Hz tick loop that had not existed since
# ODOM_TICK_HZ was raised: 9 frames in 0.5 s is 60 ms apart, i.e. 16.7 Hz, and
# the check called it "the 20 Hz publish period". See BRIDGE below.
PUB = BRIDGE["odom_publish_period_s"](20.0)
integ = isaac_odom.OdomIntegrator(PUB, STALE, CMD_STALE)
check(integ.starved, "starts starved — nothing is published before the first sample")
check(integ.tick(0.0, None, (1.0, 0.0, 0.0)) is None,
      "no yaw sample at all -> no frame (the sidecar 503s instead of seeing a lie)")

t, frames = 0.0, []
for i in range(1, 51):                          # 0.5 s at ODOM_TICK_HZ, 1 m/s forward
    t = i * 0.01
    f = integ.tick(t, (0.0, t), (1.0, 0.0, t))
    if f is not None:
        frames.append((t, f))
check(not integ.starved, "a fresh sample clears the starved flag")
# 10, not 11: the first tick publishes immediately, so the 0.5 s window holds one
# fewer 50 ms gap than it does frames. Asserted exactly, because a silent drop to
# (say) 16.7 Hz would still look "roughly right" against a tolerance -- and 16.7 Hz
# is exactly what this used to be, unnoticed, for the whole time the tick ran at
# 50 Hz and the publish period sat on the tick boundary.
gaps = {round(frames[i + 1][0] - frames[i][0], 6) for i in range(len(frames) - 1)}
check(len(frames) == 10, "100 Hz ticks are rate-limited to the 20 Hz publish period",
      str(len(frames)))
check(gaps == {0.05}, "and every gap is 50 ms -- no tick lands on the boundary and "
                      "gets decided by floating point", str(sorted(gaps)))
# 0.45, not 0.46: the first sample only ANCHORS the integration (there is no earlier
# heading to average with), so the 46 ticks up to the last frame contribute 45
# intervals; the full 50-tick window leaves the reckoner at 0.49.
check(abs(frames[-1][1].x - 0.45) < 1e-9 and abs(frames[-1][1].y) < 1e-9,
      "0.46 s at vx=1 dead-reckons 45 x 10 ms = 0.45 m",
      f"({frames[-1][1].x:.4f}, {frames[-1][1].y:.4f})")
check(abs(integ.reckoner.x - 0.49) < 1e-9,
      "and the ticks after the last frame keep integrating: 49 x 10 ms = 0.49 m",
      f"{integ.reckoner.x:.4f}")

# The negative case, which is the whole point of the arithmetic above: a rate that
# is NOT a divisor of the tick cannot be delivered, and the bridge must not claim
# it. Measured on the live sim before this: --odom-rate 30 published at 25 Hz, 15
# at 14.5, 60 at 50, while the banner repeated the request back verbatim.
integ30 = isaac_odom.OdomIntegrator(BRIDGE["odom_publish_period_s"](30.0), STALE, CMD_STALE)
frames30 = []
for i in range(1, 51):
    t30 = i * 0.01
    if integ30.tick(t30, (0.0, t30), (1.0, 0.0, t30)) is not None:
        frames30.append(round(t30, 6))
gaps30 = {round(frames30[i + 1] - frames30[i], 6) for i in range(len(frames30) - 1)}
check(gaps30 == {0.04},
      "a requested 30 Hz is DELIVERED at 25 Hz (40 ms), because a frame can only "
      "leave on a tick boundary", str(sorted(gaps30)))
check(abs(BRIDGE["achievable_odom_rate_hz"](30.0) - 25.0) < 1e-9,
      "and the bridge computes that 25 Hz rather than promising 30", 
      f"{BRIDGE['achievable_odom_rate_hz'](30.0):g}")
for requested, delivered in ((20.0, 20.0), (15.0, 100.0 / 7), (60.0, 50.0),
                             (100.0, 100.0), (200.0, 100.0), (25.0, 25.0)):
    got = BRIDGE["achievable_odom_rate_hz"](requested)
    check(abs(got - delivered) < 1e-9,
          f"--odom-rate {requested:g} is delivered at {delivered:.4g} Hz", f"{got:.4g}")

# The sim stalls for 10 s, then comes back. The position must NOT jump.
x_before = integ.reckoner.x
check(integ.tick(t + 2.0, (0.0, t), (1.0, 0.0, t + 2.0)) is None,
      "a yaw sample older than the staleness window is refused")
check(integ.starved, "and the integrator reports itself starved")
resumed = integ.tick(t + 10.0, (0.0, t + 10.0), (1.0, 0.0, t + 10.0))
check(resumed is not None, "publishing resumes with the first fresh sample")
check(abs(resumed.x - x_before) < 1e-9,
      "that first frame RE-ANCHORS: it does not integrate the 10 s outage",
      f"{resumed.x:.4f} vs {x_before:.4f} before the outage")
integ.tick(t + 10.02, (0.0, t + 10.02), (1.0, 0.0, t + 10.02))
check(abs(integ.reckoner.x - (x_before + 0.02)) < 1e-9,
      "and the tick after it advances by one tick, not by the gap",
      f"{integ.reckoner.x:.4f}")

# A dead command publisher must stop the dead reckoner, not coast it.
integ2 = isaac_odom.OdomIntegrator(0.0, STALE, CMD_STALE)
integ2.tick(0.0, (0.0, 0.0), (1.0, 0.0, 0.0))
integ2.tick(0.1, (0.0, 0.1), (1.0, 0.0, 0.1))
moving = integ2.reckoner.x
integ2.tick(0.2, (0.0, 0.2), (1.0, 0.0, 0.1))   # command slot now 0.1 s old: still fresh
integ2.tick(0.9, (0.0, 0.9), (1.0, 0.0, 0.1))   # ...now 0.8 s old: stale
check(moving > 0.0, "a fresh command moves the dead reckoner", f"{moving:.4f} m")
check(abs(integ2.reckoner.x - (moving + 0.1)) < 1e-9,
      "a command slot older than 0.5 s integrates as ZERO, not as the last velocity",
      f"{integ2.reckoner.x:.4f} m")

# And the frame's velocity is the commanded one rotated into the world frame.
integ3 = isaac_odom.OdomIntegrator(0.0, STALE, CMD_STALE)
integ3.tick(0.0, (math.pi / 2, 0.0), (0.7, 0.0, 0.0))
f3 = integ3.tick(0.02, (math.pi / 2, 0.02), (0.7, 0.0, 0.02))
check(abs(f3.vx_world) < 1e-9 and abs(f3.vy_world - 0.7) < 1e-9,
      "facing +y, a forward command reports world velocity (0, 0.7)",
      f"({f3.vx_world:.4f}, {f3.vy_world:.4f})")
check(abs(f3.yaw - math.pi / 2) < 1e-12 and abs(f3.yaw_continuous - math.pi / 2) < 1e-12,
      "the frame carries the WRAPPED yaw for the wire and the continuous one alongside")

print("\n(6b) isaac_loco_bridge.py's own guards, read from its source")
# Neither of these is reachable without DDS, and both are the kind of rule that
# is only ever exercised in anger. Asserted against the source for the same
# reason as (5b): a change there must fail HERE, not on a robot.
bridge_src = open(BRIDGE_PATH, encoding="utf-8").read()
check("if domain == 0:" in bridge_src
      and "domain 0 is the REAL ROBOT and is refused" in bridge_src,
      "the bridge refuses DDS domain 0 (the real robot) outright")
check("[bridge] refused:" in bridge_src and "return 2" in bridge_src,
      "and main() turns that into an operator message and exit 2, not a traceback")
check("{self._odom.rate:g} Hz" in bridge_src,
      "the startup banner quotes the ACHIEVABLE odom rate, not the requested one")
check("publish_period=odom_publish_period_s(rate_hz)" in bridge_src,
      "and the publisher is built with the period that rate implies")
check(abs(BRIDGE["ODOM_TICK_HZ"] - 100.0) < 1e-9,
      "ODOM_TICK_HZ is still 100 Hz -- the number every gap above is computed from",
      f"{BRIDGE['ODOM_TICK_HZ']:g}")

# --------------------------------------------------------------------------------
print("\n(7) the odometry ORIGIN: odom frame -> world frame, x and y ONLY")
# The defect: dead reckoning starts at zero, so the bridge published (0.00, 0.00)
# while the robot physically stood at the scene's authored spawn, world (4.00,
# -2.00). Agent Mode's place graph is in WORLD metres, so it logged
#   [RobotStateManager] Place: UNKNOWN -> FACTORY-CENTRE at (0.00, 0.00)
# and resolved the robot into a place 4.5 m from where it was standing. A goto from
# there would have applied a world displacement to an odom-origin pose.

print("  (7a) --odom-origin parsing: refused by name, never defaulted to zero")
check(isaac_odom.parse_odom_origin("4.0,-2.0") == (4.0, -2.0),
      "a well-formed X,Y parses to a float pair",
      str(isaac_odom.parse_odom_origin("4.0,-2.0")))
check(isaac_odom.parse_odom_origin("  10.24 , 5.84  ") == (10.24, 5.84),
      "surrounding and interior whitespace is tolerated")
check(isaac_odom.parse_odom_origin("-0.5,3") == (-0.5, 3.0),
      "negatives and integers are fine (the factory spawn's y is negative)")
for bad, why in (("", "empty"), ("4", "one field"), ("4,5,6", "three fields"),
                 ("four,-2", "non-numeric x"), ("4,two", "non-numeric y"),
                 ("nan,0", "nan"), ("0,inf", "inf"), (",", "two empty fields")):
    try:
        got = isaac_odom.parse_odom_origin(bad)
    except ValueError as exc:
        # Naming the offending value is the whole point: an origin that silently
        # became (0, 0) is indistinguishable from not passing the flag at all, which
        # is the failure this feature exists to remove.
        check(repr(bad) in str(exc) or bad in str(exc),
              f"{why} ({bad!r}) is REFUSED, and the message quotes it",
              str(exc).split(" -- ")[0][:70])
    else:
        check(False, f"{why} ({bad!r}) must be refused, not accepted", str(got))

print("  (7b) unset origin is today's behaviour, unchanged")
STREAM = []           # one command/heading script, replayed through every integrator
_t = 0.0
for _i in range(1, 121):
    _t = _i * 0.01
    # Turning while walking, so the offset meets a non-trivial path rather than a line.
    STREAM.append((_t, (0.6 * math.sin(0.5 * _t), _t), (0.8, 0.15, _t)))


def replay(origin):
    """Run the shared script through one integrator; return its frames and reckoner."""
    integ = (isaac_odom.OdomIntegrator(PUB, STALE, CMD_STALE) if origin is False
             else isaac_odom.OdomIntegrator(PUB, STALE, CMD_STALE, origin=origin))
    frames, raw = [], []
    for now, yaw_sample, command in STREAM:
        f = integ.tick(now, yaw_sample, command)
        if f is not None:
            frames.append(f)
            # What the dead reckoner itself holds at that instant: the ODOM frame.
            raw.append((integ.reckoner.x, integ.reckoner.y))
    return integ, frames, raw


base, f_base, raw_base = replay(False)          # constructed exactly as before
none_i, f_none, _ = replay(None)                # explicit origin=None
zero_i, f_zero, _ = replay((0.0, 0.0))          # explicitly told the world origin
ORIGIN = (4.0, -2.0)                            # the factory scene's authored spawn
off_i, f_off, raw_off = replay(ORIGIN)

check(len(f_base) > 10, "the shared script publishes a useful number of frames",
      f"{len(f_base)} frames")
check(base.origin is None, "an integrator built the old way has origin=None",
      repr(base.origin))
# Byte-identical, asserted as identical reprs of the whole frame -- not a tolerance.
# A tolerance would pass a version that shifted x by 1e-16 and would not notice.
check([repr(f) for f in f_base] == [repr(f) for f in f_none],
      "origin=None publishes byte-identical frames to not passing origin at all")
check([repr(f) for f in f_base] == [repr(f) for f in f_zero],
      "and an explicit (0, 0) origin is byte-identical too")
check(all(f.x == r[0] and f.y == r[1] for f, r in zip(f_base, raw_base)),
      "with no origin the published x/y ARE the raw dead-reckoned numbers")

print("  (7c) a given origin shifts x/y by exactly that, and touches nothing else")
ox, oy = ORIGIN
check(all(fo.x == fb.x + ox and fo.y == fb.y + oy for fo, fb in zip(f_off, f_base)),
      f"every frame's x/y is shifted by exactly {ORIGIN}, to the last bit")
check(all(fo.yaw == fb.yaw and fo.yaw_continuous == fb.yaw_continuous
          for fo, fb in zip(f_off, f_base)),
      "YAW IS NOT OFFSET -- it is measured and already world-absolute")
check(all(fo.vx_world == fb.vx_world and fo.vy_world == fb.vy_world
          and fo.yaw_speed == fb.yaw_speed for fo, fb in zip(f_off, f_base)),
      "velocity and yaw_speed are derivatives: a translation leaves them alone")
check(all(ro == rb for ro, rb in zip(raw_off, raw_base)),
      "the DeadReckoner itself stays in the ODOM frame -- the offset is not baked in")
check(f_off[0].x == ORIGIN[0] + f_base[0].x,
      "the FIRST frame already carries the origin (the anchor tick is not exempt)",
      f"({f_off[0].x:.4f}, {f_off[0].y:.4f})")
# The concrete regression, in the numbers that were actually logged.
spawn = isaac_odom.OdomIntegrator(PUB, STALE, CMD_STALE, origin=(4.0, -2.0))
first = spawn.tick(0.0, (math.pi / 2, 0.0), (0.0, 0.0, 0.0))
check(first is not None and abs(first.x - 4.0) < 1e-12 and abs(first.y + 2.0) < 1e-12,
      "a robot that has not moved yet publishes its WORLD spawn, not (0, 0)",
      f"({first.x:.2f}, {first.y:.2f})")
check(abs(first.yaw - math.pi / 2) < 1e-12,
      "and its measured 90 deg heading comes through unrotated",
      f"{math.degrees(first.yaw):.1f} deg")

print("  (7d) a translation cannot change a distance")
# THE invariant that catches an offset applied twice, applied to velocities instead
# of positions, or applied inside the integration loop rather than at its boundary:
# all three change how far consecutive published poses are apart. A constant shift
# cannot.
def path_len(frames):
    return sum(math.hypot(b.x - a.x, b.y - a.y) for a, b in zip(frames, frames[1:]))


check(abs(path_len(f_off) - path_len(f_base)) < 1e-12,
      "the published path length is identical with and without the origin",
      f"{path_len(f_off):.6f} m vs {path_len(f_base):.6f} m")
check(off_i.reckoner.distance == base.reckoner.distance,
      "and the reckoner's own integrated path length is untouched, exactly",
      f"{off_i.reckoner.distance:.6f} m")
check(path_len(f_base) > 0.1,
      "(the script really does travel, so the check above is not vacuous)",
      f"{path_len(f_base):.4f} m")
# Applied twice would be caught by (7c); assert the shape of the failure anyway so
# the reason this check exists survives.
twice = [f.x + ox for f in f_off]
check(abs(twice[0] - (f_base[0].x + 2 * ox)) < 1e-12,
      "(an offset applied twice would land at origin*2 -- what (7c) would catch)")

print("  (7e) isaac_loco_bridge.py wires the flag, and says so on startup")
origin_src = open(BRIDGE_PATH, encoding="utf-8").read()
check('"--odom-origin"' in origin_src, "the bridge exposes --odom-origin")
check("isaac_odom.parse_odom_origin(args.odom_origin)" in origin_src,
      "and parses it with the shared, offline-testable parser")
check('ap.error(f"--odom-origin: {exc}")' in origin_src,
      "a malformed value becomes a named usage error, never a silent (0, 0)")
check("origin=odom_origin" in origin_src,
      "the value reaches OdomIntegrator as `origin`, not the reckoner's x0/y0")
check("odom origin DEFAULTED to (0.00, 0.00)" in origin_src
      and "odom origin GIVEN as" in origin_src,
      "the startup banner names the origin AND whether anyone chose it "
      "(a silent origin is how this defect stayed invisible)")
check("yaw is measured and is not offset" in origin_src,
      "and the banner says out loud that yaw carries no offset")

print("  (7f) factory_mission_bringup.sh feeds it the sim's own spawn pose")
BRINGUP = os.path.join(_HERE, "factory_mission_bringup.sh")
if not os.path.exists(BRINGUP):
    print("    SKIP  factory_mission_bringup.sh not present")
else:
    bringup_src = open(BRINGUP, encoding="utf-8").read()
    check("from common_scene.factory_pauseroom_layout import robot_spawn" in bringup_src,
          "it resolves the spawn with the scene's OWN robot_spawn(), on the host")
    check(bringup_src.count("import robot_spawn") == 1,
          "exactly once -- one resolver call, so sim and odometry cannot disagree",
          str(bringup_src.count("import robot_spawn")))
    check('--odom-origin "$SPAWN_XY"' in bringup_src,
          "and passes that pose to the bridge as --odom-origin")
    check("SPAWN_XY=" in bringup_src and "sed -n 's/^SPAWN_XY=//p'" in bringup_src,
          "reading a machine-readable line back by prefix, not by parsing the "
          "human-readable description")

# --------------------------------------------------------------------------------
print("\n(8) against the real IDL, if this interpreter has one")
try:
    from unitree_sdk2py.idl.default import (  # type: ignore
        unitree_go_msg_dds__SportModeState_ as real_ctor)
except Exception as exc:  # noqa: BLE001
    print(f"    SKIP  unitree_sdk2py not importable here ({type(exc).__name__}); "
          f"the fake message above still covers the field names")
else:
    real = isaac_odom.fill_odom_msg(real_ctor(), x=3.0, y=4.0, yaw=-1.0,
                                    stamp_s=10.25, vx_world=0.2, vy_world=0.0,
                                    yaw_speed=-0.05)
    check(list(real.position)[:2] == [3.0, 4.0], "real SportModeState_.position accepts x/y",
          str(list(real.position)))
    check(abs(list(real.imu_state.rpy)[2] - (-1.0)) < 1e-6,
          "real SportModeState_.imu_state.rpy[2] carries yaw",
          str(list(real.imu_state.rpy)))
    check(real.error_code == isaac_odom.ODOM_ERROR_CODE_DEAD_RECKONED,
          "error_code survives on the real IDL (uint32)", hex(real.error_code))

print()
if FAILURES:
    print(f"FAILED: {len(FAILURES)} check(s): {FAILURES}")
    sys.exit(1)
print("all isaac_odom offline checks passed")
