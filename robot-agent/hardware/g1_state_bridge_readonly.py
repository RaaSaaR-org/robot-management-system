#!/usr/bin/env python3
"""
g1_state_bridge_readonly.py — READ-ONLY DDS→ZMQ state bridge for the Unitree G1.

Runs on any host attached to the robot's 192.168.123.0/24 segment — either the
onboard PC2 (192.168.123.164) or a workstation NIC in that LAN (DDS discovery
is L2 multicast, so both see `rt/lowstate` equally). Subscribes via the Unitree
SDK2 (DDS) and republishes over ZMQ PUB on port 6001, using the exact JSON wire
format of lerobot's `run_g1_server.py` for `rt/lowstate` — so the existing
g1_sidecar.py read path parses it unchanged. When the bridge runs on the
workstation, point the sidecar at it with G1_LOWSTATE_ENDPOINT=tcp://127.0.0.1:6001.

TASK-184 additions (all READ-ONLY subscriptions, same PUB socket):
  • rt/dex3/left/state + rt/dex3/right/state (unitree_hg HandState_) ≤ 10 Hz each
  • BMS topic (--bms-topic, default rt/lf/bmsstate; unitree_hg BmsState_) pass-through
  • odometry topic (--odom-topic, default rt/odommodestate; unitree_go
    SportModeState_) pass-through
  Every ZMQ message is one JSON object {"topic": <dds topic>, "data": {...}}.
  Each extra feed is OPTIONAL: a missing IDL type or silent topic only disables
  that one feed with a log line — the bridge still runs on lowstate alone.
  Fields the IDL lacks are OMITTED, never zero-filled (contract: no fabricated
  sensor values).

WHY THIS FILE EXISTS — the stock bridge (lerobot run_g1_server.py) is NOT safe
for a telemetry-only stage:
  • it loops MotionSwitcherClient.ReleaseMode() at startup until NO motion mode
    is active — a standing robot loses its balance controller and collapses;
  • it opens a rt/lowcmd DDS publisher plus a ZMQ command socket (port 6000).

This bridge has NO write capability whatsoever:
  • no MotionSwitcherClient — the active motion mode is never touched
  • no ChannelPublisher — this process cannot emit a single DDS command
  • no command socket — port 6000 is never opened
Subscribing to rt/lowstate, rt/dex3/*/state, BMS and odometry is passive; it is
safe to run while the robot is standing under its built-in controller.

Run on the workstation (verified against a physical G1 EDU 4, 2026-07-03):
  # venv with Python <=3.10 (cyclonedds 0.10.2 has no cp311+ wheels), pyzmq,
  # numpy, and the pinned unitree_sdk2_python repo on PYTHONPATH
  PYTHONPATH=C:/Unitree/unitree_sdk2_python python g1_state_bridge_readonly.py --iface Ethernet

Robot-less loopback test (mock publisher from C:\\Unitree\\g1-sensor-toolkit):
  python mock_robot_publisher.py --domain 9            # terminal 1 (no --interface)
  python g1_state_bridge_readonly.py --domain 9        # terminal 2 (no --iface)

Run on PC2 (alternative — NOT factory-ready: this PC2 image ships without
unitree_sdk2py/pyzmq and has no internet; offline install is nontrivial since
cyclonedds 0.10.2 publishes no aarch64 wheels):
  scp g1_state_bridge_readonly.py unitree@192.168.123.164:~/
  ssh unitree@192.168.123.164 'python3 g1_state_bridge_readonly.py --iface eth0'

@status lowstate path verified read-only against real hardware (2026-07-03,
        ~50 Hz); dex3/BMS/odom paths loopback-verified against the mock
        publisher (2026-07-12) — real-hardware topic rates/units still pending.
"""

import argparse
import base64
import json
import threading
import time
from typing import Any, Callable, Optional

import zmq
from unitree_sdk2py.core.channel import ChannelFactoryInitialize, ChannelSubscriber
from unitree_sdk2py.idl.unitree_hg.msg.dds_ import LowState_ as hg_LowState

# Optional IDL imports — each feed degrades independently. The bridge must keep
# running on rt/lowstate alone when an IDL type is missing from the pinned SDK.
try:
    from unitree_sdk2py.idl.unitree_hg.msg.dds_ import HandState_ as hg_HandState
except ImportError:
    hg_HandState = None  # Dex3 hand feed disabled
