#!/usr/bin/env python3
"""Manipulation maths for the Isaac bridge: arm + Dex3 targets, and the grip code.

@file isaac_manip.py
@description Pure-Python helpers shared by `isaac_manip_bridge.py` and its offline
    verifier. No DDS, no Isaac, no numpy, no GPU -- just `math` and the joint tables
    already in `sim_g1_dds/joints.py` -- so every mapping, remap, clamp and decode
    below can be exercised on a laptop in milliseconds.
@feature hardware
@status live-conditional — imported by `isaac_manip_bridge.py`, which only runs when
    an Isaac Wholebody scene is up on a sim DDS domain.

WHAT THE ISAAC "WHOLEBODY" TASK WILL AND WILL NOT LET YOU DRIVE
--------------------------------------------------------------
The factory scene runs the vendor's `action_provider/action_provider_wh_dds.py`.
Read against that file (checked in at
`.../checkouts/unitree_sim_isaaclab/action_provider/action_provider_wh_dds.py`),
the robot has exactly three independent DDS inlets on the sim domain:

    rt/run_command/cmd     -> [vx, vy, wz, height]   -> 12 leg joints via policy.onnx
    rt/lowcmd              -> motor_cmd.positions[15:29] -> the 14 arm joints
    rt/dex3/{left,right}/cmd -> motor_cmd.positions[0:7] -> 7 + 7 finger joints

`isaac_loco_bridge.py` owns the first. This module is the maths behind the other
two. The three WAIST joints (`BODY[12:15]`) are NOT commandable: `get_action()`
overwrites them with `default_waist_positions` on every step, after the arm copy,
so anything written into `positions[12:15]` is silently discarded. The waist is
PARKED, not held-where-you-put-it -- see `WAIST_JOINTS` below.

FIVE THINGS THAT SILENTLY DESTROY A MEASUREMENT
-----------------------------------------------
Each of these is a real, load-bearing contract detail. Four are inherited from the
known-good reference implementation at `vla-training/eval/isaac_dds_bridge.py`,
which paid for them in failed benchmark runs; the fifth was read out of the vendor
source while writing this module.

1. THE LEFT-HAND GRIP CODE.  For a policy trained on the apple pick-and-place
   dataset, the left-hand block of the action vector is a normalised grip CODE, not
   radians.  Sending the code straight through does not merely blur the grasp: a
   full-CLOSE code lands four of the seven joints on their OPEN limit and flips the
   sign of a fifth, so the commanded "closed" hand is very nearly an open one.
   Measured through the MuJoCo gate: 0/15 carries raw vs 13/15 decoded.
   The decoder is `decode_left_hand_grip_code()` below, ported from
   `vla-training/eval/hand_grip_decoder.py`.

   THE API MAKES THIS IMPOSSIBLE TO FORGET, ON PURPOSE.  There is no way to turn a
   hand vector into radians without naming its units: `hand_targets_rad()` takes a
   keyword-only `units=` with NO default, and `targets_from_action31()` takes
   `left_hand_units=` and `right_hand_units=` with no defaults either.  A caller
   who has not thought about it gets a `TypeError` at the call site, not a robot
   that opens its hand when it meant to close it.  Do not add a default.

2. RIGHT-HAND SLOT ORDER.  The real robot, `sim_g1_dds/joints.py::RHAND` and the
   LeRobot datasets order the right hand
   `thumb_0, thumb_1, thumb_2, index_0, index_1, middle_0, middle_1`.
   The Isaac sim orders it
   `thumb_0, thumb_1, thumb_2, middle_0, middle_1, index_0, index_1`
   -- i.e. the same order it uses for the LEFT hand.  Confirmed here in
   `action_provider_wh_dds.py::_setup_joint_mapping` (`right_hand_joint_mapping`
   maps `right_hand_middle_0_joint` to slot 3, where the real robot has index_0).
   The LEFT hand agrees in both.  `remap_right_hand()` converts BY NAME in both
   directions; the permutation happens to be its own inverse, which the verifier
   asserts rather than assumes.

3. BOTH HANDS OR NEITHER.  `action_provider_wh_dds.get_action()` guards the whole
   Dex3 block with `if left_hand_cmd and right_hand_cmd:`.  A bridge that publishes
   only the hand it is using moves NOTHING -- not even that hand.  Whatever drives
   this must publish both sides on every frame, which is why `ManipTargets` carries
   both and neither is optional.

4. rt/lowcmd IS CRC-CHECKED, rt/dex3/*/cmd IS NOT.  `dds/g1_robot_dds.py`
   recomputes the CRC and returns `{}` on mismatch, printing a warning to the
   SIM's console that no client ever reads.  An arm command with a stale or zero
   CRC is therefore dropped in silence and looks exactly like an arm that will not
   track.  (Setting the CRC is the bridge's job, not this module's -- it needs the
   SDK.  It is listed here because this is where someone will come looking.)

5. ARM TARGETS ENTER THE LOCOMOTION POLICY'S OBSERVATION.  In `get_action()` the
   arm radians are written into `full_action` BEFORE
   `action_buffer.compute(full_action[old_action_indices])`, and that buffer is the
   29-wide `actions` term of the observation handed to policy.onnx.  Today, with
   nothing publishing rt/lowcmd, those 14 slots are zero.  Publishing real radians
   into them changes the locomotion policy's input while it walks.  Nothing here
   can predict the outcome; it is the first thing to check live, and it is why
   `ARM_RATE_LIMIT_RAD` defaults conservatively.

UNITS AND FRAMES
----------------
Every value in this module that is not explicitly a grip code is a JOINT ANGLE IN
RADIANS, absolute, in the joint's own frame -- not a delta, not normalised.  Slot
order is always NeoDEM/real-robot order (`sim_g1_dds.joints`) unless a name says
`isaac`.  The one place the Isaac order appears is on the wire, and it is produced
by `remap_right_hand(..., to="isaac")` immediately before publishing.
"""
from __future__ import annotations

