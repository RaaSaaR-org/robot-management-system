"""Unit tests for loco_state.py — the state machine behind the simulated
Unitree loco ("sport") service.

No DDS, no MuJoCo, no clock: `LocoState` takes simulation time as an argument
precisely so it can be pinned down here. Run with any pytest:

    python -m pytest robot-agent/hardware/sim_g1_dds/test_loco_state.py

What these tests are actually protecting (TASK-194, Agent Mode):

* **Command expiry.** The real G1 drops a velocity command after its duration —
  that is why LocoClient.Move() has to be called in a loop. A simulator that
  kept driving would let a planner bug walk the robot into a wall in sim and
  behave differently on hardware. Expiry is the difference between "the sim
  lies in the safe direction" and "the sim lies".
* **FSM gating.** A damped, seated or de-energised robot does not walk. If sim
  let it, a plan that forgets to stand up would pass in sim and fail on the
  robot.
* **Mid-point integration.** Agent Mode navigates by "turn to bearing, then
  walk". Naive forward Euler biases every turn-and-walk toward the pre-turn
  heading, so the acceptance run ("geh zum Tisch mit dem Hut") would drift off
  target for reasons that have nothing to do with the planner.
* **Angle wrapping, in exactly one direction.** Every bearing comparison in the
  navigator goes through wrap_angle: a robot that turns left past 180 deg must
  *report* -179, not +181. But `pose.yaw` itself is an actuation signal that
  sim_node.py writes into a kp=20000 position actuator, so it must stay
  continuous — wrapping it steps the setpoint by 2*pi in one 2 ms tick and blows
  MuJoCo's solver up on the first turn past 180 deg (a `turn 180` block, or
  `scan_room` with the default steps=8).
* **A clock that can go backwards.** Expiry stamps are absolute, and in the sim
  they live on MuJoCo's `data.time`, which resets to 0 on a solver instability.
  A command from the previous epoch must be dead, never re-armed for another
  full duration — that is the difference between a 6 s command and a robot that
  spins for 500 s.
* **Gesture envelopes.** `wave` claims the arms only while it plays, and starts
  and ends at zero deflection so it can never snap the arms from or to an
  arbitrary pose.
"""
from __future__ import annotations

import math
import sys
from pathlib import Path

import pytest

# loco_state.py supports both package and plain-script import; make the plain
# one available no matter which directory pytest is invoked from.
sys.path.insert(0, str(Path(__file__).resolve().parent))

from loco_state import (  # noqa: E402
    ARM_TASK_RELEASE, ARM_TASK_SHAKE_REACH, ARM_TASK_SHAKE_RETURN,
    ARM_TASK_WAVE, ARM_TASK_WAVE_TURN, FSM_DAMP, FSM_SIT, FSM_START,
    FSM_ZERO_TORQUE, MAX_OMEGA, MAX_VX, MAX_VY, STAND_HEIGHT_DEFAULT,
    STAND_HEIGHT_HIGH, STAND_HEIGHT_LOW, SHAKE_DURATION_S, UINT32_MAX,
    WAVE_DURATION_S, LocoState, wrap_angle,
)
from joints import (  # noqa: E402
    R_ELBOW, R_SHOULDER_PITCH, R_SHOULDER_ROLL, R_SHOULDER_YAW, R_WRIST_ROLL,
    WAIST_YAW,
)


def _run(state: LocoState, seconds: float, dt: float = 0.001,
         t0: float = 0.0) -> float:
    """Integrate `seconds` of simulation in fixed `dt` steps.

    Returns the simulation time after the last step, so a caller can chain
    phases (turn, then walk) on one continuous clock.
    """
    steps = int(round(seconds / dt))
    t = t0
    for _ in range(steps):
        state.step(dt, t)
        t += dt
    return t


# ---------------------------------------------------------------- expiry


def test_velocity_expires_after_duration():
    st = LocoState()
    st.set_velocity(0.5, 0.0, 0.0, duration=1.0, now=0.0)

    assert st.commanded_velocity(0.0) == (0.5, 0.0, 0.0)
    assert st.commanded_velocity(0.999) == (0.5, 0.0, 0.0)
    # Expiry is inclusive: `now >= expires_at` is already too late.
    assert st.commanded_velocity(1.0) == (0.0, 0.0, 0.0)
    assert st.commanded_velocity(50.0) == (0.0, 0.0, 0.0)


