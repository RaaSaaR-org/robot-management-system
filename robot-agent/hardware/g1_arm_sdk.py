"""
@file g1_arm_sdk.py
@description The G1 sidecar's only write path to the robot's joints (TASK-391):
             Unitree's arm-only channel `rt/arm_sdk` plus the Dex3-1 hand
             commands, armed only on request, with a dead-man, a latched e-stop
             and a ramp back to Unitree's own control on every exit path.
@feature hardware

Why `rt/arm_sdk` and not `rt/lowcmd`
------------------------------------
`rt/lowcmd` is the debug-mode channel: it bypasses Unitree's balance controller,
so a standing robot falls. `rt/arm_sdk` is blended INTO the running controller:
`motor_cmd[29].q` is a weight in [0, 1], and the robot's own controller keeps
the legs whatever that weight is. At weight 1 the upper body (arms AND waist)
follows this publisher; at weight 0 it is Unitree's again. Every exit path here
therefore ends with the weight ramped to 0 and a few explicit zero-weight
frames, never with a publisher that simply goes quiet at weight 1.

What goes into one `rt/arm_sdk` frame
-------------------------------------
- motors 15..28 (the 14 arm joints) — the only slots an operator moves. Seeded
  from the MEASURED pose on `/arm`, then clamped + slew-limited toward /action.
- motors 12..14 (waist) — held at the pose measured at `/arm`, kp 300 / kd 3:
  `xr_teleoperate`'s motion-mode lock. They are part of the arm_sdk blend, so
  leaving them at kp 0 would hand the blend a limp waist at weight 1. /action
  never moves them.
- motors 0..11 (legs) — the measured pose at kp = kd = 0, mode 0. The robot's
  arm_sdk blender does not take the legs; the MuJoCo sim (sim_g1_dds/sim_node.py)
  blends all 29 slots, so a 0 here would fold the sim's legs to the zero pose.
- motor 29 — the blend weight.

Gains, CRC, the Dex3 RIS mode byte and the motor indices are the ones
`real_g1_bridge/bridge.py` already uses (taken from Unitree's `xr_teleoperate`).

The controller is DDS-free on purpose. `ArmSdkController` takes a clock, a state
source and a wire, so every timing rule (ramp, dead-man, slew) is testable with
a fake clock and no robot. `DdsArmWire` / `DdsStateSource` are the real ones,
constructed only when the sidecar runs with G1_WRITE_MODE=arm_sdk.

Python 3.8-compatible on purpose (the robot's PC2 ships 3.8): no PEP 604/701
syntax at runtime.

@status new — unit-tested with fakes; integration-checked against the MuJoCo
        DDS sim (domain 41, lo). Not yet run against the physical G1.
"""

from __future__ import annotations

import math
import threading
import time

import dex3_faults

# ---------------------------------------------------------------------------
# Wire layout (unitree_hg LowCmd_, G1 29-DoF order — see bridge.py)
# ---------------------------------------------------------------------------
NUM_BODY = 29
NUM_HAND = 7
LEG_IDX = tuple(range(0, 12))
WAIST_IDX = (12, 13, 14)
ARM_IDX = tuple(range(15, 29))
WEIGHT_IDX = 29

TOPIC_ARM_SDK = "rt/arm_sdk"
TOPIC_LOWSTATE = "rt/lowstate"
TOPIC_HAND_STATE = {"left": "rt/dex3/left/state", "right": "rt/dex3/right/state"}
TOPIC_HAND_CMD = {"left": "rt/dex3/left/cmd", "right": "rt/dex3/right/cmd"}

# Gains from xr_teleoperate's G1_29_ArmController / Dex3_1_Controller (the same
# table bridge.py uses). Shoulders + elbows are its "weak" motors.
GAIN_SHOULDER_ELBOW = (80.0, 3.0)
GAIN_WRIST = (40.0, 1.5)
GAIN_WAIST_HOLD = (300.0, 3.0)
GAIN_HAND = (1.5, 0.2)
WRIST_MOTORS = frozenset((19, 20, 21, 26, 27, 28))

# Contract timings (TASK-391 / TASK-393).
ARM_RAMP_S = 1.5          # weight 0 -> 1
DISARM_RAMP_S = 1.0       # weight 1 -> 0
DEADMAN_HOLD_S = 0.5      # no /action this long -> hold
DEADMAN_DISARM_S = 1.0    # no /action this long -> disarm ramp
HAND_FRESH_S = 0.5        # a hand counts as present if its state is this fresh
BODY_STALE_S = 0.5        # rt/lowstate older than this while armed -> disarm
ZERO_WEIGHT_FRAMES = 5    # explicit weight-0 frames before going quiet
MAX_TICK_DT_S = 0.1       # a stalled loop must not turn into one big jump

# Mode guard (TASK-398). arm_sdk is only honoured while Unitree's balance
# controller runs ("regular" mode, FSM 500 — the remote's R1+X). In damp the
# robot IGNORES rt/arm_sdk, so a command streamed there drifts away from the
# measured pose (0.7 rad, observed 2026-10-17) and lands as a jump the moment
# the robot enters balance. So: arm only in measured balance, and let go the
# moment the robot leaves it or the reading goes stale.
FSM_FRESH_S = 1.5         # an FSM reading older than this is "unknown"
FSM_STALE_DISARM_S = 2.0  # while armed, a reading this old disarms
BALANCE_IDS = (500,)
# Drift guard: at full weight the measured arm must follow the command. A
# sustained gap means the robot is not executing arm_sdk (wrong mode, a joint
# blocked, a fault) and the command must not keep running away from the pose.
TRACK_ERR_RAD = 0.35
TRACK_ERR_HOLD_S = 0.3