import math
import os
import sys
from typing import NamedTuple, Sequence

_HERE = os.path.dirname(os.path.abspath(__file__))
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)

# The protocol's own joint order, already written down once. Importing it rather
# than re-typing it is the point: a table copied twice is a table that will drift.
from sim_g1_dds.joints import BODY, LHAND, RHAND  # noqa: E402

# --------------------------------------------------------------------------- arms

# `action_provider_wh_dds.py` builds its arm source indices as `idx + 15` over a
# 0..13 mapping, i.e. it reads `motor_cmd.positions[15:29]` -- exactly BODY[15:29].
ARM_START, ARM_END = 15, 29
ARM_JOINTS: tuple[str, ...] = tuple(BODY[ARM_START:ARM_END])
N_ARM = len(ARM_JOINTS)                       # 14: 7 left + 7 right

# The provider refuses a shorter array (`if len(positions) >= 29`). A real
# `unitree_hg` LowCmd_ carries 35 motor_cmd entries; 29 is the minimum that works.
LOWCMD_MIN_POSITIONS = 29

# PARKED, not commandable. `get_action()` writes `default_waist_positions` over
# these three on every step, after copying the arm block out of rt/lowcmd. Values
# written here are accepted by DDS and then discarded. There is no out-of-band
# escape hatch in the Wholebody task either -- the apple task's `set_waist` command
# rides on `rt/apple_state_cmd`, which this scene does not serve.
WAIST_JOINTS: tuple[str, ...] = tuple(BODY[12:ARM_START])

# --------------------------------------------------------------------------- hands

N_HAND = len(LHAND)                           # 7 per side

# NeoDEM / real robot / dataset order (sim_g1_dds/joints.py).
NEODEM_LEFT_HAND: tuple[str, ...] = tuple(LHAND)
NEODEM_RIGHT_HAND: tuple[str, ...] = tuple(RHAND)

# What the Isaac sim expects on rt/dex3/{left,right}/cmd. The left order agrees
# with the real robot; the right does not (see contract note 2).
ISAAC_LEFT_HAND: tuple[str, ...] = tuple(LHAND)
ISAAC_RIGHT_HAND: tuple[str, ...] = (
    "right_hand_thumb_0_joint", "right_hand_thumb_1_joint",
    "right_hand_thumb_2_joint", "right_hand_middle_0_joint",
    "right_hand_middle_1_joint", "right_hand_index_0_joint",
    "right_hand_index_1_joint",
)

# permutation[i] = index in the SOURCE list of the joint that belongs at slot i.
# Derived by name, never typed out, so a change to either table above cannot leave
# a stale permutation behind.
RIGHT_ISAAC_FROM_NEODEM: tuple[int, ...] = tuple(
    NEODEM_RIGHT_HAND.index(n) for n in ISAAC_RIGHT_HAND)
RIGHT_NEODEM_FROM_ISAAC: tuple[int, ...] = tuple(
    ISAAC_RIGHT_HAND.index(n) for n in NEODEM_RIGHT_HAND)

# This permutation happens to be its own inverse -- it swaps two pairs and leaves
# the three thumb slots alone -- which has one nasty consequence: applying it
# TWICE is the identity, and the identity is exactly the bug the remap exists to
# prevent. A second `remap_right_hand(..., to="isaac")` slipped in anywhere
# between the policy and the wire would therefore undo the first one and produce
# a hand whose index and middle fingers are swapped, silently, with no exception
# and nothing wrong-looking in a log.
#
# Nothing can detect that from the values alone -- a permuted 7-vector of floats
# is indistinguishable from an unpermuted one. What CAN be asserted is the
# precondition that makes the double application dangerous and the single one
# necessary: the permutation must not be the identity. If a future edit to either
# joint table aligns the two orders, the remap quietly becomes a no-op and every
# call site keeps calling it; this fails the import instead.
assert RIGHT_ISAAC_FROM_NEODEM != tuple(range(N_HAND)), (
    "the right-hand remap has become the identity: ISAAC_RIGHT_HAND and "
    "NEODEM_RIGHT_HAND now agree, so remap_right_hand() does nothing and every "
    "caller of it is silently wrong in one direction or the other")
assert tuple(RIGHT_ISAAC_FROM_NEODEM[i] for i in RIGHT_NEODEM_FROM_ISAAC) \
    == tuple(range(N_HAND)), "the two right-hand permutations are not inverses"

