#!/usr/bin/env python3
"""Offline check for the Isaac bridge's manipulation path (NeoDEM, TASK-227).

@file verify_isaac_manip_offline.py
@description Exercises `isaac_manip.py` -- the maths behind `isaac_manip_bridge.py`'s
    `rt/lowcmd` and `rt/dex3/*/cmd` publishers -- with no sim, no DDS traffic, no GPU
    and no `unitree_sdk2py`. Runs in well under a second on `python3`.
@feature hardware

Why this exists as a standalone script rather than as an in-sim assertion: the GPU on
this box is serialised, an Isaac boot costs minutes, and every bug this catches is a
CPU bug. The two defects it is built around are:

  * THE LEFT-HAND GRIP CODE. `action[14:21]` from a policy trained on the apple
    pick-and-place dataset is a normalised grip CODE, not radians. Sending it raw
    lands four of the seven joints on their OPEN limit and flips the sign of a
    fifth, so the commanded "closed" hand is very nearly an open one -- measured as
    0/15 vs 13/15 carries through the MuJoCo replay gate. Check (6) asserts that the
    raw and decoded vectors DISAGREE in that specific way, not merely that the
    decoder returns something.

  * THE RIGHT-HAND SLOT ORDER. The sim orders the right hand thumb,thumb,thumb,
    middle,middle,index,index; the real robot and every dataset order it
    thumb,thumb,thumb,index,index,middle,middle. Without the remap the wrong two
    fingers move and nothing else looks wrong. Check (3) asserts it BY NAME in both
    directions, and check (2) asserts the vendor source still says what it said.

What this cannot check -- and it is a long list, see the report accompanying this
change: that the sim accepts the CRC, that rt/lowcmd reaches the articulation at
all, that arm targets do not destabilise the locomotion policy (they enter its
observation), that the Dex3 fingers physically close on an object, or that the
right-hand remap matches the SCENE as opposed to the vendor source. Only a live sim
settles those.

Run:
    python3 robot-agent/hardware/verify_isaac_manip_offline.py
"""
import ast
import contextlib
import io
import math
import os
import shutil
import subprocess
import sys
import threading
import time

_HERE = os.path.dirname(os.path.abspath(__file__))
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)

import isaac_manip as M  # noqa: E402
import isaac_manip_bridge as B  # noqa: E402  (SDK imports are inside __init__)
from isaac_manip import HandUnits  # noqa: E402
from sim_g1_dds.joints import BODY, LHAND, RHAND  # noqa: E402

FAILURES = []


def check(ok, label, detail=""):
    print(f"    {'PASS' if ok else 'FAIL'}  {label}" + (f"  [{detail}]" if detail else ""))
    if not ok:
        FAILURES.append(label)


def raises(exc, fn, *a, **kw):
    try:
        fn(*a, **kw)
    except exc:
        return True
    except Exception:  # noqa: BLE001 -- the WRONG exception is a failure, not a pass
        return False
    return False


def squash(text):
    """All whitespace removed, so a vendor reformat does not fail this file."""
    return "".join(text.split())


print(__doc__.splitlines()[0])
print()

# --------------------------------------------------------------------------------
print("(1) the joint tables are the protocol's, not a second copy of it")
check(M.ARM_JOINTS == tuple(BODY[15:29]),
      "ARM_JOINTS is BODY[15:29] from sim_g1_dds/joints.py", f"{len(M.ARM_JOINTS)} joints")
check(M.N_ARM == 14 and M.N_HAND == 7, "14 arm joints, 7 per hand",
      f"{M.N_ARM} / {M.N_HAND}")
check(M.ARM_JOINTS[0] == "left_shoulder_pitch_joint"
      and M.ARM_JOINTS[6] == "left_wrist_yaw_joint"
      and M.ARM_JOINTS[7] == "right_shoulder_pitch_joint"
      and M.ARM_JOINTS[13] == "right_wrist_yaw_joint",
      "left arm is slots 0-6 and right arm slots 7-13")
check(M.WAIST_JOINTS == ("waist_yaw_joint", "waist_roll_joint", "waist_pitch_joint"),
      "the three PARKED waist joints are named, so nobody tries to drive them",
      str(M.WAIST_JOINTS))
check(M.NEODEM_LEFT_HAND == tuple(LHAND) and M.NEODEM_RIGHT_HAND == tuple(RHAND),
      "NeoDEM hand orders come from joints.py LHAND/RHAND")
check(M.ISAAC_LEFT_HAND == M.NEODEM_LEFT_HAND,
      "the LEFT hand order agrees between sim and real robot (so: no left remap)")
check(M.ISAAC_RIGHT_HAND != M.NEODEM_RIGHT_HAND,
      "the RIGHT hand order does NOT agree — this is the whole reason for check (3)")
check(sorted(M.ISAAC_RIGHT_HAND) == sorted(M.NEODEM_RIGHT_HAND),
      "and the two right-hand orders are permutations of the same seven joints")

# --------------------------------------------------------------------------------
print("\n(2) the vendor source still says what these tables were read off")
VENDOR = os.environ.get(
    "UNITREE_SIM_ISAACLAB",
    "/home/humanoid/Dokumente/Unitree/g1_quest_teleop/third_party/checkouts/unitree_sim_isaaclab")
prov = os.path.join(VENDOR, "action_provider", "action_provider_wh_dds.py")
dds_g1 = os.path.join(VENDOR, "dds", "g1_robot_dds.py")
if not os.path.exists(prov):
    print(f"    SKIP  vendor checkout not at {VENDOR} (set UNITREE_SIM_ISAACLAB); "
          f"every other check still runs")
