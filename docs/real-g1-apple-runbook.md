# Real-G1 Apple-to-Plate Runbook (robot day)

Our-stack equivalent of NVIDIA's GR00T E2E *deployment* lesson — but with
**NO ROS**: instead of Jetson Thor + Isaac-ROS launch files, a single Python
process (`robot-agent/hardware/real_g1_bridge/bridge.py`) closes the loop
between the physical G1 EDU + Dex3-1 and our serving stack
(GR00T PolicyServer → vla-server → bridge → `rt/arm_sdk`/`rt/dex3/*/cmd`).

- Contract: `C:\Unitree\_data\apple_pnp\CONTRACT.md`
- Bridge usage + safety model: `robot-agent/hardware/real_g1_bridge/README.md`
- Task: **"move the apple to the plate"** — state 43-dim, action 31-dim,
  chunk 16, exec-horizon 8, ego_view 640x480 @ 30 fps.

**Prime directive:** the write path stays dead (dry-run) until stage 3, and
stage 3 requires BOTH `G1_BRIDGE_ARMED=1` and `--arm`. Legs/locomotion are
never commanded by this stack — the G1 balances via its own loco service.

---

## 1. Pre-flight checklist (before powering anything)

- [ ] **Two-person rule:** one operator at the keyboard, one dedicated
      **e-stop holder** with the wireless remote / physical e-stop. Named out
      loud before power-on. The e-stop holder does nothing else.
- [ ] **Workspace cleared:** nothing and nobody within arm sweep radius
      (~1 m) of the robot except the staged table. No cables through the
      manipulation volume.
- [ ] **Gantry / suspend rules:** robot starts ON the gantry. Robot feet
      **flat on the ground BEFORE any balance mode is engaged**; never enter
      balance mode while suspended. Gantry slack but attached during stages
      1–2; agreed hand-signal before releasing for stage 3.
- [ ] **Visual contact:** operator has unobstructed line of sight to the
      whole robot at all times; no running armed while watching only the
      terminal.
- [ ] **E-stop drill:** e-stop holder confirms damping-mode trigger on the
      remote once, before the robot leaves the gantry.
- [ ] **D435 connected and aimed:** RealSense D435 powered, USB enumerated on
      the bridge machine (`python -c "import pyrealsense2 as rs; print(rs.context().devices)"`),
      head-mounted ego view framing the tabletop like the dataset's
      `ego_view` (compare against a decoded reference frame from
      `C:\Unitree\_data\apple_pnp\dataset\videos\chunk-000\observation.images.ego_view\episode_000000.mp4`).
- [ ] **Scene staged:** table at **~0.75 m** height with **black
      tablecloth**, one **red apple** on the surface, one **white plate
      (~19 cm)**. Robot standing at the table like the NVIDIA reference
      (their sim base pose: (−0.15, 0, 0.76), yaw +90°).
- [ ] **Battery:** SOC comfortable (> 40 %); Dex3 hands powered (power_v
      visible in stage 1 sensor output).

## 2. Network bring-up

- Robot PC2: `192.168.123.164`; workstation NIC on the robot LAN:
  `192.168.123.10` (dz-226 port **"Ethernet 3"** — CycloneDDS takes the NIC
  *name*, not an IP).
- **DDS domain 0 = real robot.** Never point mock tooling (domain 9) or sim
  (domain 1) at this network, and never run `mock_loop.py` while attached to
  the robot LAN.
- Sanity: `ping 192.168.123.164`, then a passive topic sweep with the sensor
  toolkit (read-only): `python C:\Unitree\g1-sensor-toolkit\g1_sensor_explorer.py --secs 10`
  — expect `rt/lowstate` ≈ 50–500 Hz and both `rt/dex3/*/state` topics OK.

## 3. Serving bring-up (dz-226)

Three processes, three terminals:

