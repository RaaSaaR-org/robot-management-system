"""
@file test_g1_loco_mode.py
@description The real G1's mode control without the remote (TASK-398), over the
             sidecar's real Handler with a fake LocoClient that records every
             RPC: the G1_LOCO_ENABLED gate, the limp / stand / balance
             transition table, the E-stop's "disarm, then damp", and the
             /health + /state blocks. No DDS, no robot.
@feature hardware

The promise checked here is the one made to the person at the gantry: under
G1_LOCO_ENABLED=fsm nothing can leave this process except SetFsmId(limp |
stand | balance), GetFsmId and GetFsmMode — never a velocity, a gesture or a
raw FSM id — and every change is measured before it is believed.

@status test
"""

import json
import os
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer

import pytest

HW = os.path.join(os.path.dirname(__file__), "..")
sys.path.insert(0, HW)

import g1_arm_sdk as arm_sdk  # noqa: E402
import g1_loco_mode as lm  # noqa: E402
import g1_sidecar  # noqa: E402

ALLOWED_RPCS = {"SetFsmId", "GetFsmId", "_Call"}


class FakeClock:
    def __init__(self):
        self.t = 5000.0

    def __call__(self):
        return self.t

    def advance(self, dt):
        self.t += dt


class FakeLoco:
    """A scripted sport service. `follow` = the robot reaches the commanded
    FSM at once; `stuck` = SetFsmId is accepted but the FSM never changes."""

    def __init__(self, fsm=1):
        self.fsm = fsm
        self.calls = []
        self.lock = threading.Lock()
        self.set_code = 0
        self.get_code = 0
        self.stuck = False
        self.report = None          # report this id instead of the real one
        self.set_delay_s = 0.0

    def _log(self, *call):
        with self.lock:
            self.calls.append(call)

    def SetFsmId(self, fsm_id):
        self._log("SetFsmId", fsm_id)
        if self.set_delay_s:
            time.sleep(self.set_delay_s)
        if self.set_code:
            return self.set_code
        if not self.stuck:
            self.fsm = fsm_id
        return 0

    def GetFsmId(self):
        self._log("GetFsmId")
        if self.get_code:
            return self.get_code, None
        return 0, self.fsm if self.report is None else self.report

    def _Call(self, api_id, parameter):
        self._log("_Call", api_id)
        return 0, json.dumps({"data": self.fsm})

    # Everything below must NEVER be called under the fsm gate.
    def SetVelocity(self, *a):
        self._log("SetVelocity", *a)
        return 0

    def SetTaskId(self, *a):
        self._log("SetTaskId", *a)
        return 0

    def ShakeHand(self, *a):
        self._log("ShakeHand", *a)
        return 0

    def SetStandHeight(self, *a):
        self._log("SetStandHeight", *a)
        return 0

    def names(self):
        with self.lock:
            return [c[0] for c in self.calls]

    def sets(self):
        with self.lock:
            return [c[1] for c in self.calls if c[0] == "SetFsmId"]


class ArmState:
    """Arm-controller state source: a robot standing still."""

    def __init__(self):
        self.body = [0.01 * i for i in range(29)]

    def body_q(self, max_age_s):
        return list(self.body)

    def hand_q(self, side, max_age_s):
        return [0.0] * 7 if side == "left" else None

    def mode_machine(self):
        return 5


def call(base, method, path, body=None):
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(base + path, data=data, method=method,
                                 headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read())


class Rig:
    def __init__(self, base, loco, clock, ctrl):
        self.base = base
        self.loco = loco
        self.clock = clock
        self.ctrl = ctrl

    def poll(self):
        assert g1_sidecar._fsm_monitor.poll_once() is True

    def post_mode(self, mode):
        return call(self.base, "POST", "/loco/mode", {"mode": mode})