else:
    src = squash(open(prov, encoding="utf-8").read())
    check("self._arm_source_indices=[idx+15foridxinself.arm_joint_mapping.values()]" in src,
          "the arm block is still read from motor_cmd.positions[15:29]")
    bad = [n for i, n in enumerate(M.ARM_JOINTS) if f'"{n}":{i}' not in src]
    check(not bad, "all 14 arm joints map to the slot ARM_JOINTS puts them in",
          "mismatched: " + ", ".join(bad) if bad else "14/14")
    lbad = [n for i, n in enumerate(M.ISAAC_LEFT_HAND) if f'"{n}":{i}' not in src]
    rbad = [n for i, n in enumerate(M.ISAAC_RIGHT_HAND) if f'"{n}":{i}' not in src]
    check(not lbad and not rbad,
          "both Dex3 mappings match ISAAC_LEFT_HAND / ISAAC_RIGHT_HAND",
          "mismatched: " + ", ".join(lbad + rbad) if (lbad or rbad) else "7+7")
    check('"right_hand_middle_0_joint":3' in src and '"right_hand_index_0_joint":5' in src,
          "the sim really does put right MIDDLE_0 where the robot has INDEX_0",
          "slot 3 = middle_0, slot 5 = index_0")
    check("full_action[self.waist_to_all_indices]=self.default_waist_positions" in src,
          "the waist is still overwritten with its default every step (PARKED)")
    check("ifleft_hand_cmdandright_hand_cmd:" in src,
          "the Dex3 block is still all-or-nothing — one hand alone moves NEITHER")
    check("full_action[self.action_to_indices]=action_data" in src
          and "self.action_buffer.compute(full_action[self.old_action_indices]" in src,
          "arm targets still enter the locomotion policy's action buffer "
          "(the live-only risk this cannot test)")
if not os.path.exists(dds_g1):
    print("    SKIP  dds/g1_robot_dds.py not found; the CRC contract is unchecked")
else:
    src2 = squash(open(dds_g1, encoding="utf-8").read())
    check("ifself.crc.Crc(msg)!=msg.crc:" in src2,
          "rt/lowcmd is still CRC-checked and DROPPED in silence on mismatch")
    check('ChannelSubscriber("rt/lowcmd",LowCmd_)' in src2,
          "and it is still the topic the bridge publishes", B.TOPIC_LOWCMD)

# --------------------------------------------------------------------------------
print("\n(3) the right-hand remap, by NAME, in both directions")
neodem = [10.0, 11.0, 12.0, 30.0, 31.0, 50.0, 51.0]   # thumb x3, index x2, middle x2
isaac = M.remap_right_hand(neodem, to="isaac")
by_name_src = M.right_hand_by_name(neodem, order="neodem")
by_name_wire = M.right_hand_by_name(isaac, order="isaac")
check(by_name_src == by_name_wire,
      "every joint keeps its own value across the remap (name -> value is invariant)",
      f"index_0 {by_name_wire['right_hand_index_0_joint']:.0f}, "
      f"middle_0 {by_name_wire['right_hand_middle_0_joint']:.0f}")
check(isaac == [10.0, 11.0, 12.0, 50.0, 51.0, 30.0, 31.0],
      "on the wire the sim's slots 3,4 carry MIDDLE and slots 5,6 carry INDEX",
      str([int(v) for v in isaac]))
check(isaac != neodem,
      "the remap is not a no-op — a silently-dropped remap would fail HERE")
check(M.remap_right_hand(isaac, to="neodem") == [float(v) for v in neodem],
      "and it round-trips exactly")
check(M.RIGHT_ISAAC_FROM_NEODEM == M.RIGHT_NEODEM_FROM_ISAAC,
      "this particular permutation is its own inverse (asserted, not assumed)",
      str(M.RIGHT_ISAAC_FROM_NEODEM))
# Without the remap, the four non-thumb slots are wrong and the three thumb slots
# are right -- which is exactly why the bug survives a casual look at a video.
wrong = [i for i in range(7) if neodem[i] != isaac[i]]
check(wrong == [3, 4, 5, 6],
      "skipping it scrambles the index/middle fingers and leaves the thumb correct",
      f"slots {wrong}")
check(raises(ValueError, M.remap_right_hand, neodem, to="sim"),
      "an unknown direction is refused, not guessed")
check(raises(TypeError, M.remap_right_hand, neodem),
      "`to=` is mandatory — 'remap the right hand' has no default direction")
check(raises(ValueError, M.remap_right_hand, [0.0] * 6, to="isaac"),
      "a 6-vector is refused")

# --------------------------------------------------------------------------------
print("\n(4) rt/lowcmd packing: only [15:29] is meaningful")
arm = [0.1 * (i + 1) for i in range(14)]
pos = M.pack_lowcmd_positions(arm)
check(len(pos) == 29, "a 29-entry positions array by default (the sim's minimum)",
      str(len(pos)))
check(all(v == 0.0 for v in pos[:15]),
      "legs [0:12] and waist [12:15] are zero — the sim drives them itself")
check(pos[15:29] == [float(v) for v in arm], "the arm lands at [15:29]")
check(M.unpack_lowcmd_positions(pos) == [float(v) for v in arm],
      "and unpacking recovers it")
check(M.unpack_lowcmd_positions(M.pack_lowcmd_positions(arm, 35))[3] == arm[3],
      "a real 35-motor LowCmd_ array works the same")
check(raises(ValueError, M.pack_lowcmd_positions, arm, 28),
      "a 28-entry array is refused: the sim's guard is `len(positions) >= 29`")
check(raises(ValueError, M.unpack_lowcmd_positions, [0.0] * 20),
      "and so is reading one back")
check(raises(ValueError, M.pack_lowcmd_positions, arm[:13]),
      "a 13-joint arm vector is refused")
check(raises(ValueError, M.pack_lowcmd_positions, arm[:13] + [float("nan")]),
      "a NaN target is refused — it would reach the locomotion policy's observation")

