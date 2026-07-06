#!/usr/bin/env python3
"""
g1_state_bridge_readonly.py — READ-ONLY DDS→ZMQ state bridge for the Unitree G1.

Runs on any host attached to the robot's 192.168.123.0/24 segment — either the
onboard PC2 (192.168.123.164) or a workstation NIC in that LAN (DDS discovery
is L2 multicast, so both see `rt/lowstate` equally). Subscribes via the Unitree
SDK2 (DDS) and republishes over ZMQ PUB on port 6001, using the exact JSON wire
format of lerobot's `run_g1_server.py` — so the existing g1_sidecar.py read
path parses it unchanged. When the bridge runs on the workstation, point the
sidecar at it with G1_LOWSTATE_ENDPOINT=tcp://127.0.0.1:6001.

WHY THIS FILE EXISTS — the stock bridge (lerobot run_g1_server.py) is NOT safe
for a telemetry-only stage:
  • it loops MotionSwitcherClient.ReleaseMode() at startup until NO motion mode
    is active — a standing robot loses its balance controller and collapses;
  • it opens a rt/lowcmd DDS publisher plus a ZMQ command socket (port 6000).

This bridge has NO write capability whatsoever:
  • no MotionSwitcherClient — the active motion mode is never touched
  • no ChannelPublisher — this process cannot emit a single DDS command
  • no command socket — port 6000 is never opened
Subscribing to rt/lowstate is passive; it is safe to run while the robot is
standing under its built-in controller.

Run on the workstation (verified against a physical G1 EDU 4, 2026-07-03):
  # venv with Python <=3.10 (cyclonedds 0.10.2 has no cp311+ wheels), pyzmq,
  # numpy, and the pinned unitree_sdk2_python repo on PYTHONPATH
  PYTHONPATH=C:/Unitree/unitree_sdk2_python python g1_state_bridge_readonly.py --iface Ethernet

Run on PC2 (alternative — NOT factory-ready: this PC2 image ships without
unitree_sdk2py/pyzmq and has no internet; offline install is nontrivial since
cyclonedds 0.10.2 publishes no aarch64 wheels):
  scp g1_state_bridge_readonly.py unitree@192.168.123.164:~/
  ssh unitree@192.168.123.164 'python3 g1_state_bridge_readonly.py --iface eth0'

@status verified read-only against real hardware (2026-07-03, ~50 Hz lowstate).
"""

import argparse
import base64
import json
import time
from typing import Any

import zmq
from unitree_sdk2py.core.channel import ChannelFactoryInitialize, ChannelSubscriber
from unitree_sdk2py.idl.unitree_hg.msg.dds_ import LowState_ as hg_LowState

kTopicLowState = "rt/lowstate"
LOWSTATE_PORT = 6001
NUM_MOTORS = 35  # hg LowState motor slots (G1 body uses indices 0-28)


def lowstate_to_dict(msg: hg_LowState) -> dict[str, Any]:
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


def main() -> None:
    parser = argparse.ArgumentParser(description="READ-ONLY DDS→ZMQ state bridge for Unitree G1")
    parser.add_argument("--iface", default="eth0", help="network interface for DDS (default: eth0)")
    parser.add_argument("--port", type=int, default=LOWSTATE_PORT, help="ZMQ PUB port (default: 6001)")
    parser.add_argument("--rate", type=float, default=50.0, help="max publish rate in Hz (default: 50)")
    args = parser.parse_args()

    # DDS domain 0 = real robot (never 1 — that is simulation).
    ChannelFactoryInitialize(0, args.iface)

    lowstate_sub = ChannelSubscriber(kTopicLowState, hg_LowState)
    lowstate_sub.Init()

    ctx = zmq.Context.instance()
    lowstate_sock = ctx.socket(zmq.PUB)
    lowstate_sock.bind(f"tcp://0.0.0.0:{args.port}")

    state_period = 1.0 / args.rate
    last_sent = 0.0
    n_sent = 0

    print(f"[ReadOnlyBridge] rt/lowstate → zmq PUB :{args.port} @ ≤{args.rate} Hz "
          f"(iface {args.iface}) — NO command path exists in this process", flush=True)

    try:
        while True:
            msg = lowstate_sub.Read()
            if msg is None:
                continue
            now = time.time()
            if now - last_sent < state_period:
                continue
            payload = json.dumps({"topic": kTopicLowState, "data": lowstate_to_dict(msg)}).encode("utf-8")
            try:
                lowstate_sock.send(payload, zmq.NOBLOCK)
            except zmq.Again:
                continue  # no subscriber / tx buffer full — drop
            last_sent = now
            n_sent += 1
            if n_sent % 500 == 1:
                print(f"[ReadOnlyBridge] {n_sent} states forwarded", flush=True)
    except KeyboardInterrupt:
        print("[ReadOnlyBridge] shutting down", flush=True)
    finally:
        lowstate_sock.close(0)
        ctx.term()


if __name__ == "__main__":
    main()