TELEOP_MODES = ("arms+hands", "arms+left_hand", "arms+right_hand", "arms_only")


def teleop_mode(left: bool, right: bool) -> str:
    """The contract's name for which hands take part in a session."""
    if left and right:
        return "arms+hands"
    if left:
        return "arms+left_hand"
    if right:
        return "arms+right_hand"
    return "arms_only"


def arm_gains(idx: int) -> "tuple[float, float]":
    """(kp, kd) for body motor `idx` in an rt/arm_sdk frame."""
    if idx in WAIST_IDX:
        return GAIN_WAIST_HOLD
    if idx in ARM_IDX:
        return GAIN_WRIST if idx in WRIST_MOTORS else GAIN_SHOULDER_ELBOW
    return (0.0, 0.0)  # legs: never commanded


FRAME_KP = tuple(arm_gains(i)[0] for i in range(NUM_BODY))
FRAME_KD = tuple(arm_gains(i)[1] for i in range(NUM_BODY))


def _finite_list(values, n: int):
    """`values` as a list of n finite floats, or None."""
    if values is None:
        return None
    try:
        out = [float(v) for v in list(values)[:n]]
    except (TypeError, ValueError):
        return None
    if len(out) < n or not all(math.isfinite(v) for v in out):
        return None
    return out


def _approach(cur: float, target: float, step: float) -> float:
    delta = target - cur
    if delta > step:
        return cur + step
    if delta < -step:
        return cur - step
    return target


class ArmFrame:
    """One tick's output: an rt/arm_sdk frame plus the Dex3 commands to send."""

    __slots__ = ("q", "kp", "kd", "weight", "mode_machine", "hands")

    def __init__(self, q, weight, mode_machine, hands):
        self.q = q
        self.kp = FRAME_KP
        self.kd = FRAME_KD
        self.weight = weight
        self.mode_machine = mode_machine
        self.hands = hands  # {"left"|"right": [7 floats]}


