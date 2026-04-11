"""
@file __init__.py
@description Hardware backends plugin system for VLA inference.
@feature hardware/backends
@status orphaned
    Only consumed by vla_runner.py, which TASK-146 final 20% orphaned.
"""

from .base import VLABackend
from .smolvla_backend import SmolVLABackend

__all__ = ["VLABackend", "SmolVLABackend"]
