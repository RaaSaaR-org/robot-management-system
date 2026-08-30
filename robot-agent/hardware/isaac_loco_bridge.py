#!/usr/bin/env python3
"""Front Unitree's Isaac Lab sim with the `sport` RPC so Agent Mode can drive it.

Agent Mode talks to one API and one API only: `LocoClient`, which is RPC over DDS on
`rt/api/sport/{request,response}`. The real G1 answers it with its onboard controller.
`sim_g1_dds` answers it with a kinematic base. Unitree's `unitree_sim_isaaclab` does **not**
answer it at all -- it publishes low-level DDS (`rt/lowcmd`, `rt/lowstate`, `rt/dex3/*`) and
takes velocity commands on `rt/run_command/cmd`, which is what `send_commands_keyboard.py`
drives.

This process is the missing adapter, and nothing else changes:

    Agent Mode -> LocoClient -> rt/api/sport/request      (this process answers)
                             -> LocoSimService -> LocoState
                             -> rt/run_command/cmd        (this process publishes)
                             -> action_provider_wh_dds -> policy.onnx -> the G1 walks

Both halves are code we already have. `LocoSimService` is reused verbatim from
`sim_g1_dds/loco_service.py`, so every api_id the MuJoCo sim honours is honoured here too,
including the FSM gate: a `Damp`/`Sit` transition zeroes the velocity command, and the
zero is published like any other command rather than merely being withheld.

Run it on the SAME DDS domain as the Isaac sim, and do NOT run `sim_g1_dds` on that domain
at the same time. **Domain 0 is REFUSED** (exit 2): it is the real robot's bus, and this
process both publishes a walk command and answers the sport RPC the robot answers itself. Two `sport` services on one domain means the RPC is answered by whichever
wins the race, and the loser's LocoState is never stepped -- SetVelocity returns code 0
while the robot stands still. Domains in use: 0 = real robot, 1 = sim, 9 = mock.

Sign convention -- the one thing here that is easy to get backwards
-------------------------------------------------------------------
`send_commands_keyboard.py` publishes `[x_vel, -y_vel, -yaw_vel, height]`, so it reads as
though Isaac wanted flipped lateral and yaw axes. It does not. Those negations cancel the
keyboard's own internal convention: 'a' (left) *decreases* its `y_vel` and 'z' (left
rotation) *decreases* its `yaw_vel`, so after negation a leftward key produces a POSITIVE
value on the wire. Positive-left and positive-counter-clockwise is exactly what LocoClient
means, so this bridge forwards vy and omega unchanged. Adding a negation "to match the
keyboard script" would make the robot strafe and turn the wrong way.

Confirm that empirically before trusting it: `--probe` walks a short square (forward, turn
left, forward) with no Agent Mode in the loop.

Odometry -- everything published here is measured, when the sim will say so
---------------------------------------------------------------------------
Agent Mode reads the robot's pose from `GET /loco/odom` on `g1_sidecar.py`, which
subscribes to `rt/odommodestate`. Unitree's Isaac sim does not publish that topic, so
without this every turn against Isaac was dead-reckoned open loop. This process fills
the gap (`--no-odom` to turn it off):

    rt/sim_state.articulation.robot.root_pose -> x, y  (GROUND TRUTH, preferred)
    rt/lowstate.imu_state.quaternion          -> yaw   (MEASURED)
    rt/run_command/cmd we published           -> x, y  (DEAD RECKONED, the fallback)
                                              -> rt/odommodestate (SportModeState_)

x AND y HAD ONE SOURCE UNTIL TASK-231, AND IT REPORTED THE COMMAND BACK. Dead
reckoning integrates the velocity this bridge asked for, so it reproduces the command
by construction: commanded 8.00 m forward on 2026-08-30 it reported 7.995 m travelled,
while the sim's TRUE root pose had moved 0.113 m. Wrong by a factor of 71, and nothing
downstream could tell -- `goto` believed it had arrived while the robot was metres
short, and every "N% of commanded" figure ever derived from those x/y was circular.

The sim was publishing the answer the whole time. `sim_main.py`'s main loop writes
`env.scene.get_state()` to `rt/sim_state` as JSON on every iteration (~70 Hz measured,
~2.9 KB), and it carries the articulation's true world root pose. This bridge
subscribes to it and publishes THAT as x/y, falling back to dead reckoning only when
the topic is stale or absent, and saying which on startup, on every switch, in a
periodic status line, and on the wire (`SportModeState_.error_code` is
`isaac_odom.ODOM_ERROR_CODE_GROUND_TRUTH` = 0x600D or `..._DEAD_RECKONED` = 0xDEAD).
A silent switch between an exact pose and a 71x-wrong one would be worse than either
source alone, so the switch is not silent anywhere. `--no-ground-truth` forces the
fallback, which is for testing it and for nothing else.

This is legitimate because it is a SIMULATOR: the pose is free, `rt/odommodestate`
exists to carry the robot's pose, and on a real G1 the sidecar reads real odometry and
none of this file runs.

WHERE THE ZERO IS WHEN THERE IS NO GROUND TRUTH: `--odom-origin X,Y`. Dead reckoning
starts at zero, so on the fallback path the published x/y are in an ODOM frame anchored
at wherever the robot happened to be standing when this process started -- while Agent
Mode's place graph (`sim_evaluator/places/*.json`) is in WORLD metres. Nothing
reconciled the two, and on the factory rig they are 4.5 m apart: the robot spawned at
world (4.00, -2.00), this bridge published (0.00, 0.00), and the agent resolved itself
into FACTORY-CENTRE, a place it was nowhere near. `--odom-origin` names the world
position of that zero, and `factory_mission_bringup.sh` fills it from the SAME
`robot_spawn()` resolver the scene spawns with, so sim and odometry cannot disagree.

THE ORIGIN IS NOT ADDED TO GROUND TRUTH. `rt/sim_state` is already in world metres, so
adding the spawn to it would double the offset and put the robot a spawn's distance
from where it is -- the very defect `--odom-origin` was added to fix, in the opposite
direction. Once a true pose has been seen the origin stops being used at all: the
fallback continues from the last TRUE position instead (`OdomIntegrator._world_anchor`),
so losing `rt/sim_state` degrades the pose rather than teleporting it. It shifts x and
y ONLY -- yaw is measured off the sim's base orientation and is world-absolute already.

The quaternion order is `xyzw`, NOT a real G1's `wxyz` (`--quat-order` to override):
Isaac Lab 3.0 is XYZW throughout and the vendor's 2.x-era plumbing does not convert.
Read as `wxyz` the heading swings with ROLL while the true yaw sits still, which
looks exactly like a robot drifting off course.

None of this runs on the command-publish thread; see `OdomPublisher`'s docstring.

Clock caveat
------------
`LocoState` expires a velocity command against the clock it is handed. `sim_g1_dds` hands it
MuJoCo's simulation time; here there is no cheap way to read Isaac's, so this uses a
monotonic wall clock. While the sim runs at roughly real time the two agree. If Isaac runs
slower than real time -- a heavy scene, a busy GPU -- a `SetVelocity(duration=3)` expires
after 3 wall seconds, which is LESS than 3 seconds of robot motion. Prefer short durations
refreshed often (which is what Agent Mode's block executor already does) over one long one.

@status working — the RPC path is proven end to end by isaac_loco_check.py (7/7), and as of
2026-08-28 (TASK-203 step 3) an unmodified LocoClient holding SetVelocity(0.5, 0, 0) through this
bridge walked the G1 16.36 m at 0.613 m/s, with alternating foot contact. The whole path from
LocoClient to the floor is proven, not just the wire. The duration/wall-clock caveat above was
acute at real-time factor 0.28; TASK-204 took the sim to RTF ~1.04, so the two clocks now agree
closely.

Two things this does NOT yet do, both open on TASK-203 step 4: the heading drifts right by about
-2.2 deg/s on this path even with yaw_vel commanded at 0, and the policy does not respond to a
left-turn command at all — so a `goto` that needs a left turn cannot be satisfied. See
TASK-203/TASK-223.
"""
from __future__ import annotations