try:
    # G1 battery — unitree_hg BmsState_ (fields: soc, current[mA], soh,
    # cell_vol[40][mV], bmsvoltage[3][mV], temperature[12], cycle).
    from unitree_sdk2py.idl.unitree_hg.msg.dds_ import BmsState_ as hg_BmsState
except ImportError:
    hg_BmsState = None  # BMS feed disabled
try:
    from unitree_sdk2py.idl.unitree_go.msg.dds_ import SportModeState_ as go_SportModeState
except ImportError:
    go_SportModeState = None  # odometry feed disabled

kTopicLowState = "rt/lowstate"
kTopicLeftHand = "rt/dex3/left/state"
kTopicRightHand = "rt/dex3/right/state"
DEFAULT_BMS_TOPIC = "rt/lf/bmsstate"
DEFAULT_ODOM_TOPIC = "rt/odommodestate"
LOWSTATE_PORT = 6001
NUM_MOTORS = 35  # hg LowState motor slots (G1 body uses indices 0-28)
NUM_HAND_MOTORS = 7  # Dex3-1 motors per hand
HAND_MAX_HZ = 10.0  # per-hand publish cap (contract: hand states ≤ 10 Hz each)


# ---------------------------------------------------------------------------
# best-effort field coercion (never fabricate: return None when absent)
# ---------------------------------------------------------------------------


def _f(obj: Any, name: str) -> Optional[float]:
    """getattr → float, or None when the field is missing / non-numeric."""
    v = getattr(obj, name, None)
    if v is None:
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _flist(obj: Any, name: str) -> Optional[list]:
    """getattr → list[float], or None when missing / not a sequence."""
    v = getattr(obj, name, None)
    if v is None:
        return None
    try:
        return [float(x) for x in v]
    except (TypeError, ValueError):
        return None


def _favg(v: Any) -> Optional[float]:
    """Scalar-or-array temperature → single float (hg MotorState_ carries
    temperature as int16[2]); None when absent/empty."""
    if v is None:
        return None
    if isinstance(v, (list, tuple)):
        if not v:
            return None
        return float(sum(v) / len(v))
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


# ---------------------------------------------------------------------------
# per-topic message → dict converters (contract §1 wire shapes)
# ---------------------------------------------------------------------------


def lowstate_to_dict(msg: hg_LowState) -> dict:
    """Identical wire format to lerobot run_g1_server.py::lowstate_to_dict."""
    motor_states = []
    for i in range(min(NUM_MOTORS, len(msg.motor_state))):
        temp = msg.motor_state[i].temperature
        avg_temp = float(sum(temp) / len(temp)) if isinstance(temp, list) else float(temp)
        motor_states.append(
            {
                "q": float(msg.motor_state[i].q),
                "dq": float(msg.motor_state[i].dq),
                "tau_est": float(msg.motor_state[i].tau_est),
                "temperature": avg_temp,
            }
        )

    return {
        "motor_state": motor_states,
        "imu_state": {
            "quaternion": [float(x) for x in msg.imu_state.quaternion],
            "gyroscope": [float(x) for x in msg.imu_state.gyroscope],
            "accelerometer": [float(x) for x in msg.imu_state.accelerometer],
            "rpy": [float(x) for x in msg.imu_state.rpy],
            "temperature": float(msg.imu_state.temperature),
        },
        "wireless_remote": base64.b64encode(bytes(msg.wireless_remote)).decode("ascii"),
        "mode_machine": int(msg.mode_machine),
    }


def handstate_to_dict(msg: Any) -> dict:
    """unitree_hg HandState_ → contract dict. All fields best-effort getattr —
    sub-fields the IDL lacks are omitted, never zero-filled."""
    out: dict = {}

    raw_motors = getattr(msg, "motor_state", None)
    if raw_motors is not None:
        motors = []
        for i in range(min(NUM_HAND_MOTORS, len(raw_motors))):
            m = raw_motors[i]
            entry: dict = {}
            for key in ("q", "dq", "tau_est"):
                v = _f(m, key)
                if v is not None:
                    entry[key] = v
            temp = _favg(getattr(m, "temperature", None))
            if temp is not None:
                entry["temperature"] = temp
            motors.append(entry)
        out["motor_state"] = motors

    imu = getattr(msg, "imu_state", None)
    if imu is not None:
        imu_out: dict = {}
        for key in ("quaternion", "gyroscope", "accelerometer", "rpy"):
            v = _flist(imu, key)
            if v is not None:
                imu_out[key] = v
        t = _f(imu, "temperature")
        if t is not None:
            imu_out["temperature"] = t
        if imu_out:
            out["imu_state"] = imu_out

    press = getattr(msg, "press_sensor_state", None)
    if press is not None:
        pads = []
        for p in press:
            pad: dict = {}
            pressure = _flist(p, "pressure")
            if pressure is not None:
                pad["pressure"] = pressure
            temperature = _flist(p, "temperature")
            if temperature is not None:
                pad["temperature"] = temperature
            if pad:
                pads.append(pad)
        if pads:
            out["press_sensor_state"] = pads

    for key in ("power_v", "power_a"):
        v = _f(msg, key)
        if v is not None:
            out[key] = v

    return out


