"""End-to-end check: an UNMODIFIED unitree_sdk2py LocoClient drives the sim.

Nothing here imports our sim code. If this passes, the same script would run
against a physical G1 by changing only the DDS domain.

    python e2e_loco_check.py 1 lo0                    # domain, interface
    python e2e_loco_check.py 5 lo0 --port 8779        # a node on another port
    python e2e_loco_check.py 1 lo0 --frames /tmp/f    # keep the compared frames
    python e2e_loco_check.py 1 lo0 --idle-s 0         # skip the slow sag check

Two of the checks exist because of specific bugs and are worth their runtime:
check 10 turns the robot more than 180 deg in one go (the wrapped-setpoint
crash), and check 11 leaves it standing still for a minute (the upper body
sagging to its joint limits under a weight-0 arm_sdk blend).
"""
import argparse
import base64
import hashlib
import json
import math
import pathlib
import sys
import time
import urllib.request

from unitree_sdk2py.core.channel import ChannelFactoryInitialize, ChannelSubscriber
from unitree_sdk2py.g1.loco.g1_loco_client import LocoClient
from unitree_sdk2py.idl.unitree_go.msg.dds_ import SportModeState_

# MuJoCo writes its instability warnings here, in the sim node's working
# directory. Growth during a run means the solver blew up and auto-reset mjData.
MUJOCO_LOG = pathlib.Path("MUJOCO_LOG.TXT")

# Joints that must still be in the stand pose after a long idle. Tolerance is
# generous next to the failure it guards: with a live (unlatched) hold pose the
# elbows droop 1.40 rad and waist_pitch/roll pin at their +-0.52 limits, while a
# latched one settles at 0.017 rad and stays there.
STAND_POSE_TOL = 0.10
STAND_POSE_JOINTS = (
    "waist_pitch_joint", "waist_roll_joint", "waist_yaw_joint",
    "left_elbow_joint", "right_elbow_joint",
    "left_hip_pitch_joint", "right_hip_pitch_joint",
    "left_knee_joint", "right_knee_joint",
    "left_ankle_pitch_joint", "right_ankle_pitch_joint",
)

ap = argparse.ArgumentParser(description="drive the sim node with a real LocoClient")
ap.add_argument("domain", nargs="?", type=int, default=1)
ap.add_argument("iface", nargs="?", default="lo0")
ap.add_argument("--port", type=int, default=8777,
                help="HTTP facade port of the sim node under test (default 8777)")
ap.add_argument("--frames", metavar="DIR",
                help="dump the two compared head-camera frames here")
ap.add_argument("--idle-s", type=float, default=60.0,
                help="seconds of standing still for the pose-drift check (0 = skip)")
ARGS = ap.parse_args()

HTTP = f"http://localhost:{ARGS.port}"
DOMAIN = ARGS.domain
IFACE = ARGS.iface
FRAME_DIR = ARGS.frames
odom = {}


def get(path):
    with urllib.request.urlopen(HTTP + path, timeout=8) as r:
        return json.load(r)


