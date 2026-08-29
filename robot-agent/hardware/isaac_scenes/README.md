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
| **Door** | a **powered automatic two-leaf sliding door** in that doorway — a real articulation with prismatic joints and box colliders, which opens when the robot comes within 2.5 m |
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
  +4  |   |col   |col   |col   |col      +==[><]==========+   <- 3 m partitions
      |                                     ^  sliding door, 1.4 m
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
| **door articulation origin** | `(10.00, 4.03, 0.00)` | the sliding door, hung on the pause-room face of the partition. Leaves 0.72 × 0.06 × 2.16 m, `z ∈ [0.02, 2.18]`, travel 0.70 m each. |
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
| `pause_room_door` | (10.00, 3.90) | in the doorway; arrive facing 90° |
| `pause_room_centre` | (10.00, 5.20) | pause room — **a waypoint, not a standing spot**: the apple is 1.07 m away from here |
| `table_front` | **(10.24, 5.84)** | pause room, 0.16 m off the table's near face, facing 90°. **Derived, not typed** — see below. |

`PLACE_HEADINGS` gives the heading a place expects to be arrived at with, for the two
places where it is load-bearing (`pause_room_door` and `table_front`, both 90°). Standing
at `table_front` facing anywhere but the table makes every reach number below meaningless.

### Where `table_front` comes from, and why it moved

**`table_front` used to be `(10.00, 5.35)`, and the robot could not reach the apple from
it.** The apple is at `(10.17, 6.26, 0.795)`; from the old spot that is **0.926 m**
horizontally from the pelvis and **0.992 m** from the shoulder, against a G1 arm that is
0.533 m from shoulder to knuckle and 0.627 m to the fingertip with the arm dead straight.
It was short by roughly 0.4 m — not a tuning problem, a "cannot physically touch it"
problem. `pause_room_centre` (10.00, 5.20) was worse at 1.131 m. Nothing caught it,
because every manipulation check asked about the apple, the plate and the table, and none
of them ever mentioned the robot.

The spot is now computed in `standing_spot_for_grasp()` from two constraints, one each way:

| | | value |
|---|---|---|
| forward | table's near face (y = 6.00) less `TABLE_STANDOFF` | **y = 5.84** |
| lateral | apple x plus `GRASP_LATERAL_OFFSET`, so the apple falls on the robot's **left** | **x = 10.24** |

`TABLE_STANDOFF = 0.16 m`. The binding constraint is the **feet**, not the belly: the
pelvis rides at 0.725–0.79 m and the table top is at 0.75, so the pelvis may overhang the
edge, but the feet may not foul the table's box (this table is solid to the floor). Foot
reach ahead of the pelvis, walked out of `g1_43dof_fixedbase.xml` with real rigid
transforms, is **0.125 m** — the ankle-roll link sits within 21 µm of directly *below* the
pelvis and the forward contact spheres are 0.12 m ahead of the ankle, r = 0.005.
`FOOT_FRONT_REACH = 0.13 m` covers that with 5 mm to spare, leaving 0.03 m of margin at a
0.16 m standoff.

> ⚠ **An earlier version of this section said 0.072 m**, from "the ankle sits 0.053 m
> *behind* the pelvis". That summed two x offsets expressed in different frames:
> `left_hip_roll_link` carries a −10.02° quat about y and `left_knee_link` carries its
> exact inverse, so the two rotations cancel and the offsets do not add. The figure was
> 53 mm short, and the claimed 0.088 m of margin over `FOOT_FRONT_REACH` was really 5 mm.
> Section 16 of the verifier now re-derives it from the MJCF on every run, which is how it
> was found.

`GRASP_LATERAL_OFFSET = 0.07 m` comes from the MJCF twin, where the apple sits 0.07 m to
the robot's left. That sign is not incidental: every episode in the source dataset is a
**left-hand** grasp with the plate to the apple's right, and keeping it keeps this scene's
composition the same as the frames the policy was trained on.

**The resulting reach**, shoulder to target, over the whole *measured* base-height band:

| | base_z 0.725 m (settled crouch) | base_z 0.790 m (standing) |
|---|---|---|
| shoulder → apple | **0.476 m** | **0.509 m** |
| shoulder → plate rim | 0.455 m | 0.493 m |
| worst corner of the apple's reset-jitter box | — | **0.537 m** |

against `GRASP_REACH_BUDGET = 0.55 m`. Horizontal pelvis→apple is **0.426 m**, down from
0.926 m.

Both heights are real measurements, not nominals: 0.790 is where the policy holds the base
while standing, and 0.725 is the one-legged crouch it settles into after a walk command
stops — both from the live run logged further down. The crouch *lowers* the shoulder, which
is why the check runs over a band rather than at one convenient height.

**The reach budget is calibrated, not invented.** There is no datasheet number for "can a
G1 pick this up", so 0.55 m is pinned to the only two configurations in which a G1 + Dex3
demonstrably does pick something off a table, with the shoulder located the same way in
both:

| working reference | pelvis | object | shoulder → object |
|---|---|---|---|
| the checkout's `pick_place_cylinder_g1_29dof_dex3` | (-0.15, 0, 0.76) | (-0.35, 0.40, 0.84) | **0.463 m** |
| the MuJoCo twin `g1_apple_pnp_scene.xml` | (-0.15, 0, 0.76) | (-0.22, 0.46, 0.789) | **0.531 m** |

The verifier recomputes both from its own constants rather than quoting them, so editing
`SHOULDER_ABOVE_PELVIS` re-justifies the budget instead of silently invalidating it.

Worth knowing: the MJCF twin sits at 0.531 m against a 0.533 m straight-arm knuckle
distance, i.e. **the reference scene reaches its apple with the arm essentially fully
extended**. The 0.017 m of budget above it is spent on the fact that a free-standing G1 can
pitch its waist and bend its knees toward the table, which neither fixed-base reference
can.

**And be blunt about what that means for this scene.** `GRASP_REACH_BUDGET = 0.55 m` is
17 mm *past* `ARM_REACH_TO_KNUCKLE = 0.533 m`, so "within budget" and "within a straight
arm" are not the same statement — and every check in section 12 used to make only the
first one. Spelled out over the height band:

