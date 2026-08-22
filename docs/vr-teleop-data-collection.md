# VR Teleoperation Data Collection (Unitree G1 EDU + Dex3-1)

> **Placeholders used here:** `GPU_BOX` = the lab's GPU workstation · `$UNITREE_ROOT` = root of the Unitree checkouts and spike data · `$CONDA_ENVS` = the conda env directory · `$VLA_TESTS` = the VLA test checkouts. Real host names, users and absolute paths are deliberately kept out of this repo. Inside PowerShell blocks they are written `$env:UNITREE_ROOT` etc. — set them as environment variables before copy-pasting.

How to collect manipulation datasets for the G1 EDU via VR teleoperation
(Meta Quest 3 hand-tracking → `xr_teleoperate`), convert them to LeRobot, and
import them into NeoDEM — plus how to test the entire path **without a headset
or robot**. Verified end-to-end (headset-free) on the lab box `GPU_BOX` on
2026-07-12; synthetic proof dataset: "VR Teleop Pipeline Test (synthetic)".

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
   ▼  convert_v3_to_v2.py                    (v2.1 — REQUIRED for local serving)
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
   robot and use **"Simulate VR input (no headset)"** in the session detail
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

## D) Convert v3.0 → v2.1 and import into NeoDEM

NeoDEM's **local-directory** dataset serving
(`server/src/routes/datasets.routes.ts`) reads the LeRobot **v2.1** layout
(`meta/episodes.jsonl`, `data/chunk-000/episode_XXXXXX.parquet`,
`videos/chunk-000/<cam>/episode_XXXXXX.mp4`). The Unitree converter emits
v3.0-chunked, so the v3→v2.1 step is mandatory for local import (v3.0 is fine
for the RustFS upload flow).

```powershell
conda activate unitree_lerobot
$env:PATH = "$env:UNITREE_ROOT/_data/vr_teleop_pipeline_test/bin;$env:PATH"   # ffmpeg
python $env:UNITREE_ROOT/Isaac-GR00T/scripts/lerobot_conversion/convert_v3_to_v2.py --repo-id local/<name>
Copy-Item -Recurse $HOME\.cache\huggingface\lerobot\local\<name> $env:UNITREE_ROOT/_data/<target>
```

Registration: `POST /api/datasets` does not accept a `storagePath`, so local
directories are registered by script — follow the pattern of
`server/src/scripts/seed-synthetic-demo.ts` (a ready adaptation,
`register_dataset.ts`, sits in `$UNITREE_ROOT/_data/vr_teleop_pipeline_test/`).
Run it from `server/` with an **absolute** database URL
(`DATABASE_URL=file:$UNITREE_ROOT/robot-management-system/server/prisma/dev.db` —
a relative `file:./dev.db` resolves against the generated client and opens the
wrong SQLite file, surfacing as Prisma `P2021`).

Verify: `GET /api/datasets/<id>/episodes`, `.../episodes/0/frames`,
`.../episodes/0/video/<camera>` — all should return data / `video/mp4`.

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