# --------------------------------------------------------------------------------
print("\n(5) clamping uses each joint's OWN limits, per side")
check(M.ARM_LIMITS[M.ARM_JOINTS.index("left_shoulder_roll_joint")] == (-1.5882, 2.2515)
      and M.ARM_LIMITS[M.ARM_JOINTS.index("right_shoulder_roll_joint")] == (-2.2515, 1.5882),
      "the shoulder roll limits are MIRRORED between left and right")
wide = M.clamp_arm([10.0] * 14)
check(all(v == hi for v, (lo, hi) in zip(wide, M.ARM_LIMITS)),
      "a huge command lands on each joint's own upper limit, not a shared one")
check(M.clamp_arm([-10.0] * 14)[M.ARM_JOINTS.index("right_shoulder_roll_joint")] == -2.2515,
      "the right shoulder is allowed further negative than the left")
# The failure this guards: applying the LEFT hand's limits to the RIGHT one. The
# two are mirrored, so every right-hand flexion target would clamp to zero and the
# hand would simply never close -- with no error anywhere.
rc = M.clamp_hand([0.0, 0.0, 0.0, 1.2, 1.4, 1.2, 1.4], side="right")
check(rc[3] == 1.2 and rc[4] == 1.4,
      "a right-hand index curl survives clamping", f"index {rc[3]:.2f}/{rc[4]:.2f}")
check(M.clamp(([1.2, 1.4]), [M.HAND_LIMITS["left"][5], M.HAND_LIMITS["left"][6]]) == [0.0, 0.0],
      "the SAME numbers under the LEFT hand's limits collapse to zero "
      "(what a side mix-up looks like)")
check(M.clamp_hand([-2.0] * 7, side="left") == list(l for l, _ in M.HAND_LIMITS["left"]),
      "left-hand clamping hits the left lower bounds")
check(raises(ValueError, M.clamp_hand, [0.0] * 7, side="both"),
      "an unknown side is refused")
check(raises(TypeError, M.clamp_hand, [0.0] * 7),
      "`side=` is mandatory")

# --------------------------------------------------------------------------------
print("\n(6) THE GRIP CODE — the single most expensive thing to get wrong")
OPEN_CODE = [0.0] * 7
CLOSE_CODE = [-1.0, -1.0, -1.0, -1.0, 0.0, 0.40, 0.70]

opened = M.decode_left_hand_grip_code(OPEN_CODE)
closed = M.decode_left_hand_grip_code(CLOSE_CODE)
check(all(abs(a - b) < 1e-9 for a, b in zip(opened, M.GRIP_OPEN_RAD)),
      "the all-zero code decodes to the measured OPEN pose",
      f"{[round(v, 4) for v in opened]}")
check(all(abs(a - b) < 1e-9 for a, b in zip(closed, M.GRIP_CLOSE_RAD)),
      "the ga=gb=1 code decodes to the measured CLOSE pose",
      f"{[round(v, 4) for v in closed]}")

# The disaster, asserted rather than described. Raw pass-through of a full-CLOSE
# code, clamped to the joint limits, is what the eval runner measured as 0/15.
raw = M.clamp_hand(CLOSE_CODE, side="left")
# "Away from closing" is defined per joint by the sign of CLOSE - OPEN, NOT by
# which limit happens to sit nearer OPEN: thumb_1's range is asymmetric, and the
# nearer-limit heuristic mislabels it.
away_bound = [lo if cl > o else hi
              for o, cl, (lo, hi) in zip(M.GRIP_OPEN_RAD, M.GRIP_CLOSE_RAD,
                                         M.HAND_LIMITS["left"])]
pinned = [i for i in range(1, 7) if abs(raw[i] - away_bound[i]) < 1e-9]
check(pinned == [1, 2, 4, 5, 6],
      "raw pass-through pins FIVE of the six coded joints on the bound AWAY from closing",
      "slots " + ", ".join(M.NEODEM_LEFT_HAND[i].replace("left_hand_", "").replace("_joint", "")
                           for i in pinned))
# Four of those five end up essentially at the OPEN pose -- a "closed" command that
# is in practice an open hand. (thumb_1 is the fifth and is the sign flip below.)
span = [abs(c - o) for o, c in zip(M.GRIP_OPEN_RAD, M.GRIP_CLOSE_RAD)]
as_open = [i for i in (2, 4, 5, 6)
           if abs(raw[i] - M.GRIP_OPEN_RAD[i]) < 0.25 * span[i]]
check(as_open == [2, 4, 5, 6],
      "thumb_2, middle_1, index_0 and index_1 land within 25% of OPEN, i.e. open",
      ", ".join(f"{abs(raw[i] - M.GRIP_OPEN_RAD[i]) / span[i]:.0%}" for i in as_open))
check(all(abs(closed[i] - M.GRIP_CLOSE_RAD[i]) < 1e-9 for i in (2, 4, 5, 6)),
      "while the DECODED vector puts those same four exactly at CLOSE")
check(raw[1] < 0.0 < closed[1],
      "and thumb_1 is not merely open but SIGN-FLIPPED",
      f"raw {raw[1]:+.4f} vs decoded {closed[1]:+.4f}")
err_raw = sum(abs(a - b) for a, b in zip(raw, M.GRIP_CLOSE_RAD))
err_dec = sum(abs(a - b) for a, b in zip(closed, M.GRIP_CLOSE_RAD))
check(err_raw > 2.0 and err_dec < 1e-9,
      "so the raw hand is nowhere near closed and the decoded one is exactly closed",
      f"L1 error {err_raw:.3f} rad raw vs {err_dec:.2e} decoded")
d_open = sum(abs(a - b) for a, b in zip(raw, M.GRIP_OPEN_RAD))
check(d_open < err_raw,
      "in fact the raw 'close' command is CLOSER to open than to closed",
      f"{d_open:.3f} rad from OPEN vs {err_raw:.3f} from CLOSE")

