---
id: "TASK-403"
aliases: []
title: "A robot supervisor starts and stops the G1's robot-side processes without a terminal"
slug: "a-robot-supervisor-starts-and-stops-the-g1-s-robot-side"
status: "review"
priority: 1
owner: "huhn511"
projects: []
customers: []
tags: ["core", "g1", "teleop", "safety", "ops"]
sprint: ""
parent: ""
depends_on: []
spe: 8
effort: "high"
due_date: ""
created: "2026-10-17"
updated: "2026-10-17"
---

# A robot supervisor starts and stops the G1's robot-side processes without a terminal

## Description

Today every robot-side process for the real G1 is started by hand from a terminal, with long env-var commands copied from `docs/g1-edu-lab-bringup.md`: the read-only state bridge, the sidecar and the robot agent. Nothing reports a stale process. Right now a bridge started on Oct 16 is still running on an interface with no carrier.

This task builds a small standalone supervisor on the robot PC. It starts, stops and reports these processes in a fixed, gated order, under hard safety rules. The server proxy is TASK-409 and the UI is TASK-411.

## Details

### Current state
- **Nothing supervises long-running robot processes.** `child_process` in `server/src` and `robot-agent/src` is used only for short jobs.
  - `server/src/services/SimulationService.ts:317-319` sends SIGTERM and then SIGKILL after 5 s. Do **not** copy that.
- **Run sheet:** `docs/g1-edu-lab-bringup.md`.
  - The sidecar command is at l.179-190: `CYCLONEDDS_HOME=…/g1_quest_teleop/third_party/checkouts/cyclonedds/install` plus about 14 env vars, run with `~/anaconda3/envs/unitree_sim_env6/bin/python -u g1_sidecar.py`.
  - l.337-338 tell the operator to switch `G1_LOCO_ENABLED=0` → `fsm` by hand.
  - The doc says the agent is on :41244, but `.env.g1-edu` has `PORT=41245`.
  - Order (l.72ff, l.170): bridge → sidecar → server/agent/app → `POST /api/robots/register {"robotUrl":…}` if the robot is missing.
- **Bridge:** `robot-agent/hardware/g1_state_bridge_readonly.py --iface enp131s0 --domain 0`, args at l.348-381.
  - It binds `tcp://0.0.0.0:6001`, has no health port, and logs every 500 messages.
  - It stops cleanly only on SIGINT (`KeyboardInterrupt`).
- **Sidecar:** `robot-agent/hardware/g1_sidecar.py`.
  - `main()` (~l.3165) exits 2 on a config error (`_write_mode_error` l.233-266, `_loco_config_error` l.208-230) and 3 when DDS init fails ("does not match an available interface", l.3199-3204).
  - SIGTERM/SIGINT (l.3242-3259) ramp the arms down and then exit. It does not damp.
  - `/health` is described at l.3036-3047.
- **Agent:** `robot-agent` with `.env.g1-edu`: `ROBOT_ID=g1-edu-4`, `PORT=41245`, `HARDWARE_SIDECAR_URL=http://localhost:8767`.
  - Run it as `tsx src/index.ts`, **not** `tsx watch`; a reload drops the `/action` stream.
- **Camera:** PC2 unit `g1-head-cam.service` serves 192.168.123.164:5600.
- `factory_mission_bringup.sh:24-33` has the pattern to reuse: look before you kill, and only clean up what you started (`setsid`, PIDS array, group teardown).
- **systemd:** `systemctl --user` works with `Linger=yes` (ollama already runs that way), so no sudo is needed.

