"""Stub sim_node.py: GET /health on --http-port; records the DDS domain/iface it was given."""

import argparse
import json
import os
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from stub_common import on_signals, record  # noqa: E402

ap = argparse.ArgumentParser()
ap.add_argument("--domain", type=int, required=True)
ap.add_argument("--iface", required=True)
ap.add_argument("--http-port", type=int, default=0)
args, _rest = ap.parse_known_args()
on_signals("sim")
record("sim:start:domain=%d:iface=%s" % (args.domain, args.iface))


class H(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def do_GET(self):
        data = json.dumps({"ok": True}).encode()
        self.send_response(200 if self.path == "/health" else 404)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


ThreadingHTTPServer(("127.0.0.1", args.http_port), H).serve_forever()
