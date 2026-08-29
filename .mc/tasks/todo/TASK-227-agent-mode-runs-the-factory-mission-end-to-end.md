---
id: "TASK-227"
aliases: []
title: "Agent Mode runs the factory mission end to end — and the run is scored, filmed, and repeatable"
slug: "agent-mode-runs-the-factory-mission-end-to-end"
status: "in-progress"
priority: 1
owner: ""
projects: []
customers: []
tags: ["core", "sim", "agent-mode", "vla"]
sprint: ""
depends_on: ["[[TASK-203]]", "[[TASK-226]]"]
due_date: ""
created: "2026-08-29"
updated: "2026-08-29"
---

# Agent Mode runs the factory mission end to end — and the run is scored, filmed, and repeatable

## Description

Make one Agent Mode mission run in the Isaac factory scene: the G1 walks across the
hall, passes through the pause-room door, approaches the table, and a VLA policy
attempts to move the apple onto the plate. Produce a **scored, machine-readable
record** of the run and a **shareable video**, so the mission can be repeated,
compared, and improved rather than admired once.

The deliverable is the measurable loop. A run in which the robot walks correctly and
fails to grasp is a legitimate, publishable result — and is the most likely first
outcome (see "What to expect").

## Where this stands

Three mature machines already exist and must be reused, not rebuilt:

| machine | location | state |
|---|---|---|
| Agent Mode Isaac harness | `video-studio/series/measured/shoot/` | bringup, pre-flight assertions, drive scripts, live probes, pass/fail verdict; 14 takes shot |
| Film pipeline | `video-studio/` | HTML/GSAP → deterministic MP4, brand-gated, evidence-checked; 7 episodes shipped |
| Scored-run protocol | `vla-training/eval/` | ~35 runs; Wilson CI, paired McNemar, protocol-drift guard, video compositors |

The gap is a join, not a system.

### The blocking gap nobody had hit

**Agent Mode is blind in the factory scene.** Perception blocks (`look`, `scan_room`)
fetch frames over the sidecar contract `GET /cameras/{name}/snapshot`. The NVIDIA
warehouse takes serve that from `isaac_capture.py --serve 8779`. The factory scene
runs under the vendor's `sim_main.py` with the wholebody DDS provider, which has no
such facade — it publishes camera frames over **ZMQ** instead (`image_server.py`,
head 55555 / left wrist 55556 / right wrist 55557). No Agent Mode run has ever
happened in the factory scene, so this had never surfaced.

### The unlock

The vendor's `action_provider/action_provider_wh_dds.py` accepts **three** DDS
channels on domain 1 simultaneously:

| channel | drives |
|---|---|
| `rt/run_command/cmd` → `[vx, vy, wz, height]` | 12 leg joints, via `policy.onnx` |
| `rt/lowcmd` → `positions[15:29]` | the 14 arm joints |
| `rt/dex3/{left,right}/cmd` | the 14 Dex3 finger joints |

(The 3 waist joints are parked at default and are **not** commandable.)

So walking and grasping can share one sim process. NeoDEM's `isaac_loco_bridge.py`
publishes only the first of the three.

## Settled decisions

1. **The door is a powered door.** It opens automatically on approach: genuine
   articulated geometry that moves and collides, built on the vendor precedent at
   `tasks/common_scene/base_scene_pick_redblock_into_drawer.py:87-125`. The robot
   does **not** push it open — requiring a humanoid to operate a door handle is a
   separate research problem. Any narration must say "powered door", never "the
   robot opened the door".
2. **Video is NeoDEM brand, landscape** — 1280×720, void black `#0A0A0A`, Matrix
   Green `#00FF41`, Cobalt `#2A5FFF`, Inter + JetBrains Mono. Not the EmAI vertical
   film style. Compositor mechanics reused from `vla-training/eval`, styling replaced.
3. **Everything runs local.** `qwen3-vl:8b` (6.1 GB) pinned resident for planner and
   vision; the existing harness already aborts if free VRAM drops under ~11 GB for
   Isaac. Cloud Qwen3 is unnecessary unless measurement says otherwise.
4. **Score from telemetry, never from the env reward.** For any `*Wholebody*` task
   `sim_main.py:476-479` forces `use_rl_action_mode=True` and
   `robot_control_system.py:120-127` never calls `env.step()`, so the reward manager
   is never invoked. `mdp/rewards.py` scores nothing.