def test_expired_command_stops_the_robot_mid_integration():
    """A 1 s command inside a 2 s integration must move exactly 1 s worth."""
    st = LocoState()
    st.set_velocity(0.5, 0.0, 0.0, duration=1.0, now=0.0)
    _run(st, seconds=2.0)

    assert st.pose.x == pytest.approx(0.5, abs=1e-3)
    assert st.pose.y == pytest.approx(0.0, abs=1e-9)


def test_refreshing_the_command_extends_the_window():
    """LocoClient.Move() in a loop keeps the robot going; that must work here.

    Same 1.5 s schedule, run twice. Without a refresh the command dies at t=1.0
    and the robot covers 0.5 m; refreshed at t=0.5 it keeps its full 0.5 m/s to
    the end and covers 0.75 m.
    """
    stale = LocoState()
    stale.set_velocity(0.5, 0.0, 0.0, duration=1.0, now=0.0)
    _run(stale, seconds=1.5)
    assert stale.pose.x == pytest.approx(0.5, abs=1e-3)

    st = LocoState()
    st.set_velocity(0.5, 0.0, 0.0, duration=1.0, now=0.0)
    t = _run(st, seconds=0.5)
    st.set_velocity(0.5, 0.0, 0.0, duration=1.0, now=t)
    _run(st, seconds=1.0, t0=t)

    assert st.pose.x == pytest.approx(0.75, abs=1e-3)


def test_stop_clears_the_command():
    st = LocoState()
    st.set_velocity(0.5, 0.2, 0.3, duration=10.0, now=0.0)
    st.stop()

    assert st.commanded_velocity(0.0) == (0.0, 0.0, 0.0)
    _run(st, seconds=1.0)
    assert (st.pose.x, st.pose.y, st.pose.yaw) == (0.0, 0.0, 0.0)


# ------------------------------------------------------------- FSM gating


@pytest.mark.parametrize("fsm_id", [FSM_DAMP, FSM_SIT, FSM_ZERO_TORQUE])
def test_non_locomoting_fsm_refuses_to_translate(fsm_id):
    st = LocoState()
    st.set_fsm_id(fsm_id)
    assert st.locomotion_enabled is False

    st.set_velocity(1.0, 0.0, 0.5, duration=10.0, now=0.0)
    assert st.commanded_velocity(0.0) == (0.0, 0.0, 0.0)

    _run(st, seconds=1.0)
    assert (st.pose.x, st.pose.y, st.pose.yaw) == (0.0, 0.0, 0.0)


@pytest.mark.parametrize("fsm_id", [FSM_DAMP, FSM_SIT, FSM_ZERO_TORQUE])
def test_entering_non_locomoting_fsm_cancels_a_standing_command(fsm_id):
    """Damping must not merely pause a command — it must discard it.

    Otherwise standing back up would resume a walk the operator believed they
    had cancelled seconds ago.
    """
    st = LocoState()
    st.set_velocity(0.5, 0.0, 0.0, duration=100.0, now=0.0)
    assert st.commanded_velocity(0.0) == (0.5, 0.0, 0.0)

    st.set_fsm_id(fsm_id)
    st.set_fsm_id(FSM_START)  # back on our feet

    assert st.locomotion_enabled is True
    assert st.commanded_velocity(0.0) == (0.0, 0.0, 0.0)
    _run(st, seconds=1.0)
    assert st.pose.x == 0.0


def test_default_fsm_can_locomote():
    st = LocoState()
    assert st.fsm_id == FSM_START
    assert st.locomotion_enabled is True


# ------------------------------------------------------- pose integration


