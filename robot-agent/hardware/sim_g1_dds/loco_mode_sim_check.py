"""
@file loco_mode_sim_check.py
@description Integration check for robot-mode control without the remote
             (TASK-398): a g1_sidecar.py with G1_WRITE_MODE=arm_sdk and
             G1_LOCO_ENABLED=fsm drives the MuJoCo DDS sim's sport service
             through limp -> stand -> balance, arms, and E-stops — while a
             passive DDS subscriber records every rt/arm_sdk frame.
@feature hardware

What it proves, in order:
   1. The sidecar measures the sim's FSM: /health base.mode == limp.
   2. /loco/move answers 403 (walking is impossible under the fsm gate).
   3. /arm in limp answers 409 not_in_balance.
   4. Balance straight from limp answers 409 bad_transition.
   5. Stand reaches FSM 4, confirmed; /arm is still 409; balance before the
      settle time answers 409 not_settled.
   6. Balance reaches FSM 500, confirmed; /arm answers 200 and the weight ramps.
   7. Stand while armed answers 409 arms_engaged.
   8. Damping the sim directly (its own /loco/fsm facade — "a remote") makes
      the sidecar disarm with reason left_balance within 1 s; the next /arm
      is 409.
   9. Back to balance, armed, then /estop: the rt/arm_sdk recorder sees the
      weight start falling BEFORE the sim's sport service applied
      SetFsmId(1); the reply says damped:true.
  10. /estop/reset leaves the FSM at 1; Stand then works again.

SIM ONLY. Refuses DDS domain 0 and any interface but loopback, and refuses a
sidecar whose /health reports another domain or another gate.

    python loco_mode_sim_check.py --domain 42 --iface lo \\
        --sim http://127.0.0.1:8782 --sidecar http://127.0.0.1:8792

with the sim started as
    python sim_node.py --domain 42 --iface lo --http-port 8782 --initial-fsm 1 --quiet
and the sidecar as
    G1_WRITE_MODE=arm_sdk G1_LOCO_ENABLED=fsm G1_DDS_DOMAIN=42 G1_DDS_IFACE=lo \\
    G1_SIDECAR_PORT=8792 G1_LOWSTATE_ENDPOINT=tcp://127.0.0.1:6999 \\
        python ../g1_sidecar.py

@status test
"""

import argparse
import json
import sys
import threading
import time
import urllib.error
import urllib.request

ELBOW = "left_elbow_joint"
ELBOW_IDX = 18


def http(method, url, body=None, timeout=12.0):
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(url, data=data, method=method,
                                 headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read())


class ArmSdkSpy:
    """Passive rt/arm_sdk subscriber: (wall time, weight) per frame."""

    def __init__(self):
        from unitree_sdk2py.core.channel import ChannelSubscriber
        from unitree_sdk2py.idl.unitree_hg.msg.dds_ import LowCmd_

        self.lock = threading.Lock()
        self.frames = []
        self.sub = ChannelSubscriber("rt/arm_sdk", LowCmd_)
        self.sub.Init(self._cb, 64)

    def _cb(self, msg):
        with self.lock:
            self.frames.append((time.time(), float(msg.motor_cmd[29].q)))

    def since(self, t0):
        with self.lock:
            return [f for f in self.frames if f[0] >= t0]


class ActionStreamer:
    """Keeps /action flowing at 50 Hz so the dead-man stays quiet."""

    def __init__(self, sidecar, target):
        self.sidecar = sidecar
        self.target = target
        self._stop = threading.Event()
        self._t = threading.Thread(target=self._run, daemon=True)
        self._t.start()

    def _run(self):
        while not self._stop.is_set():
            try:
                http("POST", self.sidecar + "/action", {ELBOW: self.target}, timeout=1.0)
            except Exception:  # noqa: BLE001 — a refused frame is fine here
                pass
            self._stop.wait(0.02)

    def stop(self):
        self._stop.set()
        self._t.join(2)


