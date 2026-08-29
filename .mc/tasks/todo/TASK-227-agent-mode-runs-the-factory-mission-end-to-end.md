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
against 0.533 m of shoulder-to-knuckle reach — the robot cannot touch the apple from
its own authored standing spot. (0.533 m is the grasp centre, where a held object
actually sits; 0.627 m shoulder-to-fingertip is the hard geometric ceiling. Both are
summed from `g1_43dof_fixedbase.xml` in `factory_pauseroom_layout.py`, and they are
the only two reach numbers this PR should quote.) The vendor's working manipulation
task uses 0.447 m. Move it, derive it in code, and add a reachability check to
`verify_factory_scene_offline.py`, which today never compares any distance to where
the robot stands.

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

Built and verified OFFLINE (PR #277) — none of these is confirmed live yet:

- [x] A camera facade adapts the scene's ZMQ streams to the sidecar contract (~115 checks)
- [x] `walk` segments and holds its heading (2170 tests, no assertion changed)
- [x] A powered sliding door exists — its geometry, openness→joint mapping, clear
      widths, sensor radii and stroke timing are checked offline by
      `verify_factory_scene_offline.py`
- [x] The driver that moves it is covered by a stub-`env` test
      (`robot-agent/hardware/isaac_scenes/tests/test_pause_door.py`, 11 cases, no GPU and
      no torch): it reports the leaf positions it MEASURES rather than the ones it
      commanded, re-syncs after a scene reset, honours a fractional manual override, and
      survives a transient failure on the construction-time probe
- [x] The standing spot is derived in code rather than hand-typed — worst corner of the
      reset-jitter box 0.537 m against the 0.550 m budget, i.e. 0.013 m of margin. (The
      often-quoted 0.476 m is the BEST case: crouched, at the nominal apple.) 0.537 m is
      also 0.004 m outside the 0.533 m straight-arm knuckle reach, so the worst corner
      leans on the torso pitch the budget's slack was chosen to cover — see the arrival
      gap below
- [x] `vla_skill` is planner-emittable, `abortAll()` reaches it, outcomes are three-way
- [x] Arms and hands are drivable over DDS without disturbing the 100 Hz loco loop (97 checks)
- [x] `analyse_map_take.py --json` emits the shared schema, provably additively (31 tests)
- [x] A NeoDEM-branded 1280×720 compositor that invents no numbers

Still open, and each needs the live run:

- [ ] The door is actually driven per control step. Nothing offline shows this: the
      verifier's entire relationship to `mdp/pause_door.py` is one `os.path.isfile`, so a
      syntax error in that file passes every check it runs. The claim rests on the driver
      being an observation term and `action_provider_wh_dds.py:721-729` calling
      `observation_manager.compute()` unconditionally every step — read in the vendor
      checkout, never executed here
- [ ] The factory scene actually publishes camera frames (nobody has seen its banner)
- [ ] An 8.4 m crossing arrives, with measured heading error reported
- [ ] The robot ends up close enough to the apple to grasp — see the arrival gap below
- [ ] One run produces `summary.json` + `results.json` + a video
- [ ] The run is repeatable from the frozen protocol script

## First live run — 2026-08-29, and what it actually showed

The stack was brought up against the factory scene for the first time. **The scene loads,
the door articulation is real, and the G1 walks.** Four things stopped it before that, none
of which any offline check could have caught, because each is a property of the LIVE rig:

| # | What was wrong | How it presented | Fixed by |
|---|---|---|---|
| 1 | The scene in the vendor checkout was a pre-door snapshot: `mdp/pause_door.py` and `pause_room_door.usda` **absent**, three more files stale | every offline verifier green against the repo, while Isaac would have loaded the previous day's scene | new `isaac_scenes/install_into_checkout.sh` (+`--check`), gated at bringup step 0 |
| 2 | Bridges pinned `--iface lo`; the sim calls `ChannelFactoryInitialize(1)` bare and autodetermines `enp130s0` | sim healthy at 16 Hz, DDS banners fine, `cmd=[0,0,0,0.80]` — which is the vendor's own DEFAULT, not anything we sent | `IFACE` now defaults empty so the bridges autodetermine too |
| 3 | The bridge's idle stand height (0.75, the real G1's nominal) is an active crouch command against a sim holding 0.80 | robot slid **0.455 m and rotated −59.2°** while commanded to stand still — 35x the entire grasp margin | `isaac_loco_bridge.py --stand-height`, default 0.80 |
| 4 | A leftover dev `robot-agent` on the sidecar's default port saw `/state` returning `joints: []` and issued `StopMove` | every move countermanded a few seconds in by an `api_id=7105 velocity=[0,0,0]` nobody sent | stop stray agents before driving; see the note below |

