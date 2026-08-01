"""Tests for the A2A client against an in-process stub JSON-RPC server."""

from __future__ import annotations

import asyncio
import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest

from voice_service.a2a_client import A2AClient, _parse_result
from voice_service.pipeline import VOICE_METADATA_KEY


class StubAgent:
    """Minimal A2A agent: records requests, returns a canned Task result."""

    def __init__(self) -> None:
        self.requests: list[dict] = []
        stub = self

        class Handler(BaseHTTPRequestHandler):
            def do_POST(self) -> None:  # noqa: N802
                length = int(self.headers.get("Content-Length") or 0)
                request = json.loads(self.rfile.read(length))
                stub.requests.append(request)
                text = request["params"]["message"]["parts"][0]["text"]
                if text == "BREAK":
                    body = json.dumps(
                        {"jsonrpc": "2.0", "id": request["id"],
                         "error": {"code": -32000, "message": "boom"}}
                    ).encode()
                else:
                    body = json.dumps(
                        {
                            "jsonrpc": "2.0",
                            "id": request["id"],
                            "result": {
                                "kind": "task",
                                "id": "task-1",
                                "contextId": request["params"]["message"]["contextId"],
                                "status": {
                                    "state": "completed",
                                    "message": {
                                        "kind": "message",
                                        "role": "agent",
                                        "parts": [
                                            {"kind": "text", "text": f"echo: {text}"}
                                        ],
                                    },
                                },
                            },
                        }
                    ).encode()
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def log_message(self, *args: object) -> None:
                pass

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.port = self.server.server_address[1]
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def close(self) -> None:
        self.server.shutdown()
        self.server.server_close()


@pytest.fixture()
def stub() -> StubAgent:
    agent = StubAgent()
    yield agent
    agent.close()


def test_send_and_parse(stub: StubAgent) -> None:
    async def run() -> None:
        client = A2AClient(f"http://127.0.0.1:{stub.port}")
        reply = await client.send("hello robot", "ctx-42")
        assert reply.text == "echo: hello robot"
        assert reply.state == "completed"
        assert reply.task_id == "task-1"
        assert client.last_ok is True
        await client.aclose()

    asyncio.run(run())

    request = stub.requests[0]
    assert request["method"] == "message/send"
    message = request["params"]["message"]
    assert message["kind"] == "message"
    assert message["role"] == "user"
    assert message["contextId"] == "ctx-42"
    assert message["parts"] == [{"kind": "text", "text": "hello robot"}]
    assert message["messageId"]


def test_send_omits_metadata_when_there_is_none(stub: StubAgent) -> None:
    """A plain turn must stay byte-identical to what non-NeoDEM agents expect."""

    async def run() -> None:
        client = A2AClient(f"http://127.0.0.1:{stub.port}")
        await client.send("hello", "ctx-1")
        await client.aclose()

    asyncio.run(run())
    assert "metadata" not in stub.requests[0]["params"]["message"]


def test_send_passes_speech_metadata_through(stub: StubAgent) -> None:
    """The speech hint rides on the message, where an unaware agent ignores it."""

    async def run() -> None:
        client = A2AClient(f"http://127.0.0.1:{stub.port}")
        await client.send(
            "geh zur Tuer",
            "ctx-7",
            {VOICE_METADATA_KEY: {"speech": True, "language": "de"}},
        )
        await client.aclose()

    asyncio.run(run())
    message = stub.requests[0]["params"]["message"]
    assert message["metadata"] == {"neodem/voice": {"speech": True, "language": "de"}}
    # The text and context are untouched by the hint.
    assert message["parts"] == [{"kind": "text", "text": "geh zur Tuer"}]
    assert message["contextId"] == "ctx-7"


def test_jsonrpc_error_raises(stub: StubAgent) -> None:
    async def run() -> None:
        client = A2AClient(f"http://127.0.0.1:{stub.port}")
        with pytest.raises(RuntimeError, match="A2A error"):
            await client.send("BREAK", "ctx-1")
        assert client.last_ok is False
        await client.aclose()

    asyncio.run(run())


def test_connection_refused_marks_unreachable() -> None:
    async def run() -> None:
        client = A2AClient("http://127.0.0.1:9")  # discard port, nothing listens
        client.timeout_s = 2.0
        with pytest.raises(Exception):
            await client.send("hi", "ctx")
        assert client.last_ok is False
        await client.aclose()

    asyncio.run(run())


def test_parse_message_result() -> None:
    reply = _parse_result(
        {
            "kind": "message",
            "taskId": "t-9",
            "parts": [
                {"kind": "text", "text": "part one"},
                {"kind": "data", "data": {}},
                {"kind": "text", "text": "part two"},
            ],
        }
    )
    assert reply.text == "part one\npart two"
    assert reply.state == "completed"


def test_parse_input_required_state() -> None:
    reply = _parse_result(
        {
            "kind": "task",
            "id": "t-1",
            "status": {
                "state": "input-required",
                "message": {"parts": [{"kind": "text", "text": "Which zone?"}]},
            },
        }
    )
    assert reply.state == "input-required"
    assert reply.text == "Which zone?"


def test_parse_unknown_kind_raises() -> None:
    with pytest.raises(RuntimeError, match="unexpected A2A result kind"):
        _parse_result({"kind": "banana"})
