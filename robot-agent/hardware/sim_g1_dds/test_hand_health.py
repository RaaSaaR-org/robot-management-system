"""Unit tests for the sim's TASK-404 /health fields: `lowstate_age_s` and the
Dex3 `hand_health`, plus the SIM_DEX3_FAULT / SIM_DEX3_MISSING startup knobs.

    python -m pytest robot-agent/hardware/sim_g1_dds/test_hand_health.py

The sim is how the readiness UI and the agent get tested without the robot, so
it must be able to show a faulted or a missing hand on demand -- and with no
knob set, it must show the healthy answer, never "unknown".
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))
sim_node = pytest.importorskip("sim_node")

from test_snapshot_options import FakeNode, get  # noqa: E402

import dex3_faults  # noqa: E402  (sim_node put hardware/ on sys.path)


def health(node):
    head, body = get(node, "/health")
    assert b"200" in head.split(b"\r\n")[0]
    return json.loads(body)


def test_default_health_is_fresh_with_both_hands_present_and_fault_free():
    body = health(FakeNode())
    assert body["lowstate_age_s"] == 0.0
    for side in ("left", "right"):
        h = body["hand_health"][side]
        assert h["present"] is True and h["age_s"] == 0.0
        assert h["error"] == [0, 0] and h["motor_faults"] == []
    # the older fields are untouched
    assert body["connected"] is True and body["sim"] is True


def test_an_injected_fault_is_reported():
    node = FakeNode()
    node.hand_health = dex3_faults.sim_hand_health({"SIM_DEX3_FAULT": "right:thumb_1:0x200"})
    body = health(node)
    assert body["hand_health"]["right"]["motor_faults"] == [{
        "motor": 1, "joint": "right_hand_thumb_1_joint", "code": "0x200",
        "bits": ["0x200:latched"],
    }]
    assert body["hand_health"]["left"]["motor_faults"] == []


def test_a_missing_hand_is_absent_with_a_null_age():
    node = FakeNode()
    node.hand_health = dex3_faults.sim_hand_health({"SIM_DEX3_MISSING": "right"})
    right = health(node)["hand_health"]["right"]
    assert right["present"] is False and right["age_s"] is None


def test_a_bad_fault_spec_stops_the_sim_before_dds(monkeypatch):
    called = []
    monkeypatch.setattr(sim_node, "ChannelFactoryInitialize", lambda *a: called.append(a))
    monkeypatch.setenv("SIM_DEX3_FAULT", "right:pinky_0:0x200")
    assert sim_node.main(["--scene", str(sim_node.DEFAULT_SCENE)]) == 2
    assert called == []