def test_turn_then_walk_lands_where_trigonometry_says():
    """90 deg left, then 1 m forward, must end at (0, 1) facing +y.

    The turn runs at 1.0 rad/s for pi/2 s rather than pi/2 rad/s for 1 s: the
    latter would be silently clamped to MAX_OMEGA and this test would be
    measuring the clamp instead of the integrator.
    """
    st = LocoState()

    quarter_turn = math.pi / 2
    st.set_velocity(0.0, 0.0, 1.0, duration=quarter_turn, now=0.0)
    t = _run(st, seconds=quarter_turn, dt=quarter_turn / 1000)
    assert st.pose.yaw == pytest.approx(math.pi / 2, abs=1e-6)
    assert st.pose.x == pytest.approx(0.0, abs=1e-9)
    assert st.pose.y == pytest.approx(0.0, abs=1e-9)

    st.set_velocity(1.0, 0.0, 0.0, duration=1.0, now=t)
    _run(st, seconds=1.0, t0=t)

    assert st.pose.x == pytest.approx(0.0, abs=1e-6)
    assert st.pose.y == pytest.approx(1.0, abs=1e-6)
    assert st.pose.yaw == pytest.approx(math.pi / 2, abs=1e-6)


def test_strafe_uses_the_body_frame():
    """vy is LEFT in the body frame, so strafing while facing +y goes to -x."""
    st = LocoState()
    st.pose.yaw = math.pi / 2
    st.set_velocity(0.0, 1.0, 0.0, duration=1.0, now=0.0)
    _run(st, seconds=1.0)

    assert st.pose.x == pytest.approx(-1.0, abs=1e-6)
    assert st.pose.y == pytest.approx(0.0, abs=1e-6)


def test_midpoint_heading_beats_forward_euler_on_a_coarse_arc():
    """One coarse step of a constant-curvature arc, against the exact solution.

    v=1 m/s, omega=1 rad/s for 0.5 s from yaw 0 traces a circular arc whose
    closed form is known. Mid-point integration must land far closer to it than
    the naive `use the heading at the start of the step` alternative — that is
    the entire reason the integrator is written the way it is.
    """
    v, w, dt = 1.0, 1.0, 0.5
    exact_x = (v / w) * math.sin(w * dt)
    exact_y = (v / w) * (1.0 - math.cos(w * dt))

    st = LocoState()
    st.set_velocity(v, 0.0, w, duration=10.0, now=0.0)
    st.step(dt, 0.0)

    midpoint_err = math.hypot(st.pose.x - exact_x, st.pose.y - exact_y)
    euler_err = math.hypot(v * dt - exact_x, 0.0 - exact_y)  # heading held at 0

    assert st.pose.yaw == pytest.approx(w * dt, abs=1e-12)
    assert midpoint_err < 0.01
    assert midpoint_err < euler_err / 10


# ----------------------------------------------------------- wrap_angle


def test_wrap_angle_is_identity_inside_the_range():
    for a in (0.0, 0.5, -0.5, 1.5, -1.5, 3.0, -3.0):
        assert wrap_angle(a) == pytest.approx(a, abs=1e-12)


def test_wrap_angle_at_the_180_degree_boundary():
    # +-pi is one point on the circle; either sign is correct, the magnitude is
    # not negotiable.
    assert abs(wrap_angle(math.pi)) == pytest.approx(math.pi, abs=1e-9)
    assert abs(wrap_angle(-math.pi)) == pytest.approx(math.pi, abs=1e-9)

    # Just past the boundary must flip sign, not keep counting up.
    assert wrap_angle(math.pi + 0.1) == pytest.approx(-math.pi + 0.1, abs=1e-9)
    assert wrap_angle(-math.pi - 0.1) == pytest.approx(math.pi - 0.1, abs=1e-9)

    # Full turns collapse.
    assert wrap_angle(2 * math.pi) == pytest.approx(0.0, abs=1e-9)
    assert wrap_angle(-2 * math.pi) == pytest.approx(0.0, abs=1e-9)
    assert abs(wrap_angle(3 * math.pi)) == pytest.approx(math.pi, abs=1e-9)
    assert wrap_angle(5 * math.pi / 2) == pytest.approx(math.pi / 2, abs=1e-9)


