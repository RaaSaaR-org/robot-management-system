#!/usr/bin/env python3
"""Drive the Isaac G1's ARMS and DEX3 HANDS, alongside the locomotion bridge.

@file isaac_manip_bridge.py
@description Publishes `rt/lowcmd` (14 arm joints) and `rt/dex3/{left,right}/cmd`
    (7 + 7 finger joints) to Unitree's `unitree_sim_isaaclab` Wholebody task, so a
    VLA policy can manipulate with the SAME robot `isaac_loco_bridge.py` walks.
    All the maths lives in `isaac_manip.py`; this file is the wire.
@feature hardware
@status live-conditional — runs only against an Isaac Wholebody scene on a sim DDS
    domain. Not exercised by any unit test that needs DDS; the CPU half is covered
    by `verify_isaac_manip_offline.py`.

WHY THIS IS A SIBLING FILE AND NOT A FLAG IN isaac_loco_bridge.py
----------------------------------------------------------------
The obvious alternative -- `--manip` on the locomotion bridge -- was rejected for
three reasons, in descending order of how much they would hurt:

1. LOCOMOTION MUST NOT REGRESS, AND "must not" is easier to guarantee than to
   test. `isaac_loco_bridge.py` publishes rt/run_command/cmd at 100 Hz because the
   sim's command slot SELF-CLEARS on every read: at 50 Hz the G1 leans instead of
   walking, and the failure looks like a locomotion bug rather than a transport
   one (it cost TASK-203 and TASK-223 a wrong conclusion each). Adding a second
   publisher, a second message type and a CRC computation to that process puts new
   work between two 10 ms deadlines for no benefit. Here, nothing this file does
   can slow that loop down, because it is not in that process. With the flag it
   would be a code-review promise; as a separate process it is a fact.

2. THE TWO CHANNELS HAVE OPPOSITE TRANSPORT REQUIREMENTS. rt/run_command/cmd is
   self-clearing and must be over-published. rt/lowcmd and rt/dex3/*/cmd LATCH:
   `dds/g1_robot_dds.py` and `dds/dex3_dds.py` write into shared memory that
   `get_action()` reads and never clears, so the last command holds indefinitely.
   One rate cannot be right for both, and a single loop would have to carry two.

3. INDEPENDENT LIFETIMES. Walking without hands is the normal case and is proven
   (16.36 m at 0.613 m/s, TASK-203). Manipulation is new and will crash. A crash
   in the manipulation publisher must not stop the robot walking, and must not
   silently leave a `sport` service answering SetVelocity with RPC_OK while
   nothing reaches Isaac -- which is exactly what a shared process risks.

Cost of the split, stated plainly: two DDS participants on one domain instead of
one, and two things for an operator to start. That is cheap. The topics do not
overlap, so there is no publisher contention between the two processes -- unlike
two copies of THIS file, which would fight over every arm joint.

`ManipPublisher(init_dds=False)` exists for the day someone does want it in-process
(e.g. inside `vla_runner.py`): the DDS factory may only be initialised once per
process, so the embedder owns that call. The publish loop still gets its own
thread.

WHAT GOES ON THE WIRE
---------------------
    rt/lowcmd            unitree_hg LowCmd_
                         motor_cmd[15:29].q  = the 14 arm targets, radians
                         motor_cmd[0:15].q   = 0.0 (legs+waist; the sim ignores them)
                         motor_cmd[*].kp/.kd = 0.0 (the sim ignores gains entirely)
                         crc                 = CRC().Crc(msg)   <-- MANDATORY
    rt/dex3/left/cmd     unitree_hg HandCmd_, motor_cmd[0:7].q, NeoDEM left order
    rt/dex3/right/cmd    unitree_hg HandCmd_, motor_cmd[0:7].q, ISAAC right order
                         (remapped from NeoDEM order at the last moment)

THE THREE WAYS THIS GOES WRONG IN SILENCE
-----------------------------------------
* NO CRC -> `g1_robot_dds.dds_subscriber` recomputes it, mismatches, prints a
  warning on the SIM's console and returns `{}`. Every arm command is dropped and
  the arm looks like it will not track. This file sets the CRC on every frame.
* ONE HAND ONLY -> `action_provider_wh_dds.get_action()` guards the Dex3 block
  with `if left_hand_cmd and right_hand_cmd:`. Publishing only the working hand
  moves NEITHER. This file publishes both, every frame, always.
* RAW GRIP CODE -> see `isaac_manip.py` note 1. `set_action31()` takes mandatory
  `left_hand_units=` / `right_hand_units=` and there is no overload that guesses.

WHAT COMES BACK
---------------
    rt/lowstate            unitree_hg LowState_
                           motor_state[0:29].q = the 29 body joints, BODY order
    rt/dex3/left/state     unitree_hg HandState_, motor_state[0:7].q, NeoDEM left order
    rt/dex3/right/state    unitree_hg HandState_, motor_state[0:7].q, ISAAC right order
                           (remapped to NeoDEM order on the way out, by NAME)

THE COMMAND INLET (--serve)
---------------------------
    POST /action     {"<joint name>": radians, ...}   -> set_targets()
    POST /estop      {}                               -> ramp to the rest pose
    GET  /state/fast                                  -> the 43-joint observation
    GET  /state                                       -> the same, for the 2 s poll
    GET  /health                                      -> domain, iface, DDS, rate,
                                                         last action, state sources

THE READ PATH, AND WHY IT IS IN THIS FILE
-----------------------------------------
Because the sidecar's read path points at a robot that is not there.
`g1_sidecar.py` under `G1_READ_ONLY=1` sources its joints from
`g1_state_bridge_readonly.py`, which opens a TCP socket to the REAL G1's IP. On
this box nothing answers: `/health` says `"connected": false` and
`GET /state/fast` returns `{"joints": []}` with HTTP 200 — measured against the
running rig, through the facade on :8779, minutes before this was written.

The 200 is what makes it dangerous. `HardwareClient.getStateNow()` maps the
returned joints by name into the 43-dim `STATE_JOINT_NAMES` order and DEFAULTS
EVERY NAME IT CANNOT FIND TO 0.0, so an empty list raises nothing anywhere: the
policy is handed 43 zeros and the rollout looks like it ran. A GR00T rollout fed
a zeroed proprioceptive state is not a rollout.

The data was on the wire the whole time — `isaac_loco_bridge.py` already
subscribes to rt/lowstate for its heading — and this process is already on the
sim's DDS domain with the factory initialised. So the read path lives here, next
to the write path, and follows the same two rules the rest of the file follows:

* ABSENT, NEVER ZERO. A source that has not been heard, or whose last sample is
  older than `--state-max-age`, contributes NO joints. A fabricated 0.0 is
  indistinguishable from a measured one by the time it reaches the policy, and
  0.0 is a plausible angle for most of these joints.
* AND THE RIGHT HAND IS REORDERED ON THE WAY OUT. rt/dex3/right/state carries
  middle_0, middle_1 in slots 3-4 in THIS sim and index_0, index_1 on a real G1
  (`tasks/common_observations/dex3_state.py:30-49`). `g1_sidecar.py` reads the
  same topic with the other table and is right to, because it reads real
  hardware. Both mappings are by NAME; see `isaac_manip.ISAAC_HAND_STATE_ORDER`.

`--serve 8778` is what makes this bridge reachable by a VLA rollout. Without it
the only producers are in-process (`set_targets`, `set_action31`) and `--probe`,
so the process printed "holding the rest pose" and idled while the agent POSTed
joint dicts at an endpoint that could never serve them: the camera facade (:8779)
proxies everything non-camera to `g1_sidecar.py` (:8777), whose `/action` is a
REAL-ROBOT path -- it needs `lerobot`, which is not installed in the rig's
interpreter; it hardcodes DDS domain 0, which is the real G1's bus; and it has no
Dex3 publisher at all. The simulated arms had no inlet. `G1_READ_ONLY=1` stays
exactly as it is: flipping it buys nothing and aims a domain-0 publisher at the
real robot.

Three things about that surface are load-bearing:

* THE VALUES ARE RADIANS, INCLUDING THE HANDS, AND NOTHING IS DECODED HERE.
  `src/vla/action-contracts.ts` has already decoded the left-hand grip code
  before it posts. A second decode reads an already-decoded CLOSE (~-0.7 rad) as
  a negative grip, clamps it to zero and returns the OPEN pose -- the hand opens
  at the moment the policy meant it to close, which is the same measured failure
  as sending the code raw (0/15 vs 13/15 carries) reached from the other
  direction and much harder to see, because both ends would be "decoding
  properly". `/action` uses `HandUnits.RADIANS` and does not go through
  `set_action31()`.

* THE THREE WAIST JOINTS ARE DROPPED, AND THE REPLY SAYS SO. The provider parks
  them every step; the caller sends them deliberately. `applied`, `ignored`,
  `unknown`, `rejected` and `clamped` are all in the reply, and an unknown joint
  name is a reported fact rather than a silent skip, because a caller has no
  other way to discover its vocabulary has drifted.

* /estop RAMPS TO REST, AND MUST. rt/lowcmd latches, so a stop that publishes
  nothing leaves the arms frozen mid-reach.

The server runs on its own threads and NEVER publishes -- it assigns `_slot`,
which is the lock-free producer path this class was built for.

SAFETY
------
Domain 0 is the real robot and is REFUSED here, not warned about. rt/lowcmd is a
full-body low-level command; this file writes zeros into the twelve leg slots
because the sim discards them, and the same message on a real G1 is a robot that
falls over. The gains are published as 0.0 for the same reason -- the sim reads
only positions, and a zero-gain lowcmd is inert on real hardware.
"""
from __future__ import annotations

import argparse
import json
import math
import os
import signal
import sys
import threading
import time
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

_HERE = os.path.dirname(os.path.abspath(__file__))
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)

import isaac_manip as M  # noqa: E402
from isaac_manip import HandUnits, ManipTargets  # noqa: E402

TOPIC_LOWCMD = "rt/lowcmd"
TOPIC_HAND_CMD = "rt/dex3/{}/cmd"

