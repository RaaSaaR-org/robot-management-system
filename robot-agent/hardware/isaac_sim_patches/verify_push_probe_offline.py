#!/usr/bin/env python3
"""Offline smoke test for `neodem_push_probe.PushProbe` (NeoDEM, TASK-186).

Purpose is narrow and worth stating, because it is easy to mistake this for a
physics test: it is not. It drives the probe's state machine against a fake
rigid body so that a crash surfaces in one second on the CPU instead of three
minutes into an Isaac boot that is holding the whole GPU. The GPU on this box
is serialised, so a probe that dies at trial 1 costs a slot that another job is
queued behind.

What it checks:
  * every phase transition runs (init -> reset -> settle -> push -> coast -> record)
  * the sweep terminates and emits a summary
  * the wrench call is shaped correctly under all three Isaac Lab API variants
    (`positions=`, `is_global=`, and neither -> explicit r x F torque)
  * the explicit-torque fallback computes tau = r x F with the right sign
  * both quaternion orderings are reported, and they disagree for a tipped rod
    (if they ever agree, the convention probe in `_tilt_both` is worthless)

What it cannot check: whether the rod really tips. That is what the in-sim
sweep is for. The fake body here tips or slides according to the analytic rule
the probe exists to TEST, so a pass here is not evidence for that rule -- it
only proves the probe would faithfully report it either way.

Run:
    UNITREE_SIM_ROOT=$UNITREE_ROOT/unitree_sim_isaaclab \
      /home/humanoid/anaconda3/envs/tv/bin/python \
      robot-agent/hardware/isaac_sim_patches/verify_push_probe_offline.py
"""
import math
import os
import sys

SIM_ROOT = os.environ.get("UNITREE_SIM_ROOT", "")
if not SIM_ROOT or not os.path.isdir(SIM_ROOT):
    sys.exit("set UNITREE_SIM_ROOT to the unitree_sim_isaaclab checkout")
sys.path.insert(0, SIM_ROOT)

probe_path = os.path.join(SIM_ROOT, "neodem_push_probe.py")
if not os.path.exists(probe_path):
    sys.exit(f"not found: {probe_path}\n(is the TASK-186 probe hook applied?)")

import torch  # noqa: E402

from neodem_push_probe import (  # noqa: E402
    PushProbe, ROD_HEIGHT_M, ROD_RADIUS_M, ROD_MU, ROD_MASS_KG, G, _tilt_both,
)

FAILURES = []


def check(ok, label, detail=""):
    print(f"    {'PASS' if ok else 'FAIL'}  {label}" + (f"  [{detail}]" if detail else ""))
    if not ok:
        FAILURES.append(label)


def quat_tilt_wxyz(deg):
    """Unit quaternion (w,x,y,z) for a rotation of `deg` about world +x."""
    a = math.radians(deg) / 2.0
    return [math.cos(a), math.sin(a), 0.0, 0.0]


class FakeObject:
    """A rod that obeys the analytic slide/tip rule, so verdicts vary."""

    def __init__(self, api_variant):
        self.api_variant = api_variant
        self.calls = []
        self.pos = torch.tensor([[-2.585, -2.790, 0.84 + 0.5 * ROD_HEIGHT_M]])
        self.quat = torch.tensor([quat_tilt_wxyz(0.0)])
        self._tilt = 0.0
        self.data = self

        # Build a set_external_force_and_torque with the requested signature so
        # the probe's inspect-based branch selection is actually exercised.
        if api_variant == "positions":
            def sefat(forces, torques, positions=None, body_ids=None, env_ids=None):
                self._push(forces, torques, positions)
        elif api_variant == "is_global":
            def sefat(forces, torques, body_ids=None, env_ids=None, is_global=False):
                self._push(forces, torques, None)
        else:
            def sefat(forces, torques, body_ids=None, env_ids=None):
                self._push(forces, torques, None)
        self.set_external_force_and_torque = sefat

    # the probe reads these off `.data`
    @property
    def root_pos_w(self):
        return self.pos

    @property
    def root_quat_w(self):
        return self.quat

    def _push(self, forces, torques, positions):
        fy = float(forces[0, 0, 1])
        self.calls.append({"fy": fy,
                           "tau": [float(v) for v in torques[0, 0]],
                           "pos": None if positions is None else float(positions[0, 0, 2])})
        if abs(fy) < 1e-9:
            return
        # Recover the commanded contact height from whichever channel carried it.
        if positions is not None:
            h = float(positions[0, 0, 2]) + 0.5 * ROD_HEIGHT_M
        else:
            h = float(torques[0, 0, 0]) / -fy + 0.5 * ROD_HEIGHT_M
        # The rule under test: tips when F*h exceeds m*g*r, else slides.
        if abs(fy) * h > ROD_MASS_KG * G * ROD_RADIUS_M:
            self._tilt = min(90.0, self._tilt + 3.0)
            self.quat = torch.tensor([quat_tilt_wxyz(self._tilt)])
        else:
            self.pos = self.pos + torch.tensor([[0.0, 0.004, 0.0]])

    def write_root_pose_to_sim(self, pose):
        self.pos = pose[:, :3].clone()
        self.quat = pose[:, 3:].clone()
        self._tilt = 0.0

    def write_root_velocity_to_sim(self, vel):
        pass


