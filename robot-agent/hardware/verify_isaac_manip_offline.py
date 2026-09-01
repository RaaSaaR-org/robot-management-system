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
import json
import math
import os
import re
import shutil
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer

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


def _request(req):
    """-> (status, parsed body). An HTTP error is a RESULT here, not a raise: every
    refusal this file checks is a non-2xx whose body carries the diagnosis."""
    try:
        with urllib.request.urlopen(req, timeout=5.0) as res:
            raw, code = res.read(), res.status
    except urllib.error.HTTPError as exc:
        raw, code = exc.read(), exc.code
    try:
        return code, json.loads(raw or b"{}")
    except json.JSONDecodeError:
        return code, {}


def post_json(url, payload):
    """POST `payload` as JSON (bytes are sent verbatim, to test malformed bodies)."""
    data = payload if isinstance(payload, bytes) else json.dumps(payload).encode()
    return _request(urllib.request.Request(
        url, method="POST", data=data,
        headers={"Content-Type": "application/json"}))


def get_json(url):
    return _request(urllib.request.Request(url, method="GET"))


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

# --------------------------------------------------------------------------------
print("\n(14) the HTTP command inlet — the vocabulary, as a pure function")
# WHY THIS SECTION EXISTS. `isaac_manip_bridge.py` had no command inlet at all: its
# only producers were in-process, so a VLA rollout POSTed name-keyed joint dicts at
# the camera facade, which proxied them to g1_sidecar.py's /action -- a REAL-ROBOT
# path that cannot serve this rig under any setting (no lerobot in the interpreter,
# DDS domain 0 hardcoded, no Dex3 publisher). The simulated arms could not be moved.
# Everything below drives the inlet that fixes that, with DDS off.

# The exact 31 keys `src/vla/action-contracts.ts::G1_APPLE_ACTION_JOINT_NAMES`
# builds, in its order: [L-arm 7 | R-arm 7 | L-hand 7 | R-hand 7 | waist 3].
CONTRACT_KEYS = list(M.ARM_JOINTS) + list(M.NEODEM_LEFT_HAND) \
    + list(M.NEODEM_RIGHT_HAND) + list(M.WAIST_JOINTS)
check(len(CONTRACT_KEYS) == 31,
      "the caller's contract is 31 joints: 14 arm + 7 + 7 hand + 3 waist",
      str(len(CONTRACT_KEYS)))

full = {n: 0.0 for n in CONTRACT_KEYS}
_t, rep = B.split_joint_dict(full, M.REST)
check(rep["applied"] == 28, "a full 31-joint frame applies 28", str(rep["applied"]))
check(rep["ignored"] == list(M.WAIST_JOINTS),
      "…and names the three it dropped, in the order they were sent",
      ", ".join(rep["ignored"]))
check("parked by the wholebody provider" in rep.get("reason", ""),
      "…with the REASON on the wire, not only in a comment nobody reads",
      rep.get("reason", "")[:60] + "…")
check(rep["unknown"] == [] and rep["rejected"] == [] and rep["clamped"] == [],
      "…and nothing unknown, rejected or clamped for a well-formed frame")

print("\n  (14a) names are read into SLOTS BY NAME — the two hands disagree on order")
# `g1_sidecar.py::_get_state_readonly` indexes ONE thumb->index->middle table
# positionally for both hands and mislabels the left hand to this day. The left
# hand is wired thumb -> MIDDLE -> index. A positional split here would put the
# left index finger's target on the left middle finger, in the four numbers that
# only carry anything during a grasp.
probe_vals = {"left_hand_index_0_joint": -1.1, "left_hand_middle_0_joint": -0.2,
              "right_hand_index_0_joint": 1.2, "right_hand_middle_0_joint": 0.3}
t_named, _ = B.split_joint_dict(probe_vals, M.REST)
lh = dict(zip(M.NEODEM_LEFT_HAND, t_named.left_hand))
rh = dict(zip(M.NEODEM_RIGHT_HAND, t_named.right_hand))
check(lh["left_hand_index_0_joint"] == -1.1 and lh["left_hand_middle_0_joint"] == -0.2,
      "the LEFT index and middle targets land on the joints they name",
      f"index_0={lh['left_hand_index_0_joint']} middle_0={lh['left_hand_middle_0_joint']}")
check(rh["right_hand_index_0_joint"] == 1.2 and rh["right_hand_middle_0_joint"] == 0.3,
      "…and so do the RIGHT ones, whose slot order is the other one")
check(M.NEODEM_LEFT_HAND.index("left_hand_index_0_joint")
      != M.NEODEM_RIGHT_HAND.index("right_hand_index_0_joint"),
      "…which is a real check because index_0 sits at a DIFFERENT slot per hand",
      f"left {M.NEODEM_LEFT_HAND.index('left_hand_index_0_joint')} vs "
      f"right {M.NEODEM_RIGHT_HAND.index('right_hand_index_0_joint')}")

# …and through to the wire, where the right hand — and only the right hand — is
# permuted into Isaac's order. Published from a NON-running publisher so the frame
# on the wire is exactly the frame handed in, with no loop racing it.
WIRE.clear()
wirepub = B.ManipPublisher(1, rate_hz=50.0, verbose=False, init_dds=False)
wirepub._shaper.reset(t_named)          # anchor, so the rate limiter passes it through
wirepub._publish(wirepub._shaper.shape(t_named))
right_frame = [w for w in WIRE if w[0] == B.TOPIC_HAND_CMD.format("right")][-1][1]
left_frame = [w for w in WIRE if w[0] == B.TOPIC_HAND_CMD.format("left")][-1][1]
check(right_frame[M.ISAAC_RIGHT_HAND.index("right_hand_index_0_joint")] == 1.2,
      "on rt/dex3/right/cmd the right index_0 target is in ISAAC's slot for it (5)",
      f"slot {M.ISAAC_RIGHT_HAND.index('right_hand_index_0_joint')}")
check(right_frame[M.NEODEM_RIGHT_HAND.index("right_hand_index_0_joint")] != 1.2,
      "…and NOT in the NeoDEM slot (3), which is where the middle finger is in Isaac "
      "— the remap is doing its job")
check(left_frame[M.NEODEM_LEFT_HAND.index("left_hand_index_0_joint")] == -1.1,
      "…while the LEFT hand is published unpermuted, because the two orders agree there")

print("\n  (14b) THE HANDS ARE RADIANS AND ARE NOT DECODED A SECOND TIME")
# The measured failure, from both directions. `action-contracts.ts` has ALREADY run
# decodeLeftHandGrip over action[14:21] before it posts. If this inlet decoded again,
# it would read an already-decoded CLOSE (~-0.7 rad on the finger joints) as a
# NEGATIVE grip, clamp it to zero, and hand back the OPEN pose — the hand opens at
# the instant the policy meant it to close. Same 0/15-vs-13/15 failure as sending the
# code raw, reached from the opposite side and far harder to see.
closed = dict(zip(M.NEODEM_LEFT_HAND, M.GRIP_CLOSE_RAD))
t_closed, rep_closed = B.split_joint_dict(closed, M.REST)
check(list(t_closed.left_hand) == list(M.GRIP_CLOSE_RAD),
      "a decoded CLOSE pose passes through the inlet UNCHANGED",
      f"middle_1={t_closed.left_hand[4]:+.3f}")
