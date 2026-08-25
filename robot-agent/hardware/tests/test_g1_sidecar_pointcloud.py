"""
Tests for the MID-360 frame convention in g1_sidecar.py (TASK-190).

The convention (invert / anchor / leave-raw) used to be re-decided for EVERY
frame from that frame's own floor plane. On a WALKED scan that mixes
conventions between neighbouring frames: a frame aimed at an open doorway has
no dominant floor plane within 8 m, so it was left raw (+z DOWN) while the
frames either side of it were flipped, and that slice stitched into the
accumulated twin mirrored.

These tests build synthetic MID-360 frames from a known world (floor at z=0,
sensor 1.3 m above it) and assert every frame of one session comes back in the
NeoDEM contract frame — floor at z≈0, +z up — including the floorless one.

Note on the shape of the fixtures: a real mount cannot be inverted for one
frame and upright for the next, so "inverted-with-floor" and
"upright-with-floor" are exercised as two SESSIONS (an inverted head MID-360,
and a robot-side publisher that already gravity-aligns its clouds). What must
hold inside one session is that a floorless frame follows its neighbours.

@status test
"""

import os
import sys

import numpy as np
import pytest

# Ensure hardware/ is on the path so `g1_sidecar` and its own imports resolve
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import g1_sidecar  # noqa: E402
from g1_sidecar import _normalize_mid360_frame  # noqa: E402

# The world every fixture frame is a view of.
SENSOR_HEIGHT = 1.30  # m above the floor, a standing G1's head MID-360
BEACON_WORLD = (1.5, 2.0, 1.00)  # a distinctive cluster 1 m above the floor
N_FLOOR = 900
N_BEACON = 40
N_WALL = 220

# Plane detection quantises to the 0.1 m histogram bin, so ±0.05 m is inherent.
TOL = 0.15


@pytest.fixture(autouse=True)
def _clear_sessions():
    """Every test starts with no locked conventions."""
    g1_sidecar._mid360_orientations.clear()
    yield
    g1_sidecar._mid360_orientations.clear()


def _to_raw(world: np.ndarray, mount: str) -> np.ndarray:
    """Map world points (floor z=0, +z up) into a raw sensor frame.

    `inverted` is the real head MID-360: mounted looking down, so +z points
    physically DOWN and the floor shows up as a dense plane ABOVE the origin.
    `upright` is the already-gravity-aligned cloud a robot-side SLAM mode
    would publish: +z up, sensor-centric, floor below the origin.
    """
    raw = world.astype(np.float64).copy()
    if mount == "inverted":
        raw[:, 1] = -raw[:, 1]
        raw[:, 2] = SENSOR_HEIGHT - raw[:, 2]
    elif mount == "upright":
        raw[:, 2] = raw[:, 2] - SENSOR_HEIGHT
    else:  # pragma: no cover - guards the fixtures themselves
        raise ValueError(f"unknown mount {mount!r}")
    return raw


def _frame(mount: str, *, floorless: bool = False, seed: int = 7) -> list:
    """One synthetic MID-360 frame as the flat [x,y,z, ...] contract list.

    Point order is [floor..., beacon..., wall...] and nothing in the frame sits
    inside the 0.3 m self-return radius, so the returned cloud keeps the same
    order and the slices below stay valid.

    `floorless` is the doorway frame the bug is about: the only returns are
    FAR (r > 8 m), so no dominant plane is found within the 8 m detection
    radius even though distant floor is visible.
    """
    rng = np.random.default_rng(seed)
    lo, hi = (9.0, 20.0) if floorless else (2.0, 7.0)

    theta = rng.uniform(0, 2 * np.pi, N_FLOOR)
    radius = rng.uniform(lo, hi, N_FLOOR)
    floor = np.column_stack(
        [radius * np.cos(theta), radius * np.sin(theta), rng.uniform(0.0, 0.02, N_FLOOR)]
    )

    beacon = np.tile(np.asarray(BEACON_WORLD, dtype=np.float64), (N_BEACON, 1))
    beacon[:, :2] += rng.uniform(-0.05, 0.05, (N_BEACON, 2))
    if floorless:
        beacon[:, 0] += 10.0  # push the beacon out past the detection radius too

    wall_theta = rng.uniform(0, 2 * np.pi, N_WALL)
    wall_r = hi + 0.5
    wall = np.column_stack(
        [
            wall_r * np.cos(wall_theta),
            wall_r * np.sin(wall_theta),
            rng.uniform(0.2, 2.0, N_WALL),
        ]
    )

    return _to_raw(np.vstack([floor, beacon, wall]), mount).reshape(-1).tolist()