class FakeEnv:
    def __init__(self, obj):
        self.num_envs = 1
        self.device = "cpu"
        self.scene = {"object": obj}


def run_probe(api_variant, scenarios, heights=None, extra=None):
    """Drive PushProbe to completion against a fake body; return (probe, object)."""
    os.environ["NEODEM_PUSH_PROBE"] = scenarios
    os.environ["NEODEM_PUSH_PROBE_DELAY"] = "0"
    os.environ["NEODEM_PUSH_PROBE_HEIGHTS"] = (
        " ".join(str(h) for h in heights) if heights else "")
    os.environ["NEODEM_PUSH_PROBE_SETTLE"] = "2"
    os.environ["NEODEM_PUSH_PROBE_PUSH"] = "60"
    os.environ["NEODEM_PUSH_PROBE_COAST"] = "2"
    os.environ["NEODEM_PUSH_PROBE_SEG"] = "10"
    os.environ["NEODEM_PUSH_PROBE_IDLE"] = "40"
    for k, v in (extra or {}).items():
        os.environ[k] = v
    obj = FakeObject(api_variant)
    p = PushProbe(FakeEnv(obj))
    for _ in range(40000):
        p.step()
        if p.phase == "done":
            break
    return p, obj


def run_sweep(api_variant, heights):
    p, obj = run_probe(api_variant, "sweep", heights)
    p.results = p.scenarios[0].results if p.scenarios else []
    return p, obj


print(__doc__.splitlines()[0])
print()

# (1) the state machine completes and records one result per height
print("(1) sweep runs to completion and records every height")
heights = [0.004, 0.010, 0.175]
p, obj = run_sweep("positions", heights)
check(p.phase == "done", "sweep reaches the done phase", p.phase)
check(len(p.results) == len(heights),
      f"one result per swept height ({len(heights)})", str(len(p.results)))

# (2) verdicts track the analytic rule in both directions
print("\n(2) the probe reports slide and tip distinctly")
by_h = {round(r["h"], 4): r for r in p.results}
check(by_h[0.004]["verdict"] == "SLID", "4 mm push slides", by_h[0.004]["verdict"])
check(by_h[0.175]["verdict"] == "TIPPED", "175 mm push tips", by_h[0.175]["verdict"])
check(by_h[0.175]["peak_tilt"] > 20.0, "a tipped rod exceeds the 20 deg veto",
      f"{by_h[0.175]['peak_tilt']:.1f} deg")

# (3) all three Isaac Lab wrench signatures are driven correctly
print("\n(3) every Isaac Lab wrench API variant is handled")
for variant in ("positions", "is_global", "bare"):
    p2, obj2 = run_sweep(variant, [0.004])
    used = [c for c in obj2.calls if abs(c["fy"]) > 1e-9]
    check(bool(used), f"{variant}: a non-zero force was applied")
    check(p2.results and p2.results[0]["verdict"] == "SLID",
          f"{variant}: 4 mm still slides",
          p2.results[0]["verdict"] if p2.results else "no result")

# (4) the explicit-torque fallback has the right magnitude AND sign
print("\n(4) the r x F fallback is correct, not merely non-zero")
p3, obj3 = run_sweep("bare", [0.30])
used = [c for c in obj3.calls if abs(c["fy"]) > 1e-9][0]
dz = 0.30 - 0.5 * ROD_HEIGHT_M
# r = (0,0,dz), F = (0,fy,0)  ->  tau = r x F = (-dz*fy, 0, 0)
check(abs(used["tau"][0] - (-dz * used["fy"])) < 1e-6,
      "tau_x == -dz*Fy", f"{used['tau'][0]:.4f} vs {-dz*used['fy']:.4f}")