# --------------------------------------------------------------------- joint limits
#
# Ranges lifted from `sim_evaluator/mjcf/g1_dex3/g1_43dof_fixedbase_realism.xml`,
# which is NeoDEM's own model of this hardware. Keyed by NAME and looked up by name
# below, so a slot-order mistake cannot silently apply the left hand's limits to the
# right one -- which, the two hands being mirrored, would clamp every finger to a
# range it can never reach and produce a hand that simply never closes.
_JOINT_RANGE: dict[str, tuple[float, float]] = {
    "left_shoulder_pitch_joint": (-3.0892, 2.6704),
    "left_shoulder_roll_joint": (-1.5882, 2.2515),
    "left_shoulder_yaw_joint": (-2.618, 2.618),
    "left_elbow_joint": (-1.0472, 2.0944),
    "left_wrist_roll_joint": (-1.97222, 1.97222),
    "left_wrist_pitch_joint": (-1.61443, 1.61443),
    "left_wrist_yaw_joint": (-1.61443, 1.61443),
    "right_shoulder_pitch_joint": (-3.0892, 2.6704),
    "right_shoulder_roll_joint": (-2.2515, 1.5882),
    "right_shoulder_yaw_joint": (-2.618, 2.618),
    "right_elbow_joint": (-1.0472, 2.0944),
    "right_wrist_roll_joint": (-1.97222, 1.97222),
    "right_wrist_pitch_joint": (-1.61443, 1.61443),
    "right_wrist_yaw_joint": (-1.61443, 1.61443),
    "left_hand_thumb_0_joint": (-1.0472, 1.0472),
    "left_hand_thumb_1_joint": (-0.724312, 1.0472),
    "left_hand_thumb_2_joint": (0.0, 1.74533),
    "left_hand_middle_0_joint": (-1.5708, 0.0),
    "left_hand_middle_1_joint": (-1.74533, 0.0),
    "left_hand_index_0_joint": (-1.5708, 0.0),
    "left_hand_index_1_joint": (-1.74533, 0.0),
    "right_hand_thumb_0_joint": (-1.0472, 1.0472),
    "right_hand_thumb_1_joint": (-1.0472, 0.724312),
    "right_hand_thumb_2_joint": (-1.74533, 0.0),
    "right_hand_middle_0_joint": (0.0, 1.5708),
    "right_hand_middle_1_joint": (0.0, 1.74533),
    "right_hand_index_0_joint": (0.0, 1.5708),
    "right_hand_index_1_joint": (0.0, 1.74533),
}

ARM_LIMITS: tuple[tuple[float, float], ...] = tuple(_JOINT_RANGE[n] for n in ARM_JOINTS)
HAND_LIMITS: dict[str, tuple[tuple[float, float], ...]] = {
    "left": tuple(_JOINT_RANGE[n] for n in NEODEM_LEFT_HAND),
    "right": tuple(_JOINT_RANGE[n] for n in NEODEM_RIGHT_HAND),
}

# Per-control-step ceilings on how far a target may move. The arm value is the
# reference implementation's `max_delta=0.2` (isaac_dds_bridge.IsaacAppleBridge),
# which was tuned against a 30 fps demonstration replay; at this bridge's 50 Hz it
# is deliberately generous rather than tight, because a limiter that fights the
# policy is itself a measurement error. The hands get a looser one: a Dex3 grasp is
# supposed to snap shut, and rate-limiting it is how you drop the object.
ARM_RATE_LIMIT_RAD = 0.2
HAND_RATE_LIMIT_RAD = 0.5

SIDES = ("left", "right")


def _check_side(side: str) -> str:
    if side not in SIDES:
        raise ValueError(f"side must be 'left' or 'right', got {side!r}")
    return side


def _as_floats(values: Sequence[float], n: int, what: str) -> list[float]:
    out = [float(v) for v in values]
    if len(out) != n:
        raise ValueError(f"{what} needs {n} values, got {len(out)}")
    for i, v in enumerate(out):
        # NaN would propagate straight into a position target and, through the
        # observation buffer, into the locomotion policy. Refuse it here where it
        # is still one bad frame rather than a fallen robot.
        if not math.isfinite(v):
            raise ValueError(f"{what}[{i}] is not finite: {v!r}")
    return out


# ------------------------------------------------------------------ hand remapping

def remap_right_hand(values: Sequence[float], *, to: str) -> list[float]:
    """Reorder a 7-vector of RIGHT-hand values between the two slot conventions.

    `to="isaac"` takes NeoDEM/real-robot/dataset order and produces what
    rt/dex3/right/cmd expects; `to="neodem"` is the inverse, for reading
    rt/dex3/right/state back. Keyword-only and mandatory: "remap the right hand"
    is ambiguous without a direction, and the two directions are only
    interchangeable by an accident of this particular permutation.

    The LEFT hand needs no equivalent -- the two conventions agree there.
    """
    src = _as_floats(values, N_HAND, "right hand")
    if to == "isaac":
        perm = RIGHT_ISAAC_FROM_NEODEM
    elif to == "neodem":
        perm = RIGHT_NEODEM_FROM_ISAAC
    else:
        raise ValueError(f"to must be 'isaac' or 'neodem', got {to!r}")
    return [src[i] for i in perm]


