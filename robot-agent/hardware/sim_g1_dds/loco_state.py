"""Pure state machine behind the simulated Unitree loco ("sport") service.

Deliberately free of DDS and MuJoCo imports so it can be unit-tested on its own
(`test_loco_state.py`) and reasoned about without a simulator running.
`loco_service.py` wraps it in the DDS RPC server; `sim_node.py` drives it from
the physics loop.

Frames and units, fixed once here:
  * pose is (x, y, yaw) in the world frame, metres and radians
  * yaw 0 means facing world +x, counter-clockwise positive
  * velocity commands are BODY frame: vx forward, vy left, omega yaw rate

`pose.yaw` is **continuous** -- it accumulates and is never wrapped. It is an
actuation signal: sim_node.py writes it straight into the `base_yaw` position
actuator, and wrapping it would step that setpoint by 2*pi in a single 2 ms tick
the moment the robot turned past 180 deg, which makes MuJoCo's solver explode
(QACC blow-up -> auto-reset of the whole mjData). Wrap only where a *heading is
reported*: `Pose.yaw_wrapped`, and `sim_node.measured_pose()` for the odometry
topic -- which is also what a real G1 does, since its rpy comes out of a
quaternion and is therefore always in (-pi, pi].

The real robot re-arms its own safety behaviour on every SetVelocity, so a
command expires after `duration` seconds unless it is refreshed. We reproduce
that: it is why `LocoClient.Move()` has to be called in a loop, and a simulator
that ignored it would let a bug run the robot into a wall in sim but not on
hardware.

Expiry is an absolute stamp on a clock the caller owns, and in the sim that
clock is MuJoCo's `data.time`, which is **not monotonic**: any solver instability
resets it to 0. A command is therefore only alive inside `[issued_at,
expires_at)` -- a `now` *before* it was issued means the clock moved backwards
and the command is dead, not re-armed for another full duration. Same for a
running arm gesture. `on_clock_reset()` is the loud version of that for the
owner of the clock to call.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field

try:  # package import (python -m sim_g1_dds.sim_node)
    from .joints import (
        R_ELBOW, R_SHOULDER_PITCH, R_SHOULDER_ROLL, R_SHOULDER_YAW,
        R_WRIST_ROLL, WAIST_YAW,
    )
except ImportError:  # plain-script import (mjpython sim_node.py)
    from joints import (  # type: ignore[no-redef]
        R_ELBOW, R_SHOULDER_PITCH, R_SHOULDER_ROLL, R_SHOULDER_YAW,
        R_WRIST_ROLL, WAIST_YAW,
    )

# --- Unitree API ids we answer (see unitree_sdk2py/g1/loco/g1_loco_api.py) ---
API_GET_FSM_ID = 7001
API_GET_FSM_MODE = 7002
API_GET_BALANCE_MODE = 7003
API_GET_SWING_HEIGHT = 7004
API_GET_STAND_HEIGHT = 7005
API_SET_FSM_ID = 7101
API_SET_BALANCE_MODE = 7102
API_SET_SWING_HEIGHT = 7103
API_SET_STAND_HEIGHT = 7104
API_SET_VELOCITY = 7105
API_SET_ARM_TASK = 7106
API_SET_SPEED_MODE = 7107
API_SWITCH_TO_USER_CTRL = 7110
API_SWITCH_TO_INTERNAL_CTRL = 7111

# FSM ids used by LocoClient's convenience wrappers.
FSM_ZERO_TORQUE = 0
FSM_DAMP = 1
FSM_SIT = 3
FSM_START = 500
FSM_LIE_TO_STAND = 702
FSM_SQUAT_STAND = 706

# States in which the robot must not translate. Matches the real FSM: damped,
# de-energised or seated robots do not walk.
NON_LOCOMOTING_FSM = frozenset({FSM_ZERO_TORQUE, FSM_DAMP, FSM_SIT})

# Arm task ids from SetTaskId (7106).
ARM_TASK_RELEASE = 99
ARM_TASK_WAVE = 0
ARM_TASK_WAVE_TURN = 1
ARM_TASK_SHAKE_REACH = 2
ARM_TASK_SHAKE_RETURN = 3

# Fidelity clamp, NOT a safety gate. The real G1 clamps commanded velocity in
# its own controller, so a simulator that integrated unbounded velocities would
# be less faithful, not more permissive. Agent Mode's decision to ship without a
# speed cap (TASK-194) is about the *agent*; this is what the robot does to any
# command it is given.
MAX_VX = 1.5
MAX_VY = 1.0
MAX_OMEGA = 1.5

# Stand height sentinels: LocoClient.HighStand()/LowStand() send UINT32_MAX / 0.
UINT32_MAX = (1 << 32) - 1
STAND_HEIGHT_DEFAULT = 0.75
STAND_HEIGHT_HIGH = 0.80
STAND_HEIGHT_LOW = 0.65

WAVE_DURATION_S = 4.0
SHAKE_DURATION_S = 3.0


def _clamp(value: float, limit: float) -> float:
    return max(-limit, min(limit, value))


def wrap_angle(a: float) -> float:
    """Wrap to (-pi, pi]. Used for every bearing comparison."""
    return math.atan2(math.sin(a), math.cos(a))


@dataclass
class Pose:
    """World pose. `yaw` is continuous (unwrapped) -- see the module docstring."""

    x: float = 0.0
    y: float = 0.0
    yaw: float = 0.0

    @property
    def yaw_wrapped(self) -> float:
        """The same heading in (-pi, pi], for reporting and bearing maths."""
        return wrap_angle(self.yaw)


@dataclass
class LocoState:
    """Everything the simulated loco service remembers.

    `now` is always *simulation* time in seconds, supplied by the caller, so the
    state machine stays deterministic and testable without a clock.
    """

    pose: Pose = field(default_factory=Pose)
    fsm_id: int = FSM_START
    balance_mode: int = 0
    swing_height: float = 0.08
    stand_height: float = STAND_HEIGHT_DEFAULT

    _vx: float = 0.0
    _vy: float = 0.0
    _omega: float = 0.0
    # A command lives in the half-open window [issued_at, expires_at). Storing
    # both ends -- not just the end -- is what stops a clock that jumps
    # backwards from silently re-arming it for another full duration.
    _vel_issued_at: float = 0.0
    _vel_expires_at: float = 0.0

    _arm_task: int | None = None
    _arm_task_started_at: float = 0.0

    # ------------------------------------------------------------------ setters

    def set_velocity(self, vx: float, vy: float, omega: float, duration: float,
                     now: float) -> None:
        self._vx = _clamp(float(vx), MAX_VX)
        self._vy = _clamp(float(vy), MAX_VY)
        self._omega = _clamp(float(omega), MAX_OMEGA)
        self._vel_issued_at = now
        self._vel_expires_at = now + max(0.0, float(duration))

    def stop(self) -> None:
        self._vx = self._vy = self._omega = 0.0
        self._vel_issued_at = 0.0
        self._vel_expires_at = 0.0

    def set_fsm_id(self, fsm_id: int) -> None:
        self.fsm_id = int(fsm_id)
        if self.fsm_id in NON_LOCOMOTING_FSM:
            # Entering damp/sit/zero-torque cancels any standing velocity
            # command, exactly like the onboard FSM transition does.
            self.stop()

    def set_stand_height(self, height: float) -> None:
        h = float(height)
        if h >= UINT32_MAX:
            self.stand_height = STAND_HEIGHT_HIGH
        elif h <= 0.0:
            self.stand_height = STAND_HEIGHT_LOW
        else:
            self.stand_height = h

    def set_arm_task(self, task_id: int, now: float) -> None:
        task_id = int(task_id)
        if task_id == ARM_TASK_RELEASE:
            self._arm_task = None
            return
        self._arm_task = task_id
        self._arm_task_started_at = now

    # --------------------------------------------------------- clock recovery

    def on_clock_reset(self) -> None:
        """The owner of the clock saw it jump backwards; drop timed state.

        Everything with an absolute stamp (velocity window, gesture start) is
        meaningless on the new epoch, and re-interpreting it against a clock
        that restarted at 0 is how a 6 s command turns into a robot that never
        stops. The pose is deliberately NOT touched: `sync_pose` is the caller's
        job, because only it knows what the simulator actually holds now.
        """
        self.stop()
        self._arm_task = None
        self._arm_task_started_at = 0.0

    def sync_pose(self, x: float, y: float, yaw: float) -> None:
        """Adopt a measured pose as the new truth (continuous yaw, unwrapped).

        Used after a simulator reset, so the commanded base pose cannot teleport
        the robot back to where the state machine thought it was.
        """
        self.pose.x = float(x)
        self.pose.y = float(y)
        self.pose.yaw = float(yaw)

    # ----------------------------------------------------------------- stepping

    @property
    def locomotion_enabled(self) -> bool:
        return self.fsm_id not in NON_LOCOMOTING_FSM

    def commanded_velocity(self, now: float) -> tuple[float, float, float]:
        """Body-frame velocity currently in force, after expiry and FSM gating.

        `now` before the command was issued means the clock moved backwards
        under us (MuJoCo auto-reset). The command belongs to a dead epoch, so it
        is DISCARDED here and not merely skipped -- otherwise the new clock would
        simply climb back into the old [issued_at, expires_at) window a moment
        later and the robot would resume a command nobody re-sent.
        """
        if now < self._vel_issued_at:
            self.stop()
            return (0.0, 0.0, 0.0)
        if now >= self._vel_expires_at or not self.locomotion_enabled:
            return (0.0, 0.0, 0.0)
        return (self._vx, self._vy, self._omega)

    def step(self, dt: float, now: float) -> Pose:
        """Integrate the active velocity command for `dt` seconds."""
        vx, vy, omega = self.commanded_velocity(now)
        if vx or vy or omega:
            # Integrate at the mid-point heading: for a constant body-frame
            # velocity this is second-order accurate, so a 90 deg turn-and-walk
            # does not drift the way naive forward Euler does.
            yaw_mid = self.pose.yaw + 0.5 * omega * dt
            self.pose.x += (vx * math.cos(yaw_mid) - vy * math.sin(yaw_mid)) * dt
            self.pose.y += (vx * math.sin(yaw_mid) + vy * math.cos(yaw_mid)) * dt
            # NOT wrapped: this value drives a position actuator. See the module
            # docstring -- wrapping here steps base_yaw by 2*pi in one tick and
            # blows the solver up on the first turn past 180 deg.
            self.pose.yaw += omega * dt
        return self.pose

    # ---------------------------------------------------------------- arm tasks

    def arm_task_active(self, now: float) -> bool:
        return self.arm_targets(now) is not None

    def arm_targets(self, now: float) -> dict[int, float] | None:
        """Joint targets for the running gesture, keyed by BODY index.

        Returns None when no gesture is running, which tells sim_node.py to
        leave the arms to whatever the arm_sdk publisher is doing. This is what
        makes `wave` work over LocoClient while a VLA rollout could still drive
        the same joints over rt/arm_sdk -- last writer per tick wins, and the
        gesture only claims the arms while it is actually playing.
        """
        if self._arm_task is None:
            return None
        t = now - self._arm_task_started_at
        if t < 0.0:
            # Clock went backwards (see on_clock_reset): the gesture belonged to
            # the previous epoch. Release rather than replay it from a negative
            # phase, which would drive the envelope outside 0..1.
            self._arm_task = None
            return None

        if self._arm_task in (ARM_TASK_WAVE, ARM_TASK_WAVE_TURN):
            if t >= WAVE_DURATION_S:
                self._arm_task = None
                return None
            return self._wave_targets(t, turn=self._arm_task == ARM_TASK_WAVE_TURN)

        if self._arm_task in (ARM_TASK_SHAKE_REACH, ARM_TASK_SHAKE_RETURN):
            if t >= SHAKE_DURATION_S:
                self._arm_task = None
                return None
            return self._shake_targets(t, reaching=self._arm_task == ARM_TASK_SHAKE_REACH)

        # Unknown task id: accepted by the API (the real robot would too) but
        # nothing to play.
        self._arm_task = None
        return None

    @staticmethod
    def _ramp(t: float, duration: float, rise: float = 0.6) -> float:
        """0 -> 1 -> 0 envelope with smooth ends, so gestures never snap."""
        if t < rise:
            s = t / rise
        elif t > duration - rise:
            s = max(0.0, (duration - t) / rise)
        else:
            s = 1.0
        return s * s * (3.0 - 2.0 * s)

    def _wave_targets(self, t: float, turn: bool) -> dict[int, float]:
        env = self._ramp(t, WAVE_DURATION_S)
        osc = math.sin(2.0 * math.pi * 0.9 * t)
        targets = {
            R_SHOULDER_PITCH: -1.35 * env,
            R_SHOULDER_ROLL: (-0.35 + 0.40 * osc) * env,
            R_ELBOW: 1.00 * env,
            R_WRIST_ROLL: 0.35 * osc * env,
        }
        if turn:
            # turn_flag on the real robot turns the torso toward the greeted
            # person; the waist is the only DOF we have for that here.
            targets[WAIST_YAW] = 0.35 * env
        return targets

    def _shake_targets(self, t: float, reaching: bool) -> dict[int, float]:
        env = self._ramp(t, SHAKE_DURATION_S)
        if not reaching:
            env *= 0.35  # the return stage lowers the arm rather than extending
        return {
            R_SHOULDER_PITCH: -0.75 * env,
            R_SHOULDER_ROLL: -0.18 * env,
            R_SHOULDER_YAW: 0.10 * env,
            R_ELBOW: 0.85 * env,
        }
