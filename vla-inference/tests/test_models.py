"""
@file test_models.py
@description Unit tests for VLA model implementations
@feature vla-inference
"""

import pytest
from models import (
    create_model,
    VLAModel,
    Observation,
    ActionChunk,
    Action,
    ModelInfo,
)
from models.pi0 import Pi0Model
from models.openvla import OpenVLAModel
from models.groot import GR00TModel, GR00TNotAvailableError


# ============================================================================
# Test Fixtures
# ============================================================================

@pytest.fixture
def sample_observation():
    """Create a sample observation for testing."""
    return Observation(
        camera_image=b"fake-jpeg-data",
        joint_positions=[0.1, 0.2, 0.3, 0.4, 0.5, 0.6],
        joint_velocities=[0.0, 0.0, 0.0, 0.0, 0.0, 0.0],
        language_instruction="pick up the red cup",
        timestamp=1234567890.0,
        embodiment_tag="unitree_h1",
        session_id="test-session",
    )


# ============================================================================
# Model Factory Tests
# ============================================================================

class TestModelFactory:
    """Test model factory function."""

    def test_create_pi0_model(self):
        """Test creating π0 model."""
        model = create_model("pi0")
        assert isinstance(model, Pi0Model)

    def test_create_pi0_6_alias(self):
        """Test creating π0 model with pi0_6 alias."""
        model = create_model("pi0_6")
        assert isinstance(model, Pi0Model)

    def test_create_openvla_model(self):
        """Test creating OpenVLA model."""
        model = create_model("openvla")
        assert isinstance(model, OpenVLAModel)

    def test_create_groot_model(self):
        """Test creating GR00T model."""
        model = create_model("groot")
        assert isinstance(model, GR00TModel)

    def test_create_model_case_insensitive(self):
        """Test that model type is case insensitive."""
        model1 = create_model("PI0")
        model2 = create_model("OpenVLA")
        assert isinstance(model1, Pi0Model)
        assert isinstance(model2, OpenVLAModel)

    def test_create_unknown_model_raises(self):
        """Test that unknown model type raises ValueError."""
        with pytest.raises(ValueError) as exc:
            create_model("unknown_model")
        assert "Unknown model type" in str(exc.value)


# ============================================================================
# π0 Model Tests
# ============================================================================

class TestPi0Model:
    """Test π0.6 model implementation."""

    def test_model_info(self):
        """Test model info properties."""
        model = Pi0Model()
        info = model.model_info
        
        assert info.model_name == "pi0-stub"
        assert info.base_model == "pi0"
        assert info.chunk_size == 16
        assert info.action_dim == 7
        assert "unitree_h1" in info.supported_embodiments

    def test_load_unload(self):
        """Test model loading and unloading."""
        model = Pi0Model()
        
        assert not model.is_loaded
        
        model.load(device="cpu")
        assert model.is_loaded
        assert model.device == "cpu"
        
        model.unload()
        assert not model.is_loaded

    def test_predict_requires_loading(self, sample_observation):
        """Test that predict raises error if not loaded."""
        model = Pi0Model()
        
        with pytest.raises(RuntimeError) as exc:
            model.predict(sample_observation)
        assert "not loaded" in str(exc.value)

    def test_predict_returns_action_chunk(self, sample_observation):
        """Test that predict returns valid action chunk."""
        model = Pi0Model()
        model.load(device="cpu")
        
        result = model.predict(sample_observation)
        
        assert isinstance(result, ActionChunk)
        assert len(result.actions) == 16  # π0 chunk size
        assert result.inference_time_ms > 0
        assert result.model_version == "0.6.0-stub"
        assert 0.0 <= result.confidence <= 1.0

    def test_predict_action_format(self, sample_observation):
        """Test action format is correct."""
        model = Pi0Model()
        model.load(device="cpu")
        
        result = model.predict(sample_observation)
        
        for action in result.actions:
            assert isinstance(action, Action)
            assert len(action.joint_commands) == 6  # 6 joints
            assert 0.0 <= action.gripper_command <= 1.0
            # Check joint commands are in valid range
            for cmd in action.joint_commands:
                assert -1.0 <= cmd <= 1.0

    def test_predict_smooth_trajectory(self, sample_observation):
        """Test that trajectory is smooth (no sudden jumps)."""
        model = Pi0Model()
        model.load(device="cpu")
        
        result = model.predict(sample_observation)
        
        # Check that adjacent actions don't have huge jumps
        for i in range(len(result.actions) - 1):
            curr = result.actions[i].joint_commands
            next_ = result.actions[i + 1].joint_commands
            for j in range(len(curr)):
                delta = abs(next_[j] - curr[j])
                assert delta < 0.2, f"Joint {j} jumped too much: {delta}"

    def test_predict_batch(self, sample_observation):
        """Test batch prediction."""
        model = Pi0Model()
        model.load(device="cpu")
        
        observations = [sample_observation, sample_observation]
        results = model.predict_batch(observations)
        
        assert len(results) == 2
        for result in results:
            assert isinstance(result, ActionChunk)


