"""
@file config.py
@description VLA inference server configuration management
@feature vla-inference
"""

import os
import logging
from dataclasses import dataclass, field
from typing import Optional, List

logger = logging.getLogger(__name__)


@dataclass
class VLAConfig:
    """
    Configuration for VLA inference server.
    
    All values can be overridden via environment variables.
    """
    
    # Model selection
    model_type: str = "pi0"
    model_path: Optional[str] = None
    
    # Device configuration
    device: str = "cpu"
    
    # Inference settings
    batch_size: int = 1
    max_batch_wait_ms: int = 10
    timeout_ms: int = 5000
    
    # Image preprocessing
    image_width: int = 224
    image_height: int = 224
    
    # Action configuration
    action_dim: int = 7
    chunk_size: int = 16
    
    # Server settings
    grpc_port: int = 50051
    max_workers: int = 4
    max_message_size_mb: int = 16
    
    # Health check
    health_check_interval_s: int = 30
    
    # Metrics
    metrics_enabled: bool = True
    metrics_port: int = 9090
    
    @classmethod
    def from_env(cls) -> 'VLAConfig':
        """
        Create configuration from environment variables.
        
        Environment variables (all optional):
            VLA_MODEL_TYPE: Model to use (pi0, openvla, groot)
            VLA_MODEL_PATH: Path to model checkpoint
            VLA_DEVICE: Device (cpu, cuda, cuda:0)
            VLA_BATCH_SIZE: Max batch size for inference
            VLA_MAX_BATCH_WAIT_MS: Max wait for batch formation
            VLA_TIMEOUT_MS: Request timeout
            VLA_IMAGE_WIDTH: Expected input image width
            VLA_IMAGE_HEIGHT: Expected input image height
            VLA_ACTION_DIM: Action space dimensionality
            VLA_CHUNK_SIZE: Actions per chunk
            VLA_GRPC_PORT: gRPC server port
            VLA_MAX_WORKERS: gRPC worker threads
            VLA_MAX_MESSAGE_SIZE_MB: Max gRPC message size
            VLA_HEALTH_CHECK_INTERVAL_S: Health check interval
            VLA_METRICS_ENABLED: Enable Prometheus metrics
            VLA_METRICS_PORT: Prometheus metrics port
        """
        config = cls(
            model_type=os.getenv("VLA_MODEL_TYPE", "pi0"),
            model_path=os.getenv("VLA_MODEL_PATH"),
            device=os.getenv("VLA_DEVICE", "cpu"),
            batch_size=int(os.getenv("VLA_BATCH_SIZE", "1")),
            max_batch_wait_ms=int(os.getenv("VLA_MAX_BATCH_WAIT_MS", "10")),
            timeout_ms=int(os.getenv("VLA_TIMEOUT_MS", "5000")),
            image_width=int(os.getenv("VLA_IMAGE_WIDTH", "224")),
            image_height=int(os.getenv("VLA_IMAGE_HEIGHT", "224")),
            action_dim=int(os.getenv("VLA_ACTION_DIM", "7")),
            chunk_size=int(os.getenv("VLA_CHUNK_SIZE", "16")),
            grpc_port=int(os.getenv("VLA_GRPC_PORT", "50051")),
            max_workers=int(os.getenv("VLA_MAX_WORKERS", "4")),
            max_message_size_mb=int(os.getenv("VLA_MAX_MESSAGE_SIZE_MB", "16")),
            health_check_interval_s=int(os.getenv("VLA_HEALTH_CHECK_INTERVAL_S", "30")),
            metrics_enabled=os.getenv("VLA_METRICS_ENABLED", "true").lower() == "true",
            metrics_port=int(os.getenv("VLA_METRICS_PORT", "9090")),
        )
        
        logger.info(f"Loaded configuration: {config}")
        return config
        
    def validate(self) -> List[str]:
        """
        Validate configuration values.
        
        Returns:
            List of validation error messages (empty if valid)
        """
        errors = []
        
        valid_models = ["pi0", "pi0_6", "openvla", "groot"]
        if self.model_type.lower() not in valid_models:
            errors.append(f"Invalid model_type: {self.model_type}. Valid: {valid_models}")
            
        valid_devices = ["cpu", "cuda"] + [f"cuda:{i}" for i in range(8)]
        if self.device not in valid_devices:
            errors.append(f"Invalid device: {self.device}. Valid: cpu, cuda, cuda:N")
            
        if self.batch_size < 1:
            errors.append(f"batch_size must be >= 1, got {self.batch_size}")
            
        if self.grpc_port < 1 or self.grpc_port > 65535:
            errors.append(f"grpc_port must be 1-65535, got {self.grpc_port}")
            
        if self.max_workers < 1:
            errors.append(f"max_workers must be >= 1, got {self.max_workers}")
            
        return errors
        
    def log_config(self) -> None:
        """Log configuration in structured format."""
        logger.info("=" * 60)
        logger.info("VLA Inference Server Configuration")
        logger.info("=" * 60)
        logger.info(f"  Model Type:     {self.model_type}")
        logger.info(f"  Model Path:     {self.model_path or 'default'}")
        logger.info(f"  Device:         {self.device}")
        logger.info(f"  Batch Size:     {self.batch_size}")
        logger.info(f"  Chunk Size:     {self.chunk_size}")
        logger.info(f"  gRPC Port:      {self.grpc_port}")
        logger.info(f"  Max Workers:    {self.max_workers}")
        logger.info(f"  Metrics:        {'enabled' if self.metrics_enabled else 'disabled'}")
        if self.metrics_enabled:
            logger.info(f"  Metrics Port:   {self.metrics_port}")
        logger.info("=" * 60)


# Singleton configuration instance
_config: Optional[VLAConfig] = None


def get_config() -> VLAConfig:
    """
    Get the global configuration instance.
    
    Creates from environment on first call.
    """
    global _config
    if _config is None:
        _config = VLAConfig.from_env()
    return _config


def reset_config() -> None:
    """Reset configuration (for testing)."""
    global _config
    _config = None
