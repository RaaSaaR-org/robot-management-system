"""
@file arm_sdk_sim_check.py
@description Integration check for the sidecar's rt/arm_sdk write path
             (TASK-391): a g1_sidecar.py in G1_WRITE_MODE=arm_sdk drives the
             MuJoCo DDS sim, and a passive DDS subscriber records every frame
             it puts on rt/arm_sdk.
@feature hardware

What it proves, in order:
  1. /action before /arm is refused (409 not_armed).
  2. /arm ramps the weight 0 -> 1 in ~1.5 s, starting at the MEASURED pose.
  3. A 3 s sinusoid on one shoulder moves the sim's shoulder; legs and waist
     stay where they were.
  4. /disarm ramps the weight 1 -> 0 in ~1 s and the publisher goes quiet.
  5. Dead-man: stop sending /action and the sidecar disarms by itself at ~1 s.
  6. (--sidecar-pid) SIGTERM while armed: weight reaches 0 before the process
     is gone.

SIM ONLY. Refuses DDS domain 0 and any interface but loopback, and refuses a
sidecar whose /health reports a different domain than the one given here.

    python arm_sdk_sim_check.py --domain 41 --iface lo \\
        --sim http://127.0.0.1:8781 --sidecar http://127.0.0.1:8791 \\
        [--sidecar-pid <pid>]

@status test
"""

import argparse
import json
import math
import os
import signal
import sys
import threading
import time
import urllib.error
import urllib.request

SHOULDER = "left_shoulder_pitch_joint"
SHOULDER_IDX = 15
LEGS = list(range(0, 12))
WAIST = [12, 13, 14]


def http(method, url, body=None, timeout=3.0):
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(url, data=data, method=method,
                                 headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read())


class ArmSdkSpy:
    """Passive rt/arm_sdk subscriber: (t, weight, q[0:29]) per frame."""

    def __init__(self):
        from unitree_sdk2py.core.channel import ChannelSubscriber
        from unitree_sdk2py.idl.unitree_hg.msg.dds_ import LowCmd_

        self.lock = threading.Lock()
        self.frames = []
        self.sub = ChannelSubscriber("rt/arm_sdk", LowCmd_)
        self.sub.Init(self._cb, 64)

    def _cb(self, msg):
        row = (time.monotonic(), float(msg.motor_cmd[29].q),
               [float(msg.motor_cmd[i].q) for i in range(29)])
        with self.lock:
            self.frames.append(row)

    def since(self, t0):
        with self.lock:
            return [f for f in self.frames if f[0] >= t0]


def sim_body(sim):
    _, st = http("GET", sim + "/state")
    by_name = {j["name"]: j["position"] for j in st["joints"]}
    from joints import BODY  # sim_g1_dds/joints.py — the SDK motor order
    return [by_name[n] for n in BODY]


def stream_actions(sidecar, seconds, target_fn, hz=50.0, sample=None):
    """POST /action at `hz` for `seconds`; target_fn(t) -> {joint: rad}."""
    t0 = time.monotonic()
    n = 0
    while True:
        t = time.monotonic() - t0
        if t >= seconds:
            return
        status, reply = http("POST", sidecar + "/action", target_fn(t))
        if status != 200:
            raise SystemExit("FAIL /action -> %s %s" % (status, reply))
        if sample is not None and n % 5 == 0:
            sample(t)
        n += 1
        time.sleep(max(0.0, t0 + n / hz - time.monotonic()))