# Structure: the two free scalars drive different fingers, and are not swappable.
half_a = M.decode_left_hand_grip_code([-0.5, -0.5, 0.0, 0.0, -0.25, 0.20, 0.35])
half_b = M.decode_left_hand_grip_code([0.0, 0.0, -0.5, -0.5, +0.25, 0.20, 0.35])
check(abs(half_a[5] - (M.GRIP_OPEN_RAD[5] + 0.5 * (M.GRIP_CLOSE_RAD[5] - M.GRIP_OPEN_RAD[5]))) < 1e-9,
      "ga=0.5 puts the INDEX pair exactly half way", f"index_0 {half_a[5]:+.5f}")
check(abs(half_a[3] - M.GRIP_OPEN_RAD[3]) < 1e-9,
      "and leaves the MIDDLE pair fully open", f"middle_0 {half_a[3]:+.5f}")
check(abs(half_b[3] - half_a[5]) > 0.0 and abs(half_b[5] - M.GRIP_OPEN_RAD[5]) < 1e-9,
      "gb=0.5 does the mirror image — ga and gb are NOT interchangeable")
check(abs(half_a[1] - half_b[1]) < 1e-9 and half_a[1] > M.GRIP_OPEN_RAD[1],
      "the THUMB pair follows max(ga, gb) either way", f"thumb_1 {half_a[1]:+.5f}")
check(abs(opened[0] - closed[0]) < 1e-12 and abs(opened[0] - M.GRIP_OPEN_RAD[0]) < 1e-12,
      "thumb_0 is constant: the code carries none of it (R^2 = 0.011)",
      f"{opened[0]:+.5f} rad")

# A policy's continuous output will not respect the code's redundancy exactly.
sloppy = M.decode_left_hand_grip_code([-1.0, -0.9, 0.0, 0.0, -0.475, 0.40, 0.70])
check(abs(sloppy[1] - M.GRIP_CLOSE_RAD[1]) < 1e-9,
      "inconsistent duplicates: code[5]/code[6] still pin max(ga,gb) at 1.0",
      f"thumb_1 {sloppy[1]:+.5f}")
check(abs(sloppy[5] - (M.GRIP_OPEN_RAD[5] + 0.95 * (M.GRIP_CLOSE_RAD[5] - M.GRIP_OPEN_RAD[5]))) < 1e-9,
      "while the index pair averages the two ga duplicates (0.95)", f"{sloppy[5]:+.5f}")
check(all(lo - 1e-12 <= v <= hi + 1e-12
          for v, (lo, hi) in zip(M.decode_left_hand_grip_code([-5.0] * 4 + [0.0, 9.0, 9.0]),
                                 M.HAND_LIMITS["left"])),
      "an out-of-range code still decodes inside the joint limits")
check(raises(ValueError, M.decode_left_hand_grip_code, [0.0] * 6),
      "a 6-component code is refused")

print("\n(6b) ...and the API will not let a caller forget it")
check(raises(TypeError, M.hand_targets_rad, CLOSE_CODE, side="left"),
      "hand_targets_rad() has NO default units — omitting it is a TypeError")
check(raises(TypeError, M.targets_from_action31, [0.0] * 31),
      "targets_from_action31() likewise demands both *_units")
check(raises(TypeError, M.targets_from_action31, [0.0] * 31, left_hand_units=HandUnits.RADIANS),
      "naming only the left hand's units is still a TypeError")
check(raises(ValueError, M.hand_targets_rad, CLOSE_CODE, side="left", units="normalised"),
      "an invented units string is refused, not treated as radians")
check(raises(ValueError, M.hand_targets_rad, CLOSE_CODE, side="right",
             units=HandUnits.APPLE_PNP_GRIP_CODE),
      "the grip code is REFUSED for the right hand — no right-hand decoder exists")
check(M.hand_targets_rad(CLOSE_CODE, side="left", units=HandUnits.APPLE_PNP_GRIP_CODE) == closed,
      "with units named, the left hand decodes")
check(M.hand_targets_rad(CLOSE_CODE, side="left", units=HandUnits.RADIANS) == raw,
      "and RADIANS gives the raw (wrong-for-this-policy) answer, explicitly chosen")

# --------------------------------------------------------------------------------
print("\n(7) a 31-dim action becomes a complete frame")
action = [0.0] * 31
for i in range(14):
    action[i] = 0.05 * (i + 1)
action[14:21] = CLOSE_CODE
action[21:28] = [0.0, 0.0, 0.0, 1.2, 1.4, 0.0, 0.0]     # right index curl, radians
action[28:31] = [-0.12, 0.0, 0.0]                        # waist: accepted and discarded
t = M.targets_from_action31(action, left_hand_units=HandUnits.APPLE_PNP_GRIP_CODE,
                            right_hand_units=HandUnits.RADIANS)
check(len(t.arm) == 14 and len(t.left_hand) == 7 and len(t.right_hand) == 7,
      "14 + 7 + 7, both hands present (the sim applies neither if one is missing)")
check(all(abs(a - b) < 1e-9 for a, b in zip(t.left_hand, M.GRIP_CLOSE_RAD)),
      "the left-hand block was DECODED, not passed through")
check(t.right_hand[3] == 1.2 and t.right_hand[5] == 0.0,
      "the right-hand block stayed in NeoDEM order (index at slots 3,4)",
      f"{[round(v, 2) for v in t.right_hand]}")
check(M.remap_right_hand(t.right_hand, to="isaac")[5] == 1.2,
      "and only reaches Isaac order at the wire, where index moves to slots 5,6")
check(abs(t.arm[0] - 0.05) < 1e-9 and abs(t.arm[13] - 0.70) < 1e-9,
      "the arm block passed through, clamped")