| at the worst corner of the reset-jitter box | shoulder → apple | vs 0.533 m knuckle |
|---|---|---|
| base_z 0.725 m — the settled crouch the live run actually logged after a walk | **0.5053 m** | 26 mm **inside** |
| base_z 0.790 m — standing tall | **0.5370 m** | 4 mm **outside** |

So at the height the robot is in when it stops walking, the apple is comfortably inside
straight-arm knuckle range. At the height it holds while standing, it is a few millimetres
beyond it, and is reachable only with the arm essentially straight, or by pitching the
waist toward the table. Both are now asserted separately — the crouch against the knuckle,
the stand against the 0.627 m fingertip limit — and the budget itself is bounded at 20 mm
past the knuckle so the slack cannot grow silently.

---

## Install map

| File here | Path in the `unitree_sim_isaaclab` checkout |
|---|---|
| `common_scene/factory_pauseroom_layout.py` | `tasks/common_scene/factory_pauseroom_layout.py` |
| `common_scene/base_scene_factory_pauseroom.py` | `tasks/common_scene/base_scene_factory_pauseroom.py` |
| **`common_scene/pause_room_door.usda`** | **`tasks/common_scene/pause_room_door.usda`** — **REQUIRED.** The scene resolves it from `base_scene_factory_pauseroom.py`'s own directory, so it must land beside that module. |
| `common_scene/make_pause_room_door_usda.py` | `tasks/common_scene/make_pause_room_door_usda.py` — optional; only needed to regenerate the USD in place |
| `g1_tasks/factory_pause_room_g1_29dof_dex3_wholebody/__init__.py` | `tasks/g1_tasks/factory_pause_room_g1_29dof_dex3_wholebody/__init__.py` |
| `g1_tasks/factory_pause_room_g1_29dof_dex3_wholebody/factory_pause_room_g1_29dof_dex3_hw_env_cfg.py` | same, under `tasks/g1_tasks/factory_pause_room_g1_29dof_dex3_wholebody/` |
| `g1_tasks/factory_pause_room_g1_29dof_dex3_wholebody/mdp/{__init__,observations,pause_door,rewards,terminations}.py` | same, under `.../mdp/` |
| `g1_tasks/__init__.py` | `tasks/g1_tasks/__init__.py` — **OPTIONAL, and it is a full-file replacement** |
| `README.md`, `verify_factory_scene_offline.py`, `make_factory_place_graph.py` | not installed; they stay in this repo. The place graph the last one writes is not installed either — it is read by the **robot agent**, from this repo, via `PLACE_GRAPH_PATH` |

**The door USD is the one non-`.py` install.** It is deliberately resolved relative to
`base_scene_factory_pauseroom.py`'s own `__file__`, not via `PROJECT_ROOT` and not from
`assets/objects/`, so installing the scene modules installs the door with them and there is
no second path to get wrong. Forgetting it gives a `FileNotFoundError` naming
`pause_room_door.usda` at scene build.

**Why `g1_tasks/__init__.py` is optional.** `tasks/__init__.py` ends in
`import_packages(__name__, _BLACKLIST_PKGS)`, which walks and imports every sub-package
recursively (`tasks/utils/importer.py`), so the new task package registers itself with or
without an explicit import. The copy here differs from the checkout's current file by
exactly two added lines (one `from . import …`, one `__all__` entry). If it conflicts when
the next patch in `../isaac_sim_patches/` is applied, **drop it** — nothing breaks.
(That directory holds `0001`–`0006` today; an earlier draft of this line named a patch
`0007` that has never existed.)

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

Three flags worth knowing about:

* `--device cuda` is what the brief asks for. Every recorded NeoDEM run of the sibling
  wholebody task in `isaac_sim_patches/README.md` used `--device cpu`; `cuda` is untested
  **for this scene**, and if the PhysX GPU pipeline complains, `--device cpu` is the
  known-good fallback. Note the PhysX aggregate-pair capacities in `__post_init__` are
  **inherited, not tuned** — they are byte-identical to the sibling
  `move_cylinder_g1_29dof_dex3_hw_env_cfg.py`, and this scene has many more colliders than
  that one. If the GPU pipeline complains about buffer overflow, raising them is the first
  thing to try, not something already done.
* `NEODEM_FILM_DIR=/some/dir` turns on the trailing film camera
  (`action_provider_wh_dds.py:551-568`). It works here because `film_camera` is kept
  byte-for-byte from the `move_cylinder` task.
* `NEODEM_ROBOT_SPAWN=table_front` starts the robot **at the packing table** instead of at
  the authored factory-floor pose 8.4 m and one powered door away. That is for testing the
  manipulation without first solving the walk (TASK-228: the robot jams on the door frame);
  it is not the mission. Unset, the spawn is byte-for-byte the authored `ROBOT` pose.

  It accepts only a place in `PLACES` that also declares a heading in `PLACE_HEADINGS` —
  today `table_front` and `pause_room_door` — and **raises on anything else rather than
  falling back**, because a typo that quietly reverted to the default would present as a
  manipulation failure 8 m from where you meant, not as a spawn failure. See `robot_spawn`
  in `factory_pauseroom_layout.py`.

  `pause_room_door` is selectable because it declares a heading, but it is a **waypoint,
  not a spawn**: it sits 0.100 m from a shut door leaf, against the 0.40 m pad the verifier
  charges a spawn, so starting there puts the robot inside a 25 kg leaf on a stiff position
  drive at t = 0. Section 8 of the offline verifier prints that number on every run.

**Only one `sim_main.py` at a time on this box** — its exit handler `SIGKILL`s every other
one.

---

## The place graph Agent Mode navigates on

The scene knows where the table is. **Agent Mode does not, unless something tells it.** The
robot software navigates on a place graph JSON loaded by
`robot-agent/src/agent-mode/place-resolver.ts`, and for this scene there was none —
`PLACE_GRAPH_PATH` pointed at `places.warehouse.json`, i.e. at another building's polygons
expressed about another origin, so `goto table_front` resolved to nothing and every
`goto` failed by name.

```bash
python3 make_factory_place_graph.py            # (re)write the JSON
python3 make_factory_place_graph.py --check    # exit 1 if it is out of date, write nothing
```