double = M.decode_left_hand_grip_code(M.GRIP_CLOSE_RAD)
check(list(t_closed.left_hand) != double,
      "…and is NOT what a second decode would produce — the two disagree")
# HOW MUCH a second decode costs, as a fraction of the commanded travel from OPEN
# to CLOSE. Measured rather than asserted: feeding an already-decoded CLOSE back
# through the decoder reads its negative finger angles as a NEGATIVE grip, clamps
# ga and gmax_obs to zero, and leaves only gb ≈ 0.11 — so the hand travels about a
# ninth of the way and the grasp is, for any practical purpose, an open hand.
travel = [(d - o) / (c - o) for d, o, c in
          zip(double, M.GRIP_OPEN_RAD, M.GRIP_CLOSE_RAD) if abs(c - o) > 1e-9]
check(max(travel) < 0.15,
      "…because a second decode collapses a full CLOSE to a fraction of its travel — "
      "near enough to OPEN to drop whatever is being held",
      f"{max(travel) * 100:.0f}% closed at most; middle_1 {double[4]:+.3f} rad vs "
      f"commanded {M.GRIP_CLOSE_RAD[4]:+.3f}")
check(rep_closed["clamped"] == [],
      "…and the closing grip is NOT clamped away on the way through")
_src_bridge = open(os.path.join(_HERE, "isaac_manip_bridge.py"), encoding="utf-8").read()
_action_fn = _src_bridge.split("    def action(body: dict)")[1].split("    def estop(")[0]
check("APPLE_PNP_GRIP_CODE" not in _action_fn.split('"""')[2]
      if _action_fn.count('"""') >= 2 else True,
      "the /action code path never names APPLE_PNP_GRIP_CODE outside its own comment")
check("set_action31" not in _action_fn.replace("`set_action31()`", ""),
      "…and does not route through set_action31(), whose units= question is already "
      "answered by the time a name-keyed dict exists")

print("\n  (14c) the clamp uses the MJCF's limits, not the sidecar's sign-flipped table")
# g1_sidecar.py::POS_LIMITS declares left_hand_index_1_joint and
# left_hand_middle_1_joint as (0.0, +1.7453). The MJCF
# (sim_evaluator/mjcf/g1_dex3/g1_43dof_fixedbase_realism.xml) says (-1.74533, 0.0).
# The sign is flipped, so a correctly decoded CLOSING grip clamps straight back to
# OPEN — on exactly the two fingers doing the grasping.
for _j in ("left_hand_index_1_joint", "left_hand_middle_1_joint"):
    check(B.LIMITS_BY_NAME[_j] == (-1.74533, 0.0),
          f"{_j} is (-1.74533, 0.0) here", str(B.LIMITS_BY_NAME[_j]))
check(M.clamp_hand(M.GRIP_CLOSE_RAD, side="left") == list(M.GRIP_CLOSE_RAD),
      "…so the full CLOSE pose survives the clamp intact. Under the sidecar's table "
      "every negative finger target would clamp to 0.0, i.e. to OPEN")
check(len(B.LIMITS_BY_NAME) == 28 and not (B.COMMANDABLE & B.WAIST_SET),
      "the limit table covers exactly the 28 commandable joints and no waist joint",
      f"{len(B.LIMITS_BY_NAME)} joints")

print("\n  (14d) what the inlet refuses, and what it merely reports")
_t, rep_unknown = B.split_joint_dict(
    {"left_elbow_joint": 0.3, "elbow": 1.0, "left_hip_pitch_joint": 0.2}, M.REST)
check(rep_unknown["unknown"] == ["elbow", "left_hip_pitch_joint"],
      "an unknown name is REPORTED, not silently skipped — a caller has no other way "
      "to learn its vocabulary drifted", str(rep_unknown["unknown"]))
check(rep_unknown["applied"] == 1,
      "…while the joints it does know are still applied", str(rep_unknown["applied"]))
check("left_hip_pitch_joint" in rep_unknown["unknown"],
      "…and a LEG is unknown here: this bridge publishes rt/lowcmd[15:29] only, and "
      "the legs belong to the locomotion policy")
_t, rep_bad = B.split_joint_dict(
    {"left_elbow_joint": float("nan"), "left_wrist_roll_joint": "0.5",
     "left_shoulder_roll_joint": True, "right_elbow_joint": 0.2}, M.REST)
check(len(rep_bad["rejected"]) == 3 and rep_bad["applied"] == 1,
      "a NaN, a string and a bool are each rejected BY NAME; the good joint still lands",
      "; ".join(rep_bad["rejected"])[:80])
_t, rep_clamp = B.split_joint_dict({"left_elbow_joint": 99.0}, M.REST)
check(rep_clamp["clamped"] == ["left_elbow_joint"] and rep_clamp["applied"] == 1,
      "an out-of-range target is accepted and the clamp is DISCLOSED — a silent clamp "
      "on a finger is how a closing grasp arrives open")

