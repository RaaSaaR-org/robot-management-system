---
id: TASK-169
aliases:
- TASK-169
title: Lab bring-up — NeoDEM on a computer connected to a real Unitree G1 EDU
slug: lab-bringup-unitree-g1-edu-hardware
status: todo
priority: 2
owner: ''
projects: []
customers: []
tags:
- robot-agent
- hardware
- g1
- safety
sprint: ''
depends_on: []
due_date: ''
created: 2026-06-21
updated: 2026-07-17
status_note: 'BLOCKED ON HARDWARE ACCESS for all remaining gates. Software prerequisites are done (Stage 0-1 complete incl. live read-only telemetry; Stage-3 sim-eval wiring shipped via TASK-171/172; voice stack PC-validated, see TASK-181). PC-side prep sweep 2026-07-17 closed the last pre-robot gaps (WebXR certs, tv DDS deps, register script) — see "Prep completed" note in the robot-day checklist. Only manual step left: the admin firewall rule (voice/scripts/add_mic_firewall_rule.ps1). Next robot session: work the "Robot-day checklist (2026-07-11)" section below.'
---

# Lab bring-up — NeoDEM on a computer connected to a real Unitree G1 EDU

> ⚠ **The Windows GPU box is retired (2026-08-28).** This file was written when a
> separate Windows/WSL machine ("GPU_BOX") existed. It does not any more — the only
> machine is the Linux dev box with the RTX 5090. Read every mention of GPU_BOX,
> WSL, `.bat` or `C:\...` below as *historical context*, not as where the work
> happens.

**What this means for TASK-169:** the PC-side prep recorded below was done on the
Windows box and does **not** carry over — the npm-script env-syntax note, the
PowerShell firewall scripts and the "native conda envs on GPU_BOX" note are all
historical. The PC side has to be re-established on this Linux box. This does not
change the task's real blocker, which is still access to the physical G1 EDU.


## Description

Staged, safety-first checklist for running NeoDEM on a lab computer wired to a
physical Unitree G1 EDU (Dex3-1, 43 DOF). Today the G1 path is **scaffolding,
not validated** — `robot-agent/hardware/g1_sidecar.py` is marked
`⚠️ HARDWARE-PENDING / UNTESTED`. Do NOT jump to autonomous/VLA control. Work
the stages in order; each gate must pass before the next.

## Current state (2026-06-21)

- `g1_edu` exists in **procedural telemetry / 3D viz only** (`telemetry.ts`,
  `g1-edu.config.ts`, `g1_edu.yaml`); not in real control or the sim-eval pipeline.
- `g1_sidecar.py` is written to spec against lerobot's `unitree_g1` robot/teleop
  + Unitree SDK2 (DDS), but **never run on hardware**. It imports
  `lerobot.robots.unitree_g1` (not installed by default).
- ~~`send_action()` forwards **raw joint positions** with no ramping.~~ FIXED:
  `send_action()` now clamps to real URDF joint limits and slew-rate-limits
  (`G1_MAX_JOINT_VEL`/`G1_CONTROL_HZ`). Still NOT balance control — Stage-4
  caveats unchanged.
- Safety layer (`src/safety/SafetyMonitor.ts`) defaults are arm-shaped
  (ISO/TS 15066 force limits, mm/s speeds), not validated for a humanoid.
- No trained G1 VLA policy — `vla-server` only ran in `--stub` (sine waves).

## Progress update (2026-07-03, lab box GPU_BOX, Windows nativ)

Real G1 EDU 4 is wired (PC2 `192.168.123.164`, ping 0 ms, SSH open).
**Owner directive: Stage 1 is READ-ONLY — no writes to the robot, enforced in code.**

- **Safety finding:** the stock bridge (`lerobot .../unitree_g1/run_g1_server.py`)
  loops `MotionSwitcherClient.ReleaseMode()` at startup (a standing robot loses
  its balance controller!) and opens a lowcmd path; `UnitreeG1.connect()` also
  creates a `rt/lowcmd` publisher. Both are unusable for a read-only stage.