def _build(monkeypatch, gate="fsm", with_arms=False, fsm=1, env=None):
    monkeypatch.setattr(g1_sidecar, "_state_latest", lambda topic, max_age_s=2.0: None)
    monkeypatch.setattr(g1_sidecar, "LOCO_GATE", gate)
    monkeypatch.setattr(g1_sidecar, "LOCO_ENABLED", gate == "full")
    monkeypatch.setattr(g1_sidecar, "_base_estop_latched", False)
    monkeypatch.setattr(g1_sidecar, "_loco_client", None)
    monkeypatch.setattr(g1_sidecar, "_loco_client_error", None)
    monkeypatch.setattr(g1_sidecar, "_fsm_monitor", None)
    monkeypatch.setattr(g1_sidecar, "_mode_ctl", None)
    monkeypatch.setattr(g1_sidecar, "_arm_controller", None)
    monkeypatch.setattr(g1_sidecar, "_ensure_dds_factory", lambda: None)
    monkeypatch.setenv("G1_DDS_DOMAIN", "42")
    for k, v in (env or {}).items():
        monkeypatch.setenv(k, v)
    loco = FakeLoco(fsm)
    monkeypatch.setattr(g1_sidecar, "_new_loco_client", lambda: loco)
    clock = FakeClock()
    ctrl = None
    if with_arms:
        ctrl = arm_sdk.ArmSdkController(
            g1_sidecar.BODY_JOINTS,
            {"left": g1_sidecar.LEFT_HAND_WIRE, "right": g1_sidecar.RIGHT_HAND_WIRE},
            g1_sidecar.POS_LIMITS, ArmState(), clock=clock, log=lambda m: None,
            **g1_sidecar._arm_fsm_kwargs())
        monkeypatch.setattr(g1_sidecar, "_arm_controller", ctrl)
    if gate != "off":
        g1_sidecar.start_loco(clock=clock, start_thread=False, confirm_s=0.5,
                              confirm_poll_s=0.01, log=lambda m: None)
        g1_sidecar._fsm_monitor._log = lambda m: None
    return loco, clock, ctrl


@pytest.fixture
def make_rig(monkeypatch):
    servers = []

    def make(**kw):
        loco, clock, ctrl = _build(monkeypatch, **kw)
        srv = ThreadingHTTPServer(("127.0.0.1", 0), g1_sidecar.Handler)
        threading.Thread(target=srv.serve_forever, daemon=True).start()
        servers.append(srv)
        rig = Rig("http://127.0.0.1:%d" % srv.server_address[1], loco, clock, ctrl)
        if kw.get("gate", "fsm") != "off":
            rig.poll()
        return rig

    yield make
    for srv in servers:
        srv.shutdown()
        srv.server_close()


def stand_then_balance(rig):
    assert rig.post_mode("stand")[0] == 200
    rig.clock.advance(2.1)
    rig.poll()
    status, body = rig.post_mode("balance")
    assert status == 200, body
    rig.poll()


# ------------------------------------------------------------ configuration

@pytest.mark.parametrize("raw,gate", [("", "off"), ("0", "off"), ("1", "full"),
                                      ("fsm", "fsm"), (" FSM ", "fsm")])
def test_gate_values(raw, gate):
    assert lm.parse_gate({"G1_LOCO_ENABLED": raw}) == (gate, None)


@pytest.mark.parametrize("raw", ["yes", "true", "2", "full", "fms"])
def test_junk_gate_is_refused(raw):
    gate, err = lm.parse_gate({"G1_LOCO_ENABLED": raw})
    assert gate is None and "not a gate" in err
    assert "not a gate" in g1_sidecar._loco_config_error({"G1_LOCO_ENABLED": raw})


@pytest.mark.parametrize("env,needle", [
    ({}, None),
    ({"G1_LOCO_ENABLED": "0"}, None),
    ({"G1_LOCO_ENABLED": "fsm"}, "explicit DDS domain"),
    ({"G1_LOCO_ENABLED": "1"}, "explicit DDS domain"),
    ({"G1_LOCO_ENABLED": "fsm", "G1_DDS_DOMAIN": "0"}, None),
    ({"G1_LOCO_ENABLED": "fsm", "G1_DDS_DOMAIN": "x"}, "not an integer"),
    ({"G1_LOCO_ENABLED": "fsm", "G1_DDS_DOMAIN": "0", "G1_FSM_ID_STAND": "706"}, None),
    ({"G1_LOCO_ENABLED": "fsm", "G1_DDS_DOMAIN": "0", "G1_FSM_ID_STAND": "500"}, "not allowed"),
    ({"G1_LOCO_ENABLED": "fsm", "G1_DDS_DOMAIN": "0", "G1_FSM_ID_LIMP": "0"}, "fixed"),
    ({"G1_LOCO_ENABLED": "fsm", "G1_DDS_DOMAIN": "0", "G1_FSM_ID_BALANCE": "801"}, "only ever"),
    ({"G1_LOCO_ENABLED": "fsm", "G1_DDS_DOMAIN": "0", "G1_FSM_BALANCE_REPORTED": "500,801"}, None),
    ({"G1_LOCO_ENABLED": "fsm", "G1_DDS_DOMAIN": "0", "G1_FSM_BALANCE_REPORTED": "500,4"}, "subset"),
])
def test_loco_config(env, needle):
    err = g1_sidecar._loco_config_error(env)
    if needle is None:
        assert err is None
    else:
        assert err is not None and needle in err


