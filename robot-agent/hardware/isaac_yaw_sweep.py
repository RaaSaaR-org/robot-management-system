#!/usr/bin/env python3
"""
@file isaac_yaw_sweep.py
@description Drives a SYMMETRIC yaw-rate sweep at the Isaac wholebody sim and
    reports achieved turn rate against commanded, paired +/- so the asymmetry
    is visible in one table. Written for TASK-203 step 4.
@feature hardware

TASK-203 step 2 left one defect open: this policy turns RIGHT but not LEFT.
Commanding wz = -0.5 / -1.0 produces a turn (measured ratios 0.71-0.79);
commanding wz = +0.5 / +1.0 produces nothing at all, with 0.0% of samples
showing a foot airborne. Step 4 (`walk` / `turn` / `goto` end to end) cannot
close while a `goto` that needs a left turn is unsatisfiable.

Earlier evidence for that came from a hand-driven profile whose phase
boundaries were inferred by counting steps from script start -- which produced
exactly the wrong conclusion once before, until the sim log was made
self-describing. This tool exists so the experiment is repeatable and paired:
each magnitude is driven in BOTH directions inside a single run, back to back,
against one boot of one sim, so no cross-run drift can masquerade as asymmetry.

WHAT THIS CAN AND CANNOT SETTLE

It measures the OUTCOME (did the robot turn), not the CAUSE. It sees the wire,
not the policy's input. If the sweep shows the asymmetry, the next question --
does the positive command reach the policy intact and get ignored, or is it
lost in assembly -- needs instrumentation inside the sim, because nothing on
DDS can observe the observation vector.

    python isaac_yaw_sweep.py [--domain 1] [--hold 8] [--vx 0.0]

⚠ Publishes at 100 Hz and must keep doing so. The sim's command slot is
SELF-CLEARING: `compute_current_observations` reads the command and immediately
writes [0,0,0,0.8] back into the same slot, so a published command survives
exactly one policy step. The policy runs at 50 Hz, so anything slower than that
delivers a command that is zero most of the time -- which is what made an
earlier probe conclude the G1 could not walk at all. 100 Hz matches the
vendor's own send_commands_keyboard.py and leaves 2x margin. Do not lower it.
"""
import argparse
import math
import statistics
import sys
import threading
import time

from unitree_sdk2py.core.channel import (
    ChannelPublisher, ChannelSubscriber, ChannelFactoryInitialize)
from unitree_sdk2py.idl.std_msgs.msg.dds_ import String_
from unitree_sdk2py.idl.unitree_hg.msg.dds_ import LowState_

# See isaac_gait_probe.py: this sim does not use a real G1's quaternion order.
QUAT_ORDERS = {"wxyz": (0, 1, 2, 3), "xyzw": (3, 0, 1, 2), "scrambled": (2, 3, 0, 1)}

state = {"perm": QUAT_ORDERS["xyzw"], "phase": "boot"}
samples = []                      # (t, phase, yaw)
lock = threading.Lock()


def on_state(msg):
    f = list(msg.imu_state.quaternion)
    iw, ix, iy, iz = state["perm"]
    w, x, y, z = f[iw], f[ix], f[iy], f[iz]
    yaw = math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z))
    with lock:
        samples.append((time.time(), state["phase"], yaw))


def unwrap(seq):
    """Undo 2*pi wraps so a turn through +/-pi does not read as a huge jump."""
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