import argparse
import math
import os
import signal
import sys
import threading
import time
import traceback

_HERE = os.path.dirname(os.path.abspath(__file__))
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)

from unitree_sdk2py.core.channel import (  # noqa: E402
    ChannelFactoryInitialize, ChannelPublisher, ChannelSubscriber,
)
from unitree_sdk2py.idl.default import unitree_go_msg_dds__SportModeState_  # noqa: E402
from unitree_sdk2py.idl.std_msgs.msg.dds_ import String_  # noqa: E402
from unitree_sdk2py.idl.unitree_go.msg.dds_ import SportModeState_  # noqa: E402
from unitree_sdk2py.idl.unitree_hg.msg.dds_ import LowState_  # noqa: E402

import isaac_odom  # noqa: E402
from sim_g1_dds.loco_service import LocoSimService  # noqa: E402
from sim_g1_dds.loco_state import (  # noqa: E402
    STAND_HEIGHT_DEFAULT,
    STAND_HEIGHT_HIGH,
    LocoState,
)

RUN_COMMAND_TOPIC = "rt/run_command/cmd"

# Odometry side (see "Odometry" in the module docstring).
LOWSTATE_TOPIC = "rt/lowstate"       # where the MEASURED base orientation comes from
ODOM_TOPIC = "rt/odommodestate"      # what g1_sidecar.py's /loco/odom subscribes to
SIM_STATE_TOPIC = isaac_odom.SIM_STATE_TOPIC   # the sim's TRUE world pose (TASK-231)

# The odom loop ticks faster than it publishes: integration error is a function of
# the SAMPLING interval, not the publish interval, so a fast tick keeps the dead
# reckoning honest while /loco/odom is fed at the 20 Hz isaac_capture.py settled on.
#
# It must also be an integer MULTIPLE of the publish rate, because a frame can
# only go out on a tick boundary. At 50 Hz a 20 Hz request (50 ms) lands on the
# third tick, not the second-and-a-half — 60 ms, i.e. 16.7 Hz — and the startup
# banner then advertises a rate the bridge does not deliver. Measured on the live
# sim before this was 100: `rt/odommodestate` arrived at 16.7 Hz against a
# promised 20. 100 Hz makes the default divide exactly, and still divides 25 and
# 50.
#
# The rate is a ceiling, not a guarantee: this is a Python sleep loop, and on a
# box also running Isaac the same measurement gives ~18 Hz for a requested 20.
# That is deliberately not engineered away — `g1_sidecar.py` treats a fix as
# stale after 2 s, so a 10% shortfall is three orders of magnitude of headroom,
# and the alternative is a busy-wait competing with the sim for CPU.
ODOM_TICK_HZ = 100.0


def achievable_odom_rate_hz(rate_hz: float, tick_hz: float = ODOM_TICK_HZ) -> float:
    """The odometry rate this bridge can ACTUALLY deliver for a requested one.

    A frame can only leave on a tick boundary, so the delivered period is the
    requested one rounded UP to a whole number of ticks. Only divisors of
    `tick_hz` come back unchanged: at 100 Hz ticks a requested 30 Hz is served
    every 4th tick and arrives at 25, a requested 15 arrives at 14.3, and a
    requested 60 arrives at 50. Nothing validated that, so the startup banner
    printed the request verbatim and an operator reading "20 Hz" had no way to
    know they were getting 16.7 -- which is the number the odom rate was raised
    from 50 to 100 Hz ticks to fix in the first place.
    """
    if rate_hz <= 0:
        return rate_hz
    ticks = max(1, math.ceil(tick_hz / rate_hz))
    return tick_hz / ticks


def odom_publish_period_s(rate_hz: float, tick_hz: float = ODOM_TICK_HZ) -> float:
    """The publish period to hand `OdomIntegrator` for a requested rate.

    Half a tick EARLY, deliberately. `OdomIntegrator` emits on the first tick
    where `now - last_pub >= period`, and when the period is a whole number of
    ticks that comparison lands exactly on a tick boundary -- so which side of it
    a given tick falls on is decided by scheduler jitter of a few microseconds.
    The delivered rate then wobbles between the intended one and one tick slower
    (20 Hz and 16.7 Hz for the default), for no reason anybody watching could
    diagnose. Backing the period off by half a tick puts the boundary in the
    middle of the gap between two ticks, where jitter cannot reach it, and the
    frame goes out on the tick that was intended every time.
    """
    return 1.0 / achievable_odom_rate_hz(rate_hz, tick_hz) - 0.5 / tick_hz

# No lowstate this recently means the heading is unknown, and this stops publishing
# entirely. Deliberate: g1_sidecar.py 503s when rt/odommodestate goes quiet, and
# Agent Mode degrades to open-loop dead reckoning, which is recoverable. A FROZEN
# pose is not -- block-executor.ts reads it as "the robot did not move" and reports
# an outright failure. Silence beats a lie.
ODOM_LOWSTATE_STALE_S = 1.0

# ...and if NOTHING has ever arrived after this long, say so once on stderr. The
# usual cause is the wrong --domain, which otherwise looks identical to a healthy
# bridge right up until Agent Mode reports every heading as unknown.
ODOM_NO_LOWSTATE_WARN_S = 5.0

# If the command publisher has not refreshed the slot this recently it is dead or
# wedged, so integrate zero rather than the last velocity it managed to publish --
# the same reasoning as isaac_capture.py's COMMAND_STALE_S.
ODOM_COMMAND_STALE_S = 0.5

# How old a `rt/sim_state` pose may be and still be published as the robot's position.
# The topic runs at ~70 Hz measured, so 0.5 s is ~35 missed messages -- far past a
# scheduling hiccup and well short of the sidecar's own 2 s staleness window, which
# leaves room for the fallback to take over before /loco/odom notices anything.
#
# TIGHTER THAN ODOM_LOWSTATE_STALE_S ON PURPOSE. A missing heading stops publishing
# altogether (silence, which Agent Mode survives); a stale TRUE POSE keeps publishing a
# frozen position, which reads to block-executor.ts as "the robot did not move" -- the
# exact lie this whole file is arranged to avoid. So the true pose is dropped sooner
# than the heading, and the dead reckoner, which at least keeps moving, takes over.
ODOM_GROUND_TRUTH_STALE_S = 0.5