@pytest.mark.parametrize("env,needle", [
    ({"G1_LOCO_ENABLED": "yes"}, "not a gate"),
    ({"G1_LOCO_ENABLED": "fsm"}, "explicit DDS domain"),
    ({"G1_LOCO_ENABLED": "fsm", "G1_DDS_DOMAIN": "42", "G1_FSM_ID_STAND": "3"}, "not allowed"),
])
def test_main_refuses_to_start(env, needle):
    clean = {k: v for k, v in os.environ.items() if not k.startswith("G1_")}
    clean.update(env)
    clean["G1_SIDECAR_PORT"] = "1"
    out = subprocess.run([sys.executable, "g1_sidecar.py"], cwd=HW, env=clean,
                         capture_output=True, text=True, timeout=30)
    assert out.returncode == 2, out.stdout + out.stderr
    assert "REFUSING TO START" in out.stdout and needle in out.stdout


@pytest.mark.parametrize("env,host", [
    ({"G1_LOCO_ENABLED": "fsm"}, "127.0.0.1"),
    ({"G1_LOCO_ENABLED": "1"}, "127.0.0.1"),
    ({"G1_LOCO_ENABLED": "0"}, "0.0.0.0"),
    ({"G1_LOCO_ENABLED": "fsm", "G1_SIDECAR_HOST": "0.0.0.0"}, "0.0.0.0"),
])
def test_mode_gate_binds_loopback_even_read_only(env, host):
    assert g1_sidecar._bind_host(env) == host


def test_fsm_id_defaults_and_classification():
    ids, err = lm.fsm_config({})
    assert err is None
    assert (ids.limp, ids.stand, ids.balance, ids.balance_reported) == (1, 4, 500, (500,))
    assert [ids.classify(i) for i in (1, 4, 500, 801, 0, 706, None)] == [
        "limp", "stand", "balance", "other", "zero_torque", "other", "unknown"]
    assert lm.FSM_STAND_VERIFIED is False


def test_arm_requires_fsm_on_the_robot_or_with_the_gate():
    assert g1_sidecar._arm_requires_fsm({"G1_DDS_DOMAIN": "0"}) is True
    assert g1_sidecar._arm_requires_fsm({"G1_DDS_DOMAIN": "41"}) is False
    assert g1_sidecar._arm_requires_fsm({"G1_DDS_DOMAIN": "41", "G1_LOCO_ENABLED": "fsm"}) is True
    assert g1_sidecar._arm_requires_fsm({"G1_DDS_DOMAIN": "0",
                                         "G1_ARM_ALLOW_UNKNOWN_FSM": "1"}) is False


# ------------------------------------------------------------ startup

def test_loco_client_is_built_at_startup_never_by_a_request(monkeypatch):
    built = []
    loco = FakeLoco(1)

    def factory():
        built.append(threading.current_thread().name)
        return loco

    _build(monkeypatch, gate="off")
    monkeypatch.setattr(g1_sidecar, "LOCO_GATE", "fsm")
    monkeypatch.setattr(g1_sidecar, "_new_loco_client", factory)
    monkeypatch.setattr(g1_sidecar, "_ensure_dds_factory", lambda: (_ for _ in ()).throw(
        RuntimeError("no DDS yet")))
    g1_sidecar.start_loco(start_thread=False, confirm_s=0.2, confirm_poll_s=0.01,
                          log=lambda m: None)
    assert built == [] and g1_sidecar._loco_client is None
    status, body = g1_sidecar.loco_mode_post({"mode": "limp"})
    assert status == 503 and body["code"] == "rpc_failed" and "no DDS yet" in body["error"]
    assert built == []                     # a request never builds a client
    monkeypatch.setattr(g1_sidecar, "_ensure_dds_factory", lambda: None)
    assert g1_sidecar._build_loco_client() is True   # the monitor's retry
    assert built == [threading.current_thread().name]
    assert g1_sidecar._get_loco_client()[0] is loco