### Supervisor (new package `robot-agent/supervisor/`, Node 22, its own `package.json` and vitest)
- A process that binds **127.0.0.1:8766**, one per robot, enforced by a lock file at `~/.local/state/neodem/<robotId>/supervisor.lock`.
- It requires a bearer token from env `ROBOT_SUPERVISOR_TOKEN` on every route except `GET /healthz`.
- User unit template `robot-agent/supervisor/systemd/neodem-robot-supervisor@.service`, where `%i` is the robot id. Installing it is documented, not automatic.
- **Profile** `robot-agent/hardware/profiles/g1-edu-4.yaml`, checked in, with no secrets:
  - `iface: enp131s0`, `nmProfile: g1-robot-lan`, `robotIp`, `hostIp: 192.168.123.222/24`, `pc2Camera: 192.168.123.164:5600`, `ddsDomain: 0`
  - `python` and `cycloneddsHome` with `${HOME}` expansion
  - bridge args
  - agent command (`tsx src/index.ts`, `DOTENV_CONFIG_PATH=.env.g1-edu`, the nvm node bin dir on PATH)
  - sidecar mode blocks `read_only` (`G1_LOCO_ENABLED=0`, `G1_ALLOW_LIDAR_SWITCH=0`, `G1_CAMERA_SOURCE=pc2cam`) and `arm_sdk` (`G1_WRITE_MODE=arm_sdk`, `G1_LOCO_ENABLED=fsm`, `G1_ARM_SDK_MAX_JOINT_VEL`, `G1_DDS_DOMAIN`)
  - A second profile, `robot-agent/hardware/profiles/sim-g1-edu-dev.yaml`, runs `sim_g1_dds` on **domain 42, iface `lo`**, on non-default ports (for example sidecar 18777 and agent 41299), for live checks that leave the running dev stack alone.
- **Child environment comes from an allowlist only**, never inherited. The profile loader rejects `G1_READ_ONLY` and `G1_ARM_ALLOW_UNKNOWN_FSM` with an error. Domain 0 is accepted only in a profile with `robot: real`.
- **Children** are started with `setsid` (`detached: true`). PID files live in `~/.local/state/neodem/<robotId>/<proc>.pid`.
  - A restarted supervisor re-adopts its own children after checking `/proc/<pid>/cmdline` and the start time.
  - Logs go to a 2000-line ring buffer per process and to `~/.local/state/neodem/logs/<robotId>-<proc>.log`.

**Start sequence.** Each step has a gate. A failure stops the sequence with a plain-English `detail` and leaves earlier steps running.
1. **preflight** (no side effects)
   - Parse the profile.
   - Check the ports (6001, 8767, the agent port). A port that is free or held by our PID passes. A port held by a foreign process gives `foreign_process {pid, cmdline, since}` with the actions `adopt` or `leave`. The supervisor **never** kills a process it did not start.
   - Refuse arm_sdk mode if an `xr_teleoperate` or `teleop_hand_and_arm` process is running (`pgrep -f`), with code `conflict_xr_teleoperate`.
2. **link**
   - `/sys/class/net/<iface>/carrier == 1`, operstate up, host IP present. Otherwise "robot cable unplugged or robot off".
   - One ping to the robot (`ping -c1 -W1`).
   - A TCP connect to the PC2 camera. If it fails this is a warning, not a stop.
   - `POST /lan/up` runs `nmcli con up <nmProfile>` only when explicitly called. It is never automatic.
3. **bridge**
   - Spawn it. Ready when the new `robot-agent/hardware/bridge_probe.py` (stdlib + pyzmq, run with the profile python) reports a `rt/lowstate` message on 127.0.0.1:6001 within 3 s. It also reports whether `rt/dex3/left|right/state` were seen.
4. **sidecar**
   - Spawn it in **read_only by default**.
   - Ready when `/health` reports `connected:true`, the expected `write_mode`, `dds_domain` equal to the profile's (when reported), the expected `loco.gate`, and with fsm `base.age_s < 1.5`.
   - Exit 2 → "sidecar refused its configuration" plus the stderr tail. Exit 3 → "DDS could not open <iface> (no carrier?)".
5. **agent**
   - Spawn it. Ready when `/api/v1/health` returns `status:"healthy"` within 20 s.
   - Registration with the server is TASK-409's job; the supervisor knows no server.

**Safety assertions after every step.**
- Read sidecar `/health`. If `armed` is true, `arm_weight` is not 0, or `base.mode` differs from the value read before the step, abort the sequence and stop that child.

**Sidecar mode switch.** `POST /sidecar/mode {mode:'arm_sdk'|'read_only', confirm:true}`.
- Requires `armed:false`.
- SIGTERM the sidecar, wait up to 15 s for it to exit, then start the other mode block and require `armed:false, arm_weight:0`.
- The lease check is the server's job (TASK-409).

**Stop sequence** (`POST /stop`):
1. `POST /disarm` to the sidecar, then wait for `arm_weight == 0` (5 s at most).
2. SIGTERM the agent, and SIGKILL after 10 s (the agent has no motor path).
3. SIGTERM the sidecar and wait for exit. **Never SIGKILL the sidecar.** If it is still alive after 15 s, report `sidecar_hung` with the runbook text (gantry, power button).
4. SIGINT the bridge, then SIGTERM after 5 s.
5. Stop **never** changes the FSM. The status carries `base.mode` as last read, so the UI can offer "Limp first?" through the existing agent route.