It writes `../sim_evaluator/places/places.factory_pauseroom.json`, and it is a **generator
for the same reason `pause_room_door.usda` is one**: `table_front` was hand-typed once, at
`(10.00, 5.35)`, and was 0.4 m outside the arm's reach with nothing to notice. Every
coordinate in the JSON is read from `factory_pauseroom_layout.py` — `table_front` comes out
of `standing_spot_for_grasp()` on every run, so the apple cannot move without the place
moving with it. Section 18 of the offline verifier regenerates into a string and compares,
which turns "the graph matches the scene" from a claim into an assertion.

### What it emits

Six polygons, all `floor: 0`, all non-keepout. Five are 1.00 m squares; `TABLE-FRONT` is a
1.00 x 0.90 m rectangle, for the reason below. The goal column is the point the navigator
actually drives to (`placeGoal` takes the polygon's shoelace centroid).

| id | goal | type | where it comes from |
|---|---|---|---|
| `ROBOT-START` | (4.000, −2.000) | staging | `PLACES["robot_start"]`, asserted equal to `ROBOT["pos"][:2]` |
| `FACTORY-CENTRE` | (0.000, 0.000) | aisle | `PLACES["factory_centre"]` — **not** on the door route; it is *behind* the robot and routing through it adds ~4.5 m of backtrack |
| `WEST-AISLE` | (−8.000, 0.000) | aisle | `PLACES["west_aisle"]` — not on the door route either |
| `HALL-MIDWAY` | (7.000, 0.650) | corridor | the exact midpoint of the first lane |
| `PAUSE-ROOM-DOOR-APPROACH` | (10.000, 3.300) | corridor | `DOOR["centre"].x` for the centreline; north edge = the partition's south face |
| `TABLE-FRONT` | (10.240, 5.550) | cell | BOTH axes from `standing_spot_for_grasp()`; north edge = `stand_y + TABLE_STANDOFF`, cross-checked against the table's near face |

**Why 1.00 m squares.** Arrival is `pointInPolygon(pose) && distanceToBoundary ≥ 0.30 &&
dist(pose, centroid) ≤ 1.00` (`navigator.ts:198`, `:204`, `:389-392`). A polygon whose
inradius is under 0.30 m can never be arrived in *at all*, however close the robot gets to
its centre — and note that holds at EQUALITY: at exactly 0.30 the arrival set is a single
point, of measure zero, so the place is unarrivable in practice too. 0.50 m of half-side
leaves a 0.40 m arrival patch, a few centimetres wider than the G1's own footprint. The
generator mirrors those constants and the verifier re-reads them straight out of
`navigator.ts`, so the mirror cannot go stale.

**Why `TABLE-FRONT` is shallower, and why it still is not enough.** Its north edge is
pinned to the table, so depth is the only free axis and it trades goal accuracy against
arrivability. Half-depth is derived, not chosen: `PLACE_ENTRY_MARGIN_M + MIN_STAGE_M/2 =
0.45`. `MIN_STAGE_M = 0.30` (`navigator.ts:51`) is the floor under every commanded walk,
and the place is entered head-on from the south, so a band shallower than one stage can be
stepped clean over — short of the place, then past it into the table, with no pose ever
inside. Width stays 0.50 m of half-side: nothing constrains x, and x is where the measured
cross-track error lives.

That leaves the goal 0.290 m short of the grasp spot, and the honest consequence is
printed on every run: **no arrivable pose is in reach.** The arrival band tops out at
y = 5.700 and the apple is out of the 0.55 m budget south of y = 5.792 (`reach_limit_y()`,
solved in closed form over the base-height band). So the walk the mission appends after
`goto TABLE-FRONT` is not a refinement — a 0.092 m minimum is what makes the grasp possible
at all.

**`pause_room_door` is deliberately not a place.** `(10.00, 3.90)` is the **mid-plane of the
partition**, whose y extent is 3.80–4.00 — a gate point to pass through, not a spot to stand
on, and 0.100 m from a shut leaf against a 0.40 m planner disc. A polygon centred on it
would declare wall to be floor. `PAUSE-ROOM-DOOR-APPROACH` replaces it with the apron of
floor immediately south of the partition, narrow enough (x 9.50–10.50) that its whole
arrival patch lies inside the 1.40 m aperture. That is what fixes the previous jam at
`(10.607, 3.442)`: a single straight leg from the spawn to a goal *behind* the door lets
cross-track error build across 8 m and then aims diagonally into the frame. Making the
approach its own goal widens that lane's tightest clearance from **0.169 m past the body
radius to 0.588 m**, and puts the last bearing before the throat on the centreline. The
door's own automation has it open long before: the goal is 0.600 m from `DOOR["centre"]`,
inside the 2.50 m open radius, and the far edge of the place is 1.100 m out — still short of
the 3.20 m shut radius, so standing there cannot cycle the door.

`HALL-MIDWAY` is there for the **stage budget**, not for geometry. It is the exact midpoint
of the first lane, so it bends the route by nothing, but it splits the 8 m crossing into two
`goto` legs that each get their own `AGENT_MAX_NAV_STAGES`. At the measured ~31% of
commanded travel the default 12 stages buy about 7.5 m, which does not reach in one leg.

### Three things the schema cannot carry — read this before debugging a failed grasp

`parsePlaceGraph` is strict by **rebuilding a whitelisted object** (`place-resolver.ts:276-285`)
rather than by rejecting extra keys, so a field it does not know is not an error — it
*vanishes*. Nothing below is expressible, and inventing a key for any of it would be worse
than having none, because the robot would then fail for no visible reason.

1. **The arrival heading. There is nowhere to put it.** `PLACE_HEADINGS` declares 90° (world
   +y, `TABLE_APPROACH_YAW_DEG`) at `pause_room_door` and `table_front`, and every reach
   number in the *Where `table_front` comes from* section is computed at that heading. The
   `Place` interface has no heading field, and `navigateToPlaceInner` issues no final
   alignment turn — its last commanded turn is the heading of the last *path segment*, so a
   robot entering `TABLE-FRONT` from the door ends up facing into the room, not at the
   table. **The mission plan must append an explicit `turn` block after the `goto`**, or use
   a patrol checkpoint's `headingDeg` + `capture`, which is the only arrival-heading
   mechanism in the codebase. Section 18 asserts the headings are *absent*, so that nobody
   later "fixes" this by adding a key the loader eats.
2. **Arrival precision.** A resolved place is one goal *point* plus a containment test, with
   a 1.00 m tolerance against a 0.55 m `GRASP_REACH_BUDGET`. `TABLE-FRONT`'s goal is
   **0.340 m short** of the grasp spot, and up to **0.576 m** from the far corner of the
   arrival patch. The polygon cannot be shrunk to fix this — see the 0.30 m inradius floor
   above — so **the mission must append that walk explicitly** too.
3. **The door.** No field for a doorway, a clear opening, a leaf sweep, or an edge between
   places; despite the name it is a flat list of floor polygons with no adjacency. The
   1.40 m opening reaches the planner only through the live lidar occupancy map.

### Why there are no keepouts

The loader *does* consume `keepout` — and both consumers would break this mission:

* The **geofence** inflates every keepout by `DEFAULT_KEEPOUT_MARGIN_M = 0.5 m` and turns a
  breach into a `zone_violation` protective stop. `table_front` stands 0.16 m from the
  table's near face *by design*; fencing the table would stop the robot at the exact moment
  it arrived to grasp, and releasing the latch needs a further 0.25 m.
* The **path planner** gets the same polygons with the same 0.5 m margin plus a 0.40 m robot
  disc. Fencing the partitions would leave 1.40 − 2 × 0.5 = **0.40 m** of doorway against an
  0.80 m disc: `planPath` would answer `no-path` and the pre-walk check would refuse the
  approach. Fencing the walls *seals the door*.

Walls, columns, crates, the table and the door leaves reach the planner through the lidar
occupancy map instead, which is where the code expects to find them. `landmarks` is parsed
and read by nobody, so it is emitted empty.

### Making the robot see it

The file is inert until the robot agent is told about it. Two environment variables, neither
of which has a useful default:

```bash
# absolute, or relative to the robot-agent process cwd (config.ts:795 — EMPTY by default)
PLACE_GRAPH_PATH=hardware/sim_evaluator/places/places.factory_pauseroom.json
# navigateToPlace refuses outright without a planner (navigator.ts:382-387)
AGENT_NAV_PLANNER=grid
```

Leave `PLACE_TWIN_ID` unset: `PLACE_GRAPH_PATH` wins when both are set, and a `frame.twinId`
would make the frame *unregistered*, which yields zero goto-able places. `frame.kind` is the
literal `"sim"` for the same reason — anything else and `assessFrameRegistration` returns
`registered: false`, `knownPlaces()` returns `[]`, and `goto` fails with a registration
message rather than a missing-place one.

On a successful load the agent logs `Place graph loaded: 7 places (0 keepout) in frame
'factory-pauseroom-sim'`. On a *failed* load it logs `Place graph … could not be loaded —
place stays UNKNOWN` and **boots anyway**, with no `PlaceTracker`, no pose subscription and
`getPlaces()` empty — loud, but not fatal, so check for that line before blaming the walk.

Round-tripped through the real loader (`npx tsx`, not a re-implementation): the graph loads,
the frame registers `{"registered":true,"how":"identity"}`, all seven places are goto-able,
and `"table front"`, `"table_front"`, `"the Table Front"` all resolve to `TABLE-FRONT`.
`"pause room door"` resolves to `PAUSE-ROOM-DOOR-APPROACH` — the name is a superset of the
phrase, on purpose, so the natural words land on the safe standing spot instead of failing.

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
facing the door, and **the straight line from there to the door centre keeps 0.25 m of body
radius plus 0.10 m of daylight clear of every wall, partition, column, crate, table and
open door leaf, and 0.60 m clear of every USD prop**; the quaternion helpers produce the
orders they claim; both fixed cameras actually have line of sight.

Section 18 then leaves the Isaac scene entirely and checks the **robot software's** copy of
this geometry: that `places.factory_pauseroom.json` is byte-for-byte what
`make_factory_place_graph.py` emits from the layout, that its frame block is the one
`parsePlaceGraph` asserts (version 1, `kind: "sim"`, no `twinId`), that every `placeType`
and `source` is in the closed set **read out of `types.ts`** rather than remembered, that
every place has an inradius above the 0.30 m entry margin **read out of `navigator.ts`** so
arrival is geometrically possible, that no polygon overlaps a wall, crate, table, open door
leaf or USD prop, that every leg of the mission route is clear between the goals the
navigator will actually drive to, and that nothing in `PLACES` was silently forgotten. It
also asserts the two things the schema *cannot* carry — the 90° arrival headings and the
0.340 m residual to the grasp spot — so that neither can be closed by adding a key the
loader would eat.

> The route wording used to read "with a clear route", which the check did not establish.
> It modelled every obstacle as a circle of radius `max(width, depth)/2` — fine for a
> column, useless for a 24 m wall, whose circle swallows the whole hall — so **every wall
> and partition was excluded from it by name**, and nothing was ever tested against one.
> Moving the spawn to `(4.0, 6.0)`, whose straight line to the door runs clean through
> `pause_wall_west`, still reported zero failures. Walls now get an exact
> segment-versus-rectangle test and nothing is excluded; the circle model survives only for
> the USD props, whose footprints genuinely cannot be read offline. The tightest real
> clearance on the shipped route is **0.419 m**, at the *corner* of the left door jamb —
> the robot crosses the 1.40 m doorway diagonally at 44.5°, which narrows it to an
> effective 0.84 m.

Sections 12–17 are the newer half:

* **12 — reach.** Shoulder-to-apple and shoulder-to-plate distances from `table_front`, at
  *both* ends of the measured base-height band and at *every* corner of the apple's
  reset-jitter box, against `GRASP_REACH_BUDGET`; that the budget itself covers the two
  working reference scenes and stays inside the arm's geometric limit; that the feet clear
  the table box; that `table_front` is derived from the apple rather than typed; and that
  `pause_room_centre` is still *out* of reach, so nobody re-uses the waypoint as a
  standing spot. It also asks the two questions a scalar distance cannot: whether the
  target is in the **forward** half of the workspace at the declared arrival heading (a
  shoulder-to-object distance is a sphere, so setting `TABLE_APPROACH_YAW_DEG` to 0 and
  standing the robot side-on used to change nothing), and whether the standing spot and the
  doorway→table leg of the walk have room for the robot's own body.
* **13 — the door.** That the shut leaves cover the whole declared opening with no
  leaf-to-leaf gap and zero clear width; that the open leaves clear it completely, restore
  the full 1.40 m, and park over their own partitions rather than sticking out as new
  obstacles; that the leaves span the walking envelope and fit under the lintel; that the
  joint limits are one half-opening each with 0 = shut and that openness 1 drives them in
  *opposite* directions; that out-of-range openness clamps; that the presence sensor has
  hysteresis and holds state between its radii; that the leaves finish opening before the
  robot arrives at the measured walk speed; that the rate limiter converges in the time it
  claims; and — by interval arithmetic over the room's whole south side, which section 6's
  sampled sweep structurally cannot see — that the shut door seals the room and the open
  door re-opens exactly one 1.40 m gap. Two of its bounds are two-sided rather than
  one-sided: the leaves must hang *flush* on the partition (0–50 mm), not merely outside
  it, because moving `DOOR_ORIGIN` 0.6 m into the room parks two 25 kg panels in mid air
  across the walk-through and used to pass; and the "leaves open before the robot arrives"
  check now names its reference point — trigger radius to the **near edge** of the opening,
  16.4 s at the measured 0.11 m/s, rather than the 22.7 s to the door centre that the
  layout module quotes. The edge is the binding one.
* **14 — the door USD.** That the checked-in `pause_room_door.usda` is byte-for-byte what
  `make_pause_room_door_usda.py` generates from the layout module (the anti-drift check:
  the USD is opaque to every other test here, so this is the only thing that would notice a
  door that stopped fitting its doorway), that it is authored in metres, has no URL,
  reference or payload, and declares the articulation root, the fixed root joint, both
  named prismatic joints, a drive API and a collider on every part.
* **15 — no two bodies occupy the same space.** Every check before this one measured a
  scene object against the *robot*; nothing measured a scene object against another scene
  object. Declared boxes (walls, columns, crates, table, door leaves, rail) get an exact
  axis-aligned overlap test at **both** ends of the door's travel and are allowed to touch,
  since abutting geometry is how a room is built; only wall-against-wall pairs are exempt,
  because partitions meeting at a corner really do share a 0.20 × 0.20 m column of space.
  USD props keep a stated-assumption clearance from everything.
* **16 — the robot constants the reach check depends on.** Section 12's verdict is only as
  good as `SHOULDER_ABOVE_PELVIS`, `ARM_REACH_TO_KNUCKLE`, `ARM_REACH_TO_FINGERTIP` and
  `FOOT_FRONT_REACH`, and all four were hand-typed literals justified by comments. This
  re-derives them from the MuJoCo twin `../sim_evaluator/mjcf/g1_dex3/g1_43dof_fixedbase.xml`
  by walking the kinematic chain with real rigid transforms. Setting `FOOT_FRONT_REACH` to
  0.01 or `ARM_REACH_TO_KNUCKLE` to 0.20 used to leave every check in the file passing.
* **17 — the door driver is wired into the task.** The verifier's whole relationship to
  `mdp/pause_door.py` was one `os.path.isfile`, so a syntax error in it passed everything.
  The driver cannot be *imported* offline (it needs `torch` and the checkout's
  `tasks.common_scene`), so it is read with `ast`: that all five `mdp/` modules parse, that
  `pause_door_state` / `set_pause_door` / `OBS_DIM` are still defined, that `mdp/__init__.py`
  still re-exports them, that the env cfg still declares the `door` observation group, that
  all three manual overrides are still registered — and that the door term is still **out**
  of `PolicyCfg`, which is the DDS contract the rest of the stack reads.

Current result: **193 passed, 0 failed, 0 skipped** (76 before section 12, 142 before
sections 15–17).

It has caught six real defects, all of which would have been invisible until a launch —
or worse, until a scoring run:

1. the `±0.05 / ±0.04` reset-jitter box copied from the `move_cylinder` task put the apple's
   worst corner **0.132 m** from the plate centre, against **0.135 m** of touching — so the
   apple would occasionally spawn already on its goal. `APPLE_RESET_JITTER` is now `±0.03`,
   worst corner 0.154 m;
2. a prim-path audit that only looked at string literals missed `/World/GroundPlane`,
   because it is passed as a named constant;
3. **`table_front` was 0.4 m out of the robot's reach** (see above). This is the defect
   section 12 exists for, and it is worth being blunt about *how* it survived: section 11
   did have a check on `table_front`, and that check asked for **more** than 0.4 m of
   standing room in front of the table. It passed on 0.65 m. It was measuring the right
   quantity in the wrong direction — standing further back is not safer, it is the bug.
   That check is now an equality against the declared standoff, plus section 12;
4. the door's first `PhysicsJointStateAPI:linear` did not survive a round-trip through USD
   25.11 (the prim came back with only `PhysicsDriveAPI:linear` applied), which would have
   shipped an unrecognised schema in a generated file. Dropped — the shut state is already
   set by the leaf transforms and `init_state.joint_pos`;
5. **a crate was touching `packing_table_a`.** The crate at `(-10.5, -6.0)` had its near
   face at x = −10.00 and the prop's origin is at x = −9.00 — *exactly* 1.00 m, against the
   1.00 m half-extent this verifier charges every prop whose USD footprint it cannot read.
   By the scene's own model the two bodies were in contact. Both are static, so nothing
   would have exploded; it would simply have rendered as a crate growing out of a packing
   table. The crate moved one row pitch north to `(-10.5, -3.2)`, keeping the row's x, its
   1.4 m pitch and its 0.4 m crate-to-crate gap, and putting 2.97 m between the two. The
   model was **not** loosened to make it pass;
6. **`FOOT_FRONT_REACH`'s derivation was wrong by 53 mm** — see the ⚠ under *Where
   `table_front` comes from*. The number survived; its margin did not.

---

## Design decisions that are not obvious

### The door is powered, sliding, and generated

The doorway used to be a 1.40 m hole between two wall boxes. There is now a door in it.

**Powered and automatic, not a handle.** Making a humanoid operate a door handle is a
contact-rich bimanual manipulation problem in its own right, and nothing in this stack has
a policy for it — requiring it would have sunk the demo on a research problem nobody asked
for. A real factory pause room solves this with a presence sensor, precisely so that people
carrying things do not have to stop. So does this one: the door opens when the robot comes
within 2.5 m of the doorway and shuts again beyond 3.2 m. **The robot never touches it.**

**Sliding, not hinged.** A hinged leaf sweeps an arc through the space directly in front of
the doorway — exactly where a 1.32 m humanoid is standing when the door decides to open.
Sliding leaves retract along the wall and never occupy any space the robot walks through.
The verifier checks that an open leaf parks entirely over its own partition, so it never
becomes a new obstacle either.

**It is real, and it really collides.** Two rigid bodies, 0.72 × 0.06 × 2.16 m, 25 kg each,
with box colliders, on prismatic joints, spanning `z ∈ [0.02, 2.18]`. Shut, they cover
`x ∈ [9.28, 10.72]` — 20 mm past each jamb, and butting exactly at x = 10.00, so there is no
seam gap. A robot that walks into a shut door hits it. Nothing is hidden, scaled away or
teleported. Open, each leaf has slid 0.70 m and the full 1.40 m clear width is back.

**Why the geometry is a generated USD.** Isaac Lab cannot build an articulation out of
primitive spawn cfgs — a door with joints has to come from a file. There is no door USD
anywhere on this machine (the checkout ships a cabinet, a drawer and two warehouses;
`{ISAAC_NUCLEUS_DIR}/…` is an HTTPS fetch), so this repo authors its own. But a hand-written
USD would be the one place in this directory where geometry is *typed* rather than derived,
and therefore the one place where changing `DOOR["width"]` silently stops matching the hole
in the wall. So `make_pause_room_door_usda.py` **generates** `pause_room_door.usda` from the
same constants that cut the hole, and the verifier re-runs the generator and compares
byte-for-byte. It is USDA (text, ~6.8 kB) rather than USDC so it diffs and reviews, and it
is three `UsdGeom.Cube` prims — writing it needs neither `pxr` nor Isaac.

To regenerate after moving a wall:

```bash
python3 common_scene/make_pause_room_door_usda.py           # rewrite it
python3 common_scene/make_pause_room_door_usda.py --check   # exit 1 if stale
```

Its structure copies `assets/objects/drawers/cabinet_collider.usd` — articulation root on
the parent Xform, a `rootJoint` fixed joint pinning the base link, each moving part hanging
off a joint declared under its parent link — because that is the one articulated prop this
checkout is known to import successfully. The joint names `door_left_joint` /
`door_right_joint` are the same names it uses, so
`base_scene_pick_redblock_into_drawer.py:87-125`, the only prior art here for driving a
door, reads across unchanged. It is authored `metersPerUnit = 1`; the cabinet is `0.01`, and
a scale mismatch is invisible until it renders.

**Why the driver is an observation term.** A `*Wholebody*` task never calls `env.step()`
(`sim_main.py:476-479` forces `use_rl_action_mode = True`, and
`robot_control_system.py:120-127` then skips the step) — which is the same reason this
task's reward manager is dead code. So a reward term, a termination term or an
`EventTermCfg` would never fire and the door would never move. What *does* run every control
step is `env.observation_manager.compute()`, called unconditionally by the wholebody DDS
provider at `action_provider_wh_dds.py:728`. That is the only per-step hook reachable from
inside this task package without patching the vendor's action provider, so the door driver
lives in `mdp/pause_door.py` as an observation term in its **own** group, `door` — never
appended to `policy`, which is the DDS contract the rest of the stack reads.

Two consequences: the target written each step is picked up by the *next* step's
`scene.write_data_to_sim()`, so the door lags the sensor by ~20 ms (against a 1.17 s stroke,
nothing); and the term both drives the door and **returns its state** — a 6-column row:
both leaves' **measured** joint coordinates read back from `door.data.joint_pos` (columns
0–1), the openness those measured positions imply and the resulting clear width (columns
2–3), the robot-to-doorway distance (column 4), and the **commanded** openness (column 5).
Commanded and measured are reported side by side on purpose: the target written on one step
is not applied until the next `scene.write_data_to_sim()`, so the two columns differ by the
drive lag, and a leaf that jams or is shoved shows up as a gap between them. A scoring run
can therefore ask "did the robot get through a door that was *actually* open?" rather than
"did the robot get through", and can tell a slow door from a stuck one. The door also
appears in the `env.scene.get_state()` payload that `sim_main.py` publishes over DDS every
loop, for free.