print("\n  (14e) …the same, over a real HTTP server on an ephemeral loopback port")
# A live publish loop, because the inlet refuses /action while the loop is dead --
# and that refusal is itself checked below. Still no DDS: the fake SDK's
# ChannelFactoryInitialize raises if anything asks for a participant.
WIRE.clear()
inlet_pub = B.ManipPublisher(1, rate_hz=50.0, verbose=False, init_dds=False)
inlet_pub._shaper.reset(M.REST)
inlet_worker = threading.Thread(target=inlet_pub.run, daemon=True)
inlet_worker.start()
httpd = B.serve(inlet_pub, "127.0.0.1", 0)
BASE = f"http://127.0.0.1:{httpd.server_address[1]}"
try:
    code, body = post_json(f"{BASE}/action", full)
    check(code == 200 and body.get("ok") is True,
          "POST /action with the caller's 31 joints answers 200 ok", str(code))
    check(body.get("applied") == 28,
          "…applied 28", str(body.get("applied")))
    check(body.get("ignored") == list(M.WAIST_JOINTS)
          and "parked by the wholebody provider" in body.get("reason", ""),
          "…and reported the 3 waist keys it dropped, with the reason",
          f"{body.get('ignored')}")
    check(body.get("units") == "radians",
          "…and states its units on every reply — the one fact that, when it was "
          "wrong, was worth 0/15 against 13/15")
    check(body.get("unknown") == [] and body.get("rejected") == []
          and body.get("clamped") == [] and isinstance(body.get("seq"), int),
          "…with the empty unknown/rejected/clamped lists and a sequence number")

    code, body = post_json(f"{BASE}/action", {"elbow": 0.3, "left_elbow_joint": 0.3})
    check(code == 200 and body.get("unknown") == ["elbow"] and body.get("applied") == 1,
          "an unknown joint name comes back in the reply and the rest still applies",
          str(body.get("unknown")))

    code, body = post_json(f"{BASE}/action", {"elbow": 0.3, "waist_yaw_joint": 0.1})
    check(code == 400 and body.get("ok") is False,
          "a request with NO commandable joint is refused, not answered 'ok, 0 applied' "
          "— that reads as a policy holding still", str(code))
    check(body.get("unknown") == ["elbow"] and body.get("ignored") == ["waist_yaw_joint"],
          "…and the refusal still carries the diagnosis", str(body))

    code, body = post_json(f"{BASE}/action", {"left_elbow_joint": "0.5"})
    check(code == 400 and "must be a number" in body.get("error", "")
          and "left_elbow_joint" in body.get("error", ""),
          "a string where a number belongs is a 400 naming the JOINT — and not the "
          "no-such-joint message, which would send an operator after the wrong bug",
          body.get("error", "")[:70])
    check(body.get("rejected") == ["left_elbow_joint: value must be a number, got str"],
          "…with the same fact in the `rejected` list", str(body.get("rejected")))
    code, body = post_json(f"{BASE}/action", b"not json")
    check(code == 400 and "not JSON" in body.get("error", ""),
          "a malformed body is a 400, not a 500", str(body.get("error"))[:50])
    code, body = post_json(f"{BASE}/action", [1, 2, 3])
    check(code == 400 and "JSON object" in body.get("error", ""),
          "…and so is a JSON array — the shape is a name-keyed dict",
          str(body.get("error"))[:60])

    print("\n  (14f) /health answers the questions an operator asks first")
    code, h = get_json(f"{BASE}/health")
    check(code == 200 and h.get("status") == "ok", "GET /health -> 200 ok", str(code))
    check(h.get("domain") == 1 and h.get("iface") is None,
          "…reporting the DDS domain and interface", f"domain={h.get('domain')}")
    check(h.get("dds_initialised") is False,
          "…and whether THIS process opened the participant (false here: init_dds=False)")
    check(h.get("rate_hz") == 50.0 and h.get("frames_sent") > 0
          and h.get("publishing") is True,
          "…the publish rate, the frame count and that the loop is alive",
          f"{h.get('frames_sent')} frames @ {h.get('rate_hz')} Hz")
    check(isinstance(h.get("last_action"), dict)
          and h["last_action"]["age_s"] < 5.0 and h["last_action"]["applied"] == 1,
          "…and WHEN the last /action arrived, with what it applied",
          str(h.get("last_action")))
    check(h.get("unknown_joints_seen") == ["elbow"],
          "…plus every joint name it has been asked for and does not have, "
          "accumulated — a per-request list only helps a caller that reads bodies",
          str(h.get("unknown_joints_seen")))
    check(h.get("ignored_joints") == sorted(M.WAIST_JOINTS)
          and h.get("commandable_joints") == 28,
          "…and its vocabulary: 28 commandable, 3 parked")

    print("\n  (14g) /estop ramps to the rest pose, because rt/lowcmd LATCHES")
    # HardwareClient.releaseAction() POSTs this. With the arms out, a stop that
    # publishes nothing leaves the sim holding the reach for ever.
    reach = {n: 0.4 for n in M.ARM_JOINTS}
    post_json(f"{BASE}/action", reach)
    deadline = time.monotonic() + 2.0
    while time.monotonic() < deadline and (arm_on_wire() or [0.0])[0] < 0.39:
        time.sleep(0.02)
    check(abs((arm_on_wire() or [0.0])[0] - 0.4) < 1e-6,
          "the arms are out at a commanded reach to begin with",
          f"arm[0]={(arm_on_wire() or [0.0])[0]:+.3f}")
    code, body = post_json(f"{BASE}/estop", {})
    check(code == 200 and body.get("ok") is True and body.get("action") == "ramp-to-rest",
          "POST /estop answers 200 and says it is a RAMP, not an instant stop", str(body.get("action")))
    check(isinstance(body.get("eta_s"), (int, float)) and body["eta_s"] > 0,
          "…with how long the ramp will take", f"{body.get('eta_s')} s")
    deadline = time.monotonic() + 3.0
    while time.monotonic() < deadline and arm_on_wire() != list(M.REST.arm):
        time.sleep(0.02)
    check(arm_on_wire() == list(M.REST.arm),
          "…and the arms REACH the rest pose on the wire — an /estop that published "
          "nothing would leave them latched mid-reach for ever",
          f"arm[0]={arm_on_wire()[0]:+.3f}")
    check(list(inlet_pub.targets.left_hand) == list(M.HAND_OPEN_LEFT),
          "…with both hands back open")
    code, h = get_json(f"{BASE}/health")
    check(isinstance(h.get("last_estop"), dict) and h["last_estop"]["age_s"] < 5.0,
          "…and /health records when the stop happened", str(h.get("last_estop")))

    # It must NOT latch. `releaseAction()` is also the ROUTINE end-of-teleop handback
    # (RobotStateManager.stopTeleopForwarding) and nothing ever posts a reset, so a
    # latch here would make the arms unusable after the first ordinary session. The
    # latch that must exist lives upstream, in forwardTeleopToHardware().
    code, body = post_json(f"{BASE}/action", {"left_elbow_joint": 0.25})
    check(code == 200 and body.get("ok") is True,
          "/action works again straight after an /estop — the stop does not latch, "
          "because its other caller is the routine end-of-teleop handback", str(code))

    print("\n  (14h) unknown routes, and the refusal that matters most")
    # NOT /state any more: that route now exists (section 16). A route the sidecar
    # owns and this inlet does not is the honest test of the fall-through.
    code, body = get_json(f"{BASE}/pointcloud/latest")
    check(code == 404 and "/action" in body.get("error", ""),
          "an unowned route is a 404 that names what this inlet does serve",
          body.get("error", "")[:60])
    check("/state/fast" in body.get("error", ""),
          "…including the read path, so a caller that guessed the wrong path is told "
          "the right one")
finally:
    httpd.shutdown()
    httpd.server_close()
    inlet_pub._stop.set()
    inlet_worker.join(timeout=2.0)

# A dead publish loop must never be answered with "ok". rt/lowcmd latches, so the
# sim is still holding the last pose sent, and a 200 here would tell a rollout its
# actions are landing when nothing is on the wire at all.
dead_pub = B.ManipPublisher(1, rate_hz=50.0, verbose=False, init_dds=False)
dead_httpd = B.serve(dead_pub, "127.0.0.1", 0)
DEAD = f"http://127.0.0.1:{dead_httpd.server_address[1]}"
try:
    check(dead_pub.alive is False,
          "a publisher whose loop was never started reports alive=False")
    code, body = post_json(f"{DEAD}/action", {"left_elbow_joint": 0.3})
    check(code == 503 and body.get("ok") is False,
          "…and /action against it is a 503, never a 200 for a frame that reaches "
          "nothing", str(code))
    code, body = post_json(f"{DEAD}/estop", {})
    check(code == 503 and "latches" in body.get("error", ""),
          "…and /estop says the arms are still latched where they were left",
          body.get("error", "")[:60])
    code, body = get_json(f"{DEAD}/health")
    check(code == 503 and body.get("status") == "dead",
          "…and /health is a 503, so the bringup script's `curl -sf` probe fails",
          f"{code}/{body.get('status')}")
finally:
    dead_httpd.shutdown()
    dead_httpd.server_close()

