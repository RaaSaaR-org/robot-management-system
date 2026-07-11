"""Conversation session: one A2A contextId, with timeout and spoken reset."""

from __future__ import annotations

import re
import threading
import time
import uuid

RESET_PHRASES = {
    "new conversation",
    "reset conversation",
    "start over",
    "neues gespraech",
    "neues gespräch",
    "neue unterhaltung",
}

_NORMALIZE_RE = re.compile(r"[^\w\säöüß]", re.UNICODE)


def _normalize(text: str) -> str:
    return _NORMALIZE_RE.sub("", text.lower()).strip()


class Session:
    """Thread-safe holder of the current A2A contextId."""

    def __init__(self, timeout_s: int = 300) -> None:
        self.timeout_s = timeout_s
        self._lock = threading.Lock()
        self._context_id = str(uuid.uuid4())
        self._last_activity = time.monotonic()

    def context_id(self) -> str:
        """Current contextId; silently rotates after timeout_s of inactivity."""
        with self._lock:
            if time.monotonic() - self._last_activity > self.timeout_s:
                self._context_id = str(uuid.uuid4())
            return self._context_id

    def peek(self) -> str:
        """Current contextId without touching or rotating it."""
        with self._lock:
            return self._context_id

    def touch(self) -> None:
        with self._lock:
            self._last_activity = time.monotonic()

    def reset(self) -> str:
        with self._lock:
            self._context_id = str(uuid.uuid4())
            self._last_activity = time.monotonic()
            return self._context_id

    @staticmethod
    def is_reset_command(text: str) -> bool:
        return _normalize(text) in RESET_PHRASES
