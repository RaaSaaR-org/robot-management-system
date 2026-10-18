"""A sidecar in front of the MuJoCo sim says so, and probes no robot LAN (TASK-416).

`g1_sidecar.py` cannot tell `sim_node.py` from a G1 over DDS, so on the
supervisor's sim profile it reported `sim: false` and the recorder labelled a
rehearsal `neodem-real-teleop`. The supervisor now sets G1_SIM_BACKEND=1 for a
`robot: sim` profile; /health reports it as `sim`, the field the recorder reads.
The flag is ignored on DDS domain 0, the real robot's. G1_CAMERA_SOURCE=none
turns off the `auto` camera order, which would otherwise probe teleimager and
PC2 on 192.168.123.x.

@status test
"""

import json
import os
import sys
import threading
import urllib.request
from http.server import ThreadingHTTPServer

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import g1_sidecar  # noqa: E402


def test_sim_backend_needs_the_flag():
    assert g1_sidecar._sim_backend({}) is False
    assert g1_sidecar._sim_backend({"G1_DDS_DOMAIN": "42"}) is False
    assert g1_sidecar._sim_backend({"G1_SIM_BACKEND": "0", "G1_DDS_DOMAIN": "42"}) is False
    assert g1_sidecar._sim_backend({"G1_SIM_BACKEND": "1", "G1_DDS_DOMAIN": "42"}) is True


def test_sim_backend_is_never_true_on_the_robots_domain():
    assert g1_sidecar._sim_backend({"G1_SIM_BACKEND": "1", "G1_DDS_DOMAIN": "0"}) is False
    assert g1_sidecar._sim_backend({"G1_SIM_BACKEND": "1"}) is False  # unset domain = 0
    assert g1_sidecar._sim_backend({"G1_SIM_BACKEND": "1", "G1_DDS_DOMAIN": "00"}) is False
    assert g1_sidecar._sim_backend({"G1_SIM_BACKEND": "1", "G1_DDS_DOMAIN": "x"}) is False


def _get_health(monkeypatch):
    reader = g1_sidecar._LowStateReader("tcp://127.0.0.1:1")
    reader._started = True  # no socket is opened
    reader._cache = {}
    monkeypatch.setattr(g1_sidecar, "_lowstate_reader", reader)
    monkeypatch.setattr(g1_sidecar, "_dds_state", None)
    monkeypatch.setattr(g1_sidecar, "_arm_controller", None)
    srv = ThreadingHTTPServer(("127.0.0.1", 0), g1_sidecar.Handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    try:
        url = "http://127.0.0.1:%d/health" % srv.server_address[1]
        with urllib.request.urlopen(url, timeout=5) as r:
            return json.loads(r.read())
    finally:
        srv.shutdown()
        srv.server_close()


def test_health_reports_sim_from_the_profile_flag(monkeypatch):
    monkeypatch.setenv("G1_SIM_BACKEND", "1")
    monkeypatch.setenv("G1_DDS_DOMAIN", "42")
    body = _get_health(monkeypatch)
    assert body["sim"] is True
    assert body["status"] == "ok" and "boot_id" in body


def test_health_reports_not_sim_without_it(monkeypatch):
    monkeypatch.delenv("G1_SIM_BACKEND", raising=False)
    monkeypatch.setenv("G1_DDS_DOMAIN", "42")
    assert _get_health(monkeypatch)["sim"] is False


def test_health_reports_not_sim_on_domain_zero(monkeypatch):
    monkeypatch.setenv("G1_SIM_BACKEND", "1")
    monkeypatch.setenv("G1_DDS_DOMAIN", "0")
    assert _get_health(monkeypatch)["sim"] is False


def test_camera_source_none_probes_nothing(monkeypatch):
    def boom(*_a, **_k):
        raise AssertionError("probed a camera source with G1_CAMERA_SOURCE=none")

    for fn in ("_lerobot_camera_names", "_teleimager_cam_config", "_pc2cam_available", "_ensure_realsense"):
        monkeypatch.setattr(g1_sidecar, fn, boom)
    for value in ("none", "off", "NONE"):
        monkeypatch.setenv("G1_CAMERA_SOURCE", value)
        assert g1_sidecar._camera_source_and_names() == (None, ())
        detail = g1_sidecar._no_camera_source_detail()
        assert "192.168" not in detail and "off" in detail