def test_gate_off_builds_nothing(make_rig):
    rig = make_rig(gate="off")
    assert g1_sidecar._loco_client is None and g1_sidecar._fsm_monitor is None
    status, body = rig.post_mode("stand")
    assert status == 403 and body["code"] == "mode_control_disabled"
    assert rig.loco.calls == []


# ------------------------------------------------------------ fsm gate blocks motion

@pytest.mark.parametrize("path,body,code", [
    ("/loco/move", {"vx": 0.0, "vy": 0.0, "omega": 0.3, "duration_s": 1.0}, "loco_move_disabled"),
    ("/loco/move", {}, "loco_move_disabled"),
    ("/loco/action", {"name": "stop"}, "loco_move_disabled"),
    ("/loco/action", {"name": "wave"}, "loco_move_disabled"),
    ("/loco/stand-height", {"preset": "high"}, "loco_move_disabled"),
    ("/loco/fsm", {"id": 500}, "use_loco_mode"),
])
def test_fsm_gate_refuses_every_motion_route(make_rig, path, body, code):
    rig = make_rig()
    status, reply = call(rig.base, "POST", path, body)
    assert status == 403 and reply["code"] == code
    names = rig.loco.names()
    assert "SetVelocity" not in names and "SetTaskId" not in names
    assert set(names) <= ALLOWED_RPCS


def test_only_allowed_rpcs_leave_over_a_whole_session(make_rig):
    rig = make_rig(with_arms=True)
    for path, body in (("/loco/move", {"vx": 0.1, "vy": 0, "omega": 0, "duration_s": 1}),
                       ("/loco/action", {"name": "stop"})):
        call(rig.base, "POST", path, body)
    stand_then_balance(rig)
    call(rig.base, "POST", "/estop", {})
    assert set(rig.loco.names()) <= ALLOWED_RPCS
    assert set(rig.loco.sets()) <= {1, 4, 500}


# ------------------------------------------------------------ transition table

def test_limp_to_stand_to_balance(make_rig):
    rig = make_rig()
    status, body = rig.post_mode("stand")
    assert status == 200 and body["confirmed"] is True and body["fsm_id"] == 4
    assert body["from"] == "limp" and body["mode"] == "stand"
    status, body = rig.post_mode("balance")
    assert status == 409 and body["code"] == "not_settled"
    assert 0 < body["settle_remaining_s"] <= 2.0
    rig.clock.advance(2.1)
    rig.poll()
    status, body = rig.post_mode("balance")
    assert status == 200 and body["fsm_id"] == 500
    assert rig.loco.sets() == [4, 500]


def test_balance_from_limp_is_a_bad_transition(make_rig):
    rig = make_rig()
    status, body = rig.post_mode("balance")
    assert status == 409 and body["code"] == "bad_transition"
    assert body["from"] == "limp" and body["allowed_from"] == ["stand"]
    assert rig.loco.sets() == []


@pytest.mark.parametrize("fsm,mode", [(0, "zero_torque"), (500, "balance"), (706, "other")])
def test_stand_only_from_limp(make_rig, fsm, mode):
    rig = make_rig(fsm=fsm)
    status, body = rig.post_mode("stand")
    assert status == 409 and body["code"] == "bad_transition" and body["from"] == mode
    assert rig.loco.sets() == []


def test_unknown_mode_is_400(make_rig):
    rig = make_rig()
    for bad in ("walk", None, 500):
        status, body = call(rig.base, "POST", "/loco/mode", {"mode": bad})
        assert status == 400 and body["code"] == "unknown_mode"


def test_stale_reading_is_fsm_unknown_but_limp_still_runs(make_rig):
    rig = make_rig()
    rig.clock.advance(1.6)
    st = g1_sidecar.fsm_state()
    assert st["mode"] == "unknown" and st["fsm_id"] is None
    status, body = rig.post_mode("stand")
    assert status == 409 and body["code"] == "fsm_unknown"
    status, body = rig.post_mode("limp")
    assert status == 200 and body["fsm_id"] == 1


