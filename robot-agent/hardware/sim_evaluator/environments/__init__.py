"""
Simulation environment configurations.
"""

from .so101_tabletop import SO101_TABLETOP_CONFIG
from .so101_sorting import SO101_SORTING_CONFIG

ENVIRONMENTS = {
    "so101_tabletop": SO101_TABLETOP_CONFIG,
    "so101_sorting": SO101_SORTING_CONFIG,
}

__all__ = ["SO101_TABLETOP_CONFIG", "SO101_SORTING_CONFIG", "ENVIRONMENTS"]
