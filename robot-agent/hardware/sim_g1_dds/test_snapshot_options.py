"""Unit tests for the snapshot render options and the joints /state reports.

    python -m pytest robot-agent/hardware/sim_g1_dds/test_snapshot_options.py

Two things are under test here, and both exist because of the same measurement:
an offscreen render of `g1_dex3_house_scene.xml` at 640x480 costs roughly EIGHT
TIMES more with shadows than without (37.7 ms against 4.9 on an idle machine,
66.7 against 8.2 on a busy one), and the cost is FLAT in resolution. A recorder
that wants 30 frames a second out of this facade cannot get them by asking for a
smaller picture; it has to ask for a cheaper one.

What these protect:

* **A query string must not 404.** The router matched on `self.path` whole, so
  `/cameras/head_camera/snapshot?shadows=0` used to fall through to "not found"
  rather than being served with the option ignored. Adding a parameter to a
  route that silently rejects parameters is the kind of thing that looks like it
  works because the client swallows the error.
* **A render option must not leak.** The flags live on the shared `mjvScene`,
  not on the request, and they survive `update_scene`. Set them once and every
  subsequent MJPEG frame is silently flat-lit too.
* **The hands are in /state.** `HardwareClient.getStateNow()` maps the reply by
  NAME into the embodiment's joint order and fills anything absent with 0.0, so
  a g1_edu read every Dex3 finger back as "open" wherever it really was. A
  recorded demonstration whose two hand columns are constant zero is worse than
  one with no hand column at all.
"""
from __future__ import annotations

import io
import json
import sys
from pathlib import Path

import pytest

# Same collection guard, and the same reason, as test_camera_stream.py: sim_node
# imports mujoco AND unitree_sdk2py at module scope, and scripts/test-all.sh
# gates this directory on `import mujoco` alone.
sys.path.insert(0, str(Path(__file__).resolve().parent))
sim_node = pytest.importorskip("sim_node")

from joints import BODY, LHAND, RHAND  # noqa: E402


# ---------------------------------------------------------------- query parsing


class TestQueryHelpers:
    def test_a_missing_parameter_keeps_the_default(self):
        assert sim_node.qs_bool({}, "shadows", True) is True
        assert sim_node.qs_bool({}, "shadows", False) is False
        assert sim_node.qs_int({}, "quality", 85, 1, 100) == 85
        assert sim_node.qs_one({}, "format") is None

    def test_the_falsy_spellings_all_mean_off(self):
        for raw in ("0", "false", "no", "off", "FALSE", " Off "):
            assert sim_node.qs_bool({"shadows": [raw]}, "shadows", True) is False

    def test_a_bare_flag_means_on(self):
        # `?shadows` with no value parses to [''] -- the HTML form spelling of
        # "present", and the one a curl by hand is most likely to produce.
        assert sim_node.qs_bool({"shadows": [""]}, "shadows", False) is True

    def test_a_typo_keeps_the_default_instead_of_guessing(self):
        # "flase" is not False. Guessing here would silently halve the lighting
        # of a recording on a typo.
        assert sim_node.qs_bool({"shadows": ["flase"]}, "shadows", True) is True
        assert sim_node.qs_int({"quality": ["high"]}, "quality", 85, 1, 100) == 85

    def test_quality_is_bounded_and_out_of_range_keeps_the_default(self):
        assert sim_node.qs_int({"quality": ["60"]}, "quality", 85, 1, 100) == 60
        assert sim_node.qs_int({"quality": ["0"]}, "quality", 85, 1, 100) == 85
        assert sim_node.qs_int({"quality": ["101"]}, "quality", 85, 1, 100) == 85

    def test_a_repeated_parameter_takes_the_first(self):
        assert sim_node.qs_int({"quality": ["50", "90"]}, "quality", 85, 1, 100) == 50


# ------------------------------------------------------------------ the route


class RenderCall:
    def __init__(self, jpeg=b"\xff\xd8\xffJPEG", error=None):
        self.jpeg = jpeg
        self.error = error