print("\n  (14i) the flags exist, and every args.<x> has an --option behind it")
# The house lesson from the facade's verifier: an `args.X` with no matching
# add_argument raises AttributeError at RUNTIME -- the process starts, prints its
# banner and dies on the line that touches it. Neither --help nor py_compile
# catches it.
_bridge_src = _src_bridge
_used = set(re.findall(r"\bargs\.([A-Za-z_][A-Za-z0-9_]*)", _bridge_src))
_declared = set(re.findall(r'ap\.add_argument\("--([a-z0-9-]+)"', _bridge_src))
_declared = {d.replace("-", "_") for d in _declared}
check(not (_used - _declared), "no args.<x> without an add_argument",
      f"used {len(_used)}" if not (_used - _declared) else f"MISSING {_used - _declared}")
check(not (_declared - _used), "and no --option the code never reads",
      "none" if not (_declared - _used) else f"DEAD {_declared - _used}")
check("--serve" in _bridge_src and "--bind" in _bridge_src
      and B.DEFAULT_SERVE_PORT == 8778,
      "--serve and --bind exist, and 8778 is the documented port (8777 sidecar, "
      "8779 facade)", str(B.DEFAULT_SERVE_PORT))
check('ap.add_argument("--bind", default="127.0.0.1"' in _bridge_src,
      "…and --bind defaults to LOOPBACK: this port moves a robot's arms")

# --------------------------------------------------------------------------------
print("\n(15) the rig is wired end to end: facade -> inlet, and the bringup script")
FACADE = os.path.join(_HERE, "isaac_camera_facade.py")
fsrc = open(FACADE, encoding="utf-8").read()
check('ap.add_argument("--manip-url"' in fsrc,
      "the camera facade takes --manip-url")
check('MANIP_ROUTES: frozenset[str] = frozenset({"/action", "/estop"})' in fsrc,
      "…and diverts exactly /action and /estop of the POSTs — /loco/*, /record/* and "
      "/pointcloud/* must keep going to the sidecar or Agent Mode loses the robot")
check("if manip_url and path in MANIP_ROUTES:" in fsrc
      and fsrc.index("if manip_url and path in MANIP_ROUTES:")
      < fsrc.index("            if sidecar_url:\n                self._send(*proxy(\"POST\""),
      "…and the manip test comes BEFORE the sidecar fall-through in do_POST")
check('MANIP_GET_ROUTES: frozenset[str] = frozenset({"/state", "/state/fast"})' in fsrc,
      "the two GET routes divert as well: the sidecar's state source is a TCP link to "
      "a real G1 that is not on this box")
check("if manip_url and path in MANIP_GET_ROUTES:" in fsrc
      and fsrc.index("if manip_url and path in MANIP_GET_ROUTES:")
      < fsrc.index('            if sidecar_url:\n                self._send(*proxy("GET"'),
      "…and that test comes before the sidecar fall-through in do_GET too")
check(fsrc.index('if path == "/health"') < fsrc.index("if manip_url and path in MANIP_GET_ROUTES:"),
      "…but AFTER /health and the camera routes, which this facade owns")
check("HARDWARE_SIDECAR_URL" in fsrc and "one base URL" in fsrc.replace("ONE base URL", "one base URL"),
      "…with the reason stated: the agent keeps ONE base URL, and repointing it at "
      "the bridge would take the cameras and /loco/* down with it")

# The facade must be unchanged in behaviour when the flag is absent. Checked by
# standing one up with no --manip-url and confirming an unowned POST still 404s
# rather than being routed anywhere.
sys.path.insert(0, _HERE)
import isaac_camera_facade as F  # noqa: E402
_slots = {"head_camera": F.FrameSlot("head_camera", 55555)}
_h = ThreadingHTTPServer(("127.0.0.1", 0), F.make_handler(
    _slots, max_age_s=0.5, wait_s=0.01, max_content_age_s=0.0, scene="offline-test",
    sidecar_url=""))
_h.daemon_threads = True
threading.Thread(target=_h.serve_forever, daemon=True).start()
try:
    code, body = post_json(f"http://127.0.0.1:{_h.server_address[1]}/action",
                           {"left_elbow_joint": 0.3})
    check(code == 404, "with no --manip-url and no --sidecar-url, POST /action still "
          "404s exactly as it did before this change", str(code))
finally:
    _h.shutdown()
    _h.server_close()

# …and that it DOES route when the flag is given. The upstream here is deliberately
# a closed port: what is under test is which URL the facade chose, and a 503 naming
# the manip bridge proves it chose that one.
_h2 = ThreadingHTTPServer(("127.0.0.1", 0), F.make_handler(
    _slots, max_age_s=0.5, wait_s=0.01, max_content_age_s=0.0, scene="offline-test",
    sidecar_url="http://127.0.0.1:1", manip_url="http://127.0.0.1:2"))
_h2.daemon_threads = True
threading.Thread(target=_h2.serve_forever, daemon=True).start()
try:
    _b2 = f"http://127.0.0.1:{_h2.server_address[1]}"
    code, body = post_json(f"{_b2}/action", {"left_elbow_joint": 0.3})
    check(code == 503 and "manip bridge" in body.get("error", ""),
          "POST /action goes to the MANIP bridge when --manip-url is set",
          body.get("error", "")[:60])
    check("127.0.0.1:2" in body.get("error", ""),
          "…to that URL specifically, and a dead one is reported AS dead")
    code, body = post_json(f"{_b2}/estop", {})
    check(code == 503 and "127.0.0.1:2" in body.get("error", ""),
          "…and so does POST /estop — the stop has to reach the process holding the arms")
    code, body = post_json(f"{_b2}/loco/move", {"vx": 0.1})
    check(code == 503 and "sidecar" in body.get("error", ""),
          "…while /loco/move still goes to the SIDECAR", body.get("error", "")[:50])
finally:
    _h2.shutdown()
    _h2.server_close()

print("\n  (15a) the whole path a VLA rollout takes, end to end, with DDS off")
# THE ONE CHECK THAT WOULD HAVE CAUGHT THE ORIGINAL DEFECT. Everything above tests
# a piece; this posts the caller's own 31-joint dict at the FACADE's port — the only
# port the agent knows (`HARDWARE_SIDECAR_URL`) — and asserts it comes out as arm and
# hand targets in the publisher's command slot. Before this change the same request
# reached g1_sidecar.py's /action and could not have moved anything.
e2e_pub = B.ManipPublisher(1, rate_hz=50.0, verbose=False, init_dds=False)
e2e_pub._shaper.reset(M.REST)
e2e_worker = threading.Thread(target=e2e_pub.run, daemon=True)
e2e_worker.start()
e2e_inlet = B.serve(e2e_pub, "127.0.0.1", 0)
e2e_facade = ThreadingHTTPServer(("127.0.0.1", 0), F.make_handler(
    _slots, max_age_s=0.5, wait_s=0.01, max_content_age_s=0.0, scene="offline-test",
    sidecar_url="http://127.0.0.1:1",
    manip_url=f"http://127.0.0.1:{e2e_inlet.server_address[1]}"))
