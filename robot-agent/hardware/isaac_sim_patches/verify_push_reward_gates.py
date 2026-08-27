#!/usr/bin/env python3
"""
@file verify_push_reward_gates.py
@description Offline (no Isaac, no GPU) check of the four gates in
             tasks/common_rewards/base_reward_push_cylindercfg.py, added by
             0003-neodem-push-slide-reward.patch (TASK-186).
@feature isaac-sim-patches

The reward's gates are ordinary tensor arithmetic over object pose and hand
positions. Nothing in them needs a physics engine, so they are checked here by
importing the module with `isaaclab` stubbed out and driving synthetic
trajectories through it. This is NOT a substitute for the in-sim controls in
README.md - it cannot tell you whether the hand link regex matches, whether the
Dex3 can physically slide the 0.018 x 0.35 m rod, or whether DDS carries the
value. It pins the scoring logic, which is the part that was wrong last time.

Run (any CPU torch will do; no GPU, no Isaac env):

    UNITREE_SIM_ROOT=/path/to/unitree_sim_isaaclab \
      /home/humanoid/anaconda3/envs/tv/bin/python \
      robot-agent/hardware/isaac_sim_patches/verify_push_reward_gates.py

Exits non-zero on the first failed expectation.
"""

from __future__ import annotations

import importlib.util
import os
import sys
import types

import torch

# --------------------------------------------------------------------------
# stub the isaaclab imports the module makes at import time
# --------------------------------------------------------------------------


class _SceneEntityCfg:
    def __init__(self, name, **_kwargs):
        self.name = name


def _install_stubs() -> None:
    isaaclab = types.ModuleType("isaaclab")
    assets = types.ModuleType("isaaclab.assets")
    assets.RigidObject = object
    managers = types.ModuleType("isaaclab.managers")
    managers.SceneEntityCfg = _SceneEntityCfg
    sys.modules.setdefault("isaaclab", isaaclab)
    sys.modules["isaaclab.assets"] = assets
    sys.modules["isaaclab.managers"] = managers


