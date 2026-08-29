"""
Tests for the two joint TABLES in g1_sidecar.py (TASK-229).

Both defects these cover are silent: neither raises, neither logs, and both
produce a plausible-looking number for the wrong joint.

1. The Dex3-1 DDS wire order. `rt/dex3/left/state` enumerates the LEFT hand as
   thumb, thumb, thumb, MIDDLE, MIDDLE, INDEX, INDEX while the right hand goes
   index before middle (hardware/sim_g1_dds/joints.py). `HAND_JOINTS` is the
   g1-edu.config.ts order — thumb, index, middle on BOTH sides — and it is a
   set of names, not a motor-index table. Using it as one transposed the left
   hand's index and middle fingers BY NAME on the read path: /state called the
   middle finger's angle the index finger's, four columns of every episode
   recorded off a real G1 were mislabelled, and the observation handed to a VLA
   policy was wrong in precisely the two fingers doing the grasping.

2. POS_LIMITS. The hard clamp send_action applies. Its fourteen hand entries
   were the config's OLD hand-written placeholders and had drifted:
   g1-edu.config.ts now reads its hand limits from G1_FINGER_CHAINS (generated
   out of the MJCF, cross-checked against MuJoCo's jnt_range), and the
   placeholders were SIGN-FLIPPED against them. left_hand_index_1_joint was
   (0.0, 1.7453) where the model says (-1.74533, 0.0) — two ranges meeting at
   the single point 0 — so every flexion command clamped to 0.0 and a commanded
   closed hand arrived as an open one.

@status test
"""

import json
import os
import re
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import g1_sidecar  # noqa: E402

HARDWARE = os.path.join(os.path.dirname(__file__), "..")
REPO_SRC = os.path.join(HARDWARE, "..", "src")
CHAINS_TS = os.path.join(REPO_SRC, "teleop", "g1-chains.generated.ts")
JOINTS_PY = os.path.join(HARDWARE, "sim_g1_dds", "joints.py")


# ── 1. the DDS wire order ───────────────────────────────────────────────────


def _wire_order_from_joints_py(name: str) -> list[str]:
    """Read LHAND / RHAND out of sim_g1_dds/joints.py — the shared source.

    Parsed rather than imported so this test pins the two files against each
    other: joints.py is what sim_node.py translates the wire protocol with, and
    an edit to one that is not made to the other is exactly the drift the
    left/right asymmetry invites.
    """
    src = open(JOINTS_PY, encoding="utf-8").read()
    m = re.search(rf"^{name}: list\[str\] = \[(.*?)\]", src, re.M | re.S)
    assert m, f"{name} not found in {JOINTS_PY}"
    return re.findall(r'"([^"]+)"', m.group(1))


def test_wire_tables_match_the_shared_joints_py():
    assert g1_sidecar.LEFT_HAND_WIRE == _wire_order_from_joints_py("LHAND")
    assert g1_sidecar.RIGHT_HAND_WIRE == _wire_order_from_joints_py("RHAND")


def test_the_left_hand_really_is_middle_before_index():
    """The asymmetry itself, stated so a 'tidy-up' has to argue with a test."""
    left = g1_sidecar.LEFT_HAND_WIRE
    right = g1_sidecar.RIGHT_HAND_WIRE
    assert left.index("left_hand_middle_0_joint") < left.index("left_hand_index_0_joint")
    assert right.index("right_hand_index_0_joint") < right.index("right_hand_middle_0_joint")
    # And the wire order is NOT the config order, which is where the bug came
    # from: HAND_JOINTS looks like a motor table and is not one.
    assert g1_sidecar.LEFT_HAND_WIRE != g1_sidecar.HAND_JOINTS[:7]
    assert sorted(g1_sidecar.LEFT_HAND_WIRE + g1_sidecar.RIGHT_HAND_WIRE) == sorted(
        g1_sidecar.HAND_JOINTS
    )


class _FakeReader:
    """Stands in for _LowStateReader with a scripted cache."""

    def __init__(self, cache: dict):
        self._cache = cache

    def start(self) -> bool:
        return True

    def latest(self, topic: str, max_age_s: float = 2.0):
        return self._cache.get(topic)


@pytest.fixture
def scripted_dds(monkeypatch):
    def _install(cache: dict):
        monkeypatch.setattr(g1_sidecar, "_lowstate_reader", _FakeReader(cache))

    return _install