> `OBS_DIM` was 5 until the driver started measuring rather than reporting its own command;
> the commanded value moved to the new column 5 so the lag stays visible. `OBS_DIM` is
> declared once, in `mdp/pause_door.py`, and no consumer hardcodes a width — the env cfg's
> `ObsTerm(func=mdp.pause_door_state)` reads whatever the driver returns. Section 17 of the
> verifier asserts the declaration still exists.

`open_pause_door` / `close_pause_door` / `auto_pause_door` are registered on the
`SimpleEventManager` as manual overrides, for an evaluation that wants to pin the door —
e.g. to test the robot arriving at a shut one. Nothing triggers them today. Section 17 of
the offline verifier asserts all three are still registered, because the env cfg names them
as strings and a rename is silent.

> ⚠ **`close_pause_door` is the one path that can shut the door on the robot.** It drives
> the leaves shut regardless of where the robot is, overriding the presence sensor — that
> is what it is *for*, and it is bounded by `max_force = 200 N` per leaf, so the worst case
> is a shove rather than a crush. It is still the only override that can put moving
> geometry into a space the robot is occupying, and no test has been run with a robot
> standing in the doorway when it fires.

Deliberately **not** done: making the leaves `kinematic_enabled=True` rigid bodies driven by
root-pose writes. That would move and render identically and be simpler, but a kinematic
body ignores contact — it would push the robot through a wall rather than stop it — and the
open/close state would not be a joint coordinate anything could observe or score.

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

