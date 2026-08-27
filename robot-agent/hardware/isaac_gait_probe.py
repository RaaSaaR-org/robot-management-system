#!/usr/bin/env python3
"""
@file isaac_gait_probe.py
@description Does the G1 actually walk in the Isaac wholebody sim? Subscribes
    rt/lowstate, drives rt/run_command/cmd through an idle -> forward -> idle
    profile, and reports three proxies for the acceptance criteria: knees and
    ankles off their limits, left/right knee antiphase, base upright.
@feature hardware

Read-only apart from the velocity command it publishes. Written for TASK-204
step 3; the failure it found is TASK-223.

Run from the `unitree_sim_env6` env with CYCLONEDDS_HOME set, against a sim
started per isaac_sim_patches/README.md:

    python isaac_gait_probe.py [--domain 1] [--vx 0.5] [--secs 20]
    python isaac_gait_probe.py --no-command          # publish nothing at all

`imu_state.rpy` is all zeros in this sim -- attitude is derived from
`imu_state.quaternion`, whose norm is checked so a genuine fall can be told
apart from bad data.

⚠ **The element order of that quaternion is not (w, x, y, z) in this sim, and
reading it as if it were is what produced TASK-223's "it cannot stand".**
`unitree_sim_isaaclab/dds/g1_robot_dds.py:101` writes the field as
`imu_array[[4, 5, 6, 3]]`, with the comment `#[x,y,z,w]` -- deliberately
**(x, y, z, w)**, not the real robot's (w, x, y, z). On top of that, the
Isaac Lab 3.0 port left `tasks/common_observations/g1_29dof_state.py:370` at
`ensure_quat_w_first(quat, assume_w_first=True)`, which was right on Isaac Lab
2.x and is wrong on 3.0, where `body_link_pose_w[..., 3:7]` is already
(x, y, z, w). The two permutations compose into a scramble under which a
*perfectly upright, motionless* base reads `|roll| = pi` -- so the "base
upright" verdict below failed unconditionally, for any robot, on any
hypothesis. `isaac_sim_patches/0002-task223-obs-scales-and-step0-probe.patch`
fixes the sim side; `--quat-order` selects how this probe reads the wire:

    xyzw  (default)  the sim with 0002 applied, i.e. the vendor's own contract
    wxyz             a real G1
    scrambled        the sim *without* 0002 -- reproduces the broken reading

Nothing here can detect the order for you: every permutation of a unit
quaternion is still a unit quaternion, which is exactly why the "norm is
exactly 1.0000" observation gave false reassurance. The first raw sample is
printed so the value can be checked by eye against the sim's own
`[TASK-223] roll=... pitch=...` line, which 0002 logs from inside.

Two things this probe does NOT measure, so that its output is not over-read:

* **Foot contact.** `unitree_hg`'s `LowState_` has no `foot_force` field (that
  is the `go` IDL), so nothing here observes make/break contact. The antiphase
  line is a left/right *knee-deviation correlation* -- a robot lying on its
  side thrashing its knees in antiphase scores the same as one that is walking.
  Read it only together with the upright line. Real contact needs the sim's own
  contact sensor (`scene.contact_forces`), from inside the sim.
* **Anything in simulated time.** Every rate printed here is wall clock.
"""
import argparse
import math, sys, time, threading
from collections import defaultdict
from unitree_sdk2py.core.channel import (
    ChannelPublisher, ChannelSubscriber, ChannelFactoryInitialize)
from unitree_sdk2py.idl.std_msgs.msg.dds_ import String_
from unitree_sdk2py.idl.unitree_hg.msg.dds_ import LowState_

LEG = [
    ("L_hip_pitch", -2.5307, 2.8798), ("L_hip_roll", -0.5236, 2.9671),
    ("L_hip_yaw",   -2.7576, 2.7576), ("L_knee",     -0.087267, 2.8798),
    ("L_ank_pitch", -0.87267, 0.5236), ("L_ank_roll", -0.2618, 0.2618),
    ("R_hip_pitch", -2.5307, 2.8798), ("R_hip_roll", -2.9671, 0.5236),
    ("R_hip_yaw",   -2.7576, 2.7576), ("R_knee",     -0.087267, 2.8798),
    ("R_ank_pitch", -0.87267, 0.5236), ("R_ank_roll", -0.2618, 0.2618),
]
EPS = 0.02          # "at the limit" tolerance, rad
samples = []        # (t, phase, [12 q], roll, pitch)
lock = threading.Lock()
phase = {"name": "boot"}
raw_quat = {"first": None}