class ArmSdkController:
    """Arm/disarm state machine, dead-man and slew for the rt/arm_sdk path.

    Thread model: HTTP handler threads call arm/disarm/estop/action/snapshot;
    ONE publish thread calls tick() and writes what it returns. All state sits
    behind one lock, and the wire is only ever touched by the publish thread
    (and by `final_zero_frames` after that thread has stopped).

    `state` must provide:
        body_q(max_age_s) -> 29 floats | None
        hand_q(side, max_age_s) -> 7 floats (DDS wire order) | None
        mode_machine() -> int
    `body_joints` is the 29-name body table (DDS order); `hand_wire` maps
    "left"/"right" to the 7 Dex3 names in DDS wire order; `limits` maps a joint
    name to its (lower, upper) position limit in radians.
    """

    def __init__(self, body_joints, hand_wire, limits, state, clock=time.monotonic,
                 max_arm_vel=3.0, max_hand_vel=6.0, limit_margin=0.05,
                 arm_ramp_s=ARM_RAMP_S, disarm_ramp_s=DISARM_RAMP_S,
                 deadman_hold_s=DEADMAN_HOLD_S, deadman_disarm_s=DEADMAN_DISARM_S,
                 hand_fresh_s=HAND_FRESH_S, body_stale_s=BODY_STALE_S, log=None,
                 fsm_source=None, require_fsm=False, balance_ids=BALANCE_IDS,
                 fsm_fresh_s=FSM_FRESH_S, fsm_stale_disarm_s=FSM_STALE_DISARM_S,
                 track_err_rad=TRACK_ERR_RAD, track_err_hold_s=TRACK_ERR_HOLD_S):
        """`fsm_source()` returns (fsm_id | None, age_s | None) — the MEASURED
        locomotion FSM (TASK-398). None = no measurement in this process: then
        /arm is refused when `require_fsm` is set (the real robot), and allowed
        as before otherwise (the sim checks)."""
        if len(body_joints) != NUM_BODY:
            raise ValueError("body_joints must list the 29 G1 body joints in DDS order")
        self._state = state
        self._clock = clock
        self._log = log or (lambda msg: print("[G1 arm_sdk] " + msg, flush=True))
        self.max_arm_vel = float(max_arm_vel)
        self.max_hand_vel = float(max_hand_vel)
        self.arm_ramp_s = float(arm_ramp_s)
        self.disarm_ramp_s = float(disarm_ramp_s)
        self.deadman_hold_s = float(deadman_hold_s)
        self.deadman_disarm_s = float(deadman_disarm_s)
        self.hand_fresh_s = float(hand_fresh_s)
        self.body_stale_s = float(body_stale_s)
        self._fsm_source = fsm_source
        self.require_fsm = bool(require_fsm)
        self.balance_ids = tuple(int(i) for i in balance_ids)
        self.fsm_fresh_s = float(fsm_fresh_s)
        self.fsm_stale_disarm_s = float(fsm_stale_disarm_s)
        self.track_err_rad = float(track_err_rad)
        self.track_err_hold_s = float(track_err_hold_s)

        # name -> ("arm", body idx) | ("hand", side, wire idx) | ("body_locked", idx)
        self._slot = {}
        self._lo = {}
        self._hi = {}
        for i, name in enumerate(body_joints):
            self._slot[name] = ("arm", i) if i in ARM_IDX else ("body_locked", i)
        for side in ("left", "right"):
            for i, name in enumerate(hand_wire[side]):
                self._slot[name] = ("hand", side, i)
        for name in self._slot:
            lo, hi = limits.get(name, (-math.pi, math.pi))
            m = min(float(limit_margin), 0.4 * (hi - lo))  # never invert a narrow range
            self._lo[name] = lo + m
            self._hi[name] = hi - m
        self._body_names = list(body_joints)
        self._hand_names = {s: list(hand_wire[s]) for s in ("left", "right")}

        self._lock = threading.Lock()
        self._publishing = False      # frames go out on the wire
        self._engaged = False         # weight target is 1 (armed / arming)
        self._weight = 0.0
        self._estop_latched = False
        self._lease_generation = None
        self._last_disarm_reason = None
        self._mode_machine = 0
        self._cmd = [0.0] * NUM_BODY          # what the frame carries
        self._req = {}                         # arm idx -> requested target
        self._hand_cmd = {}                    # side -> 7 commanded
        self._hand_req = {}                    # side -> 7 requested
        self._hands_active = {"left": False, "right": False}
        self._last_action_at = 0.0
        self._holding = False
        self._last_tick_at = None
        self._zero_frames_left = 0
        self._ever_published = False
        self._ignored = {"legs_waist": 0, "inactive_hand": 0, "unknown": 0}
        self._track_err = None          # max |cmd - measured| over the arms, rad
        self._track_err_joint = None    # the joint that holds it
        self._track_err_since = None    # when it first exceeded the limit
        self._frames = 0                # frames tick() has returned
        self._frame_cv = threading.Condition(self._lock)

    # ------------------------------------------------------------- commands

    def _fsm_reading(self):
        """(fsm_id, age_s) from the source, or (None, None). Never raises."""
        if self._fsm_source is None:
            return None, None
        try:
            fsm_id, age = self._fsm_source()
        except Exception:  # noqa: BLE001 — an unreadable mode is an unknown one
            return None, None
        return fsm_id, age

    def _fsm_refusal_locked(self):
        """None when the measured mode allows arming, else (status, body)."""
        if self._fsm_source is None:
            if not self.require_fsm:
                return None
            return 409, self._reply(
                False, error="fsm_unknown",
                detail="this sidecar does not measure the robot mode: set "
                       "G1_LOCO_ENABLED=fsm, or G1_ARM_ALLOW_UNKNOWN_FSM=1 if a person "
                       "with the remote has put the robot in balance")
        fsm_id, age = self._fsm_reading()
        if fsm_id is None or age is None or age > self.fsm_fresh_s:
            return 409, self._reply(
                False, error="fsm_unknown",
                detail="no fresh FSM reading (age %s s) — the robot mode is unknown"
                       % (None if age is None else round(age, 2)))
        if fsm_id not in self.balance_ids:
            return 409, self._reply(
                False, error="not_in_balance", fsm_id=fsm_id,
                detail="the robot is in FSM %d, not balance %s — arm_sdk is ignored "
                       "there; switch to Balance first" % (fsm_id, list(self.balance_ids)))
        return None

    def arm(self, lease_generation=None):
        """POST /arm. Returns (http_status, body)."""
        with self._lock:
            if self._estop_latched:
                return 409, self._reply(False, error="estop_latched",
                                        detail="e-stop is latched — POST /estop/reset first")
            refusal = self._fsm_refusal_locked()
            if refusal is not None:
                return refusal
            if self._engaged:
                if lease_generation != self._lease_generation:
                    self._log("re-arm under lease generation %r (was %r)"
                              % (lease_generation, self._lease_generation))
                    self._lease_generation = lease_generation
                return 200, self._reply(True, already_armed=True)
            body = _finite_list(self._state.body_q(self.body_stale_s), NUM_BODY)
            if body is None:
                return 503, self._reply(False, error="no_state",
                                        detail="no fresh rt/lowstate within %.1fs — refusing to "
                                               "arm without a measured pose to seed from"
                                               % self.body_stale_s)
            hands = {}
            for side in ("left", "right"):
                hands[side] = _finite_list(self._state.hand_q(side, self.hand_fresh_s), NUM_HAND)
            # Seed EVERYTHING from the measured pose: the first frame commands
            # exactly where the robot already is, so the weight ramp blends
            # "Unitree holds the pose" into "we hold the same pose" — no jump.
            self._cmd = list(body)
            self._req = {i: body[i] for i in ARM_IDX}
            self._hand_cmd = {}
            self._hand_req = {}
            for side in ("left", "right"):
                self._hands_active[side] = hands[side] is not None
                if hands[side] is not None:
                    self._hand_cmd[side] = list(hands[side])
                    self._hand_req[side] = list(hands[side])
            try:
                self._mode_machine = int(self._state.mode_machine())
            except Exception:  # noqa: BLE001 — a missing field must not block arming
                self._mode_machine = 0
            self._engaged = True
            self._publishing = True
            self._ever_published = True
            self._zero_frames_left = 0
            self._holding = False
            self._last_action_at = self._clock()
            self._lease_generation = lease_generation
            self._last_disarm_reason = None
            self._track_err_since = None
            mode = teleop_mode(self._hands_active["left"], self._hands_active["right"])
            missing = [s for s in ("left", "right") if not self._hands_active[s]]
            note = ""
            if missing:
                note = (" — no fresh Dex3 state on the %s hand(s): those are NOT commanded"
                        % "+".join(missing))
            self._log("ARM (lease %r): weight 0 -> 1 over %.1fs, teleop_mode=%s%s"
                      % (lease_generation, self.arm_ramp_s, mode, note))
            return 200, self._reply(True)

    def disarm(self, reason="request"):
        """POST /disarm (and every internal stop). Always succeeds."""
        with self._lock:
            was = self._begin_disarm_locked(reason)
            return 200, self._reply(True, was_armed=was)

    def estop(self):
        """POST /estop: disarm ramp now, and refuse /arm until /estop/reset."""
        with self._lock:
            self._estop_latched = True
            was = self._begin_disarm_locked("estop")
            return 200, self._reply(True, was_armed=was)

    def estop_reset(self):
        """POST /estop/reset: clears the latch. Does NOT re-arm."""
        with self._lock:
            was = self._estop_latched
            self._estop_latched = False
            if was:
                self._log("e-stop latch cleared (not re-armed)")
            return 200, self._reply(True, was_latched=was)

    def action(self, body):
        """POST /action {"<joint>": radians, ..., "lease_generation"?: int}."""
        if not isinstance(body, dict):
            return 400, {"ok": False, "error": 'body must be {"<joint>": radians, ...}'}
        body = dict(body)
        lease = body.pop("lease_generation", None)
        values = {}
        for name, v in body.items():
            try:
                fv = float(v) if isinstance(v, (int, float)) and not isinstance(v, bool) else None
            except OverflowError:  # a JSON integer too large for a float
                fv = None
            if fv is None or not math.isfinite(fv):
                return 400, {"ok": False, "error": "'%s' must be a finite number (radians)" % name}
            values[name] = fv
        with self._lock:
            if not self._engaged:
                return 409, self._reply(False, error="not_armed",
                                        detail="POST /arm first (and keep /action flowing: "
                                               "the dead-man disarms after %.1fs)"
                                               % self.deadman_disarm_s)
            if lease is not None and self._lease_generation is not None \
                    and lease != self._lease_generation:
                return 409, self._reply(False, error="lease_mismatch",
                                        detail="armed under lease generation %r, got %r"
                                               % (self._lease_generation, lease))
            applied = clamped = 0
            ignored = {"legs_waist": 0, "inactive_hand": 0, "unknown": 0}
            for name, v in values.items():
                slot = self._slot.get(name)
                if slot is None:
                    ignored["unknown"] += 1
                    continue
                if slot[0] == "body_locked":
                    ignored["legs_waist"] += 1
                    continue
                if slot[0] == "hand" and not self._hands_active[slot[1]]:
                    ignored["inactive_hand"] += 1
                    continue
                target = min(self._hi[name], max(self._lo[name], v))
                if target != v:
                    clamped += 1
                if slot[0] == "arm":
                    self._req[slot[1]] = target
                else:
                    self._hand_req[slot[1]][slot[2]] = target
                applied += 1
            self._last_action_at = self._clock()
            if self._holding:
                self._holding = False
            for k, n in ignored.items():
                self._ignored[k] += n
            extra = {"applied": applied, "clamped": clamped, "ignored": ignored}
            warnings = []
            if ignored["legs_waist"]:
                warnings.append("ignored %d leg/waist joint(s): arm_sdk mode never commands "
                                "legs or waist" % ignored["legs_waist"])
                # Log the first one and then every 500th, not 50 lines a second.
                total = self._ignored["legs_waist"]
                if total == ignored["legs_waist"] or total % 500 < ignored["legs_waist"]:
                    self._log("WARNING " + warnings[-1] + " (%d so far)" % total)
            if ignored["inactive_hand"]:
                warnings.append("ignored %d finger joint(s) of a hand with no Dex3 state "
                                "(teleop_mode=%s)" % (ignored["inactive_hand"],
                                                      self._teleop_mode_locked()))
            if warnings:
                extra["warnings"] = warnings
            return 200, self._reply(True, **extra)

    # ------------------------------------------------------------- the loop

    def tick(self):
        """Advance one control period. Returns an ArmFrame to publish, or None."""
        now = self._clock()
        with self._lock:
            last = self._last_tick_at
            self._last_tick_at = now
            if not self._publishing:
                return None
            dt = 0.0 if last is None else min(max(now - last, 0.0), MAX_TICK_DT_S)

            if self._engaged:
                idle = now - self._last_action_at
                if idle >= self.deadman_disarm_s:
                    self._begin_disarm_locked("deadman")
                elif idle >= self.deadman_hold_s and not self._holding:
                    self._holding = True
                    self._freeze_locked()
                    self._log("dead-man: no /action for %.2fs — holding" % idle)
            measured = _finite_list(self._state.body_q(self.body_stale_s), NUM_BODY) \
                if self._engaged else None
            if self._engaged and measured is None:
                self._begin_disarm_locked("stale_state")
            if self._engaged and self._fsm_source is not None:
                fsm_id, age = self._fsm_reading()
                if age is None or age > self.fsm_stale_disarm_s:
                    self._log("FSM reading stale (%s s) while armed" %
                              (None if age is None else round(age, 2)))
                    self._begin_disarm_locked("fsm_stale")
                elif age <= self.fsm_fresh_s and fsm_id not in self.balance_ids:
                    self._log("robot left balance (FSM %s) while armed" % fsm_id)
                    self._begin_disarm_locked("left_balance")
            self._track_locked(now, measured)
            for side in ("left", "right"):
                if self._hands_active[side] and _finite_list(
                        self._state.hand_q(side, self.hand_fresh_s), NUM_HAND) is None:
                    # Stop commanding a hand we can no longer see. Its last
                    # command stays latched in the hand; the arms carry on.
                    self._hands_active[side] = False
                    self._hand_cmd.pop(side, None)
                    self._hand_req.pop(side, None)
                    self._log("Dex3 %s state lost — no longer commanded, teleop_mode=%s"
                              % (side, self._teleop_mode_locked()))

            if self._engaged:
                if self.arm_ramp_s > 0:
                    self._weight = min(1.0, self._weight + dt / self.arm_ramp_s)
                else:
                    self._weight = 1.0
            elif self.disarm_ramp_s > 0:
                self._weight = max(0.0, self._weight - dt / self.disarm_ramp_s)
            else:
                self._weight = 0.0

            step = self.max_arm_vel * dt
            for i in ARM_IDX:
                self._cmd[i] = _approach(self._cmd[i], self._req.get(i, self._cmd[i]), step)
            hstep = self.max_hand_vel * dt
            for side, cmd in self._hand_cmd.items():
                req = self._hand_req[side]
                for k in range(NUM_HAND):
                    cmd[k] = _approach(cmd[k], req[k], hstep)

            hands = {s: list(c) for s, c in self._hand_cmd.items()}
            if not self._engaged and self._weight <= 0.0:
                if self._zero_frames_left <= 0:
                    self._zero_frames_left = ZERO_WEIGHT_FRAMES
                self._zero_frames_left -= 1
                if self._zero_frames_left <= 0:
                    self._publishing = False
                    self._hand_cmd = {}
                    self._hand_req = {}
                    self._log("disarmed (%s): weight 0, publisher quiet — the robot is "
                              "under Unitree's control" % self._last_disarm_reason)
            self._frames += 1
            self._frame_cv.notify_all()
            return ArmFrame(list(self._cmd), self._weight, self._mode_machine, hands)

    def wait_frames(self, n=1, timeout_s=0.1):
        """Block until tick() has returned `n` more frames, or `timeout_s`.
        Returns at once when nothing is being published. Used by the E-stop to
        let the first falling-weight frame out before it damps (TASK-398)."""
        deadline = time.monotonic() + max(0.0, float(timeout_s))
        with self._lock:
            target = self._frames + int(n)
            while self._publishing and self._frames < target:
                left = deadline - time.monotonic()
                if left <= 0:
                    return False
                self._frame_cv.wait(left)
            return True

    def force_off(self, reason):
        """The publish path failed: drop to weight 0 at once and go quiet.

        The caller then tries `final_zero_frames` directly — there is no ramp to
        wait for when the thing that would carry the ramp is what broke.
        """
        with self._lock:
            self._engaged = False
            self._publishing = False
            self._weight = 0.0
            self._last_disarm_reason = reason
            self._hand_cmd = {}
            self._hand_req = {}
        self._log("FORCED OFF (%s): weight set to 0" % reason)

    def final_zero_frames(self):
        """Frames to emit on the way out, after the publish thread has stopped:
        the last commanded pose at weight 0, so the last word on the wire is 0.
        Empty if this process never published anything (then it stays silent)."""
        with self._lock:
            if not self._ever_published:
                return []
            return [ArmFrame(list(self._cmd), 0.0, self._mode_machine, {})
                    for _ in range(ZERO_WEIGHT_FRAMES)]

    # ------------------------------------------------------------- queries

    @property
    def publishing(self):
        with self._lock:
            return self._publishing

    @property
    def weight(self):
        with self._lock:
            return self._weight

    def hands_present(self):
        """Which Dex3 hands have state fresher than HAND_FRESH_S right now."""
        out = {}
        for side in ("left", "right"):
            try:
                q = self._state.hand_q(side, self.hand_fresh_s)
            except Exception:  # noqa: BLE001
                q = None
            out[side] = _finite_list(q, NUM_HAND) is not None
        return out

    def hand_health(self, present=None):
        """TASK-404 `hand_health`: per hand present / age / error words /
        decoded motor faults / supply voltage. `present` is the same rule as
        `hands` (pass it in to keep the two consistent within one snapshot).
        A state source without `hand_detail` (a test double, an older
        source) yields present + nulls — "unknown", never "fault-free"."""
        if present is None:
            present = self.hands_present()
        detail = getattr(self._state, "hand_detail", None)
        out = {}
        for side in ("left", "right"):
            data, age = None, None
            if detail is not None:
                try:
                    data, age = detail(side)
                except Exception:  # noqa: BLE001
                    data, age = None, None
            out[side] = dex3_faults.hand_health(side, data, age, bool(present.get(side)),
                                                self._hand_names[side])
        return out

    def lowstate_age_s(self):
        """Seconds since the last rt/lowstate (None: never, or unknown)."""
        fn = getattr(self._state, "lowstate_age_s", None)
        if fn is None:
            return None
        try:
            age = fn()
        except Exception:  # noqa: BLE001
            return None
        return None if age is None else round(max(0.0, float(age)), 3)

    def snapshot(self):
        """The contract fields for /health and /state."""
        present = self.hands_present()
        with self._lock:
            return self._snapshot_locked(present)

    # ------------------------------------------------------------- internals

    def _phase_locked(self):
        if not self._publishing:
            return "disarmed"
        if self._engaged:
            return "armed" if self._weight >= 1.0 else "arming"
        return "disarming"

    def _teleop_mode_locked(self):
        return teleop_mode(self._hands_active["left"], self._hands_active["right"])

    def _snapshot_locked(self, present):
        if self._engaged:
            hands_mode = self._teleop_mode_locked()
        else:
            hands_mode = teleop_mode(present["left"], present["right"])
        deadman = "ok"
        if self._engaged and self._holding:
            deadman = "hold"
        return {
            "write_mode": "arm_sdk",
            "armed": self._engaged,
            "arm_state": self._phase_locked(),
            "arm_weight": round(self._weight, 4),
            "estop_latched": self._estop_latched,
            "hands": present,
            "teleop_mode": hands_mode,
            "lease_generation": self._lease_generation,
            "deadman": deadman,
            "last_disarm_reason": self._last_disarm_reason,
            "ignored_joints": dict(self._ignored),
            "track_err_rad": None if self._track_err is None else round(self._track_err, 3),
            "track_err_joint": (None if self._track_err_joint is None
                                else self._body_names[self._track_err_joint]),
            "fsm": self._fsm_snapshot(),
            # TASK-404, additive: `hands` above stays the boolean pair.
            # Safe under our lock: the state source has its own and never takes ours.
            "hand_health": self.hand_health(present),
            "lowstate_age_s": self.lowstate_age_s(),
        }

    def _fsm_snapshot(self):
        fsm_id, age = self._fsm_reading()
        return {"id": fsm_id, "age_s": None if age is None else round(age, 3)}

    def _reply(self, ok, **extra):
        # Safe under our lock: the state source has its own and never takes ours.
        out = {"ok": ok}
        out.update(self._snapshot_locked(self.hands_present()))
        out.update(extra)
        return out

    def _track_locked(self, now, measured):
        """Drift guard: at full weight, |command - measured| over the arms must
        not stay above `track_err_rad` for `track_err_hold_s`."""
        if not self._engaged or measured is None or self._weight < 0.999:
            self._track_err = None
            self._track_err_joint = None
            self._track_err_since = None
            return
        err, joint = 0.0, None
        for i in ARM_IDX:
            e = abs(self._cmd[i] - measured[i])
            if e > err:
                err, joint = e, i
        self._track_err = err
        self._track_err_joint = joint
        if err <= self.track_err_rad:
            self._track_err_since = None
            return
        if self._track_err_since is None:
            self._track_err_since = now
            return
        if now - self._track_err_since >= self.track_err_hold_s:
            self._log("tracking error %.3f rad on %s (motor %d) for >= %.2fs"
                      % (err, self._body_names[joint], joint, self.track_err_hold_s))
            self._begin_disarm_locked("tracking_error")
            self._track_err_since = None

    def _freeze_locked(self):
        """Stop chasing old targets: hold whatever is commanded right now."""
        for i in ARM_IDX:
            self._req[i] = self._cmd[i]
        for side, cmd in self._hand_cmd.items():
            self._hand_req[side] = list(cmd)

    def _begin_disarm_locked(self, reason):
        if not self._engaged:
            if self._publishing and reason == "estop":
                self._last_disarm_reason = reason
            return False
        self._engaged = False
        self._holding = False
        self._freeze_locked()
        self._last_disarm_reason = reason
        self._log("DISARM (%s): weight %.2f -> 0 over <= %.1fs"
                  % (reason, self._weight, self.disarm_ramp_s))
        return True


