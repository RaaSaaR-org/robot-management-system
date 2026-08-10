#!/usr/bin/env python3
"""Prove the bridge: an UNMODIFIED LocoClient makes velocity appear on the Isaac wire.

Nothing here imports our bridge code. It speaks the two ends and checks they meet:

    LocoClient.SetVelocity(...)  ->  rt/api/sport/request
                                 ->  [isaac_loco_bridge]
                                 ->  rt/run_command/cmd  <- subscribed here

That is test-strategy step 3 of TASK-203, and it deliberately does NOT need Isaac running.
A failure here is a bridge bug; a pass here with a motionless robot is a sim-side problem.
Run `isaac_loco_bridge.py --domain N` first, then this with the same domain.

`sim_g1_dds/e2e_loco_check.py` is the richer sibling, but it asserts against the MuJoCo
node's HTTP facade and its kinematic pose, neither of which exists here.

@status test — run by hand against a live bridge; needs DDS, so it is not part of the pytest suite.
"""
from __future__ import annotations

import argparse
import ast
import threading
import time

from unitree_sdk2py.core.channel import ChannelFactoryInitialize, ChannelSubscriber
from unitree_sdk2py.g1.loco.g1_loco_client import LocoClient
from unitree_sdk2py.idl.std_msgs.msg.dds_ import String_

RUN_COMMAND_TOPIC = "rt/run_command/cmd"
TOL = 1e-3

# (label, vx, vy, omega). Yaw and lateral are in here on purpose: forward-only would pass
# even with the axes transposed, which is the mistake this bridge is most likely to make.
CASES = [
    ("forward", 0.4, 0.0, 0.0),
    ("back", -0.3, 0.0, 0.0),
    ("strafe left", 0.0, 0.35, 0.0),
    ("turn left", 0.0, 0.0, 0.6),
    ("turn right", 0.0, 0.0, -0.6),
    ("arc", 0.3, 0.0, 0.4),
]


class Wire:
    """Latest [vx, vy, omega, height] seen on the Isaac command topic."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._last: list[float] | None = None
        self.count = 0
        sub = ChannelSubscriber(RUN_COMMAND_TOPIC, String_)
        sub.Init(self._on_msg, 10)
        self._sub = sub

    def _on_msg(self, msg: String_) -> None:
        try:
            parsed = ast.literal_eval(msg.data)
        except (ValueError, SyntaxError):
            return
        if isinstance(parsed, (list, tuple)) and len(parsed) >= 4:
            with self._lock:
                self._last = [float(v) for v in parsed[:4]]
                self.count += 1

    def await_match(self, want: tuple[float, float, float], timeout: float = 2.0):
        """Wait for the wire to carry `want`; returns the matching frame or the last seen."""
        deadline = time.monotonic() + timeout
        last = None
        while time.monotonic() < deadline:
            with self._lock:
                last = list(self._last) if self._last else None
            if last and all(abs(last[i] - want[i]) < TOL for i in range(3)):
                return last, True
            time.sleep(0.02)
        return last, False


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--domain", type=int, default=1)
    ap.add_argument("--iface", default=None)
    ap.add_argument("--hold", type=float, default=1.0, help="SetVelocity duration, seconds")
    args = ap.parse_args()

    if args.iface:
        ChannelFactoryInitialize(args.domain, args.iface)
    else:
        ChannelFactoryInitialize(args.domain)

    wire = Wire()
    client = LocoClient()
    client.SetTimeout(3.0)
    client.Init()

    time.sleep(0.5)
    if wire.count == 0:
        print(f"FAIL  nothing publishing on {RUN_COMMAND_TOPIC} — is the bridge running "
              f"on domain {args.domain}?")
        return 1
    print(f"ok    bridge is publishing ({wire.count} frames seen while settling)\n")

    failures = []
    for label, vx, vy, omega in CASES:
        code = client.SetVelocity(vx, vy, omega, args.hold)
        got, matched = wire.await_match((vx, vy, omega))
        status = "ok  " if (matched and code == 0) else "FAIL"
        print(f"{status}  {label:<12} sent ({vx:+.2f} {vy:+.2f} {omega:+.2f}) "
              f"rpc={code} wire={got}")
        if not matched or code != 0:
            failures.append(label)
        time.sleep(0.15)

    # Expiry is a property of the bridge, not of Isaac: stop publishing motion once the
    # command's duration lapses, or a dropped Agent Mode process leaves the robot walking.
    client.SetVelocity(0.4, 0.0, 0.0, 0.4)
    time.sleep(1.4)
    got, zeroed = wire.await_match((0.0, 0.0, 0.0), timeout=1.0)
    print(f"{'ok  ' if zeroed else 'FAIL'}  expiry       velocity lapsed back to zero, wire={got}")
    if not zeroed:
        failures.append("expiry")

    print()
    if failures:
        print(f"FAILED: {', '.join(failures)}")
        return 1
    print(f"PASSED — {len(CASES) + 1} checks. An unmodified LocoClient reaches the Isaac wire.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
