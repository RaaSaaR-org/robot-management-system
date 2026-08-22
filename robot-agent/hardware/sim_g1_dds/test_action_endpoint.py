"""Unit tests for the sidecar-compatible `/action` path in sim_node.py.

No DDS and no MuJoCo scene: `SimNode.send_action` and friends are called
unbound against a stub that supplies only the fields they touch, so the
contract can be pinned down in milliseconds instead of a 10 s scene load.
Publishing is captured rather than sent.

    python -m pytest robot-agent/hardware/sim_g1_dds/test_action_endpoint.py

What these protect:

* **The clamp and the ramp.** `/action` is the one path VR teleop uses to move
  a real G1's arms. `g1_sidecar.py` clamps every target to the joint's real
  limits and advances it by at most one step per call; a simulator that let a
  setpoint jump would make a teleop rig feel right in sim and slam the robot.
* **Joints nobody named keep their pose.** arm_sdk carries all 29 body joints in
  one message. Building that message from only the joints in the request would
  command the legs and waist to 0 — a robot asked to lift an arm would instead
  rearrange its whole body.
* **Rejecting unknown joints.** A typo'd or renamed joint that is silently
  skipped is how half an arm stops moving while everything still reports OK.
* **Letting go.** An operator who disconnects, or a client that dies mid-motion,
  must not leave the sim pinned under a publisher that is gone — but must also
  not make the arms drop.
"""
from __future__ import annotations

import math
import sys
import threading
from pathlib import Path

import pytest

# `sim_node` pulls in mujoco AND unitree_sdk2py at module scope, so a bare
# `import sim_node` here is a COLLECTION error on a machine that has one and not
# the other -- and `scripts/test-all.sh` gates this directory on `import mujoco`
# alone. Without this guard that machine turns a stage designed to report SKIPPED
# into one that reports FAILED for a reason that has nothing to do with the code.
# Same guard, same reason, as `test_lidar.py`.
sys.path.insert(0, str(Path(__file__).resolve().parent))
sim_node = pytest.importorskip("sim_node")
from joints import BODY, LHAND, N_BODY, RHAND

L_SHOULDER = BODY.index("left_shoulder_pitch_joint")
L_ELBOW = BODY.index("left_elbow_joint")
STEP = sim_node.ACTION_MAX_STEP


class FakeData:
    def __init__(self, qpos):
        self.qpos = qpos


class FakeNode:
    """Only the fields `send_action` and friends actually read."""

    def __init__(self, rest=0.0):
        n = N_BODY + len(LHAND) + len(RHAND)
        self.data = FakeData([rest] * n)
        self.qadr = {
            "body": list(range(N_BODY)),
            "lh": list(range(N_BODY, N_BODY + len(LHAND))),
            "rh": list(range(N_BODY + len(LHAND), n)),
        }
        self.body_limits = [(-2.0, 2.0)] * N_BODY
        self.hand_limits = {"lh": [(-1.0, 1.0)] * len(LHAND),
                            "rh": [(-1.0, 1.0)] * len(RHAND)}
        self.lock = threading.Lock()
        self._action_cmd = None
        self._action_hand = {}
        self._action_at = 0.0
        self._arm_weight = 0.0
        self.published: list[tuple] = []

    # Stand-in for the writer-thread hand-off.
    def _enqueue_arm(self, body, weight, hands):
        self.published.append((None if body is None else list(body), weight,
                               {k: list(v) for k, v in hands.items()}))
        self._arm_weight = weight   # the writer thread's confirmation, inlined

    send_action = sim_node.SimNode.send_action
    release_action = sim_node.SimNode.release_action
    expire_action = sim_node.SimNode.expire_action


def drive(node, action, calls):
    """Call /action `calls` times with the same target, as a real client does."""
    last = None
    for _ in range(calls):
        last = node.send_action(action)
    return last