# The READ side. Three topics, three independent publishers in the sim, three
# independent ways to go silent -- so they are tracked separately and reported
# separately. See `StateReader`.
TOPIC_LOWSTATE = "rt/lowstate"
TOPIC_HAND_STATE = "rt/dex3/{}/state"

#: The three state sources, in the order `/state/fast` emits their joints.
STATE_SOURCES: tuple[str, ...] = ("body", "left_hand", "right_hand")

#: A sample older than this is treated as ABSENT, not as data.
#:
#: 1.0 s is seven sim steps at the ~7 Hz this scene actually reaches on this box
#: (measured; the GPU is shared and Isaac does not run real-time here), and the
#: dex3 observation term rate-limits itself to 50 Hz on top of that. So a fresh
#: rig sits three orders of magnitude inside this window and a stalled one falls
#: out of it within a second. It is deliberately NOT the camera facade's 0.5 s:
#: at 30 fps that was fifteen frames, and at 7 Hz it would be three.
DEFAULT_STATE_MAX_AGE_S = 1.0

# 50 Hz. UNLIKE rt/run_command/cmd this does NOT need over-publishing: the sim's
# robot-command and hand-command shared-memory slots are written by the DDS
# subscriber and read by `get_action()`, which never clears them, so the last
# frame latches until the next one arrives. 50 Hz matches the policy's own step
# rate (decimation 4 x sim.dt 0.005) and is therefore the fastest rate at which a
# new frame can possibly be seen; going faster only burns CRC.
DEFAULT_RATE_HZ = 50.0

# Seconds spent ramping into and out of the rest pose. The arm controller in the
# sim is a position target with no trajectory generator, so a step change flings
# the arm -- and in a scene with objects on a table, flings the objects too.
RAMP_S = 1.0


# --------------------------------------------------------------------------- HTTP inlet
#
# Everything from here to `class ManipPublisher` is the vocabulary of `POST /action`.
# It is pure and importable, so the verifier exercises the whole split without an
# HTTP server, a DDS participant or a sim.

#: Default port for `--serve`. 8777 is `g1_sidecar.py` and 8779 is
#: `isaac_camera_facade.py`; 8778 is the free slot between the two ports an
#: operator of this rig already has memorised.
DEFAULT_SERVE_PORT = 8778

# NAME -> slot, for every joint this bridge can actually drive. Built from this
# module's own tables, which are built from `sim_g1_dds/joints.py`, so nothing on
# this path is a second transcription of a joint order.
#
# BY NAME, IN BOTH DIRECTIONS, NEVER BY POSITION. The two Dex3 hands do not share
# a slot order -- the left is wired thumb -> MIDDLE -> index, the right
# thumb -> INDEX -> middle -- so splitting a name-keyed dict positionally against a
# single hand table labels the left hand's index finger as its middle one and vice
# versa. That is not hypothetical: `g1_sidecar.py::_get_state_readonly` used to
# index one thumb->index->middle table positionally for BOTH sides, mislabelling
# the left hand's state in the four numbers that only carry anything during a
# grasp; it now keeps `LEFT_HAND_WIRE` and `RIGHT_HAND_WIRE` apart, which is the
# same fix as the dicts below. The dicts make it impossible here, and the two
# other reorderings on this path -- `M.remap_right_hand()` on the way out and
# `M.ISAAC_HAND_STATE_ORDER` on the way back in -- are both by name too.
ARM_INDEX: dict[str, int] = {n: i for i, n in enumerate(M.ARM_JOINTS)}
LEFT_HAND_INDEX: dict[str, int] = {n: i for i, n in enumerate(M.NEODEM_LEFT_HAND)}
RIGHT_HAND_INDEX: dict[str, int] = {n: i for i, n in enumerate(M.NEODEM_RIGHT_HAND)}

#: The three joints `/action` accepts and then DROPS, reporting that it did.
#: `action_provider_wh_dds.get_action()` overwrites positions[12:15] with
#: `default_joint_pos` on every step, AFTER copying the arm block out of
#: rt/lowcmd, so a waist target is accepted by DDS and discarded by the sim.
#:
#: They are REPORTED rather than quietly skipped because the caller sends them on
#: purpose: `src/vla/action-contracts.ts` commands the waist deliberately (it
#: carries a constant ~-0.12 rad operator lean, worth ~52 mm of hand-path offset
#: at a 0.45 m lever) and is entitled to learn that three of its 31 numbers went
#: nowhere. Silence here would be the same class of defect this whole inlet exists
#: to remove.
WAIST_SET: frozenset[str] = frozenset(M.WAIST_JOINTS)

#: The wire text for that, as one constant, so the reply cannot drift from the
#: explanation above it.
WAIST_IGNORED_REASON = (
    "parked by the wholebody provider: action_provider_wh_dds.get_action() "
    "overwrites positions[12:15] with default_joint_pos after the arm copy, every "
    "step, so a waist target is accepted by DDS and discarded by the sim")

#: (lo, hi) per joint NAME, from `isaac_manip`'s tables -- which are lifted from
#: `sim_evaluator/mjcf/g1_dex3/g1_43dof_fixedbase_realism.xml`, NeoDEM's own model
#: of this hardware.
#:
#: DELIBERATELY NOT `g1_sidecar.py::POS_LIMITS`, which is hand-written and has
#: `left_hand_index_1_joint` and `left_hand_middle_1_joint` as (0.0, +1.7453)
#: where the MJCF says (-1.74533, 0.0). The sign is flipped, so a correctly
#: decoded CLOSING grip clamps straight back to open -- on exactly the two fingers
#: doing the grasping, and on the hand the grip decoder exists to serve. Borrowing
#: that table here would have re-introduced at the clamp the very failure the
#: decode prevents, and it would have looked like a decoder bug.
LIMITS_BY_NAME: dict[str, tuple[float, float]] = {
    **dict(zip(M.ARM_JOINTS, M.ARM_LIMITS)),
    **dict(zip(M.NEODEM_LEFT_HAND, M.HAND_LIMITS["left"])),
    **dict(zip(M.NEODEM_RIGHT_HAND, M.HAND_LIMITS["right"])),
}

#: Every joint name `/action` will act on: 14 arm + 7 + 7.
COMMANDABLE: frozenset[str] = frozenset(LIMITS_BY_NAME)

# Both tables are derived, so both of these hold by construction today. They are
# asserted because a future edit to a joint table is exactly what would break them,
# and the symptom -- one finger silently taking another's target -- is unreadable.
assert len(LIMITS_BY_NAME) == M.N_ARM + 2 * M.N_HAND, (
    "a joint name appears in more than one of the arm/left-hand/right-hand tables, "
    "so one limb's target would overwrite another's")
assert not (COMMANDABLE & WAIST_SET), "a waist joint is also listed as commandable"


def split_joint_dict(joints: dict, base: ManipTargets) -> tuple[ManipTargets, dict]:
    """Turn a name-keyed joint dict into `ManipTargets`, plus a report of what it did NOT do.

    `joints` is the shape `g1_sidecar.py`'s `/action` takes and the shape
    `HardwareClient.sendJointTargets()` posts: `{"<joint name>": radians}`. It may be
    partial -- anything absent keeps its value from `base`, normally the frame
    currently in the command slot -- so a caller driving only the arm need not
    restate fourteen fingers on every frame.

    THE VALUES ARE RADIANS. All of them, hands included. There is deliberately no
    grip-code path through this function; see the note at the `/action` call site.

    Every key the caller sent lands in exactly one of four lists, so "I sent 31
    joints and 28 were applied" is answerable from the reply alone:

        applied   written into the returned targets
        ignored   the three waist joints -- accepted by DDS, discarded by the sim
        unknown   not a joint this bridge can drive, under that name
        rejected  a value that is not a finite number

    `clamped` is advisory and overlaps `applied`: the target was accepted and WILL
    be clamped into range by the shaper on the publish thread. It is reported
    because a clamp is otherwise invisible from outside, and an invisible clamp on
    a finger is how a closing grasp arrives open.
    """
    arm = list(base.arm)
    left = list(base.left_hand)
    right = list(base.right_hand)
    applied: list[str] = []
    ignored: list[str] = []
    unknown: list[str] = []
    rejected: list[str] = []
    clamped: list[str] = []

    for name, raw in joints.items():
        if not isinstance(name, str):
            rejected.append(f"{name!r}: joint names must be strings")
            continue
        if name in WAIST_SET:
            ignored.append(name)
            continue
        if name in ARM_INDEX:
            vec, slot = arm, ARM_INDEX[name]
        elif name in LEFT_HAND_INDEX:
            vec, slot = left, LEFT_HAND_INDEX[name]
        elif name in RIGHT_HAND_INDEX:
            vec, slot = right, RIGHT_HAND_INDEX[name]
        else:
            unknown.append(name)
            continue
        # A JSON number, and nothing else. `float("0.5")` and `float(True)` both
        # succeed, and a caller sending strings or booleans is a caller whose
        # serialisation is broken in a way that will bite somewhere worse later.
        if isinstance(raw, bool) or not isinstance(raw, (int, float)):
            rejected.append(f"{name}: value must be a number, got {type(raw).__name__}")
            continue
        value = float(raw)
        if not math.isfinite(value):
            # NaN would reach the locomotion policy's observation buffer through the
            # arm block. `ManipTargets.make()` would refuse it a few lines further
            # down anyway; catching it here names the JOINT rather than the slot.
            rejected.append(f"{name}: value is not finite ({raw!r})")
            continue
        vec[slot] = value
        applied.append(name)
        lo, hi = LIMITS_BY_NAME[name]
        if value < lo or value > hi:
            clamped.append(name)

    report = {
        "applied": len(applied),
        "applied_joints": applied,
        "ignored": ignored,
        "unknown": unknown,
        "rejected": rejected,
        "clamped": clamped,
    }
    if ignored:
        report["reason"] = WAIST_IGNORED_REASON
    # `.make()` is the same 14+7+7 / all-finite validation the rest of the module
    # uses, and it normalises to tuples so the command slot stays immutable.
    return ManipTargets.make(arm, left, right), report