def post(path, payload):
    req = urllib.request.Request(
        HTTP + path, data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json"}, method="POST")
    with urllib.request.urlopen(req, timeout=10) as r:
        return json.load(r)


def reset_pose():
    """Put the robot back at the middle of the room, facing +x.

    Without this the harness is single-shot: each run leaves the robot metres
    from where it started, and by the third one it is strafing into a wall and
    the failures say nothing about the code under test. The room is only 6x6 m.

    (-1, 0) facing +x keeps the whole routine -- 1 m forward, +90 deg, 0.45 m
    strafe, then a 250 deg spin -- clear of the table (2.2, 0.7), the chair
    (1.6, -1.85), the shelf (-0.4, 2.75) and the person (-1.9, -1.45).
    """
    return post("/sim/reset-pose", {"x": -1.0, "y": 0.0, "yaw": 0.0})


def pose():
    d = get("/loco/odom")
    return d["x"], d["y"], d["yaw"]


def body_frame_delta(x0, y0, yaw0, x1, y1):
    """Translation from (x0,y0) to (x1,y1) expressed in the body frame at yaw0.

    Returns (forward, left) in metres. Velocity commands are body-frame, so the
    assertions about them have to be too -- otherwise every check silently
    depends on the robot starting out facing +x, and re-running the harness
    against a node that has already been driven fails for no real reason.
    """
    dx, dy = x1 - x0, y1 - y0
    return (
        dx * math.cos(yaw0) + dy * math.sin(yaw0),
        -dx * math.sin(yaw0) + dy * math.cos(yaw0),
    )


def snap_hash():
    d = get("/cameras/head_camera/snapshot")
    assert d.get("ok"), d
    return hashlib.sha256(d["jpeg_base64"].encode()).hexdigest()[:12], d["jpeg_base64"]


def drive(c, vx, vy, om, seconds, sample=False):
    """Refresh the command at 10 Hz, exactly like the real robot needs.

    With `sample`, return the (wall time, reported yaw) pairs seen along the way
    -- the only way to check that a heading moved *continuously* rather than
    landing on the right number after a jump.
    """
    samples = []
    end = time.time() + seconds
    while time.time() < end:
        c.SetVelocity(vx, vy, om, 0.5)
        if sample:
            samples.append((time.time(), pose()[2]))
        time.sleep(0.05 if sample else 0.1)
    c.StopMove()
    time.sleep(0.4)
    if sample:
        samples.append((time.time(), pose()[2]))
    return samples


def angle_delta(a, b):
    """Signed b-a folded into (-pi, pi].

    Reported yaw is wrapped, so a plain subtraction turns a 90 deg turn that
    happens to cross +-180 deg into a 270 deg one. That only ever showed up
    when the harness ran against a node already sitting near the wrap.
    """
    return (b - a + math.pi) % (2 * math.pi) - math.pi


def unwrap(samples):
    """Consecutive-difference unwrap of reported (wrapped) headings."""
    out, offset, prev = [], 0.0, samples[0][1]
    for t, y in samples:
        d = y - prev
        if d > math.pi:
            offset -= 2 * math.pi
        elif d < -math.pi:
            offset += 2 * math.pi
        prev = y
        out.append((t, y + offset))
    return out


def stand_pose_deviation(joints):
    """Worst |angle| among the joints that must stay in the stand pose."""
    worst, name = 0.0, ""
    for j in STAND_POSE_JOINTS:
        if abs(joints.get(j, 0.0)) > worst:
            worst, name = abs(joints[j]), j
    return worst, name


def main():
    mj_log0 = MUJOCO_LOG.stat().st_size if MUJOCO_LOG.exists() else 0
    ChannelFactoryInitialize(DOMAIN, IFACE)
    ChannelSubscriber("rt/odommodestate", SportModeState_).Init(
        lambda m: odom.update(x=m.position[0], y=m.position[1], yaw=m.imu_state.rpy[2]), 10)

    c = LocoClient()
    c.SetTimeout(5.0)
    c.Init()
    fails = []

    code, fsm = c.GetFsmId()
    print(f"1. GetFsmId -> code={code} fsm={fsm}")
    if code != 0:
        fails.append(f"GetFsmId returned {code}")

    # Known start pose, so the run means the same thing the tenth time as the
    # first. Also settles the base before anything is measured.
    r = reset_pose()
    time.sleep(0.5)
    print(f"1b. reset to ({r['x']:.3f},{r['y']:.3f},{math.degrees(r['yaw']):.1f}deg)")

    h0, img0 = snap_hash()
    x0, y0, yaw0 = pose()
    print(f"2. start pose=({x0:.3f},{y0:.3f},{math.degrees(yaw0):.1f}deg) frame={h0}")
    # The legs are decorative, but they must LOOK like a standing robot: they go
    # out verbatim on rt/lowstate. Feet buried in the floor kicked them out of
    # the stand pose on the first step and nothing pulled them back.
    dev0, worst0 = stand_pose_deviation(get("/state")["joints"])
    print(f"   stand pose: worst joint {worst0}={dev0:.4f} rad")
    if dev0 > STAND_POSE_TOL:
        fails.append(f"robot is not in the stand pose at start ({worst0}={dev0:.3f} rad)")

    print("3. Move forward 0.4 m/s for 2.5 s")
    drive(c, 0.4, 0.0, 0.0, 2.5)
    x1, y1, yaw1 = pose()
    # Project into the body frame the robot started in. Measuring world-frame
    # dy instead only works when the robot happens to face +x, so re-running
    # this check against an already-driven node reported a phantom sideways
    # drift equal to sin(start yaw) x the distance actually walked straight.
    fwd, lat = body_frame_delta(x0, y0, yaw0, x1, y1)
    print(
        f"   pose=({x1:.3f},{y1:.3f},{math.degrees(yaw1):.1f}deg)  "
        f"forward={fwd:.3f} m lateral={lat:+.3f} m"
    )
    # Signed, not hypot: walking a metre BACKWARDS is a failure, and a distance
    # magnitude cannot tell the two apart.
    if not 0.7 <= fwd <= 1.3:
        fails.append(f"forward travel {fwd:.3f} m outside [0.7, 1.3]")
    if abs(lat) > 0.05:
        fails.append(f"forward drifted sideways by {lat:.3f} m")

    print("4. Turn +90 deg (0.6 rad/s for ~2.6 s)")
    drive(c, 0.0, 0.0, 0.6, math.radians(90) / 0.6)
    _, _, yaw2 = pose()
    turned = math.degrees(angle_delta(yaw1, yaw2))
    print(f"   yaw={math.degrees(yaw2):.1f}deg  turned={turned:+.1f}deg")
    # Signed: a +90 deg command that produced -90 deg is the wrong-way-turn bug
    # from the first live run, and a magnitude check would have called it fine.
    if not 75 <= turned <= 105:
        fails.append(f"turn was {turned:+.1f} deg, expected ~+90")

    print("5. Strafe left 0.3 m/s for 1.5 s (body frame)")
    xb, yb, yawb = pose()
    drive(c, 0.0, 0.3, 0.0, 1.5)
    xa, ya, _ = pose()
    # Body frame again, and this time the DIRECTION is the point. A magnitude
    # check passes a robot that strafed right, or that walked forward instead
    # of sideways -- exactly the confusions this check exists to catch.
    s_fwd, s_lat = body_frame_delta(xb, yb, yawb, xa, ya)
    print(f"   left={s_lat:+.3f} m forward={s_fwd:+.3f} m  d=({xa-xb:+.3f},{ya-yb:+.3f})")
    if not 0.25 <= s_lat <= 0.65:
        fails.append(f"strafe left {s_lat:+.3f} m outside [0.25, 0.65]")
    if abs(s_fwd) > 0.05:
        fails.append(f"strafe drifted forward/back by {s_fwd:+.3f} m")

    h1, img1 = snap_hash()
    print(f"6. frame after moving = {h1}")
    if h1 == h0:
        fails.append("head camera returned an identical frame after moving")

    print("7. WaveHand")
    c.WaveHand(False)
    time.sleep(1.2)
    st = get("/state")
    r_sh_roll = st["joints"]["right_shoulder_roll_joint"]
    r_sh_pitch = st["joints"]["right_shoulder_pitch_joint"]
    print(f"   right_shoulder pitch={r_sh_pitch:.3f} roll={r_sh_roll:.3f}")
    if abs(r_sh_pitch) < 0.2:
        fails.append(f"WaveHand did not raise the arm (pitch={r_sh_pitch:.3f})")
    time.sleep(3.5)
    st2 = get("/state")
    if abs(st2["joints"]["right_shoulder_pitch_joint"]) > 0.15:
        fails.append("arm did not return home after the wave")
    print(f"   after gesture pitch={st2['joints']['right_shoulder_pitch_joint']:.3f}")

    print("8. Damp() must refuse to translate")
    c.Damp()
    xd, yd, _ = pose()
    drive(c, 0.4, 0.0, 0.0, 1.0)
    xe, ye, _ = pose()
    if math.hypot(xe - xd, ye - yd) > 0.02:
        fails.append("robot translated while damped")
    print(f"   moved {math.hypot(xe-xd, ye-yd):.4f} m while damped")

    print("9. rt/odommodestate DDS topic")
    time.sleep(0.5)
    print(f"   subscriber saw {odom}")
    if not odom:
        fails.append("no SportModeState_ received on rt/odommodestate")
    elif abs(odom["x"] - xe) > 0.05:
        fails.append(f"odom topic x={odom['x']:.3f} disagrees with HTTP x={xe:.3f}")

    print("10. Sustained spin PAST +-180 deg (0.6 rad/s for ~7.3 s = 250 deg)")
    # The one turn that used to break the simulator. LocoState's yaw drives a
    # kp=20000 position actuator; when it was wrapped to (-pi, pi] the setpoint
    # stepped by 2*pi in one 2 ms tick at the crossing, QACC exploded and MuJoCo
    # reset mjData -- which also teleported the "measured" pose to the origin and
    # re-armed the velocity command on the fresh clock. A `turn 180` block or
    # scan_room with the default steps=8 hits this every run; a 90 deg turn never
    # does, which is why check 4 never caught it.
    c.Start()  # check 8 left us damped
    time.sleep(0.3)
    omega, spin_s = 0.6, math.radians(250) / 0.6
    raw = drive(c, 0.0, 0.0, omega, spin_s, sample=True)  # as REPORTED, wrapped
    samples = unwrap(raw)
    turned = math.degrees(samples[-1][1] - samples[0][1])
    worst_jump, worst_bound = 0.0, 1.0
    for (t_prev, y_prev), (t_now, y_now) in zip(samples, samples[1:]):
        # Bound each step by what the robot could possibly have done in the
        # wall time between two samples, plus slack for HTTP jitter.
        bound = 1.5 * (t_now - t_prev) + 0.20
        if abs(y_now - y_prev) / bound > worst_jump / worst_bound:
            worst_jump, worst_bound = abs(y_now - y_prev), bound
    # Count on the RAW samples: a wrap in the report is exactly what says the
    # robot really went past 180 deg (the unwrapped copy can never show one).
    crossings = sum(1 for a, b in zip(raw, raw[1:]) if abs(b[1] - a[1]) > math.pi)
    print(f"   turned={turned:.1f}deg over {len(raw)} samples, {crossings} report "
          f"wrap(s), worst step={worst_jump:.3f} rad (bound {worst_bound:.3f})")
    if not 215 <= turned <= 285:
        fails.append(f"spin turned {turned:.1f} deg, expected ~250")
    if worst_jump > worst_bound:
        fails.append(f"yaw jumped {worst_jump:.3f} rad in one sample "
                     f"(bound {worst_bound:.3f}) -- the heading is not continuous")
    if crossings != 1:
        fails.append(f"the spin crossed +-180 deg {crossings} times, expected once "
                     f"-- it proves nothing about the crossing")
    if max(abs(y) for _, y in raw) > math.pi + 1e-6:
        fails.append("reported yaw left (-pi, pi] -- odometry must report a wrapped heading")

    idle_s = ARGS.idle_s
    print(f"11. Stand still for {idle_s:.0f} s -- the pose must not sag")
    # With no rt/arm_sdk publisher the blend weight is 0 for the whole session,
    # which is Agent Mode's permanent state. If the fall-back target is read live
    # from qpos the actuators produce zero restoring torque and gravity drags the
    # upper body to its limits: waist_pitch pins in ~2 s and tilts the head camera
    # from the designed 15 deg down to ~45 deg, permanently.
    if idle_s > 0:
        c.StopMove()
        time.sleep(idle_s)
        joints = get("/state")["joints"]
        dev1, worst1 = stand_pose_deviation(joints)
        print(f"   worst joint {worst1}={dev1:.4f} rad "
              f"(waist_pitch={joints['waist_pitch_joint']:+.4f}, "
              f"waist_roll={joints['waist_roll_joint']:+.4f})")
        if dev1 > STAND_POSE_TOL:
            fails.append(f"pose sagged while idle ({worst1}={dev1:.3f} rad, "
                         f"tolerance {STAND_POSE_TOL})")
    else:
        print("   skipped (--idle-s 0)")

    print("12. MuJoCo instability log")
    grew = (MUJOCO_LOG.stat().st_size if MUJOCO_LOG.exists() else 0) - mj_log0
    if grew > 0:
        new = MUJOCO_LOG.read_text()[mj_log0:].strip()
        fails.append(f"MuJoCo logged instability during this run:\n      {new}")
    else:
        print(f"   {MUJOCO_LOG} unchanged ({mj_log0} bytes) -- no solver blow-up")

    print()
    if fails:
        print("FAIL:")
        for f in fails:
            print("  -", f)
        return 1
    print("ALL CHECKS PASSED")
    if FRAME_DIR:
        # Opt-in only: --frames <dir> dumps the two head-camera frames whose
        # difference check 6 asserts, so a human can look at what the robot saw.
        out = pathlib.Path(FRAME_DIR)
        out.mkdir(parents=True, exist_ok=True)
        for name, b64 in (("frame_before.jpg", img0), ("frame_after.jpg", img1)):
            (out / name).write_bytes(base64.b64decode(b64))
        print(f"wrote head-camera frames to {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
