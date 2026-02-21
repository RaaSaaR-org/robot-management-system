"""Camera capture and JPEG encoding for transmission to inference server."""

import base64
import logging

import cv2
import numpy as np

from .config import CameraConfig

logger = logging.getLogger(__name__)


class CameraCapture:
    """Manages OpenCV camera capture and JPEG encoding."""

    def __init__(self, name: str, config: CameraConfig):
        self.name = name
        self.config = config
        self.cap: cv2.VideoCapture | None = None
        self._last_frame: np.ndarray | None = None

    def connect(self) -> None:
        """Open the camera device."""
        logger.info(f"Opening camera '{self.name}' at index {self.config.index}")
        self.cap = cv2.VideoCapture(self.config.index)

        if not self.cap.isOpened():
            raise RuntimeError(
                f"Failed to open camera '{self.name}' at index {self.config.index}. "
                f"Run `lerobot-find-cameras opencv` to list available cameras."
            )

        self.cap.set(cv2.CAP_PROP_FRAME_WIDTH, self.config.width)
        self.cap.set(cv2.CAP_PROP_FRAME_HEIGHT, self.config.height)
        self.cap.set(cv2.CAP_PROP_FPS, self.config.fps)

        # Read a test frame
        ret, frame = self.cap.read()
        if not ret:
            raise RuntimeError(f"Camera '{self.name}' opened but failed to capture test frame.")

        actual_w = int(self.cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        actual_h = int(self.cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        logger.info(f"Camera '{self.name}' ready: {actual_w}x{actual_h}")

    def capture_frame(self) -> np.ndarray:
        """Capture a single BGR frame from the camera.

        Returns the latest frame. If capture fails, returns the last valid frame.
        """
        if self.cap is None:
            raise RuntimeError(f"Camera '{self.name}' not connected. Call connect() first.")

        ret, frame = self.cap.read()
        if ret:
            self._last_frame = frame
            return frame

        if self._last_frame is not None:
            logger.warning(f"Camera '{self.name}' frame drop, reusing last frame")
            return self._last_frame

        raise RuntimeError(f"Camera '{self.name}' capture failed with no fallback frame.")

    def capture_jpeg_b64(self, quality: int = 85) -> str:
        """Capture a frame and return as base64-encoded JPEG string.

        Args:
            quality: JPEG compression quality (1-100).

        Returns:
            Base64-encoded JPEG string ready for JSON transmission.
        """
        frame = self.capture_frame()
        encode_params = [cv2.IMWRITE_JPEG_QUALITY, quality]
        success, jpeg_bytes = cv2.imencode(".jpg", frame, encode_params)

        if not success:
            raise RuntimeError(f"Failed to JPEG-encode frame from camera '{self.name}'")

        return base64.b64encode(jpeg_bytes.tobytes()).decode("ascii")

    def disconnect(self) -> None:
        """Release the camera device."""
        if self.cap is not None:
            self.cap.release()
            self.cap = None
            logger.info(f"Camera '{self.name}' released")


class CameraManager:
    """Manages multiple cameras."""

    def __init__(self, cameras_config: dict[str, CameraConfig]):
        self.cameras: dict[str, CameraCapture] = {
            name: CameraCapture(name, cfg) for name, cfg in cameras_config.items()
        }

    def connect_all(self) -> None:
        for cam in self.cameras.values():
            cam.connect()

    def capture_all_b64(self, quality: int = 85) -> dict[str, str]:
        """Capture from all cameras, return dict of name -> base64 JPEG."""
        return {name: cam.capture_jpeg_b64(quality) for name, cam in self.cameras.items()}

    def disconnect_all(self) -> None:
        for cam in self.cameras.values():
            cam.disconnect()