## Verified on the live sim (2026-08-29)

Launched for real, headless in the Docker root workaround, on the RTX 5090:

    --task Isaac-Factory-PauseRoom-G129-Dex3-Wholebody
    --enable_dex3_dds --enable_wholebody_dds --robot_type g129
    --device cuda --headless --enable_cameras

**It builds and runs.** The things the offline checker explicitly could not prove:

| Claim | Result |
|---|---|
| The cfg instantiates at all | yes — no `configclass` or field errors |
| Robot spawns at the designed pose | `step=0 xy=(+4.0000,-2.0000) yaw=+0.7854` — exact, 45.00° |
| It stands rather than falling through the floor | `step=50 base_z=+0.78979 foot_fz=[191.6, 191.0] contact_t=[1.125, 1.125]` — both feet evenly loaded on the local floor box |
| Cameras render | `RTX streaming completed in 0.08 s` |
| `--device cuda` works for this scene | yes (every prior NeoDEM run of the sibling task used `--device cpu`) |

**Two findings that matter more than the scene itself.**

*The 8.4 m walk to the door does not arrive.* Commanding `vx=0.3` for 25 s moved
the base from `(3.97, -1.90)` to `(6.39, -0.68)` — 2.7 m of travel, ~0.11 m/s
against 0.3 commanded — while the heading drifted from `+0.7854` rad (45°, aimed
at the door) to `-0.31` rad (−18°). That is roughly 2°/s of unbidden yaw, and it
is the TASK-203 defect that the closed-loop `turn` fix deliberately does NOT
address: `walk` measures distance travelled and never measures heading. A `goto`
across this hall will end up somewhere other than the door, and no amount of
turning accuracy fixes it.

