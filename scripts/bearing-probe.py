#!/usr/bin/env python3
"""Measure single-look bearing error against MJCF ground truth.

Puts the robot at a known pose, issues ONE `look` (no scan, so no per-step yaw
attribution), and compares the bearing scene memory recorded for each object
against the true bearing computed from the scene file.
"""
import json, math, time, urllib.request

SIM = "http://localhost:8777"
AGENT = "http://localhost:41246/api/v1/robots/sim-robot-g1-edu/agent-mode"
SRV = "http://localhost:3001/api/robots/sim-robot-g1-edu/agent-mode"

# Ground truth from robot-agent/hardware/sim_evaluator/mjcf/g1_dex3_room_scene.xml
TRUTH = {"table": (2.20, 0.70), "hat": (2.20, 0.70),
         "chair": (1.60, -1.85), "shelf": (-0.40, 2.75)}


def http(url, body=None, timeout=60):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data,
                                 headers={"content-type": "application/json"},
                                 method="POST" if data is not None else "GET")
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode())


def run(pose):
    http(f"{SIM}/sim/reset-pose", pose)
    time.sleep(2.5)
    o = http(f"{SIM}/loco/odom")
    x, y, yaw = o["x"], o["y"], math.degrees(o["yaw"])

    acc = http(f"{SRV}/command", {"text": "look"})
    want = acc.get("planId")
    for _ in range(60):
        s = http(SRV)
        p = s.get("plan")
        if p and p.get("id") == want and p.get("status") in ("done", "failed"):
            break
        time.sleep(2)

    scene = http(f"{AGENT}/scene")
    print(f"\npose x={x:+.2f} y={y:+.2f} yaw={yaw:+.1f}deg")
    print(f"  view: {scene.get('currentView','')[:80]}")
    print(f"  {'label':<10} {'recorded':>9} {'truth':>9} {'error':>9}   {'rel.rec':>8} {'rel.true':>8}")
    for e in scene.get("entities", []):
        label = e["label"].lower()
        if label not in TRUTH:
            continue
        tx, ty = TRUTH[label]
        true_world = math.degrees(math.atan2(ty - y, tx - x))
        rec = e["bearingDeg"]
        err = (rec - true_world + 180) % 360 - 180
        rel_rec = (rec - yaw + 180) % 360 - 180
        rel_true = (true_world - yaw + 180) % 360 - 180
        print(f"  {label:<10} {rec:>+8.1f}° {true_world:>+8.1f}° {err:>+8.1f}°   "
              f"{rel_rec:>+7.1f}° {rel_true:>+7.1f}°")


for pose in ({"x": -1.0, "y": 0.0, "yaw": 0.0},
             {"x": 0.0, "y": 0.0, "yaw": 0.0},
             {"x": -1.0, "y": 0.0, "yaw": math.radians(45)}):
    run(pose)