class FakeNode:
    """Supplies only what /cameras/<n>/snapshot and /state touch."""

    def __init__(self, error=None, hands=True):
        self.error = error
        self.calls: list[dict] = []
        self.scene = type("S", (), {"name": "test_scene.xml"})()
        self.behind_s = 0.0
        self.lock = _NullLock()
        n = len(BODY) + (len(LHAND) + len(RHAND) if hands else 0)
        self.data = type("D", (), {"qpos": [0.1 * i for i in range(n)], "time": 12.5})()
        self.qadr = {
            "body": list(range(len(BODY))),
            "lh": list(range(len(BODY), len(BODY) + len(LHAND))),
            "rh": list(range(len(BODY) + len(LHAND), n)),
        }

    def request_render(self, camera, timeout=5.0, *, shadows=True, reflection=True, quality=85):
        self.calls.append(
            {"camera": camera, "shadows": shadows, "reflection": reflection, "quality": quality}
        )
        if self.error:
            return RenderCall(jpeg=None, error=self.error)
        return RenderCall()

    def camera_names(self):
        return ["head_camera"]

    def measured_pose(self):
        return (1.0, 2.0, 0.5)


class _NullLock:
    def __enter__(self):
        return self

    def __exit__(self, *_):
        return False


def get(node, path):
    """Drive do_GET against a buffer and hand back (head, body)."""
    handler_cls = sim_node.make_handler(node, bridge=None)
    h = handler_cls.__new__(handler_cls)
    h.wfile = io.BytesIO()
    h.rfile = io.BytesIO()
    h.request_version = "HTTP/1.1"
    h.close_connection = False
    h.requestline = f"GET {path} HTTP/1.1"
    h.headers = {}
    h.client_address = ("127.0.0.1", 0)
    h.server = None
    h.path = path
    h.do_GET()
    raw = h.wfile.getvalue()
    head, _, body = raw.partition(b"\r\n\r\n")
    return head, body


class TestSnapshotRoute:
    def test_a_plain_snapshot_still_renders_with_shadows(self):
        node = FakeNode()
        head, body = get(node, "/cameras/head_camera/snapshot")
        assert b"200" in head.split(b"\r\n")[0]
        assert node.calls == [
            {"camera": "head_camera", "shadows": True, "reflection": True, "quality": 85}
        ]
        payload = json.loads(body)
        assert payload["ok"] is True
        # Both keys, still: g1_sidecar.py answers jpeg_base64 and HardwareClient
        # historically read image_b64.
        assert payload["jpeg_base64"] == payload["image_b64"]

    def test_a_query_string_is_served_not_404ed(self):
        head, _ = get(FakeNode(), "/cameras/head_camera/snapshot?shadows=0")
        assert b"200" in head.split(b"\r\n")[0]

    def test_the_options_reach_the_renderer(self):
        node = FakeNode()
        get(node, "/cameras/head_camera/snapshot?shadows=0&reflection=0&quality=70")
        assert node.calls == [
            {"camera": "head_camera", "shadows": False, "reflection": False, "quality": 70}
        ]

    def test_format_raw_is_the_jpeg_itself(self):
        head, body = get(FakeNode(), "/cameras/head_camera/snapshot?format=raw")
        assert b"Content-Type: image/jpeg" in head
        assert body == b"\xff\xd8\xffJPEG"
        assert f"Content-Length: {len(body)}".encode() in head

    def test_a_failed_render_is_a_503_in_json_even_when_raw_was_asked_for(self):
        # An error is not an image. A client that asked for bytes and got a
        # truncated JPEG would decode garbage instead of reading the reason.
        head, body = get(FakeNode(error="no camera"), "/cameras/nope/snapshot?format=raw")
        assert b"503" in head.split(b"\r\n")[0]
        assert b"Content-Type: application/json" in head
        assert json.loads(body)["error"] == "no camera"

    def test_the_camera_name_survives_the_query_split(self):
        node = FakeNode()
        get(node, "/cameras/house_iso/snapshot?shadows=0")
        assert node.calls[0]["camera"] == "house_iso"

    def test_health_still_answers_with_a_query_string_attached(self):
        head, body = get(FakeNode(), "/health?cachebust=1")
        assert b"200" in head.split(b"\r\n")[0]
        assert json.loads(body)["status"] == "ok"


