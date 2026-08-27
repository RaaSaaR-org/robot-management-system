#!/usr/bin/env python3
"""
@file isaac_gait_probe.py
@description Does the G1 actually walk in the Isaac wholebody sim? Subscribes
    rt/lowstate, drives rt/run_command/cmd through an idle -> forward -> idle
    profile, and reports the three acceptance criteria: knees and ankles off
    their limits, feet alternating (make/break contact), base upright.
@feature hardware

Read-only apart from the velocity command it publishes. Written for TASK-204
step 3; the failure it found is TASK-223.

Run from the `unitree_sim_env6` env with CYCLONEDDS_HOME set, against a sim
started per isaac_sim_patches/README.md:

    python isaac_gait_probe.py [--domain 1] [--vx 0.5] [--secs 20]

`imu_state.rpy` is all zeros in this sim -- attitude is derived from
`imu_state.quaternion` (w, x, y, z), whose norm is checked so a genuine fall
can be told apart from bad data.
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
samples = []        # (t, [12 q], rpy)
lock = threading.Lock()
phase = {"name": "boot"}

def on_state(msg):
    q = [msg.motor_state[i].q for i in range(12)]
    w, x, y, z = msg.imu_state.quaternion
    roll  = math.atan2(2*(w*x + y*z), 1 - 2*(x*x + y*y))
    pitch = math.asin(max(-1.0, min(1.0, 2*(w*y - z*x))))
    with lock:
        samples.append((time.time(), phase["name"], q, roll, pitch))

def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--domain", type=int, default=1, help="DDS domain (1 = Isaac sim)")
    ap.add_argument("--vx", type=float, default=0.5, help="forward velocity command, m/s")
    ap.add_argument("--secs", type=float, default=20.0, help="seconds to hold the command")
    ap.add_argument("--height", type=float, default=0.8, help="height command")
    a = ap.parse_args()
    ChannelFactoryInitialize(a.domain)
    sub = ChannelSubscriber("rt/lowstate", LowState_); sub.Init(on_state, 10)
    pub = ChannelPublisher("rt/run_command/cmd", String_); pub.Init()

    def drive(name, cmd, secs):
        phase["name"] = name
        print(f"[probe] {name}: cmd={cmd} for {secs}s", flush=True)
        t0 = time.time()
        while time.time() - t0 < secs:
            pub.Write(String_(data=str(cmd)))
            time.sleep(0.05)

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
    def crossings(vs):
        m = sum(vs)/len(vs); c = 0
        for a, b in zip(vs, vs[1:]):
            if (a-m) * (b-m) < 0: c += 1
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
    rolls = [s[3] for s in fwd]; pitches = [s[4] for s in fwd]
    print(f"roll  {min(rolls):+.3f} .. {max(rolls):+.3f} rad")
    print(f"pitch {min(pitches):+.3f} .. {max(pitches):+.3f} rad")
    upright = max(abs(min(rolls)), abs(max(rolls)), abs(min(pitches)), abs(max(pitches))) < 0.5

    print("\n=== VERDICT ===")
    ok_limits = not any(pinned)
    print(f"knees/ankles off their limits : {'PASS' if ok_limits else 'FAIL'}")
    print(f"feet alternating (antiphase)  : {'PASS' if corr < -0.3 else 'FAIL'}")
    print(f"base upright (|rp| < 0.5 rad) : {'PASS' if upright else 'FAIL'}")
    return 0 if (ok_limits and corr < -0.3 and upright) else 1

sys.exit(main())