def right_hand_by_name(values: Sequence[float], *, order: str) -> dict[str, float]:
    """Label a right-hand 7-vector with the joint names of the given convention.

    The remap is only correct if it moves VALUES to the slots their NAMES belong
    in; comparing two name->value dicts is how the verifier checks that, rather
    than comparing a permutation against a hand-typed copy of itself.
    """
    if order == "isaac":
        names = ISAAC_RIGHT_HAND
    elif order == "neodem":
        names = NEODEM_RIGHT_HAND
    else:
        raise ValueError(f"order must be 'isaac' or 'neodem', got {order!r}")
    return dict(zip(names, _as_floats(values, N_HAND, "right hand")))


# ------------------------------------------------------------------ state (READING)
#
# Everything above this line is a command going OUT. This block is the only one
# that describes what comes BACK, and it exists because nothing in this rig read
# the robot's joints at all.
#
# THE MEASUREMENT. `g1_sidecar.py`'s read-only state source is a TCP connection
# to the REAL G1's IP, which does not exist on this box: `/health` reports
# `"connected": false` and `GET /state/fast` answers `{"joints": []}` with HTTP
# 200 -- verified against the running rig through the facade on :8779. That 200
# is the dangerous part. `HardwareClient.getStateNow()` maps the returned joints
# by name into the 43-dim state order and DEFAULTS EVERY NAME IT CANNOT FIND TO
# 0.0, so an empty list is not an error anywhere: the policy is handed 43 zeros
# and the rollout looks like it ran. A GR00T rollout fed a zeroed proprioceptive
# state is not a rollout.
#
# The data was on the wire the whole time. `isaac_loco_bridge.py` already
# subscribes to rt/lowstate for its heading, and the Wholebody scene's
# observation terms publish both topics
# (`factory_pause_room_g1_29dof_dex3_hw_env_cfg.py:134-135` ->
# `get_robot_boy_joint_states` and `get_robot_dex3_joint_states`).

#: rt/lowstate `motor_state[i]` <-> BODY[i]. The vendor gathers Isaac's
#: articulation into `get_robot_boy_joint_names()`
#: (`tasks/common_observations/g1_29dof_state.py:21`) before publishing, and that
#: list is BODY, name for name, in order: 12 legs, 3 waist, 14 arms.
BODY_JOINTS: tuple[str, ...] = tuple(BODY)
N_BODY = len(BODY_JOINTS)                     # 29

#: The 43-dim STATE contract the g1_apple_pnp checkpoints are fed, in order:
#: `[L-leg 6 | R-leg 6 | waist 3 | L-arm 7 | R-arm 7 | L-hand 7 | R-hand 7]`.
#:
#: NOT a fourth transcription of it. `sim_evaluator/envs/g1_apple_env.py`
#: composes `STATE_JOINT_NAMES` from per-limb lists, `src/vla/action-contracts.ts`
#: mirrors that file and `action-contracts.test.ts` parses the Python to diff the
#: two. This line is the same 43 names reached from the protocol tables instead:
#: BODY is exactly leg+leg+waist+arm+arm, and the two hand blocks are LHAND and
#: RHAND. `verify_isaac_manip_offline.py` parses `g1_apple_env.py` and asserts the
#: equality, so this cannot drift from the contract without failing that check.
#:
#: The happy consequence is that the 43-dim state order IS the three DDS topics
#: concatenated, with exactly one reordering needed -- the right hand, below.
STATE_JOINT_NAMES: tuple[str, ...] = (
    BODY_JOINTS + NEODEM_LEFT_HAND + NEODEM_RIGHT_HAND)
N_STATE = len(STATE_JOINT_NAMES)              # 43

#: What the SIM publishes on rt/dex3/{side}/state, per side, BY NAME.
#:
#: THE FIFTH APPEARANCE OF THE SAME TRANSPOSITION, AND IT POINTS THE OTHER WAY.
#: The left hand is thumb -> MIDDLE -> index and the right is thumb -> index ->
#: middle on the REAL robot (`sim_g1_dds/joints.py` LHAND/RHAND). The Isaac scene
#: publishes its right hand middle-first instead -- the same order it uses for
#: the left -- which is stated outright by the vendor at
#: `tasks/common_observations/dex3_state.py:30-49` (`get_robot_girl_joint_names`,
#: whose right block is thumb_0/1/2, middle_0, middle_1, index_0, index_1) and
#: which matches the command direction this module already remaps
#: (`ISAAC_RIGHT_HAND`, contract note 2).
#:
#: So `g1_sidecar.py::_get_state_readonly` reading rt/dex3/right/state with
#: RIGHT_HAND_WIRE is correct THERE -- it reads a real robot -- and would be
#: wrong here. Two files, two conventions, one topic name. That is why this table
#: is named for the sim and looked up by name in `label_state()` below, and why
#: `label_state()` will not take a right hand without being told which
#: convention it is in.
ISAAC_HAND_STATE_ORDER: dict[str, tuple[str, ...]] = {
    "left": ISAAC_LEFT_HAND,
    "right": ISAAC_RIGHT_HAND,
}

