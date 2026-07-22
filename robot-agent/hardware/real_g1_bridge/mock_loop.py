#!/usr/bin/env python3
"""
@file mock_loop.py
@description Robot-free validation loop for bridge.py on DDS domain 9.
@feature hardware/real_g1_bridge

Publishes synthetic rt/lowstate + rt/dex3/left/state + rt/dex3/right/state
with DISTINGUISHABLE per-joint values (every one of the 43 dims is unique),
serves a tiny local 31-dim zero-delta VLA stub over HTTP (the checked-out
vla-server's --stub mode is hardcoded to 6-dim SO-101, so it cannot be used),
and runs bridge.py as a subprocess against it (--domain 9 --no-iface
--mock-camera). Monitors subscribe to the three cmd topics the whole time.

Proves:
  1. GUARD  — bridge.py --arm WITHOUT G1_BRIDGE_ARMED=1 refuses to start (rc 2).
  2. DRY-RUN — state assembly is bit-correct in the CONTRACT 43-dim layout
     (the stub asserts every dim), would-be commands are LOGGED (cmd_tick
     JSON lines with 31-dim targets), >31-dim policy rows (navigate/
     base_height) are DISCARDED with a log line, and the cmd-topic monitors
     stay SILENT (no publisher is even created).
  3. ARMED (domain 9) — rt/arm_sdk LowCmd_ messages appear with correct
     targets on motors 12..14 / 15..28, the motor_cmd[29].q blend weight
     visibly ramps 0 -> 1 -> 0, and rt/dex3/*/cmd HandCmd_ messages carry the
     right q + RIS position-mode bytes.

Run (conda env env_isaaclab_51_unitree — cyclonedds + unitree_sdk2py + numpy):
    python mock_loop.py

Exit code 0 = all assertions passed.

@status new — this file IS the validation record for bridge.py's loopback leg.
"""

import json
import os
import subprocess
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
BRIDGE = os.path.join(HERE, "bridge.py")

DOMAIN = 9
STUB_PORT = 18031
STATE_DIM = 43
ACTION_DIM = 31
CHUNK = 16
NUM_BODY = 29
NUM_HAND = 7

# ---------------------------------------------------------------------------
# Distinguishable mock joint values — every dim unique, all inside the
# bridge's margin-shrunk joint limits so the zero-delta loop is clamp-free.
# ---------------------------------------------------------------------------
MOCK_BODY_Q = [round(0.001 * i, 6) for i in range(NUM_BODY)]   # 0.000 .. 0.028
MOCK_LH_Q = [0.05, 0.06, 0.07, -0.08, -0.09, -0.10, -0.11]
MOCK_RH_Q = [0.15, 0.16, -0.17, 0.18, 0.19, 0.20, 0.21]
EXPECT_STATE43 = MOCK_BODY_Q + MOCK_LH_Q + MOCK_RH_Q
assert len(EXPECT_STATE43) == STATE_DIM
assert len(set(EXPECT_STATE43)) == STATE_DIM, "mock values must be unique"

# zero-delta action row = the state slices the policy commands, CONTRACT order
# [L-arm 7 | R-arm 7 | L-hand 7 | R-hand 7 | waist 3]
ZERO_DELTA_ROW = EXPECT_STATE43[15:43] + EXPECT_STATE43[12:15]
assert len(ZERO_DELTA_ROW) == ACTION_DIM


# ---------------------------------------------------------------------------
# Tiny 31-dim VLA stub (vla-server /predict wire contract)
# ---------------------------------------------------------------------------
class StubState:
    def __init__(self):
        self.lock = threading.Lock()
        self.extra_dims = False      # phase A: append navigate+base_height dims
        self.predicts = 0
        self.layout_ok = None        # None = no predict yet
        self.mismatch = None


STUB = StubState()


