#!/usr/bin/env python3
"""
@file isaac_gait_report.py
@description Reads the `[TASK-203]` lines a running Isaac wholebody sim prints and
    answers the question isaac_gait_probe.py structurally cannot: did the base
    actually travel, and did the feet make and break contact alternately?
@feature hardware

Written for TASK-203 step 2 ("the robot walks ... feet making and breaking
contact"). `isaac_gait_probe.py` drives the sim over DDS and reports joint
motion, but two things never reach the DDS wire:

* **Base translation.** `LowState_` carries no base pose, so a robot marching on
  the spot and a robot walking across the room produce identical wire traffic.
* **Foot contact.** `unitree_hg`'s `LowState_` has no `foot_force` field -- that
  is the `go` IDL. The probe's left/right knee correlation is only a proxy, and
  it cannot tell a gait from a robot lying on its side thrashing its knees.

Both are free from inside the sim: the wholebody scene already carries a
ContactSensor with `track_air_time=True`
(`move_cylinder_g1_29dof_dex3_hw_env_cfg.py:45`). The NeoDEM instrumentation in
`isaac_sim_patches/0004-*.patch` prints them; this script reads them back.

Usage:

    python isaac_gait_report.py <sim-log> [--from STEP] [--to STEP]

⚠ **Run the sim with `NEODEM_LOG_EVERY=5`.** The default 25-step interval is
2 Hz of simulated time, and the G1 steps at about 1.76 Hz -- so the default
*aliases the gait* and reports meaningless foot make/break cadences. This script
still prints the cadence when the sampling interval cannot resolve one -- the
duty-factor percentages beside it stay valid -- but flags it ALIASED so the
number is not read as a measurement.
"""
import argparse, math, re, sys

# The policy runs at 50 Hz of simulated time: decimation 4 x sim.dt 0.005.
# Every rate here is simulated time, never wall clock.
POLICY_HZ = 50.0
# 0004 logs every step while `n <= 5` regardless of NEODEM_LOG_EVERY, to catch a
# fall before the first action lands. Those samples are a different sampling rate
# from the rest of the run and must not be mixed into the interval estimate.
BOOT_TRANSIENT_STEPS = 5
# `yaw=` and `cmd=` are optional so this still reads logs from the first
# revision of the instrumentation, which had neither.
LINE = re.compile(
    r"\[TASK-203\] step=\s*(\d+) xy=\(([-+0-9.]+),([-+0-9.]+)\) "
    r"(?:yaw=([-+0-9.]+) )?"
    r"(?:cmd=\[([-+0-9.]+),([-+0-9.]+),([-+0-9.]+),([0-9.]+)\] )?"
    r"foot_fz=\[([-0-9.]+), ([-0-9.]+)\] air_t=\[([0-9.]+), ([0-9.]+)\] "
    r"contact_t=\[([0-9.]+), ([0-9.]+)\]")


def parse(path):
    rows = []
    with open(path, errors="replace") as fh:
        for ln in fh:
            m = LINE.search(ln)
            if m:
                g = m.groups()
                f = lambda v: float(v) if v is not None else None
                rows.append(dict(step=int(g[0]), x=float(g[1]), y=float(g[2]),
                                 yaw=f(g[3]),
                                 cvx=f(g[4]), cvy=f(g[5]), cwz=f(g[6]),
                                 lfz=float(g[8]), rfz=float(g[9]),
                                 lair=float(g[10]), rair=float(g[11]),
                                 lcon=float(g[12]), rcon=float(g[13])))
    return rows