def bms_to_dict(msg: Any) -> dict:
    """unitree_hg BmsState_ → contract dict (at minimum soc). Unit conventions
    (assumed from the hg IDL's integer fields; the mock publisher in
    g1-sensor-toolkit/mock_robot_publisher.py publishes the SAME conventions):
      current      mA → A,     bmsvoltage[0] mV → V (pack voltage),
      cell_vol[i]  mV → V (trailing zero slots = unpopulated cells, trimmed),
      temperature  int16[12] °C → mean of the non-zero probes.
    """
    out: dict = {}
    soc = _f(msg, "soc")
    if soc is not None:
        out["soc"] = soc
    cur = _f(msg, "current")
    if cur is not None:
        out["current"] = cur / 1000.0  # mA → A
    volts = _flist(msg, "bmsvoltage")
    if volts and volts[0] > 0:
        out["voltage"] = volts[0] / 1000.0  # mV → V
    temps = _flist(msg, "temperature")
    if temps:
        nonzero = [t for t in temps if t != 0]
        if nonzero:
            out["temperature"] = sum(nonzero) / len(nonzero)
    soh = _f(msg, "soh")
    if soh is not None and soh > 0:
        out["soh"] = soh
    cyc = getattr(msg, "cycle", None)
    if cyc is not None:
        out["cycle"] = int(cyc)
    cells = _flist(msg, "cell_vol")
    if cells:
        while cells and cells[-1] == 0.0:  # trim unpopulated slots
            cells.pop()
        if cells:
            out["cell_vol"] = [c / 1000.0 for c in cells]  # mV → V
    return out


def odom_to_dict(msg: Any) -> dict:
    """unitree_go SportModeState_ → contract dict
    {"position":[3],"velocity":[3],"rpy":[3],"yaw_speed":f,"mode":int}."""
    out: dict = {}
    for key in ("position", "velocity"):
        v = _flist(msg, key)
        if v is not None:
            out[key] = v
    imu = getattr(msg, "imu_state", None)
    if imu is not None:
        rpy = _flist(imu, "rpy")
        if rpy is not None:
            out["rpy"] = rpy
    ys = _f(msg, "yaw_speed")
    if ys is not None:
        out["yaw_speed"] = ys
    mode = getattr(msg, "mode", None)
    if mode is not None:
        out["mode"] = int(mode)
    return out


# ---------------------------------------------------------------------------
# ZMQ fan-in: one PUB socket shared by all subscription threads
# ---------------------------------------------------------------------------


class _LockedSender:
    """zmq sockets are NOT thread-safe — serialize sends with a lock."""

    def __init__(self, sock: "zmq.Socket") -> None:
        self._sock = sock
        self._lock = threading.Lock()
        self.n_sent = 0

    def send(self, topic: str, data: dict) -> None:
        payload = json.dumps({"topic": topic, "data": data}).encode("utf-8")
        with self._lock:
            try:
                self._sock.send(payload, zmq.NOBLOCK)
                self.n_sent += 1
            except zmq.Again:
                pass  # no subscriber / tx buffer full — drop


def _pump(
    topic: str,
    idl_type: Any,
    to_dict: Callable[[Any], dict],
    sender: _LockedSender,
    max_hz: Optional[float] = None,
) -> None:
    """One READ-ONLY subscription loop. ChannelSubscriber.Read() blocks, so
    every topic gets its own thread. A dead/silent topic just means this loop
    never sends — the other feeds are unaffected."""
    try:
        sub = ChannelSubscriber(topic, idl_type)
        sub.Init()
    except Exception as e:  # noqa: BLE001
        print(f"[ReadOnlyBridge] {topic}: subscribe failed ({e}) — feed disabled", flush=True)
        return
    period = (1.0 / max_hz) if max_hz else 0.0
    last_sent = 0.0
    warned = False
    while True:
        msg = sub.Read()
        if msg is None:
            continue
        now = time.time()
        if period and now - last_sent < period:
            continue
        try:
            data = to_dict(msg)
        except Exception as e:  # noqa: BLE001
            if not warned:
                print(f"[ReadOnlyBridge] {topic}: convert failed ({e}) — dropping frames", flush=True)
                warned = True
            continue
        if not data:
            continue  # nothing extractable — omit rather than send an empty dict
        sender.send(topic, data)
        last_sent = now


