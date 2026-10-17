"""
@file test_g1_sidecar_write_mode.py
@description g1_sidecar.py's write modes over HTTP (TASK-391): read_only stays
             what it was, the lerobot rt/lowcmd path is gone and a config still
             asking for it refuses to start, and arm_sdk routes behave per the
             TASK-391/TASK-393 contract. No DDS — the arm_sdk controller is
             driven with a fake state source.
@feature hardware
@status test
"""

import json
import os
import subprocess
import sys
import threading
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer

import pytest

HW = os.path.join(os.path.dirname(__file__), "..")
sys.path.insert(0, HW)

import g1_arm_sdk as arm_sdk  # noqa: E402
import g1_sidecar  # noqa: E402

CONTRACT_KEYS = {"write_mode", "armed", "arm_weight", "estop_latched", "hands", "teleop_mode"}


@pytest.fixture
def server(monkeypatch):
    """The sidecar's real Handler on an ephemeral port, with no state feed
    (nothing reaches out to a bridge or a robot)."""
    monkeypatch.setattr(g1_sidecar, "_state_latest", lambda topic, max_age_s=2.0: None)
    srv = ThreadingHTTPServer(("127.0.0.1", 0), g1_sidecar.Handler)
    t = threading.Thread(target=srv.serve_forever, daemon=True)
    t.start()
    yield "http://127.0.0.1:%d" % srv.server_address[1]
    srv.shutdown()
    srv.server_close()


def call(base, method, path, body=None):
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(base + path, data=data, method=method,
                                 headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=5) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read())


# ------------------------------------------------------------ configuration

@pytest.mark.parametrize("env,needle", [
    ({}, None),
    ({"G1_READ_ONLY": "1"}, None),
    ({"G1_WRITE_MODE": "read_only"}, None),
    ({"G1_READ_ONLY": "0"}, "rt/lowcmd"),
    ({"G1_WRITE_MODE": "lowcmd"}, "not a mode"),
    ({"G1_WRITE_MODE": "arm_sdk"}, "explicit DDS domain"),
    ({"G1_WRITE_MODE": "arm_sdk", "G1_DDS_DOMAIN": "1"}, None),
    ({"G1_WRITE_MODE": "ARM_SDK", "G1_LIDAR_DDS_DOMAIN": "0"}, None),
    ({"G1_WRITE_MODE": "arm_sdk", "G1_DDS_DOMAIN": "one"}, "not an integer"),
    ({"G1_WRITE_MODE": "arm_sdk", "G1_DDS_DOMAIN": "1", "G1_READ_ONLY": "1"}, "contradicts"),
    ({"G1_WRITE_MODE": "arm_sdk", "G1_DDS_DOMAIN": "1", "G1_READ_ONLY": "0"}, None),
])
def test_write_mode_config(env, needle):
    err = g1_sidecar._write_mode_error(env)
    if needle is None:
        assert err is None
    else:
        assert err is not None and needle in err


def test_dds_domain_and_iface_names():
    assert g1_sidecar._dds_domain_env({}) is None
    assert g1_sidecar._dds_domain_env({"G1_LIDAR_DDS_DOMAIN": "0"}) == "0"
    assert g1_sidecar._dds_domain_env({"G1_DDS_DOMAIN": "1", "G1_LIDAR_DDS_DOMAIN": "0"}) == "1"
    assert g1_sidecar._dds_iface_env({"G1_NET_INTERFACE": "enp131s0"}) == "enp131s0"
    assert g1_sidecar._dds_iface_env({"G1_DDS_IFACE": "lo", "G1_NET_INTERFACE": "enp131s0"}) == "lo"


@pytest.mark.parametrize("env,host", [
    ({}, "0.0.0.0"),
    ({"G1_WRITE_MODE": "read_only"}, "0.0.0.0"),
    ({"G1_WRITE_MODE": "arm_sdk", "G1_DDS_DOMAIN": "1"}, "127.0.0.1"),
    ({"G1_WRITE_MODE": "ARM_SDK", "G1_DDS_DOMAIN": "0"}, "127.0.0.1"),
    ({"G1_WRITE_MODE": "arm_sdk", "G1_SIDECAR_HOST": "0.0.0.0"}, "0.0.0.0"),
])
def test_arm_sdk_listens_on_loopback_unless_told_otherwise(env, host):
    """/arm and /action are unauthenticated: in arm_sdk mode they must not be
    reachable from the lab network by default."""
    assert g1_sidecar._bind_host(env) == host


@pytest.mark.parametrize("env,needle", [
    ({"G1_READ_ONLY": "0"}, "rt/lowcmd"),
    ({"G1_WRITE_MODE": "arm_sdk"}, "explicit DDS domain"),
])
def test_main_refuses_to_start(env, needle):
    """Refused before any socket or DDS participant exists."""
    clean = {k: v for k, v in os.environ.items()
             if not k.startswith("G1_")}
    clean.update(env)
    clean["G1_SIDECAR_PORT"] = "1"  # never reached; a bind here would fail loudly
    out = subprocess.run([sys.executable, "g1_sidecar.py"], cwd=HW, env=clean,
                         capture_output=True, text=True, timeout=30)
    assert out.returncode == 2, out.stdout + out.stderr
    assert "REFUSING TO START" in out.stdout and needle in out.stdout


