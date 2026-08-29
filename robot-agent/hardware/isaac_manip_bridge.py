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
import os
import signal
import sys
import threading
import time
import traceback

_HERE = os.path.dirname(os.path.abspath(__file__))
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)

import isaac_manip as M  # noqa: E402
from isaac_manip import HandUnits, ManipTargets  # noqa: E402

TOPIC_LOWCMD = "rt/lowcmd"
TOPIC_HAND_CMD = "rt/dex3/{}/cmd"

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

        self._rate = float(rate_hz)
        self._verbose = verbose
        self._stop = threading.Event()
        self._shutdown_lock = threading.Lock()
        self._shutdown_done = False
        self._sent = 0
        self._slot: tuple[ManipTargets, int] = (M.REST, 0)
        self._seq = 0
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

    def set_targets(self, targets: ManipTargets) -> None:
        """Hand the publisher a new frame. Safe from any thread; never blocks."""
        self._seq += 1
        self._slot = (targets, self._seq)

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

    def run(self) -> None:
        """The publish loop. One thread, forever, until `_stop`."""
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
                time.sleep(max(0.0, next_t - time.monotonic()))
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

    def shutdown(self, ramp_s: float = RAMP_S) -> None:
        """Ramp to the rest pose and stop. Idempotent; publishes, so join first.

        Rest is `arm = 0`, hands open -- and zero is not an arbitrary choice: it
        is the pose the Wholebody task holds when nothing publishes rt/lowcmd
        (`full_action.zero_()`), i.e. exactly where the arms will end up a moment
        after this process exits. Ramping there makes the handover continuous; a
        bare stop would leave the sim to snap the arms from a reach to zero in one
        physics step, which throws whatever the robot was holding.
        """
        self._stop.set()
        with self._shutdown_lock:
            if self._shutdown_done:
                return
            self._shutdown_done = True
        start = self._slot[0]
        steps = max(1, int(ramp_s * self._rate))
        for i in range(1, steps + 1):
            f = i / steps
            blend = ManipTargets(
                tuple(a + (b - a) * f for a, b in zip(start.arm, M.REST.arm)),
                tuple(a + (b - a) * f for a, b in zip(start.left_hand, M.REST.left_hand)),
                tuple(a + (b - a) * f for a, b in zip(start.right_hand, M.REST.right_hand)))
            self._publish(self._shaper.shape(blend))
            time.sleep(1.0 / self._rate)
        print(f"[manip] at rest after {self._sent} frames", flush=True)


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
    ap.add_argument("--quiet", action="store_true")
    args = ap.parse_args()

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

    stopping = threading.Event()

    def _sig(_signum, _frame):
        stopping.set()
        pub._stop.set()

    signal.signal(signal.SIGINT, _sig)
    signal.signal(signal.SIGTERM, _sig)

    worker = threading.Thread(target=pub.run, daemon=True)
    worker.start()
    try:
        if args.probe:
            probe(pub)
        else:
            print("[manip] holding the rest pose — set_targets() from a policy, "
                  "or --probe. Ctrl-C to stop", flush=True)
            while not stopping.is_set() and worker.is_alive():
                time.sleep(0.2)
    finally:
        # Join before the ramp goes out: `_publish` mutates one shared message
        # object that CycloneDDS serialises in C, so two threads must never be
        # inside it at once.
        pub._stop.set()
        worker.join(timeout=2.0)
        pub.shutdown()

    if pub.error is not None:
        print(f"[manip] publisher thread died: {pub.error!r}", file=sys.stderr, flush=True)
        traceback.print_exception(type(pub.error), pub.error, pub.error.__traceback__)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
