#!/usr/bin/env python3
"""
bridge_probe.py — is the read-only state bridge actually publishing?

The robot supervisor (robot-agent/supervisor, TASK-403) runs this with the
profile's interpreter after it starts g1_state_bridge_readonly.py. It SUBSCRIBES
to the bridge's ZMQ PUB socket for a few seconds and prints one JSON line:

    {"lowstate": true, "dex3": {"left": true, "right": false},
     "messages": 57, "elapsed_s": 0.41, "error": null}

Exit 0 when an `rt/lowstate` message arrived within --timeout, else 1. After the
first lowstate it keeps listening for at most --hands-grace seconds (never past
--timeout) so it can also report whether the Dex3 hands publish.

Read-only by construction: a SUB socket, no publisher, no DDS. Stdlib + pyzmq,
and it must parse on the Python 3.8 of the robot's PC2 (no 3.10+ syntax).

    python bridge_probe.py --endpoint tcp://127.0.0.1:6001 --timeout 3

@status live
"""

import argparse
import json
import sys
import time

TOPIC_LOWSTATE = "rt/lowstate"
TOPIC_LEFT = "rt/dex3/left/state"
TOPIC_RIGHT = "rt/dex3/right/state"


def topic_of(payload):
    """The `topic` of one bridge message ({"topic": ..., "data": {...}}), or None."""
    try:
        msg = json.loads(payload.decode("utf-8") if isinstance(payload, bytes) else payload)
    except (ValueError, UnicodeDecodeError):
        return None
    if not isinstance(msg, dict):
        return None
    topic = msg.get("topic")
    return topic if isinstance(topic, str) else None


def probe(endpoint, timeout_s, hands_grace_s=1.0, ctx=None, clock=time.monotonic):
    """Listen on `endpoint` and report what was seen. Never raises for a dead endpoint."""
    import zmq

    own_ctx = ctx is None
    ctx = ctx or zmq.Context()
    sock = ctx.socket(zmq.SUB)
    sock.setsockopt(zmq.LINGER, 0)
    sock.setsockopt(zmq.SUBSCRIBE, b"")
    result = {"lowstate": False, "dex3": {"left": False, "right": False},
              "messages": 0, "elapsed_s": 0.0, "error": None}
    start = clock()
    try:
        sock.connect(endpoint)
        poller = zmq.Poller()
        poller.register(sock, zmq.POLLIN)
        deadline = start + timeout_s
        lowstate_at = None
        while True:
            now = clock()
            if now >= deadline:
                break
            if lowstate_at is not None:
                if result["dex3"]["left"] and result["dex3"]["right"]:
                    break
                if now >= lowstate_at + hands_grace_s:
                    break
            wait_ms = max(1, int((deadline - now) * 1000))
            if lowstate_at is not None:
                wait_ms = min(wait_ms, max(1, int((lowstate_at + hands_grace_s - now) * 1000)))
            events = dict(poller.poll(wait_ms))
            if sock not in events:
                continue
            payload = sock.recv(zmq.NOBLOCK)
            result["messages"] += 1
            topic = topic_of(payload)
            if topic == TOPIC_LOWSTATE and lowstate_at is None:
                result["lowstate"] = True
                lowstate_at = clock()
            elif topic == TOPIC_LEFT:
                result["dex3"]["left"] = True
            elif topic == TOPIC_RIGHT:
                result["dex3"]["right"] = True
    except Exception as e:  # noqa: BLE001 — reported, not raised
        result["error"] = "%s: %s" % (type(e).__name__, e)
    finally:
        sock.close(0)
        if own_ctx:
            ctx.term()
    result["elapsed_s"] = round(clock() - start, 3)
    return result


def main(argv=None):
    ap = argparse.ArgumentParser(description="Report whether the G1 state bridge publishes rt/lowstate")
    ap.add_argument("--endpoint", default="tcp://127.0.0.1:6001")
    ap.add_argument("--timeout", type=float, default=3.0, help="seconds to wait for rt/lowstate (default 3)")
    ap.add_argument("--hands-grace", type=float, default=1.0,
                    help="after lowstate, seconds to keep listening for the Dex3 hands (default 1)")
    args = ap.parse_args(argv)
    try:
        result = probe(args.endpoint, args.timeout, args.hands_grace)
    except ImportError as e:
        result = {"lowstate": False, "dex3": {"left": False, "right": False}, "messages": 0,
                  "elapsed_s": 0.0, "error": "pyzmq is not installed for %s (%s)" % (sys.executable, e)}
    print(json.dumps(result), flush=True)
    return 0 if result["lowstate"] else 1


if __name__ == "__main__":
    sys.exit(main())
