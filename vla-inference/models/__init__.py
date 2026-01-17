"""
@file __init__.py
@description VLA model factory and exports
@feature vla-inference
"""

from typing import TYPE_CHECKING

from .base import (
    VLAModel,
    ModelInfo,
    Observation,
    Action,
    ActionChunk,
)

if TYPE_CHECKING:
    from .pi0 import Pi0Model
    from .openvla import OpenVLAModel
    from .groot import GR00TModel


def create_model(model_type: str) -> VLAModel:
    """
    Factory function to create VLA model instances.
    
    Args:
        model_type: One of "pi0", "openvla", "groot"
        
    Returns:
        VLAModel instance
        
    Raises:
        ValueError: If model_type is unknown
    """
    # Import here to avoid circular imports
    from .pi0 import Pi0Model
    from .openvla import OpenVLAModel
    from .groot import GR00TModel
    
    model_map = {
        "pi0": Pi0Model,
        "pi0_6": Pi0Model,  # Alias
        "openvla": OpenVLAModel,
        "groot": GR00TModel,
    }
    
    model_type_lower = model_type.lower()
    if model_type_lower not in model_map:
        available = ", ".join(sorted(set(model_map.keys())))
        raise ValueError(
            f"Unknown model type: {model_type}. "
            f"Available: {available}"
        )
    
    return model_map[model_type_lower]()


__all__ = [
    # Base classes
    "VLAModel",
    "ModelInfo",
    "Observation",
    "Action",
    "ActionChunk",
    # Factory
    "create_model",
]