assert N_STATE == 43, f"the state contract is 43 joints, this is {N_STATE}"
assert len(set(STATE_JOINT_NAMES)) == N_STATE, (
    "a joint name appears twice in STATE_JOINT_NAMES, so one source's value would "
    "overwrite another's")
assert STATE_JOINT_NAMES[:N_BODY] == BODY_JOINTS, (
    "the state order no longer starts with the rt/lowstate motor order")
assert ISAAC_HAND_STATE_ORDER["left"] == NEODEM_LEFT_HAND, (
    "the LEFT hand orders have diverged; label_state() assumes they agree")
assert ISAAC_HAND_STATE_ORDER["right"] != NEODEM_RIGHT_HAND, (
    "the RIGHT hand orders now agree, so reading rt/dex3/right/state with the "
    "Isaac names has become a no-op -- check the vendor's dex3_state.py before "
    "deleting the remap, because getting this wrong swaps index for middle in "
    "the four numbers that only carry anything during a grasp")


def label_state(*, body: Sequence[float] | None,
                left_hand: Sequence[float] | None,
                right_hand: Sequence[float] | None,
                right_hand_order: str) -> tuple[dict[str, float], list[str]]:
    """Label three raw DDS motor vectors with the joint names they belong to.

    Returns `(by_name, dropped)`. Every argument is keyword-only and mandatory,
    including `right_hand_order` -- "read the right hand" is ambiguous exactly the
    way "remap the right hand" is, and the two conventions differ in the four
    finger slots that only matter mid-grasp. There is no left-hand equivalent
    because the two conventions agree there, which is asserted above rather than
    assumed here.

    A SOURCE THAT IS `None` CONTRIBUTES NO NAMES. It does not contribute zeros.
    That distinction is the whole point of this function: `getStateNow()` fills
    every name it cannot find with 0.0, so a fabricated zero and a real zero are
    the same number by the time a policy sees them, and 0.0 is a plausible joint
    angle for most of these joints. The caller reports the absence out of band
    (`/state/fast`'s `missing`, `/health`'s per-source ages) and refuses outright
    when the body is the missing source.

    A short vector labels what it has and stops -- 29 motor slots are expected
    from rt/lowstate and 7 from each hand, but a truncated sample is data loss,
    not a reason to invent the rest. Non-finite values are DROPPED and named in
    `dropped`: a NaN would reach the policy's observation buffer, and it would
    also make the JSON reply unparseable to `JSON.parse`, which turns a bad
    sample into an unexplained client-side crash.
    """
    if right_hand is not None and right_hand_order not in ("isaac", "neodem"):
        raise ValueError(
            f"right_hand_order must be 'isaac' (this sim) or 'neodem' (the real "
            f"robot's wire order), got {right_hand_order!r}")
    out: dict[str, float] = {}
    dropped: list[str] = []
    sources: list[tuple[Sequence[float] | None, tuple[str, ...]]] = [
        (body, BODY_JOINTS),
        (left_hand, ISAAC_HAND_STATE_ORDER["left"]),
        (right_hand, ISAAC_HAND_STATE_ORDER["right"]
         if right_hand_order == "isaac" else NEODEM_RIGHT_HAND),
    ]
    for values, names in sources:
        if values is None:
            continue
        for name, raw in zip(names, values):
            value = float(raw)
            if not math.isfinite(value):
                dropped.append(name)
                continue
            out[name] = value
    return out, dropped


def state_joint_list(by_name: dict[str, float]) -> list[dict]:
    """`[{"name": ..., "position": ...}]` in STATE_JOINT_NAMES order, present only.

    The shape `HardwareClient.getStateNow()` and `getJointMapNow()` parse. Order
    is cosmetic to both of them -- they key by name -- but an operator reading the
    reply gets the policy's own 43-dim order, so a gap is visible where it is.
    """
    return [{"name": n, "position": by_name[n]}
            for n in STATE_JOINT_NAMES if n in by_name]


# ------------------------------------------------------------------- lowcmd packing

def pack_lowcmd_positions(arm_rad: Sequence[float],
                          length: int = LOWCMD_MIN_POSITIONS) -> list[float]:
    """Lay 14 arm radians into a `motor_cmd.positions`-shaped array.

    ONLY `[15:29]` is meaningful to the Isaac Wholebody task. The legs
    (`[0:12]`) are driven by policy.onnx from rt/run_command/cmd and the waist
    (`[12:15]`) is parked, so both are filled with 0.0 and ignored.

    That "ignored" is true of THIS SIM ONLY. The same message on a real G1's
    domain 0 is a full-body low-level command, and a leg block of zeros with live
    gains would drop the robot. `isaac_manip_bridge.py` refuses domain 0 outright
    and publishes kp = kd = 0 for exactly this reason.
    """
    if length < LOWCMD_MIN_POSITIONS:
        raise ValueError(
            f"the sim requires at least {LOWCMD_MIN_POSITIONS} positions "
            f"(`if len(positions) >= 29`), got length={length}")
    out = [0.0] * length
    out[ARM_START:ARM_END] = _as_floats(arm_rad, N_ARM, "arm")
    return out


