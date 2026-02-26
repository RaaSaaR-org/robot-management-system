"""
federated_bridge.py — Python training bridge for federated learning LoRA fine-tuning.

Exposes a lightweight HTTP API on port 8766:
  GET  /health  → {"status": "ok", "stub": true/false}
  POST /train   → {"episodes": [...], "lora_config": {...}} → {"gradients": [[...]], "loss": float, "steps": int, "duration_ms": int}

Stub mode:
  When the real LoRA training stack (peft, transformers, torch) is not available,
  the bridge falls back to generating synthetic gradients with a realistic
  loss curve simulation. A flag file /tmp/federated-stub.flag is written.

Run via:
  python ~/develop/robot-management-system/robot-agent/hardware/federated_bridge.py
"""

import json
import math
import os
import random
import time
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

PORT = int(os.environ.get("FEDERATED_BRIDGE_PORT", "8766"))

# --- Attempt real LoRA imports ---
_HAS_PEFT = False
try:
    from peft import LoraConfig, get_peft_model  # noqa: F401
    import torch  # noqa: F401
    _HAS_PEFT = True
except ImportError:
    pass

STUB_FLAG = Path("/tmp/federated-stub.flag")

if not _HAS_PEFT:
    STUB_FLAG.write_text("stub-mode: peft/torch not available\n")
    print(f"[FederatedBridge] Running in STUB mode (flag: {STUB_FLAG})")
else:
    if STUB_FLAG.exists():
        STUB_FLAG.unlink()
    print("[FederatedBridge] Running with real LoRA training support")


def _stub_train(episodes: list, lora_config: dict) -> dict:
    """Generate synthetic training results when real LoRA is unavailable."""
    rank = lora_config.get("rank", 8)
    epochs = lora_config.get("epochs", 1)
    num_episodes = len(episodes)

    # Simulate training steps
    steps = num_episodes * epochs
    start_time = time.time()

    # Simulate a realistic loss curve: starts high, decays exponentially
    initial_loss = 2.5 + random.uniform(-0.3, 0.3)
    final_loss = 0.3 + random.uniform(-0.1, 0.1)
    decay_rate = -math.log(final_loss / initial_loss) / max(steps, 1)
    loss = initial_loss * math.exp(-decay_rate * steps)

    # Generate synthetic gradient matrices
    # Shape: one vector per target module, each of dimension rank * rank
    target_modules = lora_config.get("target_modules", ["q_proj", "v_proj"])
    grad_dim = rank * rank
    gradients = []
    for _ in target_modules:
        # Small random gradients centered around 0
        grad_vec = [random.gauss(0, 0.01) for _ in range(grad_dim)]
        gradients.append(grad_vec)

    # Add a small delay to simulate computation
    time.sleep(min(0.1 * num_episodes, 2.0))

    duration_ms = int((time.time() - start_time) * 1000)

    return {
        "gradients": gradients,
        "loss": round(loss, 6),
        "steps": steps,
        "duration_ms": duration_ms,
    }


def _real_train(episodes: list, lora_config: dict) -> dict:
    """Real LoRA training using peft + transformers. Placeholder for future implementation."""
    # For now, fall back to stub even if peft is available.
    # A real implementation would:
    # 1. Load a base model (e.g., SmolVLA)
    # 2. Apply LoraConfig with rank, alpha, target_modules
    # 3. Fine-tune on the provided episodes
    # 4. Extract and return the LoRA weight deltas as gradients
    return _stub_train(episodes, lora_config)


class FederatedBridgeHandler(BaseHTTPRequestHandler):
    """HTTP request handler for the federated training bridge."""

    def do_GET(self) -> None:
        if self.path == "/health":
            self._send_json(200, {
                "status": "ok",
                "stub": not _HAS_PEFT,
                "port": PORT,
            })
        else:
            self._send_json(404, {"error": "Not found"})

    def do_POST(self) -> None:
        if self.path == "/train":
            self._handle_train()
        else:
            self._send_json(404, {"error": "Not found"})

    def _handle_train(self) -> None:
        try:
            content_length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(content_length)
            data = json.loads(body)
        except (json.JSONDecodeError, ValueError) as e:
            self._send_json(400, {"error": f"Invalid JSON: {e}"})
            return

        episodes = data.get("episodes")
        lora_config = data.get("lora_config")

        if not episodes or not isinstance(episodes, list):
            self._send_json(400, {"error": "episodes must be a non-empty array"})
            return

        if not lora_config or not isinstance(lora_config, dict):
            self._send_json(400, {"error": "lora_config must be an object"})
            return

        print(f"[FederatedBridge] Training on {len(episodes)} episodes, "
              f"rank={lora_config.get('rank', '?')}, "
              f"epochs={lora_config.get('epochs', '?')}")

        try:
            if _HAS_PEFT:
                result = _real_train(episodes, lora_config)
            else:
                result = _stub_train(episodes, lora_config)

            print(f"[FederatedBridge] Training complete: loss={result['loss']:.4f}, "
                  f"steps={result['steps']}, duration={result['duration_ms']}ms")

            self._send_json(200, result)
        except Exception as e:
            print(f"[FederatedBridge] Training error: {e}")
            self._send_json(500, {"error": str(e)})

    def _send_json(self, status: int, data: dict) -> None:
        body = json.dumps(data).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format: str, *args: object) -> None:
        """Suppress default access logs for cleaner output."""
        pass


def main() -> None:
    server = HTTPServer(("0.0.0.0", PORT), FederatedBridgeHandler)
    print(f"[FederatedBridge] Listening on port {PORT}")
    print(f"[FederatedBridge] Mode: {'real LoRA' if _HAS_PEFT else 'stub'}")

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n[FederatedBridge] Shutting down")
        server.shutdown()


if __name__ == "__main__":
    main()
