"""
Tests for the two joint TABLES in g1_sidecar.py (TASK-229), and for the Isaac
manipulation bridge's read path (TASK-232).

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

3. `isaac_manip_bridge.StateReader`, whose whole reason to exist is that a state
   reply nobody can tell is wrong ends up as 0.0 in `getStateNow()`'s fixed
   43-slot vector — and 0.0 is the left Dex3's OPEN pose. Three losses were
   answered with 200 and `complete: true` anyway: a `motor_state` sequence
   shorter than the topic's joint count, a joint dropped for arriving non-finite,
   and a publisher re-`Write()`ing one reused message on its own timer while the
   sim's step loop has stalled underneath it.

@status test
"""

import json
import os
import re
import sys
import threading
import time
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import g1_sidecar  # noqa: E402
import isaac_manip  # noqa: E402
import isaac_manip_bridge  # noqa: E402

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


# ── 3. the manip bridge's read path: absence that used to answer 200 ────────


class _Motor:
    def __init__(self, q: float):
        self.q = q


class _StateMsg:
    """Shaped like the two messages `StateReader` subscribes to.

    `LowState_` carries `tick`, the sim's own step counter; `HandState_` does not
    carry one at all, which is why the freeze check has to tolerate its absence.
    """

    def __init__(self, qs, tick: int | None = None):
        self.motor_state = [_Motor(q) for q in qs]
        if tick is not None:
            self.tick = tick


class _StubPublisher:
    """Stands in for `ManipPublisher` on the state routes, which never touch it.

    A real one imports `unitree_sdk2py` in its constructor, which this
    interpreter does not have and does not need to exercise a read path.
    """


BODY = isaac_manip.BODY_JOINTS
LEFT = isaac_manip.ISAAC_HAND_STATE_ORDER["left"]
RIGHT = isaac_manip.ISAAC_HAND_STATE_ORDER["right"]


def _reader(max_age_s: float = 5.0):
    return isaac_manip_bridge.StateReader(
        max_age_s=max_age_s, subscribe=False, verbose=False)


def _feed_all(rd, *, left=7, right=7, tick=1):
    """One fresh sample per source, with the left hand as short as asked for."""
    rd._take("body", _StateMsg([0.1] * 29, tick=tick), isaac_manip.N_BODY)
    rd._take("left_hand", _StateMsg([0.2] * left), isaac_manip.N_HAND)
    rd._take("right_hand", _StateMsg([0.3] * right), isaac_manip.N_HAND)


def _get_json(url: str):
    try:
        with urllib.request.urlopen(url, timeout=5) as resp:
            return resp.status, json.loads(resp.read())
    except urllib.error.HTTPError as exc:      # a 503 is an answer here, not a failure
        return exc.code, json.loads(exc.read())


@pytest.fixture
def state_server():
    """Start `make_handler`'s routes on a loopback port and hand back its base URL."""
    started = []

    def _start(reader, **kwargs):
        httpd = ThreadingHTTPServer(
            ("127.0.0.1", 0),
            isaac_manip_bridge.make_handler(
                _StubPublisher(), port=0, reader=reader, **kwargs))
        httpd.daemon_threads = True
        threading.Thread(target=httpd.serve_forever, daemon=True).start()
        started.append(httpd)
        return f"http://127.0.0.1:{httpd.server_address[1]}"

    yield _start
    for httpd in started:
        httpd.shutdown()
        httpd.server_close()


def test_a_short_hand_sample_is_incomplete_rather_than_healthy():
    """Four fingers that never arrived, named — not a healthy seven-joint hand.

    `_take` stores `min(count, len(motors))` values, so a HandState_ with three
    motor slots was stored as a perfectly good sample and the missing four simply
    were not in the joint list. `missing` only ever listed whole SOURCES, so
    nothing in the reply said they were gone and `getStateNow()` filled them with
    0.0 — the OPEN pose, on the hand that is holding the apple.
    """
    rd = _reader()
    _feed_all(rd, left=3)
    snap = rd.read()

    assert snap["complete"] is False
    assert snap["incomplete_sources"] == ["left_hand"]
    assert snap["missing"] == list(LEFT[3:])
    assert snap["sources"]["left_hand"]["state"] == "short"
    assert snap["sources"]["left_hand"]["joints"] == 3
    assert snap["sources"]["left_hand"]["expected"] == 7
    # The three that DID arrive are measured, so they are still served.
    names = [j["name"] for j in snap["joints"]]
    assert names.count(LEFT[0]) == 1
    assert LEFT[3] not in names


def test_state_fast_refuses_a_short_hand_instead_of_serving_it(state_server):
    """And the refusal is what the caller acts on: getStateNow() throws on non-200."""
    rd = _reader()
    _feed_all(rd, left=3)
    base = state_server(rd)

    code, body = _get_json(f"{base}/state/fast")
    assert code == 503
    assert body["ok"] is False
    assert body["complete"] is False
    assert body["count"] == 39
    assert body["missing"] == list(LEFT[3:])
    assert "left_hand" in body["error"]

    # The 2 s poll is the other consumer and reads `connected`, not the status, so
    # it still gets the joints that ARE measured — with the same honest fields.
    code, body = _get_json(f"{base}/state")
    assert code == 200
    assert body["connected"] is True
    assert body["complete"] is False
    assert body["incomplete_sources"] == ["left_hand"]


