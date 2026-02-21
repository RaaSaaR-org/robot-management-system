"""Client configuration loading."""

from dataclasses import dataclass, field
from pathlib import Path

import yaml


@dataclass
class CameraConfig:
    type: str = "opencv"
    index: int = 0
    width: int = 640
    height: int = 480
    fps: int = 30


@dataclass
class RobotConfig:
    type: str = "so101_follower"
    port: str = "/dev/ttyACM0"
    id: str = "my_follower"


@dataclass
class ClientConfig:
    server_url: str = "http://192.168.1.100:8000"
    robot: RobotConfig = field(default_factory=RobotConfig)
    cameras: dict[str, CameraConfig] = field(default_factory=lambda: {"front": CameraConfig()})
    task: str = "Pick up the cube and place it in the bin."
    control_frequency_hz: int = 30
    overlap_inference: bool = True
    jpeg_quality: int = 85
    request_timeout_s: float = 2.0
    max_retries: int = 3
    retry_delay_s: float = 0.5
    simulate: bool = False

    @classmethod
    def from_yaml(cls, path: str | Path = "config.yaml") -> "ClientConfig":
        path = Path(path)
        if not path.exists():
            return cls()

        with open(path) as f:
            data = yaml.safe_load(f) or {}

        # Parse nested robot config
        robot_data = data.pop("robot", {})
        robot = RobotConfig(**robot_data) if robot_data else RobotConfig()

        # Parse nested cameras config
        cameras_data = data.pop("cameras", {})
        cameras = {}
        for name, cam_data in cameras_data.items():
            cameras[name] = CameraConfig(**cam_data)
        if not cameras:
            cameras = {"front": CameraConfig()}

        # Build config with remaining top-level fields
        top_fields = {k: v for k, v in data.items() if k in cls.__dataclass_fields__}
        return cls(robot=robot, cameras=cameras, **top_fields)