class ArmSdkRunner:
    """The publish thread: tick() at `hz`, write what it returns, and on the
    way out (SIGTERM/SIGINT/normal exit) ramp down and leave weight 0 behind."""

    def __init__(self, controller, wire, hz=50.0, log=None):
        self.controller = controller
        self.wire = wire
        self.period = 1.0 / max(float(hz), 1.0)
        self._log = log or (lambda msg: print("[G1 arm_sdk] " + msg, flush=True))
        self._stop = threading.Event()
        self._thread = None
        self.write_errors = 0

    def start(self):
        self._thread = threading.Thread(target=self._loop, name="arm-sdk-publisher",
                                        daemon=True)
        self._thread.start()

    def _write(self, frame):
        self.wire.write_arm(frame.q, frame.kp, frame.kd, frame.weight, frame.mode_machine)
        for side, q in frame.hands.items():
            self.wire.write_hand(side, q, GAIN_HAND[0], GAIN_HAND[1])

    def _loop(self):
        next_at = time.monotonic()
        while not self._stop.is_set():
            try:
                frame = self.controller.tick()
                if frame is not None:
                    self._write(frame)
            except Exception as e:  # noqa: BLE001
                # The publish thread is the only thing that ramps the weight
                # down. If it cannot write, do not leave the weight latched:
                # drop to 0 and say so on the wire directly.
                self.write_errors += 1
                self._log("ERROR publish failed (%r) — forcing weight 0" % (e,))
                self.controller.force_off("publish_error")
                self._emit_final()
            next_at += self.period
            delay = next_at - time.monotonic()
            if delay > 0:
                self._stop.wait(delay)
            else:
                next_at = time.monotonic()

    def _emit_final(self):
        for frame in self.controller.final_zero_frames():
            try:
                self._write(frame)
            except Exception as e:  # noqa: BLE001
                self._log("ERROR zero-weight frame failed (%r)" % (e,))
                return
            time.sleep(0.01)

    def shutdown(self, timeout_s=None):
        """Disarm, wait for the ramp (<= timeout), stop the thread, then emit
        explicit weight-0 frames so the last word on rt/arm_sdk is 0."""
        if timeout_s is None:
            timeout_s = self.controller.disarm_ramp_s + 0.3
        self.controller.disarm("shutdown")
        deadline = time.monotonic() + timeout_s
        while self.controller.publishing and time.monotonic() < deadline:
            if self._thread is None or not self._thread.is_alive():
                break
            time.sleep(0.01)
        self._stop.set()
        if self._thread is not None:
            self._thread.join(timeout=1.0)
        if self.controller.publishing:
            self.controller.force_off("shutdown_timeout")
        self._emit_final()