def _load_reward_module():
    root = os.environ.get("UNITREE_SIM_ROOT")
    if not root:
        sys.exit("set UNITREE_SIM_ROOT to a unitree_sim_isaaclab checkout with 0003-* applied")
    path = os.path.join(root, "tasks", "common_rewards", "base_reward_push_cylindercfg.py")
    if not os.path.exists(path):
        sys.exit(f"not found: {path}\n(is 0003-neodem-push-slide-reward.patch applied?)")
    spec = importlib.util.spec_from_file_location("base_reward_push_cylindercfg", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


# --------------------------------------------------------------------------
# a fake single-env scene: one cylinder, one robot with two "hand" bodies
# --------------------------------------------------------------------------


class _Data:
    pass


class _Asset:
    def __init__(self):
        self.data = _Data()


class _Robot(_Asset):
    def __init__(self):
        super().__init__()
        # Deliberately mixes matching and non-matching names so the regex is
        # exercised, not just the arithmetic.
        self.data.body_names = [
            "pelvis", "torso_link", "left_elbow_link",
            "left_wrist_yaw_link", "left_hand_palm_link", "left_hand_index_1_link",
            "right_wrist_yaw_link", "right_hand_palm_link", "right_hand_index_1_link",
        ]
        self.data.root_quat_w = torch.tensor([[1.0, 0.0, 0.0, 0.0]])  # yaw 0 -> faces +x
        self.data.body_pos_w = torch.zeros(1, len(self.data.body_names), 3)
        self.data.body_pos_w[:, :, :] = 10.0  # everything far away by default

    def find_bodies(self, patterns, preserve_order=False):
        import re

        ids, names = [], []
        for i, n in enumerate(self.data.body_names):
            if any(re.fullmatch(p, n) for p in patterns):
                ids.append(i)
                names.append(n)
        return ids, names


class _Scene(dict):
    pass


class _Env:
    def __init__(self):
        self.num_envs = 1
        self.device = "cpu"
        self.obj = _Asset()
        self.robot = _Robot()
        self.scene = _Scene(object=self.obj, robot=self.robot)


def _quat_tilt(deg: float) -> torch.Tensor:
    """Rotation of `deg` about world +x, in (w, x, y, z)."""
    half = torch.deg2rad(torch.tensor(deg)) / 2
    return torch.tensor([[torch.cos(half), torch.sin(half), 0.0, 0.0]])


def _step(env, mod, pos, tilt_deg=0.0, hand=None):
    env.obj.data.root_pos_w = torch.tensor([pos], dtype=torch.float)
    env.obj.data.root_quat_w = _quat_tilt(tilt_deg)
    env.robot.data.body_pos_w = torch.full((1, len(env.robot.data.body_names), 3), 10.0)
    if hand is not None:
        for i, n in enumerate(env.robot.data.body_names):
            if "hand" in n:
                env.robot.data.body_pos_w[0, i] = torch.tensor(hand, dtype=torch.float)
    return float(mod.compute_reward(env)[0])


def _lerp(a, b, t):
    return [a[i] + (b[i] - a[i]) * t for i in range(3)]


# --------------------------------------------------------------------------
# scenarios. Object starts at the scene's actual init pose.
# --------------------------------------------------------------------------

START = [-2.58514, -2.78975, 0.84]
N = 60


def _run(mod, name, cfg, traj):
    """traj: list of (pos, tilt_deg, hand_or_None). Returns (rewards, env)."""
    env = _Env()
    env._push_reward_cfg = dict(cfg)
    out = []
    for pos, tilt, hand in traj:
        out.append(_step(env, mod, pos, tilt, hand))
    print(f"  {name:<26} first={out[0]:+.1f} last={out[-1]:+.1f} "
          f"max={max(out):+.1f} min={min(out):+.1f}")
    return out


def _hand_beside(pos, offset=(-0.06, 0.0, 0.0)):
    """A hand 6 cm from the object's axis - inside contact_radius 0.12."""
    return [pos[0] + offset[0], pos[1] + offset[1], pos[2] + offset[2]]


def main() -> int:
    _install_stubs()
    mod = _load_reward_module()

    cfg = {"direction": "left", "verbose": False}   # robot yaw 0 -> "left" is world +y
    failures = []

    def check(cond, msg):
        print(f"    {'PASS' if cond else 'FAIL'}  {msg}")
        if not cond:
            failures.append(msg)

    print("\n(a) slide 0.20 m left, hand stays with it, no lift, no tilt")
    traj = []
    for k in range(N):
        p = _lerp(START, [START[0], START[1] + 0.20, START[2]], k / (N - 1))
        traj.append((p, 0.0, _hand_beside(p)))
    r = _run(mod, "slide-left", cfg, traj)
    check(max(r) == 1.0, "slide fires (reward reaches +1.0)")
    check(r[-1] == 1.0, "slide success latches to the end of the episode")

    print("\n(b) lift 0.20 m, carry 0.20 m left, set down - the old proxy's false positive")
    traj = []
    for k in range(N):
        t = k / (N - 1)
        z = START[2] + 0.20 * (1.0 if 0.25 < t < 0.75 else (t / 0.25 if t <= 0.25 else (1 - t) / 0.25))
        y = START[1] + 0.20 * min(1.0, max(0.0, (t - 0.2) / 0.6))
        p = [START[0], y, z]
        traj.append((p, 0.0, _hand_beside(p)))
    r = _run(mod, "lift-and-place", cfg, traj)
    check(max(r) < 1.0, "lift-and-place NEVER fires")
    check(min(r) == -1.0, "lift-and-place is disqualified, not merely scoreless")
    # what the invalidated TASK-185 proxy would have said about the same motion
    lateral = ((traj[-1][0][0] - START[0]) ** 2 + (traj[-1][0][1] - START[1]) ** 2) ** 0.5
    net_lift = traj[-1][0][2] - START[2]
    check(lateral >= 0.08 and net_lift <= 0.06,
          f"...and the TASK-185 proxy DID accept it (lateral={lateral:.2f} m, "
          f"net lift={net_lift:.2f} m) - this is the regression being fixed")

    print("\n(c) knock over: object tips to 80 deg while travelling left")
    traj = []
    for k in range(N):
        t = k / (N - 1)
        p = _lerp(START, [START[0], START[1] + 0.20, START[2]], t)
        traj.append((p, 80.0 * t, _hand_beside(p)))
    r = _run(mod, "knock-over", cfg, traj)
    check(max(r) < 1.0, "knock-over NEVER fires")
    check(min(r) == -1.0, "knock-over is disqualified")

    print("\n(d) do nothing")
    traj = [(START, 0.0, _hand_beside(START)) for _ in range(N)]
    r = _run(mod, "idle", cfg, traj)
    check(max(r) == 0.0 and min(r) == 0.0, "idle stays at 0.0 (neither success nor DQ)")

    print("\n(e) launch: one contact frame, then 0.30 m of travel with the hand left behind")
    traj = [(START, 0.0, _hand_beside(START))]
    for k in range(N - 1):
        p = _lerp(START, [START[0], START[1] + 0.30, START[2]], (k + 1) / (N - 1))
        traj.append((p, 0.0, None))
    r = _run(mod, "swept-launch", cfg, traj)
    check(max(r) < 1.0, "launched object NEVER fires (gate 4)")
    check(min(r) == -1.0, "launched object is disqualified via free_travel")

    print("\n(f) pushed the wrong way (0.20 m right, commanded left)")
    traj = []
    for k in range(N):
        p = _lerp(START, [START[0], START[1] - 0.20, START[2]], k / (N - 1))
        traj.append((p, 0.0, _hand_beside(p)))
    r = _run(mod, "wrong-direction", cfg, traj)
    check(max(r) == 0.0 and min(r) == 0.0, "wrong direction neither fires nor DQs")

    print("\n(g) pushed left but with 0.15 m of off-axis wander")
    traj = []
    for k in range(N):
        t = k / (N - 1)
        p = [START[0] + 0.15 * t, START[1] + 0.20 * t, START[2]]
        traj.append((p, 0.0, _hand_beside(p)))
    r = _run(mod, "off-axis", cfg, traj)
    check(max(r) < 1.0, "off-axis wander (ratio 0.75 > 0.4) does not fire")

    print("\n(h) hand-body regex actually matches something")
    env = _Env()
    ids, names = env.robot.find_bodies(mod._DEFAULTS["hand_body_patterns"])
    print(f"    matched: {names}")
    check(len(ids) == 6, "default hand_body_patterns match the 6 hand/wrist links")

    print()
    if failures:
        print(f"{len(failures)} FAILURE(S):")
        for f in failures:
            print(f"  - {f}")
        return 1
    print("all push-reward gate checks passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
