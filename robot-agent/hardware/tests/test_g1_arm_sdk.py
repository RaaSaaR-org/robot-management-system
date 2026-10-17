"""
@file test_g1_arm_sdk.py
@description The rt/arm_sdk controller's rules, driven by a fake clock, a fake
             state source and a fake wire — no DDS, no robot (TASK-391).
@feature hardware

Every rule here is a promise made to the person standing next to a real G1:
the first frame commands the pose the robot already holds, nothing moves before
/arm, the legs and waist never take an operator target, a hand that sends no
state is never commanded, and every way out ends at weight 0.

@status test
"""

import math
import os
import sys
import threading
import time

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import g1_arm_sdk as arm_sdk  # noqa: E402
import g1_sidecar  # noqa: E402

DT = 0.02  # one 50 Hz publish tick


class FakeClock:
    def __init__(self):
        self.t = 1000.0

    def __call__(self):
        return self.t

    def advance(self, dt):
        self.t += dt


class FakeState:
    """A robot standing still in a non-zero pose, both Dex3 hands present."""

    def __init__(self):
        # A distinct, non-zero value per motor, so "seeded from the measured
        # pose" can never pass by accident on a pose of zeros.
        self.body = [0.01 * (i + 1) * (-1) ** i for i in range(29)]
        self.hands = {
            "left": [0.1, 0.2, 0.3, -0.4, -0.5, -0.6, -0.7],
            "right": [0.1, -0.2, -0.3, 0.4, 0.5, 0.6, 0.7],
        }
        self.body_ok = True
        self.mm = 7

    def body_q(self, max_age_s):
        return list(self.body) if self.body_ok else None

    def hand_q(self, side, max_age_s):
        h = self.hands.get(side)
        return None if h is None else list(h)

    def mode_machine(self):
        return self.mm


def make(clock=None, state=None, **kw):
    clock = clock or FakeClock()
    state = state or FakeState()
    logs = []
    ctrl = arm_sdk.ArmSdkController(
        g1_sidecar.BODY_JOINTS,
        {"left": g1_sidecar.LEFT_HAND_WIRE, "right": g1_sidecar.RIGHT_HAND_WIRE},
        g1_sidecar.POS_LIMITS,
        state,
        clock=clock,
        log=logs.append,
        **kw
    )
    return ctrl, clock, state, logs


def run(ctrl, clock, seconds, action=None):
    """Tick for `seconds`; send `action` every tick if given. Returns frames."""
    frames = []
    for _ in range(int(round(seconds / DT))):
        clock.advance(DT)
        if action is not None:
            ctrl.action(action)
        f = ctrl.tick()
        if f is not None:
            frames.append(f)
    return frames


ARM_NAMES = g1_sidecar.BODY_JOINTS[15:29]
LEFT_ELBOW = "left_elbow_joint"
LEFT_ELBOW_IDX = g1_sidecar.BODY_JOINTS.index(LEFT_ELBOW)


# --------------------------------------------------------------------- arming

def test_nothing_is_published_before_arm():
    ctrl, clock, _, _ = make()
    assert run(ctrl, clock, 1.0) == []
    assert ctrl.snapshot()["arm_state"] == "disarmed"


def test_action_before_arm_is_409_not_armed():
    ctrl, _, _, _ = make()
    status, body = ctrl.action({LEFT_ELBOW: 0.5})
    assert status == 409
    assert body["error"] == "not_armed"
    assert body["armed"] is False


def test_first_frame_commands_the_measured_pose_not_zero():
    ctrl, clock, state, _ = make()
    status, body = ctrl.arm(lease_generation=3)
    assert status == 200 and body["armed"] is True and body["lease_generation"] == 3
    frames = run(ctrl, clock, DT)
    assert frames[0].q == pytest.approx(state.body)  # arms, waist AND legs
    assert frames[0].hands["left"] == pytest.approx(state.hands["left"])
    assert frames[0].hands["right"] == pytest.approx(state.hands["right"])
    assert frames[0].mode_machine == 7
    assert frames[0].weight < 0.05