class ManipPublisher:
    """Publish arm + both hands at a fixed rate from a lock-free command slot.

    Threading model, copied from `isaac_loco_bridge.py`: exactly ONE thread ever
    touches the DDS publishers (`_run`, or `shutdown()` after it has been joined).
    Producers -- a VLA runner, `--probe`, an HTTP handler -- never publish; they
    assign `_slot`.

    `_slot` is a single immutable `(ManipTargets, seq)` tuple replaced by whole
    assignment, which is atomic under the GIL. That is why there is no lock: a
    reader either sees the previous frame in full or the new one in full, never a
    half-written arm vector, and a producer is never blocked behind a DDS write.
    A lock here would be correct too, but it would put an unbounded producer
    inside the publisher's period.
    """

    def __init__(self, domain: int, rate_hz: float = DEFAULT_RATE_HZ,
                 verbose: bool = True, iface: str | None = None,
                 init_dds: bool = True,
                 arm_rate_limit: float = M.ARM_RATE_LIMIT_RAD,
                 hand_rate_limit: float = M.HAND_RATE_LIMIT_RAD) -> None:
        if domain == 0:
            # Not a warning. rt/lowcmd on domain 0 is a real G1's low-level
            # command bus, and this file writes zeros into its leg slots.
            raise ValueError(
                "domain 0 is the REAL ROBOT and is refused: this bridge writes "
                "rt/lowcmd with zeroed leg slots, which the Isaac sim discards "
                "and a real G1 would obey. Use the sim domain (1) or the mock (9).")
        if rate_hz <= 0:
            raise ValueError("rate_hz must be > 0")

        # Recorded so `/health` can answer the three questions an operator asks
        # first -- which domain, which interface, and whether THIS process opened
        # the DDS participant or an embedder did (`init_dds=False`).
        self.domain = int(domain)
        self.iface = iface
        self.dds_initialised = bool(init_dds)
        self.arm_rate_limit = float(arm_rate_limit)
        self.hand_rate_limit = float(hand_rate_limit)
        self._loop_running = False

        self._rate = float(rate_hz)
        self._verbose = verbose
        self._stop = threading.Event()
        self._shutdown_lock = threading.Lock()
        self._shutdown_done = False
        self._sent = 0
        self._slot: tuple[ManipTargets, int] = (M.REST, 0)
        self._seq = 0
        # The last frame `_publish` actually put on the wire. None until one has
        # been. Written only by the publish thread (or `shutdown()` after it has
        # been joined), which is the same rule `_publish` itself follows.
        self._last_sent: ManipTargets | None = None
        self._shaper = M.ManipShaper(arm_rate_limit, hand_rate_limit)
        # Set by run() when the publish loop dies; main() reports it and exits non-zero.
        self.error: Exception | None = None

        from unitree_sdk2py.core.channel import (  # noqa: PLC0415
            ChannelFactoryInitialize, ChannelPublisher)
        from unitree_sdk2py.idl.default import (  # noqa: PLC0415
            unitree_hg_msg_dds__HandCmd_, unitree_hg_msg_dds__LowCmd_)
        from unitree_sdk2py.idl.unitree_hg.msg.dds_ import HandCmd_, LowCmd_  # noqa: PLC0415
        from unitree_sdk2py.utils.crc import CRC  # noqa: PLC0415

        if init_dds:
            # Same rule as isaac_loco_bridge: pass the interface only when asked.
            # Initialising the factory a SECOND time in one process tears down the
            # participant existing endpoints are bound to -- which is why the
            # embedded path (`init_dds=False`) exists at all.
            if iface:
                ChannelFactoryInitialize(domain, iface)
            else:
                ChannelFactoryInitialize(domain)

        self._crc = CRC()
        self._msg_low = unitree_hg_msg_dds__LowCmd_()
        self._pub_low = ChannelPublisher(TOPIC_LOWCMD, LowCmd_)
        self._pub_low.Init()
        self._msg_hand = {s: unitree_hg_msg_dds__HandCmd_() for s in M.SIDES}
        self._pub_hand = {}
        for side in M.SIDES:
            pub = ChannelPublisher(TOPIC_HAND_CMD.format(side), HandCmd_)
            pub.Init()
            self._pub_hand[side] = pub

        # Gains are published as ZERO, once, here. The Isaac provider reads only
        # `positions` and ignores kp/kd entirely, so this costs nothing there --
        # and it makes the identical message inert if it ever reaches real
        # hardware. Setting live gains "to be realistic" would be a loaded gun.
        for i in range(len(self._msg_low.motor_cmd)):
            self._msg_low.motor_cmd[i].q = 0.0
            self._msg_low.motor_cmd[i].kp = 0.0
            self._msg_low.motor_cmd[i].kd = 0.0
            self._msg_low.motor_cmd[i].dq = 0.0
            self._msg_low.motor_cmd[i].tau = 0.0
        for side in M.SIDES:
            for i in range(M.N_HAND):
                self._msg_hand[side].motor_cmd[i].kp = 0.0
                self._msg_hand[side].motor_cmd[i].kd = 0.0

        print(f"[manip] publishing {TOPIC_LOWCMD} + {TOPIC_HAND_CMD.format('{left,right}')} "
              f"on domain {domain} at {rate_hz:g} Hz", flush=True)

    # ------------------------------------------------------------------ producers
    @property
    def targets(self) -> ManipTargets:
        """The frame currently being published (post-shaping is not reflected here)."""
        return self._slot[0]

    @property
    def seq(self) -> int:
        """How many frames have been HANDED IN, as opposed to sent. Read with the
        slot, so it always belongs to the frame `targets` just returned."""
        return self._slot[1]

    @property
    def last_sent(self) -> ManipTargets | None:
        """The last frame actually put on the wire, or None before the first."""
        return self._last_sent

    @property
    def rate_hz(self) -> float:
        return self._rate

    @property
    def alive(self) -> bool:
        """True while the publish loop is running and has not recorded an error.

        The inlet refuses `/action` when this is false. Answering "ok" for a frame
        that provably cannot reach the wire is the one thing a command inlet must
        never do -- and it is worse here than elsewhere, because rt/lowcmd latches:
        the arms are still holding whatever went out last.
        """
        return self._loop_running and not self._stop.is_set() and self.error is None

    def snapshot(self) -> dict:
        """Everything `/health` reports about the publisher. No HTTP in here."""
        return {
            "domain": self.domain,
            "iface": self.iface,
            "dds_initialised": self.dds_initialised,
            "publishing": self.alive,
            "rate_hz": self._rate,
            "frames_sent": self._sent,
            "arm_rate_limit": self.arm_rate_limit,
            "hand_rate_limit": self.hand_rate_limit,
            "error": None if self.error is None else repr(self.error),
        }

    def set_targets(self, targets: ManipTargets) -> None:
        """Hand the publisher a new frame. Safe from any thread; never blocks.

        VALIDATED HERE, ON THE PRODUCER'S OWN THREAD, AND NOWHERE ELSE IS EARLY
        ENOUGH. `ManipTargets` is a NamedTuple, so `ManipTargets(a, b, c)` builds
        one out of anything at all without going through `.make()`; a policy that
        emits a NaN, a caller that hands over thirteen joints instead of
        fourteen, and a `None` from a failed inference all reach this method
        looking identical to a good frame.

        Left unchecked, the first place any of that is noticed is `shape()` --
        which runs on the PUBLISH thread. The failure that follows is the worst
        one available: `run()` catches the ValueError, calls `shutdown()`, and
        `shutdown()` used to blend out of the same poisoned slot and raise
        again, so nothing further was ever published. rt/lowcmd LATCHES, so the
        sim then holds the last commanded arm pose indefinitely -- the arms
        freeze mid-reach, which this file's own comments call worse than a stop.

        So the check happens on the way IN. The producer gets the ValueError on
        its own stack, where it can drop the frame and carry on; the slot keeps
        the last good frame; the publish thread never sees anything it cannot
        publish. `ManipTargets.make()` is the same validation the rest of the
        module uses -- 14 + 7 + 7, every value finite -- and it also normalises
        lists to tuples, so the slot is genuinely immutable.
        """
        if not isinstance(targets, ManipTargets):
            raise TypeError(
                "set_targets() takes a ManipTargets (use ManipTargets.make(), "
                f"targets_from_action31() or M.REST), got {type(targets).__name__}")
        checked = ManipTargets.make(targets.arm, targets.left_hand, targets.right_hand)
        self._seq += 1
        self._slot = (checked, self._seq)

    def set_action31(self, action, *, left_hand_units: str,
                     right_hand_units: str) -> ManipTargets:
        """Hand the publisher one 31-dim policy action.

        `left_hand_units` and `right_hand_units` are mandatory and have NO
        default -- a policy trained on the apple pick-and-place dataset emits a
        normalised grip CODE for the left hand, and sending that as radians opens
        the hand when the policy meant to close it (0/15 vs 13/15 on the replay
        gate). See `isaac_manip.HandUnits`.
        """
        t = M.targets_from_action31(action, left_hand_units=left_hand_units,
                                    right_hand_units=right_hand_units)
        self.set_targets(t)
        return t

    # ------------------------------------------------------------------- the wire
    def _publish(self, t: ManipTargets) -> None:
        """Write one frame. Called ONLY from the publish thread (or after its join)."""
        positions = M.pack_lowcmd_positions(t.arm)
        mc = self._msg_low.motor_cmd
        for i in range(M.LOWCMD_MIN_POSITIONS):
            mc[i].q = positions[i]
        # MANDATORY. `g1_robot_dds.dds_subscriber` recomputes this and drops the
        # whole message on mismatch, warning only on the sim's own console.
        self._msg_low.crc = self._crc.Crc(self._msg_low)
        self._pub_low.Write(self._msg_low)

        # BOTH sides, every frame: the provider's Dex3 block is guarded by
        # `if left_hand_cmd and right_hand_cmd:` and applies neither otherwise.
        for side, vals in (("left", t.left_hand), ("right", t.right_hand)):
            # The right hand, and only the right hand, is reordered here -- at the
            # last possible moment, so everything upstream speaks NeoDEM order.
            wire = M.remap_right_hand(vals, to="isaac") if side == "right" else list(vals)
            hmc = self._msg_hand[side].motor_cmd
            for i in range(M.N_HAND):
                hmc[i].q = wire[i]
            self._pub_hand[side].Write(self._msg_hand[side])
        self._sent += 1
        # Where the arms actually ARE, as opposed to where somebody asked for
        # them to be. `shutdown()` ramps out of this and not out of `_slot`,
        # because a slot can hold a target that was never publishable while this
        # can only ever hold a frame that has just gone out on the wire.
        self._last_sent = t

    def run(self) -> None:
        """The publish loop. One thread, forever, until `_stop`."""
        # Set BEFORE the try, cleared in the finally: `alive` gates the HTTP
        # inlet, and a window in which the loop is dead but still reports itself
        # alive is a window in which /action answers 200 for frames that reach
        # nothing.
        self._loop_running = True
        try:
            period = 1.0 / self._rate
            next_t = time.monotonic()
            last_seq = -1
            while not self._stop.is_set():
                t, seq = self._slot
                shaped = self._shaper.shape(t)
                self._publish(shaped)
                if self._verbose and seq != last_seq:
                    last_seq = seq
                    print(f"[manip] -> arm[0]={shaped.arm[0]:+.3f} "
                          f"lh[5]={shaped.left_hand[5]:+.3f} "
                          f"rh[3]={shaped.right_hand[3]:+.3f} (seq {seq})", flush=True)
                next_t += period
                # `_stop.wait()`, not `time.sleep()`: the wait has to be
                # INTERRUPTIBLE. `main()` joins this thread with a 2 s timeout
                # and then publishes the rest pose itself, so any sleep longer
                # than that outlives the join -- and below about 0.5 Hz one
                # period does. The join would return with the loop still inside
                # its sleep, and `shutdown()` would then enter `_publish()`
                # while this thread was about to as well, with both of them
                # mutating the one shared LowCmd_ message that CycloneDDS
                # serialises in C. That is the invariant this class states at
                # the top and it must hold at every rate, not just the default.
                self._stop.wait(max(0.0, next_t - time.monotonic()))
        except Exception as exc:
            # Unlike the locomotion slot, rt/lowcmd LATCHES: if this thread dies
            # the sim keeps holding the last arm pose forever. That is worse than
            # a stop, so go to rest on the way out rather than freezing mid-reach.
            self.error = exc
            self._stop.set()
            try:
                self.shutdown()
            except Exception as stop_exc:  # noqa: BLE001
                print(f"[manip] rest-pose stop failed: {stop_exc!r}",
                      file=sys.stderr, flush=True)
        finally:
            self._loop_running = False

    def shutdown(self, ramp_s: float = RAMP_S) -> None:
        """Ramp to the rest pose and stop. Idempotent; publishes, so join first.

        Rest is `arm = 0`, hands open -- and zero is not an arbitrary choice: it
        is the pose the Wholebody task holds when nothing publishes rt/lowcmd
        (`full_action.zero_()`), i.e. exactly where the arms will end up a moment
        after this process exits. Ramping there makes the handover continuous; a
        bare stop would leave the sim to snap the arms from a reach to zero in one
        physics step, which throws whatever the robot was holding.

        A STOP MUST ALWAYS BE REACHABLE, and that is a stronger requirement than
        a nice ramp. Two things enforce it here:

          * the ramp starts from `_last_sent` -- the pose actually on the wire --
            not from `_slot`, which is a REQUEST and is exactly what a bad frame
            poisons. Blending out of the slot is how a single NaN used to take
            the rest pose down with the publisher;
          * and if the ramp raises anyway, the rest pose is published directly.
            An abrupt stop is bad; rt/lowcmd latching a mid-reach pose forever
            is worse, and that is the only other option.
        """
        self._stop.set()
        with self._shutdown_lock:
            if self._shutdown_done:
                return
            self._shutdown_done = True
        try:
            self._ramp_to_rest(ramp_s)
        except Exception as exc:  # noqa: BLE001 -- there is no failure to pass on to
            print(f"[manip] rest-pose RAMP failed ({exc!r}); publishing the rest pose "
                  f"directly instead", file=sys.stderr, flush=True)
            self._publish_rest()
        print(f"[manip] at rest after {self._sent} frames", flush=True)

    def _ramp_to_rest(self, ramp_s: float) -> None:
        """Blend from the last frame actually published to REST, over `ramp_s`."""
        start = self._last_sent if self._last_sent is not None else M.REST
        steps = max(1, int(ramp_s * self._rate))
        for i in range(1, steps + 1):
            f = i / steps
            blend = ManipTargets(
                tuple(a + (b - a) * f for a, b in zip(start.arm, M.REST.arm)),
                tuple(a + (b - a) * f for a, b in zip(start.left_hand, M.REST.left_hand)),
                tuple(a + (b - a) * f for a, b in zip(start.right_hand, M.REST.right_hand)))
            self._publish(self._shaper.shape(blend))
            time.sleep(1.0 / self._rate)

    def _publish_rest(self) -> None:
        """Put REST on the wire in one frame, with nothing in the way.

        The shaper is reset first, deliberately: its rate limiter would otherwise
        hold the arm 0.2 rad from where it last was, and this is the path taken
        when the ramp is already known to be broken. One step to rest is not the
        gentle handover the docstring above describes -- it is the fallback, and
        the alternative to it is a latched pose that never moves again.
        """
        try:
            self._shaper.reset(M.REST)
            self._publish(M.REST)
        except Exception as exc:  # noqa: BLE001
            print(f"[manip] COULD NOT PUBLISH THE REST POSE: {exc!r}. rt/lowcmd latches, "
                  f"so the sim is still holding the last arm pose -- stop the scene.",
                  file=sys.stderr, flush=True)