5. **`unknown` is a legitimate outcome.** "Ran to `maxSteps` without throwing" is not
   success. ReViP: pi0 continued toward the goal in 46/50 trials with clear visual
   evidence it never grasped anything.

## Details

### Robot Agent — navigation
`walk` measures distance only and never heading. Measured: `vx=0.3` for 25 s gave
2.7 m (~0.11 m/s) while heading drifted +45° → −18° (~2°/s). Segment long walks and
correct heading between segments, reusing the closed-loop turn's `turnGain`
estimator. Key file: `robot-agent/src/agent-mode/block-executor.ts`.

### Robot Agent — the VLA skill block (TASK-226)
Step 0 first and shippable alone: `runVlaSkill` registers with
`skillExecutorRegistry`, claims/releases the `vla` control-owner lock on every path,
and passes an abort hook — today an Agent-Mode rollout is invisible to E-Stop.
Then the `vla_skill` block across all three mirrored type files and every allow-list
(two of which **fail open**: `initiative.ts`, and `journal.ts:449-451` `blockTrust()`).
Use the trained task string from `VLA_EVAL_PROFILES`
(`server/src/services/SimulationService.ts:189-208`) — `'move the apple to the plate'`,
exact, no trailing period, `maxSteps: 600`.

### Robot Agent — hardware
- `isaac_camera_facade.py` — ZMQ camera streams → the sidecar HTTP camera contract.
  Must fail honestly on a stale or absent frame; a silently-served black frame would
  corrupt every downstream scene-memory observation.
- `isaac_manip.py` + bridge extension — arm and hand DDS publishing. Honour the three
  contract mismatches documented in `vla-training/eval/isaac_dds_bridge.py`:
  right-hand slot order remap by name, the parked waist, and the **left-hand grip
  code** (`action[14:21]` is a normalised code, not radians; the decoder is
  `eval/hand_grip_decoder.py` and skipping it produced 0/15 instead of 13/15).

### Isaac scene
`PLACES["table_front"] = (10.00, 5.35)` puts the apple 0.926 m from the pelvis
against a ~0.60–0.70 m reach — the robot cannot touch the apple from its own authored
standing spot. The vendor's working manipulation task uses 0.447 m. Move it, derive
it in code, and add a reachability check to `verify_factory_scene_offline.py`, which
today never compares any distance to where the robot stands.

### Scoring and video
Add `--json` to `analyse_map_take.py` emitting `summary.json` + `results.json` in the
`vla-training/eval` schema, purely additively (identical stdout and exit code).
Freeze the run definition in a `run_agentmode_protocol.sh` following the
`run_v16_protocol.sh` pattern. Reuse `compare_runs.py`'s statistics rather than
reimplementing Wilson CI or McNemar.

## Test Strategy

- Offline verifiers for every hardware module, in the `verify_isaac_odom_offline.py`
  style: numbered independent PASS/FAIL checks, no simulator, no GPU.
- `npm run typecheck` + `vitest` across robot-agent, server and app. TypeScript covers
  only ~5 of the ~31 files a block-kind change touches — grep every switch/record
  over block kinds and check the rest by hand.
- One live run on the RTX 5090. Only one `sim_main.py` at a time: its exit handler
  SIGKILLs every other instance.

## Acceptance Criteria

- [ ] Agent Mode can see in the factory scene (`look` returns a real, fresh frame)
- [ ] An 8.4 m walk across the hall arrives, with measured heading error reported
- [ ] The powered door opens on approach and the robot passes through
- [ ] The robot stands within reach of the apple, measured
- [ ] A `vla_skill` block is planner-emittable, safe (abort reaches it), and reports
      `succeeded` / `failed` / `unknown` honestly
- [ ] One run produces `summary.json` + `results.json` in the shared schema
- [ ] One run produces a NeoDEM-branded 1280×720 video that invents no numbers
- [ ] The run is repeatable from a single frozen protocol script

## What to expect

**The grasp will most likely fail on run #1.** NVIDIA's ApplePnP-V1 reaches 14/20 =
70% real grasps — but in NVIDIA's Arena scene, with a **fixed-base** robot and
real-scene-matched geometry. `vla-training/docs/isaaclab-arena-eval.md` identifies
**rendering transfer** as the dominant failure mode: holding state fixed and swapping
only the pixels, every one of five models lost more than half its commanded arm
direction. A policy tuned to Arena meeting the factory pause room is exactly that
experiment. Record it, do not hide it.
