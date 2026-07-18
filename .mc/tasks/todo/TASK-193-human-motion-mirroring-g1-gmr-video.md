---
id: TASK-193
aliases:
- TASK-193
title: "\"Person moves, G1 mirrors them\" — video → GMR retargeting → G1 playback demo"
slug: human-motion-mirroring-g1-gmr-video
status: review
priority: 3
owner: ''
projects: []
customers: []
tags:
- extended
- simulation
- g1
- demo
sprint: ''
depends_on: []
due_date: ''
created: 2026-07-18
updated: 2026-07-18
status_note: 'PHASE 1 + PHASE 2 DONE 2026-07-18. The SMPL-X gate is cleared (model registered
  and installed) and the whole video→G1 pipeline ran end-to-end on this box. Deliverable:
  _data\presentation\05_motion_mirroring\demo_moonwalk_g1.mp4 — 7.4 s, 221 frames, source dancer
  beside the retargeted G1, pose-for-pose. Reproduction recipe and every verified defect are in
  _data\mirror_spike\pipeline\RUNBOOK.md; run.py --modes settles the postproc question by
  measurement (see S1 below — the intuitive suspect was the wrong one). Phase 2 shipped the
  NeoDEM side: a Motion tab on the robot detail page (G1-gated) with a clip library, JSON import,
  and transport-driven playback into the TASK-191 3D viewer. Verified in a real browser: import,
  playback at true real time, scrub, frame-step, delete, root-follow, 375px mobile, zero console
  errors; 1006/1006 unit tests and both typechecks green. PHASE 3 (real hardware) IS EXPLICITLY
  OUT OF SCOPE — simulation only, by decision, and it stays fall-risk/safety-gated regardless;
  kinematic retargeting is not balance-feasible and needs an RL tracking controller (TWIST).
  Still true: this does NOT supply VLA training data for TASK-188 — GMR emits joint trajectories
  only, no vision, no objects, no reward. LICENCE: the demo clip is not cleared for external use
  (copyrighted source footage; GVHMR + SMPL-X are non-commercial). Both are properties of THIS
  CLIP, not the pipeline — re-run on owned footage to clear it. LAFAN1 is CC BY-NC-ND
  (NoDerivatives), so retargeting it is derivative-work creation and it is not a safe source
  either.'
---

# "Person moves, G1 mirrors them" — video → GMR retargeting → G1 playback demo

## Description

Record a person on an ordinary camera, recover their motion, retarget it onto the Unitree G1
(29 DoF, optionally +Dex3), and play it back — first in MuJoCo, later on the real robot. The
deliverable is a presentation-grade demo showing a human moving and the G1 mirroring them.

