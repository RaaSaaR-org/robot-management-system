"""
@file base.py
@description Abstract base class for VLA models
@feature vla-inference
"""

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import List, Optional, TYPE_CHECKING

if TYPE_CHECKING:
    from proto import vla_inference_pb2


@dataclass
class ModelInfo:
    """Model metadata for VLA inference."""
    model_name: str
    model_version: str
    action_dim: int
    chunk_size: int
    supported_embodiments: List[str]
    image_width: int
    image_height: int
    base_model: str


@dataclass
class Observation:
    """Robot observation input for inference."""
    camera_image: bytes
    joint_positions: List[float]
    joint_velocities: List[float]
    language_instruction: str
    timestamp: float
    embodiment_tag: str
    session_id: Optional[str] = None


@dataclass
class Action:
    """Single timestep robot action."""
    joint_commands: List[float]
    gripper_command: float
    timestamp: float


@dataclass
class ActionChunk:
    """Predicted action sequence from VLA model."""
    actions: List[Action]
    inference_time_ms: float
    model_version: str
    confidence: float
    sequence_number: int = 0


class VLAModel(ABC):
    """
    Abstract base class for Vision-Language-Action models.
    
    All VLA model implementations (π0.6, OpenVLA, GR00T) must
    inherit from this class and implement all abstract methods.
    
    The interface supports:
    - Model loading/unloading for GPU memory management
    - Single and batched inference
    - Model metadata for client discovery
    """
    
    _loaded: bool = False
    _device: str = "cpu"
    _checkpoint_path: Optional[str] = None
    
    @abstractmethod
    def load(self, checkpoint_path: Optional[str] = None, device: str = "cpu") -> None:
        """
        Load model weights to device.
        
        Args:
            checkpoint_path: Path to model checkpoint (local or HuggingFace)
            device: Target device ("cpu" or "cuda")
        
        Raises:
            RuntimeError: If model fails to load
        """
        pass
    
    @abstractmethod
    def predict(self, observation: Observation) -> ActionChunk:
        """
        Run single inference on observation.
        
        Args:
            observation: Robot sensory state
            
        Returns:
            ActionChunk with predicted future actions
            
        Raises:
            RuntimeError: If model not loaded
        """
        pass
    
    @abstractmethod
    def predict_batch(self, observations: List[Observation]) -> List[ActionChunk]:
        """
        Run batched inference for throughput optimization.
        
        Args:
            observations: List of robot observations
            
        Returns:
            List of ActionChunks, one per observation
            
        Raises:
            RuntimeError: If model not loaded
        """
        pass
    
    @abstractmethod
    def unload(self) -> None:
        """
        Release GPU memory and cleanup resources.
        
        Should be called before loading a different model or
        during graceful shutdown.
        """
        pass
    
    @property
    @abstractmethod
    def model_info(self) -> ModelInfo:
        """Return model metadata for client discovery."""
        pass
    
    @property
    @abstractmethod
    def chunk_size(self) -> int:
        """Number of actions per chunk (e.g., 16 for π0, 8 for OpenVLA)."""
        pass
    
    @property
    def is_loaded(self) -> bool:
        """Check if model is loaded and ready for inference."""
        return self._loaded
    
    @property
    def device(self) -> str:
        """Current device model is loaded on."""
        return self._device
    
    def _check_loaded(self) -> None:
        """Raise error if model not loaded."""
        if not self._loaded:
            raise RuntimeError(
                f"{self.__class__.__name__} model not loaded. "
                "Call load() before predict()."
            )