*After the command stops the policy settles into a one-legged crouch* —
`base_z` 0.79 → 0.725, knees at 1.15/0.91 rad, left foot airborne for 9 s with
all load on the right. Upright (`proj_grav ≈ (0, 0, −1)`, roll and pitch under
0.03) and stable, but not a clean stand, and not a pose to begin a manipulation
from.

Neither is a defect in this scene — both reproduce whatever the robot is asked
to do — but together they say the scene is ready before the locomotion is.

**Still unverified:** wall collision. The walk never reached a wall, so the
`CuboidCfg` + `collision_props` + no `rigid_props` question in the section below
is still open. Drive the base into a partition before trusting the geometry to
contain anything.

> ⚠ **That run predates the door and the new standing spot.** It was launched against
> `table_front = (10.00, 5.35)` and a doorway with nothing in it. The two measurements it
> produced that this scene now depends on — `base_z` 0.790 standing and 0.725 in the
> settled crouch, which are what `BASE_HEIGHT_BAND` and therefore the whole reach check are
> pinned to — are still valid, because neither the door nor the standing spot changes how
> the policy holds the base. Everything else about the door and the new spot is unverified;
> see the list below.

## Stills

`capture_factory_stills.py` renders every camera the scene registers, plus any
number of ad-hoc framings, with no DDS and no robot control:

    python capture_factory_stills.py --out ~/shots --headless --enable_cameras \
      --light-scale 0.35 --shot-camera film_camera \
      --shot "hall_overview:-7,-15,9.5:3,1,1.2" \
      --shot "apple_and_plate:9.85,5.75,1.05:10.25,6.21,0.78"

