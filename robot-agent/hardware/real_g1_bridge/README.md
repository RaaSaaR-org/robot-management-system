# real_g1_bridge — real-robot closed-loop client (apple-to-plate, NO ROS)

The REAL-ROBOT deployment leg of the `g1_apple_pnp` use case. This directory
replaces NVIDIA's Jetson-Thor / Isaac-ROS deployment path from their GR00T E2E
tutorial with our own stack:

```
G1 EDU (192.168.123.164, DDS domain 0)
  rt/lowstate + rt/dex3/{left,right}/state  ──►  bridge.py  ──►  POST /predict
  RealSense D435 (640x480 RGB, ego_view)         │                vla-server :8000
                                                 │                (configs/g1_apple_pnp.yaml)
  rt/arm_sdk + rt/dex3/{left,right}/cmd  ◄───────┘                → ZMQ → GR00T PolicyServer :6555
  (ONLY when armed — see safety model)
```

Authoritative contract: `$UNITREE_ROOT/_data/apple_pnp/CONTRACT.md`
Robot-day procedure: `docs/real-g1-apple-runbook.md` (repo root).

## Files

| File | Purpose |
|---|---|
| `bridge.py` | Closed-loop client: DDS state → 43-dim CONTRACT state + D435 frame → `/predict` → (16, 31) chunk → exec-horizon execution at 30 Hz. Dry-run by default; armed write path behind a two-factor gate. |
| `mock_loop.py` | Robot-free validation on DDS **domain 9**: synthetic states, 31-dim zero-delta HTTP stub, cmd-topic silence/traffic monitors. Run it after any change to `bridge.py`. |

## Environment

Conda env **`env_isaaclab_51_unitree`** (cyclonedds 0.10.x + unitree_sdk2py +
numpy + Pillow + requests):

```powershell
$CONDA_ENVS/env_isaaclab_51_unitree/python.exe bridge.py --help
```

`pyrealsense2` is imported lazily — only needed when using the real D435
(install into the same env before robot day: `pip install pyrealsense2`).

DDS interface handling follows the loopback-validated `g1-sensor-toolkit`
pattern: no `CYCLONEDDS_URI` needed; pass the NIC **name** (default
`"Ethernet 3"` = the 192.168.123.10 robot-LAN port on GPU_BOX) or `--no-iface`
for loopback/mock runs. Domains: **0 = real robot, 1 = sim, 9 = mock tests.**

## Safety model

**Stage 1 rule (CONTRACT.md): the real robot is READ-ONLY.** The bridge
enforces this structurally, not by convention:

1. **Dry-run is the default.** Sensors → predict → per-tick logging of the
   full 31-dim would-be command (`cmd_tick` JSON lines). In dry-run **no DDS
   publisher object for any cmd topic is ever constructed** — the process
   cannot write to the robot by construction, not merely by an `if`.
2. **Two-factor arming.** The write path exists only when BOTH
   `G1_BRIDGE_ARMED=1` (env) AND `--arm` (flag) are set. `--arm` alone
   refuses to start (exit code 2). The env var alone silently stays dry-run.
3. **Mandatory rails — on in every mode, no flag disables them:**
   - per-tick joint delta clamp: `--delta-clamp` (default **0.06 rad/tick**)
   - absolute joint-limit clamp (table from
     `../sim_evaluator/mjcf/g1_dex3/g1_43dof_fixedbase.xml`, shrunk by
     `--limit-margin`, default 0.05 rad; margin auto-capped on narrow hand
     ranges so limits never invert)
   - stale-state watchdog: abort + ramp-down if `rt/lowstate` older than
     `--stale-ms` (default 200 ms)
   - predict-latency watchdog: `/predict` slower than `--predict-watchdog`
     (default 1 s) → chunk discarded, pose held
   - Enter-key e-stop thread: any Enter press → ramp-down exit
4. **Weight ramp (NVIDIA `blend_ratio` analog).** When armed, the arm-sdk
   blend weight (`motor_cmd[29].q` on `rt/arm_sdk`) ramps 0 → 1 over
   `--ramp-seconds` (default 3.0) and is ramped **back to 0 on ANY exit** —
   normal end, exception, Ctrl+C, e-stop, watchdog — via `try/finally`.
   `--weight-cap` bounds the ramp top (use e.g. `0.3` for first armed runs).
