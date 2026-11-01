"""Shared bits of the supervisor's stub children: an append-only call log and signal recording."""

import os
import signal
import sys
import time


def record(event):
    path = os.environ.get("STUB_CALLS")
    if not path:
        return
    with open(path, "a") as f:
        f.write("%.6f %s\n" % (time.time(), event))


def on_signals(name, exit_on=("SIGTERM", "SIGINT"), ignore=()):
    """Record every SIGTERM/SIGINT; exit on the ones in exit_on unless ignored."""

    def handler(signum, _frame):
        sig = signal.Signals(signum).name
        record("%s:%s" % (name, sig))
        if sig in exit_on and sig not in ignore:
            sys.stdout.flush()
            os._exit(0)

    signal.signal(signal.SIGTERM, handler)
    signal.signal(signal.SIGINT, handler)