def test_reported_yaw_wraps_when_turning_past_180_degrees():
    """Turning left past 180 deg reports ~-179, never +181."""
    st = LocoState()
    st.set_velocity(0.0, 0.0, 1.0, duration=100.0, now=0.0)
    _run(st, seconds=math.pi + 0.1)  # 180 deg + a bit, at 1 rad/s

    assert st.pose.yaw_wrapped < 0.0
    assert st.pose.yaw_wrapped == pytest.approx(-math.pi + 0.1, abs=1e-3)


def test_pose_yaw_stays_continuous_past_180_degrees():
    """The DRIVEN yaw must not wrap — it is a position-actuator setpoint.

    Regression for the crash: sim_node.py writes pose.yaw into `base_yaw`, a
    kp=20000 position actuator on a +-100 rad hinge. A wrapped setpoint steps by
    2*pi in a single 2 ms tick when the robot turns past 180 deg, QACC explodes
    and MuJoCo auto-resets the whole mjData. Measured full-physics on
    g1_dex3_room_scene.xml: wrapped -> max|qacc| 6.3e7 and a bad-QACC warning;
    continuous -> max|qacc| 2.7e2 and none.
    """
    st = LocoState()
    st.set_velocity(0.0, 0.0, 1.0, duration=100.0, now=0.0)
    _run(st, seconds=math.pi + 0.1)

    assert st.pose.yaw > 0.0
    assert st.pose.yaw == pytest.approx(math.pi + 0.1, abs=1e-3)


def test_two_full_spins_never_step_the_setpoint():
    """No tick may move yaw by more than the commanded rate allows.

    Two full revolutions cross the +-180 deg boundary four times. The assertion
    is the one MuJoCo actually cares about: the per-tick delta of the value that
    reaches the actuator, which a wrap would blow up to ~2*pi.
    """
    st = LocoState()
    omega, dt = 1.0, 0.002
    st.set_velocity(0.0, 0.0, omega, duration=100.0, now=0.0)

    steps = int(round(4 * math.pi / omega / dt))
    t, prev, worst = 0.0, st.pose.yaw, 0.0
    for _ in range(steps):
        st.step(dt, t)
        t += dt
        worst = max(worst, abs(st.pose.yaw - prev))
        prev = st.pose.yaw

    assert worst <= omega * dt * 1.000001
    assert st.pose.yaw == pytest.approx(steps * omega * dt, abs=1e-6)
    assert st.pose.yaw == pytest.approx(4 * math.pi, abs=dt)
    # ...while the reported heading has come all the way back around to ~0.
    assert st.pose.yaw_wrapped == pytest.approx(0.0, abs=dt)


# --------------------------------------------------- non-monotonic clock


def test_expired_command_does_not_resurrect_when_the_clock_resets():
    """MuJoCo zeroes data.time on an auto-reset; a dead command stays dead.

    Regression for the runaway: `now >= expires_at` alone re-armed every command
    for its full duration on the new epoch. A 6 s command produced 13.3 s of
    motion; a longer one out-lived its own revolution period and never stopped.
    """
    st = LocoState()
    st.set_velocity(0.0, 0.0, 0.6, duration=6.0, now=1.0)
    assert st.commanded_velocity(3.0) == (0.0, 0.0, 0.6)

    # ... instability at t=6.26, mj_resetData -> data.time = 0.002.
    assert st.commanded_velocity(0.002) == (0.0, 0.0, 0.0)
    _run(st, seconds=10.0, t0=0.002)
    assert st.pose.yaw == pytest.approx(0.0, abs=1e-9)


def test_on_clock_reset_drops_the_active_command():
    st = LocoState()
    st.set_velocity(0.5, 0.0, 0.3, duration=100.0, now=10.0)
    assert st.commanded_velocity(11.0) != (0.0, 0.0, 0.0)

    st.on_clock_reset()

    # Dead on both the old and the new epoch, and it cannot be waited out.
    assert st.commanded_velocity(11.0) == (0.0, 0.0, 0.0)
    assert st.commanded_velocity(0.0) == (0.0, 0.0, 0.0)
    _run(st, seconds=5.0)
    assert (st.pose.x, st.pose.y, st.pose.yaw) == (0.0, 0.0, 0.0)


