"""The sim facade's bind address (TASK-416): 0.0.0.0 by default, as before, and
127.0.0.1 when the supervisor's sim profile passes `--host 127.0.0.1`."""

import pytest


def test_facade_host_defaults_to_all_interfaces_and_takes_loopback():
    sim_node = pytest.importorskip("sim_node")
    ap = sim_node.make_arg_parser()
    assert ap.parse_args([]).host == "0.0.0.0"
    assert ap.parse_args(["--host", "127.0.0.1", "--http-port", "18782"]).host == "127.0.0.1"