# ...and if NOTHING has ever arrived on rt/sim_state after this long, say so once. The
# usual causes are the wrong --domain and a sim old enough not to publish the topic,
# both of which otherwise look exactly like a healthy bridge -- publishing confidently,
# from the command, at 71x the truth.
ODOM_NO_SIM_STATE_WARN_S = 5.0

# How often the odometry thread prints where it thinks the robot is AND which source
# said so. A transition is logged the instant it happens, but a run that starts on the
# fallback and stays there produces exactly one line at startup and then nothing, and
# an operator who joined the session late has no way to ask. This is that answer,
# unprompted. 10 s is quiet enough to leave the log readable next to the sim's own
# output and often enough that no mission stage passes without one.
ODOM_STATUS_PERIOD_S = 10.0

# A ground-truth heading and a lowstate heading are two readings of the SAME base
# orientation, so they agree to a fraction of a degree in practice (0.4 deg measured on
# the live rig). This much disagreement means one of the two quaternion orders is being
# read wrong -- the failure that makes a heading swing with roll -- and it is worth a
# one-off warning naming both. 15 deg is far outside sampling skew at 70 Hz and far
# inside the ~4 deg a wxyz/xyzw mix-up produced on the same rig... which is to say a
# subtle mix-up will NOT trip this. It is a smoke alarm, not a proof; the proof is
# verify_isaac_odom_offline.py (2) and the identity-quaternion argument in isaac_odom.
ODOM_YAW_DISAGREEMENT_WARN_RAD = math.radians(15.0)

# `action_provider_wh_dds.py` parses the payload with `ast.literal_eval` and reads four
# floats: [x_vel, y_vel, yaw_vel, height]. Its own fallback when nothing has been published
# is [0.0, 0, 0, 0.8], so height is an absolute stand height in metres -- the same units
# LocoState.stand_height carries (default 0.75, crouch 0.65, tall 0.80).
COMMAND_FIELDS = 4