def main() -> None:
    parser = argparse.ArgumentParser(description="READ-ONLY DDS→ZMQ state bridge for Unitree G1")
    parser.add_argument(
        "--iface",
        default="",
        help="network interface for DDS (omit/empty = let CycloneDDS pick — needed for loopback mock tests)",
    )
    parser.add_argument(
        "--domain",
        type=int,
        default=0,
        help="DDS domain (0 = real robot, 9 = mock tests; NEVER 1 — that is the simulator)",
    )
    parser.add_argument("--port", type=int, default=LOWSTATE_PORT, help="ZMQ PUB port (default: 6001)")
    parser.add_argument("--rate", type=float, default=50.0, help="max lowstate publish rate in Hz (default: 50)")
    parser.add_argument("--bms-topic", default=DEFAULT_BMS_TOPIC,
                        help=f"BMS DDS topic (default: {DEFAULT_BMS_TOPIC})")
    parser.add_argument("--odom-topic", default=DEFAULT_ODOM_TOPIC,
                        help=f"odometry DDS topic (default: {DEFAULT_ODOM_TOPIC})")
    args = parser.parse_args()

    if args.domain == 1:
        parser.error("--domain 1 is the SIMULATION domain — refusing (0 = real robot, 9 = mock)")

    # No interface → plain ChannelFactoryInitialize(domain): CycloneDDS picks
    # its default (incl. loopback), which the g1-sensor-toolkit mock tests use.
    if args.iface:
        ChannelFactoryInitialize(args.domain, args.iface)
    else:
        ChannelFactoryInitialize(args.domain)

    ctx = zmq.Context.instance()
    pub_sock = ctx.socket(zmq.PUB)
    pub_sock.bind(f"tcp://0.0.0.0:{args.port}")
    sender = _LockedSender(pub_sock)

    # Optional feeds first (daemon threads); lowstate runs in the main thread.
    optional_feeds = [
        (kTopicLeftHand, hg_HandState, handstate_to_dict, HAND_MAX_HZ, "unitree_hg HandState_"),
        (kTopicRightHand, hg_HandState, handstate_to_dict, HAND_MAX_HZ, "unitree_hg HandState_"),
        (args.bms_topic, hg_BmsState, bms_to_dict, None, "unitree_hg BmsState_"),
        (args.odom_topic, go_SportModeState, odom_to_dict, None, "unitree_go SportModeState_"),
    ]
    for topic, idl_type, to_dict, max_hz, idl_name in optional_feeds:
        if idl_type is None:
            print(f"[ReadOnlyBridge] {topic}: IDL {idl_name} unavailable — feed disabled", flush=True)
            continue
        threading.Thread(
            target=_pump, args=(topic, idl_type, to_dict, sender, max_hz), daemon=True
        ).start()
        cap = f"<={max_hz:g} Hz" if max_hz else "pass-through"
        print(f"[ReadOnlyBridge] {topic} ({idl_name}) -> zmq PUB :{args.port} ({cap})", flush=True)

    iface_label = args.iface or "<default>"
    print(
        f"[ReadOnlyBridge] rt/lowstate -> zmq PUB :{args.port} @ <={args.rate} Hz "
        f"(domain {args.domain}, iface {iface_label}) — NO command path exists in this process",
        flush=True,
    )

    lowstate_sub = ChannelSubscriber(kTopicLowState, hg_LowState)
    lowstate_sub.Init()
    state_period = 1.0 / args.rate
    last_sent = 0.0
    last_report = 0

    try:
        while True:
            msg = lowstate_sub.Read()
            if msg is None:
                continue
            now = time.time()
            if now - last_sent < state_period:
                continue
            sender.send(kTopicLowState, lowstate_to_dict(msg))
            last_sent = now
            if sender.n_sent - last_report >= 500:
                last_report = sender.n_sent
                print(f"[ReadOnlyBridge] {sender.n_sent} messages forwarded (all topics)", flush=True)
    except KeyboardInterrupt:
        print("[ReadOnlyBridge] shutting down", flush=True)
    finally:
        pub_sock.close(0)
        ctx.term()


if __name__ == "__main__":
    main()
