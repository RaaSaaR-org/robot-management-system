# sim_g1_dds — the G1 EDU + Dex3 simulator that speaks Unitree's wire protocol

A MuJoCo sim node that is indistinguishable, on the wire, from a real Unitree
G1 EDU. Unmodified `unitree_sdk2py` scripts — including Unitree's own
`g1_arm5_sdk_dds_example.py` and `g1_loco_client_example.py` — drive it.

Built for Agent Mode (TASK-194) so the planner speaks **one** API, `LocoClient`,
in simulation and on hardware. Only the DDS peer changes.

| File | What |
|---|---|
| `joints.py` | SDK motor index → MJCF actuator/joint name tables |
| `loco_state.py` | Pure state machine: pose integration, FSM gating, arm gestures. No DDS, no MuJoCo — unit-testable on its own |
| `loco_service.py` | Serves the `sport` RPC service on `rt/api/sport/{request,response}` |
| `sim_node.py` | MuJoCo + DDS peer + optional sidecar-compatible HTTP facade |
| `test_loco_state.py` | pytest for the state machine |
| `e2e_loco_check.py` | Integration check: drives the sim with a real `LocoClient` and asserts the physics |
| `cine_recorder.py` | Cinematic MP4 recording (follow / orbit / wide / any MJCF camera) → ffmpeg; `--record` flag and `/record/*` routes |
| `demo_clip.py` | One Agent Mode command → captioned explainer clip (records, runs the plan, burns block captions) |

## Topics

| Direction | Topic | Type |
|---|---|---|
| in | `rt/arm_sdk` | `LowCmd_` (`motor_cmd[29].q` = 0..1 blend weight) |
| in | `rt/dex3/{left,right}/cmd` | `HandCmd_` |
| out | `rt/lowstate` | `LowState_` |
| out | `rt/dex3/{left,right}/state` | `HandState_` |
| out | `rt/odommodestate` | `SportModeState_` (measured base pose) |
| rpc | `rt/api/sport/{request,response}` | api ids 7001–7005, 7101–7107, 7110/7111 |

DDS domains by convention: **0 = real robot, 1 = sim, 9 = mock/tests.**

## Running

```bash
export CYCLONEDDS_HOME=<your cyclonedds install prefix>

# headless, with the HTTP facade the robot-agent can point at
python sim_node.py --domain 1 --http-port 8777

# live window (macOS needs mjpython — see gotcha 3)
mjpython sim_node.py --domain 1 --viewer
```

Then point the robot-agent at it:

```bash
HARDWARE_SIDECAR_URL=http://localhost:8777 npm run dev:g1-edu
```

Port convention: **8777 = this sim's facade** (also the `e2e_loco_check.py`
default and what `.env.g1-edu-agent.example` points at); 8767 belongs to the
real robot's `g1_sidecar.py`. Keeping them distinct means a mis-pointed
`HARDWARE_SIDECAR_URL` fails loudly instead of quietly driving the wrong target.

The facade serves `/health`, `/cameras`, `/cameras/<name>/snapshot`, `/state`
and `/loco/*`. Its `/loco/*` routes deliberately go **out through a real
`LocoClient` over DDS and back in through our own service** rather than poking
the state machine directly — otherwise the demo would prove nothing about the
wire.

## Recording clips (demo / social videos)

The sim can render a cinematic camera to MP4 on the physics thread while
everything else (DDS, Agent Mode) runs as normal. No GPU needed — MuJoCo's
offscreen renderer on the M-series CPU/GPU keeps up with 1080×1920 @ 30 fps.

```bash
# whole session, from start-up
python sim_node.py --domain 1 --http-port 8777 --record session.mp4 --record-cam follow

# per clip, over the facade (what demo_clip.py uses)
curl -X POST localhost:8777/record/start -d '{"path":"clip.mp4","cam":"orbit","size":"1080x1920"}'
curl -X POST localhost:8777/record/stop
curl localhost:8777/record            # status
```