def test_sport_service_silent_reads_unknown_with_the_reason(make_rig):
    rig = make_rig()
    rig.loco.get_code = 3104
    assert g1_sidecar._fsm_monitor.poll_once() is False
    rig.clock.advance(1.6)
    st = g1_sidecar.fsm_state()
    assert st["mode"] == "unknown" and "debug mode" in st["error"]


def test_estop_latch_blocks_stand_and_balance_not_limp(make_rig):
    rig = make_rig()
    call(rig.base, "POST", "/estop", {})
    for mode in ("stand", "balance"):
        status, body = rig.post_mode(mode)
        assert status == 409 and body["code"] == "estop_latched", mode
    assert rig.post_mode("limp")[0] == 200


def test_arms_engaged_while_armed_and_while_ramping_out(make_rig):
    rig = make_rig(with_arms=True)
    stand_then_balance(rig)
    status, body = call(rig.base, "POST", "/arm", {"lease_generation": 1})
    assert status == 200, body
    status, body = rig.post_mode("stand")
    assert status == 409 and body["code"] == "arms_engaged" and body["arm_state"] == "arming"
    rig.ctrl.disarm("request")
    rig.ctrl.tick()
    status, body = rig.post_mode("balance")
    assert status == 409 and body["code"] == "arms_engaged" and body["arm_state"] == "disarming"


def test_unconfirmed_change_is_504_with_no_recovery(make_rig):
    rig = make_rig()
    rig.loco.stuck = True
    status, body = rig.post_mode("stand")
    assert status == 504 and body["code"] == "unconfirmed"
    assert body["measured"]["mode"] == "limp"
    assert rig.loco.sets() == [4]           # no automatic recovery action


def test_rpc_failure_is_503_with_the_code(make_rig):
    rig = make_rig()
    rig.loco.set_code = 3104
    status, body = rig.post_mode("stand")
    assert status == 503 and body["code"] == "rpc_failed" and body["rpc_code"] == 3104


def test_one_change_at_a_time_and_limp_preempts(make_rig):
    rig = make_rig()
    rig.loco.stuck = True
    g1_sidecar._mode_ctl.confirm_s = 3.0
    results = {}

    def stand():
        results["stand"] = rig.post_mode("stand")

    t = threading.Thread(target=stand)
    t.start()
    deadline = time.time() + 2
    while g1_sidecar._mode_ctl.in_flight != "stand" and time.time() < deadline:
        time.sleep(0.01)
    status, body = rig.post_mode("stand")
    assert status == 409 and body["code"] == "mode_change_in_flight"
    rig.loco.stuck = False
    t0 = time.time()
    status, body = rig.post_mode("limp")
    assert status == 200 and body["fsm_id"] == 1
    t.join(5)
    assert results["stand"][0] == 409 and results["stand"][1]["code"] == "preempted"
    assert time.time() - t0 < 2.0
    assert rig.loco.sets() == [4, 1]


def test_limp_disarms_first(make_rig):
    rig = make_rig(with_arms=True)
    stand_then_balance(rig)
    assert call(rig.base, "POST", "/arm", {})[0] == 200
    status, body = rig.post_mode("limp")
    assert status == 200
    snap = rig.ctrl.snapshot()
    assert snap["armed"] is False and snap["last_disarm_reason"] == "limp"


# ------------------------------------------------------------ E-stop

def test_estop_disarms_before_it_damps(make_rig):
    rig = make_rig(with_arms=True)
    stand_then_balance(rig)
    assert call(rig.base, "POST", "/arm", {"lease_generation": 3})[0] == 200
    order = []
    real_estop = rig.ctrl.estop
    real_set = rig.loco.SetFsmId

    def estop():
        order.append("controller.estop")
        return real_estop()

    def set_fsm(i):
        order.append("SetFsmId(%d)" % i)
        return real_set(i)

    rig.ctrl.estop = estop
    rig.loco.SetFsmId = set_fsm
    status, body = call(rig.base, "POST", "/estop", {})
    assert status == 200
    assert order == ["controller.estop", "SetFsmId(1)"]
    assert body["latched"] is True and body["was_armed"] is True and body["disarmed"] is True
    assert body["damped"] is True and body["damp_confirmed"] is True and body["damp_error"] is None
    assert body["estop_latched"] is True