```powershell
# 1) GR00T PolicyServer :6555 (groot conda env) — pick the best checkpoint
#    (14k-class steps beat early ones on every task in prior evals)
C:\Users\sebastian.heusser\.conda\envs\groot\python.exe -m gr00t.eval.run_gr00t_server `
    --model-path C:\Unitree\_ft_out\apple_pnp\checkpoint-<best> `
    --embodiment-tag new_embodiment --port 6555

# 2) vla-server :8000 (vla-server repo, its own venv)
cd C:\Unitree\vla-server
python server.py --config configs/g1_apple_pnp.yaml

# 3) sanity check BEFORE touching the robot
curl http://localhost:8000/health
curl http://localhost:8000/config
```

`/config` MUST report `action_dim: 31`, `cameras: ["ego_view"]`,
`chunk_size: 16`. Anything else → stop, fix the config, do not proceed.

Optional smoke test with zero robot involvement: one `/predict` with a decoded
dataset frame + a 43-dim state from the dataset — confirms end-to-end GR00T
inference latency (must be well under the 1 s predict watchdog).

## 4. Staged escalation

All stages run from `robot-agent/hardware/real_g1_bridge/` in conda env
`env_isaaclab_51_unitree`. Domain 0 + iface are the defaults.

### Stage 1 — read-only sensor check (bridge dry-run, no VLA)

```powershell
python bridge.py --no-predict --max-seconds 20
```

- Expect `state_tick` JSON lines at ~30 Hz with plausible joint angles
  (radians, standing pose), fresh `ages_ms` (lowstate well under 200 ms).
- Confirm zero CRC failures and that all 43 dims move when a hand is
  gently moved by a human (hands powered, correct left/right mapping).
- **The robot must not react in any way** — this stage has no write path.

### Stage 2 — dry-run with live predict

```powershell
python bridge.py --vla-server http://localhost:8000 --max-seconds 60
```

- Watch `predict_ok` latencies: consistently < 1 s (watchdog) — ideally
  < 300 ms.
- Read the `cmd_tick` lines — **action logs must look sane**: per-tick
  deltas small (`delta_saturated: 0` most ticks), arm targets near the
  current pose at start, hands opening/closing plausibly as the policy
  approaches/grasps in its imagination. `discarded_dims` lines are fine
  (navigate/base_height are never executed).