class OdomPublisher:
    """Publish `rt/odommodestate` for the sidecar: TRUE x/y, measured yaw.

    x/y come from `rt/sim_state` (the sim's own world root pose) whenever that topic is
    fresh, and from dead reckoning when it is not; yaw always comes from `rt/lowstate`.
    Which source produced a given frame is stated on startup, on every switch, every
    `ODOM_STATUS_PERIOD_S`, in the shutdown summary, and in the message's `error_code`.
    See "Odometry" in the module docstring for why that redundancy is deliberate.

    Runs entirely off the command-publish thread. Four threads touch this object and
    each does as little as possible:

      * the CycloneDDS listener thread calls `_on_lowstate`, which does one atan2 and
        one tuple store under a lock held for a few instructions -- no integration, no
        publishing, no allocation of note;
      * the same listener thread calls `_on_sim_state`, which parses ~2.9 KB of JSON
        (17 us measured, ~70 times a second, i.e. ~0.1% of a core) and stores one
        tuple. Parsing on the listener rather than sampling the raw string and parsing
        on the odom thread is a deliberate trade: it costs that 0.1% and it means a
        malformed payload is caught, counted and named ONCE per run rather than once
        per tick. Should the payload ever grow -- it is capped by the sim's own 4096
        byte shared-memory slot today -- revisit that, not the freshness rule;
      * the command thread never enters this class at all. It stores a
        `(vx, vy, monotonic)` tuple into a plain attribute on the bridge
        (`_cmd_slot`), which this class reads. One attribute store per command frame
        is the whole cost to the 100 Hz path, and it takes no lock, so odometry can
        never stall the thing that keeps the robot walking;
      * this class's own thread does the unwrapping, the dead reckoning and the DDS
        write, at ODOM_TICK_HZ.

    If this thread dies, the bridge keeps driving. That asymmetry is intentional:
    losing odometry costs Agent Mode its closed-loop heading (it falls back to
    open-loop, which is what it does against Isaac today anyway), whereas killing the
    command path leaves a robot mid-stride with nothing publishing to it.
    """

    def __init__(self, command_source, quat_order: str, rate_hz: float,
                 odom_origin: tuple[float, float] | None = None,
                 use_ground_truth: bool = True) -> None:
        self._command_source = command_source
        self._order = quat_order
        self.use_ground_truth = bool(use_ground_truth)
        # What this publisher will really do, not what it was asked for -- every
        # message that quotes a rate quotes this one. See achievable_odom_rate_hz.
        self.rate = achievable_odom_rate_hz(rate_hz)
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self.error: Exception | None = None
        self.published = 0
        self.samples = 0
        self.bad_samples = 0

        self.gt_samples = 0
        self.gt_bad_samples = 0
        self._warned_yaw_disagreement = False
        self._last_frame: isaac_odom.OdomFrame | None = None

        self._yaw_lock = threading.Lock()
        self._yaw: tuple[float, float] | None = None   # (wrapped yaw, monotonic recv)
        # (GroundTruthPose, monotonic recv). Same shape and same discipline as _yaw:
        # an immutable tuple replaced wholesale under a lock held for one store.
        self._gt_lock = threading.Lock()
        self._gt: tuple[isaac_odom.GroundTruthPose, float] | None = None
        # All of the actual bookkeeping -- unwrapping, dead reckoning, starvation,
        # rate limiting -- lives in this pure object so the offline verifier can drive
        # the failure paths without DDS. This class is threads and wire, nothing else.
        self._integ = isaac_odom.OdomIntegrator(
            publish_period=odom_publish_period_s(rate_hz),
            stale_after=ODOM_LOWSTATE_STALE_S,
            command_stale_after=ODOM_COMMAND_STALE_S,
            # WORLD position of the dead reckoner's (0, 0), used on the FALLBACK path
            # only: ground truth is already world and is never offset by it. None =
            # not told, which is the pre-origin behaviour -- odom coordinates published
            # as if they were world ones. x/y only -- yaw is measured and already
            # world-absolute.
            origin=odom_origin,
            ground_truth_stale_after=ODOM_GROUND_TRUTH_STALE_S,
            use_ground_truth=self.use_ground_truth)

        self._sub = ChannelSubscriber(LOWSTATE_TOPIC, LowState_)
        self._sub.Init(self._on_lowstate, 10)
        # Subscribed only when it will be used: --no-ground-truth must not leave a
        # listener parsing 70 messages a second into a value nothing reads, and an
        # operator running with the flag should see no rt/sim_state traffic at all.
        self._gt_sub = None
        if self.use_ground_truth:
            self._gt_sub = ChannelSubscriber(SIM_STATE_TOPIC, String_)
            self._gt_sub.Init(self._on_sim_state, 10)
        self._pub = ChannelPublisher(ODOM_TOPIC, SportModeState_)
        self._pub.Init()
        # One message reused: only this class's thread ever writes it, and cyclonedds
        # serialises inside Write(). Same pattern as sim_g1_dds/sim_node.py.
        self._msg = unitree_go_msg_dds__SportModeState_()

    # ---- DDS listener thread -------------------------------------------------
    def _on_lowstate(self, msg) -> None:
        try:
            yaw = isaac_odom.yaw_from_quaternion(msg.imu_state.quaternion, self._order)
        except Exception as exc:  # noqa: BLE001
            # A malformed sample must not kill the SDK's listener thread (which also
            # feeds anything else subscribed in this process). Count them and say so
            # once -- a silent zero here would look like a robot that never turns.
            self.bad_samples += 1
            if self.bad_samples == 1:
                print(f"[odom] cannot read imu_state.quaternion ({exc!r}); "
                      f"heading will not be published", file=sys.stderr, flush=True)
            return
        with self._yaw_lock:
            self._yaw = (yaw, time.monotonic())
        self.samples += 1

    def _on_sim_state(self, msg) -> None:
        """Parse one `rt/sim_state` message into the robot's TRUE world pose."""
        try:
            pose = isaac_odom.parse_sim_state(msg.data)
        except Exception as exc:  # noqa: BLE001
            # Same contract as _on_lowstate: never kill the SDK's listener thread, and
            # never fabricate. The pose slot is left alone, so it simply goes stale and
            # the integrator falls back -- which is exactly what a bridge should do with
            # a payload it cannot read. Counted and named once, because "ground truth
            # ON" plus a quiet fallback is the one outcome nobody could diagnose.
            self.gt_bad_samples += 1
            if self.gt_bad_samples == 1:
                print(f"[odom] cannot read {SIM_STATE_TOPIC} ({exc}) — x/y will fall "
                      f"back to DEAD RECKONING, which reports the command rather than "
                      f"the robot", file=sys.stderr, flush=True)
            return
        with self._gt_lock:
            self._gt = (pose, time.monotonic())
        self.gt_samples += 1

    def _ground_truth(self):
        """The latest true pose and when it arrived, or None. Called by our own thread."""
        with self._gt_lock:
            return self._gt

    # ---- own thread ----------------------------------------------------------
    def start(self) -> None:
        self._thread = threading.Thread(target=self._run, name="odom", daemon=True)
        self._thread.start()

    def _run(self) -> None:
        try:
            tick = 1.0 / ODOM_TICK_HZ
            next_t = t_start = time.monotonic()
            warned_silent = False
            warned_no_gt = False
            next_status = t_start + ODOM_STATUS_PERIOD_S
            while not self._stop.is_set():
                now = time.monotonic()
                with self._yaw_lock:
                    sample = self._yaw
                was_starved = self._integ.starved
                was_source = self._integ.source
                frame = self._integ.tick(now, sample, self._command_source(),
                                         self._ground_truth())
                if frame is not None and self._integ.source != was_source:
                    # THE LOUDEST LINE IN THIS FILE, in both directions. The two
                    # sources disagreed by 71x on the rig this was written for, so a
                    # switch between them is a change in what the published pose MEANS,
                    # not a change of implementation detail.
                    if self._integ.source == isaac_odom.ODOM_SOURCE_GROUND_TRUTH:
                        print(f"[odom] {SIM_STATE_TOPIC} acquired — x/y are now the "
                              f"sim's TRUE world root pose, published verbatim "
                              f"(error_code "
                              f"{isaac_odom.ODOM_ERROR_CODE_GROUND_TRUTH:#x}). The "
                              f"--odom-origin is NOT applied to it.", flush=True)
                    else:
                        print(f"[odom] WARNING: no usable {SIM_STATE_TOPIC} for "
                              f"{ODOM_GROUND_TRUTH_STALE_S:g}s — x/y have FALLEN BACK "
                              f"to DEAD RECKONING (error_code "
                              f"{isaac_odom.ODOM_ERROR_CODE_DEAD_RECKONED:#x}). They "
                              f"are now the commanded velocity integrated, they drift "
                              f"without bound, and on this rig that has read 71x the "
                              f"true distance. Continuing from the last true pose, not "
                              f"from the origin.", file=sys.stderr, flush=True)
                if (self._integ.yaw_disagreement is not None
                        and not self._warned_yaw_disagreement
                        and self._integ.yaw_disagreement > ODOM_YAW_DISAGREEMENT_WARN_RAD):
                    # Two readings of one orientation that disagree this much mean a
                    # quaternion is being unpacked in the wrong order somewhere -- the
                    # failure that makes a heading swing with roll. Say it once.
                    self._warned_yaw_disagreement = True
                    print(f"[odom] WARNING: {SIM_STATE_TOPIC} heading and "
                          f"{LOWSTATE_TOPIC} heading disagree by "
                          f"{math.degrees(self._integ.yaw_disagreement):.1f} deg. They "
                          f"are the same orientation read twice, so one of the two "
                          f"quaternion orders is wrong (--quat-order is "
                          f"'{self._order}'; rt/sim_state is read as "
                          f"'{isaac_odom.SIM_STATE_QUAT_ORDER}').",
                          file=sys.stderr, flush=True)
                if self._integ.starved != was_starved:
                    if self._integ.starved:
                        print(f"[odom] no {LOWSTATE_TOPIC} for {ODOM_LOWSTATE_STALE_S:g}s "
                              f"— NOT publishing {ODOM_TOPIC}. /loco/odom will 503 and "
                              f"Agent Mode falls back to open loop.", flush=True)
                    else:
                        print(f"[odom] {LOWSTATE_TOPIC} acquired — publishing "
                              f"{ODOM_TOPIC} at {self.rate:g} Hz", flush=True)
                if (self.samples == 0 and not warned_silent
                        and now - t_start > ODOM_NO_LOWSTATE_WARN_S):
                    # Never say nothing. "Odometry ON" in the banner plus silence here
                    # reads as working; it usually means the bridge is on the wrong DDS
                    # domain, or the sim is not up yet.
                    warned_silent = True
                    print(f"[odom] WARNING: no {LOWSTATE_TOPIC} at all after "
                          f"{ODOM_NO_LOWSTATE_WARN_S:g}s — is the sim running on this "
                          f"domain? Nothing is being published to {ODOM_TOPIC}.",
                          file=sys.stderr, flush=True)
                if (self.use_ground_truth and self.gt_samples == 0 and not warned_no_gt
                        and now - t_start > ODOM_NO_SIM_STATE_WARN_S):
                    # The silent-failure case for ground truth specifically: a wrong
                    # --domain, or a sim too old to publish the topic. Without this the
                    # bridge publishes the command back at 71x the truth, confidently,
                    # and the only clue is an error_code nobody reads.
                    warned_no_gt = True
                    print(f"[odom] WARNING: no {SIM_STATE_TOPIC} at all after "
                          f"{ODOM_NO_SIM_STATE_WARN_S:g}s — x/y are DEAD RECKONED from "
                          f"the commanded velocity and will report the command back to "
                          f"you. Is the sim on this domain, and does it publish "
                          f"{SIM_STATE_TOPIC}?", file=sys.stderr, flush=True)
                if frame is not None:
                    isaac_odom.fill_odom_msg(
                        self._msg, frame.x, frame.y, frame.yaw, time.time(),
                        vx_world=frame.vx_world, vy_world=frame.vy_world,
                        yaw_speed=frame.yaw_speed,
                        # Provenance ON THE WIRE, per frame. The one channel a consumer
                        # can read without trusting this process's log.
                        error_code=isaac_odom.odom_error_code(frame.source))
                    self._pub.Write(self._msg)
                    self.published += 1
                    self._last_frame = frame
                if now >= next_status:
                    # Unprompted, so that "which source is live?" never has to be asked.
                    next_status = now + ODOM_STATUS_PERIOD_S
                    self._print_status()
                next_t += tick
                time.sleep(max(0.0, next_t - time.monotonic()))
        except Exception as exc:  # noqa: BLE001
            # Loud, and fatal to THIS thread only. The bridge's `_stop` is not set:
            # see the class docstring for why odometry is allowed to fail alone.
            self.error = exc
            print(f"[odom] publisher thread died: {exc!r} — no more {ODOM_TOPIC}. "
                  f"Motion is unaffected; /loco/odom will 503.",
                  file=sys.stderr, flush=True)
            traceback.print_exception(type(exc), exc, exc.__traceback__)

    def _print_status(self) -> None:
        """One line: where we say the robot is, and which source said so."""
        frame = self._last_frame
        where = ("no frame published yet" if frame is None
                 else f"({frame.x:+.2f}, {frame.y:+.2f}) m, yaw "
                      f"{math.degrees(frame.yaw):+.1f} deg")
        if not self.use_ground_truth:
            source = "DEAD RECKONED (--no-ground-truth), drifts"
        elif self._integ.source == isaac_odom.ODOM_SOURCE_GROUND_TRUTH:
            source = f"GROUND TRUTH from {SIM_STATE_TOPIC}, exact"
        elif self._integ.ground_truth_seen:
            source = (f"DEAD RECKONED — {SIM_STATE_TOPIC} LOST, continuing from the "
                      f"last true pose; drifts")
        else:
            source = (f"DEAD RECKONED — no {SIM_STATE_TOPIC} has ever arrived; "
                      f"reports the COMMAND, not the robot")
        print(f"[odom] x/y {source} | {where} | {self.published} published "
              f"({self._integ.frames_ground_truth} true, "
              f"{self._integ.frames_dead_reckoned} reckoned), {self.gt_samples} "
              f"{SIM_STATE_TOPIC} samples", flush=True)

    def shutdown(self) -> None:
        self._stop.set()
        if self._thread is not None:
            self._thread.join(timeout=1.0)
        # `reckoner` is the ODOM frame (module docstring of isaac_odom), so this
        # distance is a path length and is unaffected by any origin or anchor --
        # deliberately: a translation cannot change how far something travelled. It is
        # the COMMANDED path length, and printing it next to the frame counts is the
        # point: a run where the two disagree is a run where the robot did not do what
        # it was told, which is information no single number carries.
        self._print_status()
        print(f"[odom] {self.published} odometry messages from {self.samples} lowstate "
              f"samples and {self.gt_samples} {SIM_STATE_TOPIC} samples "
              f"({self.gt_bad_samples} unreadable); "
              f"{self._integ.frames_ground_truth} carried the sim's TRUE x/y, "
              f"{self._integ.frames_dead_reckoned} were dead reckoned. "
              f"Dead-reckoned (i.e. COMMANDED) path length "
              f"{self._integ.reckoner.distance:.2f} m", flush=True)