5. **Intentionally impossible, in every mode:**
   - commanding legs or locomotion: `rt/arm_sdk` slots 0..11 stay
     `mode=0, kp=kd=0`; no loco/sport-mode client is ever linked in
   - executing `navigate_command` / `base_height_command` / `effort_*`:
     rows beyond the 31 executed dims are DISCARDED and logged
     (`discarded_dims` JSON line)
   - `rt/lowcmd` (full-body debug topic): never referenced
   - bypassing the ramp-down: the finally block owns process exit

## State / action contract (from CONTRACT.md)

- **State 43** (radians): `[L-leg 0:6 | R-leg 6:12 | waist 12:15 | L-arm 15:22
  | R-arm 22:29 | L-hand 29:36 | R-hand 36:43]` — body slice is verbatim
  `rt/lowstate` motor order; hands verbatim `rt/dex3/*/state` order.
- **Action 31** position targets: `[L-arm 7 | R-arm 7 | L-hand 7 | R-hand 7 |
  waist 3]`, chunk 16, `--exec-horizon 8` receding horizon.
- Task string: `"move the apple to the plate"`; camera key `ego_view`,
  native 640x480 (no client resize).

## Usage

```powershell
# Stage 1 — read-only sensor check (no VLA, no camera):
python bridge.py --no-predict --max-seconds 15

# Stage 2 — dry-run with live predict (robot + D435 + serving stack up):
python bridge.py --vla-server http://localhost:8000

# Stage 3 — ARMED (robot day only; two-person rule; hand on e-stop):
$env:G1_BRIDGE_ARMED = "1"
python bridge.py --arm --ramp-seconds 3 --exec-horizon 8 --weight-cap 0.3

# Robot-free validation (any machine, DDS domain 9):
python mock_loop.py
```

Useful flags: `--domain`, `--iface` / `--no-iface`, `--hz` (default 30),
`--mock-camera`, `--camera-image <file>`, `--max-ticks` / `--max-seconds`,
`--log-every`.

### Camera source

`bridge.py` opens the D435 **locally via pyrealsense2** (USB on the machine
running the bridge). If robot day instead streams the head camera through
PC2's teleimager image server (the path `g1-sensor-toolkit/g1_camera_grab.py`
uses), grab frames with that tool and feed the bridge via `--camera-image`,
or port its `ImageClient` pattern into a camera class here.

## Gains (armed write path)

From the field-proven controllers in `xr_teleoperate`:
shoulders/elbows kp 80 / kd 3 · wrists kp 40 / kd 1.5 · waist kp 300 / kd 3 ·
Dex3 kp 1.5 / kd 0.2 (RIS position mode byte `(id & 0x0F) | (1 << 4)`).

## Robot-day verification items (could not be verified without hardware)

These are encoded as assumptions in `bridge.py` and MUST be checked during
the staged escalation in the runbook:

1. **arm_sdk ignores zero-gain leg slots** — matches the official Unitree G1
   arm-sdk example (only waist+arms+weight are populated), but confirm no leg
   reaction on the first low-weight armed run.
2. **`motor_cmd[i].mode = 1` for commanded joints** — xr_teleoperate sets it;
   the official arm-sdk example leaves mode untouched. Verify accepted.
3. **Waist gains 300/3 while the waist is actively moving** — xr_teleoperate
   only *locks* the waist at those gains; our policy commands it.
4. **Dex3 right-hand joint order** — `rt/dex3/*/state` index order is used
   verbatim (thumb0..2, middle0..1, index0..1 per the sim/shadow toolkit),
   but xr_teleoperate's *naming* enum swaps middle/index on the right hand.
   Self-consistent state→cmd round-trip either way; verify the checkpoint's
   convention by watching which fingers close during stage 2 dry-run logs.
5. **arm_sdk internal command timeout** — unknown whether the robot holds or
   releases if our 50 Hz publish stream pauses; the publisher thread keeps
   streaming during `/predict` precisely to avoid finding out.

## Validation status

`mock_loop.py` — **30/30 assertions PASS** (2026-07-22, domain-9 loopback,
env `env_isaaclab_51_unitree`): arming guard, bit-exact 43-dim state layout,
31-dim action ordering, navigate/base_height discard logging, dry-run cmd
silence, armed arm_sdk/dex3 message shapes, gain values, leg slots untouched,
weight ramp 0 → 1 → 0 visible on the wire.