Camera modes: `follow` (chase cam behind the robot, smoothed), `orbit` (slow
orbit, beauty shot), `wide` (fixed establishing shot of the room), or any MJCF
camera name (`head_camera` = the robot's own POV).

`demo_clip.py` scripts a whole explainer clip: it starts recording, submits one
command to the robot-agent's Agent Mode, waits for the plan, stops recording and
burns the command + each block (as it runs) + result as captions:

```bash
.venv/bin/python demo_clip.py "Go to the table and tell me what is on it" \
    --out clips/table.mp4 --cam follow --title "NeoDEM · Agent Mode" \
    --pip head_camera            # inset: what the robot's own camera sees
    --start=-0.5,-0.5,90         # x, y, yaw° to teleport to first
    --prime "look"               # a command run BEFORE recording (warms scene memory;
                                 #   Agent Mode's scene memory is per process)
```

It writes `clips/table.mp4`, `clips/table.raw.mp4` (no captions),
`clips/table.pip.mp4` (the inset stream) and `clips/table.json` (the plan with
per-block timings, for editing elsewhere). Rendering runs on the physics
thread, so `/health` now reports `behind_s` and the sim warns when it trails
real time — the executor waits in wall seconds, and a lagging sim under-executes
every motion.
Needs the robot-agent running with `npm run dev:g1-edu-agent` (Ollama models
pulled) and this sim on `--http-port 8777`.

## Scenes

Default is `../sim_evaluator/mjcf/g1_dex3_room_scene.xml`: a ~6×6 m room with a
table (red hat on it), chair, shelf, doorway and a person figure. Its robot
include, `g1_dex3/g1_43dof_planarbase.xml`, is **generated** — regenerate with
`python ../sim_evaluator/mjcf/g1_dex3/build_planarbase_include.py`.

The base is **kinematic**: the pelvis has x/y/yaw position actuators driven from
the integrated loco velocity, the legs stay in the stand pose, and the feet float
~1.5 cm off the floor so contact friction never fights the base. There is no
gait in v1 — what matters is that the head camera genuinely moves through the
room, so `look` returns different images from different places. A real gait
policy is a follow-up.

Both halves of "stays in the stand pose" are load-bearing and were each broken
once, so they are worth stating precisely:

* **Feet clear the floor.** `PELVIS_Z = 0.807` in the builder is measured, not
  chosen: at 0.775 the feet were 1.69 cm *inside* the floor (`mj_forward` →
  `ncon = 8`, `dist = -0.0169` on every floor↔foot pair), and the resulting
  ~46 kN first-step impulse ratcheted the ankles out of the stand pose — angles
  that then went out verbatim on `rt/lowstate`. At 0.807, `ncon = 0` at rest.
* **The hold pose is latched.** With no `rt/arm_sdk` publisher the blend weight
  is 0, which is Agent Mode's permanent state (it drives the sim only through
  `LocoClient`). The fall-back target for that share is captured *once*, when the
  weight last changed, and held — reading it live from `qpos` every step makes
  `ctrl[a] == qpos[a]`, i.e. zero restoring torque, and gravity then drags the
  upper body to its limits: `waist_pitch` pinned at +0.52 rad within 2 s, tilting
  the head camera from the designed 15° down to ~45°, with `waist_roll` following
  later and canting every image-relative bearing. Latched, the worst joint
  settles at 0.017 rad and stays there indefinitely.

### Yaw is continuous where it drives, wrapped where it reports

`LocoState.pose.yaw` accumulates and is **never wrapped**: `sim_node.py` writes it
into `base_yaw`, a `kp=20000` position actuator on a ±100 rad hinge. A setpoint
wrapped to (-π, π] steps by 2π in a single 2 ms tick the first time the robot
turns past 180° — QACC explodes, MuJoCo auto-resets the whole of `mjData`, and the
"measured" pose silently teleports to the origin. `turn 180` and `scan_room` with
the default `steps=8` both cross; a 90° turn never does, which is why this
survived so long. Wrapping happens only where a heading is *reported*
(`Pose.yaw_wrapped`, `measured_pose()`, and therefore `/loco/odom` and
`rt/odommodestate`) — which is also what a real G1 does, its rpy coming out of a
quaternion. Budget: ±100 rad ≈ ±15 revolutions of accumulated turning per session.

If MuJoCo does reset anyway, `sim_node` notices `data.time` going backwards, says
so loudly on stdout, drops the active loco command (an absolute expiry stamp on a
clock that restarted at 0 would otherwise re-arm every command for its full
duration — a 6 s command once produced 13 s of motion, a longer one never
stopped), adopts the post-reset pose, and re-bases the real-time pacing so the
loop does not free-run.

`--scene` accepts any scene; fixed-base ones (e.g. `g1_dex3_pickplace_scene.xml`)
load fine and simply ignore locomotion — the node says so on startup.