e2e_facade.daemon_threads = True
threading.Thread(target=e2e_facade.serve_forever, daemon=True).start()
try:
    AGENT = f"http://127.0.0.1:{e2e_facade.server_address[1]}"   # HARDWARE_SIDECAR_URL
    reach = dict(full)
    reach["left_elbow_joint"] = 0.8
    reach.update(zip(M.NEODEM_LEFT_HAND, M.GRIP_CLOSE_RAD))
    reach["waist_pitch_joint"] = -0.12          # the lean action-contracts.ts sends
    code, body = post_json(f"{AGENT}/action", reach)
    check(code == 200 and body.get("applied") == 28,
          "a 31-joint frame POSTed at the FACADE's port applies 28 on the bridge",
          f"{code}, applied {body.get('applied')}")
    check(body.get("ignored") == list(M.WAIST_JOINTS),
          "…and the waist keys are reported back through the proxy, unaltered")
    check(e2e_pub.targets.arm[M.ARM_JOINTS.index("left_elbow_joint")] == 0.8,
          "…the elbow target is in the publisher's command slot",
          f"{e2e_pub.targets.arm[M.ARM_JOINTS.index('left_elbow_joint')]:+.3f}")
    check(list(e2e_pub.targets.left_hand) == list(M.GRIP_CLOSE_RAD),
          "…and the left hand holds the CLOSE pose the caller sent, in radians, "
          "not a second decode of it",
          f"middle_1={e2e_pub.targets.left_hand[4]:+.3f}")
    deadline = time.monotonic() + 2.0
    while time.monotonic() < deadline and \
            abs((arm_on_wire() or [0.0])[M.ARM_JOINTS.index("left_elbow_joint")] - 0.8) > 1e-6:
        time.sleep(0.02)
    check(abs(arm_on_wire()[M.ARM_JOINTS.index("left_elbow_joint")] - 0.8) < 1e-6,
          "…and it reaches rt/lowcmd[15:29], which is what the sim reads")
    code, body = post_json(f"{AGENT}/estop", {})
    check(code == 200 and body.get("action") == "ramp-to-rest",
          "POST /estop at the facade reaches the bridge's ramp — this is the path "
          "HardwareClient.releaseAction() takes, and rt/lowcmd latches without it",
          str(body.get("action")))
    deadline = time.monotonic() + 3.0
    while time.monotonic() < deadline and arm_on_wire() != list(M.REST.arm):
        time.sleep(0.02)
    check(arm_on_wire() == list(M.REST.arm),
          "…and the arms end at rest on the wire", f"arm[0]={arm_on_wire()[0]:+.3f}")
finally:
    e2e_facade.shutdown(); e2e_facade.server_close()
    e2e_inlet.shutdown(); e2e_inlet.server_close()
    e2e_pub._stop.set(); e2e_worker.join(timeout=2.0)

if not os.path.exists(SCRIPT) or not shutil.which("bash"):
    print("    SKIP  factory_mission_bringup.sh or bash not available")
else:
    bsrc = open(SCRIPT, encoding="utf-8").read()
    bcode = "\n".join(l for l in bsrc.splitlines() if not l.lstrip().startswith("#"))
    check('MANIP_PORT="${MANIP_PORT:-8778}"' in bcode,
          "the bringup script declares the inlet port ONCE",)
    check('--serve "$MANIP_PORT"' in bcode,
          "…passes it to the manipulation bridge as --serve")
    check('MANIP_ARGS=(--manip-url "http://localhost:$MANIP_PORT")' in bcode,
          "…and to the facade as --manip-url, from the same variable")
    check('${MANIP_ARGS[@]+"${MANIP_ARGS[@]}"}' in bcode,
          "…through the empty-array-safe idiom, so ENABLE_MANIP=0 omits the flag "
          "entirely rather than passing an empty one")
    check('curl -sf -m 2 -o /dev/null "http://localhost:$MANIP_PORT/health"' in bcode,
          "there is a /health readiness probe on the inlet, next to the watch_pid — "
          "a live pid proves the process started, not that the port bound")
    _probe_at = bcode.index("http://localhost:$MANIP_PORT/health")
    _facade_at = bcode.index("isaac_camera_facade.py --serve 8779")
    check(_probe_at < _facade_at,
          "…and it runs BEFORE the facade is told to route to that port")
    check("G1_READ_ONLY=1" in bcode,
          "G1_READ_ONLY=1 is untouched: flipping it buys nothing here and aims a "
          "domain-0 publisher at the real robot")
    check("--- domain guard" in bsrc and "domain 0 is the REAL ROBOT" in bsrc,
          "…and the domain-0 refusal is still in place (executed in (12) above)")

# --------------------------------------------------------------------------------
print("\n(16) THE READ PATH — a rollout must get measured joints, or none at all")
# WHY THIS SECTION EXISTS. `HardwareClient.getStateNow()` builds the policy's
# 43-dim observation by mapping the sidecar's `/state/fast` joints by NAME into
# STATE_JOINT_NAMES order and defaulting every name it cannot find to 0.0. On this
# rig the sidecar's read path is a TCP socket to the REAL G1's IP, which does not
# exist on this box: `/state/fast` answers `{"joints": []}` with HTTP 200, so the
# policy is handed 43 zeros and NOTHING reports an error. Every check below is
# about that one failure and its inverse — a partial vector silently padded with
# fabricated zeros.

print("\n  (16a) the 43 names come from the contract's own source, not a fifth copy")
_ENV = os.path.join(_HERE, "sim_evaluator", "envs", "g1_apple_env.py")


def _py_list(src, name):
    """The value of a module-level `name = [...]` or `name = A + B + ...`, by AST.

    The same trick `action-contracts.test.ts` uses to pin the TypeScript tables to
    this Python file. Reading it rather than importing it keeps numpy, gymnasium
    and the rest of the evaluator's dependencies out of this verifier.
    """
    tree = ast.parse(src)
    consts = {}
    for node in tree.body:
        if not isinstance(node, ast.Assign) or len(node.targets) != 1:
            continue
        target = node.targets[0]
        if not isinstance(target, ast.Name):
            continue
        try:
            consts[target.id] = _py_eval(node.value, consts)
        except (ValueError, TypeError):
            continue
    return consts.get(name)


def _py_eval(node, consts):
    if isinstance(node, ast.List) or isinstance(node, ast.Tuple):
        return [_py_eval(e, consts) for e in node.elts]
    if isinstance(node, ast.Constant):
        return node.value
    if isinstance(node, ast.Name):
        return consts[node.id]
    if isinstance(node, ast.BinOp) and isinstance(node.op, ast.Add):
        return _py_eval(node.left, consts) + _py_eval(node.right, consts)
    raise ValueError("not a literal list expression")


if not os.path.exists(_ENV):
    check(False, "sim_evaluator/envs/g1_apple_env.py is present to pin the order to")
else:
    _contract = _py_list(open(_ENV, encoding="utf-8").read(), "STATE_JOINT_NAMES")
    check(_contract is not None and len(_contract) == 43,
          "g1_apple_env.py still declares a 43-name STATE_JOINT_NAMES",
          str(len(_contract or [])))
    check(list(M.STATE_JOINT_NAMES) == _contract,
          "…and isaac_manip.STATE_JOINT_NAMES is that exact list, in that exact order "
          "— composed from BODY + LHAND + RHAND, not transcribed",
          "43/43 identical" if list(M.STATE_JOINT_NAMES) == _contract else
          f"differs at {[i for i, (a, b) in enumerate(zip(M.STATE_JOINT_NAMES, _contract)) if a != b]}")