class StubHandler(BaseHTTPRequestHandler):
    def log_message(self, *a):  # silence per-request noise
        pass

    def _json(self, code, obj):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/health":
            self._json(200, {"status": "ok", "stub": True})
        elif self.path == "/config":
            self._json(200, {"model": "mock31", "action_dim": ACTION_DIM,
                             "chunk_size": CHUNK, "cameras": ["ego_view"]})
        else:
            self._json(404, {"error": "not found"})

    def do_POST(self):
        n = int(self.headers.get("Content-Length", 0))
        raw = self.rfile.read(n) if n else b"{}"
        if self.path == "/reset":
            self._json(200, {"status": "reset"})
            return
        if self.path != "/predict":
            self._json(404, {"error": "not found"})
            return
        req = json.loads(raw)
        state = req.get("state", [])
        with STUB.lock:
            STUB.predicts += 1
            # --- assert the 43-dim CONTRACT layout, dim by dim -------------
            ok = len(state) == STATE_DIM
            mismatch = None
            if ok:
                for i, (got, want) in enumerate(zip(state, EXPECT_STATE43)):
                    if abs(got - want) > 1e-6:
                        ok = False
                        mismatch = {"index": i, "got": got, "want": want}
                        break
            else:
                mismatch = {"len": len(state)}
            if STUB.layout_ok is None or STUB.layout_ok:
                STUB.layout_ok = ok
                if not ok:
                    STUB.mismatch = mismatch
            extra = STUB.extra_dims
        row = list(ZERO_DELTA_ROW)
        if extra:
            # emulate the PolicyServer's navigate_command(3)+base_height(1)
            # dims leaking through — bridge must DISCARD + log them
            row = row + [0.0, 0.0, 0.0, 0.76]
        self._json(200, {"actions": [row] * CHUNK, "inference_time_ms": 1.0})


# ---------------------------------------------------------------------------
# DDS: synthetic robot publisher + cmd-topic monitors (all on domain 9)
# ---------------------------------------------------------------------------
class CmdMonitor:
    """Counts messages on a cmd topic and keeps per-message extracts."""

    def __init__(self, name):
        self.name = name
        self.lock = threading.Lock()
        self.count = 0
        self.records = []

    def snapshot(self):
        with self.lock:
            return self.count, list(self.records)


def start_dds(stop_event):
    from unitree_sdk2py.core.channel import (
        ChannelFactoryInitialize, ChannelPublisher, ChannelSubscriber,
    )
    from unitree_sdk2py.idl.unitree_hg.msg.dds_ import LowState_, LowCmd_, HandState_, HandCmd_
    from unitree_sdk2py.idl.default import (
        unitree_hg_msg_dds__LowState_,
        unitree_hg_msg_dds__HandState_,
        unitree_hg_msg_dds__MotorState_,
    )
    from unitree_sdk2py.utils.crc import CRC

    ChannelFactoryInitialize(DOMAIN)

    # --- synthetic state messages ------------------------------------------
    crc = CRC()
    low = unitree_hg_msg_dds__LowState_()
    while len(low.motor_state) < NUM_BODY:
        low.motor_state.append(unitree_hg_msg_dds__MotorState_())
    for i in range(NUM_BODY):
        low.motor_state[i].q = MOCK_BODY_Q[i]
    low.mode_machine = 4

    lh = unitree_hg_msg_dds__HandState_()
    rh = unitree_hg_msg_dds__HandState_()
    for hand, values in ((lh, MOCK_LH_Q), (rh, MOCK_RH_Q)):
        while len(hand.motor_state) < NUM_HAND:
            hand.motor_state.append(unitree_hg_msg_dds__MotorState_())
        for i in range(NUM_HAND):
            hand.motor_state[i].q = values[i]

    pub_low = ChannelPublisher("rt/lowstate", LowState_)
    pub_low.Init()
    pub_lh = ChannelPublisher("rt/dex3/left/state", HandState_)
    pub_lh.Init()
    pub_rh = ChannelPublisher("rt/dex3/right/state", HandState_)
    pub_rh.Init()

    def publish_loop():
        n = 0
        while not stop_event.is_set():
            low.tick = n
            low.crc = crc.Crc(low)
            pub_low.Write(low)
            if n % 2 == 0:  # hands at ~50 Hz
                pub_lh.Write(lh)
                pub_rh.Write(rh)
            n += 1
            time.sleep(0.01)  # 100 Hz

    pub_thread = threading.Thread(target=publish_loop, daemon=True)
    pub_thread.start()

    # --- cmd-topic monitors (assert dry-run silence / armed traffic) -------
    mon_arm = CmdMonitor("rt/arm_sdk")
    mon_lh = CmdMonitor("rt/dex3/left/cmd")
    mon_rh = CmdMonitor("rt/dex3/right/cmd")

    def on_arm(msg):
        with mon_arm.lock:
            mon_arm.count += 1
            mon_arm.records.append({
                "t": time.time(),
                "weight": float(msg.motor_cmd[29].q),
                "q12": float(msg.motor_cmd[12].q),
                "q15": float(msg.motor_cmd[15].q),
                "q28": float(msg.motor_cmd[28].q),
                "kp15": float(msg.motor_cmd[15].kp),
                "kp19": float(msg.motor_cmd[19].kp),
                "kp12": float(msg.motor_cmd[12].kp),
                "kp0": float(msg.motor_cmd[0].kp),   # leg — must stay 0
                "mode0": int(msg.motor_cmd[0].mode),  # leg — must stay 0
            })

    def make_hand_cb(mon):
        def cb(msg):
            with mon.lock:
                mon.count += 1
                mon.records.append({
                    "t": time.time(),
                    "q": [float(mc.q) for mc in msg.motor_cmd],
                    "mode": [int(mc.mode) for mc in msg.motor_cmd],
                    "kp": [float(mc.kp) for mc in msg.motor_cmd],
                })
        return cb

    subs = []
    s = ChannelSubscriber("rt/arm_sdk", LowCmd_)
    s.Init(on_arm, 64)
    subs.append(s)
    s = ChannelSubscriber("rt/dex3/left/cmd", HandCmd_)
    s.Init(make_hand_cb(mon_lh), 64)
    subs.append(s)
    s = ChannelSubscriber("rt/dex3/right/cmd", HandCmd_)
    s.Init(make_hand_cb(mon_rh), 64)
    subs.append(s)

    return subs, (mon_arm, mon_lh, mon_rh)


