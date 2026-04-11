"""
Tests for vla_safety.py — ActionValidator, MovementRateLimiter, NetworkWatchdog, GracefulDegradation.

These tests don't require real hardware or network.
@status test
"""

import time
from unittest.mock import patch, MagicMock

import pytest

from vla_safety import (
    ActionValidator,
    GracefulDegradation,
    MovementRateLimiter,
    NetworkWatchdog,
)


# ============================================================================
# ActionValidator tests
# ============================================================================


class TestActionValidator:

    def test_valid_action(self):
        v = ActionValidator()
        action = [0.0, 0.0, 0.0, 0.0, 0.0, 50.0]
        ok, reason = v.validate(action)
        assert ok is True
        assert reason == ""
        assert v.stats["validated"] == 1

    def test_invalid_action_exceeds_max(self):
        v = ActionValidator()
        action = [0.0, 0.0, 0.0, 0.0, 0.0, 150.0]  # gripper max is 100
        ok, reason = v.validate(action)
        assert ok is False
        assert "gripper" in reason
        assert v.stats["rejected"] == 1

    def test_invalid_action_below_min(self):
        v = ActionValidator()
        action = [-200.0, 0.0, 0.0, 0.0, 0.0, 0.0]  # shoulder_pan min is -150
        ok, reason = v.validate(action)
        assert ok is False
        assert "shoulder_pan" in reason

    def test_wrong_length(self):
        v = ActionValidator()
        action = [0.0, 0.0, 0.0]
        ok, reason = v.validate(action)
        assert ok is False
        assert "length" in reason

    def test_boundary_values_valid(self):
        v = ActionValidator()
        action = [150.0, 180.0, -180.0, 90.0, -180.0, 100.0]
        ok, reason = v.validate(action)
        assert ok is True

    def test_boundary_values_invalid(self):
        v = ActionValidator()
        action = [150.1, 0.0, 0.0, 0.0, 0.0, 0.0]
        ok, reason = v.validate(action)
        assert ok is False

    def test_clip_within_limits(self):
        v = ActionValidator()
        action = [0.0, 0.0, 0.0, 0.0, 0.0, 50.0]
        clipped = v.clip(action)
        assert clipped == action
        assert v.stats["clipped"] == 0
        assert v.stats["validated"] == 1

    def test_clip_exceeds_max(self):
        v = ActionValidator()
        action = [200.0, 0.0, 0.0, 0.0, 0.0, 150.0]
        clipped = v.clip(action)
        assert clipped[0] == 150.0  # shoulder_pan max
        assert clipped[5] == 100.0  # gripper max
        assert v.stats["clipped"] == 1

    def test_clip_below_min(self):
        v = ActionValidator()
        action = [-200.0, 0.0, 0.0, -100.0, 0.0, -20.0]
        clipped = v.clip(action)
        assert clipped[0] == -150.0  # shoulder_pan min
        assert clipped[3] == -90.0   # wrist_flex min
        assert clipped[5] == -10.0   # gripper min

    def test_custom_joint_names(self):
        v = ActionValidator()
        action = [0.0, 0.0]
        ok, reason = v.validate(action, ["shoulder_pan", "gripper"])
        assert ok is True

    def test_stats_accumulate(self):
        v = ActionValidator()
        v.validate([0.0] * 6)
        v.validate([0.0] * 6)
        v.validate([999.0] * 6)  # rejected
        v.clip([200.0, 0.0, 0.0, 0.0, 0.0, 0.0])  # clipped
        assert v.stats["validated"] == 3  # 2 validate + 1 clip
        assert v.stats["rejected"] == 1
        assert v.stats["clipped"] == 1


# ============================================================================
# MovementRateLimiter tests
# ============================================================================


class TestMovementRateLimiter:

    def test_first_action_always_passes(self):
        rl = MovementRateLimiter(max_delta=5.0)
        ok, reason = rl.check([10.0, 20.0, 30.0, 40.0, 50.0, 60.0])
        assert ok is True

    def test_small_delta_passes(self):
        rl = MovementRateLimiter(max_delta=10.0)
        rl.update([0.0] * 6)
        ok, reason = rl.check([5.0, 5.0, 5.0, 5.0, 5.0, 5.0])
        assert ok is True

    def test_large_delta_fails(self):
        rl = MovementRateLimiter(max_delta=10.0)
        rl.update([0.0] * 6)
        ok, reason = rl.check([15.0, 0.0, 0.0, 0.0, 0.0, 0.0])
        assert ok is False
        assert "delta" in reason

    def test_clip_first_action_passthrough(self):
        rl = MovementRateLimiter(max_delta=5.0)
        action = [100.0, 200.0, 300.0]
        clipped = rl.clip(action)
        assert clipped == action

    def test_clip_limits_delta(self):
        rl = MovementRateLimiter(max_delta=5.0)
        rl.clip([0.0, 0.0, 0.0])  # sets last_action
        clipped = rl.clip([20.0, -20.0, 3.0])
        assert clipped[0] == 5.0   # 0 + 5
        assert clipped[1] == -5.0  # 0 - 5
        assert clipped[2] == 3.0   # within limit

    def test_clip_updates_last_action(self):
        rl = MovementRateLimiter(max_delta=5.0)
        rl.clip([0.0, 0.0])
        rl.clip([10.0, 0.0])  # clipped to [5.0, 0.0]
        clipped = rl.clip([20.0, 0.0])  # from [5.0, 0.0], clipped to [10.0, 0.0]
        assert clipped[0] == 10.0

    def test_reset(self):
        rl = MovementRateLimiter(max_delta=5.0)
        rl.update([0.0] * 6)
        rl.reset()
        # After reset, first action passes again
        ok, _ = rl.check([100.0] * 6)
        assert ok is True

    def test_update_sets_last(self):
        rl = MovementRateLimiter(max_delta=5.0)
        rl.update([10.0, 20.0])
        ok, _ = rl.check([12.0, 22.0])
        assert ok is True
        ok, _ = rl.check([20.0, 20.0])
        assert ok is False