- **New:** `robot-agent/hardware/g1_state_bridge_readonly.py` — state-only
  DDS→ZMQ bridge (`rt/lowstate` → ZMQ :6001). No MotionSwitcher, no publisher,
  no command socket. **LIVE since 2026-07-03, running on the workstation** —
  PC2 recon (SSH) showed the factory image has NO unitree_sdk2py, NO pyzmq and
  no internet (and cyclonedds 0.10.2 has no aarch64 wheels → offline install
  impractical). Instead the workstation NIC (192.168.123.10, adapter
  "Ethernet") joins DDS domain 0 directly: venv `$UNITREE_ROOT/.venv-g1-dds`
  (py3.10 via uv; cyclonedds 0.10.2 win-wheel + pyzmq + numpy) with
  `PYTHONPATH=$UNITREE_ROOT/unitree_sdk2_python` (pinned repo @4f12b01,
  not pip-installed). Zero footprint on the robot. Real lowstate at ~50 Hz.
- **New:** `g1_sidecar.py` has a `G1_READ_ONLY` mode, **default ON** —
  `POST /action` + `POST /record/start` → 403 (verified), lerobot driver never
  loaded, state via ZMQ SUB from the read-only bridge. Runs on this box via
  `$UNITREE_ROOT/.venv-g1-sidecar` (port 8767).
- **Joint-name gate (static):** sidecar `BODY_JOINTS` ≡ `g1.config.ts` (29,
  order-exact), hands ≡ `dex3HandJoints()` (14), `g1_edu.yaml` ≡ sidecar (43);
  DDS motor index 0–28 verified against lerobot `G1_29_JointIndex`.
  Dex3 hands are NOT in `rt/lowstate` (separate DDS topics) — omitted in Stage 1.
- **Agent profile:** `robot-agent/.env.g1-edu` (g1-edu-4, ROBOT_TYPE=g1_edu,
  port 41244). Registered in the fleet; telemetry serves all 43 joints.
  Note: the `dev:g1-edu` npm script uses POSIX env syntax — on native Windows
  start via Git-Bash: `DOTENV_CONFIG_PATH=.env.g1-edu npx tsx watch src/index.ts`.
- **Official Unitree models available locally:** `temp/unitree_model/` (gitignored
  clone of unitreerobotics/unitree_model) — USD models for Isaac Sim: G1 29dof
  rev_1_0, H1, H2, H2_Plus, Go2, B2. The web viewer does NOT need these (it
  bundles the same `g1_29dof_rev_1_0` as URDF+STL in `app/public/assets/robots/g1/`);
  they are for the Isaac-Sim stages (Stage 3+) / unitree_sim_isaaclab. Neither
  variant includes Dex3 hands (URDF has fixed rubber hands; hand joints from
  telemetry are ignored by the viewer).
- **3D-viewer bug found & fixed:** the app's `RobotType` union didn't know
  `g1_edu` → viewer fell back to a generic box. New `normalizeRobotType()`
  in `app/.../robots.types.ts` (maps `g1_edu`→`g1`), applied in OverviewTab,
  Model3DTab and centrally in Robot3DViewer/RobotModel (covers
  SessionDetailPage, RobotHeroSection, VRTeleopSection too). Playwright-verified:
  G1 humanoid renders on /robots/g1-edu-4, badge stays "G1_EDU", no console
  errors. (Model3DTab exists but is not mounted in any reachable tab bar.)

## Stages (each is a gate)

### Stage 0 — Install & network
- [x] Install NeoDEM (server + app + robot-agent) on the lab box. Sim-only smoke
      test first: `cd robot-agent && npm run dev:g1-edu`, confirm telemetry/3D viz.
      *(2026-07-03: installed on GPU_BOX; g1-edu-4 registered, telemetry serves
      43 joints. 3D viz Playwright-verified — G1 humanoid renders after the
      `g1_edu` type-mapping fix, see progress notes.)*
- [ ] Install Unitree SDK2 + lerobot with the `unitree_g1` robot/teleop classes.
      Confirm `python -c "import lerobot.robots.unitree_g1"` succeeds.
      *(Deliberately NOT needed for read-only Stage 1 — the ZMQ read path avoids
      the driver. Required from Stage 2 (lerobot-record) onward.)*
- [x] Wire G1 DDS network: set `G1_ROBOT_IP`, `G1_NET_INTERFACE` (default
      192.168.123.164 / eth0), confirm `ping` + DDS discovery.
      *(2026-07-03: ping OK, SSH open. DDS stays on PC2; workstation consumes
      the read-only ZMQ bridge instead of joining DDS directly.)*

### Stage 1 — Read-only (NO motion)
- [x] Start `g1_sidecar.py` (port 8767). `GET /health` → `connected: true`.
      *(2026-07-03: G1_READ_ONLY mode, `G1_LOWSTATE_ENDPOINT=tcp://127.0.0.1:6001`;
      `/health` → `{"status":"ok","connected":true,"read_only":true}` with the
      local bridge live.)*