class StateReader:
    """Keep the newest rt/lowstate and rt/dex3/{left,right}/state. Nothing else.

    WHY THIS IS HERE AND NOT IN THE SIDECAR, WHICH OWNS /state. Because the
    sidecar's read path points at a robot that is not there. `g1_sidecar.py` under
    `G1_READ_ONLY=1` gets its joints from `g1_state_bridge_readonly.py`, which
    opens a TCP socket to the REAL G1's IP; on this box nothing answers, `/health`
    says `"connected": false`, and `GET /state/fast` returns `{"joints": []}` with
    HTTP 200. Measured through the facade minutes before this class was written.
    That 200 is what makes it dangerous: `HardwareClient.getStateNow()` treats a
    missing name as 0.0, so the policy gets 43 zeros and nothing anywhere reports
    an error. This process is already on the sim's DDS domain with the factory
    initialised, so it is the cheapest place in the rig that can answer honestly.

    THREADING. One SDK reader thread per topic (`Init(handler, queueLen=1)`) calls
    `_take`, which does ~29 attribute reads, builds one tuple and stores it. The
    publish loop is not involved at any point -- `rt/lowcmd` at 50 Hz is this
    bridge's real job and nothing here may make it stutter. Each slot is replaced
    by a single dict item assignment, atomic under the GIL, so an HTTP thread sees
    either the previous sample in full or the new one in full; that is the same
    lock-free hand-off `ManipPublisher._slot` uses and for the same reason.

    `queueLen=1` and not the locomotion bridge's 10: this class only ever wants
    the NEWEST sample, and `BQueue.Put` drops on overflow rather than replacing,
    so a deeper queue can only put older samples in front of the one we want.

    STALENESS IS ABSENCE, NEVER A ZERO. A source that has not been heard, or whose
    last sample is older than `max_age_s`, contributes NO joints. See
    `isaac_manip.label_state()` for why a fabricated zero is worse here than
    anywhere else: 0.0 is a plausible angle for most of these joints, and the
    consumer cannot tell the two apart.
    """

    def __init__(self, *, max_age_s: float = DEFAULT_STATE_MAX_AGE_S,
                 subscribe: bool = True, verbose: bool = True,
                 queue_len: int = 1) -> None:
        if max_age_s <= 0:
            raise ValueError("state max_age_s must be > 0 (a zero window makes every "
                             "sample stale, i.e. every joint absent)")
        self.max_age_s = float(max_age_s)
        self.subscribed = bool(subscribe)
        self._verbose = verbose
        # source -> (values, monotonic recv) or None. Replaced whole; never mutated.
        self._slot: dict[str, tuple[tuple[float, ...], float] | None] = {
            s: None for s in STATE_SOURCES}
        self.samples: dict[str, int] = {s: 0 for s in STATE_SOURCES}
        self.bad: dict[str, int] = {s: 0 for s in STATE_SOURCES}
        self.topics: dict[str, str] = {
            "body": TOPIC_LOWSTATE,
            "left_hand": TOPIC_HAND_STATE.format("left"),
            "right_hand": TOPIC_HAND_STATE.format("right"),
        }
        self._subs: list = []
        if not subscribe:
            # For the offline verifier and for an embedder that feeds this object
            # itself. No SDK import at all on this path, so the whole read contract
            # can be exercised on an interpreter that has no `unitree_sdk2py`.
            return

        from unitree_sdk2py.core.channel import ChannelSubscriber  # noqa: PLC0415
        from unitree_sdk2py.idl.unitree_hg.msg.dds_ import (  # noqa: PLC0415
            HandState_, LowState_)

        # NO ChannelFactoryInitialize HERE. `ManipPublisher.__init__` has already
        # opened the participant this process uses; initialising the factory a
        # second time tears down the endpoints the publishers are bound to, which
        # would trade a state read for the arms. Construct this AFTER the
        # publisher, always.
        for source, msg_type, handler in (
                ("body", LowState_, self._on_body),
                ("left_hand", HandState_, self._on_hand("left_hand")),
                ("right_hand", HandState_, self._on_hand("right_hand"))):
            sub = ChannelSubscriber(self.topics[source], msg_type)
            sub.Init(handler, queue_len)
            self._subs.append(sub)

    # ------------------------------------------------------- SDK reader threads
    def _on_body(self, msg) -> None:
        self._take("body", msg, M.N_BODY)

    def _on_hand(self, source: str):
        return lambda msg: self._take(source, msg, M.N_HAND)

    def _take(self, source: str, msg, count: int) -> None:
        """Store one sample. Runs on an SDK reader thread; must not raise.

        A malformed sample must not kill the thread that feeds it -- the failure
        would be a source that silently stops updating while `/health` keeps
        reporting the age of the last good sample, i.e. the exact silence this
        whole file exists to remove. Count it, say so once, keep the old sample
        (which will go stale on its own and then be reported as absent).
        """
        try:
            motors = msg.motor_state
            values = tuple(float(motors[i].q) for i in range(min(count, len(motors))))
        except Exception as exc:  # noqa: BLE001
            self.bad[source] += 1
            if self.bad[source] == 1:
                print(f"[state] cannot read motor_state from {self.topics[source]} "
                      f"({exc!r}); those joints will be reported ABSENT, not zero",
                      file=sys.stderr, flush=True)
            return
        self._slot[source] = (values, time.monotonic())
        self.samples[source] += 1
        if self.samples[source] == 1 and self._verbose:
            print(f"[state] {self.topics[source]} acquired — {len(values)} joints",
                  flush=True)

    # ------------------------------------------------------------ reader side
    def feed(self, source: str, values) -> None:
        """Inject one sample without DDS. For `subscribe=False` embedders and tests."""
        if source not in STATE_SOURCES:
            raise ValueError(f"unknown state source {source!r}; expected one of "
                             f"{', '.join(STATE_SOURCES)}")
        self._slot[source] = (tuple(float(v) for v in values), time.monotonic())
        self.samples[source] += 1

    def _source_report(self, source: str, now: float) -> tuple[dict, tuple | None]:
        """`({report}, values-or-None)` for one source, from ONE read of its slot."""
        slot = self._slot[source]
        report = {
            "topic": self.topics[source],
            "samples": self.samples[source],
            "bad_samples": self.bad[source],
        }
        if slot is None:
            report["state"] = "never"
            report["age_s"] = None
            report["joints"] = 0
            return report, None
        values, at = slot
        age = now - at
        report["age_s"] = round(age, 3)
        # "never" and "stale" are different failures and are named differently:
        # the first means that publisher never came up (wrong DDS domain, scene
        # without hands, sim not started); the second means it stopped.
        report["state"] = "ok" if age <= self.max_age_s else "stale"
        report["joints"] = len(values) if age <= self.max_age_s else 0
        return report, (values if age <= self.max_age_s else None)

    def read(self) -> dict:
        """The whole read contract, from one pass over the three slots.

        Every age in the reply is measured against ONE `now`, so the three cannot
        disagree about when they were taken.
        """
        now = time.monotonic()
        reports: dict[str, dict] = {}
        values: dict[str, tuple | None] = {}
        for source in STATE_SOURCES:
            reports[source], values[source] = self._source_report(source, now)
        by_name, dropped = M.label_state(
            body=values["body"],
            left_hand=values["left_hand"],
            # THE SIM'S ORDER, NOT THE REAL ROBOT'S. rt/dex3/right/state carries
            # middle_0, middle_1 in slots 3-4 here and index_0, index_1 on a real
            # G1; `g1_sidecar.py` reads the same topic with the other table
            # because it reads real hardware. Stated at the call site because the
            # two files disagreeing is correct and looks like a bug.
            right_hand=values["right_hand"],
            right_hand_order="isaac")
        missing = [s for s in STATE_SOURCES if values[s] is None]
        return {
            "joints": M.state_joint_list(by_name),
            "sources": reports,
            "missing": missing,
            "dropped_joints": dropped,
            "complete": not missing and not dropped
            and len(by_name) == M.N_STATE,
            "body_present": values["body"] is not None,
            "max_age_s": self.max_age_s,
        }

    def close(self) -> None:
        for sub in self._subs:
            try:
                sub.Close()
            except Exception:  # noqa: BLE001 -- shutting down; nothing to pass on
                pass
        self._subs = []