# ---------------------------------------------------------------------------
# DDS — only constructed in arm_sdk mode (imports are lazy on purpose)
# ---------------------------------------------------------------------------


class DdsArmWire:
    """rt/arm_sdk LowCmd_ + rt/dex3/{left,right}/cmd HandCmd_ publishers.

    The DDS factory must already be initialised (domain + interface) by the
    caller. Construct on the main thread before any other thread touches DDS:
    cyclonedds type population is not thread-safe (see
    g1_state_bridge_readonly.py).
    """

    def __init__(self):
        from unitree_sdk2py.core.channel import ChannelPublisher  # type: ignore
        from unitree_sdk2py.idl.default import (  # type: ignore
            unitree_hg_msg_dds__HandCmd_,
            unitree_hg_msg_dds__LowCmd_,
        )
        from unitree_sdk2py.idl.unitree_hg.msg.dds_ import HandCmd_, LowCmd_  # type: ignore
        from unitree_sdk2py.utils.crc import CRC  # type: ignore

        self._crc = CRC()
        self._pub_arm = ChannelPublisher(TOPIC_ARM_SDK, LowCmd_)
        self._pub_arm.Init()
        self._pub_hand = {}
        self._hand_msg = {}
        for side in ("left", "right"):
            pub = ChannelPublisher(TOPIC_HAND_CMD[side], HandCmd_)
            pub.Init()
            self._pub_hand[side] = pub
            msg = unitree_hg_msg_dds__HandCmd_()
            for i in range(NUM_HAND):
                mc = msg.motor_cmd[i]
                # RIS mode byte: motor id in the low nibble, status 0x01
                # (position servo) in bits 4..6 — Dex3_1_Controller / bridge.py.
                mc.mode = (i & 0x0F) | (0x01 << 4)
                mc.dq = 0.0
                mc.tau = 0.0
            self._hand_msg[side] = msg
        self._low = unitree_hg_msg_dds__LowCmd_()
        self._low.mode_pr = 0

    def write_arm(self, q, kp, kd, weight, mode_machine):
        msg = self._low
        msg.mode_machine = int(mode_machine)
        for i in range(NUM_BODY):
            mc = msg.motor_cmd[i]
            mc.mode = 1 if kp[i] > 0 else 0
            mc.q = float(q[i])
            mc.dq = 0.0
            mc.kp = float(kp[i])
            mc.kd = float(kd[i])
            mc.tau = 0.0
        msg.motor_cmd[WEIGHT_IDX].q = float(min(1.0, max(0.0, weight)))
        msg.crc = self._crc.Crc(msg)
        self._pub_arm.Write(msg)

    def write_hand(self, side, q, kp, kd):
        msg = self._hand_msg[side]
        for i in range(NUM_HAND):
            mc = msg.motor_cmd[i]
            mc.q = float(q[i])
            mc.kp = float(kp)
            mc.kd = float(kd)
        self._pub_hand[side].Write(msg)