check(raises(ValueError, M.targets_from_action31, [0.0] * 43,
             left_hand_units=HandUnits.RADIANS, right_hand_units=HandUnits.RADIANS),
      "a 43-dim STATE vector fed in by mistake is refused, not silently truncated")
check(M.REST.arm == (0.0,) * 14,
      "REST's arm is zero — the pose the sim holds when nothing publishes rt/lowcmd")
check(all(lo <= v <= hi for v, (lo, hi) in zip(M.REST.right_hand, M.HAND_LIMITS["right"])),
      "REST's mirrored right hand is inside the RIGHT hand's limits",
      f"{[round(v, 4) for v in M.REST.right_hand]}")
check(abs(M.REST.right_hand[3] + M.REST.left_hand[5]) < 1e-9,
      "and it is the left OPEN pose mirrored BY NAME (right index_0 = -left index_0)",
      f"{M.REST.right_hand[3]:+.5f} vs {M.REST.left_hand[5]:+.5f}")

# --------------------------------------------------------------------------------
print("\n(8) rate limiting and the shaper's clamp order")
lim = M.RateLimiter(0.2, 14)
first = lim.step([1.0] * 14)
check(first == [1.0] * 14,
      "the FIRST frame passes through unlimited — no invented ramp at episode start")
second = lim.step([2.0] * 14)
check(all(abs(v - 1.2) < 1e-12 for v in second),
      "the second is capped at max_delta from the first", f"{second[0]:.3f}")
check(all(abs(v - 1.0) < 1e-12 for v in lim.step([1.0] * 14)),
      "a small step is not stretched to the cap")
lim.reset([0.0] * 14)
check(all(abs(v - 0.2) < 1e-12 for v in lim.step([5.0] * 14)),
      "reset(state) ANCHORS: the next frame is limited away from the given pose")
lim.reset()
check(lim.step([5.0] * 14) == [5.0] * 14, "reset() with no pose forgets entirely")
check(M.RateLimiter(0.0, 7).step([9.0] * 7) == [9.0] * 7
      and M.RateLimiter(0.0, 7).step([9.0] * 7) == [9.0] * 7,
      "max_delta 0 disables limiting rather than freezing the joint")
check(raises(ValueError, M.RateLimiter, -1.0, 7), "a negative max_delta is refused")

# The creep bug: clamp BEFORE storing `prev`, or an out-of-range command parks the
# limiter beyond the joint limit and every later frame is limited away from a pose
# the joint was never in.
sh = M.ManipShaper(arm_rate=100.0, hand_rate=100.0)
sh.reset(M.REST)
far = M.ManipTargets.make([99.0] * 14, M.HAND_OPEN_LEFT, M.HAND_OPEN_RIGHT)
one = sh.shape(far)
check(all(abs(v - hi) < 1e-12 for v, (lo, hi) in zip(one.arm, M.ARM_LIMITS)),
      "an out-of-range arm command is clamped to the limits")
check(sh.arm.prev == list(one.arm),
      "and the limiter REMEMBERS the clamped value, not the 99.0 it was asked for",
      f"prev[0]={sh.arm.prev[0]:.4f}")
# The creep, made observable: hold an out-of-range command for six frames with a
# rate limit small enough that the limiter walks into the joint limit and sits
# there. If `prev` remembered the UNCLAMPED value it would keep marching past the
# limit, and the first frame back toward rest would still be pinned at the limit
# instead of moving. That is a robot that takes a second to respond after any
# saturated command.
HI0 = M.ARM_LIMITS[0][1]
sh2 = M.ManipShaper(arm_rate=1.0, hand_rate=1.0)
sh2.reset(M.REST)
for _ in range(6):
    sh2.shape(far)
check(abs(sh2.arm.prev[0] - HI0) < 1e-9,
      "six saturated frames leave the limiter AT the joint limit, not past it",
      f"prev[0]={sh2.arm.prev[0]:.4f}, limit {HI0:.4f}")
back = sh2.shape(M.REST)
check(abs(back.arm[0] - (HI0 - 1.0)) < 1e-9,
      "so the first frame back toward rest moves by a full rate-limit step",
      f"{back.arm[0]:+.4f} rad")
shaped = M.ManipShaper().shape(
    M.ManipTargets.make(M.ARM_ZERO, M.GRIP_CLOSE_RAD, M.REST.right_hand))
check(len(shaped.arm) == 14 and isinstance(shaped, M.ManipTargets),
      "shape() returns a complete ManipTargets")

# --------------------------------------------------------------------------------
print("\n(9) the bridge's own contract, read off its source (no DDS needed)")
check(B.TOPIC_LOWCMD == "rt/lowcmd" and B.TOPIC_HAND_CMD == "rt/dex3/{}/cmd",
      "the topics are the three the Wholebody provider reads",
      f"{B.TOPIC_LOWCMD}, {B.TOPIC_HAND_CMD}")
bsrc = open(os.path.join(_HERE, "isaac_manip_bridge.py"), encoding="utf-8").read()
check("self._msg_low.crc = self._crc.Crc(self._msg_low)" in bsrc,
      "it sets the CRC on every rt/lowcmd frame (the sim drops it otherwise)")
check('for side, vals in (("left", t.left_hand), ("right", t.right_hand)):' in bsrc,
      "it publishes BOTH hands every frame (the provider applies neither otherwise)")
check('M.remap_right_hand(vals, to="isaac") if side == "right" else' in bsrc,
      "and remaps only the right hand, at the wire")
check("if domain == 0:" in bsrc and "raise ValueError(" in bsrc,
      "domain 0 (the real robot) is refused, not warned about")
check("kp = 0.0" in bsrc.replace(".kp = 0.0", "kp = 0.0"),
      "gains go out as zero, so the same message is inert on real hardware")
check(B.DEFAULT_RATE_HZ >= 50.0,
      "the default publish rate is at least the sim's 50 Hz policy step",
      f"{B.DEFAULT_RATE_HZ:g} Hz")