class IsaacLocoBridge:
    def __init__(self, domain: int, rate_hz: float, verbose: bool,
                 iface: str | None = None, publish_odom: bool = True,
                 odom_rate_hz: float = 20.0,
                 quat_order: str = isaac_odom.DEFAULT_QUAT_ORDER,
                 stand_height: float = STAND_HEIGHT_HIGH,
                 odom_origin: tuple[float, float] | None = None,
                 use_ground_truth: bool = True) -> None:
        self._lock = threading.Lock()
        self._state = LocoState()
        # THE IDLE HEIGHT IS NOT COSMETIC -- IT DECIDES WHETHER THE ROBOT STAYS PUT.
        #
        # Every command this bridge publishes carries an absolute stand height, including
        # the zero-velocity ones it sends while nothing is driving. LocoState's default is
        # 0.75 m, which is the REAL G1's nominal; the Isaac sim's own fallback is 0.80
        # (action_provider_wh_dds.py:345). Publishing 0.75 therefore does not mean "leave
        # it alone" -- it is an active command to crouch 5 cm below where the sim's
        # locomotion policy is holding it.
        #
        # MEASURED, standing still, commanding nothing but that height: the G1 unloaded one
        # foot, dropped its head 7 cm, and slid 0.455 m across the floor while rotating
        # -59.2 deg, over about 100 s. Nothing was asking it to move. The scene's grasp
        # margin at the table is 0.013 m, so the idle command alone was 35x the entire
        # error budget of the mission. At 0.80 the same robot re-planted both feet and its
        # position went constant to four decimal places.
        #
        # This is almost certainly the sim's render-bound step rate (~16 Hz against a policy
        # that wants 100 Hz) leaving too little authority for the crouch transient, so it is
        # a property of THIS RIG rather than of the G1. Hence a flag with a rig-appropriate
        # default, rather than changing STAND_HEIGHT_DEFAULT, which the MuJoCo path shares.
        self._state.stand_height = float(stand_height)
        self._t0 = time.monotonic()
        self._rate = rate_hz
        self._verbose = verbose
        self._stop = threading.Event()
        self._last_sent: tuple[float, float, float, float] | None = None
        self._sent = 0
        # Set by run() when the publish loop dies; main() reports it and exits non-zero.
        self.error: Exception | None = None
        self._shutdown_lock = threading.Lock()
        self._shutdown_done = False

        if domain == 0:
            # Not a warning, and not negotiable. Domain 0 is the REAL ROBOT.
            # This process publishes rt/run_command/cmd -- a walk-command channel
            # -- and stands up the sport service that answers SetVelocity, so a
            # bridge started here would drive a real G1 with a locomotion policy
            # that is not on it, while a second sport service (the robot's own)
            # races it for every RPC. `isaac_manip_bridge.py` refuses the same
            # domain for the same reason.
            raise ValueError(
                "domain 0 is the REAL ROBOT and is refused: this bridge publishes "
                "rt/run_command/cmd and answers the sport RPC, which a real G1 "
                "would obey and also answer itself. Use the sim domain (1) or the "
                "mock (9).")

        # Pass the interface only when asked: the SDK's default config works here, whereas
        # sim_node.py's hardcoded `lo0` is a macOS name that fails on Linux.
        if iface:
            ChannelFactoryInitialize(domain, iface)
        else:
            ChannelFactoryInitialize(domain)
        self._pub = ChannelPublisher(RUN_COMMAND_TOPIC, String_)
        self._pub.Init()

        # Latest (vx, vy, monotonic) handed to the odometry thread. A plain attribute
        # holding an immutable tuple, replaced wholesale: the reader can never observe
        # a half-updated value, so the 100 Hz command loop needs no lock to publish it.
        self._cmd_slot: tuple[float, float, float] = (0.0, 0.0, time.monotonic())
        self._odom: OdomPublisher | None = None
        if publish_odom:
            self._odom = OdomPublisher(lambda: self._cmd_slot, quat_order,
                                       odom_rate_hz, odom_origin=odom_origin,
                                       use_ground_truth=use_ground_truth)

        # Built last: ServerBase._Start() begins answering RPCs immediately, and a
        # SetVelocity answered before the publisher exists would be accepted and dropped.
        self._svc = LocoSimService(self._state, self._lock, self._clock, verbose=verbose)
        print(f"[bridge] sport service up on domain {domain}, publishing {RUN_COMMAND_TOPIC} "
              f"at {rate_hz:g} Hz", flush=True)
        if self._odom is not None:
            # The ACHIEVABLE rate, never the requested one: a banner that promises
            # a rate the tick loop cannot divide into is how a 16.7 Hz feed passed
            # for 20 Hz. main() has already said so if the two differ.
            print(f"[bridge] odometry ON — subscribing {LOWSTATE_TOPIC}, publishing "
                  f"{ODOM_TOPIC} at {self._odom.rate:g} Hz, quaternion order "
                  f"'{quat_order}'. yaw is MEASURED and world-absolute.", flush=True)
            # WHICH SOURCE X/Y COME FROM IS THE FIRST THING AN OPERATOR MUST READ.
            # The two differ by 71x on this rig, so this banner says which one is
            # being asked for, and the odom thread then says which one is actually
            # live the moment it knows (they are not the same statement: the topic can
            # be absent, and this is printed before a single message has arrived).
            if use_ground_truth:
                print(f"[bridge] x/y source: GROUND TRUTH — subscribing "
                      f"{SIM_STATE_TOPIC} for the sim's true world root pose, "
                      f"published verbatim with error_code "
                      f"{isaac_odom.ODOM_ERROR_CODE_GROUND_TRUTH:#x}. The "
                      f"--odom-origin is NOT added to it (it is already world). If "
                      f"that topic is silent or stale for "
                      f"{ODOM_GROUND_TRUTH_STALE_S:g}s, x/y FALL BACK to dead "
                      f"reckoning and this log says so, loudly, both ways.",
                      flush=True)
            else:
                print(f"[bridge] x/y source: DEAD RECKONING, FORCED "
                      f"(--no-ground-truth) — {SIM_STATE_TOPIC} is not even "
                      f"subscribed. x/y are the commanded velocity integrated: they "
                      f"report the COMMAND back, they drift without bound, and on "
                      f"this rig they have read 71x the true distance travelled. This "
                      f"flag is for testing the fallback.", flush=True)
            # A SILENT ORIGIN IS HOW THE FRAME MISMATCH STAYED INVISIBLE. The bridge
            # published (0, 0) while the robot stood at world (4.00, -2.00) and nothing
            # in the log said which frame that zero was in, so Agent Mode resolved the
            # robot into a place 4.5 m away and would have walked into a wall. Whichever
            # branch is taken, the operator now reads the origin and whether anyone
            # chose it.
            if odom_origin is None:
                print(f"[bridge] odom origin DEFAULTED to (0.00, 0.00) — --odom-origin "
                      f"was not given, so published x/y are relative to wherever this "
                      f"robot is standing RIGHT NOW, not world coordinates. Anything "
                      f"holding a world map (Agent Mode's place graph) will place the "
                      f"robot wrong by however far the spawn is from the world origin.",
                      flush=True)
            else:
                print(f"[bridge] odom origin GIVEN as ({odom_origin[0]:.2f}, "
                      f"{odom_origin[1]:.2f}) in WORLD metres — it anchors DEAD "
                      f"RECKONING only, and only until a true pose arrives. x and y "
                      f"ONLY; yaw is measured and is not offset; ground truth is "
                      f"already world and is never offset by it.", flush=True)
        else:
            print(f"[bridge] odometry OFF (--no-odom) — nothing publishes {ODOM_TOPIC}, "
                  f"so /loco/odom will 503 and Agent Mode has no measured heading.",
                  flush=True)

    def _clock(self) -> float:
        return time.monotonic() - self._t0

    def publish(self, vx: float, vy: float, omega: float, height: float) -> None:
        cmd = [round(float(vx), 4), round(float(vy), 4),
               round(float(omega), 4), round(float(height), 4)]
        assert len(cmd) == COMMAND_FIELDS
        self._pub.Write(String_(data=str(cmd)))
        # One tuple store, no lock, no odometry work on this thread — see
        # OdomPublisher's docstring. Set here rather than in run() so the explicit
        # zeros from shutdown() also reach the dead reckoner.
        self._cmd_slot = (cmd[0], cmd[1], time.monotonic())
        self._sent += 1
        if self._verbose:
            key = tuple(cmd)
            if key != self._last_sent:
                print(f"[bridge] -> {cmd}", flush=True)
                self._last_sent = key

    def start_odom(self) -> None:
        """Start the odometry thread, if odometry is enabled. Separate from run()."""
        if self._odom is not None:
            self._odom.start()

    def run(self) -> None:
        try:
            period = 1.0 / self._rate
            next_t = time.monotonic()
            while not self._stop.is_set():
                now = self._clock()
                with self._lock:
                    vx, vy, omega = self._state.commanded_velocity(now)
                    height = self._state.stand_height
                # Forwarded unchanged -- see the sign-convention note in the module docstring.
                self.publish(vx, vy, omega, height)
                next_t += period
                time.sleep(max(0.0, next_t - time.monotonic()))
        except Exception as exc:
            # Zeros, not just a log line: this is the fail-safe, not defensive noise. This
            # thread is the ONLY thing that writes rt/run_command/cmd, but LocoSimService
            # lives on the SDK's own queue thread and keeps answering SetVelocity with
            # RPC_OK after we die -- the same "code 0 while the robot stands still" the
            # module docstring warns about for two services on one domain, now reachable in
            # one process.
            #
            # Against ISAAC specifically the robot does not keep walking when this thread
            # dies: the sim's command slot is self-clearing (see --rate below), so it decays
            # to zero within one policy step on its own. The explicit zeros are still the
            # right thing to write, because this bridge fronts the same LocoClient API as a
            # REAL G1, where nothing clears the slot and the last command does latch -- and
            # because a deliberate zero is distinguishable from a starved one at the far end.
            # Stopping it is the last useful thing this thread can do; main() then reports
            # the error and exits non-zero rather than idling as a service that lies.
            self.error = exc
            self._stop.set()
            try:
                self.shutdown()
            except Exception as stop_exc:
                # DDS itself may be what died, in which case the zeros cannot go out at
                # all. Say so and keep `error` pointing at the original cause -- the
                # secondary failure is a symptom, and main() must still exit non-zero.
                print(f"[bridge] zero-velocity stop failed: {stop_exc!r}",
                      file=sys.stderr, flush=True)

    def shutdown(self) -> None:
        """Leave the robot stopped, not coasting on the last command it was given."""
        self._stop.set()
        # Called from run() on failure AND from main()'s finally, so it must run once:
        # publish() is not thread-safe and the stop frames must not be sent twice.
        with self._shutdown_lock:
            if self._shutdown_done:
                return
            self._shutdown_done = True
        with self._lock:
            self._state.stop()
            height = self._state.stand_height
        for _ in range(5):          # a few times: DDS is best-effort, not a handshake
            self.publish(0.0, 0.0, 0.0, height)
            time.sleep(0.02)
        # After the zeros, so the last thing the dead reckoner integrated is a stop.
        if self._odom is not None:
            self._odom.shutdown()
        print(f"[bridge] stopped after {self._sent} commands, "
              f"{self._svc.call_count} RPCs answered", flush=True)