- [x] `GET /state` returns real joint positions. **Verify every joint name
      matches `g1_edu.yaml` / `g1-edu.config.ts`** (43 DOF) — fix mismatches.
      *(2026-07-03: LIVE-verified — 29 real body joints, names exactly match
      the configs (static 3-way check passed earlier); values plausible and
      changing (bent knees/ankles/elbow, IMU rpy). The 14 Dex3 hand joints are
      deliberately absent in Stage 1: rt/lowstate carries no hand data and we
      never fabricate — server telemetry now reports 29 jointStates, not 43.)*
- [x] Confirm live joint values render in the app's 3D robot viewer.
      *(2026-07-03: Playwright-verified against the real robot — viewer shows
      the actual non-neutral pose (bent elbows/knees/ankles matching telemetry);
      liveness confirmed by telemetry diffing (17/29 joints drifted at sensor-
      noise level over 5 s). Note for future checks: pose bends are only clearly
      visible in zoomed canvas crops, and liveness of a standing robot is better
      judged by telemetry diffs than by eyeballing screenshots.)*
- [ ] E-stop reachable and tested (physical + Unitree remote) before any motion.

### Stage 2 — Teleop data collection (safest first motion)
- [ ] Use Unitree's **native** teleop (remote / exoskeleton) via lerobot-record
      (`/record/start`) — Unitree handles balance; we only record.
- [ ] Collect a small LeRobot v2.1 dataset; verify it imports + plays back in the
      Datasets / Episode viewer, and curation (trim/delete) works on it.

### Stage 3 — Sim & policy (off the robot)
- [x] Wire G1 into the MuJoCo sim-eval pipeline (vendor `g1_with_hands.xml` +
      meshes into `robot-agent/hardware/sim_evaluator/mjcf/g1/`, add a G1 env,
      `--embodiment` flag, register in `SimulationService.ts`).
      *(Shipped via TASK-171/172 on PR #164: real Unitree G1 meshes vendored
      (`mjcf/g1/g1_29dof.xml`, 36 STLs), `envs/g1_env.py`, twin-derived
      SimScenes selectable in the Simulation page (MuJoCo backend). Re-verified
      2026-07-11: sim_evaluator pytest 50 passed / 1 skipped on GPU_BOX.)*
- [ ] Train a policy on the Stage-2 data; evaluate in sim. Define a success bar.
      *(Blocked by Stage 2 — no real teleop dataset yet. Note: GR00T-N1.7
      finetuning on G1+Dex3 data through the platform is already proven on this
      box with public Unitree datasets (TASK-180), so once Stage-2 data exists
      this bullet is routine.)*

### Stage 4 — Closed-loop AI on hardware (highest risk)
- [ ] Only after Stage 3 passes. Robot on a **gantry/harness**, hardware e-stop,
      tuned safety limits for the humanoid.
- [ ] Add action ramping / rate-limiting to `send_action()` (no raw position jumps).
      *(Code exists since 2026-07: URDF-limit clamp + slew-rate ramp — but
      UNTESTED on hardware, and blocked by G1_READ_ONLY until this stage.)*
- [ ] Start with tiny action scale; supervise continuously.

## Robot-day checklist (2026-07-11) — consolidated next-session plan

Everything solvable without the robot is done. When the G1 EDU is next
available, work this list in order (it folds in the open hardware items from
TASK-170, TASK-172 and TASK-181 too):