**HTTP API** (JSON):
- `GET /healthz`
- `GET /status` → `{robotId, profile, robot:'real'|'sim', sidecarMode:'read_only'|'arm_sdk'|null, overall:'stopped'|'starting'|'ready'|'degraded'|'stopping'|'error', steps:[{id:'preflight'|'link'|'bridge'|'sidecar'|'agent'|'camera', state:'idle'|'running'|'ok'|'warn'|'failed'|'foreign', owned:boolean, pid:number|null, startedAt:string|null, detail:string|null, checks:Record<string, boolean|number|string|null>}], lastBase:{mode, fsmId}|null, at}`
- `POST /start {mode?:'read_only'|'arm_sdk'}` (default read_only) → 202 and the status
- `POST /stop` → 202
- `POST /sidecar/mode`
- `POST /steps/:id/adopt` and `POST /steps/:id/leave`
- `POST /lan/up`
- `POST /estop`: last resort, forwards to sidecar `/estop`
- `GET /logs/:proc?tail=200`
- `GET /logs/:proc/stream` (SSE)

**Hard rules, enforced in code and tests.**
- The supervisor's sidecar client can call only `GET /health`, `POST /disarm` and `POST /estop`. A test asserts it has no `/arm`, `/action`, `/loco/*` or `/estop/reset` client.
- It never sets `G1_READ_ONLY=0`.
- It never SIGKILLs a sidecar.
- It never kills a foreign process.
- It never auto-restarts an arm_sdk sidecar. The bridge may restart up to 3 times with backoff, and the agent at most once.

### Not in this task
- The bridge `--bind 127.0.0.1` default is in TASK-404, which owns `g1_state_bridge_readonly.py`. The profile passes `--bind 127.0.0.1` only when the bridge supports it; detect support with `--help`.

### Docs
- `docs/g1-edu-lab-bringup.md`: a "Start the robot side from NeoDEM" section (install the unit, set the token, profile path). Fix :41244 → :41245. Keep the terminal commands as a fallback.

