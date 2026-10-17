"""
@file test_bridge_probe.py
@description bridge_probe.py against a local ZMQ PUB that speaks the read-only
             bridge's wire format ({"topic", "data"} JSON), TASK-403.
@feature hardware
"""

import json
import os
import socket
import subprocess
import sys
import threading
import time

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import bridge_probe  # noqa: E402

zmq = pytest.importorskip("zmq", reason="the bridge probe needs pyzmq")

PROBE = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "bridge_probe.py")


def free_port():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


class Publisher:
    """A stand-in for g1_state_bridge_readonly.py's PUB socket."""

    def __init__(self, topics, hz=100.0):
        self.port = free_port()
        self.ctx = zmq.Context()
        self.sock = self.ctx.socket(zmq.PUB)
        self.sock.setsockopt(zmq.LINGER, 0)
        self.sock.bind("tcp://127.0.0.1:%d" % self.port)
        self.topics = topics
        self.period = 1.0 / hz
        self.stop = threading.Event()
        self.thread = threading.Thread(target=self._run, daemon=True)

    def _run(self):
        while not self.stop.is_set():
            for t in self.topics:
                self.sock.send(json.dumps({"topic": t, "data": {"tick": time.time()}}).encode())
            time.sleep(self.period)

    def __enter__(self):
        self.thread.start()
        return self

    def __exit__(self, *exc):
        self.stop.set()
        self.thread.join(2)
        self.sock.close(0)
        self.ctx.term()

    @property
    def endpoint(self):
        return "tcp://127.0.0.1:%d" % self.port


def test_lowstate_and_both_hands_are_reported():
    with Publisher([bridge_probe.TOPIC_LOWSTATE, bridge_probe.TOPIC_LEFT, bridge_probe.TOPIC_RIGHT]) as pub:
        r = bridge_probe.probe(pub.endpoint, 3.0)
    assert r["lowstate"] is True
    assert r["dex3"] == {"left": True, "right": True}
    assert r["error"] is None
    # stops early once everything was seen, rather than sitting out the timeout
    assert r["elapsed_s"] < 2.5


def test_lowstate_without_hands_waits_only_the_grace():
    with Publisher([bridge_probe.TOPIC_LOWSTATE]) as pub:
        r = bridge_probe.probe(pub.endpoint, 3.0, hands_grace_s=0.3)
    assert r["lowstate"] is True
    assert r["dex3"] == {"left": False, "right": False}
    assert r["elapsed_s"] < 2.0


def test_hands_without_lowstate_is_not_ready():
    with Publisher([bridge_probe.TOPIC_LEFT]) as pub:
        r = bridge_probe.probe(pub.endpoint, 0.8)
    assert r["lowstate"] is False
    assert r["dex3"]["left"] is True


def test_nothing_listening_times_out_without_raising():
    r = bridge_probe.probe("tcp://127.0.0.1:%d" % free_port(), 0.5)
    assert r["lowstate"] is False
    assert r["messages"] == 0
    assert 0.4 <= r["elapsed_s"] < 2.0


def test_garbage_messages_are_counted_not_trusted():
    assert bridge_probe.topic_of(b"not json") is None
    assert bridge_probe.topic_of(b"[1, 2]") is None
    assert bridge_probe.topic_of(b'{"topic": "rt/lowstate", "data": {}}') == "rt/lowstate"


def test_cli_prints_one_json_line_and_exit_code():
    with Publisher([bridge_probe.TOPIC_LOWSTATE]) as pub:
        ok = subprocess.run([sys.executable, PROBE, "--endpoint", pub.endpoint, "--timeout", "3",
                             "--hands-grace", "0.2"], capture_output=True, text=True, timeout=20)
    assert ok.returncode == 0, ok.stderr
    assert json.loads(ok.stdout.strip().splitlines()[-1])["lowstate"] is True
    dead = subprocess.run([sys.executable, PROBE, "--endpoint", "tcp://127.0.0.1:%d" % free_port(),
                           "--timeout", "0.3"], capture_output=True, text=True, timeout=20)
    assert dead.returncode == 1
    assert json.loads(dead.stdout.strip().splitlines()[-1])["lowstate"] is False