class DdsStateSource:
    """rt/lowstate (CRC-checked) + rt/dex3/*/state, subscribed directly.

    The controller's seed pose, hand presence and `mode_machine` come from here
    rather than from the read-only ZMQ bridge: arming must not depend on a
    second process and a JSON hop, and the LowCmd needs `mode_machine`, which
    only lowstate carries. `latest_dict` serves /state in the bridge's JSON
    shape when the bridge itself is silent.
    """

    def __init__(self, check_crc=True, clock=time.monotonic):
        from unitree_sdk2py.core.channel import ChannelSubscriber  # type: ignore
        from unitree_sdk2py.idl.unitree_hg.msg.dds_ import HandState_, LowState_  # type: ignore

        self._clock = clock
        self._lock = threading.Lock()
        self._body = None       # (dict, t)
        self._hand = {}         # side -> (dict, t)
        self._mode_machine = 0
        self.crc_failures = 0
        self._crc = None
        if check_crc:
            from unitree_sdk2py.utils.crc import CRC  # type: ignore
            self._crc = CRC()
        for idl in (LowState_, HandState_):
            try:
                idl.__idl__.populate()
            except Exception:  # noqa: BLE001 — the subscriber below then says why
                pass
        self._subs = []
        sub = ChannelSubscriber(TOPIC_LOWSTATE, LowState_)
        sub.Init(self._on_lowstate, 16)
        self._subs.append(sub)
        for side in ("left", "right"):
            s = ChannelSubscriber(TOPIC_HAND_STATE[side], HandState_)
            s.Init(lambda m, side=side: self._on_hand(side, m), 8)
            self._subs.append(s)

    @staticmethod
    def _motors(raw, n):
        out = []
        for i in range(min(n, len(raw))):
            m = raw[i]
            temp = getattr(m, "temperature", None)
            try:
                t = float(sum(temp) / len(temp)) if isinstance(temp, (list, tuple)) else float(temp)
            except (TypeError, ValueError, ZeroDivisionError):
                t = None
            entry = {"q": float(m.q), "dq": float(getattr(m, "dq", 0.0)),
                     "tau_est": float(getattr(m, "tau_est", 0.0))}
            if t is not None:
                entry["temperature"] = t
            # TASK-404: the per-motor status word (a latched Dex3 fault reads
            # 0x200 here). Omitted when the IDL lacks it, never zero-filled.
            word = getattr(m, "motorstate", None)
            if word is not None:
                try:
                    entry["motorstate"] = int(word) & 0xFFFFFFFF
                except (TypeError, ValueError):
                    pass
            out.append(entry)
        return out

    def _on_lowstate(self, msg):
        if self._crc is not None and self._crc.Crc(msg) != msg.crc:
            self.crc_failures += 1
            return
        imu = getattr(msg, "imu_state", None)
        data = {"motor_state": self._motors(msg.motor_state, NUM_BODY),
                "mode_machine": int(getattr(msg, "mode_machine", 0))}
        if imu is not None:
            data["imu_state"] = {
                "rpy": [float(x) for x in imu.rpy],
                "gyroscope": [float(x) for x in imu.gyroscope],
                "accelerometer": [float(x) for x in imu.accelerometer],
                "temperature": float(imu.temperature),
            }
        with self._lock:
            self._body = (data, self._clock())
            self._mode_machine = data["mode_machine"]

    def _on_hand(self, side, msg):
        data = {"motor_state": self._motors(msg.motor_state, NUM_HAND)}
        # TASK-404: HandState_.error[2] and the supply voltage, kept for
        # /health's hand_health. The receive time is the tuple's second item.
        error = getattr(msg, "error", None)
        if error is not None:
            try:
                words = [int(w) & 0xFFFFFFFF for w in error]
            except (TypeError, ValueError):
                words = []
            if len(words) >= 2:
                data["error"] = words[:2]
        power_v = getattr(msg, "power_v", None)
        if power_v is not None:
            try:
                data["power_v"] = float(power_v)
            except (TypeError, ValueError):
                pass
        with self._lock:
            self._hand[side] = (data, self._clock())

    def hand_detail(self, side):
        """(newest hand dict, age_s) whatever its age, or (None, None) if this
        hand never published (TASK-404 hand_health)."""
        with self._lock:
            entry = self._hand.get(side)
            if entry is None:
                return None, None
            return entry[0], self._clock() - entry[1]

    def lowstate_age_s(self):
        """Seconds since the last CRC-valid rt/lowstate, None if none yet."""
        with self._lock:
            if self._body is None:
                return None
            return self._clock() - self._body[1]

    def _fresh(self, entry, max_age_s):
        if entry is None or self._clock() - entry[1] > max_age_s:
            return None
        return entry[0]

    def body_q(self, max_age_s):
        with self._lock:
            data = self._fresh(self._body, max_age_s)
        if data is None or len(data["motor_state"]) < NUM_BODY:
            return None
        return [m["q"] for m in data["motor_state"][:NUM_BODY]]

    def hand_q(self, side, max_age_s):
        with self._lock:
            data = self._fresh(self._hand.get(side), max_age_s)
        if data is None or len(data["motor_state"]) < NUM_HAND:
            return None
        return [m["q"] for m in data["motor_state"][:NUM_HAND]]

    def mode_machine(self):
        with self._lock:
            return self._mode_machine

    def latest_dict(self, topic, max_age_s=2.0):
        """Bridge-shaped dict for `topic` (lowstate or a Dex3 state), or None."""
        with self._lock:
            if topic == TOPIC_LOWSTATE:
                return self._fresh(self._body, max_age_s)
            for side, t in TOPIC_HAND_STATE.items():
                if topic == t:
                    return self._fresh(self._hand.get(side), max_age_s)
        return None