class TestValidation:
    @pytest.mark.parametrize("body", [{}, [], "nope", None])
    def test_rejects_a_body_that_is_not_a_joint_map(self, body):
        code, out = FakeNode().send_action(body)
        assert code == 400 and out["ok"] is False

    def test_rejects_an_unknown_joint_instead_of_skipping_it(self):
        code, out = FakeNode().send_action({"elbow": 0.5})
        assert code == 400
        assert "unknown joint 'elbow'" in out["error"]

    def test_rejects_a_partly_valid_request_whole(self):
        node = FakeNode()
        code, _ = node.send_action({"left_elbow_joint": 0.1, "nope": 0.2})
        assert code == 400
        # Nothing was published: the request is refused, not half-applied.
        assert node.published == []

    @pytest.mark.parametrize("value", ["0.5", True, None, float("nan"), float("inf")])
    def test_rejects_a_target_that_is_not_a_finite_number(self, value):
        code, out = FakeNode().send_action({"left_elbow_joint": value})
        assert code == 400 and out["ok"] is False


class TestRampAndClamp:
    def test_one_call_moves_at_most_one_step(self):
        node = FakeNode()
        code, out = node.send_action({"left_elbow_joint": 2.0})
        assert code == 200
        assert out["converged"] is False
        assert node.published[-1][0][L_ELBOW] == pytest.approx(STEP)

    def test_repeated_calls_converge_on_the_target(self):
        node = FakeNode()
        out = drive(node, {"left_elbow_joint": 0.5}, calls=int(0.5 / STEP) + 2)
        assert out[1]["converged"] is True
        assert node.published[-1][0][L_ELBOW] == pytest.approx(0.5)

    def test_a_target_beyond_the_limit_stops_at_the_limit(self):
        node = FakeNode()
        drive(node, {"left_elbow_joint": 99.0}, calls=int(2.0 / STEP) + 5)
        assert node.published[-1][0][L_ELBOW] == pytest.approx(2.0)

    def test_the_ramp_runs_both_ways(self):
        node = FakeNode()
        drive(node, {"left_elbow_joint": -99.0}, calls=int(2.0 / STEP) + 5)
        assert node.published[-1][0][L_ELBOW] == pytest.approx(-2.0)

    def test_it_ramps_from_the_live_pose_not_from_zero(self):
        # Seeding from a fabricated 0 would command a large jump away from where
        # the robot actually stands on the very first call.
        node = FakeNode(rest=1.0)
        node.send_action({"left_elbow_joint": 1.0})
        assert node.published[-1][0][L_ELBOW] == pytest.approx(1.0)

    def test_joints_nobody_named_keep_their_pose(self):
        node = FakeNode(rest=0.7)
        node.send_action({"left_elbow_joint": 0.7})
        body = node.published[-1][0]
        assert len(body) == N_BODY
        assert all(q == pytest.approx(0.7) for q in body)

    def test_a_second_request_does_not_undo_the_first(self):
        node = FakeNode()
        drive(node, {"left_elbow_joint": 0.2}, calls=int(0.2 / STEP) + 2)
        node.send_action({"left_shoulder_pitch_joint": -0.5})
        body = node.published[-1][0]
        assert body[L_ELBOW] == pytest.approx(0.2)
        assert body[L_SHOULDER] == pytest.approx(-STEP)


class TestHands:
    def test_a_finger_joint_goes_out_on_its_own_side(self):
        node = FakeNode()
        node.send_action({"left_hand_thumb_1_joint": 1.0})
        _, _, hands = node.published[-1]
        assert set(hands) == {"lh"}
        assert hands["lh"][LHAND.index("left_hand_thumb_1_joint")] == pytest.approx(STEP)

    def test_arm_and_both_hands_travel_in_one_request(self):
        node = FakeNode()
        node.send_action({"left_elbow_joint": 1.0,
                          "left_hand_thumb_1_joint": 1.0,
                          "right_hand_index_1_joint": 1.0})
        body, _, hands = node.published[-1]
        assert body[L_ELBOW] == pytest.approx(STEP)
        assert set(hands) == {"lh", "rh"}
        assert hands["rh"][RHAND.index("right_hand_index_1_joint")] == pytest.approx(STEP)

    def test_finger_targets_are_clamped_to_the_finger_limits(self):
        node = FakeNode()
        drive(node, {"left_hand_thumb_1_joint": 9.0}, calls=int(1.0 / STEP) + 5)
        assert node.published[-1][2]["lh"][LHAND.index("left_hand_thumb_1_joint")] \
            == pytest.approx(1.0)


