"""
@file test_stub.py
@description Unit tests for StubInferenceEngine
@feature smolvla-server
"""

import pytest

from smolvla_server.stub import StubInferenceEngine


class TestStubInferenceEngine:
    """Test StubInferenceEngine sine-wave trajectory generation."""

    def test_load_is_noop(self):
        """Load succeeds without any ML dependencies."""
        engine = StubInferenceEngine()
        engine.load()
        assert engine.policy  # truthy after load

    def test_predict_returns_correct_shape(self):
        """Predict returns 10 actions x 6 dims."""
        engine = StubInferenceEngine()
        engine.load()

        result = engine.predict(
            images={"front": "fake_b64"},
            state=[0.0] * 6,
            task="Test task",
        )

        assert len(result.actions) == 10
        for action in result.actions:
            assert len(action) == 6

    def test_predict_values_within_limits(self):
        """All predicted values should stay within [-2, 2]."""
        engine = StubInferenceEngine()
        engine.load()

        # Run multiple predictions to cover different trajectory phases
        for _ in range(20):
            result = engine.predict(
                images={"front": "fake_b64"},
                state=[0.0] * 6,
                task="Test task",
            )
            for action in result.actions:
                for value in action:
                    assert -2.0 <= value <= 2.0, f"Value {value} out of bounds"

    def test_predict_trajectory_is_smooth(self):
        """No large jumps between consecutive action steps within a chunk."""
        engine = StubInferenceEngine()
        engine.load()

        result = engine.predict(
            images={"front": "fake_b64"},
            state=[0.0] * 6,
            task="Test task",
        )

        max_step_delta = 0.0
        for i in range(1, len(result.actions)):
            for j in range(6):
                delta = abs(result.actions[i][j] - result.actions[i - 1][j])
                max_step_delta = max(max_step_delta, delta)

        # At 30 Hz with max freq 0.7 Hz and max amplitude 0.4,
        # max delta per step ~ 2*pi*0.7*0.4/30 ~ 0.06 rad
        assert max_step_delta < 0.2, f"Trajectory too jerky: max delta = {max_step_delta}"

    def test_reset_restarts_trajectory(self):
        """After reset, the first prediction chunk should be identical."""
        engine = StubInferenceEngine()
        engine.load()

        result1 = engine.predict(
            images={"front": "fake_b64"},
            state=[0.0] * 6,
            task="Test task",
        )

        engine.reset()

        result2 = engine.predict(
            images={"front": "fake_b64"},
            state=[0.0] * 6,
            task="Test task",
        )

        for a1, a2 in zip(result1.actions, result2.actions):
            for v1, v2 in zip(a1, a2):
                assert abs(v1 - v2) < 1e-9, "Reset did not restart trajectory"

    def test_properties(self):
        """Verify engine properties match SO-101 defaults."""
        engine = StubInferenceEngine()
        assert engine.action_dim == 6
        assert engine.chunk_size == 10
        assert engine.state_dim == 6
        assert engine.camera_names == ["front"]

    def test_policy_falsy_before_load(self):
        """Policy property should be falsy before load."""
        engine = StubInferenceEngine()
        assert not engine.policy

    def test_inference_time_reported(self):
        """Predict should report a positive inference time."""
        engine = StubInferenceEngine()
        engine.load()

        result = engine.predict(
            images={"front": "fake_b64"},
            state=[0.0] * 6,
            task="Test task",
        )
        assert result.inference_time_ms >= 0