class TestStateJoints:
    def test_state_reports_the_body_and_both_hands(self):
        _, body = get(FakeNode(), "/state")
        names = [j["name"] for j in json.loads(body)["joints"]]
        assert names == list(BODY) + list(LHAND) + list(RHAND)
        assert len(names) == 43

    def test_the_body_joints_still_come_first_and_in_order(self):
        # The ordering IS the protocol on the DDS side; a reader that indexes
        # positionally must keep working.
        _, body = get(FakeNode(), "/state")
        joints = json.loads(body)["joints"]
        assert [j["name"] for j in joints[: len(BODY)]] == list(BODY)

    def test_the_finger_positions_are_real_values_not_zeros(self):
        _, body = get(FakeNode(), "/state")
        fingers = json.loads(body)["joints"][len(BODY) :]
        assert all(j["position"] != 0.0 for j in fingers)

    def test_state_carries_both_clocks(self):
        _, body = get(FakeNode(), "/state")
        payload = json.loads(body)
        # Wall time is the sidecar contract; sim time is what tells a recorder
        # its frames really are 1/fps apart in the world it filmed.
        assert payload["timestamp"] > 1_600_000_000
        assert payload["sim_time"] == 12.5

    def test_state_fast_is_the_same_reply(self):
        _, a = get(FakeNode(), "/state")
        _, b = get(FakeNode(), "/state/fast")
        pa, pb = json.loads(a), json.loads(b)
        assert pa["joints"] == pb["joints"]
        assert pa["sim_time"] == pb["sim_time"]


# ------------------------------------------------- the flags reach MuJoCo

SCENE = Path(__file__).resolve().parent.parent / "sim_evaluator" / "mjcf" / "g1_dex3_house_scene.xml"


@pytest.mark.skipif(not SCENE.exists(), reason="house scene not present")
class TestRenderFlagsAreReal:
    """These load the real scene (~seconds). They are the only proof that the
    query parameter reaches the renderer rather than being parsed and dropped."""

    def test_turning_shadows_off_changes_the_picture(self):
        import mujoco

        n = sim_node.SimNode.__new__(sim_node.SimNode)
        n.model = mujoco.MjModel.from_xml_path(str(SCENE))
        n.data = mujoco.MjData(n.model)
        n.scene = type("S", (), {"name": SCENE.name})()
        n._renderer = None
        mujoco.mj_forward(n.model, n.data)

        lit = n._render_jpeg("head_camera")
        flat = n._render_jpeg("head_camera", shadows=False, reflection=False)
        assert lit != flat, "the shadow flag was parsed and then ignored"
        assert lit.startswith(b"\xff\xd8\xff") and flat.startswith(b"\xff\xd8\xff")

        # And back: the flags live on a SHARED mjvScene that survives
        # update_scene, so without setting them on every render the flat frame
        # above would flatten every frame after it -- including the MJPEG stream
        # a human is watching.
        again = n._render_jpeg("head_camera")
        assert again == lit, "a fast render leaked its lighting into the next frame"

    def test_quality_changes_the_size_and_nothing_else(self):
        import mujoco

        n = sim_node.SimNode.__new__(sim_node.SimNode)
        n.model = mujoco.MjModel.from_xml_path(str(SCENE))
        n.data = mujoco.MjData(n.model)
        n.scene = type("S", (), {"name": SCENE.name})()
        n._renderer = None
        mujoco.mj_forward(n.model, n.data)

        big = n._render_jpeg("head_camera", quality=95)
        small = n._render_jpeg("head_camera", quality=40)
        assert len(small) < len(big)
