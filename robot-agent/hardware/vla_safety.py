"""
@file vla_safety.py
@description Safety monitoring module for VLA-based robot arm control.

Provides four safety components that wrap the VLA control loop:
  1. ActionValidator   — Joint-limit checks (clip or reject)
  2. MovementRateLimiter — Limits per-step deltas to prevent jerky motion
  3. NetworkWatchdog   — Monitors VLA server latency, triggers stop on timeout
  4. GracefulDegradation — Safe stop / hold-position on failures

Safety pipeline order:  validate → rate_limit → apply
"""

import logging
import time
import threading
from collections import deque

logger = logging.getLogger(__name__)


class ActionValidator:
    """Validates VLA-generated actions before they are applied to the arm."""

    # SO-101 Joint Limits (degrees) — from calibration
    JOINT_LIMITS: dict[str, tuple[float, float]] = {
        "shoulder_pan":  (-150.0, 150.0),
        "shoulder_lift": (-180.0, 180.0),
        "elbow_flex":    (-180.0, 180.0),
        "wrist_flex":    (-90.0, 90.0),
        "wrist_roll":    (-180.0, 180.0),
        "gripper":       (-10.0, 100.0),
    }

    DEFAULT_JOINT_NAMES: list[str] = [
        "shoulder_pan", "shoulder_lift", "elbow_flex",
        "wrist_flex", "wrist_roll", "gripper",
    ]

    def __init__(self):
        self._validated: int = 0
        self._rejected: int = 0
        self._clipped: int = 0
        self._lock = threading.Lock()

    @property
    def stats(self) -> dict:
        with self._lock:
            return {
                "validated": self._validated,
                "rejected": self._rejected,
                "clipped": self._clipped,
            }

    def validate(
        self, action: list[float], joint_names: list[str] | None = None
    ) -> tuple[bool, str]:
        """Check whether all joint values are within limits.

        Returns (is_valid, reason).
        """
        names = joint_names or self.DEFAULT_JOINT_NAMES
        if len(action) != len(names):
            with self._lock:
                self._rejected += 1
            return False, f"action length {len(action)} != joint count {len(names)}"

        for i, name in enumerate(names):
            lo, hi = self.JOINT_LIMITS.get(name, (-360.0, 360.0))
            if action[i] < lo or action[i] > hi:
                with self._lock:
                    self._rejected += 1
                return False, f"{name}={action[i]:.2f} outside [{lo}, {hi}]"

        with self._lock:
            self._validated += 1
        return True, ""

    def clip(
        self, action: list[float], joint_names: list[str] | None = None
    ) -> list[float]:
        """Clip action values to joint limits (safer than rejecting).

        Returns the clipped action. Increments clipped counter if any
        value was actually changed.
        """
        names = joint_names or self.DEFAULT_JOINT_NAMES
        clipped = list(action)
        was_clipped = False

        for i, name in enumerate(names):
            if i >= len(clipped):
                break
            lo, hi = self.JOINT_LIMITS.get(name, (-360.0, 360.0))
            if clipped[i] < lo:
                clipped[i] = lo
                was_clipped = True
            elif clipped[i] > hi:
                clipped[i] = hi
                was_clipped = True

        with self._lock:
            if was_clipped:
                self._clipped += 1
            self._validated += 1
        return clipped