check(abs(used["tau"][1]) < 1e-9, "tau_y == 0 for a +y push", f"{used['tau'][1]:.4g}")
check(abs(used["tau"][2]) < 1e-9, "tau_z == 0", f"{used['tau'][2]:.4g}")

# (5) the convention is identifiable, and identifiable immediately
print("\n(5) the quaternion orderings are distinguishable from the rod at rest")
up_w, up_x = _tilt_both(torch.tensor(quat_tilt_wxyz(0.0)))
tip_w, tip_x = _tilt_both(torch.tensor(quat_tilt_wxyz(90.0)))
# An UPRIGHT rod already separates them: a wxyz buffer is (1,0,0,0), which the
# wxyz formula reads as 0 deg and the xyzw formula reads as 180 deg -- and a rod
# standing on a table cannot be at 180 deg. So the very first log line settles
# the convention, which matters because the in-sim sweep prints the home pose
# before it pushes anything: if that line shows wxyz=180, the reward's gate 3 is
# reading the wrong components and no tilt veto in this session can be trusted.
check(abs(up_w) < 1e-6, "upright reads 0 deg under the true (wxyz) ordering",
      f"{up_w:.2f} deg")
check(abs(up_x - 180.0) < 1e-3,
      "upright reads an impossible 180 deg under the wrong ordering",
      f"{up_x:.2f} deg")
check(abs(tip_w - 90.0) < 1e-3, "a 90 deg tip reads 90 deg under wxyz",
      f"{tip_w:.2f} deg")
check(abs(tip_w - tip_x) > 30.0,
      "the orderings stay divergent once tipped, too",
      f"wxyz={tip_w:.1f} vs xyzw={tip_x:.1f}")

# (6) the no-slide-available summary path is reachable
print("\n(6) an all-tip sweep reports control (a) as unrunnable")
p4, _ = run_sweep("positions", [0.05, 0.10, 0.175])
check(all(r["verdict"] == "TIPPED" for r in p4.results),
      "every palm-height push tips", str([r["verdict"] for r in p4.results]))
check(not [r for r in p4.results if r["disp"] >= 0.20],
      "no scoring 0.20 m slide among them")

# (7) the three robot-independent controls run to completion in order
print("\n(7) controls (d), (b) and (c) run to completion, in that order")
p5, obj5 = run_probe("positions", "all", heights=[0.004])
check(p5.phase == "done", "the full scenario list completes", p5.phase)
names = [sc.name for sc in (p5.scenarios or [])]
check(names == ["idle", "lift", "knock", "sweep"],
      "scenarios run idle-first, so (d) sees an untouched object", str(names))
# Read from `.result`, not from the live driver: the scenarios share one
# _ObjectDriver, so a post-hoc `_disp()` reports where the LAST scenario left
# the rod. This assertion caught exactly that leak.
idle = p5.scenarios[0].result
check(idle is not None and idle["peak_tilt"] < 1e-6 and idle["disp"] < 1e-6,
      "(d) idle: the object neither drifts nor tilts when untouched",
      f"drift={idle['disp']:.5f} tilt={idle['peak_tilt']:.5f}" if idle else "no result")
lift = p5.scenarios[1].result
check(lift["peak_lift"] > 0.05, "(b) lift: the carry actually raises the object",
      f"{lift['peak_lift']:+.3f} m")
check(abs(lift["disp"] - 0.20) < 0.02,
      "(b) lift: it is carried the full 0.20 m", f"{lift['disp']:.3f} m")
knock = p5.scenarios[2].result
check(knock["peak_tilt"] > 20.0, "(c) knock: the rod passes the 20 deg veto",
      f"{knock['peak_tilt']:.1f} deg")
check(p5.scenarios[0].result["disp"] != p5.scenarios[1].result["disp"],
      "each scenario reports its own outcome, not the shared driver's final state")

# (8) a bad scenario name fails loudly rather than silently doing nothing
print("\n(8) an unknown scenario name is rejected at construction")
try:
    run_probe("positions", "slide-it-please")
    check(False, "unknown scenario raises")
except ValueError as e:
    check("unknown NEODEM_PUSH_PROBE scenario" in str(e),
          "unknown scenario raises ValueError naming the known set", str(e)[:60])

print()
if FAILURES:
    print(f"FAILED: {len(FAILURES)} check(s): {FAILURES}")
    sys.exit(1)
print("all push-probe offline checks passed")
