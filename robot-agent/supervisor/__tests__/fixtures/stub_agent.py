"""Stub robot-agent: GET /api/v1/health -> healthy on $PORT; records SIGTERM."""

import json
import os
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from stub_common import on_signals, record  # noqa: E402

if len(sys.argv) > 1:
    # run as a "foreign" agent: python3 stub_agent.py <port> (no supervisor env)
    os.environ["PORT"] = sys.argv[1]
on_signals("agent")
record("agent:start")


class H(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def do_GET(self):
        if self.path == "/api/v1/health":
            data = json.dumps({"status": "healthy"}).encode()
            self.send_response(200)
        else:
            data = b"{}"
            self.send_response(404)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


ThreadingHTTPServer(("127.0.0.1", int(os.environ["PORT"])), H).serve_forever()