def _parts(positions: list) -> tuple[np.ndarray, np.ndarray]:
    """(floor points, beacon points) of a normalized frame, in contract coords."""
    a = np.asarray(positions, dtype=np.float64).reshape(-1, 3)
    assert len(a) == N_FLOOR + N_BEACON + N_WALL, "self-return filter dropped fixture points"
    return a[:N_FLOOR], a[N_FLOOR : N_FLOOR + N_BEACON]


def _assert_contract_frame(positions: list, where: str) -> None:
    """Floor at z≈0, the beacon 1 m ABOVE it, world y recovered — i.e. +z up."""
    floor, beacon = _parts(positions)
    assert float(np.median(floor[:, 2])) == pytest.approx(0.0, abs=TOL), f"{where}: floor not at z=0"
    assert float(np.median(beacon[:, 2])) == pytest.approx(
        BEACON_WORLD[2], abs=TOL
    ), f"{where}: beacon not 1 m above the floor (+z is not up)"
    assert float(np.median(beacon[:, 1])) == pytest.approx(
        BEACON_WORLD[1], abs=TOL
    ), f"{where}: beacon mirrored in y"


def _lock(session: str, mount: str) -> None:
    """Run enough floor-bearing frames through `session` to lock its convention."""
    for i in range(g1_sidecar._MID360_LOCK_AFTER):
        _normalize_mid360_frame(_frame(mount, seed=100 + i), [], session)
    assert g1_sidecar._mid360_orientations[session].locked


class TestSessionLockedConvention:
    """The regression: one convention for the whole scan session."""

    @pytest.mark.parametrize("mount", ["inverted", "upright"])
    def test_floorless_frame_follows_its_neighbours(self, mount: str) -> None:
        session = f"sess_{mount}"
        _lock(session, mount)

        with_floor, _ = _normalize_mid360_frame(_frame(mount, seed=1), [], session)
        floorless, _ = _normalize_mid360_frame(_frame(mount, floorless=True, seed=2), [], session)

        _assert_contract_frame(with_floor, f"{mount}/with-floor")
        _assert_contract_frame(floorless, f"{mount}/floorless")

    def test_walked_sweep_keeps_one_frame_across_a_floorless_gap(self) -> None:
        """The bug as it appears in a twin: floor, floor, doorway, floor."""
        session = "sess_walk"
        _lock(session, "inverted")

        sweep = [
            _normalize_mid360_frame(_frame("inverted", seed=10), [], session)[0],
            _normalize_mid360_frame(_frame("inverted", seed=11), [], session)[0],
            _normalize_mid360_frame(_frame("inverted", floorless=True, seed=12), [], session)[0],
            _normalize_mid360_frame(_frame("inverted", seed=13), [], session)[0],
        ]
        for i, positions in enumerate(sweep):
            _assert_contract_frame(positions, f"sweep frame {i}")

        # ...and the slices agree with each other, not merely with z≈0.
        beacon_z = [float(np.median(_parts(p)[1][:, 2])) for p in sweep]
        assert max(beacon_z) - min(beacon_z) < 0.05, f"slices disagree: {beacon_z}"

    def test_inverted_and_upright_sessions_land_in_the_same_frame(self) -> None:
        """Whatever the mount, a locked session emits the one contract frame."""
        _lock("sess_a", "inverted")
        _lock("sess_b", "upright")

        a, _ = _normalize_mid360_frame(_frame("inverted", floorless=True, seed=3), [], "sess_a")
        b, _ = _normalize_mid360_frame(_frame("upright", floorless=True, seed=3), [], "sess_b")

        _assert_contract_frame(a, "inverted session")
        _assert_contract_frame(b, "upright session")
        assert float(np.median(_parts(a)[1][:, 2])) == pytest.approx(
            float(np.median(_parts(b)[1][:, 2])), abs=0.05
        )