Uses [GMR (General Motion Retargeting)](https://github.com/YanjieZe/GMR) — ICRA 2026, MIT
license, CPU real-time, and it already ships a `unitree_g1` and a `unitree_g1_with_hands`
(43 DOF) robot config.

**What this task is NOT:** a data source for [[TASK-188]] or any VLA training. GMR emits
`(base_translation, base_rotation, joint_positions)` per frame — no camera observations, no
object interaction, no task-success signal. Do not scope VLA training into this task.

## Details

### Current state (as originally written — superseded by the Spike findings below)

- **Nothing GMR-related is installed on this box yet.** GMR is not cloned; there is no `gmr` conda env.
- **The playback renderer already exists.** `C:\Unitree\tools\g1_mujoco_webview.py` loads
  `g1_body29_hand14.xml` (G1 29-body + 14 hand DOF = the 43-DOF model), and if the env var
  `G1_TRAJ` points at an `(N, nq)` `.npy` it replays that trajectory at `G1_TRAJ_FPS` (default 30)
  and serves rendered frames over HTTP on port 8088. `C:\Unitree\tools\g1_traj.npy` is an existing
  sample trajectory.
  ⚠ **Known bug for this box:** `XML` on line 9 is hardcoded to a pz-264 Linux path
  (`/home/humanoid/Dokumente/unitree/xr_teleoperate/assets/g1/g1_body29_hand14.xml`). The local
  model is at `C:\Unitree\xr_teleoperate\assets\g1\g1_body29_hand14.xml`. Make the path an env
  var / arg rather than swapping one hardcoded path for another.
- MuJoCo is available in the `neodem-svc` env (see the presentation-pack notes); `mujoco` is also
  used by `quest-mujoco-teleop`.

### Phase 1 — Sim playback from a recorded video (desk-only, no hardware)

The video path is **offline and two-stage**. GMR's real-time (60–70 FPS CPU) claim applies to the
retargeting stage fed by a live mocap stream; monocular video adds an offline pose-recovery pass
in front of it.

```
video.mp4
  → GVHMR (offline, GPU)            → hmr4d_results.pt
  → python scripts/gvhmr_to_robot.py --gvhmr_pred_file <pt> --robot unitree_g1 --record_video
  → (N, nq) trajectory .npy
  → g1_mujoco_webview.py with G1_TRAJ=<npy>
```

Steps:
1. Clone GMR to `C:\Unitree\gmr\` (not under `nvidia/` — it is not an NVIDIA project) and add it
   to `.gitignore` alongside the other upstream repos.
   Install per its README: `conda create -n gmr python=3.10 -y && conda activate gmr && pip install -e .`
   Deps are mink (IK) + MuJoCo + poselib — all CPU, no Blackwell/CUDA pin risk.
2. Download the SMPL-X body models into `assets/body_models/` (**registration + licence acceptance
   required**, see Risks below).
3. Install GVHMR separately per its own instructions ([project page](https://zju3dv.github.io/gvhmr/),
   ZJU3DV, SIGGRAPH Asia 2024) and run its demo on a test video to produce `hmr4d_results.pt`.
   GVHMR is world-grounded and gravity-aware, so trajectories should have little foot-sliding.
4. Sanity-check GMR standalone **first** on a known-good input (an AMASS/LAFAN1 clip) before
   introducing video, so a bad result can be attributed to one stage rather than two.
5. Convert GMR's output to the `(N, nq)` layout `g1_mujoco_webview.py` expects and replay.
   The joint ordering between GMR's `robot_joint_positions` and the MJCF's `nq` is **not assumed
   to match** — verify explicitly, this is the most likely source of a subtly-wrong demo.
6. Record the result as a demo clip into `C:\Unitree\_data\presentation\`.

### Phase 2 — Surface it in NeoDEM (DONE 2026-07-18)

Shipped in this task rather than split out: Phase 1 landed the same day, and the increment turned
out to be as small as predicted.

**Motion tab** on the robot detail page, gated to the G1 family the same way Perception and Voice
are (clips are retargeted onto a G1 skeleton — the tab is meaningless on an SO-101). Clip library,
JSON import, and transport-driven playback into the TASK-191 3D viewer.

- **Server** — `MotionClip` model, repository, service, `/api/motion-clips` (list/get/create/
  delete). `frames` is a JSON TEXT column, *not* the object-storage machinery `SensorScan` uses:
  a clip is ~66 KB where a point cloud is megabytes. The cost of that choice is that the column
  must never be selected by the list query, which a shared `SUMMARY_SELECT` constant enforces on
  both the list and create paths. `fps` is `Float`, not `Int` — the source is video and NTSC
  29.97 must survive; rounding it would drift a 20-minute clip by ~40 s.
- **Playback** — `motion/motionPlayback.ts`, a module-level clock deliberately outside React.
  Per-frame trajectory samples through React state is exactly what TASK-191 fixed; the frame loop
  reads a mutable module value and React only hears about play/pause/seek. The clock is
  wall-clock-based rather than accumulating `useFrame`'s delta, which is what makes two mounted
  viewers split one interval instead of each applying a full one (N× speed).
- **Viewer** — a third joint source in `RobotModel`'s `useFrame`, ahead of the fast channel, so a
  loaded clip outranks live telemetry rather than fighting it for the same joints. Playback
  applies targets **undamped**: `sampleClip` already interpolates between clip frames, so the
  damping that smooths 10 Hz telemetry would only lag and smear. Root pose is applied relative to
  frame 0 — absolute position is unusable because the clip origin is wherever GVHMR put the
  subject and drei's `<Center>` re-centres anyway.
- **Import** is client-side `file.text()` → JSON → POST. The server has no multipart parser
  anywhere, and adding one for a 66 KB file would have been the codebase's first such dependency.

`export_neodem.py` (in the pipeline dir) converts a GMR `.pkl` into the import format, carrying
`jointNames`, `rootRotOrder` and `upAxis` so the renderer converts knowingly rather than by
assumption. `sampleClip` is the single place those two fields are consumed — it normalises every
sample to xyzw/Z-up so no downstream site needs the clip to interpret a sample.

**Verified in a real browser** (Playwright, `g1-edu-4`): import of the real 221-frame clip;
playback at true real time (1.18 s of clip per 1.2 s wall); scrub, frame-step, speed, loop;
root-follow visibly displacing the body at the final frame vs parked at origin; delete with
confirm, server count agreeing; a wrong-body clip (43 DoF vs 29 names) rejected with the specific
message rather than "failed to import", with the library surviving the error; 375px mobile with
no horizontal overflow; zero console errors. Leaving the tab returns the viewer to live telemetry
at the origin rather than stranding it in the clip's last pose.

### Phase 3 — Real robot (OUT OF SCOPE for this task — simulation only, by decision 2026-07-18)

Not attempted and not part of this task's completion. The material below stands as the standing
warning for whoever picks it up later.

**Do not replay whole-body retargeted motion on a free-standing G1.** GMR produces motion that is
kinematically retargeted, *not* balance-feasible: it has no notion of the robot's contact state,
centre of mass, or actuator limits. This is precisely why TWIST pairs GMR with a *trained RL
tracking controller* instead of commanding joint targets directly. Direct playback on a standing
humanoid is a fall risk — to the robot and to anyone near it.

Acceptable first hardware step: **upper body only**, with the robot suspended on its gantry or
seated, legs excluded from the command set, conservative velocity/torque limits, and an operator
on the E-stop. Anything beyond that needs a tracking policy and belongs in a separate task
alongside the [[TASK-172]] sim-RL work.

### Key files

- `C:\Unitree\tools\g1_mujoco_webview.py` — playback renderer (fix the hardcoded `XML` path)
- `C:\Unitree\xr_teleoperate\assets\g1\g1_body29_hand14.xml` — G1 29-DoF + Dex3 MJCF
- `C:\Unitree\tools\g1_traj.npy` — existing `(N, nq)` sample, use to verify the replay path works
  *before* wiring GMR in
- `C:\Unitree\_data\presentation\` — where the demo artefacts belong
- `C:\Unitree\.gitignore` — add `gmr/` with the other upstream repos

## Spike findings (2026-07-18) — read before continuing

**Proven working on this box.** GMR retargets the bundled Xsens boxing BVH onto the G1 at
~107 it/s, output verified structurally *and* visually (a recognisable boxing stance: guard up,
jab extended, weight on the back foot). Artifacts in `C:\Unitree\_data\gmr_spike\`.

Install notes — the README's instructions do **not** work as-written on native Windows:

1. **Do not use conda.** `conda create` hits a `CondaToSNonInteractiveError` demanding acceptance
   of the Anaconda default-channel Terms of Service. That ToS has commercial-use implications and
   is a human decision, not an install step. Sidestepped with a uv venv at `C:\Unitree\gmr\.venv`
   built on the system `Python310`. The README's `conda install libstdcxx-ng` step is Linux-only
   and unnecessary here.
2. **`PYTHONUTF8=1` is required.** `setup.py` does `open("README.md").read()` with no encoding, so
   it dies with `UnicodeDecodeError: 'charmap' codec` under the cp1252 default.
3. **Drop the `proxqp` extra.** `setup.py` declares `qpsolvers[proxqp]`, which pulls `proxsuite`,
   which has no Windows wheel and fails its cmake build. It is not needed:
   `motion_retarget.py:18` hardcodes `solver="daqp"`. Install deps manually with `qpsolvers` +
   `daqp` instead, then `uv pip install -e . --no-deps`.
4. **Two undeclared deps:** `PyQt6` and `matplotlib`. The Xsens loader transitively imports a GUI
   curve-editor module at load time, so they are needed even for headless batch use.
5. Harmless noise: `xrobotoolkit_sdk not found` at import, and a `GLFWError: not initialized` at
   teardown. Neither affects output.

**Output format** — the `.pkl` is a dict: `fps`, `root_pos (N,3)`, `root_rot (N,4)`,
`dof_pos (N,29)`. Converting to the `(N, nq)` layout `g1_mujoco_webview.py` wants means composing
root + dof; note `unitree_g1` has `nq=36` (30 joints) and `unitree_g1_with_hands` has `nq=50`
(44 joints), so nq ≠ dof_pos width and the concatenation is not trivial. **However** GMR ships its
own viewer (`scripts/vis_robot_motion.py`, and `--record_video` on any retarget script) which
already produces demo-grade MP4s — so the `g1_mujoco_webview.py` route is now optional. Prefer
GMR's own viewer for the demo and skip the conversion entirely.

**Mocap lead-in gotcha:** the first ~3 s of the boxing capture is the actor standing still, and
retargeting it produces a near-static robot (joint ranges ~0.02 rad). That looks exactly like a
broken pipeline. Always sample from the middle of a capture when sanity-checking
(`--start 1800 --end 2160` gave 0.35–0.93 rad ranges). Do not conclude "retargeting is broken"
from the opening seconds.

**HANDS ARE CONFIRMED NOT RETARGETED.** `unitree_g1_with_hands` loads fine (nq=50, nu=43, with
real `*_hand_index_0_joint` etc. in the model), but `params.py` maps it to the **same**
`smplx_to_g1.json` IK config as the plain 29-DoF robot, and that config contains **zero** mentions
of hand/finger/thumb/index/middle. The Dex3 fingers are geometry that never moves. Anyone wanting
articulated fingers must author a new IK match table — that is a separate, non-trivial task, not
a flag. This settles the open question in Risks below: **plan the demo around body motion.**

**Blocker for the video path (needs a human):** `utils/smpl.py` calls
`smplx.create(smplx_body_model_path, ...)`, so both the SMPL-X *and* GVHMR routes require the
SMPL-X body models in `assets/body_models/smplx/`. Those are behind registration + licence
acceptance at smpl-x.is.tue.mpg.de. See the licensing risk below — this must be decided, not
worked around.

## GVHMR spike (2026-07-18) — Docker on Blackwell WORKS; one gate left

**Question asked:** GVHMR is Linux-only and pins `torch==2.3.0+cu121`. Does Docker solve it?
**Answer:** Docker solves the *Linux* problem; it does nothing for the *Blackwell* problem — a
container passes the GPU through as-is, and cu121's kernels stop at sm_90 while the RTX 5090 is
sm_120. The fix was breaking the pins, not changing OS. `C:\Unitree\gvhmr\Dockerfile.blackwell`
does both and is the durable artifact of this spike.

Verified inside the image: torch 2.11.0+cu128, arch list includes `sm_120`, GPU matmul executes,
pytorch3d 0.7.8 built from source with a working CUDA `knn`, `hmr4d` imports cleanly on torch 2.11
despite being written for 2.3.

Five fixes, all in the Dockerfile with rationale comments:

1. **torch 2.3+cu121 → 2.11+cu128**, pytorch3d from source (no cu128 wheel is published).
2. **`--no-build-isolation`** for pytorch3d — its `setup.py` imports torch to discover CUDA
   settings, and an isolated build env has none.
3. **`yacs` + `pycolmap`** — imported but never declared. Found in one pass with an AST walk
   (`gvhmr/find_missing_deps.py`) rather than one crash at a time. Deliberately skipped
   `mmcv`/`mmpose` (only the unused CPM/Hourglass backbones) and `tensorrt`/`torch2trt`.
4. **`python3-tk`** — solely because `hmr4d/utils/body_model/body_model.py` line 1 says
   `from turtle import forward`, an upstream autocomplete slip (that `forward` is the
   turtle-graphics pen command and is never used). Installed rather than patched, in a late
   layer so the pytorch3d compile stays cached.
5. **`torch.load` `weights_only` default restored to False** via a `.pth` in site-packages.
   PyTorch 2.6 flipped it True; all four bundled checkpoints predate that and are full pickles,
   and the callers are third-party (ultralytics calls `torch.load` with no flag).
   ⚠ **This re-enables arbitrary code execution on unpickle and is scoped to this image on
   purpose.** Do not reuse the image against untrusted checkpoints.

**Preprocessing is proven on real input.** YOLO → ViTPose → HMR2 all run on the 5090. On the
bundled tennis clip: 312 frames, keypoint confidence 0.903 mean. On a user-supplied 7 s 720×720
green-screen dance clip: 222/222 frames, box 215×549 px, confidence 0.847 mean with 98% of
keypoints above 0.5, weakest joint the left elbow at 7% low-confidence (it silhouettes mid-clip).
Green screen did **not** hurt 2D detection.

**The one remaining blocker — `SMPLX_NEUTRAL.npz` (HUMAN ACTION):** register at
smpl-x.is.tue.mpg.de and place it at
`C:\Unitree\gvhmr\inputs\checkpoints\body_models\smplx\SMPLX_NEUTRAL.npz`.

⚠ **Correction to an earlier assumption in this file:** SMPL-X is *not* only needed for
rendering. `EnDecoder.__init__` calls `make_smplx("supermotion_v437coco17")`, which hits a bare
`assert smplx_path.exists()` at `hmr4d/utils/body_model/smplx_lite.py:28` during **prediction**.
So there is no partial path to a usable `hmr4d_results.pt` without the model. The bare assert is
also why the failure surfaces as an empty `AssertionError()` inside a Hydra
`InstantiationException` — the traceback does not name the missing file.

**Correction on whether a "gliding" dance move can work.** Earlier reasoning here was that GMR
has no contact model, therefore a moonwalk-style glide cannot reproduce. That conflated two
different targets:

- **Kinematic retarget → MuJoCo playback / video:** root translation is copied wholesale from the
  pose estimate rather than derived from foot contacts, so the glide *should* reproduce. The
  measured numbers support this: body travels 199 px while the left ankle swings 185 px relative
  to the body — the estimator is capturing translation and leg articulation as separate signals,
  which is exactly the illusion.
- **Physics sim or real hardware:** friction is real there, the feet will not slide, and the
  motion will not survive. This needs an RL tracking controller (the TWIST approach), and it is
  Phase 3 / safety-gated regardless.

So for a *demo video*, a glide clip is a legitimate input. For hardware it is not.

### Ready-to-run tooling (2026-07-18) — `C:\Unitree\_data\mirror_spike\pipeline\`

A 23-agent parallel source audit of the GVHMR→GMR handoff produced `RUNBOOK.md` plus three
scripts. **Read `RUNBOOK.md` first** — it carries every verified defect with file:line.

- `preflight.py` — validates the npz is genuinely SMPL-X (10475 verts / 55 joints, not
  SMPL's 6890), installs to both consumer trees, and proves the container sees it through the
  bind mount. Tested; correctly reports NOT READY today.
- `run.py` — one command, video→G1 mp4, with every landmine workaround baked in.
  `--ab-postproc` runs it twice to settle S1 (below).
- `check.py` — quality gate. Validated **both** ways: passes the LAFAN1 reference
  (pelvis 0.781 m, 29/29 DoF active) and correctly FAILS a synthetic travel-cancelled pkl.
- `../make_sidebyside.py` — composes source | G1 into the demo clip. Self-tested.

**Three blockers found that would each have killed the first run:**

- **B1** The model is NOT in the docker image — the `.dockerignore` added earlier this session
  excludes `inputs/`, so `COPY . /app` never carries it. Requires
  `-v C:\Unitree\gvhmr\inputs:/app/inputs`. Failure mode is the message-less AssertionError.
- **B2** `gvhmr_to_robot.py:91` is posix-only: `split('/')` on a Windows backslash path embeds the
  whole path in the video filename → `os.makedirs` on `unitree_g1_C:` → `OSError [WinError 123]`.
  Reproduced in the real venv. Fires *after* the multi-minute SMPL-X forward pass, and after a
  MuJoCo window has opened — so it reads like a GL fault. Pass forward slashes.
- **B3** `WORKDIR /app` is load-bearing (`demo.py:320` loads the ckpt CWD-relative). Never `-w`.

**S1 — SETTLED BY MEASUREMENT 2026-07-18, and the intuitive suspect was the wrong one.**

`gvhmr_pl_demo.py:38` hardcodes `postproc=True` with no flag, and that block does **three
unrelated things**. Measured on the moonwalk clip by neutralising each independently
(`run.py --modes`):

| variant | what it disables | travel_m | pelvis_mean |
|---|---|---|---|
| `on` | nothing (as shipped) | 0.151 | 0.885 |
| `nostatic` | static-joint correction `:97-112` | 0.176 | 0.885 |
| `nodrift` | **drift correction `:86-95`** | **0.749** | **0.885** |
| `off` | all three, incl. ground alignment `:114-116` | 0.751 | −0.282 |

The static-contact block was the obvious culprit — a moonwalk is definitionally a foot that looks
planted while sliding — and it is worth 0.025 m. The **drift correction** is the real cause at
0.598 m: it pulls the global root toward the in-cam estimate, firing only past a 0.25 m
disagreement and clamped to 0.02 m/frame, but cumulative over 221 frames that is up to 4.4 m of
authority. `nodrift` recovers all the travel *and* keeps ground alignment — pelvis stats identical
to baseline to 4 decimals. Disabling postproc wholesale is not the fix: it also drops the ground
alignment and leaves the robot 0.28 m underground.

⚠ **Suppressed travel is not by itself evidence of a bug.** `branches.py` compares GVHMR's global
and in-cam root trajectories: if in-cam also shows the traverse, the correction destroyed real
motion; if in-cam shows the subject roughly in place, the correction was removing genuine
global-branch drift and was right to. On this clip the branches agree in magnitude (global 0.964 m
vs in-cam 0.741 m) and differ only by a world↔camera frame rotation — so the travel is real.
Run it before trusting recovered travel on any new clip.

Also verified: **GMR copies root translation wholesale** (no contact detection, no foot-lock), so
the glide survives GMR — only GVHMR can eat it.

### Rebuild hygiene (RESOLVED 2026-07-18)

Clean `docker build` succeeded with the new `.dockerignore`: image dropped **38.9 GB → 28.2 GB**,
build ~2 min warm, and all five fixes are now built layers rather than hand-applied `docker commit`
patches. Smoke test in-image passes: torch 2.11.0+cu128, arch list includes `sm_120`, pytorch3d
0.7.8 with working CUDA `knn`, `hmr4d` imports. The image is reproducible from the Dockerfile.
⚠ Consequence of the `.dockerignore`: checkpoints are no longer baked in — the `-v` mount is now
mandatory (see B1).

Historical note on how it got there: without a `.dockerignore`, `COPY . /app` shipped 5.5 GB of
checkpoints to the daemon (426 s of build-context transfer) and baked them into a layer. Also
worth remembering that a rebuild **wipes any `docker commit` patch layer** — fix 5 was lost that
way once and had to be re-applied, which is why all five fixes now live in the Dockerfile.

## Acceptance Criteria

- [x] GMR installed on this box and verified standalone on a LAFAN1 clip — a **uv venv** at
      `C:\Unitree\gmr\.venv`, not a conda env: `conda create` demands acceptance of the Anaconda
      default-channel ToS, which has commercial-use implications and is a human decision
- [x] `g1_mujoco_webview.py` replays `g1_traj.npy` on this box. The hardcoded pz-264 path is now
      `G1_XML` + a per-host candidate list (swapping one hardcoded path for another would just
      move the bug); verified `(688, 50)` against the model's `nq=50`, all frames, no error
- [x] A video of a person is retargeted end-to-end and played back on the G1, recognisably
      matching the source — `_data\presentation\05_motion_mirroring\demo_moonwalk_g1.mp4`
- [x] Joint ordering **verified, not assumed**: all 29 GMR names exist in `g1.urdf`, which has
      exactly 29 revolute joints (1:1). Stronger than checking the order — the viewer matches by
      *name* (`robot.joints[name]`), so a permutation cannot silently produce plausible-but-wrong
      motion. Ordering source cited at `gvhmr_to_robot.py:151` (`qpos[7:]` of `g1_mocap_29dof.xml`)
- [x] Demo clip (source beside robot playback) saved to `_data\presentation\05_motion_mirroring\`,
      with a README recording why this clip is not cleared for external use
- [x] Findings written up — see RUNBOOK.md and the sections above. Body motion is good; **hands
      are confirmed not retargeted** (`params.py` maps `unitree_g1_with_hands` to the same
      `smplx_to_g1.json` IK config, which contains zero finger entries), so the 43-DoF config buys
      nothing here and plain `unitree_g1` is the right choice
- [x] **Phase 2** — surfaced in NeoDEM as a Motion tab (see below)

## Risks / open questions

- **Hands are the weak point.** GMR's own video example uses `--robot unitree_g1` (29 DoF), not
  the with-hands config. GVHMR outputs SMPL-X (which structurally carries hand parameters) but its
  contribution is world-grounded *body* trajectory; monocular finger recovery is a known-hard
  problem. **For Dex3 finger motion the existing Quest 3 hand-tracking stack is likely better than
  any camera.** Expect to demo body motion and treat good fingers as a bonus.
- **Licensing — check before this becomes marketing material.** GMR itself is MIT, but the SMPL-X
  body models it depends on are distributed under their own registration-gated licence that is
  typically research/non-commercial. NeoDEM is a product; if this clip is used commercially the
  model licence (and GVHMR's) must be checked first. Flag to a human — do not decide this in code.
- Not real-time from video. If a *live* mirror is wanted later, GMR supports live Xsens/OptiTrack
  streams (we have neither) and TWIST2 uses the XRoboToolkit SDK — a separate, larger investigation.

## Test Strategy

- **Stage isolation:** verify replay with `g1_traj.npy` → then GMR from a mocap clip → then the
  full video path. A failure at any stage is then unambiguous.
- **Correctness of retargeting:** play source video and robot playback side by side; a human
  reviewer confirms limb-for-limb correspondence (left stays left — mirroring/handedness bugs are
  the classic failure and would be embarrassing in a demo).
- **Joint ordering:** assert GMR's joint-name list maps 1:1 onto the MJCF joint names; a
  permutation produces plausible-looking-but-wrong motion that passes a casual glance.
- **Degenerate-input check:** feed a clip where the person leaves frame or is occluded; confirm the
  output degrades visibly rather than emitting a violent discontinuity that would be unsafe in Phase 3.
