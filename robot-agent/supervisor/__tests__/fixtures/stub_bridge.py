"""Stub g1_state_bridge_readonly.py: publishes rt/lowstate (+ left Dex3) on ZMQ, stops on SIGINT."""

import argparse
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from stub_common import on_signals, record  # noqa: E402

ap = argparse.ArgumentParser()
ap.add_argument("--iface", default="")
ap.add_argument("--domain", type=int, default=0)
ap.add_argument("--port", type=int, default=6001)
if os.environ.get("STUB_NO_BIND") != "1":
    ap.add_argument("--bind", default="0.0.0.0")
args = ap.parse_args()

import zmq  # noqa: E402  (after --help, like the real bridge's heavy imports)

on_signals("bridge")
record("bridge:args:%s" % json.dumps(sys.argv[1:]))
if os.environ.get("STUB_SILENT") == "1":
    while True:
        time.sleep(1)
ctx = zmq.Context()
sock = ctx.socket(zmq.PUB)
sock.setsockopt(zmq.LINGER, 0)
sock.bind("tcp://127.0.0.1:%d" % args.port)
while True:
    sock.send(json.dumps({"topic": "rt/lowstate", "data": {}}).encode())
    sock.send(json.dumps({"topic": "rt/dex3/left/state", "data": {}}).encode())
    time.sleep(0.02)