# The non-negotiable one: nothing here may touch the locomotion bridge.
loco = open(os.path.join(_HERE, "isaac_loco_bridge.py"), encoding="utf-8").read()
# Asked as "does it IMPORT this", via the parse tree, not "does the word appear".
# A substring test also fires on a comment that merely names the sibling bridge --
# and the domain-0 refusal added in TASK-203 does exactly that, deliberately, to
# say the two bridges share a contract. Naming it is not depending on it. The AST
# also catches the spellings a substring test would miss on the other side:
# `importlib.import_module("isaac_manip")` and `__import__("isaac_manip")`.
_loco_imports = set()
for _n in ast.walk(ast.parse(loco)):
    if isinstance(_n, ast.Import):
        _loco_imports.update(a.name for a in _n.names)
    elif isinstance(_n, ast.ImportFrom) and _n.module:
        _loco_imports.add(_n.module)
    elif isinstance(_n, ast.Call):
        _f = _n.func
        _name = getattr(_f, "attr", None) or getattr(_f, "id", None)
        if _name in ("import_module", "__import__") and _n.args:
            _a = _n.args[0]
            if isinstance(_a, ast.Constant) and isinstance(_a.value, str):
                _loco_imports.add(_a.value)
_loco_offenders = sorted(m for m in _loco_imports if m.split(".")[0] == "isaac_manip")
check(not _loco_offenders,
      "isaac_loco_bridge.py does not import this at all — its 100 Hz loop is untouched",
      f"{len(_loco_imports)} modules imported, none of them this one"
      if not _loco_offenders else f"IMPORTS {', '.join(_loco_offenders)}")
check('ap.add_argument("--rate", type=float, default=100.0' in loco,
      "and it still publishes rt/run_command/cmd at 100 Hz")

# --------------------------------------------------------------------------------
# Everything below drives the PUBLISHER, not just the maths, so it needs the SDK
# names `ManipPublisher.__init__` imports. A stand-in is installed instead of the
# real `unitree_sdk2py` -- and it would be installed even if the real one were
# available, because the point is to exercise the publish path without a DDS
# participant, a domain, or a single datagram leaving this process. `Write()`
# records what it was handed; that recording IS the wire, for these checks.
class _FakeMotor:
    __slots__ = ("q", "kp", "kd", "dq", "tau")

    def __init__(self):
        self.q = self.kp = self.kd = self.dq = self.tau = 0.0


class _FakeMsg:
    def __init__(self, n):
        self.motor_cmd = [_FakeMotor() for _ in range(n)]
        self.crc = 0


WIRE = []          # (topic, [q for every motor slot]) in publish order


def _install_fake_sdk():
    import types
    class _FakePub:
        def __init__(self, topic, _t):
            self.topic = topic

        def Init(self):
            pass

        def Write(self, msg):
            WIRE.append((self.topic, [m.q for m in msg.motor_cmd]))

    class _FakeCRC:
        def Crc(self, _msg):
            return 0xC0FFEE

    def _refuse_init(*_a, **_kw):
        # If this ever runs, the check calling it asked for a real DDS
        # participant, which this file must never create.
        raise AssertionError("ChannelFactoryInitialize() must not be called offline")

    mods = {
        "unitree_sdk2py": {},
        "unitree_sdk2py.core": {},
        "unitree_sdk2py.core.channel": {"ChannelPublisher": _FakePub,
                                        "ChannelFactoryInitialize": _refuse_init},
        "unitree_sdk2py.idl": {},
        "unitree_sdk2py.idl.default": {
            "unitree_hg_msg_dds__LowCmd_": lambda: _FakeMsg(35),
            "unitree_hg_msg_dds__HandCmd_": lambda: _FakeMsg(M.N_HAND)},
        "unitree_sdk2py.idl.unitree_hg": {},
        "unitree_sdk2py.idl.unitree_hg.msg": {},
        "unitree_sdk2py.idl.unitree_hg.msg.dds_": {"LowCmd_": object, "HandCmd_": object},
        "unitree_sdk2py.utils": {},
        "unitree_sdk2py.utils.crc": {"CRC": _FakeCRC},
    }
    for name, attrs in mods.items():
        mod = types.ModuleType(name)
        for k, v in attrs.items():
            setattr(mod, k, v)
        sys.modules[name] = mod


_install_fake_sdk()


def arm_on_wire(index=-1):
    """The 14 arm targets of the `index`-th rt/lowcmd frame recorded so far."""
    lows = [w for w in WIRE if w[0] == B.TOPIC_LOWCMD]
    return None if not lows else lows[index][1][15:29]


print("\n(10) a bad frame is refused on the PRODUCER's thread, not the publisher's")
# The defect, stated once: `ManipTargets` is a NamedTuple, so `ManipTargets(a,b,c)`
# builds one out of anything without going near `.make()`, and `set_targets()` used
# to store whatever it was handed. The first code to look at the numbers was then
# `shape()`, ON THE PUBLISH THREAD -- see (11) for what that costs. Validation
# belongs on the way in, where the producer can drop the frame and carry on.
pub = B.ManipPublisher(1, rate_hz=200.0, verbose=False, init_dds=False)
pub._shaper.reset(M.REST)
NAN_FRAME = M.ManipTargets((float("nan"),) + M.ARM_ZERO[1:],
                           M.HAND_OPEN_LEFT, M.HAND_OPEN_RIGHT)
SHORT_FRAME = M.ManipTargets((0.0,) * 13, M.HAND_OPEN_LEFT, M.HAND_OPEN_RIGHT)
SHORT_HAND = M.ManipTargets(M.ARM_ZERO, (0.0,) * 6, M.HAND_OPEN_RIGHT)
check(raises(ValueError, pub.set_targets, NAN_FRAME),
      "set_targets(NaN) raises on the CALLER's thread — a policy hears about its own "
      "bad frame")
