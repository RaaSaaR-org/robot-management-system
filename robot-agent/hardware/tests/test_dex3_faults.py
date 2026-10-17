"""
@file test_dex3_faults.py
@description The Dex3 fault decoder, the read-only bridge's new fields and its
             loopback bind (TASK-404) — fake DDS objects, no robot, no network.
@feature hardware

@status test
"""

import importlib.util
import os
import sys
import types
from types import SimpleNamespace as NS

import pytest

HW = os.path.join(os.path.dirname(__file__), "..")
sys.path.insert(0, HW)

import dex3_faults  # noqa: E402

# --------------------------------------------------------------- the decoder


def test_0x200_on_the_right_thumb_1_is_reported_with_its_joint_name():
    words = [0, 0x200, 0, 0, 0, 0, 0]
    out = dex3_faults.decode_hand("right", [0, 0], words)
    assert out["error"] == [0, 0]
    assert out["motor_faults"] == [{
        "motor": 1,
        "joint": "right_hand_thumb_1_joint",
        "code": "0x200",
        "bits": ["0x200:latched"],
    }]


def test_all_zero_words_are_no_faults():
    out = dex3_faults.decode_hand("left", [0, 0], [0] * 7)
    assert out == {"error": [0, 0], "motor_faults": []}


def test_unknown_bits_are_reported_as_hex_never_dropped():
    out = dex3_faults.decode_hand("left", [1, 0], [0, 0, 0, 0, 0, 0x80000201, 0])
    (fault,) = out["motor_faults"]
    assert fault["code"] == "0x80000201"
    assert fault["bits"] == ["0x1:unknown", "0x200:latched", "0x80000000:unknown"]
    # left wire order lists middle before index: motor 5 is index_0
    assert fault["joint"] == "left_hand_index_0_joint"
    assert out["error"] == [1, 0]


def test_bridge_shaped_motor_dicts_and_missing_words():
    motors = [{"q": 0.1, "motorstate": 0x200}, {"q": 0.2}, {"q": 0.3, "motorstate": 0}]
    out = dex3_faults.decode_hand("left", None, motors)
    assert out["error"] is None
    assert [f["joint"] for f in out["motor_faults"]] == ["left_hand_thumb_0_joint"]


def test_the_wire_table_is_the_one_the_sim_and_the_sidecar_use():
    sys.path.insert(0, os.path.join(HW, "sim_g1_dds"))
    import joints  # sim_g1_dds/joints.py — stdlib only
    import g1_sidecar

    assert dex3_faults.DEX3_WIRE["left"] == joints.LHAND == g1_sidecar.LEFT_HAND_WIRE
    assert dex3_faults.DEX3_WIRE["right"] == joints.RHAND == g1_sidecar.RIGHT_HAND_WIRE


def test_hand_health_shape_for_a_silent_and_a_never_seen_hand():
    data = {"error": [0, 0], "motor_state": [{"q": 0.0, "motorstate": 0x200}], "power_v": 24.5}
    stale = dex3_faults.hand_health("left", data, 3.21234, False)
    assert stale == {
        "present": False, "age_s": 3.212, "error": [0, 0],
        "motor_faults": [{"motor": 0, "joint": "left_hand_thumb_0_joint",
                          "code": "0x200", "bits": ["0x200:latched"]}],
        "power_v": 24.5,
    }
    never = dex3_faults.hand_health("right", None, None, False)
    assert never == {"present": False, "age_s": None, "error": None,
                     "motor_faults": [], "power_v": None}


# ------------------------------------------------------------ sim injection


def test_sim_default_is_both_hands_present_and_fault_free():
    h = dex3_faults.sim_hand_health({})
    for side in ("left", "right"):
        assert h[side]["present"] is True
        assert h[side]["age_s"] == 0.0
        assert h[side]["error"] == [0, 0]
        assert h[side]["motor_faults"] == []


def test_sim_fault_and_missing_env():
    h = dex3_faults.sim_hand_health({"SIM_DEX3_FAULT": "right:thumb_1:0x200",
                                     "SIM_DEX3_MISSING": "left"})
    assert h["right"]["present"] is True
    assert h["right"]["motor_faults"][0]["joint"] == "right_hand_thumb_1_joint"
    assert h["right"]["motor_faults"][0]["code"] == "0x200"
    assert h["left"] == {"present": False, "age_s": None, "error": None,
                         "motor_faults": [], "power_v": None}


@pytest.mark.parametrize("spec", [
    "right:thumb_1", "up:thumb_1:0x200", "right:pinky_0:0x200", "right:thumb_1:zero",
    "right:thumb_1:0", "right:thumb_1:0x100000000",
])
def test_a_bad_fault_spec_fails_loudly(spec):
    with pytest.raises(ValueError):
        dex3_faults.parse_sim_faults(spec)


def test_a_bad_missing_spec_fails_loudly():
    with pytest.raises(ValueError):
        dex3_faults.parse_sim_missing("middle")


# ------------------------------------------------------------- the bridge


class _FakeSock:
    def __init__(self, log):
        self.log = log

    def bind(self, endpoint):
        self.log.append(endpoint)

    def close(self, *a):
        pass


class _Stop(Exception):
    pass