def moving_window(rows, thresh=0.05):
    """The LONGEST CONTIGUOUS span of samples moving faster than `thresh` m/s.

    Isolating the sustained walk matters: a run is bracketed by a settle phase
    and a decel, and averaging those in drags the reported speed well below the
    commanded one for reasons that have nothing to do with the gait.

    "First fast sample to last fast sample" is NOT good enough and was wrong
    here: dropping the robot into its initial pose jolts the base above the
    threshold within the first handful of steps, so that anchor lands at step 1
    and the window swallows the entire settle phase. On the 2026-08-28 TASK-203
    run that reported 0.159 m/s against a 0.5 m/s command -- a 68 % "shortfall"
    that was purely an artefact of the window. The longest contiguous run picks
    out the walk itself.
    """
    segs, cur = [], []
    for a, b in zip(rows, rows[1:]):
        dt = (b["step"] - a["step"]) / POLICY_HZ
        fast = dt > 0 and math.hypot(b["x"] - a["x"], b["y"] - a["y"]) / dt > thresh
        if fast:
            cur.append((a, b))
        elif cur:
            segs.append(cur); cur = []
    if cur:
        segs.append(cur)
    if not segs:
        return None
    best = max(segs, key=lambda s: s[-1][1]["step"] - s[0][0]["step"])
    return best[0][0]["step"], best[-1][1]["step"]


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("log", help="sim stdout log containing [TASK-203] lines")
    ap.add_argument("--from", dest="lo", type=int, default=None)
    ap.add_argument("--to", dest="hi", type=int, default=None)
    # Default None, NOT 0.5: the command the policy saw is in the log (that is what
    # the `cmd=` field of patch 0004 is for), so read it rather than assume it. An
    # assumed 0.5 silently mislabels every run driven at any other velocity --
    # including a turn-in-place run, where the honest --vx 0 used to divide by zero.
    ap.add_argument("--vx", type=float, default=None,
                    help="the commanded vx, for comparison. Default: read from the "
                         "log's cmd= field, falling back to 0.5 for logs without one.")
    a = ap.parse_args()

    if (a.lo is None) != (a.hi is None):
        ap.error("--from and --to must be given together (or neither, to auto-detect)")

    rows = parse(a.log)
    if not rows:
        print(f"no [TASK-203] lines in {a.log} -- was the sim run with the "
              f"0004 instrumentation patch applied?")
        return 2
    print(f"parsed {len(rows)} samples, steps {rows[0]['step']}..{rows[-1]['step']}")

    # The MODE, not the min: the instrumentation logs every step for the first
    # few (to catch a fall before the first action is applied), so `min` reports
    # a 1-step interval for any run and would silently disable the aliasing
    # guard below -- the one check that stops a 2 Hz sampler from reporting a
    # confident, wrong cadence for a 1.7 Hz gait.
    #
    # Those boot-transient samples are dropped before taking the mode rather than
    # relied on being outvoted. 0004 logs every step while `n <= 5` and then every
    # NEODEM_LOG_EVERY steps, so a short run carries five 1-step deltas against only
    # a handful of real ones and the mode comes out 1 -- reinstating, for exactly the
    # runs most likely to be a quick check, the silent guard-disabling this comment
    # says the mode prevents. Ties break high for the same reason: claiming a faster
    # sampler than the log actually has is the failure that matters here.
    body = [r for r in rows if r["step"] > BOOT_TRANSIENT_STEPS] or rows
    deltas = [b["step"] - a_["step"] for a_, b in zip(body, body[1:]) if b["step"] > a_["step"]]
    interval = max(set(deltas), key=lambda d: (deltas.count(d), d)) if deltas else 1
    sample_hz = POLICY_HZ / interval
    print(f"log interval {interval} steps = {sample_hz:.0f} Hz of simulated time")

    if a.lo is None or a.hi is None:
        win = moving_window(rows)
        if win is None:
            # Not necessarily a failure: a turn-in-place phase is commanded at
            # vx = 0 and is SUPPOSED to stay put, so point at the override rather
            # than just declining. The foot-contact block is the whole report for
            # such a run, and it needs an explicit window to reach.
            print("\nthe base never moved faster than 0.05 m/s -- no travelling "
                  "window to auto-detect.")
            print("  If this was a turn in place, pass the phase explicitly: "
                  f"--from {rows[0]['step']} --to {rows[-1]['step']}")
            return 1
        lo, hi = win
        print(f"auto-detected moving window: steps {lo}..{hi} "
              f"(override with --from/--to)")
    else:
        lo, hi = a.lo, a.hi
    w = [r for r in rows if lo <= r["step"] <= hi]
    if len(w) < 3:
        print("too few samples in the window"); return 2
    dur = (w[-1]["step"] - w[0]["step"]) / POLICY_HZ

    # What the policy actually saw in this window, straight from the log. This is
    # the whole point of 0004 logging `cmd=`: attributing a window to a commanded
    # phase by counting steps from when a test script started drifts with real-time
    # factor, and got the sign of the yaw result backwards once already.
    cmds = [(r["cvx"], r["cvy"], r["cwz"]) for r in w if r["cvx"] is not None]
    cmd_vx = max(set(c[0] for c in cmds), key=[c[0] for c in cmds].count) if cmds else None
    cmd_wz = max(set(c[2] for c in cmds), key=[c[2] for c in cmds].count) if cmds else None
    vx = a.vx if a.vx is not None else (cmd_vx if cmd_vx is not None else 0.5)
    if cmds:
        distinct = sorted(set(cmds))
        print(f"commanded in window : vx={cmd_vx:+.2f} wz={cmd_wz:+.2f}"
              + (f"  ({len(distinct)} distinct commands -- the window spans more than "
                 f"one phase, narrow it with --from/--to)" if len(distinct) > 1 else ""))
        if a.vx is not None and cmd_vx is not None and abs(a.vx - cmd_vx) > 1e-6:
            print(f"  ⚠ --vx {a.vx:g} disagrees with the logged command {cmd_vx:+.2f}; "
                  f"using {a.vx:g} as you asked")

    arc = sum(math.hypot(b["x"] - a_["x"], b["y"] - a_["y"]) for a_, b in zip(w, w[1:]))
    disp = math.hypot(w[-1]["x"] - w[0]["x"], w[-1]["y"] - w[0]["y"])
    print(f"\n--- BASE TRANSLATION ({dur:.1f} s of simulated time) ---")
    print(f"  path length        : {arc:6.2f} m")
    print(f"  straight-line       : {disp:6.2f} m")
    # Guarded: a turn-in-place phase is commanded at vx = 0, and "percent of zero"
    # is not a number. It used to raise ZeroDivisionError here, after printing the
    # two lines above and before the foot-contact block -- i.e. it took out exactly
    # the half of the report a turn run is read for.
    rel = f"{100 * (arc / dur - vx) / vx:+.0f}%" if abs(vx) > 1e-9 else "n/a"
    print(f"  mean ground speed  : {arc/dur:6.3f} m/s   (commanded {vx:.3f}, {rel})")

    # BASE HEADING, from the `yaw=` field 0004 logs. This is the primary heading
    # measurement and the only one that means anything for a turn: course over
    # ground is undefined when the robot turns in place (there is no ground track
    # to take a bearing along), which is precisely the case under test.
    #
    # Accumulated per-sample and unwrapped, not differenced end to end: yaw is an
    # atan2 output on (-pi, pi], so a run that turns through the wrap -- anything
    # past a half turn, which -45 deg/s reaches in four seconds -- reads back as a
    # small rotation the other way if you subtract the endpoints.
    yaws = [r["yaw"] for r in w if r["yaw"] is not None]
    if len(yaws) == len(w) and len(yaws) >= 2:
        dyaw = 0.0
        for p_, c_ in zip(yaws, yaws[1:]):
            dyaw += (c_ - p_ + math.pi) % (2 * math.pi) - math.pi
        rate = math.degrees(dyaw) / dur
        cmd_note = ""
        if cmd_wz is not None:
            # send_commands_keyboard.py publishes -yaw_vel, so a positive wz on the
            # wire is a LEFT turn and should raise yaw.
            cmd_note = (f", commanded {cmd_wz:+.2f} -> {math.degrees(cmd_wz):+.1f} deg/s"
                        f", ratio {rate / math.degrees(cmd_wz):+.2f}"
                        if abs(cmd_wz) > 1e-9 else ", commanded 0.00 (should hold heading)")
        print(f"  base heading       : {math.degrees(dyaw):+.1f} deg over the window "
              f"= {rate:+.2f} deg/s{cmd_note}")
    else:
        print("  base heading       : n/a (log has no yaw= field -- pre-0004 "
              "instrumentation, or an older revision of it)")

    # Course over ground, for a translating run only: it is the bearing of the
    # ground track, so it says how far a straight `walk` bends, which is what makes
    # a `goto` block miss. Estimated over a whole stride at each end rather than
    # from one sample pair -- the pelvis sways laterally within every stride, and a
    # single-sample bearing on a swaying base is dominated by that sway.
    if disp > 0.05:
        span = max(1, min(len(w) // 3, int(round(POLICY_HZ / interval))))
        h0 = math.atan2(w[span]["y"] - w[0]["y"], w[span]["x"] - w[0]["x"])
        h1 = math.atan2(w[-1]["y"] - w[-1 - span]["y"], w[-1]["x"] - w[-1 - span]["x"])
        turn = (h1 - h0 + math.pi) % (2 * math.pi) - math.pi
        print(f"  course over ground : {math.degrees(h0):+.1f} deg -> {math.degrees(h1):+.1f} deg "
              f"= {math.degrees(turn):+.1f} deg ({math.degrees(turn)/dur:+.2f} deg/s drift)")
    else:
        print(f"  course over ground : n/a (base moved {disp:.2f} m -- no ground "
              f"track to take a bearing along)")

    n = len(w)
    lair = sum(1 for r in w if r["lair"] > 0)
    rair = sum(1 for r in w if r["rair"] > 0)
    both = sum(1 for r in w if r["lair"] > 0 and r["rair"] > 0)
    dbl = sum(1 for r in w if r["lair"] == 0 and r["rair"] == 0)
    one = sum(1 for r in w if (r["lair"] > 0) != (r["rair"] > 0))
    print(f"\n--- FOOT CONTACT (n={n}) ---")
    print(f"  left airborne      : {100*lair/n:5.1f}%")
    print(f"  right airborne     : {100*rair/n:5.1f}%")
    print(f"  exactly one        : {100*one/n:5.1f}%   <- alternating stance")
    print(f"  double support     : {100*dbl/n:5.1f}%")
    print(f"  both airborne      : {100*both/n:5.1f}%   <- flight phase "
          f"({'walk' if both == 0 else 'run'})")

    def trans(key):
        c, prev = 0, None
        for r in w:
            cur = r[key] > 0
            if prev is not None and cur != prev:
                c += 1
            prev = cur
        return c
    tl, tr = trans("lair"), trans("rair")
    # Nyquist: resolving an f Hz gait needs samples faster than 2f. Report the
    # cadence only when the log interval can actually carry it.
    cad_l, cad_r = tl / 2 / dur, tr / 2 / dur
    print(f"\n  left  make/break   : {tl:4d} -> {cad_l:.2f} Hz")
    print(f"  right make/break   : {tr:4d} -> {cad_r:.2f} Hz")
    # Compare the SAMPLE RATE against a plausible gait frequency, never against
    # the cadence just measured. Testing `sample_hz < 4 * measured` is circular
    # and silently passes: aliasing drags the measured cadence down, which makes
    # an inadequate sampler look adequate. Measured on 2026-08-28, same walk,
    # same sim -- 10 Hz sampling gave 1.72 Hz (matching the DDS probe's
    # independent 1.73 Hz knee cadence to 1 %); 2 Hz sampling gave 0.27 Hz and
    # raised no warning under the old test.
    #
    # The G1 walks at roughly 1.7 Hz, so resolving it needs well above 3.4 Hz;
    # 8 Hz is the floor this asks for, i.e. NEODEM_LOG_EVERY <= 6.
    MIN_SAMPLE_HZ = 8.0
    if sample_hz < MIN_SAMPLE_HZ:
        print(f"  ⚠ ALIASED: sampling at {sample_hz:.0f} Hz cannot resolve a ~1.7 Hz gait "
              f"(need >= {MIN_SAMPLE_HZ:.0f} Hz). The two cadence lines above are "
              f"meaningless -- re-run the sim with NEODEM_LOG_EVERY=5.")
        print(f"    (The duty-factor percentages above are NOT aliased and stay valid: "
              f"they are per-sample occupancies, not rates.)")

    # A turn-in-place phase is commanded at vx = 0 and is not being asked to travel,
    # so the translation half of the verdict does not apply to it. Judging it as a
    # failed walk would call the one measurement the open left/right-turn defect
    # needs a "DOES NOT WALK" and exit non-zero on a run that did exactly what it
    # was told.
    stepping = one > 0 and both == 0
    if abs(vx) < 1e-9:
        print(f"\n=== {'STEPS IN PLACE' if stepping else 'DOES NOT STEP'} ===   "
              f"(vx = 0: no travel commanded, so this is a stance verdict, not a walk one)")
        return 0 if stepping else 1
    # `arc` is a path length and carries no sign, so comparing it against a signed
    # command is only meaningful for a forward walk; abs() keeps a backwards command
    # from making the speed test vacuously true.
    walked = arc / dur > 0.5 * abs(vx) and stepping
    print(f"\n=== {'WALKS' if walked else 'DOES NOT WALK'} ===")
    return 0 if walked else 1


if __name__ == "__main__":
    sys.exit(main())