class TestLettingGo:
    def test_estop_releases_authority_and_forgets_the_ramp(self):
        node = FakeNode()
        node.send_action({"left_elbow_joint": 1.0})
        code, out = node.release_action()
        assert code == 200 and out["released"] is True
        assert node.published[-1][1] == 0.0
        assert node._action_cmd is None

    def test_estop_on_an_idle_sim_is_a_no_op(self):
        node = FakeNode()
        code, out = node.release_action()
        assert code == 200 and out["released"] is False
        assert node.published == []

    def test_the_next_operator_ramps_from_the_live_pose_again(self):
        node = FakeNode()
        node.send_action({"left_elbow_joint": 1.0})
        node.release_action()
        node.data.qpos[L_ELBOW] = 0.9          # where the robot was left
        node.send_action({"left_elbow_joint": 0.9})
        assert node.published[-1][0][L_ELBOW] == pytest.approx(0.9)

    def test_a_live_stream_is_not_expired(self):
        node = FakeNode()
        node.send_action({"left_elbow_joint": 1.0})
        before = len(node.published)
        node.expire_action()
        assert len(node.published) == before
        assert node._action_cmd is not None

    def test_a_stream_that_stops_hands_the_joints_back(self):
        node = FakeNode()
        node.send_action({"left_elbow_joint": 1.0})
        node._action_at -= sim_node.ACTION_IDLE_RELEASE_S + 0.1
        assert node._arm_weight == 1.0
        node.expire_action()
        assert node._action_cmd is None
        assert node.published[-1][1] == 0.0

    def test_expiry_on_an_idle_sim_publishes_nothing(self):
        node = FakeNode()
        node.expire_action()
        assert node.published == []


class TestWriterQueue:
    """`_enqueue_arm` is newest-wins, except for a release."""

    def make(self):
        node = FakeNode()
        node._arm_q = sim_node.queue.Queue(maxsize=2)
        node._arm_dropped = 0
        node._enqueue_arm = sim_node.SimNode._enqueue_arm.__get__(node)
        return node

    def test_a_backlog_drops_the_stale_setpoint_not_the_fresh_one(self):
        node = self.make()
        for i in range(6):
            node._enqueue_arm([float(i)] * N_BODY, 1.0, {})
        assert node._arm_q.qsize() == 2
        assert node._arm_dropped == 4
        newest = [node._arm_q.get()[0][0] for _ in range(2)]
        assert newest[-1] == 5.0          # the most recent command survived

    def test_enqueueing_never_blocks_even_with_no_writer_draining(self):
        # This runs on the physics thread. A blocking put would stall the
        # simulation behind a DDS write.
        node = self.make()
        for i in range(20):
            node._enqueue_arm([float(i)] * N_BODY, 1.0, {})
        node._enqueue_arm(None, 0.0, {})   # must return, not wait for room
        assert node._arm_q.qsize() <= 2

    def test_a_dropped_release_is_re_asked_until_it_reaches_the_wire(self):
        node = FakeNode()
        node.send_action({"left_elbow_joint": 1.0})
        node._arm_weight = 1.0             # authority is live on the wire
        node._action_at -= sim_node.ACTION_IDLE_RELEASE_S + 0.1
        node.expire_action()               # first attempt
        assert node.published[-1][1] == 0.0
        # Pretend that release was dropped under load: the wire still says 1.0.
        node._arm_weight = 1.0
        before = len(node.published)
        node.expire_action()
        assert len(node.published) == before + 1
        assert node.published[-1][1] == 0.0

    def test_it_stops_re_asking_once_the_release_is_confirmed(self):
        node = FakeNode()
        node.send_action({"left_elbow_joint": 1.0})
        node._action_at -= sim_node.ACTION_IDLE_RELEASE_S + 0.1
        node.expire_action()               # publishes, sets _arm_weight = 0.0
        before = len(node.published)
        for _ in range(5):
            node.expire_action()
        assert len(node.published) == before


def test_the_sim_ramp_matches_the_sidecar_contract():
    # Both read the same environment variables and derive the step the same way;
    # if they ever drift, a plan tuned in sim moves at a different rate on the
    # robot. See g1_sidecar.py `_MAX_STEP`.
    assert sim_node.ACTION_MAX_STEP == pytest.approx(
        sim_node.ACTION_MAX_JOINT_VEL / sim_node.ACTION_CONTROL_HZ)
    assert math.isclose(sim_node.ACTION_CONTROL_HZ, 50.0)
    assert math.isclose(sim_node.ACTION_MAX_JOINT_VEL, 1.0)