check(M.STATE_JOINT_NAMES[:M.N_BODY] == tuple(BODY),
      "the first 29 are the rt/lowstate motor order (BODY), so no reindexing is "
      "needed on the body block at all")
check(M.STATE_JOINT_NAMES[29:36] == tuple(LHAND)
      and M.STATE_JOINT_NAMES[36:43] == tuple(RHAND),
      "…and the last 14 are LHAND then RHAND from sim_g1_dds/joints.py")
check(len(set(M.STATE_JOINT_NAMES)) == 43,
      "no name appears twice — one source's value would otherwise overwrite another's")

print("\n  (16b) THE LEFT/RIGHT ASYMMETRY, ASSERTED, IN THE DIRECTION IT IS READ")
# Found four times before in this repo (the agent's joint config, the action
# mapping, g1_sidecar's _get_state_readonly, and its POS_LIMITS). This is the fifth
# place it could be made, and it points the OTHER way: on rt/dex3/right/state the
# SIM sends middle before index, while a real G1 sends index before middle.
check(M.ISAAC_HAND_STATE_ORDER["left"] == tuple(LHAND),
      "the LEFT hand's published order is joints.py LHAND — thumb, MIDDLE, index",
      str(M.ISAAC_HAND_STATE_ORDER["left"][3]))
check(M.ISAAC_HAND_STATE_ORDER["right"][3] == "right_hand_middle_0_joint"
      and M.ISAAC_HAND_STATE_ORDER["right"][5] == "right_hand_index_0_joint",
      "the RIGHT hand's published order in THIS SIM is middle-first — slots 3,4 are "
      "middle_0/1 and 5,6 are index_0/1",
      f"{M.ISAAC_HAND_STATE_ORDER['right'][3]} @3")
check(tuple(RHAND)[3] == "right_hand_index_0_joint",
      "…while the REAL robot sends index_0 in slot 3. Same topic name, two "
      "conventions — this is why g1_sidecar.py's RIGHT_HAND_WIRE is right THERE "
      "and would be wrong here")
check(M.ISAAC_HAND_STATE_ORDER["right"] != tuple(RHAND)
      and sorted(M.ISAAC_HAND_STATE_ORDER["right"]) == sorted(RHAND),
      "…and the two are permutations of the same seven joints, so a positional read "
      "produces plausible numbers on the wrong fingers, never an exception")
# The vendor source this was read off, verbatim, so a checkout update that changes
# it fails here rather than in a grasp.
_VDEX3 = os.path.expanduser(
    "~/Dokumente/Unitree/g1_quest_teleop/third_party/checkouts/unitree_sim_isaaclab/"
    "tasks/common_observations/dex3_state.py")
if not os.path.exists(_VDEX3):
    print("    SKIP  the vendor checkout is not on this box "
          "(tasks/common_observations/dex3_state.py)")
else:
    _vsrc = open(_VDEX3, encoding="utf-8").read()
    check(squash('"right_hand_thumb_2_joint",\n        "right_hand_middle_0_joint"')
          in squash(_vsrc),
          "the vendor still publishes right MIDDLE_0 immediately after thumb_2 "
          "(dex3_state.py::get_robot_girl_joint_names) — the fact the table above "
          "encodes")
    check(squash('"left_hand_thumb_2_joint",\n        "left_hand_middle_0_joint"')
          in squash(_vsrc),
          "…and the left hand the same way, which is why only the right is remapped")
    check("left_pos = pos[:7]" in _vsrc and "right_pos = pos[7:]" in _vsrc,
          "…and it splits its 14 gathered values 7/7 into the two topics, so slot i "
          "of each message is name i of that side's list")

print("\n  (16c) an ABSENT source contributes NO joints — never a zero")
# The defect this whole section is built around, stated as a test: a fabricated 0.0
# and a measured 0.0 are the same number by the time a policy sees them.
_body = [0.0] * M.N_BODY          # a REAL all-zero posture, which is legal
_lh = [0.11] * M.N_HAND
_rh = [0.21, 0.22, 0.23, 0.24, 0.25, 0.26, 0.27]
_all, _dropped = M.label_state(body=_body, left_hand=_lh, right_hand=_rh,
                               right_hand_order="isaac")
check(len(_all) == 43 and not _dropped,
      "three fresh sources label all 43 joints", f"{len(_all)} joints")
_partial, _ = M.label_state(body=_body, left_hand=None, right_hand=_rh,
                            right_hand_order="isaac")
check(len(_partial) == 36 and not any(n.startswith("left_hand_") for n in _partial),
      "a missing left hand leaves its 7 joints OUT of the dict, so getStateNow's "
      "name lookup misses them", f"{len(_partial)} joints")
check(all(_partial.get(n) is None for n in LHAND),
      "…and not one of them is present as 0.0 — which is the whole point, because "
      "the real body block above IS all zeros and is served")
_none, _ = M.label_state(body=None, left_hand=None, right_hand=None,
                         right_hand_order="isaac")
check(_none == {}, "with nothing heard at all the dict is empty, not 43 zeros")
_short, _ = M.label_state(body=[0.5] * 7, left_hand=None, right_hand=None,
                          right_hand_order="isaac")
check(len(_short) == 7 and _short["left_hip_pitch_joint"] == 0.5
      and "left_knee_joint" in _short and "left_elbow_joint" not in _short,
      "a truncated sample labels what it has and stops — data loss is not a reason "
      "to invent the rest", f"{len(_short)} joints")
_nan, _nan_dropped = M.label_state(
    body=[float("nan")] + [0.3] * 28, left_hand=None, right_hand=None,
    right_hand_order="isaac")
check(_nan_dropped == ["left_hip_pitch_joint"] and "left_hip_pitch_joint" not in _nan,
      "a NaN on the wire is DROPPED and named — it would reach the policy's "
      "observation and it would also make the JSON unparseable to JSON.parse",
      str(_nan_dropped))
check(raises(ValueError, M.label_state, body=None, left_hand=None,
             right_hand=_rh, right_hand_order="whatever"),
      "and label_state refuses a right hand whose convention it was not told")
_neodem, _ = M.label_state(body=None, left_hand=None, right_hand=_rh,
                           right_hand_order="neodem")
check(_neodem["right_hand_middle_0_joint"] == 0.26
      and _partial["right_hand_middle_0_joint"] == 0.24,
      "…because the two conventions put DIFFERENT values on the same finger: wire "
      "slot 3 is middle_0 in this sim and index_0 on the real robot",
      "the four numbers that only carry anything during a grasp")

print("\n  (16d) the reader: staleness is absence, and a bad sample cannot kill it")


class _StateMotor:
    def __init__(self, q):
        self.q = q


class _StateMsg:
    def __init__(self, qs):
        self.motor_state = [_StateMotor(q) for q in qs]


# subscribe=False: no SDK, no participant, no domain. `feed()` and `_take()` are the
# two ways a sample gets in, and both are exercised.
rd = B.StateReader(max_age_s=5.0, subscribe=False, verbose=False)
snap = rd.read()
check(snap["joints"] == [] and snap["missing"] == list(B.STATE_SOURCES)
      and snap["complete"] is False,
      "before anything is heard: no joints, all three sources missing, not complete")