# ============================================================================
# OpenVLA Model Tests
# ============================================================================

class TestOpenVLAModel:
    """Test OpenVLA model implementation."""

    def test_model_info(self):
        """Test model info properties."""
        model = OpenVLAModel()
        info = model.model_info
        
        assert info.model_name == "openvla-stub"
        assert info.base_model == "openvla"
        assert info.chunk_size == 8  # OpenVLA uses smaller chunks
        assert info.image_width == 336  # Larger image size

    def test_chunk_size_differs_from_pi0(self):
        """Test that OpenVLA has different chunk size than π0."""
        pi0 = Pi0Model()
        openvla = OpenVLAModel()
        
        assert pi0.chunk_size != openvla.chunk_size
        assert openvla.chunk_size == 8

    def test_predict_returns_8_actions(self, sample_observation):
        """Test that OpenVLA returns 8 actions per chunk."""
        model = OpenVLAModel()
        model.load(device="cpu")
        
        result = model.predict(sample_observation)
        
        assert len(result.actions) == 8

    def test_supported_embodiments_differ(self):
        """Test that supported embodiments differ from π0."""
        pi0 = Pi0Model()
        openvla = OpenVLAModel()
        
        pi0_embodiments = set(pi0.model_info.supported_embodiments)
        openvla_embodiments = set(openvla.model_info.supported_embodiments)
        
        # Should have some differences
        assert pi0_embodiments != openvla_embodiments


# ============================================================================
# GR00T Model Tests
# ============================================================================

class TestGR00TModel:
    """Test GR00T model implementation."""

    def test_model_info(self):
        """Test model info properties."""
        model = GR00TModel()
        info = model.model_info
        
        assert info.model_name == "groot-stub"
        assert info.base_model == "groot"
        assert info.action_dim == 32  # Full humanoid

    def test_load_raises_not_available(self):
        """Test that loading GR00T raises NotAvailableError."""
        model = GR00TModel()
        
        with pytest.raises(GR00TNotAvailableError) as exc:
            model.load(device="cuda")
        
        error_msg = str(exc.value)
        assert "not yet available" in error_msg
        assert "pi0" in error_msg  # Should suggest alternatives

    def test_predict_raises_not_available(self, sample_observation):
        """Test that predict raises NotAvailableError."""
        model = GR00TModel()
        
        with pytest.raises(GR00TNotAvailableError):
            model.predict(sample_observation)


# ============================================================================
# Integration Tests
# ============================================================================

class TestModelIntegration:
    """Integration tests across model types."""

    def test_all_models_implement_interface(self):
        """Test that all models implement VLAModel interface."""
        models = [Pi0Model(), OpenVLAModel(), GR00TModel()]
        
        for model in models:
            assert isinstance(model, VLAModel)
            assert hasattr(model, 'load')
            assert hasattr(model, 'predict')
            assert hasattr(model, 'predict_batch')
            assert hasattr(model, 'unload')
            assert hasattr(model, 'model_info')
            assert hasattr(model, 'chunk_size')

    def test_model_info_returns_valid_data(self):
        """Test that model info contains all required fields."""
        models = [Pi0Model(), OpenVLAModel(), GR00TModel()]
        
        for model in models:
            info = model.model_info
            assert isinstance(info, ModelInfo)
            assert len(info.model_name) > 0
            assert len(info.model_version) > 0
            assert info.action_dim > 0
            assert info.chunk_size > 0
            assert len(info.supported_embodiments) > 0
            assert info.image_width > 0
            assert info.image_height > 0
