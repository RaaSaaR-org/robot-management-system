"""Server configuration loading."""

from dataclasses import dataclass
from pathlib import Path

import yaml


@dataclass
class ServerConfig:
    model_path: str = "lerobot/smolvla_base"
    device: str = "mps"
    host: str = "0.0.0.0"
    port: int = 8000
    default_task: str = "Pick up the cube and place it in the bin."
    stub: bool = False

    @classmethod
    def from_yaml(cls, path: str | Path = "config.yaml") -> "ServerConfig":
        path = Path(path)
        if path.exists():
            with open(path) as f:
                data = yaml.safe_load(f) or {}
            return cls(**{k: v for k, v in data.items() if k in cls.__dataclass_fields__})
        return cls()