def rate_of(phase):
    """Least-squares yaw rate over a phase, in rad/s, plus its sample count.

    A least-squares slope rather than (last - first)/dt: the first samples of a
    phase still carry the previous phase's momentum, and an endpoint estimator
    weights exactly those two points fully.
    """
    with lock:
        rows = [(t, y) for t, p, y in samples if p == phase]
    if len(rows) < 12:
        return None, len(rows)
    ts = [t for t, _ in rows]
    ys = unwrap([y for _, y in rows])
    t0 = ts[0]
    xs = [t - t0 for t in ts]
    n = len(xs)
    mx, my = sum(xs) / n, sum(ys) / n
    den = sum((x - mx) ** 2 for x in xs)
    if den < 1e-9:
        return None, n
    return sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / den, n


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[1])
    ap.add_argument("--domain", type=int, default=1, help="DDS domain (1 = Isaac sim)")
    ap.add_argument("--hold", type=float, default=8.0, help="seconds per phase")
    ap.add_argument("--settle", type=float, default=4.0, help="seconds of zero between phases")
    ap.add_argument("--vx", type=float, default=0.0,
                    help="forward velocity held during each turn. 0.0 = turn in place. "
                         "The arc case (vx and wz together) measured best of all at 0.98, "
                         "so --vx 0.3 tests the mitigation step 4 proposes.")
    ap.add_argument("--height", type=float, default=0.8)
    ap.add_argument("--mags", default="0.2,0.5,1.0",
                    help="yaw magnitudes to sweep; each is driven + and -")
    ap.add_argument("--quat-order", choices=sorted(QUAT_ORDERS), default="xyzw")
    a = ap.parse_args()

    state["perm"] = QUAT_ORDERS[a.quat_order]
    mags = [float(m) for m in a.mags.replace(",", " ").split()]

    ChannelFactoryInitialize(a.domain)
    sub = ChannelSubscriber("rt/lowstate", LowState_)
    sub.Init(on_state, 10)
    pub = ChannelPublisher("rt/run_command/cmd", String_)
    pub.Init()

    def drive(name, wz, secs):
        state["phase"] = name
        cmd = [a.vx, 0.0, wz, a.height]
        print(f"[sweep] {name}: cmd={cmd} for {secs}s", flush=True)
        t0 = time.time()
        n = 0
        while time.time() - t0 < secs:
            pub.Write(String_(data=str(cmd)))
            n += 1
            time.sleep(0.01)          # 100 Hz -- see the module docstring. Do not raise.
        el = time.time() - t0
        if n / max(el, 1e-9) < 50.0:
            print(f"[sweep] ** published only {n/el:.0f} Hz in {name}; below the sim's "
                  f"50 Hz policy rate, so this phase is INVALID", flush=True)

    drive("boot", 0.0, a.settle + 4)
    # Alternate the sign within each magnitude, and alternate which sign leads
    # across magnitudes, so a monotonic drift in the sim cannot align with sign.
    order = []
    for i, m in enumerate(mags):
        pair = [(+m, f"pos{m}"), (-m, f"neg{m}")]
        if i % 2:
            pair.reverse()
        order.extend(pair)

    for wz, name in order:
        drive(name, wz, a.hold)
        drive(f"{name}_settle", 0.0, a.settle)

    with lock:
        total = len(samples)
    if total == 0:
        print("NO LOWSTATE RECEIVED -- sim not publishing on domain 1")
        return 2

    print(f"\nsamples: {total}")
    print("\n--- commanded vs achieved yaw rate ---")
    print(f"{'phase':<14} {'cmd wz':>8} {'measured':>10} {'ratio':>7} {'n':>6}")
    results = {}
    for wz, name in order:
        r, n = rate_of(name)
        if r is None:
            print(f"{name:<14} {wz:>8.2f} {'--':>10} {'--':>7} {n:>6}   too few samples")
            continue
        ratio = r / wz if abs(wz) > 1e-9 else float("nan")
        results[name] = (wz, r, ratio)
        print(f"{name:<14} {wz:>8.2f} {r:>10.3f} {ratio:>7.2f} {n:>6}")

    # Drift with zero commanded: the other open defect from step 2.
    dr, dn = rate_of("boot")
    if dr is not None:
        print(f"\nzero-command drift (boot phase): {math.degrees(dr):+.2f} deg/s "
              f"over {dn} samples")

    print("\n--- symmetry ---")
    verdict_asym = False
    for m in mags:
        p = results.get(f"pos{m}")
        q = results.get(f"neg{m}")
        if not p or not q:
            continue
        pr, nr = abs(p[2]), abs(q[2])
        worse, better = min(pr, nr), max(pr, nr)
        side = "LEFT (+)" if pr < nr else "RIGHT (-)"
        print(f"  |wz|={m}: +{p[2]:.2f} vs -{q[2]:.2f}", end="")
        if better > 0.3 and worse < 0.15:
            verdict_asym = True
            print(f"   ** ASYMMETRIC: {side} is dead")
        elif better > 1e-6 and worse / better < 0.5:
            verdict_asym = True
            print(f"   ** ASYMMETRIC: {side} is {worse/better:.0%} of the other")
        else:
            print("   symmetric")

    print()
    if verdict_asym:
        print("CONCLUSION: the asymmetry reproduces on the wire. This tool cannot say")
        print("whether the dead direction reaches the policy and is ignored, or is lost")
        print("before it gets there -- nothing on DDS can observe the observation vector.")
        print("Settle that with the in-sim log of the post-assembly command value.")
    else:
        print("CONCLUSION: no asymmetry in this run. If a previous run showed one,")
        print("something changed -- check the publish rate line above first.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