# ---------------------------------------------------------------------------
# Bridge subprocess runner
# ---------------------------------------------------------------------------
def run_bridge(extra_args, armed_env=False, timeout=90):
    env = dict(os.environ)
    env.pop("G1_BRIDGE_ARMED", None)
    if armed_env:
        env["G1_BRIDGE_ARMED"] = "1"
    cmd = [sys.executable, BRIDGE,
           "--domain", str(DOMAIN), "--no-iface", "--mock-camera",
           "--vla-server", f"http://127.0.0.1:{STUB_PORT}",
           "--log-every", "1"] + extra_args
    proc = subprocess.run(cmd, env=env, stdin=subprocess.DEVNULL,
                          capture_output=True, text=True, timeout=timeout)
    return proc


# ---------------------------------------------------------------------------
# Assertions
# ---------------------------------------------------------------------------
RESULTS = []


def check(name, ok, detail=""):
    RESULTS.append((name, bool(ok), detail))
    print(f"  {'PASS' if ok else 'FAIL'}  {name}" + (f" — {detail}" if detail else ""),
          flush=True)


def parse_json_lines(stdout, type_name):
    out = []
    for line in stdout.splitlines():
        line = line.strip()
        if not line.startswith("{"):
            continue
        try:
            obj = json.loads(line)
        except json.JSONDecodeError:
            continue
        if obj.get("type") == type_name:
            out.append(obj)
    return out