class MovementRateLimiter:
    """Rate-limits the magnitude of movements between consecutive actions.

    Prevents jerky motion by capping the per-step delta for each joint.
    """

    MAX_DELTA_PER_STEP = 10.0  # degrees per action step (default)

    def __init__(self, max_delta: float = 10.0):
        self.max_delta = max_delta
        self._last_action: list[float] | None = None
        self._lock = threading.Lock()

    def check(self, action: list[float]) -> tuple[bool, str]:
        """Check whether the delta from last action is within limits.

        Returns (is_safe, reason). First action always passes.
        """
        with self._lock:
            if self._last_action is None:
                return True, ""

            for i, val in enumerate(action):
                if i >= len(self._last_action):
                    break
                delta = abs(val - self._last_action[i])
                if delta > self.max_delta:
                    return False, (
                        f"joint[{i}] delta={delta:.2f} > max_delta={self.max_delta}"
                    )
        return True, ""

    def clip(self, action: list[float]) -> list[float]:
        """Clip action to max delta from last position.

        Safer than blocking — the arm moves towards the target but at
        a controlled speed. Updates last_action to the clipped result.
        """
        with self._lock:
            if self._last_action is None:
                self._last_action = list(action)
                return list(action)

            clipped = list(action)
            for i in range(min(len(clipped), len(self._last_action))):
                delta = clipped[i] - self._last_action[i]
                if abs(delta) > self.max_delta:
                    sign = 1.0 if delta > 0 else -1.0
                    clipped[i] = self._last_action[i] + sign * self.max_delta

            self._last_action = list(clipped)
            return clipped

    def update(self, action: list[float]) -> None:
        """Record an action without clipping (e.g. after external apply)."""
        with self._lock:
            self._last_action = list(action)

    def reset(self) -> None:
        """Reset state (e.g. after stop/start)."""
        with self._lock:
            self._last_action = None


class NetworkWatchdog:
    """Monitors VLA server response times.

    Triggers unhealthy status if recent requests exceed the timeout threshold.
    Uses a sliding window of the last N latencies.
    """

    WINDOW_SIZE = 10
    TIMEOUT_MS = 100.0  # default threshold

    def __init__(self, timeout_ms: float = 100.0, window_size: int = 10):
        self.timeout_ms = timeout_ms
        self._window: deque[float] = deque(maxlen=window_size)
        self._lock = threading.Lock()

    def record_latency(self, latency_ms: float) -> None:
        """Track a single request latency."""
        with self._lock:
            self._window.append(latency_ms)

    def is_healthy(self) -> bool:
        """Returns False if the majority of recent requests exceeded timeout."""
        with self._lock:
            if not self._window:
                return True
            exceeded = sum(1 for lat in self._window if lat > self.timeout_ms)
            # Unhealthy if more than half of the window exceeds timeout
            return exceeded <= len(self._window) // 2

    @property
    def last_latency_ms(self) -> float | None:
        """Return the most recent latency measurement."""
        with self._lock:
            return self._window[-1] if self._window else None

    @property
    def avg_latency_ms(self) -> float | None:
        """Return average latency over the window."""
        with self._lock:
            if not self._window:
                return None
            return sum(self._window) / len(self._window)

    def reset(self) -> None:
        """Reset after reconnect or configuration change."""
        with self._lock:
            self._window.clear()


class GracefulDegradation:
    """Handles graceful degradation when safety checks fail.

    Posts /stop to the sidecar and tracks degradation events.
    """

    def __init__(self):
        self._last_good_action: list[float] | None = None
        self._events: list[dict] = []
        self._lock = threading.Lock()

    def record_good_action(self, action: list[float]) -> None:
        """Store the last known good action for hold-position."""
        with self._lock:
            self._last_good_action = list(action)

    def safe_stop(self, reason: str, sidecar_url: str = "http://localhost:8765") -> bool:
        """Post /stop or /vla/stop to sidecar and log reason.

        Returns True if the stop command was sent successfully.
        """
        import httpx

        event = {
            "type": "safe_stop",
            "reason": reason,
            "timestamp": time.time(),
        }

        with self._lock:
            self._events.append(event)

        logger.warning(f"[Safety] Graceful degradation — safe_stop: {reason}")

        try:
            resp = httpx.post(
                f"{sidecar_url}/vla/stop",
                timeout=5.0,
            )
            resp.raise_for_status()
            return True
        except Exception as e:
            logger.error(f"[Safety] Failed to send stop to sidecar: {e}")
            return False

    def hold_position(self) -> list[float] | None:
        """Return last known good position for hold-in-place behavior."""
        with self._lock:
            if self._last_good_action is not None:
                return list(self._last_good_action)
            return None

    @property
    def events(self) -> list[dict]:
        """Return a copy of degradation events."""
        with self._lock:
            return list(self._events)

    def clear_events(self) -> None:
        """Clear degradation event history."""
        with self._lock:
            self._events.clear()
