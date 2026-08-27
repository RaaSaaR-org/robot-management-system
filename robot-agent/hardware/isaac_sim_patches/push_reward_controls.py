#!/usr/bin/env python3
"""
@file push_reward_controls.py
@description DDS-side harness for the TASK-186 push/slide reward: watch
             rt/rewards_state, reset the episode, and switch the commanded
             direction between rollouts.
@feature isaac-sim-patches

Everything here talks to a *running* `sim_main.py --reward_mode push` over DDS
domain 1 (the sim domain; 0 is the real robot, 9 is mock). It drives no joints:
the checkout has no scripted arm driver — `create_action_provider` only
implements `dds`, `dds_wholebody` and `replay`, and a Wholebody task is forced
to `dds_wholebody` (sim_main.py:422-425) — so the arm motion in each control
below comes from teleop or a policy. See README.md for the full procedure.

Topics used (verified against the checkout at e30c25b):
  rt/rewards_state   String_  published by dds/rewards_dds.py:48
  rt/reset_pose/cmd  String_  subscribed by dds/reset_pose_dds.py:45,
                              payload "1" = reset object, "2" = reset all

Usage:
  python push_reward_controls.py watch [--seconds 60]
  python push_reward_controls.py reset [--category 1]
  python push_reward_controls.py direction left --cfg-file /dev/shm/push.json
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time

REWARD_LABELS = {
    1.0: "SUCCESS",
    0.0: "in-progress",
    -1.0: "DISQUALIFIED",
    -2.0: "REWARD-ERROR (see sim log)",
}


def _init(domain: int):
    from unitree_sdk2py.core.channel import ChannelFactoryInitialize

    ChannelFactoryInitialize(domain)


def cmd_watch(args) -> int:
    from unitree_sdk2py.core.channel import ChannelSubscriber
    from unitree_sdk2py.idl.std_msgs.msg.dds_ import String_

    _init(args.domain)
    seen = {"n": 0, "last": None}

    def on_msg(msg):
        try:
            data = json.loads(msg.data)
        except Exception:
            print(f"[rewards] unparseable: {msg.data!r}")
            return
        vals = data.get("rewards", [])
        v = float(vals[0]) if vals else float("nan")
        seen["n"] += 1
        if v != seen["last"]:
            seen["last"] = v
            label = REWARD_LABELS.get(v, f"unknown({v})")
            print(f"[{time.strftime('%H:%M:%S')}] rt/rewards_state -> {v:+.1f}  {label}")

    sub = ChannelSubscriber("rt/rewards_state", String_)
    sub.Init(on_msg, 10)
    print(f"watching rt/rewards_state on domain {args.domain} for {args.seconds}s "
          "(only transitions are printed)")
    t0 = time.time()
    while time.time() - t0 < args.seconds:
        time.sleep(0.2)
    print(f"received {seen['n']} messages; final value {seen['last']}")
    if seen["n"] == 0:
        print("NO MESSAGES. The sim is not running, is on another DDS domain, or "
              "was started without --reward_mode push.")
        return 2
    return 0


def cmd_reset(args) -> int:
    from unitree_sdk2py.core.channel import ChannelPublisher
    from unitree_sdk2py.idl.std_msgs.msg.dds_ import String_

    _init(args.domain)
    pub = ChannelPublisher("rt/reset_pose/cmd", String_)
    pub.Init()
    time.sleep(0.5)  # let discovery settle before the single write
    pub.Write(String_(data=str(args.category)))
    print(f"published reset_category={args.category} on rt/reset_pose/cmd "
          f"(domain {args.domain})")
    time.sleep(0.5)
    return 0


def cmd_direction(args) -> int:
    path = args.cfg_file or os.environ.get("UNITREE_SIM_PUSH_CFG", "")
    if not path:
        print("need --cfg-file (the same path passed to sim_main --push_cfg_file)")
        return 2
    payload = {"direction": args.direction}
    tmp = path + ".tmp"
    with open(tmp, "w") as fh:
        json.dump(payload, fh)
    os.replace(tmp, path)  # atomic, so the sim never reads a half-written file
    print(f"wrote {payload} to {path}; the sim re-baselines within ~0.25 s")
    return 0


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--domain", type=int, default=1, help="DDS domain (1 = sim)")
    sub = p.add_subparsers(dest="cmd", required=True)

    w = sub.add_parser("watch", help="print rt/rewards_state transitions")
    w.add_argument("--seconds", type=float, default=60.0)
    w.set_defaults(func=cmd_watch)

    r = sub.add_parser("reset", help="reset the episode (and the reward baseline)")
    r.add_argument("--category", type=int, default=1, choices=[1, 2])
    r.set_defaults(func=cmd_reset)

    d = sub.add_parser("direction", help="change the commanded push direction")
    d.add_argument("direction",
                   choices=["left", "right", "forward", "backward", "+x", "-x", "+y", "-y"])
    d.add_argument("--cfg-file", default="")
    d.set_defaults(func=cmd_direction)

    args = p.parse_args()
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
