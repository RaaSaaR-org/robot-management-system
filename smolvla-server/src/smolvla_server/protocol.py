"""Pydantic models for request/response protocol between server and client.

Inlined from the original shared/protocol.py to remove cross-package sys.path hack.
"""

from pydantic import BaseModel, Field


class PredictRequest(BaseModel):
    """Observation payload sent from Pi client to Mac server."""

    images: dict[str, str] = Field(
        ...,
        description="Camera name -> base64-encoded JPEG string",
        examples=[{"front": "<base64>"}],
    )
    state: list[float] = Field(
        ...,
        description="Current joint positions (matches robot DOF)",
        examples=[[0.0, 0.0, 0.0, 0.0, 0.0, 0.0]],
    )
    task: str = Field(
        ...,
        description="Natural language task description",
        examples=["Pick up the cube and place it in the bin."],
    )


class PredictResponse(BaseModel):
    """Action chunk returned from Mac server to Pi client."""

    actions: list[list[float]] = Field(
        ...,
        description="Action chunk: list of action vectors for future timesteps",
    )
    timestamp: float = Field(
        ...,
        description="Server-side timestamp when inference completed",
    )
    inference_time_ms: float = Field(
        ...,
        description="Model forward pass duration in milliseconds",
    )


class HealthResponse(BaseModel):
    """Server health check response."""

    status: str = "ok"
    model_path: str = ""
    device: str = ""
    model_loaded: bool = False


class ConfigResponse(BaseModel):
    """Model configuration response."""

    action_dim: int = Field(..., description="Dimensionality of action vectors")
    chunk_size: int = Field(..., description="Number of actions per chunk")
    camera_names: list[str] = Field(..., description="Expected camera input names")
    state_dim: int = Field(..., description="Expected state vector dimensionality")