def test_arm_ramps_the_weight_to_one_in_about_one_and_a_half_seconds():
    ctrl, clock, _, _ = make()
    ctrl.arm()
    frames = run(ctrl, clock, 2.0, action={})
    weights = [f.weight for f in frames]
    assert weights == sorted(weights)
    t_full = next(i for i, w in enumerate(weights) if w >= 1.0) * DT + DT
    assert 1.45 <= t_full <= 1.55
    assert weights[int(0.75 / DT)] == pytest.approx(0.5, abs=0.02)
    assert ctrl.snapshot()["arm_state"] == "armed"


def test_arm_without_a_measured_pose_refuses():
    ctrl, clock, state, _ = make()
    state.body_ok = False
    status, body = ctrl.arm()
    assert status == 503 and body["error"] == "no_state"
    assert run(ctrl, clock, 0.5) == []


def test_frame_gains_lock_waist_and_leave_legs_alone():
    ctrl, clock, _, _ = make()
    ctrl.arm()
    f = run(ctrl, clock, DT)[0]
    for i in range(12):
        assert f.kp[i] == 0.0 and f.kd[i] == 0.0
    for i in (12, 13, 14):
        assert (f.kp[i], f.kd[i]) == (300.0, 3.0)
    for i in range(15, 29):
        assert f.kp[i] > 0.0


# ------------------------------------------------------------ action handling

def test_targets_are_clamped_to_the_joint_limits_minus_the_margin():
    ctrl, clock, _, _ = make()
    ctrl.arm()
    status, body = ctrl.action({LEFT_ELBOW: 10.0})
    assert status == 200 and body["clamped"] == 1
    frames = run(ctrl, clock, 3.0, action={LEFT_ELBOW: 10.0})
    hi = g1_sidecar.POS_LIMITS[LEFT_ELBOW][1]
    assert frames[-1].q[LEFT_ELBOW_IDX] == pytest.approx(hi - 0.05)


def test_targets_are_slew_limited_per_tick_against_the_clock():
    ctrl, clock, state, _ = make(max_arm_vel=3.0)
    ctrl.arm()
    start = state.body[LEFT_ELBOW_IDX]
    frames = run(ctrl, clock, 0.22, action={LEFT_ELBOW: start + 1.0})
    # The first tick after /arm has no elapsed time to slew over: it is the
    # seed frame, at the measured pose.
    assert frames[0].q[LEFT_ELBOW_IDX] == start
    steps = [b.q[LEFT_ELBOW_IDX] - a.q[LEFT_ELBOW_IDX] for a, b in zip(frames, frames[1:])]
    for s in steps:
        assert s == pytest.approx(3.0 * DT, abs=1e-9)
    assert frames[-1].q[LEFT_ELBOW_IDX] == pytest.approx(start + 0.6, abs=1e-9)


def test_leg_and_waist_keys_are_ignored_and_counted():
    ctrl, clock, state, logs = make()
    ctrl.arm()
    status, body = ctrl.action({"left_knee_joint": 1.0, "waist_yaw_joint": 0.5,
                                "right_hip_pitch_joint": -1.0, LEFT_ELBOW: 0.3})
    assert status == 200
    assert body["applied"] == 1
    assert body["ignored"]["legs_waist"] == 3
    assert any("leg/waist" in w for w in body["warnings"])
    assert any("leg/waist" in line for line in logs)
    frames = run(ctrl, clock, 1.0, action={"left_knee_joint": 1.0, "waist_yaw_joint": 0.5})
    for f in frames:
        assert f.q[:15] == pytest.approx(state.body[:15])
    assert ctrl.snapshot()["ignored_joints"]["legs_waist"] == 3 + 2 * 50


def test_unknown_joints_are_counted_and_bad_values_rejected():
    ctrl, _, _, _ = make()
    ctrl.arm()
    status, body = ctrl.action({"left_tail_joint": 1.0})
    assert status == 200 and body["ignored"]["unknown"] == 1 and body["applied"] == 0
    for bad in (float("nan"), float("inf"), "1.0", True, None, 10 ** 400):
        status, body = ctrl.action({LEFT_ELBOW: bad})
        assert status == 400, bad
    assert ctrl.action([1, 2])[0] == 400