class TestSessionScope:
    """A convention belongs to a session, and only to a session."""

    def test_a_floorless_frame_is_still_left_raw_before_anything_is_locked(self) -> None:
        """The documented fallback: no convention could be established yet."""
        raw = _frame("inverted", floorless=True, seed=4)
        out, _ = _normalize_mid360_frame(raw, [], "sess_cold")

        assert not g1_sidecar._mid360_orientations["sess_cold"].locked
        assert out == pytest.approx(raw, abs=1e-4)

    def test_a_new_session_does_not_inherit_the_previous_convention(self) -> None:
        _lock("sess_first", "inverted")
        raw = _frame("inverted", floorless=True, seed=5)
        out, _ = _normalize_mid360_frame(raw, [], "sess_second")

        assert "sess_second" in g1_sidecar._mid360_orientations
        assert not g1_sidecar._mid360_orientations["sess_second"].locked
        assert out == pytest.approx(raw, abs=1e-4)

    def test_frames_with_no_session_id_share_one_live_convention(self) -> None:
        """A live view is still one continuous stream, not per-frame decisions."""
        for i in range(g1_sidecar._MID360_LOCK_AFTER):
            _normalize_mid360_frame(_frame("inverted", seed=200 + i), [], None)
        assert g1_sidecar._mid360_orientations[g1_sidecar._MID360_LIVE_SESSION].locked

        out, _ = _normalize_mid360_frame(_frame("inverted", floorless=True, seed=6), [], None)
        _assert_contract_frame(out, "live view")


class TestAnchorTracking:
    """The locked convention fixes the flip; the anchor still follows the floor."""

    def test_a_frame_anchors_on_its_own_floor_when_it_is_plausible(self) -> None:
        session = "sess_anchor"
        _lock(session, "inverted")
        before = g1_sidecar._mid360_orientations[session].anchor

        # The robot dips: the floor is now 0.25 m further from the sensor.
        raw = np.asarray(_frame("inverted", seed=8), dtype=np.float64).reshape(-1, 3)
        raw[:, 2] += 0.25
        out, _ = _normalize_mid360_frame(raw.reshape(-1).tolist(), [], session)

        assert float(np.median(_parts(out)[0][:, 2])) == pytest.approx(0.0, abs=TOL)
        assert g1_sidecar._mid360_orientations[session].anchor > before

    def test_an_implausible_plane_falls_back_to_the_session_anchor(self) -> None:
        """A table top mistaken for the floor must not move the whole slice."""
        session = "sess_table"
        _lock(session, "inverted")
        anchor = g1_sidecar._mid360_orientations[session].anchor

        # Dominant plane a full metre from the session floor — beyond tolerance.
        raw = np.asarray(_frame("inverted", seed=9), dtype=np.float64).reshape(-1, 3)
        raw[:N_FLOOR, 2] -= 1.0
        out, _ = _normalize_mid360_frame(raw.reshape(-1).tolist(), [], session)

        assert g1_sidecar._mid360_orientations[session].inverted is True
        assert g1_sidecar._mid360_orientations[session].anchor == pytest.approx(anchor)
        # Anchored on the session floor, so the bogus plane lands 1 m off z=0
        # rather than dragging the frame down to meet it.
        assert float(np.median(_parts(out)[0][:, 2])) == pytest.approx(1.0, abs=TOL)