## Setup gotchas (macOS)

Run `./setup.sh` to build a working venv, or do it by hand knowing these four:

1. **No CycloneDDS wheels for macOS.** Build the C library from source
   (`releases/0.10.x`, cmake + ninja via pip), then `export CYCLONEDDS_HOME=<prefix>`
   before installing the Python binding.
2. **Python 3.13 does not work.** The `cyclonedds` Python binding 0.10.2 that
   `unitree_sdk2py` pins fails to compile against 3.13 (`_Py_IsFinalizing` was
   removed). Use a **3.12** venv.
3. **`mjpython` on a uv-managed Python** fails with
   `Library not loaded: @rpath/libpython3.12.dylib`. Symlink
   `<uv-python>/lib/libpython3.12.dylib` into
   `<venv>/lib/python3.12/site-packages/mujoco/MuJoCo_(mjpython).app/Contents/lib/`.
4. **Always pin the network interface to `lo0` for local sim.** This one costs
   hours if you hit it blind. `unitree_sdk2py` passes CycloneDDS *its own*
   config (`core/channel_config.py`) with `NetworkInterface autodetermine="true"`,
   which **overrides `CYCLONEDDS_URI`** — so tuning Cyclone through the
   environment does nothing. On a Mac with ~20 UP interfaces (most without an
   address, plus VPN `utun*` tunnels) autodetermine can pick one that cannot
   carry discovery, and two local processes never find each other. It fails
   **silently**: `Write()` still returns `True`, because it only queues locally.
   The symptom is "everything looks healthy, zero messages received", and
   same-process pub/sub still works, which makes it easy to misdiagnose.
   `sim_node.py` therefore defaults `--iface` to `lo0`; pass the same to your
   client (`ChannelFactoryInitialize(domain, "lo0")`). For a real robot on a LAN,
   override it with the real NIC.
   Tip: with an explicit interface the SDK writes a config trace to `/tmp/cdds.LOG`.

## Verifying

```bash
python -m pytest test_loco_state.py -q          # state machine

# integration — start BOTH in one shell, they must share a network namespace
pkill -f sim_node.py                            # see the warning below
python sim_node.py --domain 1 --http-port 8777 --quiet &
python e2e_loco_check.py 1 lo0                  # add --frames <dir> to keep the images
python e2e_loco_check.py 5 lo0 --port 8779      # a node on another domain/port
python e2e_loco_check.py 1 lo0 --idle-s 0       # skip the slow (60 s) sag check
```

The harness is re-runnable against a long-lived node: it starts by teleporting
the robot to a known pose via `/sim/reset-pose` (a sim-only affordance), and
every translation assertion is projected into the body frame at the pose where
the command was issued (`body_frame_delta`), so nothing depends on the robot
facing +x or standing at the origin. Check 12 reads `MUJOCO_LOG.TXT` from the
*current directory*, so run the checker where the node runs.

⚠️ **Never leave two sim nodes on the same DDS domain.** A second node registers a
second `sport` service and a second set of publishers, so RPC calls are answered by
whichever one wins the race while `/loco/odom` reads the other one's pose — the
symptom is "the RPC succeeds but the robot never moves". Check with
`ps aux | grep sim_node` before blaming the code, and note that a `pkill` pattern
containing the directory (`sim_g1_dds/sim_node.py`) will NOT match a node started
from inside that directory.

`e2e_loco_check.py` asserts the things that actually matter: the RPC round trip
returns the FSM id, the robot starts in the stand pose, a 2.5 s forward command
at 0.4 m/s travels ~1 m without sideways drift, a commanded 90° turn lands within
±15°, a body-frame left strafe moves left *after* that turn, the head camera
returns a different frame once the robot has moved, `WaveHand` raises the arm and
returns it home, `Damp()` refuses to translate, and `rt/odommodestate` agrees with
the HTTP pose.

Three of the checks exist because of specific bugs and are worth their runtime:

| # | Check | Guards |
|---|---|---|
| 2, 11 | stand pose at start, and again after `--idle-s` (60 s default) of standing still | feet-in-the-floor and the unlatched hold pose — the two ways the robot silently stops standing |
| 10 | a 250° spin: the reported heading must wrap exactly once and never step more than the commanded rate allows | the wrapped-setpoint crash on the first turn past 180° |
| 12 | `MUJOCO_LOG.TXT` must not grow during the run | any solver blow-up at all, including ones the other checks would paper over |