def ramp_time(frames, rising):
    """Seconds from the first frame to the first frame at the end weight."""
    if not frames:
        return None
    end = 1.0 if rising else 0.0
    for t, w, _ in frames:
        if w == end:
            return t - frames[0][0]
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--domain", type=int, required=True)
    ap.add_argument("--iface", default="lo")
    ap.add_argument("--sim", required=True)
    ap.add_argument("--sidecar", required=True)
    ap.add_argument("--sidecar-pid", type=int, default=0)
    ap.add_argument("--amplitude", type=float, default=0.3)
    ap.add_argument("--freq", type=float, default=0.5)
    args = ap.parse_args()

    if args.domain == 0:
        raise SystemExit("REFUSING: domain 0 is the real robot")
    if args.iface not in ("lo", "lo0"):
        raise SystemExit("REFUSING: loopback only (got %r)" % args.iface)
    _, health = http("GET", args.sidecar + "/health")
    if health.get("write_mode") != "arm_sdk" or health.get("dds_domain") != args.domain:
        raise SystemExit("REFUSING: sidecar reports write_mode=%r dds_domain=%r, expected "
                         "arm_sdk on %d" % (health.get("write_mode"),
                                            health.get("dds_domain"), args.domain))
    _, simh = http("GET", args.sim + "/health")
    if not simh.get("sim"):
        raise SystemExit("REFUSING: %s is not a sim node" % args.sim)

    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    from unitree_sdk2py.core.channel import ChannelFactoryInitialize
    ChannelFactoryInitialize(args.domain, args.iface)
    spy = ArmSdkSpy()
    results = {}
    ok = True

    def check(name, cond, detail):
        nonlocal ok
        results[name] = {"pass": bool(cond), "detail": detail}
        ok = ok and bool(cond)
        print("%s %s — %s" % ("PASS" if cond else "FAIL", name, detail), flush=True)

    # 1. nothing before /arm
    time.sleep(0.5)
    status, reply = http("POST", args.sidecar + "/action", {SHOULDER: 0.0})
    check("action_before_arm_409", status == 409 and reply.get("error") == "not_armed",
          "%s %s" % (status, reply.get("error")))
    check("silent_before_arm", not spy.frames, "%d frames on rt/arm_sdk" % len(spy.frames))

    # 2. arm
    base = sim_body(args.sim)
    t_arm = time.monotonic()
    status, reply = http("POST", args.sidecar + "/arm", {"lease_generation": 1})
    check("arm_200", status == 200 and reply.get("armed") is True,
          "%s teleop_mode=%s hands=%s" % (status, reply.get("teleop_mode"), reply.get("hands")))
    hold = base[SHOULDER_IDX]
    stream_actions(args.sidecar, 1.8, lambda t: {SHOULDER: hold})
    up = spy.since(t_arm)
    first = up[0] if up else None
    seed_err = max(abs(a - b) for a, b in zip(first[2], base)) if first else None
    check("first_frame_is_measured_pose", first is not None and seed_err < 0.02,
          "max |q_frame0 - q_measured| = %s rad, weight0=%s"
          % (None if seed_err is None else round(seed_err, 4),
             None if first is None else round(first[1], 3)))
    tr = ramp_time(up, rising=True)
    check("arm_ramp_about_1_5s", tr is not None and 1.3 <= tr <= 1.7, "0->1 in %s s"
          % (None if tr is None else round(tr, 3)))

    # 3. sinusoid on one shoulder
    samples = []

    def sample(t):
        samples.append((t, sim_body(args.sim)))

    amp, f = args.amplitude, args.freq
    stream_actions(args.sidecar, 3.0,
                   lambda t: {SHOULDER: hold + amp * math.sin(2 * math.pi * f * t)},
                   sample=sample)
    sh = [q[SHOULDER_IDX] for _, q in samples]
    p2p = max(sh) - min(sh)
    leg_dev = max(abs(q[i] - base[i]) for _, q in samples for i in LEGS)
    waist_dev = max(abs(q[i] - base[i]) for _, q in samples for i in WAIST)
    check("shoulder_moves", p2p >= 0.6 * 2 * amp,
          "sim shoulder peak-to-peak %.3f rad (commanded %.3f)" % (p2p, 2 * amp))
    check("legs_do_not_move", leg_dev < 0.02, "max leg deviation %.4f rad" % leg_dev)
    # The frames hold the waist exactly (next check); what the sim's waist does
    # on top is its position actuators yielding to the arm's reaction torque —
    # measured ~0.025 rad for a 0.6 rad shoulder swing. A commanded waist
    # would follow the shoulder by far more than this bound.
    check("waist_does_not_move", waist_dev < 0.05, "max waist deviation %.4f rad" % waist_dev)
    sent_legs = max(abs(fr[2][i] - base[i]) for fr in spy.since(t_arm) for i in LEGS + WAIST)
    check("frames_carry_measured_legs_waist", sent_legs < 0.02,
          "max |frame - measured| over legs+waist = %.4f rad" % sent_legs)

    # 4. disarm
    t_dis = time.monotonic()
    status, reply = http("POST", args.sidecar + "/disarm", {})
    deadline = time.monotonic() + 3.0
    while time.monotonic() < deadline:
        _, h = http("GET", args.sidecar + "/health")
        if h.get("arm_state") == "disarmed":
            break
        time.sleep(0.05)
    down = spy.since(t_dis)
    td = ramp_time(down, rising=False)
    check("disarm_ramp_about_1s", td is not None and 0.8 <= td <= 1.2,
          "1->0 in %s s, sidecar arm_state=%s" % (None if td is None else round(td, 3),
                                                   h.get("arm_state")))
    time.sleep(0.5)
    n_before = len(spy.frames)
    time.sleep(0.5)
    check("quiet_after_disarm", len(spy.frames) == n_before and spy.frames[-1][1] == 0.0,
          "last weight %.3f, %d frames in the last 0.5 s"
          % (spy.frames[-1][1], len(spy.frames) - n_before))

    # 5. dead-man
    http("POST", args.sidecar + "/arm", {"lease_generation": 2})
    stream_actions(args.sidecar, 1.8, lambda t: {SHOULDER: hold})
    t_stop = time.monotonic()
    time.sleep(2.6)
    _, h = http("GET", args.sidecar + "/health")
    after = spy.since(t_stop)
    first_drop = next((t for t, w, _ in after if w < 1.0), None)
    zero_at = next((t for t, w, _ in after if w == 0.0), None)
    check("deadman_disarms",
          h.get("last_disarm_reason") == "deadman" and h.get("arm_state") == "disarmed"
          and first_drop is not None and 0.9 <= first_drop - t_stop <= 1.2
          and zero_at is not None and zero_at - t_stop <= 2.3,
          "ramp starts %.2fs and reaches 0 at %.2fs after the last /action (reason %s)"
          % ((first_drop or t_stop) - t_stop, (zero_at or t_stop) - t_stop,
             h.get("last_disarm_reason")))

    # 6. SIGTERM while armed
    if args.sidecar_pid:
        http("POST", args.sidecar + "/arm", {"lease_generation": 3})
        stream_actions(args.sidecar, 1.8, lambda t: {SHOULDER: hold})
        t_sig = time.monotonic()
        os.kill(args.sidecar_pid, signal.SIGTERM)
        gone_at = None
        while time.monotonic() - t_sig < 5.0:
            try:
                os.kill(args.sidecar_pid, 0)
            except ProcessLookupError:
                gone_at = time.monotonic()
                break
            time.sleep(0.02)
        time.sleep(0.2)
        after = spy.since(t_sig)
        zero_at = next((t for t, w, _ in after if w == 0.0), None)
        check("sigterm_ramps_to_zero_before_exit",
              zero_at is not None and gone_at is not None and zero_at <= gone_at
              and after[-1][1] == 0.0 and zero_at - t_sig <= 1.15,
              "weight 0 at +%s s, process gone at +%s s, last weight %s"
              % (None if zero_at is None else round(zero_at - t_sig, 3),
                 None if gone_at is None else round(gone_at - t_sig, 3),
                 after[-1][1] if after else None))

    print(json.dumps({"ok": ok, "results": results}, indent=1), flush=True)
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