check(all(snap["sources"][s]["state"] == "never" for s in B.STATE_SOURCES),
      "…and each source says 'never', not 'stale' — a publisher that never came up "
      "is a different fault from one that stopped")
rd._take("body", _StateMsg([0.4] * 35), M.N_BODY)
check(rd.samples["body"] == 1 and len(rd.read()["joints"]) == 29,
      "_take reads motor_state[i].q and stops at 29, ignoring the 35-slot message's "
      "tail", f"{len(rd.read()['joints'])} joints")
rd._take("body", object(), M.N_BODY)
check(rd.bad["body"] == 1 and len(rd.read()["joints"]) == 29,
      "a malformed sample is counted and dropped — the SDK reader thread survives "
      "and the last good sample is kept")
rd.feed("left_hand", [0.1] * M.N_HAND)
rd.feed("right_hand", [0.0, 0.0, 0.0, 0.31, 0.32, 0.51, 0.52])
full_snap = rd.read()
check(full_snap["complete"] is True and len(full_snap["joints"]) == 43,
      "all three sources fresh -> a complete 43-joint observation",
      f"{len(full_snap['joints'])} joints")
check([j["name"] for j in full_snap["joints"]] == list(M.STATE_JOINT_NAMES),
      "…in STATE_JOINT_NAMES order, which is the order the policy is fed")
_by = {j["name"]: j["position"] for j in full_snap["joints"]}
check(_by["right_hand_middle_0_joint"] == 0.31 and _by["right_hand_index_0_joint"] == 0.51,
      "…and the right hand is relabelled out of the sim's order: wire slot 3 is "
      "MIDDLE_0 and slot 5 is INDEX_0",
      "0.31 -> middle_0, 0.51 -> index_0")
check(raises(ValueError, B.StateReader, max_age_s=0.0, subscribe=False),
      "a zero max age is refused — every sample would be stale, i.e. every joint absent")
check(raises(ValueError, rd.feed, "torso", [0.0]),
      "and feed() refuses a source name it does not have")

stale_rd = B.StateReader(max_age_s=0.05, subscribe=False, verbose=False)
stale_rd.feed("body", [0.4] * M.N_BODY)
check(len(stale_rd.read()["joints"]) == 29, "a just-fed sample is fresh")
time.sleep(0.12)
stale_snap = stale_rd.read()
check(stale_snap["joints"] == [] and "body" in stale_snap["missing"],
      "…and 120 ms later, past a 50 ms max age, its 29 joints are GONE from the "
      "list rather than frozen at their last value",
      stale_snap["sources"]["body"]["state"])
check(stale_snap["sources"]["body"]["state"] == "stale"
      and stale_snap["sources"]["body"]["age_s"] >= 0.1
      and stale_snap["sources"]["body"]["samples"] == 1,
      "…and the report says stale, with the age and the sample count",
      f"{stale_snap['sources']['body']['age_s']}s")

print("\n  (16e) GET /state/fast over HTTP — the shape getStateNow() parses")
state_pub = B.ManipPublisher(1, rate_hz=50.0, verbose=False, init_dds=False)
state_pub._shaper.reset(M.REST)
state_worker = threading.Thread(target=state_pub.run, daemon=True)
state_worker.start()
state_rd = B.StateReader(max_age_s=5.0, subscribe=False, verbose=False)
state_httpd = B.serve(state_pub, "127.0.0.1", 0, reader=state_rd)
SBASE = f"http://127.0.0.1:{state_httpd.server_address[1]}"
try:
    code, body = get_json(f"{SBASE}/state/fast")
    check(code == 503 and body.get("ok") is False,
          "with no rt/lowstate at all, /state/fast REFUSES — a 200 with an empty "
          "list is what the sidecar does, and getStateNow turns that into 43 zeros "
          "with no error anywhere", str(code))
    check("getStateNow" in body.get("error", "") and "0.0" in body.get("error", ""),
          "…and the refusal explains the failure it is preventing",
          body.get("error", "")[:70])
    check(body.get("missing") == list(B.STATE_SOURCES)
          and body["sources"]["body"]["topic"] == "rt/lowstate",
          "…naming every missing source and the topic each one comes from")

    state_rd.feed("body", [0.0] * M.N_BODY)
    state_rd.feed("left_hand", [-0.7] * M.N_HAND)
    state_rd.feed("right_hand", [0.0, 0.0, 0.0, 0.31, 0.32, 0.51, 0.52])
    code, body = get_json(f"{SBASE}/state/fast")
    check(code == 200 and body.get("ok") is True and body.get("complete") is True,
          "with all three fresh: 200, complete", f"{code}")
    check(len(body["joints"]) == 43 and body["count"] == 43 and body["expected"] == 43,
          "…43 joints", str(body.get("count")))
    check(all(set(j) == {"name", "position"} and isinstance(j["position"], float)
              for j in body["joints"]),
          "…each one {name, position} with a float — exactly what getStateNow parses")
    check(body.get("units") == "radians",
          "…and it states its units, like every other reply from this bridge")
    _order = [j["name"] for j in body["joints"]]
    check(_order == list(M.STATE_JOINT_NAMES),
          "…in the policy's own 43-dim order")
    _pos = {j["name"]: j["position"] for j in body["joints"]}
    check(_pos["right_hand_middle_0_joint"] == 0.31
          and _pos["right_hand_index_0_joint"] == 0.51,
          "…with the right hand relabelled out of the SIM's slot order, by name")

    # The zero-fill this route exists to prevent, demonstrated end to end.
    state_rd._slot["left_hand"] = None
    code, body = get_json(f"{SBASE}/state/fast")
    check(code == 200 and body.get("complete") is False
          and body.get("missing") == ["left_hand"],
          "a missing HAND is served as a partial vector, flagged incomplete — 7 of 43, "
          "and only during a grasp", f"{code}, {body.get('count')} joints")
    check(len(body["joints"]) == 36
          and not any(j["name"].startswith("left_hand_") for j in body["joints"]),
          "…with those seven ABSENT from the list, so nothing fabricates them as 0.0")
    state_rd._slot["body"] = None
    code, body = get_json(f"{SBASE}/state/fast")
    check(code == 503 and "body" in body.get("missing", []),
          "a missing BODY is a 503: 29 of 43 fabricated is not an observation with "
          "gaps, it is a different robot", str(code))

    print("\n  (16f) GET /state — the 2 s poll, which is a different consumer")
    code, body = get_json(f"{SBASE}/state")
    check(code == 200 and body.get("connected") is False,
          "…is ALWAYS 200, because startPolling() reads `connected` and never the "
          "status code; refusing would only flip the agent to disconnected", str(code))
    state_rd.feed("body", [0.25] * M.N_BODY)
    code, body = get_json(f"{SBASE}/state")
    check(body.get("connected") is True and len(body["joints"]) == 36,
          "…and `connected` follows the BODY topic: no rt/lowstate is no posture",
          f"{len(body['joints'])} joints")
    check("imu" not in body and "battery" not in body and "touch" not in body,
          "…and it sends no imu/battery/touch group: the sim never fills "
          "imu_state.rpy (g1_robot_dds.py writes quaternion, accel and gyro only), "
          "and an absent group is parsed as null, which is the truth")

    print("\n  (16g) /health shows all three sources, so one URL answers 'which is gone'")
    code, h = get_json(f"{SBASE}/health")
    check(code == 200 and h["state"]["enabled"] is True,
          "the read path is reported on the same /health as the write path", str(code))
    check(h["state"]["complete"] is False and h["state"]["missing"] == ["left_hand"],
          "…including which source is missing right now", str(h["state"]["missing"]))
    check(h["state"]["joints"] == 36 and h["state"]["expected"] == 43,
          "…and how many of the 43 that costs", f"{h['state']['joints']}/43")
    check(all(h["state"]["sources"][s]["topic"] for s in B.STATE_SOURCES)
          and h["state"]["sources"]["body"]["age_s"] is not None,
          "…with the topic name and age of each")
    check(h.get("ok") is True and h.get("status") == "ok",
          "…while `ok` stays a verdict on PUBLISHING: the bringup probe is `curl -sf` "
          "on this route and runs before Isaac has booted, and a bridge that can "
          "still move the arms is not dead")