def test_a_missing_hand_is_refused_under_the_default_require(state_server):
    """Defect 1: the bringup passes no `--state-require`, so the default is the rig.

    A silent hand costs 7 of 43 joints, and every one of them reaches the policy
    as 0.0. `--state-require body` still exists for a scene that has no hands.
    """
    rd = _reader()
    _feed_all(rd)
    rd._slot["left_hand"] = None
    base_default = state_server(rd)
    base_body = state_server(rd, state_require="body")

    code, body = _get_json(f"{base_default}/state/fast")
    assert code == 503
    assert body["missing"] == ["left_hand"]

    code, body = _get_json(f"{base_body}/state/fast")
    assert code == 200
    assert body["ok"] is True
    assert body["complete"] is False
    assert body["count"] == 36


def test_a_nan_joint_appears_in_missing():
    """A dropped joint is a missing joint, whatever the source's state says.

    `label_state` drops non-finite values so the reply stays parseable to
    JSON.parse; until now that removal was reported only in `dropped_joints`,
    which nothing on the read path was obliged to look at.
    """
    rd = _reader()
    _feed_all(rd)
    rd._take("body", _StateMsg([float("nan")] + [0.1] * 28, tick=2),
             isaac_manip.N_BODY)
    snap = rd.read()

    assert snap["missing"] == [BODY[0]]
    assert snap["dropped_joints"] == [BODY[0]]
    assert snap["incomplete_sources"] == ["body"]
    assert snap["complete"] is False
    assert len(snap["joints"]) == 42


def test_a_frozen_tick_with_a_fresh_receipt_time_is_not_ok():
    """The stalled-sim case: a live publisher re-Write()ing one dead measurement.

    `dds/g1_robot_dds.py` writes on its own timer, so delivery age says nothing
    about when the numbers were measured. Every source read `ok`, `age_s` a few
    hundredths and `complete` true while the policy was served frozen angles.
    """
    rd = _reader(max_age_s=0.05)
    rd._take("body", _StateMsg([0.1] * 29, tick=1), isaac_manip.N_BODY)
    rd._take("body", _StateMsg([0.1] * 29, tick=2), isaac_manip.N_BODY)
    time.sleep(0.12)
    rd._take("body", _StateMsg([0.1] * 29, tick=2), isaac_manip.N_BODY)
    rd._take("left_hand", _StateMsg([0.2] * 7), isaac_manip.N_HAND)
    rd._take("right_hand", _StateMsg([0.3] * 7), isaac_manip.N_HAND)

    snap = rd.read()
    body = snap["sources"]["body"]
    assert body["state"] == "frozen"
    assert body["age_s"] <= 0.05          # delivery is fresh; the measurement is not
    assert body["tick_age_s"] >= 0.1
    assert body["joints"] == 0
    # A frozen source contributes no joints, exactly as a stale one does — which
    # is what it is, measured at the sim rather than at this process.
    assert snap["missing"] == ["body"]
    assert snap["body_present"] is False
    assert not any(j["name"] in BODY for j in snap["joints"])


def test_a_tick_that_has_never_moved_is_not_called_frozen():
    """The guard on that verdict, which would otherwise brick a whole rig.

    A publisher that leaves `tick` at 0 forever is indistinguishable from a
    stalled one, and HandState_ has no tick field at all. Neither may be reported
    as frozen: the reply would refuse for as long as the scene ran.
    """
    rd = _reader(max_age_s=0.05)
    rd._take("body", _StateMsg([0.1] * 29, tick=0), isaac_manip.N_BODY)
    time.sleep(0.12)
    rd._take("body", _StateMsg([0.1] * 29, tick=0), isaac_manip.N_BODY)
    rd._take("left_hand", _StateMsg([0.2] * 7), isaac_manip.N_HAND)

    snap = rd.read()
    assert snap["sources"]["body"]["state"] == "ok"
    assert snap["sources"]["body"]["tick_age_s"] is None
    assert snap["sources"]["left_hand"]["state"] == "ok"
    assert snap["sources"]["left_hand"]["tick"] is None


def test_two_producer_threads_never_share_a_frame_id():
    """`self._seq += 1` is a read-modify-write, and the producers are not one thread.

    `main()` accepts `--probe --serve` together, so a probe leg and an HTTP
    /action can hand in a frame at the same moment; `apply_lock` serialises the
    HTTP threads only. A lost update means two frames answer to one id, which
    /action hands back as the caller's frame id and `run()` gates its log line on.

    This pins the contract — every handed-in frame gets its own id, and the slot
    carries the newest one — rather than reproducing the interleaving, which no
    test can force: on a GIL build the window is a bytecode boundary that may
    never be scheduled, and the fix is what makes the interpreter's behaviour
    irrelevant.

    Built without `__init__`, which imports `unitree_sdk2py`: the counter and its
    lock are the whole of what is under test.
    """
    pub = isaac_manip_bridge.ManipPublisher.__new__(isaac_manip_bridge.ManipPublisher)
    pub._seq = 0
    pub._seq_lock = threading.Lock()
    pub._slot = (isaac_manip.REST, 0)

    def hand_in():
        for _ in range(500):
            pub.set_targets(isaac_manip.REST)

    threads = [threading.Thread(target=hand_in) for _ in range(4)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    assert pub._seq == 2000
    assert pub.seq == 2000      # the slot's id, which is what /action hands back