def test_readonly_state_labels_left_hand_motors_by_the_wire_order(scripted_dds):
    """The regression, at the level the policy sees it.

    Motor 3 of the left hand is middle_0 and motor 5 is index_0. Labelled with
    HAND_JOINTS the two came back swapped, and the swap is invisible: both are
    finger flexion joints with the same sign and a similar range, so the only
    symptom is a policy told the wrong finger is where the other one is.
    """
    left_motors = [
        {"q": 0.01},  # thumb_0
        {"q": 0.02},  # thumb_1
        {"q": 0.03},  # thumb_2
        {"q": -0.69},  # middle_0  ← wire slot 3
        {"q": -0.83},  # middle_1
        {"q": -0.09},  # index_0   ← wire slot 5
        {"q": -0.11},  # index_1
    ]
    right_motors = [{"q": 0.1 * i} for i in range(7)]
    scripted_dds(
        {
            g1_sidecar.TOPIC_LOWSTATE: {"motor_state": [{"q": 0.0}] * 29},
            g1_sidecar.TOPIC_LEFT_HAND: {"motor_state": left_motors},
            g1_sidecar.TOPIC_RIGHT_HAND: {"motor_state": right_motors},
        }
    )

    state = g1_sidecar._get_state_readonly()
    by_name = {j["name"]: j["position"] for j in state["joints"]}

    assert by_name["left_hand_middle_0_joint"] == pytest.approx(-0.69)
    assert by_name["left_hand_index_0_joint"] == pytest.approx(-0.09)
    assert by_name["left_hand_middle_1_joint"] == pytest.approx(-0.83)
    assert by_name["left_hand_index_1_joint"] == pytest.approx(-0.11)
    # The right hand was always right, and stays right.
    assert by_name["right_hand_index_0_joint"] == pytest.approx(0.3)
    assert by_name["right_hand_middle_0_joint"] == pytest.approx(0.5)
    # All 43 present, none invented.
    assert len(state["joints"]) == 43


def test_a_stale_hand_topic_omits_that_side_rather_than_zeroing_it(scripted_dds):
    scripted_dds(
        {
            g1_sidecar.TOPIC_LOWSTATE: {"motor_state": [{"q": 0.0}] * 29},
            g1_sidecar.TOPIC_RIGHT_HAND: {"motor_state": [{"q": 0.0}] * 7},
        }
    )
    names = [j["name"] for j in g1_sidecar._get_state_readonly()["joints"]]
    assert not any(n.startswith("left_hand_") for n in names)
    assert sum(n.startswith("right_hand_") for n in names) == 7


# ── 2. POS_LIMITS against the generated chain table ─────────────────────────


def _hand_limits_from_chains_ts() -> dict[str, tuple[float, float]]:
    """Every `{"joint": …, … "lower": …, "upper": …}` link in the generated TS.

    This is the table g1-edu.config.ts builds its JointConfig from, so it is
    what "keep in sync with g1-edu.config.ts" actually means.
    """
    src = open(CHAINS_TS, encoding="utf-8").read()
    out: dict[str, tuple[float, float]] = {}
    for m in re.finditer(
        r'"joint":\s*"([^"]+)".*?"lower":\s*(-?[\d.eE+]+),\s*"upper":\s*(-?[\d.eE+]+)',
        src,
        re.S,
    ):
        name, lo, hi = m.group(1), float(m.group(2)), float(m.group(3))
        out.setdefault(name, (lo, hi))
    return out


def test_hand_pos_limits_match_the_generated_chain_table():
    chains = _hand_limits_from_chains_ts()
    hand = [n for n in g1_sidecar.JOINT_NAMES if "_hand_" in n]
    assert len(hand) == 14
    missing = [n for n in hand if n not in chains]
    assert not missing, f"not in {CHAINS_TS}: {missing}"
    for name in hand:
        assert g1_sidecar.POS_LIMITS[name] == pytest.approx(chains[name]), name


def test_every_hand_joint_has_usable_travel_in_both_tables():
    """The property the sign-flip destroyed, asserted directly.

    A range and its negation overlap only at 0, which is a legal-looking pair of
    numbers and a joint that cannot move. Both flexion directions must be
    reachable from the open pose (0), so each range has to bracket 0 with real
    travel on the side the finger actually flexes toward.
    """
    for name in [n for n in g1_sidecar.JOINT_NAMES if "_hand_" in n]:
        lo, hi = g1_sidecar.POS_LIMITS[name]
        assert lo <= 0.0 <= hi, name
        assert hi - lo > 0.5, f"{name} has only {hi - lo:.4f} rad of travel"


def test_the_decoders_closed_pose_survives_the_clamp():
    """The end-to-end version: a fully-closed left hand arrives closed.

    These are decodeLeftHandGrip's CLOSE endpoints (src/vla/action-contracts.ts,
    ported from vla-training/eval/hand_grip_decoder.py), in that decoder's LEFT
    slot order. Under the old placeholders middle_1 and index_1 clamped from
    -0.837 / -0.773 all the way to 0.0 — the open pose — which is the exact
    failure (0/15 transports) the decoder exists to remove.
    """
    closed = {
        "left_hand_thumb_0_joint": -0.07438,
        "left_hand_thumb_1_joint": 0.20552,
        "left_hand_thumb_2_joint": 0.47074,
        "left_hand_middle_0_joint": -0.69452,
        "left_hand_middle_1_joint": -0.83696,
        "left_hand_index_0_joint": -0.72598,
        "left_hand_index_1_joint": -0.77278,
    }
    for name, target in closed.items():
        lo, hi = g1_sidecar.POS_LIMITS[name]
        assert min(hi, max(lo, target)) == pytest.approx(target), name


def test_pos_limits_still_covers_every_joint_it_names():
    assert set(g1_sidecar.POS_LIMITS) == set(g1_sidecar.JOINT_NAMES)
    assert json.dumps(sorted(g1_sidecar.POS_LIMITS))  # names are plain strings
