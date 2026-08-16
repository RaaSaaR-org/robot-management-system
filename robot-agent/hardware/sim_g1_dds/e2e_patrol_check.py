#!/usr/bin/env python3
"""TASK-212 live check against the sim_g1_dds house scene.

    baseline run -> move the crate into the east hallway -> patrol run -> findings + alerts

Drives everything through the SERVER API (routes are the server's record; the
server starts the robot with the route inline) plus the sim facade's
/sim/reset-pose for the robot and the crate. Needs the whole stack up:

    sim:    python sim_node.py --domain 1 --http-port 8777 --scene ../sim_evaluator/mjcf/g1_dex3_house_scene.xml
    agent:  AGENT_MODE_ENABLED=true DOTENV_CONFIG_PATH=.env.g1-edu-agent-house npx tsx src/index.ts   (robot-agent/)
    server: npm run dev                                                                                (server/)

    python e2e_patrol_check.py --route-file ../sim_evaluator/patrol/route.house.json
    python e2e_patrol_check.py --route-id <id> --skip-baseline     # reuse a route + its baseline

Baseline and patrol must run under the SAME sim boot for the geometric (map)
comparison; the checklist and label comparisons do not care. Prints the run
progress, the findings and the newest alerts, and dumps the run JSON to
/tmp/e2e_patrol_result.json. Measured 2026-08-16: baseline ~150 s, patrol
~135 s wall clock, findings out_of_place at the Hallway checkpoint (the crate,
which qwen2.5vl:7b calls a table) + missing_object "box missing in Hallway".
"""
import json, sys, time, urllib.request, argparse

SERVER = "http://localhost:3001"
AGENT = "http://localhost:41246"
SIM = "http://localhost:8777"
ROBOT = "sim-robot-g1-edu"

def http(method, url, body=None, timeout=30):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            raw = r.read()
            return r.status, (json.loads(raw) if raw else None)
    except urllib.error.HTTPError as e:
        raw = e.read()
        try: return e.code, json.loads(raw)
        except Exception: return e.code, raw.decode(errors="replace")

def reset_scene(crate=(-1.0, -0.72)):
    print("reset robot pose ->", http("POST", f"{SIM}/sim/reset-pose", {"x": 0, "y": 0, "yaw": 0}))
    print("reset crate ->", http("POST", f"{SIM}/sim/reset-pose", {"body": "crate", "x": crate[0], "y": crate[1], "yaw": 0}))

def wait_run(run_id, timeout=900):
    t0 = time.time(); last = None
    while time.time() - t0 < timeout:
        st, run = http("GET", f"{SERVER}/api/patrol/runs/{run_id}")
        if st == 200 and run:
            status = run.get("status")
            legs = [(l["name"], l["status"], l.get("inspection")) for l in run.get("legs", [])]
            if (status, legs) != last:
                print(f"  [{int(time.time()-t0):4d}s] {status} legs={legs} findings={run.get('findingCount')}")
                last = (status, legs)
            if status in ("done", "aborted", "failed", "skipped"):
                return run
        time.sleep(3)
    raise SystemExit("timeout waiting for run")

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--route-id", default=None)
    ap.add_argument("--skip-baseline", action="store_true")
    ap.add_argument("--checkpoints", default="KITCHEN,LIVING-ROOM")
    ap.add_argument("--home", default="HALLWAY")
    ap.add_argument("--route-file", default=None)
    args = ap.parse_args()

    route_id = args.route_id
    if not route_id:
        if args.route_file:
            cps = json.load(open(args.route_file))["checkpoints"]
        else:
            cps = [{"id": f"cp-{i+1}", "placeId": p, "name": p.title().replace("-", " "),
                    "headingDeg": None, "actions": ["capture"], "dwellMs": 0, "expectations": []}
                   for i, p in enumerate(args.checkpoints.split(","))]
        st, route = http("POST", f"{SERVER}/api/patrol/routes", {
            "name": "House round", "robotId": ROBOT, "twinId": None, "checkpoints": cps,
            "cronExpression": None, "enabled": True,
            "timeWindows": [{"id": "day", "name": "day", "startHour": 7, "endHour": 19},
                            {"id": "night", "name": "night", "startHour": 19, "endHour": 7}],
            "homePlaceId": args.home})
        print("create route ->", st, route if st >= 300 else route.get("id"))
        assert st in (200, 201), route
        route_id = route["id"]

    if not args.skip_baseline:
        reset_scene()
        time.sleep(2)
        st, res = http("POST", f"{SERVER}/api/patrol/routes/{route_id}/start", {"mode": "baseline", "robotId": ROBOT}, timeout=60)
        print("start baseline ->", st, res)
        assert st == 200 and res.get("accepted"), res
        base = wait_run(res["runId"])
        print("BASELINE:", base["status"], base.get("reason"))

    # stage the anomaly: crate into the east hallway
    print("move crate ->", http("POST", f"{SIM}/sim/reset-pose", {"body": "crate", "x": 4.5, "y": 0.9, "yaw": 0}))
    print("reset robot pose ->", http("POST", f"{SIM}/sim/reset-pose", {"x": 0, "y": 0, "yaw": 0}))
    time.sleep(2)
    st, res = http("POST", f"{SERVER}/api/patrol/routes/{route_id}/start", {"mode": "patrol", "robotId": ROBOT}, timeout=60)
    print("start patrol ->", st, res)
    assert st == 200 and res.get("accepted"), res
    run = wait_run(res["runId"])
    st, full = http("GET", f"{SERVER}/api/patrol/runs/{run['runId']}")
    findings = full.get("findings", [])
    print("PATROL:", run["status"], "findings:", [(f["type"], f["place"], f["source"], f["summary"]) for f in findings])
    st, alerts = http("GET", f"{SERVER}/api/alerts?limit=10")
    print("alerts:", st, [a.get("title") for a in (alerts if isinstance(alerts, list) else alerts.get("alerts", alerts.get("data", [])) )][:5] if st == 200 else alerts)
    json.dump({"routeId": route_id, "run": full}, open("/tmp/e2e_patrol_result.json", "w"), indent=1)

if __name__ == "__main__":
    main()