def main() -> int:
    print(f"[mock_loop] DDS domain {DOMAIN}, stub on 127.0.0.1:{STUB_PORT}", flush=True)

    server = ThreadingHTTPServer(("127.0.0.1", STUB_PORT), StubHandler)
    threading.Thread(target=server.serve_forever, daemon=True).start()

    stop_event = threading.Event()
    subs, (mon_arm, mon_lh, mon_rh) = start_dds(stop_event)  # noqa: F841 (keep refs)
    time.sleep(1.0)  # let DDS discovery settle

    try:
        # ================= PHASE 0: arming guard ==========================
        print("\n[phase 0] --arm without G1_BRIDGE_ARMED=1 must refuse", flush=True)
        p0 = run_bridge(["--arm", "--max-ticks", "5"], armed_env=False)
        check("guard: rc==2 without env var", p0.returncode == 2,
              f"rc={p0.returncode}")
        check("guard: refusal message printed",
              "REFUSING to start" in p0.stdout, p0.stdout.strip().splitlines()[:1])

        # ================= PHASE A: dry-run ===============================
        print("\n[phase A] dry-run: state layout + cmd logs + cmd-topic silence",
              flush=True)
        with STUB.lock:
            STUB.extra_dims = True   # exercise the navigate/base_height discard
            STUB.predicts = 0
            STUB.layout_ok = None
        a_arm0, _ = mon_arm.snapshot()
        a_lh0, _ = mon_lh.snapshot()
        a_rh0, _ = mon_rh.snapshot()

        pa = run_bridge(["--max-ticks", "40", "--hz", "30",
                         "--exec-horizon", "8"])
        time.sleep(0.5)  # drain any in-flight DDS deliveries

        check("dry-run: bridge exited cleanly (rc 0)", pa.returncode == 0,
              f"rc={pa.returncode} stderr_tail={pa.stderr.strip()[-200:]!r}")
        with STUB.lock:
            check("dry-run: stub /predict was called", STUB.predicts >= 1,
                  f"predicts={STUB.predicts}")
            check("dry-run: 43-dim state layout bit-correct (all dims asserted)",
                  STUB.layout_ok is True, f"mismatch={STUB.mismatch}")
        ticks = parse_json_lines(pa.stdout, "cmd_tick")
        check("dry-run: cmd_tick logs emitted", len(ticks) >= 30,
              f"n={len(ticks)}")
        check("dry-run: logged targets are 31-dim",
              all(len(t["targets31"]) == ACTION_DIM for t in ticks))
        check("dry-run: logged as armed=false",
              all(t["armed"] is False for t in ticks))
        # zero-delta stub + distinguishable state: target must equal the
        # commanded state slices (proves the 31-dim ACTION ordering too)
        tgt = ticks[-1]["targets31"]
        check("dry-run: action ordering L-arm/R-arm/L-hand/R-hand/waist",
              max(abs(a - b) for a, b in zip(tgt, ZERO_DELTA_ROW)) < 1e-4,
              f"tgt[0]={tgt[0]} want={ZERO_DELTA_ROW[0]}; "
              f"tgt[28]={tgt[28]} want={ZERO_DELTA_ROW[28]}")
        disc = parse_json_lines(pa.stdout, "discarded_dims")
        check("dry-run: navigate/base_height dims discarded + logged",
              len(disc) >= 1 and disc[0]["n_extra"] == 4,
              f"n={len(disc)}")
        a_arm1, _ = mon_arm.snapshot()
        a_lh1, _ = mon_lh.snapshot()
        a_rh1, _ = mon_rh.snapshot()
        check("dry-run: rt/arm_sdk SILENT", a_arm1 - a_arm0 == 0,
              f"msgs={a_arm1 - a_arm0}")
        check("dry-run: rt/dex3/left/cmd SILENT", a_lh1 - a_lh0 == 0,
              f"msgs={a_lh1 - a_lh0}")
        check("dry-run: rt/dex3/right/cmd SILENT", a_rh1 - a_rh0 == 0,
              f"msgs={a_rh1 - a_rh0}")

        # ================= PHASE B: armed on domain 9 =====================
        print("\n[phase B] armed (domain 9): arm_sdk + dex3 cmds + weight ramp",
              flush=True)
        with STUB.lock:
            STUB.extra_dims = False   # clean 31-dim contract rows
        b_arm0, _ = mon_arm.snapshot()
        b_lh0, _ = mon_lh.snapshot()
        b_rh0, _ = mon_rh.snapshot()

        pb = run_bridge(["--arm", "--ramp-seconds", "1.0",
                         "--max-ticks", "120", "--hz", "30",
                         "--exec-horizon", "8"], armed_env=True)
        time.sleep(0.8)  # drain the ramp-down tail

        check("armed: bridge exited cleanly (rc 0)", pb.returncode == 0,
              f"rc={pb.returncode} stderr_tail={pb.stderr.strip()[-200:]!r}")
        b_arm1, arm_recs = mon_arm.snapshot()
        b_lh1, lh_recs = mon_lh.snapshot()
        b_rh1, rh_recs = mon_rh.snapshot()
        arm_recs = arm_recs[b_arm0:]
        lh_recs = lh_recs[b_lh0:]
        rh_recs = rh_recs[b_rh0:]

        check("armed: rt/arm_sdk messages received", len(arm_recs) >= 100,
              f"msgs={len(arm_recs)}")
        if arm_recs:
            weights = [r["weight"] for r in arm_recs]
            check("armed: weight ramp starts near 0", weights[0] <= 0.2,
                  f"first={weights[0]:.3f}")
            check("armed: weight ramp reaches 1.0", max(weights) >= 0.99,
                  f"max={max(weights):.3f}")
            check("armed: weight ramped back to 0 on exit", weights[-1] <= 0.01,
                  f"last={weights[-1]:.4f}")
            mid = arm_recs[len(arm_recs) // 2]
            check("armed: waist_yaw target on motor 12",
                  abs(mid["q12"] - MOCK_BODY_Q[12]) < 1e-3,
                  f"q12={mid['q12']:.4f} want={MOCK_BODY_Q[12]}")
            check("armed: L-shoulder-pitch target on motor 15",
                  abs(mid["q15"] - MOCK_BODY_Q[15]) < 1e-3,
                  f"q15={mid['q15']:.4f} want={MOCK_BODY_Q[15]}")
            check("armed: R-wrist-yaw target on motor 28",
                  abs(mid["q28"] - MOCK_BODY_Q[28]) < 1e-3,
                  f"q28={mid['q28']:.4f} want={MOCK_BODY_Q[28]}")
            check("armed: gains kp(shoulder)=80 kp(wrist)=40 kp(waist)=300",
                  mid["kp15"] == 80.0 and mid["kp19"] == 40.0 and mid["kp12"] == 300.0,
                  f"kp15={mid['kp15']} kp19={mid['kp19']} kp12={mid['kp12']}")
            check("armed: legs untouched (motor 0 mode=0 kp=0 — never commanded)",
                  mid["mode0"] == 0 and mid["kp0"] == 0.0,
                  f"mode0={mid['mode0']} kp0={mid['kp0']}")
        check("armed: rt/dex3/left/cmd messages received", len(lh_recs) >= 100,
              f"msgs={len(lh_recs)}")
        check("armed: rt/dex3/right/cmd messages received", len(rh_recs) >= 100,
              f"msgs={len(rh_recs)}")
        if lh_recs and rh_recs:
            lmid = lh_recs[len(lh_recs) // 2]
            rmid = rh_recs[len(rh_recs) // 2]
            check("armed: left-hand q targets correct (7 joints)",
                  max(abs(a - b) for a, b in zip(lmid["q"], MOCK_LH_Q)) < 1e-3,
                  f"q={['%.3f' % v for v in lmid['q']]}")
            check("armed: right-hand q targets correct (7 joints)",
                  max(abs(a - b) for a, b in zip(rmid["q"], MOCK_RH_Q)) < 1e-3,
                  f"q={['%.3f' % v for v in rmid['q']]}")
            want_modes = [(i & 0x0F) | (0x01 << 4) for i in range(NUM_HAND)]
            check("armed: Dex3 RIS position-mode bytes (id | 1<<4)",
                  lmid["mode"] == want_modes and rmid["mode"] == want_modes,
                  f"modes={lmid['mode']}")
            check("armed: Dex3 gains kp=1.5 kd from config",
                  all(abs(v - 1.5) < 1e-6 for v in lmid["kp"]))
        exits = parse_json_lines(pb.stdout, "exit")
        check("armed: bridge logged clean exit with ramp-down",
              len(exits) == 1 and "ramp-down complete" in pb.stdout,
              exits and exits[0].get("reason"))

    finally:
        stop_event.set()
        server.shutdown()

    n_pass = sum(1 for _, ok, _ in RESULTS if ok)
    n_fail = len(RESULTS) - n_pass
    print(f"\n[mock_loop] {n_pass}/{len(RESULTS)} assertions passed, "
          f"{n_fail} failed", flush=True)
    if n_fail:
        for name, ok, detail in RESULTS:
            if not ok:
                print(f"  FAILED: {name} — {detail}", flush=True)
    return 0 if n_fail == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