def test_a_stale_lease_generation_is_refused():
    ctrl, _, _, _ = make()
    ctrl.arm(lease_generation=4)
    assert ctrl.action({LEFT_ELBOW: 0.1, "lease_generation": 4})[0] == 200
    status, body = ctrl.action({LEFT_ELBOW: 0.1, "lease_generation": 3})
    assert status == 409 and body["error"] == "lease_mismatch"
    assert ctrl.action({LEFT_ELBOW: 0.1})[0] == 200  # field is optional


# ------------------------------------------------------------------ dead-man

def test_steady_actions_keep_it_armed():
    ctrl, clock, _, _ = make()
    ctrl.arm()
    run(ctrl, clock, 5.0, action={LEFT_ELBOW: 0.2})
    snap = ctrl.snapshot()
    assert snap["armed"] is True and snap["deadman"] == "ok"


def test_deadman_holds_at_half_a_second_and_disarms_at_one():
    ctrl, clock, state, _ = make(max_arm_vel=0.5)
    ctrl.arm()
    start = state.body[LEFT_ELBOW_IDX]
    target = start + 1.0
    run(ctrl, clock, 0.1, action={LEFT_ELBOW: target})  # last /action at t0 + 0.1

    run(ctrl, clock, 0.48)
    assert ctrl.snapshot()["deadman"] == "ok"
    moving = run(ctrl, clock, 0.04)  # crosses 0.5 s of silence
    assert ctrl.snapshot()["deadman"] == "hold"
    held = moving[-1].q[LEFT_ELBOW_IDX]
    assert held < target  # it had not got there…
    frames = run(ctrl, clock, 0.4)
    for f in frames:  # …and does not keep going once holding
        assert f.q[LEFT_ELBOW_IDX] == pytest.approx(held)
    assert ctrl.snapshot()["armed"] is True

    run(ctrl, clock, 0.1)  # past 1.0 s of silence
    snap = ctrl.snapshot()
    assert snap["armed"] is False
    assert snap["arm_state"] == "disarming"
    assert snap["last_disarm_reason"] == "deadman"


def test_an_action_during_hold_resumes():
    ctrl, clock, _, _ = make()
    ctrl.arm()
    run(ctrl, clock, 0.7)
    assert ctrl.snapshot()["deadman"] == "hold"
    assert ctrl.action({LEFT_ELBOW: 0.3})[0] == 200
    run(ctrl, clock, 0.02)
    assert ctrl.snapshot()["deadman"] == "ok" and ctrl.snapshot()["armed"] is True


# ------------------------------------------------------------- disarm / estop

def test_disarm_ramps_to_zero_in_about_a_second_then_goes_quiet():
    ctrl, clock, _, _ = make()
    ctrl.arm()
    run(ctrl, clock, 2.0, action={})
    assert ctrl.weight == 1.0
    status, body = ctrl.disarm()
    assert status == 200 and body["was_armed"] is True
    frames = run(ctrl, clock, 2.0)
    weights = [f.weight for f in frames]
    assert weights == sorted(weights, reverse=True)
    t_zero = next(i for i, w in enumerate(weights) if w <= 0.0) * DT + DT
    assert 0.95 <= t_zero <= 1.05
    # explicit weight-0 frames, then nothing
    assert weights.count(0.0) == arm_sdk.ZERO_WEIGHT_FRAMES
    assert run(ctrl, clock, 0.5) == []
    assert ctrl.snapshot()["arm_state"] == "disarmed"
    assert ctrl.action({LEFT_ELBOW: 0.1})[0] == 409


