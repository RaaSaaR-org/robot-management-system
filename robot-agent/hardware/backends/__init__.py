"""
@file __init__.py
@description Hardware backends plugin system for VLA inference.
@feature hardware/backends
"""

from .base import VLABackend
from .smolvla_backend import SmolVLABackend

__all__ = ["VLABackend", "SmolVLABackend"]