def test_read_only_with_the_gate_damps_on_estop(make_rig):
    rig = make_rig(fsm=500)
    status, body = call(rig.base, "POST", "/estop", {})
    assert status == 200 and body["damped"] is True and body["damp_confirmed"] is True
    assert rig.loco.sets() == [1]
    assert body["estop_latched"] is True


def test_estop_with_the_gate_off_says_it_did_not_damp(make_rig):
    rig = make_rig(gate="off")
    status, body = call(rig.base, "POST", "/estop", {})
    assert status == 200 and body["damped"] is False
    assert body["damp_error"] == "mode control disabled (G1_LOCO_ENABLED)"


def test_estop_reset_sends_no_fsm_call_and_leaves_limp(make_rig):
    rig = make_rig(fsm=500)
    call(rig.base, "POST", "/estop", {})
    before = list(rig.loco.calls)
    status, body = call(rig.base, "POST", "/estop/reset", {})
    assert status == 200 and body["was_latched"] is True and body["estop_latched"] is False
    assert [c for c in rig.loco.calls[len(before):] if c[0] == "SetFsmId"] == []
    rig.poll()
    assert g1_sidecar.fsm_state()["mode"] == "limp"
    assert rig.post_mode("stand")[0] == 200


# ------------------------------------------------------------ /health, /state, GET

def test_health_and_state_blocks(make_rig):
    rig = make_rig()
    _, health = call(rig.base, "GET", "/health")
    assert health["loco"] == {"gate": "fsm", "modes": ["limp", "stand", "balance"],
                              "ids": {"limp": 1, "stand": 4, "balance": 500,
                                      "balance_reported": [500]},
                              "ids_verified": False, "move_enabled": False}
    base = health["base"]
    assert base["mode"] == "limp" and base["fsm_id"] == 1 and base["fsm_mode"] == 1
    assert base["source"] == "rpc" and base["age_s"] == 0.0
    _, state = call(rig.base, "GET", "/state")
    assert state["base"]["mode"] == "limp"
    rig.clock.advance(2.0)
    _, state = call(rig.base, "GET", "/state")
    assert state["base"]["fsm_id"] is None and state["base"]["mode"] == "unknown"
    _, got = call(rig.base, "GET", "/loco/mode")
    assert got["ok"] is True and got["mode"] == "unknown" and got["in_flight"] is None
    assert got["loco"]["gate"] == "fsm" and got["estop_latched"] is False


def test_state_has_no_base_block_with_the_gate_off(make_rig):
    rig = make_rig(gate="off")
    _, state = call(rig.base, "GET", "/state")
    assert "base" not in state
    _, health = call(rig.base, "GET", "/health")
    assert health["loco"]["gate"] == "off" and health["loco"]["move_enabled"] is False
    assert health["base"]["mode"] == "unknown"


def test_full_gate_keeps_legacy_motion(make_rig):
    rig = make_rig(gate="full", fsm=500)
    status, body = call(rig.base, "POST", "/loco/move",
                        {"vx": 0.1, "vy": 0.0, "omega": 0.0, "duration_s": 0.5})
    assert status == 200
    assert "SetVelocity" in rig.loco.names()
    _, health = call(rig.base, "GET", "/health")
    assert health["loco"]["move_enabled"] is True


def test_monitor_skips_a_tick_while_the_rpc_lock_is_held(make_rig):
    make_rig()
    with g1_sidecar._loco_rpc_lock:
        assert g1_sidecar._fsm_monitor.poll_once() is None


def test_settle_restarts_when_the_stand_reading_is_interrupted(make_rig):
    rig = make_rig()
    assert rig.post_mode("stand")[0] == 200
    rig.clock.advance(1.5)
    rig.loco.fsm = 1          # the robot fell back into damp by itself
    rig.poll()
    rig.loco.fsm = 4
    rig.poll()
    rig.clock.advance(1.0)
    rig.poll()
    status, body = rig.post_mode("balance")
    assert status == 409 and body["code"] == "not_settled"