- Frame dump check: point the D435 at the staged scene and verify a saved
  mock-free frame matches the dataset viewpoint (this is our analog of
  NVIDIA's RViz image-topic check).
- If targets are wild (large jumps, saturated clamps every tick, hands
  slamming limits): STOP. Wrong checkpoint, wrong camera framing, or state
  mapping issue. Do not escalate.

### Stage 3 — armed run (hand on e-stop)

Preconditions: stages 1–2 green, both people ready, gantry rule satisfied,
robot in its normal standing/balance mode at the table.

```powershell
$env:G1_BRIDGE_ARMED = "1"
# first armed run: reduced blend weight
python bridge.py --arm --ramp-seconds 3 --exec-horizon 8 --weight-cap 0.3
# subsequent runs, if clean:
python bridge.py --arm --ramp-seconds 3 --exec-horizon 8
```

- The arm-sdk blend weight (`motor_cmd[29].q`) ramps 0 → cap over 3 s
  (NVIDIA `blend_ratio` analog) — arms should ease, not snap, into policy
  control.
- Press **Enter** in the terminal at any moment for a ramped software stop;
  the physical e-stop overrides everything.
- On every exit (normal or not) the bridge ramps the weight back to 0
  before releasing — wait for "ramp-down complete" before approaching.
- First armed minutes: verify the robot-day items from the bridge README
  (leg slots ignored, mode=1 accepted, waist gains sane, right-hand finger
  order matches the checkpoint).

## 5. Abort criteria — e-stop / Enter immediately if:

- any joint sits at the **delta clamp for > 1 s** (`delta_saturated` high on
  consecutive `cmd_tick` lines) — policy is fighting the rails;
- **stale-state watchdog** trips (bridge aborts itself — do not immediately
  restart; find the network cause first);
- **predict watchdog** trips repeatedly (serving stack degraded);
- **any unexpected torso or leg motion** — the stack never commands legs, so
  leg motion means external interference or a wrong assumption → e-stop, not
  Enter;
- oscillation/vibration in arms or waist (gain mismatch — reduce
  `--weight-cap`, revisit gains);
- hands crushing the apple or striking the table edge;
- anyone enters the workspace.

## 6. Data capture for NeoDEM (measured domain gap)

Goal: replace the sim-only validation with a **measured** `domainGapScore`
for this checkpoint.

1. **Record the session.** Tee the bridge stdout to a JSONL file
   (`python bridge.py ... | Tee-Object -FilePath run1.jsonl`) — `cmd_tick` /
   `predict_ok` / `exit` lines are the flight recorder. Save D435 episode
   video alongside (screen-record the frame dump or use the sensor toolkit's
   camera tooling).
2. **Score episodes manually:** an episode is a success when the apple ends
   up on the plate (NVIDIA parity: apple in contact with plate and at rest).
   Run ≥ 10 episodes for a rate with a usable sample size.
3. **Get the sim rate.** The sim leg (`POST /api/simulation/jobs`,
   environment `g1_apple_pnp`) produces the `SimMetrics` shape from
   `server/src/services/SimulationService.ts` — `successRate`,
   `avgStepsToCompletion`, `collisionCount`, `avgEpisodeDuration` — via
   `sim_evaluator/evaluate_vla.py`.
4. **Record the measured gap** (`domainGapScore = simSuccessRate −
   realSuccessRate`, both 0–1 — computed server-side by
   `SimToRealValidationService`):

```bash
curl -X POST http://localhost:3001/api/simulation/validations \
  -H "Content-Type: application/json" \
  -d '{
    "modelVersionId": "<ModelVersion.id of the apple_pnp checkpoint>",
    "embodimentTag": "unitree_g1",
    "simSuccessRate": <successRate from the sim job metrics>,
    "realSuccessRate": <successes / episodes from step 2>,
    "realTestCount": <episodes>,
    "taskCategories": ["pick_place"],
    "notes": "robot day <date>, bridge run1.jsonl, checkpoint-<best>"
  }'
```

   (Omit `realSuccessRate` only if real EvaluationEpisodes were logged
   through the evaluation pipeline — the service can derive the rate from
   them.) The deployment gate (`DeploymentService`) then enforces the
   measured gap threshold instead of the sim-only fallback.

## 7. Rollback / shutdown

1. Bridge exit (Enter or Ctrl+C) → **weight ramps to 0** — policy authority
   is gone, robot's own controller holds the arms.
2. E-stop holder puts the robot into **damping mode** via the remote.
3. Re-attach and tension the **gantry**, then power down per the standard G1
   procedure.
4. Stop vla-server and the PolicyServer; unset `G1_BRIDGE_ARMED`
   (`Remove-Item Env:G1_BRIDGE_ARMED`).
5. Copy `run*.jsonl` + episode videos to `C:\Unitree\_data\apple_pnp\robot-day-<date>\`.

## 8. NVIDIA tutorial equivalence table

| NVIDIA GR00T E2E deployment (Jetson Thor / Isaac-ROS) | Our stack (NO ROS) |
|---|---|
| Jetson Thor onboard inference | dz-226 RTX 5090: GR00T PolicyServer :6555 + vla-server :8000 |
| ROS 2 launch of the policy node | `python bridge.py` (one process, conda env `env_isaaclab_51_unitree`) |
| ROS topics joint_states / camera | DDS `rt/lowstate` + `rt/dex3/*/state` + pyrealsense2 D435 grab |
| ROS arm command topic | DDS `rt/arm_sdk` (LowCmd, waist+arms only) + `rt/dex3/*/cmd` |
| `blend_ratio` ramp parameter | `--ramp-seconds` (weight channel `motor_cmd[29].q`, 0→1→0, try/finally) |
| action horizon / execution steps | chunk 16 from `/predict`, `--exec-horizon 8` |
| RViz camera/pose visual checks | bridge dry-run: `state_tick`/`cmd_tick` JSON + D435 frame dump vs dataset ego_view |
| ROS node kill / lifecycle shutdown | Enter-key e-stop → ramp-down; physical e-stop → damping mode |
| Isaac-ROS sim-to-real eval | NeoDEM sim job `SimMetrics.successRate` vs measured real rate → `POST /api/simulation/validations` (`domainGapScore`) |
