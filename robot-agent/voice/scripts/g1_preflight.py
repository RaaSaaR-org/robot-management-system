"""Robot-day preflight for TASK-181 — check every prerequisite in one shot.

    uv run python scripts/g1_preflight.py

Checks, in dependency order: robot-LAN NIC, robot reachable, mic multicast
arriving, audio adapter (:8766), robot-agent A2A (:41244), Ollama, voice
models on disk, CUDA. Each check prints OK / FAIL with the fix to apply.
Exit code 0 only if everything needed for a full round trip is up.

Nothing here talks to the robot's motion stack — it is read-only plus the
speaker/LED, per the Stage-1 read-only directive in TASK-169.
"""

from __future__ import annotations

import ipaddress
import os
import socket
import struct
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from voice_service.config import VoiceConfig

ROBOT_IP = os.environ.get("G1_ROBOT_IP", "192.168.123.164")
OLLAMA_URL = os.environ.get("OLLAMA_URL", "http://localhost:11434")

def _supports_colour() -> bool:
    if not sys.stdout.isatty():
        return False  # piped/captured — plain text stays readable
    if sys.platform == "win32":
        # Enable VT processing; older consoles need it turned on explicitly.
        import ctypes

        kernel32 = ctypes.windll.kernel32
        return bool(kernel32.SetConsoleMode(kernel32.GetStdHandle(-11), 7))
    return True


if _supports_colour():
    GREEN, RED, YELLOW, RESET = "\033[32m", "\033[31m", "\033[33m", "\033[0m"
else:
    GREEN = RED = YELLOW = RESET = ""

results: list[tuple[str, bool, bool]] = []  # (name, ok, required)


def report(name: str, ok: bool, detail: str, fix: str = "", required: bool = True) -> bool:
    mark = f"{GREEN}OK  {RESET}" if ok else (f"{RED}FAIL{RESET}" if required else f"{YELLOW}WARN{RESET}")
    print(f"  [{mark}] {name}: {detail}")
    if not ok and fix:
        print(f"         fix: {fix}")
    results.append((name, ok, required))
    return ok


def check_nic(cfg: VoiceConfig) -> bool:
    try:
        addrs = {ai[4][0] for ai in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET)}
    except socket.gaierror:
        addrs = set()
    ok = cfg.g1_local_ip in addrs
    return report(
        "robot-LAN NIC", ok,
        f"{cfg.g1_local_ip} {'present' if ok else 'NOT on this host'} (have: {', '.join(sorted(addrs)) or 'none'})",
        'set the "Ethernet 3" adapter to 192.168.123.10/24, or set VOICE_G1_LOCAL_IP',
    )


def check_robot() -> bool:
    flag = "-n" if sys.platform == "win32" else "-c"
    ok = subprocess.run(
        ["ping", flag, "2", ROBOT_IP],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    ).returncode == 0
    return report(
        "robot reachable", ok, f"ping {ROBOT_IP} {'replies' if ok else 'no reply'}",
        "power the G1 on, wait for PC2 to boot, check the LAN cable",
    )


def check_multicast(cfg: VoiceConfig, timeout_s: float = 5.0) -> bool:
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    try:
        sock.bind(("", cfg.g1_mcast_port))
        if ipaddress.ip_address(cfg.g1_mcast_group).is_multicast:
            mreq = struct.pack("4s4s", socket.inet_aton(cfg.g1_mcast_group),
                               socket.inet_aton(cfg.g1_local_ip))
            sock.setsockopt(socket.IPPROTO_IP, socket.IP_ADD_MEMBERSHIP, mreq)
        sock.settimeout(timeout_s)
        data, addr = sock.recvfrom(65536)
        return report("mic multicast", True,
                      f"{len(data)} B from {addr[0]} on {cfg.g1_mcast_group}:{cfg.g1_mcast_port}")
    except socket.timeout:
        return report(
            "mic multicast", False,
            f"no packet on {cfg.g1_mcast_group}:{cfg.g1_mcast_port} within {timeout_s:.0f}s",
            "firewall rule for UDP 5555 (see ROBOT_DAY.md step 1), then scripts/g1_mic_dump.py",
        )
    except OSError as exc:
        return report("mic multicast", False, f"socket error: {exc}",
                      "another process may already hold UDP 5555")
    finally:
        sock.close()