`--shot NAME:EYE:TARGET` re-aims an existing camera rather than spawning one —
sensors cannot be added after the scene is built — so any viewpoint is reachable
without touching the scene cfg.

Three traps, each of which cost a launch:

1. **`PROJECT_ROOT` must be set before `tasks` is imported.** Every scene module
   in the checkout resolves its USD props against it, and `sim_main.py:7-8` is the
   only thing that sets it. Without it you get
   `None/assets/objects/PackingTable/PackingTable.usd` and a `FileNotFoundError`
   that reads like a missing asset rather than a missing env var. This tool sets
   it itself.
2. **Write the output somewhere under the Docker bind mount.** With `--rm` and an
   `--out` outside `/home/humanoid`, the run reports "wrote 7 image(s)" and the
   files die with the container.
3. **`--light-scale`.** The scene is lit for a roofless hall of white surfaces and
   renders blown out at 1.0 — the columns, the table and the walls all read as the
   same white. 0.35 restores the shadows. This is a *rendering* preference and
   changes no physics, so it is a flag rather than a scene edit.

`isaacsim.core.utils.stage` does not exist in the Isaac Lab 3.0 this checkout
pins; the tool reaches the stage through `omni.usd` instead.

## Assumptions that could not be verified without launching

**This list is no longer entirely unverified, and the header that said so was wrong.** It
used to read "Nothing here has been observed — this agent never launched Isaac", seventy
lines below a section titled *Verified on the live sim (2026-08-29)* reporting that the
scene builds and runs. Both could not be true. The live run settled items 1 and 10 below
and turned item 4 from an open question into a **measured negative**; everything still
numbered here is genuinely open, and the three resolved entries are struck rather than
deleted so the record of what was once unknown survives.

~~1. **That the scene builds at all.**~~ **RESOLVED — it builds and runs.** See *Verified
   on the live sim* above: the cfg instantiates with no `configclass` or field errors, the
   robot spawns at exactly `(4.0000, -2.0000)` yaw 45.00°, stands with both feet evenly
   loaded at `base_z = +0.78979`, and the cameras render. What that run did **not** cover
   is the door, which did not exist yet — see item 7.
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
4. ~~**That the G1 can actually walk 8.4 m across this hall.**~~ **MEASURED, AND IT DOES
   NOT.** This is not an open assumption any more; it is a known negative, written up in
   full under *Two findings that matter more than the scene itself* above. Commanding
   `vx = 0.3` for 25 s moved the base 2.7 m of the required 8.4 — about 0.11 m/s against
   0.3 commanded — while the heading drifted from +45° to −18°, roughly 2°/s of unbidden
   yaw. **A `goto` across this hall ends up somewhere other than the door.** The route is
   geometrically clear (tightest real clearance 0.419 m at the door jamb corner, 3.61 m to
   the nearest USD prop), so the geometry is not what is stopping it: the gait comes from the
   wholebody DDS provider and a policy that lives outside this scene, and it is the
   TASK-203 defect that the closed-loop `turn` fix deliberately does not address. What
   remains genuinely unverified here is only the *fix*: whether anything downstream can put
   the robot on `table_front` to the tolerance section 12 assumes.
5. **That the robot fits through the door in practice.** 1.40 m of clear width against a
   ~0.45 m shoulder span is generous, but the G1 sways, and the wholebody controller's
   lateral tracking error under a commanded turn has not been measured in this scene.