# --------------------------------------------------------------------------- the inlet
#
# WHY THIS FILE GREW AN HTTP SERVER AT ALL
# ----------------------------------------
# Because nothing else in the rig can move the simulated arms, and until now
# nothing outside this process could reach it. `set_targets()` is an in-process
# API; with no `--probe` the bridge printed "holding the rest pose" and idled
# forever while a VLA rollout POSTed name-keyed joint dicts at
# `isaac_camera_facade.py` (:8779), which proxied them to `g1_sidecar.py` (:8777),
# whose `/action` is a REAL-ROBOT path that cannot serve this rig even with
# `G1_READ_ONLY=0`: `lerobot` is not installed in the rig's interpreter, the
# driver hardcodes DDS domain 0 -- the real G1's bus -- and it has no hand
# publisher at all. So the policy's actions reached an endpoint that could only
# ever refuse them, and the simulated arms had no command inlet whatsoever.
#
# G1_READ_ONLY=1 therefore STAYS AS IT IS. Flipping it buys nothing here and
# points a domain-0 publisher at the real robot's bus.
#
# THREADING. The HTTP server runs on its own threads and NEVER publishes. It
# assigns `_slot` through `set_targets()`, which is the lock-free producer path
# this class was designed around: a whole-tuple assignment, atomic under the GIL,
# so the publish thread sees the previous frame in full or the new one in full and
# is never blocked behind a request. The one lock added below is held only by HTTP
# threads and never by the publisher.

BOOT_ID = f"{int(time.time())}-{os.getpid()}"

#: The `/action` reply always states this. It costs twenty bytes and it is the
#: single fact that, when it was wrong, was worth 0/15 versus 13/15 carries.
UNITS = "radians"


#: What `/state/fast` REFUSES to answer a partial vector for. See `state_fast()`.
STATE_REQUIRE_CHOICES = ("body", "all")