# How to read the four floats of `imu_state.quaternion` as (w, x, y, z).
# See the module docstring: this sim does not use the real robot's order, and
# the Isaac Lab 3.0 port adds a second permutation on top of the vendor's.
QUAT_ORDERS = {
    "wxyz":      (0, 1, 2, 3),   # a real G1
    "xyzw":      (3, 0, 1, 2),   # this sim, with isaac_sim_patches/0002 applied
    "scrambled": (2, 3, 0, 1),   # this sim WITHOUT 0002 -- the TASK-223 reading
}
quat_order = {"perm": QUAT_ORDERS["xyzw"]}

def on_state(msg):
    q = [msg.motor_state[i].q for i in range(12)]
    f = list(msg.imu_state.quaternion)
    iw, ix, iy, iz = quat_order["perm"]
    w, x, y, z = f[iw], f[ix], f[iy], f[iz]
    roll  = math.atan2(2*(w*x + y*z), 1 - 2*(x*x + y*y))
    pitch = math.asin(max(-1.0, min(1.0, 2*(w*y - z*x))))
    with lock:
        if raw_quat["first"] is None:
            raw_quat["first"] = f
        samples.append((time.time(), phase["name"], q, roll, pitch))

def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--domain", type=int, default=1, help="DDS domain (1 = Isaac sim)")
    ap.add_argument("--vx", type=float, default=0.5, help="forward velocity command, m/s")
    ap.add_argument("--secs", type=float, default=20.0, help="seconds to hold the command")
    ap.add_argument("--height", type=float, default=0.8, help="height command")
    ap.add_argument("--no-command", action="store_true",
                    help="publish nothing on rt/run_command/cmd -- observe the sim's "
                         "own default behaviour (TASK-223 test 1). --vx is ignored.")
    ap.add_argument("--quat-order", choices=sorted(QUAT_ORDERS), default="xyzw",
                    help="how to read imu_state.quaternion; see the module docstring. "
                         "xyzw = this sim with isaac_sim_patches/0002 applied (default), "
                         "wxyz = a real G1, scrambled = this sim without 0002.")
    a = ap.parse_args()
    quat_order["perm"] = QUAT_ORDERS[a.quat_order]
    print(f"[probe] reading imu_state.quaternion as --quat-order={a.quat_order}", flush=True)
    ChannelFactoryInitialize(a.domain)
    sub = ChannelSubscriber("rt/lowstate", LowState_); sub.Init(on_state, 10)
    pub = ChannelPublisher("rt/run_command/cmd", String_); pub.Init()

    def drive(name, cmd, secs):
        """Hold `cmd` for `secs`. `cmd is None` publishes nothing at all.

        Publishing [0,0,0,height] is NOT the same experiment as publishing
        nothing: the provider self-defaults to [0,0,0,0.8] only when no command
        has ever arrived, so a zero command still exercises the command path.
        TASK-223's test 1 is written as "with no velocity command", which needs
        --no-command.
        """
        phase["name"] = name
        print(f"[probe] {name}: cmd={cmd if cmd is not None else 'NONE (publishing nothing)'} "
              f"for {secs}s", flush=True)
        t0 = time.time()
        while time.time() - t0 < secs:
            if cmd is not None:
                pub.Write(String_(data=str(cmd)))
            time.sleep(0.05)

    if a.no_command:
        # One long observation window; there is no command to step through.
        drive("settle",  None, 8)
        drive("forward", None, a.secs)
        drive("stop",    None, 5)
    else:
        drive("settle",  [0.0,  0.0, 0.0, a.height], 8)
        drive("forward", [a.vx, 0.0, 0.0, a.height], a.secs)
        drive("stop",    [0.0,  0.0, 0.0, a.height], 5)

    with lock:
        data = list(samples)
    if not data:
        print("NO LOWSTATE RECEIVED -- sim not publishing on domain 1"); return 2

    fwd = [s for s in data if s[1] == "forward"]
    print(f"\nsamples: {len(data)} total, {len(fwd)} during forward")
    if fwd:
        dur = fwd[-1][0] - fwd[0][0]
        print(f"lowstate rate during forward: {len(fwd)/max(dur,1e-9):.1f} Hz")
    if len(fwd) < 50:
        print("too few forward samples to judge"); return 2

    print("\n--- leg joints during forward (the task's criterion) ---")
    print(f"{'joint':<12} {'min':>8} {'max':>8} {'range':>8} {'%at-limit':>10}")
    pinned = []
    for i, (nm, lo, hi) in enumerate(LEG):
        vs = [s[2][i] for s in fwd]
        mn, mx = min(vs), max(vs)
        at = sum(1 for v in vs if v <= lo + EPS or v >= hi - EPS) / len(vs) * 100
        flag = "  <-- PINNED" if at > 20 else ""
        pinned.append(at > 20)
        print(f"{nm:<12} {mn:>8.3f} {mx:>8.3f} {mx-mn:>8.3f} {at:>9.1f}%{flag}")

    # gait rhythm: zero-crossings of each knee about its own mean, and whether
    # left and right are in antiphase (alternating stance = feet swapping contact)
    print("\n--- gait rhythm ---")
    def crossings(vs, band_frac=0.10):
        """Count mean-crossings with a deadband, Schmitt-trigger style.

        A bare sign test about the mean counts every sample-to-sample wobble,
        so sensor jitter inflates the cadence without bound and small noise can
        be read as a "rhythm". A crossing only counts here once the signal has
        travelled `band_frac` of its own peak-to-peak range past the mean, so
        the reported cadence is a floor rather than an artefact.
        """
        m = sum(vs)/len(vs)
        band = (max(vs) - min(vs)) * band_frac
        if band <= 0:
            return 0, m
        c = 0
        side = 0                       # -1 below the band, +1 above, 0 inside
        for v in vs:
            if v > m + band and side <= 0:
                if side == -1: c += 1
                side = 1
            elif v < m - band and side >= 0:
                if side == 1: c += 1
                side = -1
        return c, m
    dur = fwd[-1][0] - fwd[0][0]
    lk = [s[2][3] for s in fwd]; rk = [s[2][9] for s in fwd]
    lc, lm = crossings(lk); rc, rm = crossings(rk)
    print(f"L_knee: {lc} crossings -> {lc/2/max(dur,1e-9):.2f} Hz cadence (mean {lm:.3f})")
    print(f"R_knee: {rc} crossings -> {rc/2/max(dur,1e-9):.2f} Hz cadence (mean {rm:.3f})")
    n = min(len(lk), len(rk))
    la = [v-lm for v in lk[:n]]; ra = [v-rm for v in rk[:n]]
    num = sum(a*b for a, b in zip(la, ra))
    den = math.sqrt(sum(a*a for a in la) * sum(b*b for b in ra)) or 1e-9
    corr = num/den
    print(f"L/R knee correlation: {corr:+.3f}  "
          f"({'ANTIPHASE - alternating steps' if corr < -0.3 else 'in phase / no alternation' if corr > 0.3 else 'weak'})")

    print("\n--- attitude over time (1 s buckets, all phases) ---")
    t0 = data[0][0]
    buckets = {}
    for t, ph, q, r, pi in data:
        k = int(t - t0)
        b = buckets.setdefault(k, [ph, 0.0, 0.0])
        b[1] = max(b[1], abs(r)); b[2] = max(b[2], abs(pi))
    fell_at = None
    for k in sorted(buckets):
        ph, r, pi = buckets[k]
        tilted = max(r, pi) > 0.5
        if tilted and fell_at is None:
            fell_at = (k, ph)
        print(f"  t={k:>3}s {ph:<8} |roll|<={r:.3f} |pitch|<={pi:.3f}{'   <-- TILTED >0.5' if tilted else ''}")
    print(f"first tilt beyond 0.5 rad: {'t=%ds during %s' % fell_at if fell_at else 'never - stayed upright'}")

    print("\n--- base attitude ---")
    fq = raw_quat["first"]
    if fq:
        n = math.sqrt(sum(v*v for v in fq))
        iw, ix, iy, iz = quat_order["perm"]
        print(f"first raw imu_state.quaternion (wire order) = "
              f"[{fq[0]:+.4f}, {fq[1]:+.4f}, {fq[2]:+.4f}, {fq[3]:+.4f}]  norm={n:.4f}")
        print(f"read as (w,x,y,z) = ({fq[iw]:+.4f}, {fq[ix]:+.4f}, {fq[iy]:+.4f}, {fq[iz]:+.4f})"
              f"   [--quat-order={a.quat_order}]")
        print("cross-check this against the sim's own '[TASK-223] roll=... pitch=...' line; "
              "a unit norm proves nothing about element order.")
    rolls = [s[3] for s in fwd]; pitches = [s[4] for s in fwd]
    print(f"roll  {min(rolls):+.3f} .. {max(rolls):+.3f} rad")
    print(f"pitch {min(pitches):+.3f} .. {max(pitches):+.3f} rad")
    upright = max(abs(min(rolls)), abs(max(rolls)), abs(min(pitches)), abs(max(pitches))) < 0.5

    print("\n=== VERDICT ===")
    ok_limits = not any(pinned)
    print(f"knees/ankles off their limits : {'PASS' if ok_limits else 'FAIL'}")
    print(f"L/R knee antiphase (proxy)    : {'PASS' if corr < -0.3 else 'FAIL'}"
          f"   [knee correlation, NOT foot contact -- see module docstring]")
    print(f"base upright (|rp| < 0.5 rad) : {'PASS' if upright else 'FAIL'}")
    if corr < -0.3 and not upright:
        print("NOTE: antiphase knees with a fallen base is thrashing, not a gait.")
    return 0 if (ok_limits and corr < -0.3 and upright) else 1

if __name__ == "__main__":
    sys.exit(main())
