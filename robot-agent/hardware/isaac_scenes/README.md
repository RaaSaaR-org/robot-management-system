# Isaac scenes — `Isaac-Factory-PauseRoom-G129-Dex3-Wholebody`

A large factory hall the G1 can walk around, plus a separate walled **pause room** holding
an apple-to-plate pick-and-place setup. The point is the join: this is the first scene in
which "go to the pause room and pick up the apple" is a single instruction that spans
locomotion *and* manipulation, with one robot, in one sim.

The manipulation half is the Isaac twin of
[`../sim_evaluator/mjcf/g1_apple_pnp_scene.xml`](../sim_evaluator/mjcf/g1_apple_pnp_scene.xml),
and every dimension is copied from it so the two sims stay comparable.

These files are **authored here and installed into the Unitree checkout** — this directory
is the source of truth, the checkout gets a copy. See [Install map](#install-map).

---

## What is in the scene

| | |
|---|---|
| Factory hall | 24 × 16 m of clear floor (384 m²), 4 m perimeter walls, **no roof** |
| Structure | 8 steel columns in two rows at y = ±4, splitting the hall into a central lane and two side aisles |
| Dressing | 6 plywood crates (primitives) + 5 USD props from the checkout's own `assets/objects/` |
| Pause room | 4 × 4 m, in the hall's north-east corner, 3 m partitions, one doorway |
| Doorway | 1.40 m clear width, 2.20 m clear height, centred on x = 10.0 |
| Pause room contents | 1.22 × 1.20 × 0.75 m table, static white plate, dynamic red apple |
| Robot | G1 29-DoF + Dex3, standing on the factory floor 8.41 m from the door, facing it |
| Cameras | the 4 robot cameras + `film_camera` (unchanged from `move_cylinder`), plus a hall overview and a pause-room camera |

The hall interior runs `x ∈ [-12, 12]`, `y ∈ [-8, 8]`. The pause room interior runs
`x ∈ [8, 12]`, `y ∈ [4, 8]`; its north and east walls **are** the hall's north and east
walls, so only two new partitions were needed.

```
      y
      ^                     hall interior x[-12,12] y[-8,8]
  +8  +--------------------------------------------------+
      |  [pt_b]              [pt_c]      |  PAUSE ROOM    |
      |                                  |    [table]     |
  +4  |   |col   |col   |col   |col      +====  ==========+   <- 3 m partitions
      |                                     ^  door 1.4 m
      |   [crates]                          |  centre (10.0, 3.9)
   0  |                              [G1 start (4,-2), yaw 45 deg]
      |   |col   |col   |col   |col        /
  -4  |                                   /
      |  [pt_a]      [yb_a]     [yb_b]   v
  -8  +--------------------------------------------------+
     -12                                                +12  -> x
```

### Coordinate table

World frame, metres, +z up, **`num_envs = 1`** (so the single env origin is the world
origin and env-local == world).

| Thing | Position | Notes |
|---|---|---|
| **robot start** | `(4.00, -2.00, 0.80)` | yaw **45°**; true bearing to the door is 44.52°, so it faces the door within 0.5°. Walk distance 8.41 m. |
| **pause-room door centre** | `(10.00, 3.90, 0.00)` | clear opening `x ∈ [9.30, 10.70]`, i.e. **1.40 m**; lintel underside at z = 2.20 |
| **table centre** | `(10.00, 6.60, 0.375)` | 1.22 × 1.20 × 0.75 → **top face z = 0.75**, footprint `x ∈ [9.39, 10.61]`, `y ∈ [6.00, 7.20]` |
| **plate centre** | `(10.340, 6.165, 0.760)` | r = 0.095, full height 0.02 → sits on the table, rim at z = 0.77. Static. |
| **apple spawn** | `(10.170, 6.260, 0.795)` | r = 0.04, 0.18 kg, dynamic. Underside 5 mm above the table top. 0.195 m from the plate centre. |
| floor top face | `z = 0.00` | 26 × 18 m slab at `/World/GroundPlane` |

Named places, for the place graph (`PLACES` in the layout module):

| name | (x, y) | side |
|---|---|---|
| `robot_start` | (4.00, -2.00) | factory floor |
| `factory_centre` | (0.00, 0.00) | factory floor |
| `west_aisle` | (-8.00, 0.00) | factory floor |
| `pause_room_door` | (10.00, 3.90) | in the doorway |
| `pause_room_centre` | (10.00, 5.20) | pause room |
| `table_front` | (10.00, 5.35) | pause room, 0.65 m clear of the table edge |

---

## Install map

| File here | Path in the `unitree_sim_isaaclab` checkout |
|---|---|
| `common_scene/factory_pauseroom_layout.py` | `tasks/common_scene/factory_pauseroom_layout.py` |
| `common_scene/base_scene_factory_pauseroom.py` | `tasks/common_scene/base_scene_factory_pauseroom.py` |
| `g1_tasks/factory_pause_room_g1_29dof_dex3_wholebody/__init__.py` | `tasks/g1_tasks/factory_pause_room_g1_29dof_dex3_wholebody/__init__.py` |
| `g1_tasks/factory_pause_room_g1_29dof_dex3_wholebody/factory_pause_room_g1_29dof_dex3_hw_env_cfg.py` | same, under `tasks/g1_tasks/factory_pause_room_g1_29dof_dex3_wholebody/` |
| `g1_tasks/factory_pause_room_g1_29dof_dex3_wholebody/mdp/{__init__,observations,rewards,terminations}.py` | same, under `.../mdp/` |
| `g1_tasks/__init__.py` | `tasks/g1_tasks/__init__.py` — **OPTIONAL, and it is a full-file replacement** |
| `README.md`, `verify_factory_scene_offline.py` | not installed; they stay in this repo |

**Why `g1_tasks/__init__.py` is optional.** `tasks/__init__.py` ends in
`import_packages(__name__, _BLACKLIST_PKGS)`, which walks and imports every sub-package
recursively (`tasks/utils/importer.py`), so the new task package registers itself with or
without an explicit import. The copy here differs from the checkout's current file by
exactly two added lines (one `from . import …`, one `__all__` entry). If it conflicts when
patch `0007` is applied, **drop it** — nothing breaks.

The blacklist is a substring test over `["utils", ".mdp", "pick_place"]` against the full
dotted module name. `factory_pause_room_g1_29dof_dex3_wholebody` matches none of them, and
its `mdp` sub-package is skipped by the walker and imported explicitly by the env cfg —
exactly as in `move_cylinder_g1_29dof_dex3_wholebody`.

---

## Running it

```bash
UNITREE_ROOT=/path/to/Unitree/g1_quest_teleop/third_party/checkouts   # adjust

docker run --rm --user 0 --runtime=nvidia --gpus all \
  -e ACCEPT_EULA=Y -e OMNI_KIT_ACCEPT_EULA=YES -e NVIDIA_DRIVER_CAPABILITIES=all \
  -e NEODEM_LOG_EVERY=5 \
  -e HOME=/home/humanoid -e PYTHONPATH= -e CYCLONEDDS_HOME=$UNITREE_ROOT/cyclonedds/install \
  --device /dev/dri --ipc=host --network host \
  -v /home/humanoid:/home/humanoid -w $UNITREE_ROOT/unitree_sim_isaaclab \
  neodem-isaac-host:latest \
  /home/humanoid/anaconda3/envs/unitree_sim_env6/bin/python -u sim_main.py \
    --task Isaac-Factory-PauseRoom-G129-Dex3-Wholebody \
    --enable_dex3_dds --enable_wholebody_dds --robot_type g129 \
    --device cuda --headless --enable_cameras --camera_write_interval 10
```

The container supplies root and nothing else — it bind-mounts the host home and runs the
**host** conda env's python, so there is no second Isaac install. It exists because Isaac's
Vulkan device node is ACL'd to whoever holds `seat0`, which over SSH is nobody; see
`../isaac_sim_patches/README.md`. Running the same command line directly on a local seat
also works.

Two flags worth knowing about:

* `--device cuda` is what the brief asks for. Every recorded NeoDEM run of the sibling
  wholebody task in `isaac_sim_patches/README.md` used `--device cpu`; `cuda` is untested
  **for this scene**, and if the PhysX GPU pipeline complains, the aggregate-pair capacities
  are already raised in `__post_init__` and `--device cpu` is the known-good fallback.
* `NEODEM_FILM_DIR=/some/dir` turns on the trailing film camera
  (`action_provider_wh_dds.py:551-568`). It works here because `film_camera` is kept
  byte-for-byte from the `move_cylinder` task.

**Only one `sim_main.py` at a time on this box** — its exit handler `SIGKILL`s every other
one.

---

## Offline verification

```bash
python3 verify_factory_scene_offline.py \
  --checkout /path/to/unitree_sim_isaaclab
```

No Isaac, no GPU, no network. It imports `factory_pauseroom_layout.py` **for real** (that
module imports nothing but `math`, which is the entire reason the geometry was split out of
the cfg) and does actual arithmetic on the numbers the simulator will use — so the check and
the scene cannot drift. The two cfg modules *cannot* be imported (they need `isaaclab`,
which needs a Kit app and a GPU), so those are read with `ast`, which is enough for the two
questions asked of them: which prim paths are declared, and whether any remote URL or
nucleus symbol appears in **executable** code. `ast` drops comments for free and docstrings
are excluded explicitly, so the long explanations in those files about *why* nucleus paths
are avoided do not themselves trip the check.

It checks: every USD path resolves to a real file; no URL or nucleus symbol in code; the
ground plane is outside `/World/envs` and every other prim path is well formed; the gym id;
the hall wall ring has no gap below 2 m; the pause room has exactly one opening, on the
south side, ≥ 1.0 m wide, matching the declared door; the lintel is above head height; the
plate rests on the table and inside its footprint; the apple starts above the table top,
inside the footprint, and not touching the plate — **including at the worst corner of the
reset-jitter box**; the robot starts outside the pause room, inside the hall, at 0.80 m,
facing the door, with a clear route and not inside any geometry; the quaternion helpers
produce the orders they claim; both fixed cameras actually have line of sight.

Current result: **76 passed, 0 failed, 0 skipped**.

It caught two real defects while being written, both of which would have been invisible
until a launch (or worse, until a scoring run):

1. the `±0.05 / ±0.04` reset-jitter box copied from the `move_cylinder` task put the apple's
   worst corner **0.132 m** from the plate centre, against **0.135 m** of touching — so the
   apple would occasionally spawn already on its goal. `APPLE_RESET_JITTER` is now `±0.03`,
   worst corner 0.154 m;
2. a prim-path audit that only looked at string literals missed `/World/GroundPlane`,
   because it is passed as a named constant.

---

## Design decisions that are not obvious

### Every asset is local — including the floor

There is no apple, plate or factory-building USD on this machine and no local Nucleus
server. `{ISAAC_NUCLEUS_DIR}/…` is not a local path: it expands to
`https://omniverse-content-production.s3-us-west-2.amazonaws.com/Assets/Isaac/6.0/Isaac`
(`IsaacLab30/apps/isaaclab.python.kit:310`, read by
`isaaclab/utils/assets.py:_parse_kit_asset_root`), fetched over HTTPS on first use. So the
hall, partitions, columns, crates, table, plate and apple are all primitive spawn cfgs.

**That includes the ground.** `GroundPlaneCfg()` — which is what TASK-223 put into
`base_scene_pickplace_cylindercfg_wholebody.py` — has
`usd_path = f"{ISAAC_NUCLEUS_DIR}/Environments/Grid/default_environment.usd"` by default
(`IsaacLab30/…/sim/spawners/from_files/from_files_cfg.py:218). It is therefore a network
dependency, and this scene uses a local 26 × 18 × 0.4 m static box collider at the same
`/World/GroundPlane` prim path instead, with its **top face at exactly z = 0** so the
robot's 0.80 m spawn height means the same thing it does in the working `move_cylinder`
scene.

> ⚠ **This is a finding about the existing scene too.** `move_cylinder_g1_29dof_dex3_wholebody`
> works today because that nucleus asset is reachable or already cached. On a box with no
> network it would fail — or worse, lose its floor again, which is the exact TASK-223 bug.

The five USD props that *are* used are used because they already ship inside the checkout
**and** are already spawned by working scenes (`PackingTable{,_1,_2}` by
`base_scene_pickplace_cylindercfg_wholebody.py:35-53`, `table_with_yellowbox.usd` by
`base_scene_pickplace_redblock.py:35-43`). Their `z = -0.2` is copied from those call sites:
these assets' origins sit 0.2 m above their own feet.

Deliberately **not** used, though present on disk:

* `small_warehouse{,_digital_twin}/small_warehouse_digital_twin.usd` — it is a whole
  building, with its own floor at z = 0 and its own walls. Dropping it inside a 24 × 16 m
  hall gives you a building inside a building: a second co-planar floor collider to fight
  with, and walls boxing the robot into ~7 × 12 m of the hall it was supposed to walk
  across. The scene therefore has no `room_walls`, and consequently none of the warehouse's
  eight ceiling RectLights — the hall is lit by a dome plus one distant light instead.
* `drawers/drawer.usd` — an articulated cabinet. `base_scene_pick_redblock_into_drawer.py`
  drives it with an `ArticulationCfg` and actuators; spawning it as static dressing gives an
  unactuated articulation for no visual gain.

### Quaternions are `(x, y, z, w)`

Isaac Lab 3.0 in this checkout stores `InitialStateCfg.rot` and `CameraCfg.OffsetCfg.rot` as
XYZW, with identity `(0, 0, 0, 1)`:

```
IsaacLab30/source/isaaclab/isaaclab/assets/asset_base_cfg.py:37-40
    rot: tuple[float, float, float, float] = (0.0, 0.0, 0.0, 1.0)
    """Quaternion rotation (x, y, z, w) of the root in simulation world frame."""
IsaacLab30/source/isaaclab/isaaclab/sensors/camera/camera_cfg.py:46-47
    """Quaternion rotation (x, y, z, w) w.r.t. the parent frame."""
```

Unitree's own cfgs are 2.x-era and write `(w, x, y, z)`; copying one of their literals lands
the prim rotated 180° about X (`../isaac_capture.py:35-39`). **Every `rot=` in these files
is XYZW and carries a comment saying so.**

The one exception is the robot's `init_rot`, which is `(w, x, y, z)` — because
`G1RobotPresets` documents that order and reorders internally at
`tasks/common_config/robot_configs.py:230-239`. Passing XYZW there would double-swap. The
layout module exposes `yaw_quat_xyzw()` and `yaw_quat_wxyz()` as two separately-named
functions so a call site can never be ambiguous about which it wanted.

The two fixed cameras are aimed with `look_at_quat_xyzw_ros(eye, target)` rather than a
pasted four-tuple, because a derived orientation is checkable — the verifier re-rotates the
camera's +Z by the result and compares it against the eye→target ray (max component error
2.8e-16) — and a literal is not.

### What goes outside `/World/envs`

`replicate_physics=True` clones everything under `/World/envs/env_.*` once per environment,
so anything that must exist exactly once lives directly under `/World`: the floor, the two
lights, `world_camera`, `pause_room_camera`, and `film_camera`. This is the TASK-223 rule.
That bug is worth restating because of how it presented: the scene's only floor was inside
the cloned env, the G1 free-fell to −39 km, and `projected_gravity` still read `(0, 0, -1)`
for the first ~100 steps — so every "the policy cannot balance" hypothesis kept failing.

### The apple must be called `object`

`SceneEntityCfg("object")` is hard-coded in the reward, the termination and the reset event
of every task in this checkout (`base_reward_pickplace_cylindercfg.py:50`,
`base_termination_pick_place_cylinder.py:17`, `neodem_push_probe.py:103`). An apple named
`apple` would make all of them raise at scene build. It is named `object`.

### Deviations from the MJCF, and why

| | MJCF | here |
|---|---|---|
| apple shape | ellipsoid `0.04 0.04 0.036` | **sphere r = 0.04** — Isaac Lab has no ellipsoid spawner. 4 mm taller, perfectly round. |
| rolling friction | `0.02`, `condim 6` | **no equivalent.** PhysX has no direct rolling-friction term in `RigidBodyMaterialCfg`. The Isaac apple will roll further than the MuJoCo one for the same nudge. |
| sliding friction | 1.2 | 1.2 — carried over. It is load-bearing twice: it is what lets a closed Dex3 hand hold the apple, and the low-friction version rolled >1 m off the table on any grazing contact. |
| table surface | textured cloth, visual-only plane 0.5 mm above the collider | flat grey `PreviewSurfaceCfg`. The MJCF's texture work was matched against real dataset frames for a *policy*; nothing in this scene is trained on pixels yet. |
| robot base | fixed at `(-0.15, 0, 0.76)`, +90° yaw | free-standing on the factory floor at `(4, -2, 0.8)`, 45° yaw. The whole point here is that it has to walk. |

---

## Assumptions that could not be verified without launching

Everything below is honest guesswork until the orchestrator runs it. Nothing here has been
observed — this agent never launched Isaac.

1. **That the scene builds at all.** No Isaac Lab cfg is instantiated anywhere in this
   directory. A renamed spawner field, a `configclass` that rejects an un-annotated
   attribute, or a keyword that moved in the 3.0 migration would all survive the offline
   check and fail at `env = gym.make(...)`.
2. **That `CuboidCfg` with `collision_props` and no `rigid_props` really produces a static
   collider.** The spawner module docstring says it does
   (`sim/spawners/shapes/__init__.py`: "a visual mesh (no physics) / a static collider (no
   rigid body) / a rigid body"), and this is the standard way to author room geometry, but
   the scenes in this checkout all use `kinematic_enabled=True` instead, so the static path
   is not exercised by anything that is known to work here. If the walls turn out to be
   non-collidable, add
   `rigid_props=sim_utils.RigidBodyPropertiesCfg(kinematic_enabled=True)` in `_static_box`.
3. **`sim_utils.RigidBodyMaterialCfg` is deprecated.** It is an alias for
   `PhysxRigidBodyMaterialCfg` that emits a `DeprecationWarning` in `__post_init__`
   (`isaaclab_physx/.../physics_materials_cfg.py:207-228`). It is used here because that is
   what the working scenes use; expect ~35 warnings on startup, one per prim.
4. **That the G1 can actually walk 8.4 m across this hall.** The gait comes from the
   wholebody DDS provider and a policy that lives outside this scene. The route is
   geometrically clear (tightest obstacle clearance 1.83 m) but nothing here says the
   locomotion works.
5. **That the robot fits through the door in practice.** 1.40 m of clear width against a
   ~0.45 m shoulder span is generous, but the G1 sways, and the wholebody controller's
   lateral tracking error under a commanded turn has not been measured in this scene.
6. **That the table is reachable from a standing G1.** The MJCF geometry was tuned around a
   robot whose base was *fixed* at 0.76 m. A free-standing G1 that has just walked in will
   stop wherever it stops; `table_front` at `(10.00, 5.35)` is a guess at a good standing
   spot (0.65 m from the table edge), not a measured one.
7. **The USD props' real footprints.** They are placed by their origins, and their bounding
   boxes are not readable offline, so the verifier charges each a generous 1.0 m half-extent
   for the route check. If `yellowbox_table_b` at `(5.00, -6.50)` turns out to be huge, it
   is the one nearest anything that matters.
8. **Lighting.** A dome at 3000 plus a distant light at 1200 into a roofless hall is a
   guess. The scene lost the warehouse USD's eight ceiling RectLights along with the
   warehouse; the hall may render darker than the `move_cylinder` scene does.
9. **Both fixed cameras' framing.** The sight-lines are proven clear of walls, and the
   look-at orientations are proven correct, but focal length 12 mm / aperture 27 (hall) and
   14 mm / 24 (pause room) are unframed guesses.
10. **`--device cuda`.** Every recorded run of the sibling task used `--device cpu`.
11. **The reward is unreachable in this task, as in every `*Wholebody*` task.**
    `sim_main.py:476-479` forces `use_rl_action_mode = True` for any id containing
    "Wholebody", and `robot_control_system.py:120-127` then never calls `env.step()`, which
    is what runs the reward manager. `mdp/rewards.py` exists for structural parity and to be
    live the moment that is fixed; it is not scoring anything today. See
    `../isaac_sim_patches/README.md:445-478`.
12. **Ray-casting sensors will not see the walls.** These are `CuboidCfg`, i.e.
    `UsdGeom.Cube` prims. A mesh-based ray cast such as `isaac_capture.py`'s
    `WarehouseRaycaster` collects `prim.IsA(UsdGeom.Mesh)` and would report the hall as
    empty — the robot walks through a wall the camera can see. `sim_main.py` does not
    ray-cast, so this is fine as shipped; the fix, if a raycasting sensor is ever pointed at
    this scene, is to swap `CuboidCfg` → `MeshCuboidCfg` in `_static_box`.
13. **`num_envs = 1` only.** With more envs the `/World/envs` content is cloned and offset
    while the floor, lights and fixed cameras are not, so env 1 would get walls standing on
    nothing. The DDS bridge is single-robot anyway.