check(raises(ValueError, pub.set_targets, SHORT_FRAME),
      "a 13-joint arm vector is refused the same way")
check(raises(ValueError, pub.set_targets, SHORT_HAND),
      "and so is a 6-value hand — both hands are mandatory and both are 7")
check(raises(TypeError, pub.set_targets, None),
      "None is a TypeError, not an AttributeError three frames later")
check(pub.targets == M.REST,
      "and after all four refusals the slot still holds the last GOOD frame",
      "REST")
_good = M.ManipTargets.make([0.1] * 14, M.HAND_OPEN_LEFT, M.HAND_OPEN_RIGHT)
pub.set_targets(_good)
check(pub.targets == _good and isinstance(pub.targets.arm, tuple),
      "a valid frame still lands, normalised to tuples (the slot stays immutable)")

print("\n(11) a stop is ALWAYS reachable — a poisoned slot cannot latch the arms")
# THE CHAIN THIS PINS. A NaN reaches `shape()` on the publish thread; `run()`
# catches the ValueError and calls `shutdown()`; `shutdown()` blended out of the
# SAME poisoned slot and raised again; the handler printed "rest-pose stop failed"
# and returned, having published nothing. rt/lowcmd LATCHES, so the sim then holds
# the last commanded arm pose indefinitely — the arms freeze mid-reach, which this
# bridge's own comments call worse than a stop.
#
# Two things break the chain and both are checked: the ramp starts from the last
# frame actually PUBLISHED rather than from the slot, and a ramp that raises
# anyway falls back to publishing REST directly.
WIRE.clear()
stopper = B.ManipPublisher(1, rate_hz=200.0, verbose=False, init_dds=False)
stopper._shaper.reset(M.REST)
REACH = M.ManipTargets.make([0.4] * 14, M.GRIP_CLOSE_RAD, M.REST.right_hand)
stopper.set_targets(REACH)
stopper._publish(stopper._shaper.shape(stopper.targets))   # one loop iteration
check(arm_on_wire()[0] != 0.0, "the arms are out at a non-rest pose to begin with",
      f"arm[0]={arm_on_wire()[0]:+.3f}")
stopper._slot = (NAN_FRAME, 99)          # what a direct ManipTargets() still allows
_n_before = len(WIRE)
_raised = False
try:
    stopper.shutdown(ramp_s=0.05)
except Exception:                        # noqa: BLE001
    _raised = True
check(not _raised, "shutdown() from a POISONED slot does not raise")
check(len(WIRE) > _n_before, "it publishes rather than returning empty-handed",
      f"{len(WIRE) - _n_before} messages")
check(arm_on_wire() == list(M.REST.arm),
      "and the LAST rt/lowcmd frame on the wire is the rest pose — this is the check "
      "that fails when the ramp blends out of the slot",
      f"arm[0]={arm_on_wire()[0]:+.3f}")

# The same thing again through the real failure path: the publish loop itself,
# started on a slot it cannot publish.
WIRE.clear()
dying = B.ManipPublisher(1, rate_hz=200.0, verbose=False, init_dds=False)
dying._shaper.reset(M.REST)
dying.set_targets(REACH)
dying._publish(dying._shaper.shape(dying.targets))
dying._slot = (NAN_FRAME, 7)
_t = threading.Thread(target=dying.run)
_t.start()
_t.join(timeout=5.0)
check(not _t.is_alive(), "run() exits when its slot cannot be shaped")
check(isinstance(dying.error, ValueError),
      "it records the error for main() to exit non-zero on", repr(dying.error)[:44])
check(arm_on_wire() == list(M.REST.arm),
      "and it still leaves the arms AT REST on the wire, not latched mid-reach",
      f"arm[0]={arm_on_wire()[0]:+.3f}")

# The sleep has to be interruptible or `main()`'s 2 s join returns with the loop
# still inside it, and then shutdown() and the loop are both in the one shared
# LowCmd_ message that CycloneDDS serialises in C. One period at 0.5 Hz is 2 s,
# so this rate is exactly where a `time.sleep()` stops being joinable.
slow = B.ManipPublisher(1, rate_hz=0.5, verbose=False, init_dds=False)
slow._shaper.reset(M.REST)
_t2 = threading.Thread(target=slow.run, daemon=True)
_t2.start()
time.sleep(0.1)
_t0 = time.monotonic()
slow._stop.set()
# A QUARTER of the 2 s period, deliberately: joining for a whole one would let an
# uninterruptible time.sleep() finish its period and pass this by luck.
_t2.join(timeout=0.5)
check(not _t2.is_alive(),
      "at 0.5 Hz the publish loop joins within a quarter of its own period — the "
      "period is a _stop.wait(), not a time.sleep()",
      f"joined in {time.monotonic() - _t0:.3f} s")

print("\n(11b) the bridge refuses domain 0 with an exit code a script can read")
check(raises(ValueError, B.ManipPublisher, 0),
      "ManipPublisher(0) raises — domain 0 is the real robot's low-level bus")
_argv, sys.argv = sys.argv, ["isaac_manip_bridge.py", "--domain", "0"]
_err = io.StringIO()
try:
    with contextlib.redirect_stderr(_err):
        _rc = B.main()
finally:
    sys.argv = _argv
check(_rc == 2,
      "and main() returns 2, not 1 — a refusal is distinguishable from a crash",
      f"exit {_rc}")
check("refused" in _err.getvalue(),
      "having said so on stderr, where the bringup script's log tail will find it",
      _err.getvalue().strip()[:60])