def test_disarm_holds_the_pose_while_ramping():
    ctrl, clock, state, _ = make(max_arm_vel=0.5)
    ctrl.arm()
    run(ctrl, clock, 0.2, action={LEFT_ELBOW: state.body[LEFT_ELBOW_IDX] + 1.0})
    ctrl.disarm()
    frames = run(ctrl, clock, 1.2)
    q = [f.q[LEFT_ELBOW_IDX] for f in frames]
    assert max(q) - min(q) == pytest.approx(0.0)


def test_estop_disarms_and_latches_until_reset():
    ctrl, clock, _, _ = make()
    ctrl.arm()
    run(ctrl, clock, 1.6, action={})
    status, body = ctrl.estop()
    assert status == 200 and body["estop_latched"] is True and body["armed"] is False
    assert ctrl.snapshot()["last_disarm_reason"] == "estop"
    frames = run(ctrl, clock, 1.2)
    assert frames[-1].weight == 0.0
    status, body = ctrl.arm()
    assert status == 409 and body["error"] == "estop_latched"
    status, body = ctrl.estop_reset()
    assert status == 200 and body["was_latched"] is True and body["armed"] is False
    assert ctrl.arm()[0] == 200


def test_estop_while_disarmed_still_latches():
    ctrl, _, _, _ = make()
    ctrl.estop()
    assert ctrl.arm()[0] == 409


def test_stale_lowstate_while_armed_disarms():
    ctrl, clock, state, _ = make()
    ctrl.arm()
    run(ctrl, clock, 0.2, action={})
    state.body_ok = False
    run(ctrl, clock, DT, action={})
    snap = ctrl.snapshot()
    assert snap["armed"] is False and snap["last_disarm_reason"] == "stale_state"


def test_rearm_during_the_disarm_ramp_reseeds_from_the_measured_pose():
    ctrl, clock, state, _ = make()
    ctrl.arm()
    run(ctrl, clock, 1.6, action={})
    ctrl.disarm()
    run(ctrl, clock, 0.4)
    state.body = [v + 0.05 for v in state.body]
    assert ctrl.arm()[0] == 200
    f = run(ctrl, clock, DT, action={})[0]
    assert f.q == pytest.approx(state.body)
    assert 0.5 < f.weight < 1.0  # continues from where the ramp was


# ----------------------------------------------------------- hand fallback

@pytest.mark.parametrize("missing,mode", [
    ((), "arms+hands"),
    (("right",), "arms+left_hand"),
    (("left",), "arms+right_hand"),
    (("left", "right"), "arms_only"),
])
def test_a_missing_hand_arms_anyway_and_is_never_commanded(missing, mode):
    ctrl, clock, state, logs = make()
    for side in missing:
        state.hands[side] = None
    status, body = ctrl.arm()
    assert status == 200
    assert body["teleop_mode"] == mode
    for side in ("left", "right"):
        assert body["hands"][side] is (side not in missing)
    frames = run(ctrl, clock, 0.5, action={"right_hand_index_0_joint": 1.0,
                                          "left_hand_index_0_joint": -1.0})
    for f in frames:
        assert set(f.hands) == {"left", "right"} - set(missing)
    if missing:
        assert any("NOT commanded" in line for line in logs)
        _, reply = ctrl.action({"%s_hand_index_0_joint" % missing[0]: 0.0})
        assert reply["ignored"]["inactive_hand"] == 1


def test_a_hand_that_goes_silent_mid_session_stops_being_commanded():
    ctrl, clock, state, logs = make()
    ctrl.arm()
    run(ctrl, clock, 0.2, action={})
    state.hands["right"] = None
    frames = run(ctrl, clock, 0.2, action={})
    assert all("right" not in f.hands for f in frames)
    snap = ctrl.snapshot()
    assert snap["armed"] is True and snap["teleop_mode"] == "arms+left_hand"
    assert snap["hands"] == {"left": True, "right": False}
    assert any("right state lost" in line for line in logs)


def test_finger_targets_are_clamped_and_slewed():
    ctrl, clock, state, _ = make(max_hand_vel=6.0)
    ctrl.arm()
    name = "right_hand_index_0_joint"  # wire idx 3, range (0, 1.5708)
    frames = run(ctrl, clock, 1.0, action={name: 5.0})
    assert frames[1].hands["right"][3] - state.hands["right"][3] == pytest.approx(6.0 * DT)
    assert frames[-1].hands["right"][3] == pytest.approx(1.5708 - 0.05)