def make_handler(pub: "ManipPublisher", *, port: int,
                 reader: "StateReader | None" = None,
                 state_require: str = "body"):
    """The HTTP surface of the manipulation bridge: /action, /estop, /state*, /health.

    A closure rather than a class attribute so a test can stand up two of these
    against two publishers without either one's counters leaking into the other.

    `reader` is optional and its absence is not an error: a bridge started with
    `--no-state` still commands the arms. The state routes then answer 503 with
    the reason rather than 404, because the facade routes `/state*` here on
    configuration alone and a 404 would tell the caller the route does not exist
    when what is true is that this operator turned it off.
    """
    if state_require not in STATE_REQUIRE_CHOICES:
        raise ValueError(f"state_require must be one of "
                         f"{', '.join(STATE_REQUIRE_CHOICES)}, got {state_require!r}")
    #: Sources whose absence makes `/state/fast` a 503 instead of a short list.
    required = frozenset(STATE_SOURCES) if state_require == "all" else frozenset({"body"})
    # Held ONLY by HTTP threads, and only across "read the slot -> build the new
    # frame -> set_targets()". Two concurrent POSTs both read the same base frame
    # otherwise, and the loser's joints vanish -- an arm-only request and a
    # hand-only request arriving together would apply just one of them. The
    # publish thread never touches this lock, so the producer/publisher path stays
    # exactly as lock-free as it was.
    apply_lock = threading.Lock()

    # Written by HTTP threads under `apply_lock`, read by /health without it: each
    # is replaced by whole assignment, so a reader sees one version or the other.
    stats: dict = {"last_action": None, "last_estop": None, "unknown_seen": ()}

    def note_unknown(names) -> None:
        """Remember every joint name this bridge was asked for and does not have.

        A per-request `unknown` list only helps a caller that reads bodies.
        /health accumulates them so an operator who polls one URL can see that a
        rollout has been addressing joints that do not exist -- which otherwise
        looks exactly like a policy that has decided to hold still.
        """
        fresh = [n for n in names if n not in stats["unknown_seen"]]
        if not fresh:
            return
        stats["unknown_seen"] = tuple(stats["unknown_seen"]) + tuple(fresh)
        print(f"[manip] /action asked for joint(s) this bridge cannot drive: "
              f"{', '.join(fresh)}", file=sys.stderr, flush=True)

    def rest_eta_s() -> float:
        """How long the publish thread needs to walk from where it is to REST.

        Reported by /estop so the caller knows the stop is a RAMP and roughly how
        long it takes, rather than being told "ok" and left to guess.
        """
        start = pub.last_sent or pub.targets
        arm_d = max((abs(a - b) for a, b in zip(start.arm, M.REST.arm)), default=0.0)
        hand_d = max(
            (abs(a - b) for a, b in
             list(zip(start.left_hand, M.REST.left_hand))
             + list(zip(start.right_hand, M.REST.right_hand))),
            default=0.0)
        arm_rate = pub.arm_rate_limit or float("inf")
        hand_rate = pub.hand_rate_limit or float("inf")
        frames = max(arm_d / arm_rate, hand_d / hand_rate)
        return round(frames / pub.rate_hz, 3)

    def health() -> tuple[int, dict]:
        state = pub.snapshot()
        last = stats["last_action"]
        estop = stats["last_estop"]
        now = time.time()
        payload = {
            "ok": state["publishing"],
            # "starting" only before the first frame goes out. The publish loop
            # runs whether or not Isaac is listening -- there is no way to tell
            # from here whether anything RECEIVES these frames, and this file will
            # not pretend otherwise.
            "status": ("dead" if not state["publishing"]
                       else "ok" if state["frames_sent"] > 0 else "starting"),
            "role": "isaac-manip-inlet",
            "boot_id": BOOT_ID,
            "port": port,
            "domain": state["domain"],
            "iface": state["iface"],
            "dds_initialised": state["dds_initialised"],
            "publishing": state["publishing"],
            "rate_hz": state["rate_hz"],
            "frames_sent": state["frames_sent"],
            "error": state["error"],
            "units": UNITS,
            "commandable_joints": len(COMMANDABLE),
            "ignored_joints": sorted(WAIST_SET),
            "ignored_reason": WAIST_IGNORED_REASON,
            "unknown_joints_seen": list(stats["unknown_seen"]),
            "arm_rate_limit_rad_per_frame": state["arm_rate_limit"],
            "hand_rate_limit_rad_per_frame": state["hand_rate_limit"],
            "last_action": None if last is None else {
                "age_s": round(now - last["unix"], 3),
                "unix": round(last["unix"], 3),
                "applied": last["applied"],
                "seq": last["seq"],
            },
            "last_estop": None if estop is None else {
                "age_s": round(now - estop["unix"], 3),
                "unix": round(estop["unix"], 3),
            },
        }
        # THE READ PATH, ALWAYS REPORTED, WHETHER OR NOT IT IS WORKING. An operator
        # looking at one URL has to be able to see which of the three sources is
        # missing -- because the failure mode this bridge was given a read path to
        # remove is precisely the one that shows no symptom anywhere else: 43 zeros
        # served with a 200 and a policy that behaves oddly for no visible reason.
        if reader is None:
            payload["state"] = {"enabled": False,
                                "note": "--no-state: not subscribed to rt/lowstate or "
                                        "rt/dex3/*/state; /state/fast answers 503"}
        else:
            snap = reader.read()
            payload["state"] = {
                "enabled": True,
                "subscribed": reader.subscribed,
                "complete": snap["complete"],
                "joints": len(snap["joints"]),
                "expected": M.N_STATE,
                "missing": snap["missing"],
                "require": state_require,
                "max_age_s": snap["max_age_s"],
                "sources": snap["sources"],
            }
            if snap["dropped_joints"]:
                payload["state"]["dropped_joints"] = snap["dropped_joints"]
        # `ok` and the status code stay a verdict on PUBLISHING, deliberately. The
        # bringup script's readiness probe is `curl -sf` on this route and it runs
        # before Isaac has finished booting, so a state source that has not
        # appeared yet must not fail it -- and a bridge that can still move the
        # arms is not dead. `state.complete` is where the read path's verdict is.
        # 503, not a 200 with a sad field: the bringup script's readiness probe is
        # `curl -sf`, and a bridge whose publish loop has died is not ready by any
        # reading. rt/lowcmd latches, so it is also still holding whatever pose it
        # last sent -- which is exactly when an operator most needs to be told.
        return (200 if state["publishing"] else 503), payload

    def action(body: dict) -> tuple[int, dict]:
        if not pub.alive:
            # Never "ok" for a frame that cannot reach the wire. `sendAction()`
            # raises HardwareActionError on this, which ends the rollout with the
            # reason attached -- the correct outcome for a closed loop whose
            # commands are going nowhere.
            return 503, {"ok": False, "units": UNITS,
                         "error": f"the publish thread is not running ({pub.error!r}); "
                                  f"nothing this route accepts would reach the sim"}
        if not isinstance(body, dict):
            return 400, {"ok": False, "units": UNITS,
                         "error": f'body must be a JSON object of {{"joint": radians}}, '
                                  f"got {type(body).__name__}"}
        with apply_lock:
            base = pub.targets
            try:
                # RADIANS IN, RADIANS OUT -- AND NOTHING IS DECODED HERE.
                #
                # `src/vla/action-contracts.ts` has ALREADY decoded the left-hand
                # grip code before it POSTs (`decodeLeftHandGrip`, applied in place
                # over action[14:21]). Decoding a second time here would run the
                # decoder over values that are already joint angles: a decoded
                # CLOSE lands near -0.7 rad, which the decoder reads as a NEGATIVE
                # grip, clamps to 0.0, and turns back into the OPEN pose. The hand
                # would open at exactly the moment the policy meant it to close --
                # the same failure as sending the code raw (0/15 vs 13/15 carries
                # through the replay gate), arrived at from the opposite direction
                # and twice as hard to see, because both ends of the wire would be
                # "doing the decode properly".
                #
                # So: HandUnits.RADIANS, never APPLE_PNP_GRIP_CODE, and this route
                # deliberately does not go through `set_action31()` -- whose whole
                # purpose is to make a caller name its units, a question that is
                # already answered by the time a name-keyed dict exists.
                targets, report = split_joint_dict(body, base)
            except ValueError as exc:
                # `ManipTargets.make()` refusing the assembled frame. The producer
                # hears it here, on its own request, and the slot keeps the last
                # good frame.
                return 400, {"ok": False, "units": UNITS, "error": str(exc)}
            note_unknown(report["unknown"])
            if report["applied"] == 0:
                # Nothing was commanded. Refuse LOUDLY rather than answering "ok, 0
                # applied": a dict of thirty-one joint names none of which this
                # bridge recognises is a caller whose vocabulary has drifted, and
                # that reads as a policy holding still if it is answered with a 200.
                # Which of the two it is matters. "No commandable joint" points the
                # operator at the joint NAMES; if the names were fine and every VALUE
                # was malformed, that message sends them to the wrong place entirely.
                if report["rejected"]:
                    why = ("every joint in the request was rejected: "
                           + "; ".join(report["rejected"]))
                else:
                    why = ("no commandable joint in the request — this bridge drives "
                           f"{len(COMMANDABLE)} joints (14 arm + 7 + 7 Dex3, "
                           f"sim_g1_dds/joints.py names)")
                return 400, {
                    "ok": False, "units": UNITS, "error": why,
                    "applied": 0, "ignored": report["ignored"],
                    "unknown": report["unknown"], "rejected": report["rejected"],
                    **({"reason": report["reason"]} if "reason" in report else {}),
                }
            pub.set_targets(targets)
            seq = pub.seq
            stats["last_action"] = {"unix": time.time(),
                                    "applied": report["applied"], "seq": seq}
        out = {"ok": True, "units": UNITS, "seq": seq,
               "applied": report["applied"],
               "ignored": report["ignored"],
               "unknown": report["unknown"],
               "rejected": report["rejected"],
               "clamped": report["clamped"]}
        if "reason" in report:
            out["reason"] = report["reason"]
        return 200, out

    def estop() -> tuple[int, dict]:
        """Ramp the arms and hands to the rest pose. THE STOP THAT ACTUALLY STOPS.

        `HardwareClient.releaseAction()` POSTs `/estop`, and on this rig that call
        has to land here rather than on the sidecar. rt/lowcmd LATCHES in the Isaac
        Wholebody task -- `g1_robot_dds.py` writes into shared memory that
        `get_action()` reads and never clears -- so a "stop" that publishes nothing
        leaves the sim holding the last commanded pose indefinitely: the arms freeze
        mid-reach, which this file's own comments call worse than a stop. The
        sidecar's `/estop` clears a ramp-state dict that is empty under
        `G1_READ_ONLY=1` and touches no joint of this simulator.

        REST is `arm = 0`, hands open -- not an arbitrary safe pose but the one the
        Wholebody task holds when nothing publishes rt/lowcmd (`full_action.zero_()`),
        i.e. exactly where the arms go a moment after this process exits. Ramping
        there makes the handover continuous instead of a lurch that throws whatever
        the robot is holding.

        THIS ROUTE DOES NOT PUBLISH. It moves the command slot to REST and lets the
        publish thread walk there under the shaper's rate limiter. That is not
        squeamishness: `_publish` mutates one shared LowCmd_ message that CycloneDDS
        serialises in C, and a second thread inside it corrupts a message
        mid-serialisation. `shutdown()`'s ramp is safe only because `main()` joins
        the publish thread first, which an HTTP handler cannot do.

        AND IT DOES NOT LATCH. An E-Stop that the next 20 ms policy frame overwrites
        would not be a stop, so a latch is the obvious thing to add -- and it would
        wedge this rig. `releaseAction()` has two callers: a category-0 safety stop,
        and `stopTeleopForwarding()`, the ROUTINE handback at the end of every teleop
        session. Nothing ever posts a reset. A latch here would therefore leave the
        arms unusable after the first ordinary session, with no route to clear it.
        The latch that must exist already exists upstream, in
        `RobotStateManager.forwardTeleopToHardware()`, which refuses to send
        `/action` at all while an E-Stop is latched.
        """
        if not pub.alive:
            return 503, {"ok": False,
                         "error": f"the publish thread is not running ({pub.error!r}); "
                                  f"this route cannot move the arms. rt/lowcmd latches, "
                                  f"so the sim is still holding the last pose sent — "
                                  f"stop the scene"}
        with apply_lock:
            pub.set_targets(M.REST)
            seq = pub.seq
            stats["last_estop"] = {"unix": time.time()}
        eta = rest_eta_s()
        print(f"[manip] /estop — ramping to the rest pose (~{eta:g} s)", flush=True)
        return 200, {
            "ok": True, "action": "ramp-to-rest", "seq": seq, "units": UNITS,
            "rest": {"arm": "zero (the pose the Wholebody task holds unpublished)",
                     "hands": "open"},
            "eta_s": eta,
            "arm_rate_limit_rad_per_frame": pub.arm_rate_limit,
            "hand_rate_limit_rad_per_frame": pub.hand_rate_limit,
            "note": "rt/lowcmd LATCHES in this sim, so a stop that publishes nothing "
                    "leaves the arms frozen mid-reach. The publish thread ramps to the "
                    "rest pose; the bridge keeps running and accepts /action again.",
        }

    # ------------------------------------------------------------------ the read path
    def state_disabled() -> tuple[int, dict]:
        return 503, {
            "ok": False, "joints": [], "connected": False,
            "error": "this bridge was started with --no-state, so it is not "
                     "subscribed to rt/lowstate or rt/dex3/*/state. Nothing else in "
                     "this rig reads the robot's joints — the sidecar's state source "
                     "is a TCP link to a real G1 that does not exist here — so a VLA "
                     "rollout would be fed 43 zeros. Restart without --no-state.",
        }

    def state_payload(snap: dict) -> dict:
        """The fields both state routes share. One snapshot in, one reply out."""
        payload = {
            "joints": snap["joints"],
            "count": len(snap["joints"]),
            "expected": M.N_STATE,
            # The three questions an operator has when the vector is short: is it
            # short, which source is gone, and how long has it been gone.
            "complete": snap["complete"],
            "missing": snap["missing"],
            "sources": snap["sources"],
            "max_age_s": snap["max_age_s"],
            "units": UNITS,
            "source": "isaac-dds",
            # `connected` drives HardwareClient.setConnected() on the 2 s /state
            # poll. It is the BODY topic and nothing else: no rt/lowstate means no
            # legs, no waist and no arms, which is not a connection by any reading.
            "connected": snap["body_present"],
            "simulated": True,
            "timestamp": round(time.time(), 3),
            "boot_id": BOOT_ID,
        }
        if snap["dropped_joints"]:
            # Non-finite values on the wire. Named, because they are dropped: a NaN
            # in the reply would also make the JSON unparseable to JSON.parse, which
            # turns a bad sample into an unexplained client-side crash.
            payload["dropped_joints"] = snap["dropped_joints"]
        return payload

    def state_fast() -> tuple[int, dict]:
        """`GET /state/fast` — the policy's 43-dim observation, or an honest refusal.

        WHY THIS REFUSES INSTEAD OF ANSWERING A PARTIAL VECTOR.

        Its only consumer is `HardwareClient.getStateNow()`, which maps the reply
        by name onto a FIXED 43-slot vector and writes 0.0 into every slot it
        cannot fill. So a partial reply is not received as partial: it is received
        as a complete observation in which some joints happen to read zero, and
        0.0 is a plausible angle for most of these joints. There is no field this
        route could add that would change that, because the caller does not look
        at any other field. The only signal that survives the mapping is the HTTP
        status, and `getStateNow()` throws on a non-200 — which ends the rollout
        with the reason attached, the correct outcome for a closed loop whose
        observation is missing.

        SO THE LINE IS DRAWN AT THE BODY TOPIC, and by default only there. Without
        rt/lowstate, 29 of 43 numbers would be fabricated — every leg, the waist
        and both arms, i.e. the robot's whole posture. That is not an observation
        with gaps, it is a different robot. A missing HAND costs 7 of 43 and only
        matters during a grasp, and it is the more likely of the two to hiccup
        (the vendor rate-limits that observation term separately), so by default
        those joints are simply absent and the absence is reported in `missing`,
        in `complete`, and in `/health`. `--state-require all` moves the line to
        all three for a caller that would rather stop than grasp on a zeroed hand.

        No waiting for a fresh sample, unlike `isaac_camera_facade`: the sources
        publish on the scene's own step, so a request can be at most one step
        behind and the max age is seven of them. Waiting would only add latency to
        a rollout's inner loop.
        """
        if reader is None:
            return state_disabled()
        snap = reader.read()
        payload = state_payload(snap)
        blocked = sorted(s for s in snap["missing"] if s in required)
        if blocked:
            detail = "; ".join(
                f"{s} ({snap['sources'][s]['topic']}: {snap['sources'][s]['state']}"
                + (f", {snap['sources'][s]['age_s']}s old" if snap["sources"][s]["age_s"]
                   is not None else "")
                + ")" for s in blocked)
            payload["ok"] = False
            payload["error"] = (
                f"refusing to answer a partial state: {detail}. getStateNow() fills "
                f"every joint it does not receive with 0.0, so serving this would "
                f"hand the policy fabricated angles it cannot tell from measured "
                f"ones. Check that the Isaac scene is stepping and that this bridge "
                f"is on its DDS domain.")
            return 503, payload
        payload["ok"] = True
        return 200, payload

    def state_poll() -> tuple[int, dict]:
        """`GET /state` — the same joints, for the robot agent's 2 s status poll.

        ALWAYS 200, unlike `/state/fast`, and the difference is the consumer.
        `HardwareClient.startPolling()` does not check the status code; it reads
        `connected` and carries the joints it was given through to telemetry and
        the 3D viewer, by name, with no fixed-width vector anywhere. A short list
        there is genuinely partial information and is handled as such, so refusing
        would throw away the joints that ARE known and flip the agent to
        disconnected for a hand-topic hiccup.

        The groups this route does NOT send are as deliberate as the ones it does:

          * `imu` — the sim never fills `imu_state.rpy` (`dds/g1_robot_dds.py:97`
            writes only quaternion, accelerometer and gyroscope), and it writes
            the quaternion as [x,y,z,w] into a field the SDK documents w-first.
            Emitting rpy from here would publish a (0,0,0) orientation for a robot
            that is not level — and this is the one group where a fabricated zero
            is worse than a missing one: `getImuNow()` returns null when the group
            is absent and `SafetyMonitor` treats null as "no reliable IMU", but a
            perfectly level reading it can parse ARMS the absolute-tilt stop with
            a value that can never trip it, masking a fall. Heading has an owner
            already: `isaac_loco_bridge.py`, which converts that quaternion under
            `--quat-order` and publishes rt/odommodestate, reaching the agent
            through the sidecar's /loco/odom.
          * `touch` — `dds/dex3_dds.py` publishes q, dq and tau_est only; there
            are no press sensors in this scene.
          * `battery`, `odometry` — nothing in this process reads them. An absent
            group is parsed as null by the client, which is the truth.
        """
        if reader is None:
            _code, payload = state_disabled()
            return 200, payload      # the poll reads `connected`, not the status
        payload = state_payload(reader.read())
        payload["ok"] = payload["connected"]
        return 200, payload

    class Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"
        # Every reply sets Content-Length, so keep-alive is safe -- and a keep-alive
        # connection has to be able to die on its own, or a robot-agent that vanished
        # without closing its sockets strands a thread in rfile.readline() forever.
        # Same reasoning and same number as isaac_camera_facade.py.
        timeout = 30

        def _send(self, code: int, payload: dict) -> None:
            body = json.dumps(payload).encode()
            self.send_response(code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *args) -> None:  # the [manip] lines are the useful log
            pass

        def do_GET(self) -> None:
            path, _, _q = self.path.partition("?")
            if path == "/health":
                self._send(*health())
                return
            if path == "/state/fast":
                self._send(*state_fast())
                return
            if path == "/state":
                self._send(*state_poll())
                return
            self._send(404, {"ok": False, "error": f"not found: {path} — this inlet "
                                                   f"serves GET /health, GET /state, "
                                                   f"GET /state/fast, POST /action, "
                                                   f"POST /estop"})

        def do_POST(self) -> None:
            path, _, _q = self.path.partition("?")
            length = int(self.headers.get("Content-Length", 0) or 0)
            raw = self.rfile.read(length) if length else b""
            if path == "/estop":
                # Read the body first (above) and ignore it: `releaseAction()` posts
                # "{}", and leaving an unread body on a keep-alive connection makes
                # the NEXT request read it as a request line.
                self._send(*estop())
                return
            if path == "/action":
                try:
                    body = json.loads(raw or b"{}")
                except json.JSONDecodeError as exc:
                    self._send(400, {"ok": False, "units": UNITS,
                                     "error": f"body is not JSON: {exc}"})
                    return
                self._send(*action(body))
                return
            self._send(404, {"ok": False, "error": f"not found: {path} — this inlet "
                                                   f"serves GET /health, GET /state, "
                                                   f"GET /state/fast, POST /action, "
                                                   f"POST /estop"})

    return Handler


