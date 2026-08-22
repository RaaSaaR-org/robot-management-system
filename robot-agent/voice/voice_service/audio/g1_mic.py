"""Unitree G1 microphone backend.

The G1 continuously multicasts its 4-mic-array audio as raw 16 kHz mono
s16le PCM on UDP 239.168.123.161:5555 (robot LAN 192.168.123.0/24). No SDK
needed — a plain socket with an IGMP join on the workstation NIC
(VOICE_G1_LOCAL_IP, e.g. 192.168.123.10 = "Ethernet 3" on GPU_BOX).

For robot-less testing the group may be a unicast address (e.g. 127.0.0.1):
then we simply bind and receive (see scripts/g1_mcast_replayer.py).
Windows note: inbound UDP 5555 must be allowed for python.exe in the
firewall when receiving from the robot.
"""

from __future__ import annotations

import asyncio
import ipaddress
import socket
import struct
import threading
from typing import AsyncIterator

from ..config import FRAME_BYTES, VoiceConfig
from .base import AudioInput

RECV_BUFFER = 65536
QUEUE_MAX_CHUNKS = 512


class G1MulticastMic(AudioInput):
    def __init__(self, config: VoiceConfig) -> None:
        self._group = config.g1_mcast_group
        self._port = config.g1_mcast_port
        self._local_ip = config.g1_local_ip
        self._muted = False
        self._running = False
        self._loop: asyncio.AbstractEventLoop | None = None
        self._queue: asyncio.Queue[bytes | None] | None = None
        self._socket: socket.socket | None = None
        self._thread: threading.Thread | None = None
        self._buf = b""

    async def start(self) -> None:
        self._loop = asyncio.get_running_loop()
        self._queue = asyncio.Queue(maxsize=QUEUE_MAX_CHUNKS)
        self._buf = b""
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        sock.bind(("", self._port))
        joined = ""
        if ipaddress.ip_address(self._group).is_multicast:
            mreq = struct.pack(
                "4s4s",
                socket.inet_aton(self._group),
                socket.inet_aton(self._local_ip),
            )
            sock.setsockopt(socket.IPPROTO_IP, socket.IP_ADD_MEMBERSHIP, mreq)
            joined = f", joined {self._group} via {self._local_ip}"
        sock.settimeout(0.5)  # lets the reader thread notice shutdown
        self._socket = sock
        self._running = True
        self._thread = threading.Thread(target=self._reader, name="g1-mic", daemon=True)
        self._thread.start()
        print(f"[Voice] G1 mic: listening on udp :{self._port}{joined}")

    async def stop(self) -> None:
        self._running = False
        if self._socket is not None:
            self._socket.close()
            self._socket = None
        if self._thread is not None:
            self._thread.join(timeout=2.0)
            self._thread = None
        if self._queue is not None:
            self._queue.put_nowait(None)

    def _reader(self) -> None:
        while self._running and self._socket is not None:
            try:
                data, _addr = self._socket.recvfrom(RECV_BUFFER)
            except socket.timeout:
                continue
            except OSError:
                break  # socket closed during shutdown
            if self._muted or not data:
                continue
            if self._loop is not None:
                self._loop.call_soon_threadsafe(self._enqueue, data)

    def _enqueue(self, data: bytes) -> None:
        try:
            self._queue.put_nowait(data)
        except asyncio.QueueFull:
            pass  # drop rather than lag behind live audio

    async def frames(self) -> AsyncIterator[bytes]:
        while self._running:
            chunk = await self._queue.get()
            if chunk is None:
                break
            self._buf += chunk  # already 16 kHz mono s16le — no resampling
            while len(self._buf) >= FRAME_BYTES:
                yield self._buf[:FRAME_BYTES]
                self._buf = self._buf[FRAME_BYTES:]

    def set_muted(self, muted: bool) -> None:
        self._muted = muted
        if muted:
            self._buf = b""
            if self._loop is not None:
                self._loop.call_soon_threadsafe(self._drain)

    def _drain(self) -> None:
        if self._queue is None:
            return
        while True:
            try:
                self._queue.get_nowait()
            except asyncio.QueueEmpty:
                return