def unpack_lowcmd_positions(positions: Sequence[float]) -> list[float]:
    """The 14 arm radians the sim would read out of a `positions` array."""
    vals = [float(v) for v in positions]
    if len(vals) < LOWCMD_MIN_POSITIONS:
        raise ValueError(
            f"the sim ignores a positions array shorter than "
            f"{LOWCMD_MIN_POSITIONS}, got {len(vals)}")
    return vals[ARM_START:ARM_END]


# ------------------------------------------------------------------------ clamping

def clamp(values: Sequence[float],
          limits: Sequence[tuple[float, float]]) -> list[float]:
    """Clamp each value into its own (lo, hi). Lengths must match exactly."""
    vals = [float(v) for v in values]
    if len(vals) != len(limits):
        raise ValueError(f"{len(vals)} values against {len(limits)} limits")
    return [min(max(v, lo), hi) for v, (lo, hi) in zip(vals, limits)]


def clamp_arm(arm_rad: Sequence[float]) -> list[float]:
    return clamp(_as_floats(arm_rad, N_ARM, "arm"), ARM_LIMITS)


def clamp_hand(values: Sequence[float], *, side: str) -> list[float]:
    """Clamp a hand 7-vector, in NeoDEM slot order, to that side's limits."""
    _check_side(side)
    return clamp(_as_floats(values, N_HAND, f"{side} hand"), HAND_LIMITS[side])


class RateLimiter:
    """Cap how far a vector of targets may move per call. Stateful, per channel.

    Mirrors the reference implementation's `np.clip(target, prev - d, prev + d)`
    (isaac_dds_bridge.send_action31). The first call after construction or
    `reset()` passes through unlimited: there is no previous target to move away
    from, and inventing one would put an artificial ramp at the start of every
    episode.
    """

    def __init__(self, max_delta: float, n: int) -> None:
        if max_delta < 0.0:
            raise ValueError("max_delta must be >= 0")
        self.max_delta = float(max_delta)
        self.n = int(n)
        self.prev: list[float] | None = None

    def reset(self, state: Sequence[float] | None = None) -> None:
        """Forget the previous target, or anchor it to a known pose.

        Anchoring matters when the limiter is picking up a pose the robot is
        already holding (a measured state, or the pose left by a previous run):
        without it, the first frame steps straight to the new target.
        """
        self.prev = None if state is None else _as_floats(state, self.n, "state")

    def step(self, target: Sequence[float]) -> list[float]:
        tgt = _as_floats(target, self.n, "target")
        if self.max_delta > 0.0 and self.prev is not None:
            d = self.max_delta
            tgt = [min(max(t, p - d), p + d) for t, p in zip(tgt, self.prev)]
        self.prev = list(tgt)
        return list(tgt)


# ------------------------------------------------------------------- THE GRIP CODE

class HandUnits:
    """What the numbers in a hand vector actually MEAN.

    Not an enum with a default -- a bare namespace of two string constants -- so
    that every call site has to spell one of them out and the reader of that call
    site can see which. See contract note 1 in the module docstring: getting this
    wrong is worth 0/15 vs 13/15 on the replay gate, and it fails SILENTLY.
    """

    #: The values are joint angles in radians, in that side's NeoDEM slot order.
    RADIANS = "radians"

    #: The values are the normalised 7-component grip CODE emitted by policies
    #: trained on the apple pick-and-place dataset. LEFT HAND ONLY -- the code
    #: structure and the OPEN/CLOSE endpoints below were measured on the left
    #: hand of that dataset and nothing has ever measured a right-hand one.
    APPLE_PNP_GRIP_CODE = "apple_pnp_grip_code"

    ALL = (RADIANS, APPLE_PNP_GRIP_CODE)


# Steady-state radians at the OPEN and CLOSE codes, in LEFT-hand NeoDEM slot order
# [thumb_0, thumb_1, thumb_2, middle_0, middle_1, index_0, index_1].
# Measured over 113 438 steady OPEN frames and 24 329 steady CLOSE frames of the
# apple pick-and-place dataset; see vla-training/eval/hand_grip_decoder.py for the
# derivation. thumb_0 is deliberately identical in both: it is a per-EPISODE
# constant (thumb abduction posture) that the code carries none of (R^2 = 0.011),
# so the best memoryless answer is its global steady mean.
GRIP_OPEN_RAD: tuple[float, ...] = (
    -0.07438, +0.06824, +0.06162, -0.07636, -0.05852, -0.08516, -0.08469)
GRIP_CLOSE_RAD: tuple[float, ...] = (
    -0.07438, +0.20552, +0.47074, -0.69452, -0.83696, -0.72598, -0.77278)

# The two scale factors the code packs max(ga, gb) into, exact on all 171 625
# frames of the dataset: code[5] = 0.40 * max, code[6] = 0.70 * max.
_GRIP_C5_SCALE = 0.40
_GRIP_C6_SCALE = 0.70


