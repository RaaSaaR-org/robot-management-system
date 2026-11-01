"""Stub g1_sidecar.py: /health, /disarm, /estop, and the exit codes 2 and 3."""

import json
import os
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from stub_common import on_signals, record  # noqa: E402

env = os.environ
exit_code = int(env.get("STUB_EXIT", "0") or 0)
if exit_code == 2:
    print("[G1 Sidecar] REFUSING TO START: stub configuration error", flush=True)
    sys.exit(2)
if exit_code == 3:
    print("[G1 Sidecar] REFUSING TO START: arm_sdk DDS setup failed "
          "(does not match an available interface)", flush=True)
    sys.exit(3)

ignore = ("SIGTERM", "SIGINT") if env.get("STUB_IGNORE_SIGTERM") == "1" else ()
on_signals("sidecar", ignore=ignore)

mode = "arm_sdk" if env.get("G1_WRITE_MODE") == "arm_sdk" else "read_only"
gate_raw = (env.get("G1_LOCO_ENABLED") or "0").lower()
gate = "fsm" if gate_raw == "fsm" else ("full" if gate_raw in ("1", "true") else "off")
state = {"armed": env.get("STUB_ARMED") == "1", "base": env.get("STUB_BASE_MODE", "limp" if gate == "fsm" else "unknown")}
lock = threading.Lock()
record("sidecar:start:%s" % mode)


class H(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _send(self, code, body):
        data = json.dumps(body).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path != "/health":
            return self._send(404, {"error": "not found"})
        with lock:
            armed = state["armed"]
            base_mode = state["base"]
        body = {"status": "ok", "connected": True, "read_only": mode == "read_only",
                "write_mode": mode, "armed": armed, "arm_weight": 1.0 if armed else 0.0,
                "loco": {"gate": gate},
                "base": {"mode": base_mode, "fsm_id": 1 if base_mode == "limp" else None,
                         "age_s": 0.2 if gate == "fsm" else None}}
        if mode == "arm_sdk":
            body["dds_domain"] = int(env.get("STUB_REPORT_DOMAIN") or env.get("G1_DDS_DOMAIN") or 0)
        self._send(200, body)

    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0)
        if n:
            self.rfile.read(n)
        if self.path == "/disarm":
            record("sidecar:disarm")
            with lock:
                state["armed"] = False
            return self._send(200, {"ok": True})
        if self.path == "/estop":
            record("sidecar:estop")
            with lock:
                state["armed"] = False
            return self._send(200, {"ok": True, "estop_latched": True})
        record("sidecar:FORBIDDEN:%s" % self.path)
        self._send(404, {"error": "not found"})


ThreadingHTTPServer(("127.0.0.1", int(env["G1_SIDECAR_PORT"])), H).serve_forever()