def test_teleop_mode_names():
    assert arm_sdk.teleop_mode(True, True) == "arms+hands"
    assert arm_sdk.teleop_mode(True, False) == "arms+left_hand"
    assert arm_sdk.teleop_mode(False, True) == "arms+right_hand"
    assert arm_sdk.teleop_mode(False, False) == "arms_only"
    assert set(arm_sdk.TELEOP_MODES) == {"arms+hands", "arms+left_hand",
                                         "arms+right_hand", "arms_only"}


# ------------------------------------------------------------ the runner

class FakeWire:
    def __init__(self, fail=False):
        self.arm_frames = []
        self.hand_frames = []
        self.fail = fail
        self.lock = threading.Lock()

    def write_arm(self, q, kp, kd, weight, mode_machine):
        if self.fail:
            raise RuntimeError("wire down")
        with self.lock:
            self.arm_frames.append((list(q), weight, time.monotonic()))

    def write_hand(self, side, q, kp, kd):
        with self.lock:
            self.hand_frames.append((side, list(q), kp, kd))


def test_final_zero_frames_only_after_something_was_published():
    ctrl, clock, _, _ = make()
    assert ctrl.final_zero_frames() == []
    ctrl.arm()
    run(ctrl, clock, 0.1, action={})
    zf = ctrl.final_zero_frames()
    assert len(zf) == arm_sdk.ZERO_WEIGHT_FRAMES and all(f.weight == 0.0 for f in zf)


def test_runner_shutdown_ramps_down_within_a_second_and_ends_at_zero():
    """What SIGTERM/SIGINT run (g1_sidecar.main → ArmSdkRunner.shutdown)."""
    state = FakeState()
    ctrl = arm_sdk.ArmSdkController(
        g1_sidecar.BODY_JOINTS,
        {"left": g1_sidecar.LEFT_HAND_WIRE, "right": g1_sidecar.RIGHT_HAND_WIRE},
        g1_sidecar.POS_LIMITS, state, log=lambda m: None)
    wire = FakeWire()
    runner = arm_sdk.ArmSdkRunner(ctrl, wire, hz=100.0, log=lambda m: None)
    runner.start()
    ctrl.arm()
    end = time.monotonic() + 1.7
    while time.monotonic() < end:
        ctrl.action({})
        time.sleep(0.02)
    assert ctrl.weight == 1.0
    t0 = time.monotonic()
    runner.shutdown()
    took = time.monotonic() - t0
    assert took < 1.5
    after = [w for _, w, t in wire.arm_frames if t >= t0]
    assert after[-arm_sdk.ZERO_WEIGHT_FRAMES:] == [0.0] * arm_sdk.ZERO_WEIGHT_FRAMES
    assert after == sorted(after, reverse=True)
    assert wire.hand_frames and all(kp == 1.5 and kd == 0.2 for _, _, kp, kd in wire.hand_frames)


def test_runner_shutdown_without_arming_publishes_nothing():
    ctrl, _, _, _ = make(clock=time.monotonic)
    wire = FakeWire()
    runner = arm_sdk.ArmSdkRunner(ctrl, wire, hz=100.0, log=lambda m: None)
    runner.start()
    time.sleep(0.1)
    runner.shutdown()
    assert wire.arm_frames == [] and wire.hand_frames == []


def test_a_failing_wire_forces_weight_zero():
    ctrl, _, _, _ = make(clock=time.monotonic)
    runner = arm_sdk.ArmSdkRunner(ctrl, FakeWire(fail=True), hz=100.0, log=lambda m: None)
    runner.start()
    ctrl.arm()
    time.sleep(0.1)
    snap = ctrl.snapshot()
    assert snap["armed"] is False and snap["arm_weight"] == 0.0
    assert snap["last_disarm_reason"] == "publish_error"
    assert runner.write_errors >= 1
    runner.shutdown()