def _get_json(url: str, timeout: float = 3.0):
    import httpx

    return httpx.get(url, timeout=timeout).json()


def check_adapter(cfg: VoiceConfig) -> bool:
    try:
        health = _get_json(cfg.g1_adapter_url.rstrip("/") + "/health")
    except Exception as exc:  # noqa: BLE001
        return report("audio adapter", False, f"{cfg.g1_adapter_url} unreachable ({type(exc).__name__})",
                      "scripts/run_g1_adapter.ps1  (starts it in the 3.10 DDS venv)")
    if health.get("mock"):
        return report("audio adapter", False, f"running in MOCK mode ({health})",
                      "restart without G1_AUDIO_MOCK=1 — mock never reaches the robot speaker")
    return report("audio adapter", True, f"{health}")


def check_agent(cfg: VoiceConfig) -> bool:
    url = cfg.agent_url.rstrip("/") + "/.well-known/agent-card.json"
    try:
        card = _get_json(url)
    except Exception as exc:  # noqa: BLE001
        return report("robot-agent A2A", False, f"{cfg.agent_url} unreachable ({type(exc).__name__})",
                      "cd robot-agent && npm run dev:g1-edu")
    return report("robot-agent A2A", True, f"{card.get('name', 'agent')} at {cfg.agent_url}")


def check_ollama() -> bool:
    try:
        tags = _get_json(OLLAMA_URL + "/api/tags", timeout=5.0)
    except Exception as exc:  # noqa: BLE001
        return report("ollama", False, f"{OLLAMA_URL} unreachable ({type(exc).__name__})",
                      "start Ollama (it serves the robot-agent's LLM)")
    models = [m["name"] for m in tags.get("models", [])]
    return report("ollama", bool(models), f"{len(models)} model(s): {', '.join(models)}",
                  "ollama pull gpt-oss:20b")


def check_models(cfg: VoiceConfig) -> bool:
    needed = [
        cfg.models_dir / "silero_vad.onnx",
        cfg.models_dir / "piper" / f"{cfg.piper_voice_de}.onnx",
        cfg.models_dir / "piper" / f"{cfg.piper_voice_en}.onnx",
    ]
    missing = [p.name for p in needed if not p.exists()]
    return report("voice models", not missing,
                  f"VAD + {len(needed) - 1} piper voices in {cfg.models_dir}"
                  if not missing else f"missing: {', '.join(missing)}",
                  "uv run python scripts/download_models.py")


def check_cuda() -> bool:
    ok = subprocess.run(["nvidia-smi"], stdout=subprocess.DEVNULL,
                        stderr=subprocess.DEVNULL).returncode == 0
    return report("nvidia-smi", ok, "GPU visible" if ok else "no GPU",
                  "STT falls back to CPU and gets much slower", required=False)


def main() -> int:
    cfg = VoiceConfig.from_env()
    print(f"\nTASK-181 preflight — agent {cfg.agent_url}, adapter {cfg.g1_adapter_url}\n")

    print("Robot LAN")
    check_nic(cfg)
    check_robot()
    check_multicast(cfg)
    print("\nServices")
    check_adapter(cfg)
    check_agent(cfg)
    check_ollama()
    print("\nLocal")
    check_models(cfg)
    check_cuda()

    failed = [n for n, ok, required in results if not ok and required]
    print()
    if failed:
        print(f"{RED}{len(failed)} blocking check(s) failed:{RESET} {', '.join(failed)}")
        return 1
    print(f"{GREEN}All checks passed — ready for the full round trip:{RESET}")
    print("  uv run python -m voice_service --env-file .env.voice.g1")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