### The walk, measured

`vx=0.30` produces **no gait at all** in this scene: the command demonstrably reaches the
policy (the sim's own `cmd=` log shows it) and the legs stay frozen to three decimals while
the raw action saturates. `vx=0.50` walks. First measurement in the factory hall:

| | |
|---|---|
| distance | **4.381 m in 28.1 s = 0.156 m/s** (31 % of commanded) |
| heading drift | **−0.90 °/s**, −25.4° over the walk, with `wz` commanded at exactly 0 |
| gait | a foot airborne in 16/19 samples, feet alternating |
| command rate | 100.0 Hz on the wire (required: the sim's slot self-clears every policy step) |

At 0.156 m/s the 8.4 m crossing is ~54 s, and at −0.90 °/s that is ~−48° of uncorrected
heading. This is the arrival gap below, now with numbers from this scene rather than the
warehouse.

**`walk` must therefore command ≥ 0.5 m/s here**, and the 0.3 default in `config.ts` would
have produced a mission that stands still and reports success.

### Still blind, and now we know exactly why

The factory scene DOES publish camera frames — `/dev/shm/isaac_{head,left,right}_image_shm`
are written at ~1.75 Hz — but nothing ever appears on ZMQ 55555/6/7. The vendor's image
server binds its publisher lazily inside `publish()`, which is only reached when a frame
exists; its per-camera thread reads the ring buffer once at startup, finds it empty, sets a
**shared** stop event and breaks (`image_server.py:1368-1370`), killing all three cameras for
the life of the process. Measured miss: **1.74 s**. Port 60000 keeps answering config queries
perfectly throughout, so every other signal still looks healthy.

`"[Image Server] <cam> is ready."` is not evidence — `IsaacSimCamera.__init__` sets the ready
flag unconditionally (`image_server.py:1141-1143`), so `wait_until_ready` is a no-op.

Two fixes, either sufficient: pre-seed the three shm segments before the container starts, or
`--camera_write_interval 1`, which makes the first `env.reset()` compute write the shm before
the image server is created. The second is config-only but costs ~39 ms of a 55 ms control
step (16 Hz → ~10 Hz), and this rig's walking is already rate-sensitive, so the seed is
preferred.

The bringup now treats `returned no frame` as fatal and waits for **55555 to be bound**
rather than for the banner, which is printed 2 s *before* the failure.

### Open, and unchanged by this run

* No VLA server is running and the bringup starts none — nothing on :8000. The grasp step
  has no policy behind it yet.
* `door` is declared after `policy` in the env cfg, and the camera reads in `policy` are
  unguarded, so a camera exception would abort `compute()` before the door driver runs.
  Harmless while `--camera_write_interval 10` shields it 9 steps in 10; becomes real if the
  interval is ever set to 1. One-line fix: declare `door` first.
* The sidecar's `/state` reports no joints in this rig — its read-only state source is a TCP
  socket to the real robot's IP. Anything gating on telemetry will safety-stop.

## The arrival gap — found while fixing the reach, not yet solved

The standing spot now has roughly **0.013 m of reach margin** at the worst corner
of the apple's jitter box. Measured locomotion is ~0.11 m/s with ~2°/s of yaw
drift over an 8.4 m crossing. Arrival error is therefore near-certainly an order
of magnitude larger than the margin: **the scene assumes something else puts the
robot on the spot, and nothing does.**

The heading fix narrows this but cannot close it — it corrects heading, not
position, and there is no position feedback at all (`isaac_odom.py` measures yaw;
x and y are dead-reckoned).

Three ways out, in preference order — see [[TASK-228]]:
1. A final visually-servoed approach that closes on the table, not on odometry.
2. Widen the margin: move the apple toward the near edge, or raise the reach
   budget if the arm genuinely supports it.
3. Place the robot on the spot for the manipulation phase and film the walk and
   the grasp as two measured segments. Honest, and the least interesting.

## What to expect

**The grasp will most likely fail on run #1.** NVIDIA's ApplePnP-V1 reaches 14/20 =
70% real grasps — but in NVIDIA's Arena scene, with a **fixed-base** robot and
real-scene-matched geometry. `vla-training/docs/isaaclab-arena-eval.md` identifies
**rendering transfer** as the dominant failure mode: holding state fixed and swapping
only the pixels, every one of five models lost more than half its commanded arm
direction. A policy tuned to Arena meeting the factory pause room is exactly that
experiment. Record it, do not hide it.