def test_the_lerobot_lowcmd_driver_is_gone():
    with open(os.path.join(HW, "g1_sidecar.py")) as f:
        src = f.read()
    assert "lerobot.robots" not in src
    assert "UnitreeG1(" not in src
    assert g1_sidecar._connect_unlocked() is False


# ------------------------------------------------------------- read_only

def test_default_is_read_only_with_no_write_path():
    assert g1_sidecar.WRITE_MODE == "read_only"
    assert g1_sidecar.READ_ONLY is True
    assert g1_sidecar._arm_controller is None and g1_sidecar._arm_runner is None


def test_read_only_refuses_every_write(server):
    for path, body in (("/action", {"left_elbow_joint": 0.1}),
                       ("/arm", {"lease_generation": 1}),
                       ("/record/start", {"repo_id": "x/y"})):
        status, reply = call(server, "POST", path, body)
        assert status == 403, path
        assert reply["ok"] is False


def test_read_only_stop_routes_are_harmless_successes(server):
    for path in ("/disarm", "/estop", "/estop/reset"):
        status, reply = call(server, "POST", path, {})
        assert status == 200 and reply["ok"] is True, path
        assert reply["armed"] is False


def test_read_only_health_and_state_carry_the_write_status(server):
    for path in ("/health", "/state"):
        status, reply = call(server, "GET", path)
        assert status == 200
        assert CONTRACT_KEYS <= set(reply), path
        assert reply["write_mode"] == "read_only"
        assert reply["armed"] is False and reply["arm_weight"] == 0.0
        assert reply["hands"] == {"left": False, "right": False}
        assert reply["teleop_mode"] == "arms_only"
    _, health = call(server, "GET", "/health")
    assert health["read_only"] is True and health["connected"] is False


def test_bad_json_is_400(server):
    req = urllib.request.Request(server + "/action", data=b"{nope", method="POST")
    with pytest.raises(urllib.error.HTTPError) as exc:
        urllib.request.urlopen(req, timeout=5)
    assert exc.value.code == 400


# ------------------------------------------------------------- arm_sdk

class _State:
    def __init__(self):
        self.body = [0.02 * i for i in range(29)]
        self.hands = {"left": [0.0] * 7, "right": None}

    def body_q(self, max_age_s):
        return list(self.body)

    def hand_q(self, side, max_age_s):
        h = self.hands[side]
        return None if h is None else list(h)

    def mode_machine(self):
        return 5


@pytest.fixture
def armed_sidecar(server, monkeypatch):
    """The routes wired to a real ArmSdkController (no publish thread, no DDS)."""
    ctrl = arm_sdk.ArmSdkController(
        g1_sidecar.BODY_JOINTS,
        {"left": g1_sidecar.LEFT_HAND_WIRE, "right": g1_sidecar.RIGHT_HAND_WIRE},
        g1_sidecar.POS_LIMITS, _State(), log=lambda m: None)
    monkeypatch.setattr(g1_sidecar, "_arm_controller", ctrl)
    return server, ctrl


def test_arm_sdk_routes_follow_the_contract(armed_sidecar):
    base, ctrl = armed_sidecar
    status, reply = call(base, "POST", "/action", {"left_elbow_joint": 0.3})
    assert status == 409 and reply["error"] == "not_armed"

    status, reply = call(base, "POST", "/arm", {"lease_generation": 12})
    assert status == 200 and reply["armed"] is True
    assert reply["teleop_mode"] == "arms+left_hand"
    assert reply["hands"] == {"left": True, "right": False}

    status, reply = call(base, "POST", "/action",
                         {"left_elbow_joint": 0.3, "left_knee_joint": 0.5})
    assert status == 200 and reply["applied"] == 1
    assert reply["ignored"]["legs_waist"] == 1

    _, health = call(base, "GET", "/health")
    assert health["write_mode"] == "arm_sdk" and health["armed"] is True
    assert health["read_only"] is True  # module flag of THIS test process
    assert CONTRACT_KEYS <= set(health)

    status, reply = call(base, "POST", "/estop", {})
    assert status == 200 and reply["estop_latched"] is True and reply["armed"] is False
    status, reply = call(base, "POST", "/arm", {})
    assert status == 409 and reply["error"] == "estop_latched"
    status, reply = call(base, "POST", "/estop/reset", {})
    assert status == 200 and reply["estop_latched"] is False
    assert call(base, "POST", "/arm", {})[0] == 200
    status, reply = call(base, "POST", "/disarm", {})
    assert status == 200 and reply["was_armed"] is True and reply["armed"] is False


def test_arm_rejects_a_non_integer_lease(armed_sidecar):
    base, _ = armed_sidecar
    for bad in ("7", 1.5, True):
        assert call(base, "POST", "/arm", {"lease_generation": bad})[0] == 400


def test_record_start_is_refused_in_arm_sdk_mode_too(armed_sidecar):
    base, _ = armed_sidecar
    status, reply = call(base, "POST", "/record/start", {"repo_id": "x/y"})
    assert status == 403 and "rt/lowcmd" in reply["error"]