> **Prep completed 2026-07-17 (final PC-side sweep):**
> (a) WebXR TLS certs generated in `%USERPROFILE%\.config\xr_teleoperate\`
> (CN=quest-teleop, SAN localhost/127.0.0.1/192.168.123.10, valid to 2036;
> televuer path resolution verified) — VR-teleop cert blocker gone.
> (b) `tv` conda env now has cyclonedds 0.10.2 + unitree_sdk2py 1.0.1 (-e) +
> teleimager 1.5.0 (-e); `ChannelFactoryInitialize(1)` OK, existing pins untouched
> — real-robot `teleop_hand_and_arm.py` (DDS domain 0) is now runnable.
> (c) `server/src/scripts/register-local-dataset.ts` staged (parameterized
> `--dir`/`--name`, refuses v3.0, smoke-tested against dev.db) — no file editing
> needed to register the robot-day dataset. Server typecheck green.
> (d) Voice preflight re-run: only robot-gated checks red (robot ping, mic
> multicast, adapter, A2A agent — all expected off); NIC/Ollama/models/GPU green.
> **Remaining manual admin step:** UDP-5555 firewall rule — run
> `robot-agent/voice/scripts/add_mic_firewall_rule.ps1` in an elevated shell
> (UAC elevation was declined on 2026-07-17). For the Wi-Fi (non-USB) Quest
> variant additionally `quest-sim-teleop/windows/firewall_8012.ps1` (also admin);
> the USB `adb reverse` route needs neither.

1. **Safety first (this task, Stage 1 gate):** verify physical e-stop + Unitree
   remote e-stop before any motion.
2. **Voice validation (TASK-181):** adapter venv is ready
   (`$UNITREE_ROOT/.venv-g1-audio`, mock-smoke-tested 2026-07-11); one admin step
   remains — the UDP-5555 firewall rule (exact command in TASK-181).
3. ~~**Live scan session (TASK-170 Phase 5 hardware)**~~ ✅ DONE 2026-07-17
   against the powered G1: LiDAR enabled (authorized switch write), 42 real
   MID-360 frames streamed robot→DDS→sidecar(`dds` source)→agent hardware
   branch→server `ScanSession`, twin-builder built twin `7d3cfc3e` (111,448
   pts, cloud+occupancy+mesh+MuJoCo scene, ready, renders on /sites). LiDAR
   switched OFF again. TASK-170 closed. Remaining quality upgrade (NOT a
   gate): a true *walked* sweep with real localization once the robot may
   move under supervision (Stage 2+) — today's sweep was stationary and
   pose-stamping used the sim pose (position is honestly SIM-labeled).
4. **Stage 2 teleop recording (this task):** record a small LeRobot dataset via
   VR teleop (Quest 3 + xr_teleoperate) or Unitree native teleop; import +
   curate it in the app (curation pipeline hardened under TASK-168).
   *(2026-07-12 headset-/robot-free dry-run PASSED the full data path: MuJoCo
   `--no-quest` teleop with real G1_29 arm IK, synthetic xr_teleoperate episodes
   → `convert_unitree_json_to_lerobot --robot-type Unitree_G1_Dex3` (v3.0) →
   `convert_v3_to_v2.py` (v2.1) → registered + rendering in the app (dataset
   "VR Teleop Pipeline Test (synthetic)"). Follow
   `$UNITREE_ROOT/_data/vr_teleop_pipeline_test/ROBOT_DAY_RUNBOOK.md` and
   `docs/vr-teleop-data-collection.md`. Environment caveat: WSL is GONE from
   GPU_BOX — use the NATIVE conda envs `tv` (teleop) and `unitree_lerobot`
   (conversion), created 2026-07-12. Must-fix before the session: (a) generate
   WebXR TLS certs (cert.pem/key.pem) — Quest cannot connect without them;
   (b) local-dir dataset registration is script-only (`POST /api/datasets` has
   no storagePath) — use the register script from the runbook; (c) the v2.1
   conversion step is mandatory for local rendering; (d) real-robot teleop
   additionally needs cyclonedds + unitree_sdk2py installed natively in `tv`.)*
5. **Full circle (TASK-172 §A):** run the same policy in sim and on the real
   G1 in the scanned room, `POST /validations` → real `domainGapScore`, then
   the `REQUIRE_SIM_VALIDATION` deploy gate with a measured gap.
   *(2026-07-21: TASK-172 closed — the gate's runtime flip is already proven
   live on an isolated server instance for all 5 branches, and the stub VLA
   server is 29-dim/G1-capable (`VLA_ACTION_DIM=29`, vla-server PR #7).
   Only the real-G1 eval → measured gap remains here.)*
6. **TASK-173 tail:** walk the G1 into the CoACD-decomposed scanned-room
   collision scene (already merged, sim-side tests green).

## Test strategy

- Each stage has an explicit gate above; do not advance until met.
- Keep the robot on a harness for any stage that produces motion under NeoDEM
  control (Stage 4). Stage 2 motion is driven by Unitree's balanced teleop.

## Key files

- `robot-agent/hardware/g1_sidecar.py` — hardware bridge (DDS)
- `robot-agent/hardware/recorder.py` — lerobot-record (robot/teleop CLI)
- `robot-agent/src/embodiment/configs/g1_edu.yaml`, `src/robot/joint-configs/g1-edu.config.ts`
- `robot-agent/src/safety/SafetyMonitor.ts`
- `robot-agent/hardware/sim_evaluator/` — MuJoCo eval (SO-101 today)
