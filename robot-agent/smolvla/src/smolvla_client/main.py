"""SmolVLA Remote Client — Main control loop.

Captures observations from SO-101 + camera on the Raspberry Pi,
sends them to the Mac inference server, and executes returned actions.

Usage:
    python -m smolvla_client.main
    python -m smolvla_client.main --config path/to/config.yaml
"""

import argparse
import logging
import signal
import sys
import time
from pathlib import Path

from .config import ClientConfig
from .remote import RemoteInferenceClient

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)


class EmergencyStop(Exception):
    """Raised when emergency stop is triggered."""


class ControlLoop:
    """Main robot control loop with remote inference."""

    def __init__(self, config: ClientConfig):
        self.config = config

        if config.simulate:
            from .simulation import SimulatedCameraManager, SimulatedRobot

            self.robot = SimulatedRobot()
            self.cameras = SimulatedCameraManager(config.cameras)
        else:
            from .camera import CameraManager
            from .robot import SO101Robot

            self.robot = SO101Robot(
                robot_type=config.robot.type,
                port=config.robot.port,
                robot_id=config.robot.id,
            )
            self.cameras = CameraManager(config.cameras)

        self.client = RemoteInferenceClient(
            server_url=config.server_url,
            timeout_s=config.request_timeout_s,
            max_retries=config.max_retries,
            retry_delay_s=config.retry_delay_s,
        )
        self._running = False
        self._step_duration = 1.0 / config.control_frequency_hz

    def setup(self) -> None:
        """Initialize all hardware and verify server connection."""
        logger.info("=" * 60)
        logger.info("SmolVLA Remote Client")
        logger.info(f"  Server: {self.config.server_url}")
        logger.info(f"  Robot:  {self.config.robot.type} @ {self.config.robot.port}")
        logger.info(f"  Task:   {self.config.task}")
        logger.info("=" * 60)

        # 1. Check server is reachable
        logger.info("Checking server health...")
        try:
            health = self.client.health_check()
            if not health.get("model_loaded"):
                raise RuntimeError("Server is up but model is not loaded yet. Wait and retry.")
            logger.info(f"Server OK — model: {health.get('model_path')}, device: {health.get('device')}")
        except Exception as e:
            raise RuntimeError(
                f"Cannot reach inference server at {self.config.server_url}. "
                f"Make sure the server is running on your Mac. Error: {e}"
            ) from e

        # 2. Get model config
        try:
            model_config = self.client.get_config()
            logger.info(
                f"Model config — action_dim: {model_config['action_dim']}, "
                f"chunk_size: {model_config['chunk_size']}, "
                f"cameras: {model_config['camera_names']}"
            )
        except Exception as e:
            logger.warning(f"Could not fetch model config: {e}. Proceeding with defaults.")

        # 3. Connect cameras
        logger.info("Connecting cameras...")
        self.cameras.connect_all()

        # 4. Connect robot
        logger.info("Connecting robot...")
        self.robot.connect()

        logger.info("Setup complete. Ready to run.")

    def run(self) -> None:
        """Execute the main control loop.

        Loop:
            1. Capture camera frames + joint state
            2. Send to server for inference
            3. Execute returned action chunk at control frequency
            4. Repeat

        Press Ctrl+C for emergency stop.
        """
        self._running = True
        episode_step = 0
        actions_remaining: list[list[float]] = []

        # Reset policy state on server
        self.client.reset_policy()

        logger.info("Starting control loop (Ctrl+C to stop)...")
        logger.info(f"Control frequency: {self.config.control_frequency_hz} Hz "
                     f"(step duration: {self._step_duration * 1000:.1f} ms)")

        try:
            while self._running:
                loop_start = time.perf_counter()

                # If we have remaining actions from previous chunk, execute next one
                if actions_remaining:
                    action = actions_remaining.pop(0)
                    self.robot.send_action(action)
                    episode_step += 1

                    # If overlap enabled AND we're partway through the chunk,
                    # start fetching next prediction
                    if (
                        self.config.overlap_inference
                        and len(actions_remaining) == 1
                    ):
                        # Prefetch: capture + predict while executing last action
                        next_response = self._fetch_prediction()
                        if next_response:
                            # We'll use this as the next chunk after current one finishes
                            actions_remaining.extend(next_response["actions"])

                else:
                    # No actions remaining — need new prediction
                    response = self._fetch_prediction()
                    if response:
                        actions_remaining = response["actions"]
                        logger.info(
                            f"Step {episode_step}: Got {len(actions_remaining)} actions "
                            f"(inference: {response['inference_time_ms']:.1f}ms)"
                        )
                        # Execute first action immediately
                        if actions_remaining:
                            action = actions_remaining.pop(0)
                            self.robot.send_action(action)
                            episode_step += 1
                    else:
                        # Server unreachable — hold position
                        logger.warning(f"Step {episode_step}: No prediction, holding position")

                # Maintain control frequency
                elapsed = time.perf_counter() - loop_start
                sleep_time = self._step_duration - elapsed
                if sleep_time > 0:
                    time.sleep(sleep_time)
                else:
                    logger.debug(
                        f"Control loop overrun: {elapsed * 1000:.1f}ms "
                        f"(budget: {self._step_duration * 1000:.1f}ms)"
                    )

        except (KeyboardInterrupt, EmergencyStop):
            logger.warning("EMERGENCY STOP — halting robot")
        finally:
            self._running = False
            logger.info(f"Control loop ended after {episode_step} steps")

    def _fetch_prediction(self) -> dict | None:
        """Capture observation and request prediction from server."""
        # Capture camera frames as base64 JPEG
        images = self.cameras.capture_all_b64(quality=self.config.jpeg_quality)

        # Read current joint positions
        state = self.robot.get_state()

        # Send to server
        return self.client.predict(
            images=images,
            state=state,
            task=self.config.task,
        )

    def teardown(self) -> None:
        """Clean up all resources."""
        logger.info("Tearing down...")
        self.cameras.disconnect_all()
        self.robot.disconnect()
        self.client.close()
        logger.info("Teardown complete.")


def main():
    parser = argparse.ArgumentParser(description="SmolVLA Remote Client for SO-101")
    parser.add_argument(
        "--config",
        type=str,
        default="config.yaml",
        help="Path to client config YAML",
    )
    args = parser.parse_args()

    config = ClientConfig.from_yaml(args.config)

    loop = ControlLoop(config)

    # Handle Ctrl+C gracefully
    def signal_handler(sig, frame):
        logger.warning("Interrupt received, stopping...")
        loop._running = False

    signal.signal(signal.SIGINT, signal_handler)
    signal.signal(signal.SIGTERM, signal_handler)

    try:
        loop.setup()
        loop.run()
    except Exception as e:
        logger.error(f"Fatal error: {e}", exc_info=True)
        sys.exit(1)
    finally:
        loop.teardown()


if __name__ == "__main__":
    main()
