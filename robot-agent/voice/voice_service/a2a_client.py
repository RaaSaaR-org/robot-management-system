"""A2A JSON-RPC client — the robot-agnostic "brain" connector.

Speaks the standard A2A message/send method against any agent root URL
(NeoDEM robot-agent, or any other A2A-compliant agent). Multi-turn memory
is the agent's job, keyed by the contextId we pass.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass

import httpx


@dataclass(slots=True)
class AgentReply:
    text: str
    state: str  # "completed" | "input-required" | "failed" | ...
    task_id: str | None = None


class A2AClient:
    def __init__(self, agent_url: str, timeout_s: float = 90.0) -> None:
        self.agent_url = agent_url if agent_url.endswith("/") else agent_url + "/"
        self.timeout_s = timeout_s
        self.last_ok: bool | None = None
        self._client: httpx.AsyncClient | None = None

    async def send(self, text: str, context_id: str) -> AgentReply:
        if self._client is None:
            self._client = httpx.AsyncClient(timeout=self.timeout_s)
        payload = {
            "jsonrpc": "2.0",
            "id": str(uuid.uuid4()),
            "method": "message/send",
            "params": {
                "message": {
                    "kind": "message",
                    "messageId": str(uuid.uuid4()),
                    "role": "user",
                    "parts": [{"kind": "text", "text": text}],
                    "contextId": context_id,
                }
            },
        }
        try:
            response = await self._client.post(self.agent_url, json=payload)
            response.raise_for_status()
            data = response.json()
        except Exception:
            self.last_ok = False
            raise
        if "error" in data:
            self.last_ok = False
            raise RuntimeError(f"A2A error: {data['error']}")
        self.last_ok = True
        return _parse_result(data.get("result") or {})

    async def check(self) -> bool:
        """Probe the agent card; updates last_ok."""
        if self._client is None:
            self._client = httpx.AsyncClient(timeout=self.timeout_s)
        try:
            response = await self._client.get(
                self.agent_url + ".well-known/agent-card.json", timeout=5.0
            )
            self.last_ok = response.status_code == 200
        except Exception:  # noqa: BLE001
            self.last_ok = False
        return self.last_ok

    async def aclose(self) -> None:
        if self._client is not None:
            await self._client.aclose()
            self._client = None


def _parse_result(result: dict) -> AgentReply:
    """Extract the agent's text from a Task or Message result."""
    kind = result.get("kind")
    if kind == "task":
        status = result.get("status") or {}
        message = status.get("message") or {}
        return AgentReply(
            text=_join_text_parts(message.get("parts") or []),
            state=status.get("state") or "unknown",
            task_id=result.get("id"),
        )
    if kind == "message":
        return AgentReply(
            text=_join_text_parts(result.get("parts") or []),
            state="completed",
            task_id=result.get("taskId"),
        )
    raise RuntimeError(f"unexpected A2A result kind: {kind!r}")


def _join_text_parts(parts: list[dict]) -> str:
    return "\n".join(
        p.get("text", "") for p in parts if p.get("kind") == "text"
    ).strip()
