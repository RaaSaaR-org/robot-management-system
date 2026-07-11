"""Thread-safe event bus for pipeline events.

The pipeline (asyncio loop) and the HTTP server (threads) both publish and
consume events. Subscribers get an independent queue.Queue; slow consumers
drop events instead of blocking the pipeline. A bounded history feeds
GET /status and late SSE joiners.
"""

from __future__ import annotations

import json
import queue
import threading
import time
from collections import deque
from dataclasses import dataclass, field


@dataclass(slots=True)
class Event:
    type: str
    data: dict = field(default_factory=dict)
    ts: float = field(default_factory=time.time)

    def to_json(self) -> str:
        return json.dumps(
            {"type": self.type, "ts": round(self.ts, 3), **self.data},
            ensure_ascii=False,
        )


class EventBus:
    SUBSCRIBER_QUEUE_SIZE = 256

    def __init__(self, history_size: int = 100) -> None:
        self._lock = threading.Lock()
        self._subscribers: list[queue.Queue[Event]] = []
        self._history: deque[Event] = deque(maxlen=history_size)

    def publish(self, type_: str, **data: object) -> Event:
        event = Event(type=type_, data=dict(data))
        with self._lock:
            self._history.append(event)
            subscribers = list(self._subscribers)
        for q in subscribers:
            try:
                q.put_nowait(event)
            except queue.Full:
                pass  # slow consumer: drop rather than stall the pipeline
        return event

    def subscribe(self) -> "queue.Queue[Event]":
        q: queue.Queue[Event] = queue.Queue(maxsize=self.SUBSCRIBER_QUEUE_SIZE)
        with self._lock:
            self._subscribers.append(q)
        return q

    def unsubscribe(self, q: "queue.Queue[Event]") -> None:
        with self._lock:
            try:
                self._subscribers.remove(q)
            except ValueError:
                pass

    def history(self, limit: int = 20) -> list[Event]:
        with self._lock:
            return list(self._history)[-limit:]