@pytest.fixture
def bridge(monkeypatch):
    """g1_state_bridge_readonly imported against stub zmq / unitree_sdk2py
    modules: no DDS, no socket — the binds are recorded, not made."""
    binds = []
    zmq = types.ModuleType("zmq")
    zmq.PUB = 1
    zmq.NOBLOCK = 1
    zmq.Again = type("Again", (Exception,), {})
    zmq.Socket = object
    ctx = NS(socket=lambda kind: _FakeSock(binds), term=lambda: None)
    zmq.Context = NS(instance=lambda: ctx)

    channel = types.ModuleType("unitree_sdk2py.core.channel")
    channel.ChannelFactoryInitialize = lambda *a: None

    def _subscriber(topic, idl):
        raise _Stop(topic)  # the first subscriber ends main() after the bind
    channel.ChannelSubscriber = _subscriber
    hg = types.ModuleType("unitree_sdk2py.idl.unitree_hg.msg.dds_")
    hg.LowState_ = None
    go = types.ModuleType("unitree_sdk2py.idl.unitree_go.msg.dds_")
    for name, mod in (("zmq", zmq), ("unitree_sdk2py", types.ModuleType("unitree_sdk2py")),
                      ("unitree_sdk2py.core", types.ModuleType("unitree_sdk2py.core")),
                      ("unitree_sdk2py.core.channel", channel),
                      ("unitree_sdk2py.idl", types.ModuleType("unitree_sdk2py.idl")),
                      ("unitree_sdk2py.idl.unitree_hg", types.ModuleType("x")),
                      ("unitree_sdk2py.idl.unitree_hg.msg", types.ModuleType("x")),
                      ("unitree_sdk2py.idl.unitree_hg.msg.dds_", hg),
                      ("unitree_sdk2py.idl.unitree_go", types.ModuleType("x")),
                      ("unitree_sdk2py.idl.unitree_go.msg", types.ModuleType("x")),
                      ("unitree_sdk2py.idl.unitree_go.msg.dds_", go)):
        monkeypatch.setitem(sys.modules, name, mod)
    spec = importlib.util.spec_from_file_location(
        "bridge_under_test", os.path.join(HW, "g1_state_bridge_readonly.py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    mod._binds = binds
    return mod


def test_the_bridge_binds_loopback_by_default(bridge, monkeypatch):
    args = bridge.build_parser().parse_args([])
    assert args.bind == "127.0.0.1"
    assert bridge.pub_endpoint(args) == "tcp://127.0.0.1:6001"
    # ...and main() really binds that, not 0.0.0.0
    monkeypatch.setattr(sys, "argv", ["bridge"])
    with pytest.raises(_Stop):
        bridge.main()
    assert bridge._binds == ["tcp://127.0.0.1:6001"]


def test_the_bridge_bind_is_explicit_to_widen(bridge, monkeypatch):
    args = bridge.build_parser().parse_args(["--bind", "192.168.123.164", "--port", "6011"])
    assert bridge.pub_endpoint(args) == "tcp://192.168.123.164:6011"
    monkeypatch.setattr(sys, "argv", ["bridge", "--bind", "0.0.0.0"])
    with pytest.raises(_Stop):
        bridge.main()
    assert bridge._binds == ["tcp://0.0.0.0:6001"]


def _hand_msg(words, error=(0, 0)):
    motors = [NS(q=0.1 * i, dq=0.0, tau_est=0.0, temperature=[30, 32], motorstate=w)
              for i, w in enumerate(words)]
    return NS(motor_state=motors, error=list(error), power_v=24.0, power_a=0.5)


def test_handstate_to_dict_keeps_error_and_motorstate(bridge):
    d = bridge.handstate_to_dict(_hand_msg([0, 0x200, 0, 0, 0, 0, 0], error=(3, 0)))
    assert d["error"] == [3, 0]
    assert [m["motorstate"] for m in d["motor_state"]] == [0, 0x200, 0, 0, 0, 0, 0]
    assert d["motor_state"][1]["temperature"] == 31.0  # old keys still there
    assert d["power_v"] == 24.0
    out = dex3_faults.decode_hand("right", d["error"], d["motor_state"])
    assert out["motor_faults"][0]["joint"] == "right_hand_thumb_1_joint"


def test_handstate_to_dict_omits_what_an_older_idl_lacks(bridge):
    msg = NS(motor_state=[NS(q=0.0, dq=0.0, tau_est=0.0, temperature=30)])
    d = bridge.handstate_to_dict(msg)
    assert "error" not in d and "motorstate" not in d["motor_state"][0]


def test_lowstate_to_dict_keeps_body_motorstate(bridge):
    motors = [NS(q=0.0, dq=0.0, tau_est=0.0, temperature=[40, 42], motorstate=(4 if i == 3 else 0))
              for i in range(35)]
    imu = NS(quaternion=[1, 0, 0, 0], gyroscope=[0, 0, 0], accelerometer=[0, 0, 9.8],
             rpy=[0, 0, 0], temperature=35)
    msg = NS(motor_state=motors, imu_state=imu, wireless_remote=[0] * 40, mode_machine=5)
    d = bridge.lowstate_to_dict(msg)
    assert d["motor_state"][3]["motorstate"] == 4
    assert d["motor_state"][0]["motorstate"] == 0
    assert set(d["motor_state"][0]) == {"q", "dq", "tau_est", "temperature", "motorstate"}
    assert d["mode_machine"] == 5
