"""
@file render_preview.py
@description Render a single preview frame from a MuJoCo scene.

Loads the scene, resets the environment, renders the front camera,
and saves as a JPEG image. Used to generate environment preview
thumbnails for the simulation UI.

Usage:
    python render_preview.py --output /tmp/preview_so101_tabletop.jpg
"""

import argparse
import logging

from PIL import Image

from envs.so101_tabletop_env import SO101TabletopEnv

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


def render_preview(output_path: str) -> None:
    """Render and save a preview frame of the environment."""
    env = SO101TabletopEnv()
    obs, _ = env.reset(seed=42)  # Fixed seed for consistent preview

    img = Image.fromarray(obs["image"])
    img.save(output_path, format="JPEG", quality=92)
    env.close()

    logger.info(f"Preview saved to {output_path} ({img.size[0]}x{img.size[1]})")


def main():
    parser = argparse.ArgumentParser(description="Render MuJoCo scene preview")
    parser.add_argument("--output", required=True, help="Output JPEG path")
    args = parser.parse_args()

    render_preview(args.output)


if __name__ == "__main__":
    main()