finally:
    state_httpd.shutdown()
    state_httpd.server_close()
    state_pub._stop.set()
    state_worker.join(timeout=2.0)

print("\n  (16h) --state-require all, for a caller that would rather stop than grasp blind")
strict_pub = B.ManipPublisher(1, rate_hz=50.0, verbose=False, init_dds=False)
strict_pub._shaper.reset(M.REST)
strict_worker = threading.Thread(target=strict_pub.run, daemon=True)
strict_worker.start()
strict_rd = B.StateReader(max_age_s=5.0, subscribe=False, verbose=False)
strict_rd.feed("body", [0.1] * M.N_BODY)
strict_rd.feed("right_hand", [0.0] * M.N_HAND)
strict_httpd = B.serve(strict_pub, "127.0.0.1", 0, reader=strict_rd,
                       state_require="all")
try:
    code, body = get_json(f"http://127.0.0.1:{strict_httpd.server_address[1]}/state/fast")
    check(code == 503 and body.get("missing") == ["left_hand"],
          "under --state-require all a missing hand is a 503 too", str(code))
finally:
    strict_httpd.shutdown()
    strict_httpd.server_close()
    strict_pub._stop.set()
    strict_worker.join(timeout=2.0)
check(raises(ValueError, B.make_handler, strict_pub, port=1, state_require="most"),
      "and an unknown --state-require is refused at construction, not at request time")

no_state_pub = B.ManipPublisher(1, rate_hz=50.0, verbose=False, init_dds=False)
no_state_worker = threading.Thread(target=no_state_pub.run, daemon=True)
no_state_worker.start()
no_state_httpd = B.serve(no_state_pub, "127.0.0.1", 0, reader=None)
try:
    NB = f"http://127.0.0.1:{no_state_httpd.server_address[1]}"
    code, body = get_json(f"{NB}/state/fast")
    check(code == 503 and "--no-state" in body.get("error", ""),
          "with --no-state the route is a 503 that says so — not a 404, which would "
          "claim the route does not exist when an operator turned it off", str(code))
    code, h = get_json(f"{NB}/health")
    check(h["state"]["enabled"] is False,
          "…and /health says the read path is off")
finally:
    no_state_httpd.shutdown()
    no_state_httpd.server_close()
    no_state_pub._stop.set()
    no_state_worker.join(timeout=2.0)

print("\n  (16i) …and the whole path an observation takes, through the facade's port")
# The counterpart of (15a), in the other direction: the agent knows ONE base URL,
# and the 43 numbers a rollout conditions on have to come back through it.
obs_pub = B.ManipPublisher(1, rate_hz=50.0, verbose=False, init_dds=False)
obs_pub._shaper.reset(M.REST)
obs_worker = threading.Thread(target=obs_pub.run, daemon=True)
obs_worker.start()
obs_rd = B.StateReader(max_age_s=5.0, subscribe=False, verbose=False)
obs_rd.feed("body", [0.05 * i for i in range(M.N_BODY)])
obs_rd.feed("left_hand", [-0.7] * M.N_HAND)
obs_rd.feed("right_hand", [0.0, 0.0, 0.0, 0.31, 0.32, 0.51, 0.52])
obs_inlet = B.serve(obs_pub, "127.0.0.1", 0, reader=obs_rd)
obs_facade = ThreadingHTTPServer(("127.0.0.1", 0), F.make_handler(
    _slots, max_age_s=0.5, wait_s=0.01, max_content_age_s=0.0, scene="offline-test",
    sidecar_url="http://127.0.0.1:1",
    manip_url=f"http://127.0.0.1:{obs_inlet.server_address[1]}"))
obs_facade.daemon_threads = True
threading.Thread(target=obs_facade.serve_forever, daemon=True).start()
try:
    AGENT = f"http://127.0.0.1:{obs_facade.server_address[1]}"   # HARDWARE_SIDECAR_URL
    code, body = get_json(f"{AGENT}/state/fast")
    check(code == 200 and len(body.get("joints", [])) == 43,
          "GET /state/fast at the FACADE's port returns the bridge's 43 joints — the "
          "sidecar on 127.0.0.1:1 is a closed port and would have 503'd",
          f"{code}, {len(body.get('joints', []))} joints")
    # The mapping getStateNow() performs, done here, so the assertion is about the
    # vector the policy actually receives rather than about the JSON.
    _lookup = {j["name"]: j["position"] for j in body["joints"]}
    _vector = [_lookup.get(n, 0.0) for n in M.STATE_JOINT_NAMES]
    check(len(_vector) == 43 and _vector != [0.0] * 43,
          "…and getStateNow's own name mapping over that reply is NOT 43 zeros, "
          "which is what it produced against this rig an hour ago",
          f"{sum(1 for v in _vector if v != 0.0)} non-zero of 43")
    check(_vector[M.STATE_JOINT_NAMES.index("right_hand_index_0_joint")] == 0.51
          and _vector[M.STATE_JOINT_NAMES.index("right_hand_middle_0_joint")] == 0.31,
          "…with the right hand's index and middle fingers where the policy expects "
          "them — the transposition, checked at the far end of the whole path")
    code, body = get_json(f"{AGENT}/state")
    check(code == 200 and body.get("connected") is True,
          "…and GET /state comes from the bridge too, so the 2 s poll stops "
          "reporting a robot that is not connected", str(code))
    code, body = get_json(f"{AGENT}/loco/odom")
    check(code == 503 and "sidecar" in body.get("error", ""),
          "…while /loco/odom still goes to the SIDECAR: the sim's only pose source "
          "is not on this bridge", body.get("error", "")[:50])
finally:
    obs_facade.shutdown(); obs_facade.server_close()
    obs_inlet.shutdown(); obs_inlet.server_close()
    obs_pub._stop.set(); obs_worker.join(timeout=2.0)

print()
if FAILURES:
    print(f"FAILED: {len(FAILURES)} check(s): {FAILURES}")
    sys.exit(1)
print("all isaac_manip offline checks passed")
