# VR Teleoperation Data Collection (Unitree G1 EDU + Dex3-1)

> **Placeholders used here:** `GPU_BOX` = the lab's GPU workstation · `$UNITREE_ROOT` = root of the Unitree checkouts and spike data · `$CONDA_ENVS` = the conda env directory · `$VLA_TESTS` = the VLA test checkouts. Real host names, users and absolute paths are deliberately kept out of this repo. Inside PowerShell blocks they are written `$env:UNITREE_ROOT` etc. — set them as environment variables before copy-pasting.

How to collect manipulation datasets for the G1 EDU via VR teleoperation
(Meta Quest 3 hand-tracking → `xr_teleoperate`), convert them to LeRobot, and
import them into NeoDEM — plus how to test the entire path **without a headset
or robot**. Verified end-to-end (headset-free) on the lab box `GPU_BOX` on
2026-07-12; synthetic proof dataset: "VR Teleop Pipeline Test (synthetic)".

**Recording on the real robot through NeoDEM** (Quest browser → app → server →
robot-agent → `g1_sidecar.py`) has its own runbook below:
[Quest 3 on the real G1 via NeoDEM](#quest-3-on-the-real-g1-via-neodem-task-393).

Related: [`docs/architecture.md`](architecture.md) · in-app sim recording for
VR sessions lives in the datacollection feature (Teleoperation Sessions) ·
robot-day sequencing: `.mc` TASK-169 "Robot-day checklist", item 4.

## The pipeline

```
Quest 3 (WebXR, hand tracking)
   │ wss://<PC>:8012            (adb reverse or portproxy + firewall)
   ▼
xr_teleoperate teleop_hand_and_arm.py   --arm G1_29 --ee dex3 --input-mode hand
   │ arm IK (pinocchio) + Dex3 retarget → DDS LowCmd
   ├─ --sim  → unitree_sim_isaaclab (Isaac Sim, DDS domain 1)
   └─ (real) → G1 EDU, PC2 192.168.123.164 (DDS domain 0 ⚠)
   │ --record  (keys: r = start following, s = record toggle, q = safe exit)
   ▼
raw episodes  <task>/episode_XXXX/{data.json, colors/, depths/, audios/}
   ▼  sort_and_rename_folders.py + convert_unitree_json_to_lerobot.py
       --robot-type Unitree_G1_Dex3          (LeRobot v3.0, 28-dim, 4 cams)
   ▼  (no conversion step — NeoDEM reads v3.0 since TASK-217)
   ▼  register in NeoDEM (script) → Datasets page / episode viewer / curation
```

**DDS domains: 0 = real robot, 1 = simulation. Never mix.**

## Environment (GPU_BOX — native Windows, no WSL)

> ⚠ Older Unitree-bundle docs describe a WSL2 runtime (`$UNITREE_ROOT`, env
> `unitree_sim_env`, `bash run/*.sh`). **WSL is gone from GPU_BOX** (verified
> 2026-07-12). Use the native conda envs below; the bash run scripts in
> `quest-sim-teleop/run/` do not apply — start components natively.

| Conda env | Purpose | Notes |
|---|---|---|
| `tv` | xr_teleoperate teleop + IK | pinocchio + casadi (conda-forge), mujoco, televuer `-e`; pin **`params-proto==2.12.1`** (3.3.0 breaks vuer 0.0.60) |
| `unitree_lerobot` | JSON → LeRobot conversion | lerobot 0.4.1 `-e` (submodule) + unitree_lerobot 0.3.0 `-e` |
| `env_isaaclab_51_unitree` | Isaac Sim 5.1 + unitree_sim_isaaclab | sim side, DDS domain 1 |

Pinned checkouts: `xr_teleoperate@7dc9aa1`, `unitree_lerobot@41c2805`,
`unitree_sim_isaaclab@e30c25b` (all under `$UNITREE_ROOT/`). adb:
`$UNITREE_ROOT/tools/platform-tools/adb.exe`. ffmpeg (needed by the v3→v2
converter): `$UNITREE_ROOT/_data/vr_teleop_pipeline_test/bin/ffmpeg.exe` → PATH.

## Testing without headset or robot (proven 2026-07-12)

1. **In NeoDEM:** create a Teleoperation Session of a VR type on a simulated
   robot and use the **Simulate VR input** switch in the session detail
   page — synthetic joint targets stream through the same WebSocket path the
   real WebXR rig uses; frames are recorded server-side and exported to a
   LeRobot dataset when the session ends.
2. **Unitree stack, MuJoCo dry-run:** env `tv`, cwd `$UNITREE_ROOT/xr_teleoperate/teleop`,
   run the patched `teleop_mujoco_win.py --no-quest --render-port 8090`
   (from `$UNITREE_ROOT/_data/vr_teleop_pipeline_test/`) — loads the G1+Dex3 MJCF,
   builds the real `G1_29_ArmIK`, serves an MJPEG viewer on :8090.
3. **Data path:** generate synthetic raw episodes
   (`gen_synthetic_episode.py`, same dir) and run stages C+D below. This is the
   exact conversion/import route robot-day recordings will take.

## A) Record — Quest + Isaac sim (no robot, domain 1)

```powershell
# Terminal 1 — simulation
conda activate env_isaaclab_51_unitree
cd $env:UNITREE_ROOT/unitree_sim_isaaclab
python sim_main.py --device cpu --enable_cameras --task Isaac-PickPlace-Cylinder-G129-Dex3-Joint `
    --enable_dex3_dds --robot_type g129

# Terminal 2 — teleop + recorder (after the sim viewport is up)
conda activate tv
cd $env:UNITREE_ROOT/xr_teleoperate/teleop
python teleop_hand_and_arm.py --sim --arm=G1_29 --ee=dex3 --input-mode=hand `
    --img-server-ip=127.0.0.1 --record --task-name "pick cylinder" --task-goal "Pick up the cylinder."
```

Quest connection: `adb reverse tcp:8012 tcp:8012` (USB;
`quest-sim-teleop/windows/usb_tunnel.cmd`) or Wi-Fi via
`run/windows_portproxy.ps1` + `windows/firewall_8012.ps1`. In the Quest
browser: `https://<PC>:8012/?ws=wss://<PC>:8012`, accept the cert, Enter VR.

Keys in the teleop terminal: **`r`** start following · **`s`** record
start/stop (one episode per toggle) · **`q`** safe exit. Episodes land in
`xr_teleoperate\teleop\utils\data\<task-name>\episode_XXXX\`.

## B) Record — Quest + real G1 EDU (domain 0 ⚠ moves the robot)

Same as A, but: no sim; robot in debug mode (L2+R2); Ethernet
`192.168.123.x`; `teleimager-server` running on PC2; drop `--sim` and use
`--img-server-ip=192.168.123.164`. E-stop verified and in reach (TASK-169
Stage-1 gate) **before** pressing `r`; `q` returns the arms home.

## Quest 3 on the real G1 via NeoDEM (TASK-393)

Sections A and B drive the robot with Unitree's `xr_teleoperate`, outside
NeoDEM: nothing is recorded, no control lease, no NeoDEM E-stop. This is the
path that goes **through** NeoDEM and records a LeRobot v3.0 dataset as it goes:

```
Quest 3 browser  http://localhost:1420   (adb reverse — the ONLY forwarded port)
   │ page, /api, /api/a2a/ws, /api/robots/<id>/teleop/ws   (Vite dev proxy)
   ▼
server :3001  ── teleop proxy (token in Sec-WebSocket-Protocol) ──►  robot-agent /ws/keyboard-teleop
                                                                       │ lease + heartbeat → POST /arm
                                                                       │ /action ≥ 20 Hz (arms + present hands only)
                                                                       ▼
                                          g1_sidecar.py  G1_WRITE_MODE=arm_sdk  →  rt/arm_sdk + rt/dex3/*/cmd
                                          (legs and waist stay under Unitree's balance controller)
```

### Before you start

- **The sidecar's arm-only write mode (TASK-391) is required.** A sidecar in the
  default read-only mode streams telemetry and the head camera but refuses every
  command; the VR panel then says *"The robot will not move"* and the recorder
  refuses to start. The old `rt/lowcmd` write path is gone — it bypassed the
  balance controller, so a standing robot fell.
- Robot on the gantry, in **normal** mode (not debug mode — `xr_teleoperate`
  leaves it in debug mode; use the remote or reboot). E-stop in reach.
- Head camera: PC2's `g1-head-cam` service on `192.168.123.164:5600`
  (`G1_CAMERA_SOURCE=pc2cam` on the sidecar).

### Bring-up (the computer wired to the robot)

```bash
# 1. sidecar — arm-only writes, PC2 head camera. Full procedure and env:
#    docs/g1-edu-lab-bringup.md, "Arm teleop through arm_sdk" (TASK-391).
#    arm_sdk REFUSES to start without an explicit G1_DDS_DOMAIN (0 = the robot)
#    and with G1_READ_ONLY=1; it listens on 127.0.0.1 only.
G1_WRITE_MODE=arm_sdk G1_DDS_DOMAIN=0 G1_CAMERA_SOURCE=pc2cam G1_NET_INTERFACE=<robot LAN iface> \
  python robot-agent/hardware/g1_sidecar.py          # :8767

# 2. robot agent, server, app
cd robot-agent && npm run dev:g1-edu                  # .env.g1-edu: HARDWARE_SIDECAR_URL=http://localhost:8767
cd server && npm run dev                              # :3001
cd app && npm run dev                                 # :1420

# 3. the headset (USB-C into THIS computer, Developer Mode on)
./scripts/quest-connect.sh --open
```

`quest-connect.sh` finds adb (PATH, `~/.local/opt/platform-tools`, the Android
SDK, Homebrew), stops with the fix when the headset has not accepted *Allow USB
debugging* yet (exit 4 — the step a bare `adb reverse` fails silently on),
reverses **only** port 1420, checks the dev server answers and prints the URL.
`--wireless` switches to Wi-Fi adb afterwards (the reverse rule rides the adb
transport, not the cable); `--remove` undoes it. No SSH tunnel and no second
`adb reverse` for :3001 or the agent: the app reaches the API, the event socket
and the robot's teleop socket through its own origin. The robot page's VR card
has the same steps under **Connect Meta Quest**.

**Headset plugged into another computer** (e.g. a laptop, with the stack on the
robot computer): run `quest-connect.sh` on the laptop, and forward that one port
to the robot computer — `ssh -N -L 1420:localhost:1420 <user>@<robot computer>`.
Still one port: the API and both sockets ride the page's origin.

### Driving and recording

1. Data collection → new VR session for the G1 EDU → **Launch VR**.
2. **Take control** (the control lease). The agent now answers `bound` whether or
   not `CONTROL_LEASE_REQUIRED` is set — before TASK-393 it ignored `{bind}` and
   "Take control" timed out.
3. In the headset: **Enter VR**. The rig sends a heartbeat at 10 Hz from its
   render loop, and every beat carries the grips (`{hb, clutch:{left,right}}`,
   sent at once on a change). Grip a controller: the first joint frame from a
   console that holds the lease, is heartbeating *and* has made a **clutch
   rising edge** — grip seen released, then squeezed — arms the sidecar; weight
   ramps 0→1 over ~1.5 s from the **measured** arm pose. The wrist HUD's MODE
   line reads `ARMING 40%`, then `ARMED`; the desktop shows *Arming …* /
   *Arms armed*. A grip already held when the console connects does not count:
   let go once, then squeeze.
4. Record from the headset (TASK-413): the session board left of the robot
   has Start/Stop, Next and a 1 s hold-to-discard; L-stick click starts and
   stops a take, R-stick click goes to the next, R-stick held 1.5 s discards
   the last take. `action` is what the sidecar
   **accepted**, not what the operator wanted — frames before the arms are armed
   are dropped and counted ("no command reached the robot").

### What hands the arms back (disarm, weight 1→0 over ~1 s)

| Event | Who | Latency |
|-------|-----|---------|
| Exit VR, headset off (session hidden), **Release** | app releases the lease → agent fences the socket | immediate |
| B / Y / pinch-stop, desktop **Emergency stop** | agent: disarm, then latch (sidecar `/estop` latches too) | immediate |
| Render loop stalls (tab hidden, browser hung, Wi-Fi gone) | agent heartbeat dead-man | 1.0 s |
| Agent stops sending `/action` | sidecar dead-man: hold at 0.5 s, disarm at 1.0 s | 1.0 s |
| Teleop socket closes (last engaged console) | agent | immediate |
| Lease expires / taken over by someone else | agent lease fence | immediate |

Letting go of the grip is **not** a disarm: the arms hold their last pose under
the agent until one of the events above.

**Re-arming needs a fresh squeeze.** After every disarm the operator did not
cause by ending the session — an E-stop and its reset, a heartbeat that stalled
and came back, a lease taken over, the sidecar's own dead-man or a 409, a refused
`/arm` — the agent latches *re-engage required* and will not call the sidecar's
`/arm` until it has seen this console's grip **released and then squeezed again**,
both while nothing blocks arming (an edge made during the E-stop latch does not
count). The HUD's MODE line reads *Release grip to re-arm* while the grip is still
held; the desktop tag says the same. This is enforced in the agent
(`robot-agent/src/teleop/reengage.ts`), so a stale or hostile client cannot skip
it, and a client that reports no clutch at all cannot arm the real arms. The latch is per
console: another console's fresh squeeze that arms the sidecar does not hand the
arms back to a console whose grip never let go — a fresh `/arm` drops every claim
left from the arm that was lost (`robot-agent/src/teleop/arm-registry.ts`). Before
TASK-393's review the arms re-armed on the very next streamed frame, within 0.5 s
of a reset, and a held grip slewed them straight to the controller's pose.

**Hand tracking does not drive the real robot.** A tracked hand has no grip, so
it never reports a clutch: the agent drives no side whose grip is open on an
`arm_sdk` sidecar (`arm_side_unclutched`), and the HUD reads *Use controllers to
drive the real robot*. Hand tracking still drives the sim as before.

After an E-stop, **Reset E-stop** clears the agent's latch and the sidecar's.
A protective stop that clears on its own (server connection restored) now clears
the sidecar's latch too; if the sidecar is still latched for any other reason
(e.g. from before an agent restart) the VR panel says *"The robot's sidecar is
still E-stopped"* with its own reset button.

### The robot panel inside the headset (TASK-407)

A panel hangs about 0.9 m out and 40° to the right of the robot's forward
(30° until TASK-418, when its corner covered the camera screen's grippers),
beside the head-camera screen, and turns with it on a recenter. It reads MODE,
ARMS (with the sidecar's dead-man), GRIP per hand and any `HELD` refusal, HANDS,
LEASE and LINK, and one bold line saying **why the arms are not following**
(E-stop, no link, no control, mode not Balance, the agent refused the arm,
dead-man, controller not tracked, no grip squeezed — first match wins). A
blocking reason also takes line 1 of the wrist HUD.

- **Pressing a button:** with the grip **free**, point the controller at the
  panel — a thin ray and a dot appear on a button — and pull the trigger. With
  the grip held the trigger is the grasp, there is no ray and nothing can be
  pressed, so a click can never close the robot's hand.
- **Buttons:** Recenter (same as A/X); **Hold 1 s to reset**, shown only while
  the E-stop is latched: hold the trigger for one second (the bar fills). While
  latched it is the only live button. **Hold to allow Stand up / Balance**
  appears when the desktop asks for a mode (TASK-417, see
  [After an E-stop](data-collection-two-person.md#after-an-e-stop)). Next take
  moved to the session board left of the robot (TASK-413).
- **B/Y and the pinch stop no longer end the XR session.** They latch, disarm and
  damp exactly as before and the stream stops at once; the panel turns red and
  the wearer can read why and reset from inside the headset.
- **LINK is transport only.** The agent now answers every pose frame — with
  `{type:'state'}` when an arm moved, or `{type:'state', held:true, side, reason}`
  when it refused (≤ 20 Hz) — so a refused arm shows as `HELD R: arm_gate` and a
  why line, never as *Link lost*.

### The wrist views below the head screen (TASK-443)

A session that records wrist cameras (*Head + wrists* on New session) shows two
small screens directly below the head-camera screen: the left wrist on the left,
the right wrist on the right, each 0.36 m wide (4:3), at the head screen's
distance, tilted up toward the eyes and marked **L** / **R**. They turn with the
robot on a recenter like the other panels and stay within 20° of straight ahead,
so a glance down shows the fingers up close without turning the head.

They are quieter than the head screen on purpose. A wrist has no take strip and
no red E-stop frame, uploads at most 10 frames a second (the head: 20), and a
frozen wrist shows its own STALE badge and red surround **without** a haptic
pulse — the controllers buzz only for the head camera, the picture the operator
steers by. A wrist that is not served shows the CAMERA OFFLINE plate in its own
screen and keeps retrying; the head screen is untouched. While a wrist is not
live the robot panel adds one line, e.g. `WRISTS L live · R offline`.

A head-only session, and the VR tab on the robot's own page, show exactly the
scene they did before: no wrist screens, no wrist ticket, no wrist stream.

### A Dex3 hand that sends nothing

On 2026-10-16 the right hand published no state and `xr_teleoperate` hung until
it was switched to arms-only. NeoDEM goes on: the sidecar reports
`teleop_mode` (`arms+hands` | `arms+left_hand` | `arms+right_hand` |
`arms_only`), the VR panel and the HUD warn (*NO RIGHT HAND — arms + left*), the
forwarder never commands the missing hand, and the recorder leaves it out of the
dataset rather than storing zeros: `robot_type` becomes
`Unitree_G1_Dex3_LeftHand` / `_RightHand` / `_ArmsOnly` (21 / 21 / 14 dims) and
`meta/info.json` → `_neodem.recordingMode` / `omittedJoints` say what is missing.
A missing **arm** joint, or a hand with only some joints, still refuses.

### Troubleshooting

| Symptom | Cause / fix |
|---------|-------------|
| `arm_requires_lease` | this console does not hold the lease — **Take control** |
| `arm_requires_heartbeat` | a console that sends no heartbeat (an old cached app: reload) — keyboard and VR send one; *Simulate VR input* deliberately does not, so it can never drive real arms |
| `heartbeat_lost` | the render loop stalled for 1 s; once the link is back, release the grip and squeeze again |
| `arm_reengage_required` / *Release grip to re-arm* | the arms were handed back without the grip being let go (E-stop, link loss, lease change, sidecar dead-man); release, then squeeze |
| `arm_requires_clutch` | the console reports no grip clutch (an old cached app: reload) |
| `arm_side_unclutched` / *Use controllers to drive the real robot* | a tracked hand (no grip) tried to drive the real arms; use the controllers |
| `home_unavailable` | **Home** is refused on the real arms (all-zeros swings them forward); end teleop to hand the arms back to the robot's controller |
| `arm_failed` / `arm_estop_latched` | the sidecar refused `/arm`; the message is its own words |
| *The robot will not move* | sidecar is read-only — restart it with `G1_WRITE_MODE=arm_sdk` |
| `adb` lists the Quest as `unauthorized` | accept *Allow USB debugging* inside the headset (`quest-connect.sh` exits 4) |
| teleop socket 401 | token expired with auth on — the link refreshes and retries on its own |

The teleop socket goes through the server by default. `VITE_TELEOP_DIRECT=true`
connects the browser to the agent directly (the pre-TASK-393 behaviour; breaks
over `adb reverse`, Tailscale and https). `VITE_PROXY_TARGET` points the Vite dev
proxy at another API server.

Measured on loopback (2026-10-17, `{positions}` → `{type:'state'}` round trip,
n = 103): direct to the agent p50 0.31 ms / p95 0.50 ms; through the server
proxy 0.56 / 0.97 ms; through Vite + server proxy (the Quest path) 0.92 / 1.52 ms.
The stream runs at 20 Hz, so the extra hop is well under 1 % of the frame budget.

## C) Convert raw JSON → LeRobot v3.0

```powershell
conda activate unitree_lerobot
$env:PYTHONUTF8='1'
python $env:UNITREE_ROOT/unitree_lerobot/unitree_lerobot/utils/sort_and_rename_folders.py --data_dir <raw>\<task_name>
python $env:UNITREE_ROOT/unitree_lerobot/unitree_lerobot/utils/convert_unitree_json_to_lerobot.py `
    --raw-dir <raw> --repo-id local/<name> --robot-type Unitree_G1_Dex3 --no-push-to-hub
```

`<raw>` is the parent directory containing `<task_name>/episode_XXXX`. Output:
`~\.cache\huggingface\lerobot\local\<name>` — v3.0, 28-dim state/action
(2×7 arm + 2×7 Dex3), 4 cameras (head L/R eye + both wrists), AV1 mp4s.

## D) Import into NeoDEM — no conversion step

**This used to require an external script and does not any more (TASK-217).**
The instruction here was to run `convert_v3_to_v2.py` out of an
`Isaac-GR00T` checkout, in PowerShell, with `ffmpeg` manually put on PATH, and
it was called mandatory. A mandatory pipeline step that lives on one person's
disk is not a pipeline.

NeoDEM now reads v3.0 directly. The local-directory readers are still v2.1 —
they are the paths that work and are tested — so a v3.0 dataset is served
through a v2.1 **view** that `server/curation/lerobot_v3_to_v2.py` builds on
first read and caches. Nothing to run by hand, and the original v3.0 tree is
what the `Dataset` row points at.

If you want the conversion as a file, it is the same script:

```bash
python server/curation/lerobot_v3_to_v2.py <v3-dir> <out-dir>
```

It needs `pyarrow` and, for the videos, `ffmpeg` (`CURATION_FFMPEG` or on
PATH). `server/curation/.venv` is found automatically by both the server and
`scripts/test-all.sh`; `CURATION_PYTHON` overrides it.

Registration: `POST /api/datasets` does not accept a `storagePath`, so local
directories are registered by script:

```bash
cd server
npx tsx src/scripts/register-local-dataset.ts \
  --dir /abs/path/to/dataset --name "Robot day teleop" \
  --robot-type-id <id> --validate
```

`--validate` opens every file `info.json` names before the row is written, and
marks the dataset `failed` with the reasons rather than `ready` unchecked.
`GET /api/datasets/robot-types` lists the ids. Run it with an **absolute**
database URL (`DATABASE_URL=file:$UNITREE_ROOT/robot-management-system/server/prisma/dev.db`
— a relative `file:./dev.db` resolves against the generated client and opens the
wrong SQLite file, surfacing as Prisma `P2021`).

Verify: `GET /api/datasets/<id>/episodes`, `.../episodes/0/frames`,
`.../episodes/0/video/<camera>` — all should return data / `video/mp4`. A
dataset that has already been registered can be re-checked at any time with
`POST /api/datasets/<id>/validate` — which answers `202` and runs the check off
the request (queued to NATS, or detached in the server process when there is no
NATS). Poll `GET /api/datasets/<id>/progress`, or re-read the row, for the
verdict; a second POST while one is still running answers `409`.

## Open gaps before a real Quest session

- **WebXR TLS certs do not exist yet** — generate `cert.pem`/`key.pem`
  (`quest-sim-teleop/setup/make_certs.sh` equivalent) into
  `%USERPROFILE%\.config\xr_teleoperate\` or the televuer directory; the Quest
  refuses plain-HTTP WebXR.
- **DDS from the teleop env is untested** — `teleop_hand_and_arm.py` needs
  cyclonedds + `unitree_sdk2py` (+ teleimager client) in `tv`; the headset-free
  MuJoCo path never touches DDS, so this remains unproven until sim/robot day.
- Full evidence + runbook of the 2026-07-12 dry-run:
  `$UNITREE_ROOT/_data/vr_teleop_pipeline_test/ROBOT_DAY_RUNBOOK.md`.