def decode_left_hand_grip_code(code: Sequence[float]) -> list[float]:
    """Decode one LEFT-hand Dex3 grip CODE into joint RADIANS.

    Port of `vla-training/eval/hand_grip_decoder.py::decode_left_hand`, kept
    numerically identical (same endpoints, same clamp) but numpy-free so this
    module stays importable anywhere. Pure function: no globals, no state.

    The 7-vector code has only TWO free scalars, each quantised to n/255:

        ga = -code[0] = -code[1]          drives index_0, index_1
        gb = -code[2] = -code[3]          drives middle_0, middle_1
        code[4] = 0.5 * (gb - ga)         (redundant; not read)
        code[5] = 0.40 * max(ga, gb)      drives thumb_1, thumb_2
        code[6] = 0.70 * max(ga, gb)      likewise

    Note the code slots are SCRAMBLED relative to the joint slots -- code[5] and
    code[6] sit in the index_0/index_1 positions yet carry max(ga, gb), not ga.
    That mis-packing is why an identity pass-through cannot work even in
    principle, and why it fails toward OPEN rather than toward noise.

    A policy's continuous output will not respect the code's internal redundancy
    exactly, so the duplicated pairs are averaged and the two independent
    estimates of max(ga, gb) are folded in as a lower bound.
    """
    c = _as_floats(code, N_HAND, "left hand grip code")

    ga = -0.5 * (c[0] + c[1])
    gb = -0.5 * (c[2] + c[3])
    gmax_obs = 0.5 * (c[5] / _GRIP_C5_SCALE + c[6] / _GRIP_C6_SCALE)

    ga = min(max(ga, 0.0), 1.0)
    gb = min(max(gb, 0.0), 1.0)
    gmax_obs = min(max(gmax_obs, 0.0), 1.0)
    gmax = max(ga, gb, gmax_obs)

    # index pair <- ga ; middle pair <- gb ; thumb flexion pair <- max(ga, gb).
    # thumb_0 (abduction) is not encoded at all -> held at its measured mean, which
    # is why s[0] is 0.0 and GRIP_OPEN_RAD[0] == GRIP_CLOSE_RAD[0].
    s = (0.0, gmax, gmax, gb, gb, ga, ga)
    rad = [o + si * (cl - o) for o, cl, si in zip(GRIP_OPEN_RAD, GRIP_CLOSE_RAD, s)]
    return clamp_hand(rad, side="left")


def hand_targets_rad(values: Sequence[float], *, side: str, units: str) -> list[float]:
    """Turn one hand 7-vector into clamped joint RADIANS in NeoDEM slot order.

    `units` is keyword-only and HAS NO DEFAULT. That is the whole point of this
    function existing rather than callers clamping for themselves: there is no
    path from a policy's hand output to a joint target that does not pass through
    a place where somebody had to say what the numbers mean.

    `HandUnits.APPLE_PNP_GRIP_CODE` is refused for the right hand. The decoder's
    OPEN/CLOSE endpoints and its ga/gb -> finger assignment were measured on the
    LEFT hand of the apple pick-and-place dataset; the right hand is mirrored
    (its joint limits have the opposite sign) and no equivalent measurement
    exists. Silently reusing the left-hand constants there would produce a
    plausible-looking vector that is wrong in sign on four joints -- exactly the
    failure mode this whole module is built to prevent. Refusing is the honest
    answer until somebody measures one.
    """
    _check_side(side)
    if units == HandUnits.RADIANS:
        return clamp_hand(values, side=side)
    if units == HandUnits.APPLE_PNP_GRIP_CODE:
        if side != "left":
            raise ValueError(
                "HandUnits.APPLE_PNP_GRIP_CODE is LEFT-HAND ONLY: its OPEN/CLOSE "
                "endpoints were measured on the left hand of the apple pick-and-"
                "place dataset and the right hand is mirrored. There is no "
                "right-hand decoder. Pass the right hand in radians, or measure "
                "one and add it here.")
        return decode_left_hand_grip_code(values)
    raise ValueError(
        f"units must be one of {HandUnits.ALL}, got {units!r} -- and it has no "
        f"default on purpose (see isaac_manip's module docstring, note 1)")


# ------------------------------------------------------------------------- targets

class ManipTargets(NamedTuple):
    """One complete manipulation frame: 14 arm + 7 + 7 hand joints, all radians.

    NeoDEM slot order throughout. Both hands are present and neither is optional
    -- the sim's Dex3 block is all-or-nothing (contract note 3), so "I am only
    using the left hand" still has to say what the right one should do.
    """

    arm: tuple[float, ...]
    left_hand: tuple[float, ...]
    right_hand: tuple[float, ...]

    @staticmethod
    def make(arm: Sequence[float], left_hand: Sequence[float],
             right_hand: Sequence[float]) -> "ManipTargets":
        return ManipTargets(
            tuple(_as_floats(arm, N_ARM, "arm")),
            tuple(_as_floats(left_hand, N_HAND, "left hand")),
            tuple(_as_floats(right_hand, N_HAND, "right hand")))


