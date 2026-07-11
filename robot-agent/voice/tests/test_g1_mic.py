"""Tests for the G1 multicast mic backend (unicast loopback, no robot)."""

from __future__ import annotations

import asyncio
import socket

from voice_service.config import FRAME_BYTES, VoiceConfig
from voice_service.audio.g1_mic import G1MulticastMic


def free_udp_port() -> int:
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


def make_mic(port: int) -> G1MulticastMic:
    config = VoiceConfig.from_env(
        env={
            "VOICE_G1_MCAST_GROUP": "127.0.0.1",  # unicast mode for loopback
            "VOICE_G1_MCAST_PORT": str(port),
            "VOICE_G1_LOCAL_IP": "127.0.0.1",
        }
    )
    return G1MulticastMic(config)


def test_receives_and_reframes_packets() -> None:
    port = free_udp_port()
    payload = bytes(range(256)) * 100  # 25600 bytes = 25 frames

    async def run() -> None:
        mic = make_mic(port)
        await mic.start()
        sender = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        # robot-style 5120-byte packets
        for offset in range(0, len(payload), 5120):
            sender.sendto(payload[offset : offset + 5120], ("127.0.0.1", port))
        received = bytearray()
        async def collect() -> None:
            async for frame in mic.frames():
                assert len(frame) == FRAME_BYTES
                received.extend(frame)
                if len(received) >= len(payload):
                    break
        await asyncio.wait_for(collect(), timeout=5.0)
        await mic.stop()
        assert bytes(received[: len(payload)]) == payload

    asyncio.run(run())


def test_muted_drops_at_source() -> None:
    port = free_udp_port()

    async def run() -> None:
        mic = make_mic(port)
        await mic.start()
        mic.set_muted(True)
        sender = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        sender.sendto(b"\x01\x02" * 2560, ("127.0.0.1", port))
        await asyncio.sleep(0.3)
        assert mic._queue.empty()  # nothing buffered while muted
        # unmute and confirm data flows again
        mic.set_muted(False)
        await asyncio.sleep(0.1)
        sender.sendto(b"\x03\x04" * 2560, ("127.0.0.1", port))
        got: list[bytes] = []
        async def collect() -> None:
            async for frame in mic.frames():
                got.append(frame)
                break
        await asyncio.wait_for(collect(), timeout=5.0)
        await mic.stop()
        assert got and got[0][:2] == b"\x03\x04"

    asyncio.run(run())


def test_stop_terminates_frames_iterator() -> None:
    port = free_udp_port()

    async def run() -> None:
        mic = make_mic(port)
        await mic.start()

        async def consume() -> int:
            count = 0
            async for _frame in mic.frames():
                count += 1
            return count

        task = asyncio.create_task(consume())
        await asyncio.sleep(0.2)
        await mic.stop()
        count = await asyncio.wait_for(task, timeout=3.0)
        assert count == 0  # no data was sent

    asyncio.run(run())