def test_on_clock_reset_releases_a_running_gesture():
    st = LocoState()
    st.set_arm_task(ARM_TASK_WAVE, now=10.0)
    assert st.arm_task_active(11.0) is True

    st.on_clock_reset()

    assert st.arm_targets(0.0) is None
    assert st.arm_task_active(11.0) is False


def test_a_gesture_from_the_previous_epoch_is_released_not_replayed():
    """A negative phase would drive the envelope outside 0..1 and snap the arm."""
    st = LocoState()
    st.set_arm_task(ARM_TASK_WAVE, now=10.0)

    assert st.arm_targets(0.002) is None
    assert st.arm_task_active(0.5) is False


def test_sync_pose_adopts_the_measured_pose():
    """After a reset the simulator's qpos is the only truth left."""
    st = LocoState()
    st.pose.x, st.pose.y, st.pose.yaw = 2.0, -1.0, 7.5

    st.sync_pose(0.0, 0.0, 0.0)

    assert (st.pose.x, st.pose.y, st.pose.yaw) == (0.0, 0.0, 0.0)


# ------------------------------------------------------- fidelity clamp


def test_velocity_is_clamped_to_the_robots_own_limits():
    st = LocoState()
    st.set_velocity(99.0, 99.0, 99.0, duration=10.0, now=0.0)
    assert st.commanded_velocity(0.0) == (MAX_VX, MAX_VY, MAX_OMEGA)

    st.set_velocity(-99.0, -99.0, -99.0, duration=10.0, now=0.0)
    assert st.commanded_velocity(0.0) == (-MAX_VX, -MAX_VY, -MAX_OMEGA)


def test_in_range_velocity_passes_through_unclamped():
    st = LocoState()
    st.set_velocity(0.4, -0.2, 0.7, duration=10.0, now=0.0)
    assert st.commanded_velocity(0.0) == (0.4, -0.2, 0.7)


def test_clamped_command_integrates_at_the_clamped_speed():
    """The clamp must bite on the pose, not only on the reported command."""
    st = LocoState()
    st.set_velocity(99.0, 0.0, 0.0, duration=10.0, now=0.0)
    _run(st, seconds=1.0)
    assert st.pose.x == pytest.approx(MAX_VX, abs=1e-6)


# ------------------------------------------------------ stand height


def test_stand_height_sentinels():
    """LocoClient.HighStand()/LowStand() send UINT32_MAX / 0, not metres."""
    st = LocoState()
    assert st.stand_height == STAND_HEIGHT_DEFAULT

    st.set_stand_height(UINT32_MAX)
    assert st.stand_height == STAND_HEIGHT_HIGH

    st.set_stand_height(0)
    assert st.stand_height == STAND_HEIGHT_LOW

    st.set_stand_height(UINT32_MAX)
    assert st.stand_height == STAND_HEIGHT_HIGH


def test_stand_height_accepts_a_real_measurement():
    st = LocoState()
    st.set_stand_height(0.7)
    assert st.stand_height == pytest.approx(0.7)


def test_negative_stand_height_reads_as_the_low_sentinel():
    st = LocoState()
    st.set_stand_height(-1.0)
    assert st.stand_height == STAND_HEIGHT_LOW


# ---------------------------------------------------------- arm tasks


@pytest.mark.parametrize("task_id", [ARM_TASK_WAVE, ARM_TASK_WAVE_TURN])
def test_wave_envelope_starts_and_ends_at_zero(task_id):
    st = LocoState()
    st.set_arm_task(task_id, now=100.0)

    start = st.arm_targets(100.0)
    assert start is not None
    assert all(abs(v) < 1e-6 for v in start.values())

    peak = st.arm_targets(100.0 + WAVE_DURATION_S / 2)
    assert peak is not None
    assert peak[R_SHOULDER_PITCH] == pytest.approx(-1.35, abs=1e-6)
    assert peak[R_ELBOW] == pytest.approx(1.00, abs=1e-6)

    end = st.arm_targets(100.0 + WAVE_DURATION_S - 1e-4)
    assert end is not None
    assert all(abs(v) < 1e-3 for v in end.values())