def test_frame_layout_constants_match_the_sidecar_and_bridge():
    assert arm_sdk.ARM_IDX == tuple(range(15, 29))
    assert [g1_sidecar.BODY_JOINTS[i] for i in arm_sdk.WAIST_IDX] == [
        "waist_yaw_joint", "waist_roll_joint", "waist_pitch_joint"]
    assert all("hip" in n or "knee" in n or "ankle" in n
               for n in (g1_sidecar.BODY_JOINTS[i] for i in arm_sdk.LEG_IDX))
    assert arm_sdk.WEIGHT_IDX == 29
    assert all(math.isfinite(k) for k in arm_sdk.FRAME_KP)


# ------------------------------------------------------- TASK-398: mode guards

class FsmSource:
    """The sidecar's FSM monitor as the controller sees it: (id, age_s)."""

    def __init__(self, clock, fsm_id=500):
        self.clock = clock
        self.fsm_id = fsm_id
        self.at = clock()

    def set(self, fsm_id):
        self.fsm_id = fsm_id
        self.at = self.clock()

    def __call__(self):
        if self.at is None:
            return None, None
        return self.fsm_id, self.clock() - self.at


def make_guarded(fsm_id=500, **kw):
    clock = FakeClock()
    src = FsmSource(clock, fsm_id)
    ctrl, clock, state, logs = make(clock=clock, fsm_source=src, require_fsm=True, **kw)
    return ctrl, clock, state, logs, src


def run_fresh(ctrl, clock, src, seconds, action=None):
    """run(), with the FSM monitor refreshing its reading every 0.5 s."""
    frames = []
    steps = int(round(seconds / DT))
    for k in range(steps):
        if k % 25 == 0:
            src.set(src.fsm_id)
        frames += run(ctrl, clock, DT, action)
    return frames


def test_arm_needs_measured_balance():
    ctrl, _, _, _, src = make_guarded(fsm_id=1)
    status, body = ctrl.arm()
    assert status == 409 and body["error"] == "not_in_balance" and body["fsm_id"] == 1
    src.set(4)
    assert ctrl.arm()[1]["error"] == "not_in_balance"
    src.set(500)
    assert ctrl.arm()[0] == 200


def test_arm_refuses_a_stale_fsm_reading():
    ctrl, clock, _, _, src = make_guarded()
    clock.advance(1.6)
    status, body = ctrl.arm()
    assert status == 409 and body["error"] == "fsm_unknown"
    src.at = None
    assert ctrl.arm()[1]["error"] == "fsm_unknown"


def test_arm_without_a_source_but_required_is_fsm_unknown():
    ctrl, _, _, _ = make(require_fsm=True)
    status, body = ctrl.arm()
    assert status == 409 and body["error"] == "fsm_unknown"
    assert "G1_LOCO_ENABLED=fsm" in body["detail"] and "G1_ARM_ALLOW_UNKNOWN_FSM" in body["detail"]


def test_arm_without_a_source_and_not_required_arms_as_before():
    ctrl, _, _, _ = make()
    assert ctrl.arm()[0] == 200
    assert ctrl.snapshot()["fsm"] == {"id": None, "age_s": None}


def test_801_counts_as_balance_only_when_configured():
    ctrl, _, _, _, _ = make_guarded(fsm_id=801)
    assert ctrl.arm()[1]["error"] == "not_in_balance"
    ctrl, _, _, _, _ = make_guarded(fsm_id=801, balance_ids=(500, 801))
    assert ctrl.arm()[0] == 200


def test_leaving_balance_disarms():
    ctrl, clock, _, logs, src = make_guarded()
    hold = {LEFT_ELBOW: FakeState().body[LEFT_ELBOW_IDX]}
    assert ctrl.arm()[0] == 200
    run_fresh(ctrl, clock, src, 2.0, hold)
    assert ctrl.snapshot()["armed"] is True
    src.set(1)                       # someone damped the robot
    run(ctrl, clock, DT, hold)
    snap = ctrl.snapshot()
    assert snap["armed"] is False and snap["last_disarm_reason"] == "left_balance"
    # ...and /arm stays refused while it is out of balance: no re-arm loop.
    assert ctrl.arm()[1]["error"] == "not_in_balance"