### Key files
- robot-agent/supervisor/{package.json,tsconfig.json,src/index.ts,src/profile.ts,src/procs.ts,src/steps.ts,src/sidecarClient.ts,src/logs.ts,src/api.ts,__tests__/*} (new)
- robot-agent/supervisor/systemd/neodem-robot-supervisor@.service (new)
- robot-agent/hardware/profiles/{g1-edu-4.yaml,sim-g1-edu-dev.yaml} (new)
- robot-agent/hardware/bridge_probe.py (new) + robot-agent/hardware/tests/test_bridge_probe.py
- docs/g1-edu-lab-bringup.md
- scripts/test-all.sh (add the supervisor vitest stage)

## Decisions
- **D1 Standalone process.** Rejected: running it inside the agent, which is one of its own children. Rejected: running it inside the server, whose `tsx watch` restarts would orphan the children, and which may not run on the robot PC.
- **D2 read_only is the default.** arm_sdk is a separate confirmed switch.
- **D3 Adopt or leave foreign processes; never kill them.** Today's stale bridge is the case this rule exists for.
- **D4 Shared bearer token over loopback.** Rejected: no auth at all, because any local process could start the robot side.
- **D5 The bridge readiness probe is Python with pyzmq**, run with the profile's interpreter. Rejected: a native zeromq npm module.
- **D6 No sidecar `--check-config` flag in this task.** Exit code 2 plus the stderr tail gives the same message, and it avoids overlap with TASK-404's sidecar edits.

## Acceptance Criteria
- [ ] `profile.ts` rejects `G1_READ_ONLY` and `G1_ARM_ALLOW_UNKNOWN_FSM`, and rejects domain 0 in a sim profile (unit tests).
- [ ] With stub children (Python scripts that mimic each process's readiness signal and exit codes), `POST /start` walks preflight → agent, and `/status` shows each step's state. A stub sidecar exiting 3 stops the sequence with the DDS message.
- [ ] A foreign process on a port yields `state:'foreign'` with pid and cmdline. No signal is ever sent to it (asserted with a spy on `process.kill`).
- [ ] Stop order is disarm → agent → sidecar → bridge. The sidecar receives SIGTERM only. A stub sidecar ignoring SIGTERM yields `sidecar_hung` after 15 s with no SIGKILL.
- [ ] A stub sidecar reporting `armed:true` after start aborts the sequence and stops it.
- [ ] arm_sdk start is refused while a process named `xr_teleoperate` runs.
- [ ] The supervisor's sidecar client exposes no `/arm`, `/action`, `/loco/*` or `/estop/reset` call (static test).
- [ ] Restarting the supervisor re-adopts its own running children from the PID files.
- [ ] Live check: the `sim-g1-edu-dev.yaml` profile starts `sim_g1_dds` on domain 42 / `lo` on its own ports and reaches `overall:'ready'`. Stop leaves nothing running. The dev stack on :41246/:8777 is untouched.
- [ ] `./scripts/test-all.sh --skip-pw` includes and passes the supervisor stage.

## Test Strategy
- **vitest** with stub child scripts in `robot-agent/supervisor/__tests__/fixtures/` and an injected clock, plus a spy `kill`.
- **pytest** for `bridge_probe.py` against a local ZMQ PUB.
- **Live:** run the sim profile only, on domain 42 and loopback ports. Nothing is published on domain 0. Do not start the real-robot profile in development.

## Safety constraints (binding for this task)
- Never set `G1_READ_ONLY=0`, and never use `G1_ARM_ALLOW_UNKNOWN_FSM=1`.
- Never `kill -9` / SIGKILL a sidecar. Stop it with SIGTERM and let it ramp down.
- Starting or stopping services never commands motion and never switches the FSM. Mode changes go only through the existing confirmed, lease-checked base-mode route.
- No DDS publishing on domain 0 in development or tests. Use the sim on domain 42 / `lo`.
- Never run `xr_teleoperate` and the arm_sdk sidecar together.
- The E-stop stays reachable: B/Y and the two-hand pinch in VR, and a visible E-STOP on the desktop session page.
- Development and tests use the sim stack only: the sim agent :41246 and sim sidecar :8777, or branch builds on free ports. Never the real g1-edu-4 (:41245/:8767). Do not stop or restart the running dev stack.

## Implementation notes (2026-10-17)

Decisions made while building it:
- **I1 Sim profile: the `link` step starts the simulator.** The step ids stay fixed; in a `robot: sim` profile, `link` owns the `sim` process (sim_node.py on the profile's domain / `lo`), and readiness is the sim's own `/health`. Sim profiles must use `iface: lo`.
- **I2 `adopt` and `leave`.** Adopt = use the foreign process as that step's process (`owned:false`, readiness checks still apply, never signalled, forgotten on stop). Leave = keep it untouched; the step stays `foreign` and start stays blocked until it is gone.
- **I3 Children log to files, not pipes.** A supervisor restart must not hand a running sidecar a broken pipe. The ring buffer follows the file.
- **I4 Re-adoption identity** = PID + `/proc` start time (rules out PID reuse) + command line, where a command line is also accepted if it still holds the requested command and ends with the requested args. `tsx` re-execs through `#!/usr/bin/env node` after the PID file is written, and the exact match orphaned the agent in the first live run.
- **I5 Stop with a hung sidecar leaves the bridge running**, so the operator still sees the robot's state. The bridge gets SIGINT, then SIGTERM after 5 s. The real bridge often swallows the SIGINT (the KeyboardInterrupt lands in a cyclonedds `__del__`), so it exits on the SIGTERM. That is for TASK-404, which owns the bridge.
- **I6 No auto-restart for any sidecar**, not only arm_sdk ones. The bridge gets ≤3 restarts with 1/2/4 s backoff and the agent 1; an explicit start resets the budget.
- **I7 Extra loader rules:**
  - G1_LOCO_ENABLED=1 (walking) is refused in a real profile.
  - `tsx watch` is refused for the agent.
  - The supervisor composes the ports, domain, iface and robot id itself, and refuses profile values that would contradict them.
  - `${REPO}` expands as well as `${HOME}`.
  - The bridge may take an `env:` block.
- **I8 A start in the other mode** while a sidecar runs fails `mode_mismatch`. Only the confirmed `/sidecar/mode` switches modes. The switch does not compare `base.mode` across it, because read_only without mode control reads "unknown".
- **I9 CI.** A step for the supervisor in `.github/workflows/check.yml` was written, but the push bot may not change workflows. It needs a human push.