def test_wave_drives_only_the_right_arm_unless_turning():
    st = LocoState()
    st.set_arm_task(ARM_TASK_WAVE, now=0.0)
    plain = st.arm_targets(2.0)
    assert set(plain) == {R_SHOULDER_PITCH, R_SHOULDER_ROLL, R_ELBOW, R_WRIST_ROLL}

    st.set_arm_task(ARM_TASK_WAVE_TURN, now=0.0)
    turning = st.arm_targets(2.0)
    assert WAIST_YAW in turning
    assert turning[WAIST_YAW] == pytest.approx(0.35, abs=1e-6)


def test_wave_auto_clears_after_its_duration():
    st = LocoState()
    st.set_arm_task(ARM_TASK_WAVE, now=0.0)
    assert st.arm_task_active(1.0) is True

    assert st.arm_targets(WAVE_DURATION_S) is None
    # And it stays released: the arms go back to whatever arm_sdk is doing.
    assert st.arm_targets(1.0) is None
    assert st.arm_task_active(1.0) is False


@pytest.mark.parametrize("task_id", [ARM_TASK_SHAKE_REACH, ARM_TASK_SHAKE_RETURN])
def test_shake_envelope_starts_and_ends_at_zero(task_id):
    st = LocoState()
    st.set_arm_task(task_id, now=5.0)

    start = st.arm_targets(5.0)
    assert start is not None
    assert set(start) == {R_SHOULDER_PITCH, R_SHOULDER_ROLL, R_SHOULDER_YAW, R_ELBOW}
    assert all(abs(v) < 1e-6 for v in start.values())

    end = st.arm_targets(5.0 + SHAKE_DURATION_S - 1e-4)
    assert end is not None
    assert all(abs(v) < 1e-3 for v in end.values())


def test_shake_return_stage_is_lower_than_the_reach_stage():
    st = LocoState()
    st.set_arm_task(ARM_TASK_SHAKE_REACH, now=0.0)
    reach = st.arm_targets(SHAKE_DURATION_S / 2)[R_ELBOW]

    st.set_arm_task(ARM_TASK_SHAKE_RETURN, now=0.0)
    ret = st.arm_targets(SHAKE_DURATION_S / 2)[R_ELBOW]

    assert reach == pytest.approx(0.85, abs=1e-6)
    assert ret == pytest.approx(0.85 * 0.35, abs=1e-6)


def test_shake_auto_clears_after_its_duration():
    st = LocoState()
    st.set_arm_task(ARM_TASK_SHAKE_REACH, now=0.0)
    assert st.arm_task_active(1.0) is True
    assert st.arm_targets(SHAKE_DURATION_S) is None
    assert st.arm_task_active(1.0) is False


def test_release_task_frees_the_arms_immediately():
    """SetTaskId(99) is the release id — it must not wait out the gesture."""
    st = LocoState()
    st.set_arm_task(ARM_TASK_WAVE, now=0.0)
    assert st.arm_targets(1.0) is not None

    st.set_arm_task(ARM_TASK_RELEASE, now=1.0)

    assert ARM_TASK_RELEASE == 99
    assert st.arm_targets(1.0) is None
    assert st.arm_task_active(1.0) is False


def test_unknown_arm_task_is_accepted_then_released():
    """The real robot accepts unknown ids; we must not hold the arms hostage."""
    st = LocoState()
    st.set_arm_task(4242, now=0.0)
    assert st.arm_targets(0.0) is None
    assert st.arm_task_active(0.0) is False


def test_no_arm_task_leaves_the_arms_alone():
    st = LocoState()
    assert st.arm_targets(0.0) is None
    assert st.arm_task_active(0.0) is False


def test_arm_task_and_locomotion_are_independent():
    """Waving while walking must keep walking — the gesture only claims arms."""
    st = LocoState()
    st.set_velocity(0.5, 0.0, 0.0, duration=10.0, now=0.0)
    st.set_arm_task(ARM_TASK_WAVE, now=0.0)
    _run(st, seconds=1.0)

    assert st.pose.x == pytest.approx(0.5, abs=1e-3)
    assert st.arm_task_active(1.0) is True