6. **That the apple is reachable from `table_front` IN PRACTICE.** ~~`table_front` at
   `(10.00, 5.35)` is a guess~~ — that guess was wrong by 0.4 m and is now fixed: the spot
   is derived, and the shoulder-to-apple distance is 0.476–0.537 m against a budget of
   0.55 m, inside both working reference scenes' envelopes. **What is still unverified is
   everything the arithmetic cannot see:**
   * whether the Dex3 can actually close on the apple from that pose, which is an IK and
     policy question, not a distance question. The geometry says the apple is inside the
     arm's envelope; it does not say there is a collision-free arm configuration that gets
     a hand around it with the table 0.16 m away;
   * whether a G1 that *walked* here stops within a useful tolerance of `(10.24, 5.84)`.
     The measured walk is ~0.11 m/s with ~2°/s of unbidden yaw drift over 8.4 m (below), so
     the arrival error is likely larger than the 0.013 m of reach margin at the worst
     jitter corner. **This scene assumes something else puts the robot on the spot.**
   * whether 0.16 m of standoff is enough in the real stance. `FOOT_FRONT_REACH = 0.13 m`
     is derived from four 5 mm contact spheres in the MJCF, not from the Isaac G1's actual
     foot collider, which is a mesh and is longer. If the toes clip the table box, raise
     `TABLE_STANDOFF` — and expect the worst jitter corner to go over budget when you do
     (0.20 m puts it at 0.571 m), which means moving the apple, not the robot.
7. **Everything about the door except its geometry.** The leaf positions, travel, limits,
   clear widths, sensor radii and timings are all checked offline and all pass. None of the
   following is:
   * **that the articulation imports at all.** `pause_room_door.usda` is generated, and
     section 14 of the offline verifier proves it is byte-for-byte what the generator emits
     from the layout module and that it declares the articulation root, the fixed root
     joint, both named prismatic joints, a drive API and a collider on every part — but
     that is `ast`- and text-level evidence about a file, not evidence that Isaac Lab
     imports it. A rejected schema, a joint PhysX declines to build, or an articulation root
     Isaac Lab does not find would all survive it. An earlier draft of this list claimed the
     stage had also been "opened and structurally validated with `pxr` 25.11 on CPU"; **no
     such check is committed anywhere in this repo**, so treat that as not having happened;
   * **that a second articulation survives `replicate_physics=True`.** `num_envs = 1` makes
     the cloning trivial, but the robot was previously the only articulation in the scene;
   * **that the `ImplicitActuatorCfg` gains hold a leaf.** 800 N/m and 120 N·s/m against a
     25 kg leaf with a 200 N force cap are guesses shaped like reasonable numbers. Too soft
     and a nudge parks the door half open; too stiff and a contact explodes;
   * **that the driver runs.** `mdp/pause_door.py` is exercised by a committed harness,
     `tests/test_pause_door.py` — 11 cases, standard library only, no GPU, no Isaac Lab and
     no torch; it runs standalone (`python3 tests/test_pause_door.py`) and under pytest.
     It covers the sensor, the hysteresis, the rate limiter, joint resolution *by name*
     against deliberately reversed joint ordering, the observation row's shape and its
     measured-versus-commanded columns, the manual overrides and the fail-safe path.
     **It is not wired into `scripts/test-all.sh`** — run it yourself; nothing runs it in
     CI today. What is unverified is the premise the harness cannot test: that
     `env.observation_manager.compute()` really is called every control step in a wholebody
     run. That is read out of `action_provider_wh_dds.py:728`, not observed. **If it turns
     out not to run, the door never opens and the robot walks into it** — which is at least
     an obvious failure rather than a silent one, since the door is authored shut;
   * **what `close_pause_door` does to a robot standing in the doorway.** It shuts the
     leaves regardless of the robot's position, at up to 200 N per leaf. Bounded, and
     intentional, but never exercised against an occupied doorway — in sim or offline;
   * **that a second observation group is harmless.** The `door` group is additive and
     nothing reads it, but no wholebody run has been made with more than one group;
   * **that the leaves do not fight the floor or the lintel.** There is a 20 mm gap at each
     end, which is a design choice, not a measurement;
   * **whether the door looks right.** `capture_factory_stills.py` never calls
     `observation_manager.compute()`, so the door renders **shut** in every still — that is
     the correct authored state, and it is also the only state anyone has seen.
8. **The USD props' real footprints.** They are placed by their origins, and their bounding
   boxes are not readable offline, so the verifier charges each a generous 1.0 m half-extent
   for the route check. If `yellowbox_table_b` at `(5.00, -6.50)` turns out to be huge, it
   is the one nearest anything that matters.
9. **Lighting.** A dome at 3000 plus a distant light at 1200 into a roofless hall is a
   guess. The scene lost the warehouse USD's eight ceiling RectLights along with the
   warehouse; the hall may render darker than the `move_cylinder` scene does.
10. **Both fixed cameras' framing.** The sight-lines are proven clear of walls, and the
   look-at orientations are proven correct, but focal length 12 mm / aperture 27 (hall) and
   14 mm / 24 (pause room) are unframed guesses.
~~11. **`--device cuda`.**~~ **RESOLVED — it works for this scene.** The live run above
    was launched with `--device cuda` and the cameras rendered (`RTX streaming completed in
    0.08 s`). The observation that every *prior* recorded NeoDEM run of the sibling
    wholebody task used `--device cpu` is still true and is why this was ever in doubt;
    `cpu` remains the known-good fallback. Note the PhysX aggregate-pair capacities are
    inherited from the sibling cfg, not tuned for this scene's much larger collider count —
    see *Running it*.
12. **The reward is unreachable in this task, as in every `*Wholebody*` task.**
    `sim_main.py:476-479` forces `use_rl_action_mode = True` for any id containing
    "Wholebody", and `robot_control_system.py:120-127` then never calls `env.step()`, which
    is what runs the reward manager. `mdp/rewards.py` exists for structural parity and to be
    live the moment that is fixed; it is not scoring anything today. See
    `../isaac_sim_patches/README.md:445-478`.
13. **Ray-casting sensors will not see the walls.** These are `CuboidCfg`, i.e.
    `UsdGeom.Cube` prims. A mesh-based ray cast such as `isaac_capture.py`'s
    `WarehouseRaycaster` collects `prim.IsA(UsdGeom.Mesh)` and would report the hall as
    empty — the robot walks through a wall the camera can see. `sim_main.py` does not
    ray-cast, so this is fine as shipped; the fix, if a raycasting sensor is ever pointed at
    this scene, is to swap `CuboidCfg` → `MeshCuboidCfg` in `_static_box`.
14. **`num_envs = 1` only.** With more envs the `/World/envs` content is cloned and offset
    while the floor, lights and fixed cameras are not, so env 1 would get walls standing on
    nothing. The DDS bridge is single-robot anyway.