#: The pose the Isaac Wholebody task holds when NOTHING publishes rt/lowcmd:
#: `full_action.zero_()` leaves the arm entries at 0.0 and they go straight into
#: `set_joint_position_target`. So zero is not an arbitrary "safe pose" -- it is
#: the pose the scene is already in before this bridge starts and the one it will
#: snap back to the moment the bridge stops. Starting and finishing there is what
#: makes the transition in and out of manipulation continuous instead of a lurch.
ARM_ZERO: tuple[float, ...] = (0.0,) * N_ARM

#: Both hands open, in each side's own NeoDEM slot order. The left is the decoder's
#: measured OPEN pose; the right is its mirror, since the right hand's limits are
#: the left's negated and there is no measured right-hand OPEN.
HAND_OPEN_LEFT: tuple[float, ...] = GRIP_OPEN_RAD
HAND_OPEN_RIGHT: tuple[float, ...] = tuple(
    min(max(-v, lo), hi)
    for v, (lo, hi) in zip(
        # mirror by NAME: the left's thumb_0 value belongs on the right's thumb_0,
        # and NEODEM_RIGHT_HAND is a different order from NEODEM_LEFT_HAND.
        [dict(zip((n.replace("left_", "right_") for n in NEODEM_LEFT_HAND),
                  GRIP_OPEN_RAD))[n] for n in NEODEM_RIGHT_HAND],
        HAND_LIMITS["right"]))

REST: ManipTargets = ManipTargets(ARM_ZERO, HAND_OPEN_LEFT, HAND_OPEN_RIGHT)


# 31-dim action layout used by the apple pick-and-place policies and the MuJoCo
# runner: [L-arm 0:7 | R-arm 7:14 | L-hand 14:21 | R-hand 21:28 | waist 28:31].
# The arm block is already in BODY[15:29] order. The waist block is accepted and
# DISCARDED (contract, top of file) -- it is correct for a real G1 and inert here.
ACTION31_DIM = 31
A31_ARM = slice(0, 14)
A31_LEFT_HAND = slice(14, 21)
A31_RIGHT_HAND = slice(21, 28)
A31_WAIST = slice(28, 31)


def targets_from_action31(action: Sequence[float], *, left_hand_units: str,
                          right_hand_units: str) -> ManipTargets:
    """Turn one 31-dim policy action into clamped `ManipTargets`.

    Both `*_units` are keyword-only with NO DEFAULT. A policy trained on the
    apple pick-and-place dataset emits `HandUnits.APPLE_PNP_GRIP_CODE` for the
    left hand and something else entirely for the right; a policy trained on
    NeoDEM's own teleop recordings emits `HandUnits.RADIANS` for both. Nothing in
    the vector itself distinguishes the two -- a grip code and a radian target
    occupy the same numeric range -- so the caller must say, every time.

    The hand blocks come back in NeoDEM order. `remap_right_hand(..., to="isaac")`
    happens at the wire, not here, so that everything upstream of the publisher
    speaks one convention.
    """
    a = _as_floats(action, ACTION31_DIM, "31-dim action")
    return ManipTargets(
        tuple(clamp_arm(a[A31_ARM])),
        tuple(hand_targets_rad(a[A31_LEFT_HAND], side="left", units=left_hand_units)),
        tuple(hand_targets_rad(a[A31_RIGHT_HAND], side="right", units=right_hand_units)),
    )


class ManipShaper:
    """Clamp + rate-limit a stream of `ManipTargets`. One per bridge, stateful.

    Kept separate from the bridge for the same reason `OdomIntegrator` is kept
    separate from `OdomPublisher`: every decision it makes is a CPU decision, and
    a CPU decision that can only be exercised by booting Isaac is a decision that
    never gets tested.
    """

    def __init__(self, arm_rate: float = ARM_RATE_LIMIT_RAD,
                 hand_rate: float = HAND_RATE_LIMIT_RAD) -> None:
        self.arm = RateLimiter(arm_rate, N_ARM)
        self.hands = {s: RateLimiter(hand_rate, N_HAND) for s in SIDES}

    def reset(self, at: ManipTargets | None = None) -> None:
        """Anchor the limiters to a pose, or forget the previous one entirely."""
        self.arm.reset(None if at is None else at.arm)
        self.hands["left"].reset(None if at is None else at.left_hand)
        self.hands["right"].reset(None if at is None else at.right_hand)

    def shape(self, targets: ManipTargets) -> ManipTargets:
        """Rate-limit, then clamp. In that order, deliberately.

        Limiting first and clamping second means a target outside the joint's
        range cannot drag the limiter's memory outside it either: the stored
        `prev` is the value that was actually sent. The other order lets an
        out-of-range command park the limiter beyond the limit, so the next
        in-range command is rate-limited relative to a pose the joint was never
        in and the arm creeps back a step at a time.
        """
        arm = clamp_arm(self.arm.step(targets.arm))
        self.arm.prev = list(arm)
        out = {}
        for side, vals in (("left", targets.left_hand), ("right", targets.right_hand)):
            lim = self.hands[side]
            shaped = clamp_hand(lim.step(vals), side=side)
            lim.prev = list(shaped)
            out[side] = tuple(shaped)
        return ManipTargets(tuple(arm), out["left"], out["right"])