def probe(bridge: IsaacLocoBridge) -> None:
    """Drive a short square directly, bypassing the RPC -- an axis and sign check.

    If the robot walks forward, turns to its LEFT, then walks forward again along a path
    roughly 90 degrees from the first leg, the conventions in this file are right.
    """
    legs = [("forward 2.0 s", 0.4, 0.0, 0.0, 2.0),
            ("turn LEFT 2.0 s", 0.0, 0.0, 0.6, 2.0),
            ("forward 2.0 s", 0.4, 0.0, 0.0, 2.0),
            ("strafe LEFT 1.5 s", 0.0, 0.3, 0.0, 1.5),
            ("stop", 0.0, 0.0, 0.0, 1.0)]
    for label, vx, vy, omega, secs in legs:
        # Checked every leg AND slept in slices: a Ctrl-C mid-leg must not sleep out the
        # remaining ~8 s. The publisher loop dies the moment _stop is set, and Isaac's
        # action provider latches the LAST command it received — so a coasting probe is a
        # robot that keeps walking with nothing driving it.
        if bridge._stop.is_set():
            break
        print(f"[probe] {label}", flush=True)
        with bridge._lock:
            bridge._state.set_velocity(vx, vy, omega, secs + 0.5, bridge._clock())
        if bridge._stop.wait(secs):
            break
    print("[probe] done — expect: forward, LEFT turn, forward, LEFT strafe", flush=True)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--domain", type=int, default=1,
                    help="DDS domain; must match the Isaac sim. 0 (the real robot) "
                         "is REFUSED. 1 = sim, 9 = mock.")
    # 100 Hz, matching the vendor's send_commands_keyboard.py (`time.sleep(0.01)`).
    #
    # This was 50 Hz until 2026-08-28 (TASK-203 step 2) and that is NOT a safe
    # default: the sim's command slot is self-clearing. Isaac's
    # action_provider_wh_dds.compute_current_observations reads it and then
    # immediately writes [0, 0, 0, 0.8] back into the same shared-memory slot
    # (dds/commands_dds.py:71-98), so a published command survives exactly one
    # policy step. The policy consumes at 50 Hz of simulated time (decimation 4
    # x sim.dt 0.005), so publishing at 50 Hz leaves ZERO margin -- every scheduling
    # jitter, GC pause or real-time-factor wobble drops a step's command to zero,
    # and the policy sees a chopped command where it was trained on a held one.
    #
    # Measured at 20 Hz on the same sim and policy, the G1 leaned forward and did
    # not step at all (knee range 0.079 rad); at 100 Hz it walks at 0.570 m/s
    # (knee range 0.941 rad). The failure is silent and looks like a locomotion
    # problem, not a transport one -- it cost TASK-223 and this task a wrong
    # conclusion each. Do not lower this below 50.
    ap.add_argument("--rate", type=float, default=100.0,
                    help="publish rate in Hz for rt/run_command/cmd. Must be >= the "
                         "sim's 50 Hz policy rate -- the sim clears the command slot "
                         "on every read, so a slower publisher starves the policy.")
    ap.add_argument("--probe", action="store_true",
                    help="walk a short square directly, without Agent Mode, to check signs")
    ap.add_argument("--iface", default=None,
                    help="network interface for DDS (e.g. lo); omit to use the SDK default")
    ap.add_argument("--quiet", action="store_true",
                    help="only log commands when they change, not every frame")
    odom = ap.add_mutually_exclusive_group()
    odom.add_argument("--publish-odom", dest="publish_odom", action="store_true",
                      default=True,
                      help="publish rt/odommodestate from rt/lowstate (the default). "
                           "yaw is measured; x/y are dead reckoned and drift.")
    odom.add_argument("--no-odom", dest="publish_odom", action="store_false",
                      help="do not publish odometry. /loco/odom then 503s and Agent "
                           "Mode has no measured heading — use only when something "
                           "else on this domain publishes rt/odommodestate.")
    ap.add_argument("--odom-rate", type=float, default=20.0,
                    help="publish rate in Hz for rt/odommodestate. Independent of "
                         "--rate and of the command thread; 20 Hz matches "
                         "isaac_capture.py and is well inside the sidecar's 2 s "
                         "staleness window.")
    ap.add_argument("--odom-origin", default=None, metavar="X,Y",
                    help="WORLD position, in metres, of the odometry origin — i.e. "
                         "where the robot is standing when this bridge starts. x/y are "
                         "dead reckoned from zero, so without this they are published "
                         "in an odom frame that Agent Mode's place graph "
                         "(sim_evaluator/places/*.json, WORLD metres) reads as world "
                         "coordinates: a robot spawned at (4, -2) publishes (0, 0) and "
                         "resolves into the wrong place 4.5 m away. Offsets x and y "
                         "ONLY — yaw is measured from the sim's base orientation and is "
                         "already world-absolute. factory_mission_bringup.sh passes the "
                         "scene's own spawn pose here, from the same resolver the sim "
                         "spawns with, so the two cannot disagree. Unset = the old "
                         "behaviour, odom frame published as world.")
    ground_truth = ap.add_mutually_exclusive_group()
    ground_truth.add_argument("--ground-truth", dest="ground_truth",
                              action="store_true", default=True,
                              help=f"publish the sim's TRUE world x/y from "
                                   f"{SIM_STATE_TOPIC} when that topic is fresh, "
                                   f"falling back to dead reckoning when it is not "
                                   f"(the default). The origin is NOT applied to a "
                                   f"true pose — it is already world coordinates.")
    ground_truth.add_argument("--no-ground-truth", dest="ground_truth",
                              action="store_false",
                              help=f"never read {SIM_STATE_TOPIC}; dead-reckon x/y "
                                   f"from the commanded velocity, as this bridge did "
                                   f"before TASK-231. That reports the COMMAND back — "
                                   f"measured at 71x the true distance on this rig — "
                                   f"so use it to exercise the fallback, not to run a "
                                   f"mission.")
    ap.add_argument("--stand-height", type=float, default=STAND_HEIGHT_HIGH,
                    help=f"absolute stand height in metres published with every command, "
                         f"including the idle ones (default {STAND_HEIGHT_HIGH}). This is a "
                         f"COMMAND, not a description: the Isaac sim holds {STAND_HEIGHT_HIGH} "
                         f"of its own accord, so the LocoState default of {STAND_HEIGHT_DEFAULT} "
                         f"asks it to crouch, and at this rig's ~16 Hz that measured 0.455 m of "
                         f"drift and 59 deg of yaw while standing still. Use "
                         f"{STAND_HEIGHT_DEFAULT} for a real G1.")
    ap.add_argument("--quat-order", choices=sorted(isaac_odom.QUAT_ORDERS),
                    default=isaac_odom.DEFAULT_QUAT_ORDER,
                    help="component order of rt/lowstate's imu_state.quaternion. "
                         "'xyzw' is correct for this sim (Isaac Lab 3.0 is XYZW and "
                         "the vendor plumbing does not convert); a real G1 is 'wxyz'. "
                         "Getting it wrong makes the heading swing with roll.")
    args = ap.parse_args()

    # A non-positive rate is a divide-by-zero (or a negative period that busy-spins) inside
    # the publish loop, i.e. a crashed publisher — caught here where it is still an
    # argument mistake and not a robot that has stopped receiving commands.
    if args.rate <= 0:
        ap.error("--rate must be > 0")
    if args.rate < 50.0:
        # Not a hard error: driving a real G1, or a mock, has no self-clearing slot and a
        # lower rate is legitimate there. Against Isaac it silently reproduces the bug this
        # default exists to avoid, and that failure looks like a locomotion problem rather
        # than a transport one -- it cost TASK-223 and TASK-203 a wrong conclusion each.
        print(f"[bridge] WARNING: --rate {args.rate:g} Hz is below the sim's 50 Hz policy "
              f"rate. Isaac clears its command slot on every read, so the policy will see "
              f"a chopped command where it was trained on a held one, and the robot will "
              f"lean instead of walking. Use >= 50, ideally 100.", flush=True)

    # Parsed by name, and REFUSED rather than defaulted: `isaac_odom.parse_odom_origin`
    # raises with the offending text in the message, and ap.error() turns that into a
    # usage error and exit 2. Falling back to (0, 0) on a typo would reproduce exactly
    # the defect this flag exists to fix, and reproduce it silently.
    odom_origin = None
    if args.odom_origin is not None:
        try:
            odom_origin = isaac_odom.parse_odom_origin(args.odom_origin)
        except ValueError as exc:
            ap.error(f"--odom-origin: {exc}")

    if args.publish_odom and args.odom_rate <= 0:
        ap.error("--odom-rate must be > 0 (use --no-odom to turn odometry off)")
    if not args.ground_truth and args.publish_odom:
        # Said before anything starts, and again in the banner: the flag turns the
        # published position back into a restatement of the command.
        print(f"[bridge] NOTE: --no-ground-truth — x/y will be DEAD RECKONED even if "
              f"{SIM_STATE_TOPIC} is available. This is the pre-TASK-231 behaviour and "
              f"it reports the command, not the robot.", flush=True)
    if odom_origin is not None and not args.publish_odom:
        # Not fatal, but it is certainly not doing what the operator thinks: nothing
        # publishes odometry at all, so an origin has nothing to shift.
        print("[bridge] NOTE: --odom-origin was given together with --no-odom, so "
              "nothing publishes rt/odommodestate and the origin has no effect.",
              flush=True)
    if args.publish_odom:
        # Not an error, just arithmetic: a frame can only leave on a tick
        # boundary, so any rate that is not a divisor of ODOM_TICK_HZ -- and any
        # rate above it -- is served slower than it was asked for. Say so rather
        # than letting an operator believe they got what they typed. Nothing
        # rounds the request away: the bridge publishes at the achievable rate
        # and every message that quotes a rate quotes that one.
        achievable = achievable_odom_rate_hz(args.odom_rate)
        if abs(achievable - args.odom_rate) > 1e-9:
            print(f"[bridge] NOTE: --odom-rate {args.odom_rate:g} Hz is not a divisor of "
                  f"the {ODOM_TICK_HZ:g} Hz odometry tick, and a frame can only go out on "
                  f"a tick boundary — so odometry will be published at "
                  f"{achievable:g} Hz. Use a divisor (100, 50, 25, 20, 10, 5, 4, 2, 1) "
                  f"to get exactly what you ask for.", flush=True)

    try:
        bridge = IsaacLocoBridge(args.domain, args.rate, verbose=not args.quiet,
                                 iface=args.iface, publish_odom=args.publish_odom,
                                 odom_rate_hz=args.odom_rate, quat_order=args.quat_order,
                                 stand_height=args.stand_height,
                                 odom_origin=odom_origin,
                                 use_ground_truth=args.ground_truth)
    except ValueError as exc:
        # An argument mistake (domain 0) is an operator message, not a traceback.
        # Exit 2 so a script can tell it apart from a bridge that started and then
        # died (1) -- the same contract as isaac_manip_bridge.py.
        print(f"[bridge] refused: {exc}", file=sys.stderr, flush=True)
        return 2

    stopping = threading.Event()

    def _sig(_signum, _frame):
        stopping.set()
        bridge._stop.set()

    signal.signal(signal.SIGINT, _sig)
    signal.signal(signal.SIGTERM, _sig)

    worker = threading.Thread(target=bridge.run, daemon=True)
    worker.start()
    # After the command thread: the dead reckoner should never integrate a stale
    # command slot at startup, and the first frames must already be going out.
    bridge.start_odom()

    # No `except KeyboardInterrupt` — the SIGINT handler above replaces the default one, so
    # Ctrl-C sets `stopping` instead of raising. Shutdown happens in the finally either way.
    try:
        if args.probe:
            probe(bridge)
        else:
            print("[bridge] waiting for LocoClient traffic — Ctrl-C to stop", flush=True)
            # `worker.is_alive()` is not paranoia: without it a dead publisher leaves this
            # process, the DDS participant and the sport service all up and looking
            # healthy, still answering SetVelocity with RPC_OK while nothing at all reaches
            # Isaac. Better to tear the whole thing down than to lie about accepting
            # commands.
            while not stopping.is_set() and worker.is_alive():
                time.sleep(0.2)
    finally:
        # Join before the stop frames go out: publish() touches _pub, _sent and _last_sent
        # without the lock, so the worker and this thread must not both be inside it.
        bridge._stop.set()
        worker.join(timeout=1.0)
        bridge.shutdown()   # a no-op if the worker already published its zeros

    if bridge.error is not None:
        # Non-zero and loud: an operator or systemd must see a crash, not a process that
        # sits there having quietly stopped driving the robot.
        print(f"[bridge] publisher thread died: {bridge.error!r}", file=sys.stderr, flush=True)
        traceback.print_exception(type(bridge.error), bridge.error, bridge.error.__traceback__)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