class TestSourceChangedConvention:
    """Locking must not cost the robustness the per-frame detection had.

    If the SOURCE really switches — a robot-side utlidar/SLAM mode starting to
    publish already-gravity-aligned clouds — the floor moves to the other side
    of the origin and stays there, and the session has to follow it. That takes
    the same evidence as the original lock, so a lone odd frame cannot.
    """

    def test_a_single_disagreeing_frame_does_not_overturn_the_lock(self) -> None:
        session = "sess_blip"
        _lock(session, "inverted")

        _normalize_mid360_frame(_frame("upright", seed=20), [], session)

        assert g1_sidecar._mid360_orientations[session].inverted is True

    def test_a_sustained_switch_re_locks_the_session(self) -> None:
        session = "sess_switch"
        _lock(session, "inverted")

        for i in range(g1_sidecar._MID360_LOCK_AFTER - 1):
            _normalize_mid360_frame(_frame("upright", seed=30 + i), [], session)
            assert g1_sidecar._mid360_orientations[session].inverted is True, "re-locked too early"

        _normalize_mid360_frame(_frame("upright", seed=40), [], session)
        assert g1_sidecar._mid360_orientations[session].inverted is False

        # ...and the session now normalizes the new convention, floorless
        # frames included.
        _assert_contract_frame(
            _normalize_mid360_frame(_frame("upright", seed=41), [], session)[0], "after re-lock"
        )
        _assert_contract_frame(
            _normalize_mid360_frame(_frame("upright", floorless=True, seed=42), [], session)[0],
            "floorless after re-lock",
        )

    def test_one_agreeing_frame_resets_the_evidence(self) -> None:
        """Disagreement has to be sustained, not merely frequent."""
        session = "sess_flap"
        _lock(session, "inverted")

        for i in range(3):
            _normalize_mid360_frame(_frame("upright", seed=50 + i), [], session)
            _normalize_mid360_frame(_frame("inverted", seed=60 + i), [], session)

        assert g1_sidecar._mid360_orientations[session].inverted is True


class TestSnapshotRoute:
    """The session id has to survive the wire: header → convention."""

    @staticmethod
    def _snapshot(port: int, session: str | None) -> list:
        import json
        import urllib.request

        req = urllib.request.Request(f"http://127.0.0.1:{port}/pointcloud/mid360_lidar/snapshot")
        if session is not None:
            req.add_header(g1_sidecar.SCAN_SESSION_HEADER, session)
        with urllib.request.urlopen(req, timeout=5) as res:
            return json.loads(res.read())["positions"]

    def test_the_scan_session_header_scopes_the_convention(self, monkeypatch) -> None:
        import threading
        from http.server import ThreadingHTTPServer

        frames = iter(
            [_frame("inverted", seed=100 + i) for i in range(g1_sidecar._MID360_LOCK_AFTER)]
            + [_frame("inverted", floorless=True, seed=42)] * 2
        )
        monkeypatch.setattr(
            g1_sidecar, "_dds_pointcloud", lambda _target: (next(frames), [], True, "dds")
        )
        monkeypatch.setenv("G1_LIDAR_SOURCE", "dds")
        monkeypatch.delenv("G1_POINTCLOUD_REPLAY", raising=False)

        server = ThreadingHTTPServer(("127.0.0.1", 0), g1_sidecar.Handler)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        try:
            port = server.server_address[1]
            for _ in range(g1_sidecar._MID360_LOCK_AFTER):
                self._snapshot(port, "sess_http")
            assert g1_sidecar._mid360_orientations["sess_http"].locked

            # Same floorless frame, once inside the locked session and once with
            # no session at all: only the session-scoped one is brought round.
            _assert_contract_frame(self._snapshot(port, "sess_http"), "via header")
            untagged = self._snapshot(port, None)
        finally:
            server.shutdown()
            server.server_close()

        assert not g1_sidecar._mid360_orientations[g1_sidecar._MID360_LIVE_SESSION].locked
        assert float(np.median(_parts(untagged)[0][:, 2])) == pytest.approx(
            SENSOR_HEIGHT, abs=TOL
        ), "an untagged frame must not borrow another session's lock"
