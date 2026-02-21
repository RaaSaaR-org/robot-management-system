"""SO-101 robot hardware interface via LeRobot.

IMPLEMENTER NOTE:
    This module wraps LeRobot's robot classes for the SO-101.
    The LeRobot API may evolve. Key integration points to verify:

    1. How to instantiate an SO-101 follower robot
    2. How to read current joint positions (get_observation)
    3. How to send action commands (send_action)
    4. The exact format of state/action vectors

    Check these LeRobot source files:
    - lerobot/robots/so101_follower.py (or similar)
    - lerobot/common/robot_devices/robots/configs.py
"""

import logging

import numpy as np

logger = logging.getLogger(__name__)


class SO101Robot:
    """Interface to SO-101 follower arm via LeRobot."""

    def __init__(self, robot_type: str, port: str, robot_id: str):
        self.robot_type = robot_type
        self.port = port
        self.robot_id = robot_id
        self.robot = None
        self._connected = False

    def connect(self) -> None:
        """Initialize and connect to the SO-101 robot.

        Uses multi-pattern fallback for LeRobot API compatibility:
        - Pattern A: SO101Follower class (LeRobot 0.4+)
        - Pattern B: Config-based ManipulatorRobot
        - Pattern C: make_robot factory
        """
        logger.info(f"Connecting to {self.robot_type} on {self.port} (id={self.robot_id})")

        # Try Pattern A first (LeRobot 0.4+)
        try:
            from lerobot.common.robots.so101_follower import (
                SO101Follower,
                SO101FollowerConfig,
            )

            config = SO101FollowerConfig(port=self.port, id=self.robot_id)
            self.robot = SO101Follower(config)
            self.robot.connect()
            self._connected = True
            logger.info("Connected via SO101Follower (Pattern A)")
            return
        except (ImportError, AttributeError, TypeError) as e:
            logger.debug(f"Pattern A failed: {e}")

        # Try Pattern B
        try:
            from lerobot.common.robot_devices.robots.configs import So101FollowerConfig
            from lerobot.common.robot_devices.robots.manipulator import ManipulatorRobot

            config = So101FollowerConfig(port=self.port)
            self.robot = ManipulatorRobot(config)
            self.robot.connect()
            self._connected = True
            logger.info("Connected via ManipulatorRobot (Pattern B)")
            return
        except (ImportError, AttributeError, TypeError) as e:
            logger.debug(f"Pattern B failed: {e}")

        # Try Pattern C
        try:
            from lerobot.common.robots.utils import make_robot

            self.robot = make_robot(type=self.robot_type, port=self.port, id=self.robot_id)
            self.robot.connect()
            self._connected = True
            logger.info("Connected via make_robot factory (Pattern C)")
            return
        except (ImportError, AttributeError, TypeError) as e:
            logger.debug(f"Pattern C failed: {e}")

        raise RuntimeError(
            f"Could not connect to SO-101. All patterns failed. "
            f"Check your LeRobot version and SO-101 setup. "
            f"Make sure the robot is calibrated with lerobot-calibrate first."
        )

    def get_state(self) -> list[float]:
        """Read current joint positions from the robot.

        Returns:
            List of joint positions as floats.
        """
        if not self._connected:
            raise RuntimeError("Robot not connected")

        # Try get_observation pattern (returns dict)
        if hasattr(self.robot, "get_observation"):
            obs = self.robot.get_observation()
            # Extract state from observation dict
            if isinstance(obs, dict):
                # Try common key names
                for key in ["observation.state", "state", "qpos"]:
                    if key in obs:
                        val = obs[key]
                        if hasattr(val, "tolist"):
                            return val.tolist()
                        return list(val)
            # If obs is directly a tensor/array
            if hasattr(obs, "tolist"):
                return obs.tolist()

        # Try direct position read
        if hasattr(self.robot, "read_position"):
            pos = self.robot.read_position()
            if hasattr(pos, "tolist"):
                return pos.tolist()
            return list(pos)

        raise RuntimeError("Could not read robot state. Check LeRobot robot API.")

    def send_action(self, action: list[float]) -> None:
        """Send a single action (joint positions/velocities) to the robot.

        Args:
            action: Action vector matching robot DOF.
        """
        if not self._connected:
            raise RuntimeError("Robot not connected")

        # Convert to numpy array for compatibility
        action_array = np.array(action, dtype=np.float32)

        if hasattr(self.robot, "send_action"):
            self.robot.send_action(action_array)
        elif hasattr(self.robot, "set_position"):
            self.robot.set_position(action_array)
        elif hasattr(self.robot, "step"):
            self.robot.step(action_array)
        else:
            raise RuntimeError("Could not find action method on robot. Check LeRobot robot API.")

    def disconnect(self) -> None:
        """Safely disconnect from the robot."""
        if self.robot is not None and self._connected:
            try:
                if hasattr(self.robot, "disconnect"):
                    self.robot.disconnect()
                logger.info("Robot disconnected")
            except Exception as e:
                logger.error(f"Error disconnecting robot: {e}")
            finally:
                self._connected = False

    @property
    def connected(self) -> bool:
        return self._connected
