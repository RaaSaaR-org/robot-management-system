# Patrol demo route (TASK-212)

`route.house.json` is a `PatrolRoute` for the house scene
(`sim_evaluator/mjcf/g1_dex3_house_scene.xml`, places `places.house.json`),
ready to be sent INLINE to the robot-agent running the
`.env.g1-edu-agent-house` profile (`:41246`, `ROBOT_ID=sim-robot-g1-edu`,
`AGENT_PATROL_ENABLED=true`):

```bash
AGENT=http://localhost:41246/api/v1/robots/sim-robot-g1-edu/agent-mode
ROUTE=$(cat robot-agent/hardware/sim_evaluator/patrol/route.house.json)

# 1. baseline run (supervised): photos + checklist + leg labels + map snapshot
curl -s -X POST $AGENT/patrol -H 'Content-Type: application/json' \
  -d "{\"routeId\":\"house-round\",\"mode\":\"baseline\",\"origin\":\"operator\",\"route\":$ROUTE}"
# watch: curl -s $AGENT/patrol | jq .active.legs

# 2. stage the anomaly: crate from the south hallway wall to (4.5, 0.9)
curl -s -X POST http://localhost:8777/sim/reset-pose -H 'Content-Type: application/json' \
  -d '{"body":"crate","x":4.5,"y":0.9,"yaw":0}'
#    (or a person: {"body":"person","x":-3,"y":3,"yaw":0} — the mocap figure)

# 3. patrol run → findings
curl -s -X POST $AGENT/patrol -H 'Content-Type: application/json' \
  -d "{\"routeId\":\"house-round\",\"mode\":\"patrol\",\"origin\":\"operator\",\"route\":$ROUTE}"
curl -s $AGENT/patrol/runs?limit=1 | jq '.runs[0] | {runId,status,findingCount,legs}'
curl -s $AGENT/patrol/runs/<runId> | jq .findings
```

`origin: "scheduled"` runs the same route through the initiative gate (battery,
known fresh place, armed, not damped, crash acknowledged) — the way the server's
cron fires it. Runs, findings and photos land under
`robot-agent/data/workspace-sim-robot-g1-edu/patrol/house-round/`.

Record it: `python demo_clip.py --layout patrol --patrol-route ../sim_evaluator/patrol/route.house.json --patrol-mode baseline --places ../sim_evaluator/places/places.house.json --out clips/patrol-baseline.mp4`, then move the crate, then the same with `--patrol-mode patrol`.

## End-to-end check and the demo clip

`sim_g1_dds/e2e_patrol_check.py` drives the whole story through the SERVER
(create route → baseline → move crate → patrol → print findings + alerts):

```bash
cd robot-agent/hardware/sim_g1_dds
python e2e_patrol_check.py --route-file ../sim_evaluator/patrol/route.house.json
```

The demo video (`clips/demo-task212-patrol.mp4`, 90 s) was recorded 2026-08-16
with the SERVER's copy of this route (so the run shows up under /patrol in the
console), after the e2e baseline and with the crate at (4.5, 0.9):

```bash
curl -s localhost:3001/api/patrol/routes/<id> > /tmp/route.json     # drop lastFiredAt/nextRunAt
python demo_clip.py --layout patrol --patrol-route /tmp/route.json --patrol-mode patrol \
  --places ../sim_evaluator/places/places.house.json --map-window=-6.5,-2,6.5,5 \
  --title "Patrol: House round" --timeout 400 --out clips/task212-patrol-run.mp4
python demo_clip.py --card "Patrol: House round" --card-sub "Baseline walked earlier. Then a crate was moved into the hallway." --tail 3.5 --out clips/task212-card-in.mp4
python demo_clip.py --card "Findings become alerts" --card-sub "Baseline vs now photo pairs, run history and 'this is normal' live at /patrol" --tail 3.5 --out clips/task212-card-out.mp4
python demo_clip.py --concat clips/task212-card-in.mp4 clips/task212-patrol-run.mp4 clips/task212-card-out.mp4 --out clips/demo-task212-patrol.mp4
```

What the run produced (qwen2.5vl:7b, gate 0.97): Hallway checkpoint `changed`
→ `out_of_place … table` (the model's word for the crate; baseline-vs-now pair
shows it), Hallway (return) `changed` → the crate that used to stand there is
gone → `missing_object "box missing in Hallway"` (en-route label diff), plus one
VLM false positive (`shelf`) — the "this is normal" button exists for exactly
that. Kitchen and Living room: one checklist call each, `same`.