# --------------------------------------------------------------------------------
print("\n(12) factory_mission_bringup.sh's domain-0 guard, EXECUTED (not read)")
SCRIPT = os.path.join(_HERE, "factory_mission_bringup.sh")
GUARD_START = "# --- domain guard"
GUARD_END = "# --- end domain guard"
if not os.path.exists(SCRIPT) or not shutil.which("bash"):
    print("    SKIP  factory_mission_bringup.sh or bash not available")
else:
    ssrc = open(SCRIPT, encoding="utf-8").read()
    _lines = ssrc.splitlines()
    _a = next((i for i, l in enumerate(_lines) if l.startswith(GUARD_START)), None)
    _b = next((i for i, l in enumerate(_lines) if l.startswith(GUARD_END)), None)
    check(_a is not None and _b is not None and _b > _a,
          "the guard is delimited so this file can run the REAL text, not a copy of it",
          f"lines {None if _a is None else _a + 1}-{None if _b is None else _b + 1}")
    GUARD = "\n".join(_lines[_a:_b + 1]) if (_a is not None and _b is not None) else ""
    # The checks below that assert something is GONE have to read the script's
    # code and not its prose: several of them name the very construct they
    # replaced, in a comment explaining why it is wrong, and a substring search
    # over the whole file cannot tell the two apart.
    scode = "\n".join(l for l in _lines if not l.lstrip().startswith("#"))

    def domain_verdict(value):
        """Run the script's own guard with `die` stubbed. True = the value passed."""
        prelude = ('set -uo pipefail\n'
                   'die() { printf "FATAL: %s\\n" "$*" >&2; exit 3; }\n')
        proc = subprocess.run(["bash", "-c", prelude + GUARD + "\nexit 0"],
                              env={**os.environ, "DOMAIN": str(value)},
                              capture_output=True, text=True)
        return proc.returncode == 0

    # `[ "$DOMAIN" = "0" ]` -- the guard this replaced -- passes every one of these,
    # and argparse's type=int makes all four of them domain ZERO in Python. Domain 0
    # is a live G1's rt/lowcmd bus and this stack writes zeros into its leg slots.
    REFUSE = ["0", "00", "000", " 0", "0 ", "+0", "-0", "0x0", "0.0", "", "x", "1;0"]
    passed = [v for v in REFUSE if domain_verdict(v)]
    check(not passed,
          "every spelling of zero, and every non-number, is REFUSED",
          "leaked: " + ", ".join(repr(v) for v in passed) if passed
          else f"{len(REFUSE)}/{len(REFUSE)} refused")
    # 08 is the one that catches a numeric comparison written without `10#`: bash
    # reads a leading zero as octal and 08 is not a legal octal literal, so the
    # guard would die with an arithmetic error instead of a verdict.
    ALLOW = ["1", "9", "01", "08", "42"]
    blocked = [v for v in ALLOW if not domain_verdict(v)]
    check(not blocked,
          "while every real sim domain still passes, leading zeros and 08 included",
          "blocked: " + ", ".join(blocked) if blocked else ", ".join(ALLOW))
    check('[ "$DOMAIN" = "0" ]' not in scode,
          "and the string compare that let 00 through is gone from the script")
    check('=~ ^[0-9]+$' in scode and "10#$DOMAIN == 0" in scode,
          "the guard is a digits check followed by a NUMERIC comparison")

    # ----------------------------------------------------------------------------
    print("\n(13) ...and the three other things that script got wrong")
    def line_of(needle):
        return next((i for i, l in enumerate(_lines) if needle in l), None)

    # C1: the VRAM check has to run BEFORE anything is killed, or it is measuring
    # the memory the kill sweep just freed. Asserted by line number, because that
    # is the whole of the defect.
    _gpu = line_of("nvidia-smi --id=")
    _kill = line_of("STALE+=(")
    if _kill is None:
        _kill = line_of("pkill -f")
    check(_gpu is not None and _kill is not None and _gpu < _kill,
          "the GPU guard runs BEFORE the process sweep, not after it",
          f"nvidia-smi at line {None if _gpu is None else _gpu + 1}, "
          f"first kill at {None if _kill is None else _kill + 1}")
    # `[s]im_node.py` -- the bracket trick that kept pkill from matching the
    # script's own command line -- is the form this actually appeared in, so undo
    # it before searching or the search misses the line it exists to find.
    unbracketed = scode.replace("[", "").replace("]", "")
    check("sim_node.py" not in unbracketed,
          "sim_node.py is no longer swept — this script never starts the MuJoCo sim")
    check('pgrep -u "$ME"' in scode,
          "the sweep is scoped to one user's processes")
    check("KILL_STALE" in scode and "consent was not given" in scode,
          "and nothing this script did not start is killed without explicit consent")

    # C2: /health's `connected` is copied from the SIDECAR when --sidecar-url is
    # set, so it is true the moment g1_sidecar.py answers and says nothing at all
    # about whether a camera frame has ever arrived. Gating on it made the "NO
    # CAMERA FRAME" warning unreachable -- and that warning is the one question
    # this rig exists to answer.
    check('grep -q \'"connected": *true\'' not in scode,
          "the camera gate no longer reads /health's `connected` (the sidecar's, "
          "not the cameras')")
    check("/cameras/$CAM_NAME/snapshot" in scode,
          "it calls the exact route Agent Mode's `look` calls, which 503s without a frame")

    # C5.
    check("trap cleanup EXIT" in scode and "PIDS+=(" in scode,
          "there is an EXIT trap, and it can only reach pids this script recorded")
    check("ISAAC_UP" in scode and "did not announce its image server" in scode,
          "the Isaac readiness loop now DIES on timeout instead of falling through")
    check(scode.count('watch_pid "$') >= 5,
          "every background process started is checked for liveness afterwards",
          f"{scode.count('watch_pid \"$')} call sites")

print()
if FAILURES:
    print(f"FAILED: {len(FAILURES)} check(s): {FAILURES}")
    sys.exit(1)
print("all isaac_manip offline checks passed")
