"""Dump the G1 mic multicast to a WAV file and report signal quality.

Step 3 of TASK-181: before running the full pipeline against the robot, we
want to know whether the multicast even arrives (IGMP join + firewall) and
whether the 4-mic array signal is usable (level, clipping, silence).

    uv run python scripts/g1_mic_dump.py --seconds 15
    uv run python scripts/g1_mic_dump.py --seconds 15 --out out/g1_mic.wav

Defaults match the robot: group 239.168.123.161, port 5555, joined via the
NIC given by --local-ip (GPU_BOX: 192.168.123.10 = "Ethernet 3"). Env vars
VOICE_G1_MCAST_GROUP / _PORT / VOICE_G1_LOCAL_IP override the defaults.

If no packets arrive, the usual causes are, in order: Windows Firewall
blocks inbound UDP 5555 for this python.exe; --local-ip is not the robot-LAN
NIC; the robot is off or on a different LAN.
"""

from __future__ import annotations

import argparse
import ipaddress
import socket
import struct
import sys
import time
import wave
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from voice_service.config import PIPELINE_SAMPLE_RATE, VoiceConfig

RECV_BUFFER = 65536
FULL_SCALE = 32768.0
# Below this RMS the capture is almost certainly not room audio but a dead
# channel; the robot's own fan floor already sits well above it.
SILENT_RMS_DBFS = -60.0


def open_socket(group: str, port: int, local_ip: str) -> socket.socket:
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    sock.bind(("", port))
    if ipaddress.ip_address(group).is_multicast:
        mreq = struct.pack("4s4s", socket.inet_aton(group), socket.inet_aton(local_ip))
        sock.setsockopt(socket.IPPROTO_IP, socket.IP_ADD_MEMBERSHIP, mreq)
        print(f"joined {group} via {local_ip}")
    sock.settimeout(1.0)
    return sock


def analyse(pcm: bytes) -> dict:
    import numpy as np

    samples = np.frombuffer(pcm, dtype="<i2").astype("float32") / FULL_SCALE
    if samples.size == 0:
        return {}
    rms = float(np.sqrt(np.mean(samples**2)))
    peak = float(np.max(np.abs(samples)))
    to_db = lambda x: 20 * np.log10(x) if x > 0 else float("-inf")  # noqa: E731
    return {
        "seconds": samples.size / PIPELINE_SAMPLE_RATE,
        "rms_dbfs": to_db(rms),
        "peak_dbfs": to_db(peak),
        "clipped_pct": 100.0 * float(np.mean(np.abs(samples) >= 0.999)),
    }


def main() -> int:
    cfg = VoiceConfig.from_env()
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--seconds", type=float, default=10.0)
    parser.add_argument("--out", type=Path, default=Path("out/g1_mic_dump.wav"))
    parser.add_argument("--group", default=cfg.g1_mcast_group)
    parser.add_argument("--port", type=int, default=cfg.g1_mcast_port)
    parser.add_argument("--local-ip", default=cfg.g1_local_ip)
    args = parser.parse_args()

    sock = open_socket(args.group, args.port, args.local_ip)
    print(f"capturing {args.seconds:.0f}s from udp://{args.group}:{args.port} — speak now")

    chunks: list[bytes] = []
    packets = 0
    deadline = time.monotonic() + args.seconds
    first_packet_at: float | None = None
    last_packet_at = 0.0
    while time.monotonic() < deadline:
        try:
            data, addr = sock.recvfrom(RECV_BUFFER)
        except socket.timeout:
            continue
        last_packet_at = time.monotonic()
        if first_packet_at is None:
            first_packet_at = last_packet_at
            print(f"first packet from {addr[0]} ({len(data)} B)")
        chunks.append(data)
        packets += 1
    sock.close()

    if not packets:
        print("\nNO PACKETS RECEIVED — check, in this order:")
        print("  1. firewall: inbound UDP 5555 allowed for this python.exe?")
        print(f"  2. --local-ip {args.local_ip} is the robot-LAN NIC? (ipconfig)")
        print("  3. robot powered and on 192.168.123.0/24? (ping 192.168.123.164)")
        return 1

    pcm = b"".join(chunks)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(args.out), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(PIPELINE_SAMPLE_RATE)
        w.writeframes(pcm)

    stats = analyse(pcm)
    # Measure against the span the stream actually covered, not the capture
    # window: a source that stops early (the replayer) or starts late is not
    # the same failure as a stream that drops packets while running.
    span = last_packet_at - first_packet_at if first_packet_at else 0.0
    print(f"\nwrote {args.out} ({len(pcm)} B)")
    print(f"  packets     {packets} ({packets / span if span else 0:.1f}/s, "
          f"{len(pcm) / max(packets, 1):.0f} B avg)")
    print(f"  audio       {stats['seconds']:.1f}s over a {span:.1f}s stream span "
          f"({args.seconds:.0f}s window)")
    print(f"  level       rms {stats['rms_dbfs']:.1f} dBFS, peak {stats['peak_dbfs']:.1f} dBFS")
    print(f"  clipping    {stats['clipped_pct']:.2f}% of samples at full scale")

    # A stream that arrives but carries no audio looks identical to a healthy
    # one from the socket's point of view — call it out explicitly.
    if stats["rms_dbfs"] < SILENT_RMS_DBFS:
        print("\nWARNING: stream is effectively silent — mics muted or wrong source?")
    if stats["clipped_pct"] > 1.0:
        print("\nWARNING: heavy clipping — lower the robot's mic gain or move back.")
    if span > 1.0 and stats["seconds"] < span * 0.9:
        print("\nWARNING: gaps mid-stream (dropped packets) — check the LAN.")
    if span < args.seconds * 0.9:
        print(f"\nNOTE: the stream stopped {args.seconds - span:.1f}s before the window "
              "closed — expected with the replayer, but on the real robot it means "
              "the multicast is not continuous.")
    print(f"\nListen back:  start {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