def test_a_stale_fsm_reading_disarms_after_two_seconds():
    ctrl, clock, _, _, src = make_guarded()
    hold = {LEFT_ELBOW: FakeState().body[LEFT_ELBOW_IDX]}
    assert ctrl.arm()[0] == 200
    run(ctrl, clock, 1.9, hold)
    assert ctrl.snapshot()["armed"] is True     # 1.9 s old: not yet
    run(ctrl, clock, 0.2, hold)
    snap = ctrl.snapshot()
    assert snap["armed"] is False and snap["last_disarm_reason"] == "fsm_stale"


def test_tracking_error_fires_only_after_the_hold_time():
    ctrl, clock, state, logs, src = make_guarded()
    hold = {LEFT_ELBOW: state.body[LEFT_ELBOW_IDX]}
    assert ctrl.arm()[0] == 200
    run_fresh(ctrl, clock, src, 1.7, hold)      # through the 1.5 s ramp
    assert ctrl.snapshot()["arm_state"] == "armed"
    state.body[LEFT_ELBOW_IDX] += 0.5           # the arm is not where we command it
    run_fresh(ctrl, clock, src, 0.2, hold)
    snap = ctrl.snapshot()
    assert snap["armed"] is True
    assert snap["track_err_rad"] == pytest.approx(0.5, abs=1e-3)
    assert snap["track_err_joint"] == LEFT_ELBOW
    run_fresh(ctrl, clock, src, 0.2, hold)
    snap = ctrl.snapshot()
    assert snap["armed"] is False and snap["last_disarm_reason"] == "tracking_error"
    assert any("tracking error" in m and LEFT_ELBOW in m for m in logs)


def test_tracking_error_resets_when_the_gap_closes():
    ctrl, clock, state, _, src = make_guarded()
    hold = {LEFT_ELBOW: state.body[LEFT_ELBOW_IDX]}
    assert ctrl.arm()[0] == 200
    run_fresh(ctrl, clock, src, 1.7, hold)
    for _ in range(3):
        state.body[LEFT_ELBOW_IDX] += 0.5
        run_fresh(ctrl, clock, src, 0.2, hold)
        state.body[LEFT_ELBOW_IDX] -= 0.5
        run_fresh(ctrl, clock, src, 0.1, hold)
    snap = ctrl.snapshot()
    assert snap["armed"] is True and snap["track_err_rad"] < 0.01


def test_tracking_error_is_ignored_during_the_arm_ramp():
    ctrl, clock, state, _, src = make_guarded()
    hold = {LEFT_ELBOW: state.body[LEFT_ELBOW_IDX]}
    assert ctrl.arm()[0] == 200
    state.body[LEFT_ELBOW_IDX] += 0.8           # e.g. the weight is still blending
    run_fresh(ctrl, clock, src, 1.0, hold)
    snap = ctrl.snapshot()
    assert snap["armed"] is True and snap["track_err_rad"] is None


def test_snapshot_carries_the_task_398_fields():
    ctrl, clock, _, _, src = make_guarded()
    clock.advance(0.25)
    snap = ctrl.snapshot()
    assert snap["fsm"] == {"id": 500, "age_s": 0.25}
    assert snap["track_err_rad"] is None and snap["track_err_joint"] is None


def test_wait_frames_returns_after_the_next_tick():
    ctrl, clock, _, _ = make()
    assert ctrl.wait_frames(1, timeout_s=0.01) is True    # nothing publishing
    assert ctrl.arm()[0] == 200
    assert ctrl.wait_frames(1, timeout_s=0.02) is False   # no publish thread
    t = threading.Thread(target=lambda: (time.sleep(0.02), ctrl.tick()))
    t.start()
    assert ctrl.wait_frames(1, timeout_s=1.0) is True
    t.join()