def serve(pub: "ManipPublisher", bind: str, port: int,
          reader: "StateReader | None" = None,
          state_require: str = "body") -> ThreadingHTTPServer:
    """Start the inlet on its own daemon thread and return the server.

    Caller shuts it down BEFORE stopping the publisher, so no request can arrive
    while `shutdown()` is ramping to rest -- an /action landing in the middle of
    that ramp would move the command slot back out of the rest pose and the
    process would exit leaving a latched non-rest arm command in the sim.
    """
    httpd = ThreadingHTTPServer(
        (bind, port),
        make_handler(pub, port=port, reader=reader, state_require=state_require))
    httpd.daemon_threads = True
    threading.Thread(target=httpd.serve_forever, daemon=True, name="manip-http").start()
    return httpd


def probe(pub: ManipPublisher) -> None:
    """Raise the left arm and close the left hand, with no VLA in the loop.

    A wire and convention check, the manipulation counterpart of
    `isaac_loco_bridge.probe()`. What to look for, in order:

      * the LEFT arm lifts and the right one does not  -> the [15:29] arm slice
        and the left/right split are right;
      * the LEFT hand closes                            -> rt/dex3/left/cmd lands;
      * the RIGHT hand's INDEX finger moves and its middle finger does not
        -> the right-hand remap is right. This is the check worth having: without
        the remap the middle finger moves instead, and nothing else looks wrong.
    """
    left_up = list(M.ARM_ZERO)
    left_up[M.ARM_JOINTS.index("left_shoulder_pitch_joint")] = -0.6
    left_up[M.ARM_JOINTS.index("left_elbow_joint")] = 1.0

    # A grip CODE, not radians -- deliberately, so the probe exercises the decoder
    # that the whole module exists to protect. ga = gb = 1 is full close.
    close_code = [-1.0, -1.0, -1.0, -1.0, 0.0, 0.40, 0.70]

    # Right hand in RADIANS, index fingers curled and middle fingers left open, so
    # the remap has an asymmetric signature to show. NeoDEM right order is
    # thumb0, thumb1, thumb2, index0, index1, middle0, middle1.
    right_index = [0.0, 0.0, 0.0, 1.2, 1.4, 0.0, 0.0]

    legs = [
        ("rest", M.REST, 2.0),
        ("LEFT arm up", ManipTargets(tuple(left_up), M.HAND_OPEN_LEFT, M.HAND_OPEN_RIGHT), 3.0),
        ("LEFT hand close (from a grip CODE)",
         ManipTargets(tuple(left_up),
                      tuple(M.hand_targets_rad(close_code, side="left",
                                               units=HandUnits.APPLE_PNP_GRIP_CODE)),
                      M.HAND_OPEN_RIGHT), 3.0),
        ("RIGHT index curl (remap signature)",
         ManipTargets(tuple(left_up),
                      tuple(M.hand_targets_rad(close_code, side="left",
                                               units=HandUnits.APPLE_PNP_GRIP_CODE)),
                      tuple(M.hand_targets_rad(right_index, side="right",
                                               units=HandUnits.RADIANS))), 3.0),
        ("back to rest", M.REST, 3.0),
    ]
    for label, targets, secs in legs:
        if pub._stop.is_set():
            break
        print(f"[probe] {label}", flush=True)
        pub.set_targets(targets)
        if pub._stop.wait(secs):
            break
    print("[probe] done — expect: left arm up, left hand closes, RIGHT INDEX "
          "curls (not the middle finger)", flush=True)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--domain", type=int, default=1,
                    help="DDS domain; must match the Isaac sim. 0 (the real robot) "
                         "is REFUSED. 1 = sim, 9 = mock.")
    ap.add_argument("--rate", type=float, default=DEFAULT_RATE_HZ,
                    help="publish rate in Hz. Unlike rt/run_command/cmd these "
                         "topics LATCH in the sim, so this need not be raced; 50 Hz "
                         "is the sim's own policy step rate.")
    ap.add_argument("--probe", action="store_true",
                    help="raise the left arm and close the hands, without a policy, "
                         "to check the arm slice and the right-hand remap")
    ap.add_argument("--arm-rate-limit", type=float, default=M.ARM_RATE_LIMIT_RAD,
                    help="max radians a single arm joint target may move per frame")
    ap.add_argument("--iface", default=None,
                    help="network interface for DDS (e.g. lo); omit for the SDK default")
    ap.add_argument("--serve", type=int, default=0,
                    help=f"serve the HTTP command inlet (POST /action, POST /estop, "
                         f"GET /health) on this port; 0 = off. {DEFAULT_SERVE_PORT} is the "
                         f"rig's convention, between the sidecar's 8777 and the camera "
                         f"facade's 8779.")
    ap.add_argument("--bind", default="127.0.0.1",
                    help="bind address for --serve. Loopback by DEFAULT and deliberately: "
                         "this port moves a robot's arms, and nothing off this box has any "
                         "business reaching it. Widen it on purpose or not at all.")
    ap.add_argument("--no-state", action="store_true",
                    help="do NOT subscribe to rt/lowstate or rt/dex3/*/state, and "
                         "answer GET /state/fast with a 503. The read path is on by "
                         "default because nothing else in this rig has one: the "
                         "sidecar's state source is a TCP link to a real G1 that does "
                         "not exist here, so a VLA rollout is otherwise fed 43 zeros.")
    ap.add_argument("--state-max-age", type=float, default=DEFAULT_STATE_MAX_AGE_S,
                    help="a state sample older than this counts as ABSENT — its joints "
                         "are left out of /state/fast rather than reported as 0.0")
    ap.add_argument("--state-require", default="body", choices=STATE_REQUIRE_CHOICES,
                    help="which sources must be fresh for GET /state/fast to answer at "
                         "all. 'body' (rt/lowstate: legs, waist, arms) refuses only "
                         "when the posture is unknown and lets a missing hand show up "
                         "as absent joints; 'all' also refuses on a missing hand.")
    ap.add_argument("--quiet", action="store_true")
    args = ap.parse_args()
    if args.serve and not (0 < args.serve < 65536):
        ap.error("--serve must be a port in 1..65535 (0 disables the inlet)")
    if args.state_max_age <= 0:
        ap.error("--state-max-age must be > 0 (a zero window makes every sample stale, "
                 "i.e. every joint absent from /state/fast)")

    try:
        pub = ManipPublisher(args.domain, args.rate, verbose=not args.quiet,
                             iface=args.iface, arm_rate_limit=args.arm_rate_limit)
    except ValueError as exc:
        # An argument mistake (domain 0, a non-positive rate) is an operator
        # message, not a traceback. Exit 2 so a script can tell it apart from a
        # publisher that started and then died (1).
        print(f"[manip] refused: {exc}", file=sys.stderr, flush=True)
        return 2
    # Anchor the limiters where the scene already is: with nothing publishing
    # rt/lowcmd the arms sit at zero, so the first commanded frame is rate-limited
    # away from that pose rather than jumping to it.
    pub._shaper.reset(M.REST)

    # AFTER the publisher, never before: `ManipPublisher.__init__` owns the one
    # ChannelFactoryInitialize this process may make, and the subscribers below
    # bind to the participant it opened.
    reader = None
    if not args.no_state:
        try:
            reader = StateReader(max_age_s=args.state_max_age,
                                 verbose=not args.quiet)
        except Exception as exc:  # noqa: BLE001
            # Not fatal. Losing the read path costs a VLA rollout its observation,
            # which is why this bridge grew one -- but it must not cost the rig its
            # only way to move or STOP the arms. Say so at full volume instead.
            print(f"[state] could not subscribe to {TOPIC_LOWSTATE} / "
                  f"{TOPIC_HAND_STATE.format('{left,right}')}: {exc!r}. The command "
                  f"path is unaffected; /state/fast will 503 and a VLA rollout has no "
                  f"observation.", file=sys.stderr, flush=True)
        else:
            print(f"[state] subscribed to {TOPIC_LOWSTATE} (29) + "
                  f"{TOPIC_HAND_STATE.format('{left,right}')} (7+7) on domain "
                  f"{args.domain}; "
                  + ("GET /state/fast serves" if args.serve else
                     "no --serve, so nothing is served — StateReader.read() only")
                  + " the 43-joint observation, absent-not-zero, refusing when "
                  f"{'any source' if args.state_require == 'all' else 'the body topic'} "
                  f"is missing or older than {args.state_max_age:g}s", flush=True)

    stopping = threading.Event()

    def _sig(_signum, _frame):
        stopping.set()
        pub._stop.set()

    signal.signal(signal.SIGINT, _sig)
    signal.signal(signal.SIGTERM, _sig)

    worker = threading.Thread(target=pub.run, daemon=True)
    worker.start()

    # AFTER the publish thread, never before: `/action` is refused while
    # `pub.alive` is false, and starting the inlet first would open a window in
    # which every request is correctly but pointlessly rejected.
    httpd = None
    if args.serve:
        try:
            httpd = serve(pub, args.bind, args.serve, reader=reader,
                          state_require=args.state_require)
        except OSError as exc:
            # Almost always "address already in use" — a second copy of this
            # bridge. Two of them would fight over every arm joint, which is the
            # one overlap the split-process design does not tolerate, so refuse
            # rather than run as a publisher nobody can reach.
            pub._stop.set()
            worker.join(timeout=2.0)
            print(f"[manip] refused: cannot serve on {args.bind}:{args.serve} ({exc}). "
                  f"Another manipulation bridge is probably already running — two of "
                  f"them publish conflicting rt/lowcmd frames.", file=sys.stderr,
                  flush=True)
            return 2
        print(f"[manip] inlet on http://{args.bind}:{args.serve} — "
              f"POST /action (name-keyed joint dict, RADIANS), POST /estop "
              f"(ramp to rest), GET /health"
              + ("" if reader is None else ", GET /state/fast + GET /state "
                                           "(43 joints, RADIANS)"), flush=True)

    try:
        if args.probe:
            if args.serve:
                # Both drive the same single command slot, and the slot is
                # last-writer-wins. Said out loud because a probe leg silently
                # overwriting a policy frame looks like a policy that stalled.
                print("[manip] NOTE: --probe and --serve share one command slot; the "
                      "last writer wins for as long as the probe runs", flush=True)
            probe(pub)
            if args.serve:
                print("[manip] probe finished; the inlet stays up. Ctrl-C to stop",
                      flush=True)
                while not stopping.is_set() and worker.is_alive():
                    time.sleep(0.2)
        elif args.serve:
            print("[manip] holding the rest pose until something POSTs /action. "
                  "Ctrl-C to stop", flush=True)
            while not stopping.is_set() and worker.is_alive():
                time.sleep(0.2)
        else:
            print("[manip] holding the rest pose — set_targets() from a policy, "
                  "--serve for the HTTP inlet, or --probe. Ctrl-C to stop", flush=True)
            while not stopping.is_set() and worker.is_alive():
                time.sleep(0.2)
    finally:
        # The inlet goes down FIRST. An /action arriving during the ramp below
        # would move the command slot back out of the rest pose, and the process
        # would then exit leaving the sim latched at a mid-reach arm command.
        if httpd is not None:
            httpd.shutdown()
            httpd.server_close()
        # Join before the ramp goes out: `_publish` mutates one shared message
        # object that CycloneDDS serialises in C, so two threads must never be
        # inside it at once. The loop's sleep is a `_stop.wait()`, so setting
        # the event ends the current period immediately and this join returns
        # in well under its timeout at any rate.
        pub._stop.set()
        worker.join(timeout=2.0)
        if worker.is_alive():
            # Not a stop we can make. Publishing rest from here would put a
            # second thread inside the shared LowCmd_ message, and corrupting a
            # message mid-serialisation is a worse failure than an abrupt exit:
            # say so loudly and let the process die instead.
            print("[manip] the publish thread did not stop within 2 s; NOT ramping to "
                  "rest, because that would mean two threads in one DDS message. "
                  "The sim will hold the last arm pose (rt/lowcmd latches) -- stop the "
                  "scene.", file=sys.stderr, flush=True)
        else:
            pub.shutdown()
        # Last, and after the arms are at rest: a reader that is still holding
        # subscriptions cannot stop anything, and closing it earlier would only
        # blind the operator during the ramp.
        if reader is not None:
            heard = ", ".join(f"{s}={reader.samples[s]}" for s in STATE_SOURCES)
            print(f"[state] samples received — {heard}", flush=True)
            reader.close()

    if pub.error is not None:
        print(f"[manip] publisher thread died: {pub.error!r}", file=sys.stderr, flush=True)
        traceback.print_exception(type(pub.error), pub.error, pub.error.__traceback__)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