# ============================================================================
# NetworkWatchdog tests
# ============================================================================


class TestNetworkWatchdog:

    def test_healthy_with_no_data(self):
        w = NetworkWatchdog(timeout_ms=100.0)
        assert w.is_healthy() is True

    def test_healthy_with_good_latencies(self):
        w = NetworkWatchdog(timeout_ms=100.0)
        for lat in [20.0, 30.0, 50.0, 40.0, 60.0]:
            w.record_latency(lat)
        assert w.is_healthy() is True

    def test_unhealthy_with_bad_latencies(self):
        w = NetworkWatchdog(timeout_ms=100.0, window_size=5)
        for lat in [150.0, 200.0, 120.0, 110.0, 130.0]:
            w.record_latency(lat)
        assert w.is_healthy() is False

    def test_majority_rule(self):
        w = NetworkWatchdog(timeout_ms=100.0, window_size=5)
        # 2 bad, 3 good → healthy (2 <= 5//2 = 2)
        for lat in [150.0, 200.0, 50.0, 60.0, 70.0]:
            w.record_latency(lat)
        assert w.is_healthy() is True

    def test_just_over_majority(self):
        w = NetworkWatchdog(timeout_ms=100.0, window_size=5)
        # 3 bad, 2 good → unhealthy (3 > 5//2 = 2)
        for lat in [150.0, 200.0, 120.0, 50.0, 60.0]:
            w.record_latency(lat)
        assert w.is_healthy() is False

    def test_last_latency(self):
        w = NetworkWatchdog(timeout_ms=100.0)
        assert w.last_latency_ms is None
        w.record_latency(42.5)
        assert w.last_latency_ms == 42.5
        w.record_latency(55.0)
        assert w.last_latency_ms == 55.0

    def test_avg_latency(self):
        w = NetworkWatchdog(timeout_ms=100.0, window_size=3)
        assert w.avg_latency_ms is None
        w.record_latency(30.0)
        w.record_latency(60.0)
        w.record_latency(90.0)
        assert w.avg_latency_ms == 60.0

    def test_reset(self):
        w = NetworkWatchdog(timeout_ms=100.0)
        for lat in [200.0] * 10:
            w.record_latency(lat)
        assert w.is_healthy() is False
        w.reset()
        assert w.is_healthy() is True
        assert w.last_latency_ms is None

    def test_window_slides(self):
        w = NetworkWatchdog(timeout_ms=100.0, window_size=3)
        # Fill window with bad values
        for lat in [200.0, 200.0, 200.0]:
            w.record_latency(lat)
        assert w.is_healthy() is False
        # Push in good values to slide out bad ones
        for lat in [10.0, 10.0, 10.0]:
            w.record_latency(lat)
        assert w.is_healthy() is True


# ============================================================================
# GracefulDegradation tests
# ============================================================================


class TestGracefulDegradation:

    def test_hold_position_none_initially(self):
        gd = GracefulDegradation()
        assert gd.hold_position() is None

    def test_hold_position_after_record(self):
        gd = GracefulDegradation()
        gd.record_good_action([1.0, 2.0, 3.0, 4.0, 5.0, 6.0])
        pos = gd.hold_position()
        assert pos == [1.0, 2.0, 3.0, 4.0, 5.0, 6.0]

    def test_hold_position_returns_copy(self):
        gd = GracefulDegradation()
        gd.record_good_action([1.0, 2.0])
        pos1 = gd.hold_position()
        pos2 = gd.hold_position()
        assert pos1 is not pos2  # should be a copy

    @patch.dict("sys.modules", {"httpx": MagicMock()})
    def test_safe_stop_success(self):
        import httpx
        mock_resp = MagicMock()
        mock_resp.raise_for_status = MagicMock()
        httpx.post.return_value = mock_resp

        gd = GracefulDegradation()
        ok = gd.safe_stop("test reason", sidecar_url="http://localhost:8765")
        assert ok is True
        assert len(gd.events) == 1
        assert gd.events[0]["reason"] == "test reason"
        assert gd.events[0]["type"] == "safe_stop"
        httpx.post.assert_called_once()

    @patch.dict("sys.modules", {"httpx": MagicMock()})
    def test_safe_stop_failure(self):
        import httpx
        httpx.post.side_effect = Exception("Connection refused")

        gd = GracefulDegradation()
        ok = gd.safe_stop("timeout", sidecar_url="http://localhost:9999")
        assert ok is False
        assert len(gd.events) == 1

    @patch.dict("sys.modules", {"httpx": MagicMock()})
    def test_events_accumulate(self):
        import httpx
        mock_resp = MagicMock()
        mock_resp.raise_for_status = MagicMock()
        httpx.post.return_value = mock_resp

        gd = GracefulDegradation()
        gd.safe_stop("reason1")
        gd.safe_stop("reason2")
        assert len(gd.events) == 2

    @patch.dict("sys.modules", {"httpx": MagicMock()})
    def test_clear_events(self):
        import httpx
        mock_resp = MagicMock()
        mock_resp.raise_for_status = MagicMock()
        httpx.post.return_value = mock_resp

        gd = GracefulDegradation()
        gd.safe_stop("reason1")
        assert len(gd.events) == 1
        gd.clear_events()
        assert len(gd.events) == 0