def wait_for(fn, timeout_s, every_s=0.05):
    deadline = time.monotonic() + timeout_s
    while True:
        value = fn()
        if value or time.monotonic() >= deadline:
            return value
        time.sleep(every_s)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--domain", type=int, required=True)
    ap.add_argument("--iface", default="lo")
    ap.add_argument("--sim", required=True)
    ap.add_argument("--sidecar", required=True)
    args = ap.parse_args()

    if args.domain == 0:
        raise SystemExit("REFUSING: domain 0 is the real robot")
    if args.iface not in ("lo", "lo0"):
        raise SystemExit("REFUSING: loopback only (got %r)" % args.iface)
    _, health = http("GET", args.sidecar + "/health")
    if health.get("dds_domain") != args.domain or health.get("write_mode") != "arm_sdk" \
            or (health.get("loco") or {}).get("gate") != "fsm":
        raise SystemExit("REFUSING: sidecar reports write_mode=%r dds_domain=%r gate=%r, "
                         "expected arm_sdk on %d with gate fsm"
                         % (health.get("write_mode"), health.get("dds_domain"),
                            (health.get("loco") or {}).get("gate"), args.domain))
    _, simh = http("GET", args.sim + "/health")
    if not simh.get("sim"):
        raise SystemExit("REFUSING: %s is not a sim node" % args.sim)

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

    def base():
        return http("GET", args.sidecar + "/health")[1]["base"]

    def mode(m):
        return http("POST", args.sidecar + "/loco/mode", {"mode": m})

    def arm():
        return http("POST", args.sidecar + "/arm", {"lease_generation": 1})

    def to_balance():
        s1, b1 = mode("stand")
        wait_for(lambda: base()["mode"] == "stand", 2.0)
        time.sleep(2.3)
        s2, b2 = mode("balance")
        return s1, b1, s2, b2

    # 1. measured limp
    b = wait_for(lambda: base() if base()["mode"] != "unknown" else None, 5.0) or base()
    check("1_measures_limp", b["mode"] == "limp" and b["fsm_id"] == 1
          and b["age_s"] is not None and b["age_s"] < 1.5,
          "base=%s" % json.dumps(b))

    # 2. walking is impossible
    status, reply = http("POST", args.sidecar + "/loco/move",
                         {"vx": 0.0, "vy": 0.0, "omega": 0.3, "duration_s": 1.0})
    check("2_move_403", status == 403 and reply.get("code") == "loco_move_disabled",
          "%s %s" % (status, reply.get("code")))

    # 3. no arming in limp
    status, reply = arm()
    check("3_arm_in_limp_409", status == 409 and reply.get("error") == "not_in_balance",
          "%s %s" % (status, reply.get("error")))

    # 4. limp -> balance is not a transition
    status, reply = mode("balance")
    check("4_balance_from_limp_409", status == 409 and reply.get("code") == "bad_transition",
          "%s %s from=%s" % (status, reply.get("code"), reply.get("from")))

    # 5. stand, confirmed; still no arming; balance before settling refused
    status, reply = mode("stand")
    check("5a_stand_confirmed", status == 200 and reply.get("fsm_id") == 4
          and reply.get("confirmed") is True,
          "%s fsm=%s took_ms=%s" % (status, reply.get("fsm_id"), reply.get("took_ms")))
    status, reply = arm()
    check("5b_arm_in_stand_409", status == 409 and reply.get("error") == "not_in_balance",
          "%s %s" % (status, reply.get("error")))
    status, reply = mode("balance")
    check("5c_balance_not_settled", status == 409 and reply.get("code") == "not_settled",
          "%s %s remaining=%s" % (status, reply.get("code"), reply.get("settle_remaining_s")))

    # 6. balance, then arm
    time.sleep(2.3)
    status, reply = mode("balance")
    check("6a_balance_confirmed", status == 200 and reply.get("fsm_id") == 500,
          "%s fsm=%s took_ms=%s" % (status, reply.get("fsm_id"), reply.get("took_ms")))
    t_arm = time.time()
    status, reply = arm()
    streamer = None
    if status == 200:
        _, st = http("GET", args.sim + "/state")
        elbow = next(j["position"] for j in st["joints"] if j["name"] == ELBOW)
        streamer = ActionStreamer(args.sidecar, elbow)
    time.sleep(1.8)
    frames = spy.since(t_arm)
    top = max((w for _, w in frames), default=0.0)
    check("6b_arm_ramps", status == 200 and top >= 0.999,
          "/arm %s, %d frames, max weight %.3f" % (status, len(frames), top))

    # 7. no mode change while armed
    status, reply = mode("stand")
    check("7_stand_while_armed_409", status == 409 and reply.get("code") == "arms_engaged",
          "%s %s" % (status, reply.get("code")))

    # 8. a "remote" damps the robot under us
    t_damp = time.monotonic()
    http("POST", args.sim + "/loco/fsm", {"id": 1})
    h = wait_for(lambda: (lambda x: x if x.get("last_disarm_reason") == "left_balance"
                          else None)(http("GET", args.sidecar + "/health")[1]), 2.0)
    took = time.monotonic() - t_damp
    check("8a_left_balance_disarms", bool(h) and took <= 1.0,
          "reason=%s after %.2fs" % ((h or {}).get("last_disarm_reason"), took))
    if streamer:
        streamer.stop()
    status, reply = arm()
    check("8b_rearm_refused", status == 409 and reply.get("error") == "not_in_balance",
          "%s %s" % (status, reply.get("error")))
    wait_for(lambda: http("GET", args.sidecar + "/health")[1].get("arm_state") == "disarmed", 3)

    # 9. balance again, arm, E-stop: disarm reaches the wire before the damp
    s1, _, s2, _ = to_balance()
    status, _ = arm()
    _, st = http("GET", args.sim + "/state")
    elbow = next(j["position"] for j in st["joints"] if j["name"] == ELBOW)
    streamer = ActionStreamer(args.sidecar, elbow)
    time.sleep(1.8)
    t_estop = time.time()
    estop_status, estop = http("POST", args.sidecar + "/estop", {})
    streamer.stop()
    time.sleep(0.3)
    falling = next((t for t, w in spy.since(t_estop) if w < 0.999), None)
    _, simh = http("GET", args.sim + "/health")
    damp_at = next((t for t, i in simh.get("fsm_history", []) if i == 1 and t >= t_estop), None)
    check("9a_rearmed_for_estop", s1 == 200 and s2 == 200 and status == 200,
          "stand %s, balance %s, arm %s" % (s1, s2, status))
    check("9b_disarm_before_damp", falling is not None and damp_at is not None
          and falling < damp_at,
          "first falling frame %+.4fs, SetFsmId(1) applied %+.4fs after /estop"
          % ((falling or t_estop) - t_estop, (damp_at or t_estop) - t_estop))
    check("9c_estop_reply", estop_status == 200 and estop.get("damped") is True
          and estop.get("damp_confirmed") is True and estop.get("latched") is True
          and estop.get("was_armed") is True,
          json.dumps({k: estop.get(k) for k in ("latched", "was_armed", "disarmed", "damped",
                                                "damp_confirmed", "damp_error")}))

    # 10. reset never stands the robot up; stand then works again
    http("POST", args.sidecar + "/estop/reset", {})
    time.sleep(1.0)
    _, simh = http("GET", args.sim + "/health")
    b = base()
    check("10a_reset_leaves_limp", simh.get("loco_fsm_id") == 1 and b["mode"] == "limp",
          "sim fsm %s, sidecar base %s" % (simh.get("loco_fsm_id"), b["mode"]))
    status, reply = mode("stand")
    check("10b_stand_after_reset", status == 200 and reply.get("fsm_id") == 4,
          "%s fsm=%s" % (status, reply.get("fsm_id")))
    mode("limp")

    print(json.dumps({"ok": ok, "results": results}, indent=1), flush=True)
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
