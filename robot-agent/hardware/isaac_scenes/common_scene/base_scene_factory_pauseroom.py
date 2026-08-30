# NeoDEM. Apache License, Version 2.0 (same terms as the surrounding Unitree checkout).
"""Scene for `Isaac-Factory-PauseRoom-G129-Dex3-Wholebody`.

A large factory hall (24 x 16 m of clear floor) that the G1 can walk around, with a
separate walled 4 x 4 m "pause room" off its north-east corner. The pause room holds a
table, a red apple and a white plate -- the Isaac twin of
`robot-agent/hardware/sim_evaluator/mjcf/g1_apple_pnp_scene.xml`.

The point of the scene is the JOIN of the two halves: Agent Mode can be told "go to the
pause room and pick up the apple", which is a locomotion problem followed by a manipulation
problem, in one stage, with one robot.

EVERY ASSET IS LOCAL
--------------------
There is no apple, plate or factory-building USD on this machine and no local Nucleus
server, and `{ISAAC_NUCLEUS_DIR}/...` is an HTTPS path into S3
(`IsaacLab30/apps/isaaclab.python.kit:310`), fetched on first use. So the hall, the
partitions, the columns, the crates, the table, the plate and the apple are all primitive
spawn cfgs, and the only USDs referenced are the five that already ship inside this
checkout and are already spawned by other scenes. Nothing here touches the network.

That includes the floor: `GroundPlaneCfg()` is NOT used, because its default `usd_path` is
a nucleus URL. See `factory_pauseroom_layout.py` for the full argument.

WHERE THE NUMBERS LIVE
----------------------
In `factory_pauseroom_layout.py`, which imports nothing but `math` and `os` and is therefore
readable by `verify_factory_scene_offline.py` on a machine with no GPU and no Isaac. This
module is the (thin) translation of those numbers into Isaac Lab cfgs. If you want to move
a wall, move it there.

QUATERNIONS ARE (x, y, z, w)
----------------------------
Isaac Lab 3.0 order. Identity is `(0, 0, 0, 1)`. Every `rot=` below is XYZW and says so.
The single exception is the robot's `init_rot` in the env cfg, which `G1RobotPresets`
takes as (w, x, y, z) and reorders itself.
"""

import os

import isaaclab.sim as sim_utils
from isaaclab.actuators import ImplicitActuatorCfg
from isaaclab.assets import ArticulationCfg, AssetBaseCfg, RigidObjectCfg
from isaaclab.scene import InteractiveSceneCfg
from isaaclab.sim.spawners.from_files.from_files_cfg import UsdFileCfg
from isaaclab.utils import configclass

from tasks.common_config import CameraBaseCfg  # isort: skip
from tasks.common_scene.factory_pauseroom_layout import (
    APPLE,
    COLUMNS,
    CRATES,
    DISTANT_COLOUR,
    DOME_COLOUR,
    DOOR_DRIVE,
    DOOR_JOINTS,
    DOOR_ORIGIN,
    DOOR_USD_FILENAME,
    GROUND,
    GROUND_PRIM_PATH,
    IDENTITY_XYZW,
    PAUSE_ROOM_CAMERA,
    PLATE,
    TABLE,
    USD_PROPS,
    WALLS,
    WORLD_CAMERA,
    distant_intensity,
    dome_intensity,
    door_joint_targets,
    look_at_quat_xyzw_ros,
)

# `sim_main.py:8-9` sets PROJECT_ROOT to the checkout root before anything imports this.
project_root = os.environ.get("PROJECT_ROOT")

# The door's USD ships NEXT TO THIS MODULE and is resolved from this module's own
# directory, NOT from PROJECT_ROOT. Installed, that is `tasks/common_scene/`; in this repo
# it is `isaac_scenes/common_scene/`. Doing it this way means the door needs no env var, no
# `assets/` install step and, above all, no nucleus path -- the whole scene still loads
# with the network unplugged.
_HERE = os.path.dirname(os.path.abspath(__file__))
door_usd_path = os.path.join(_HERE, DOOR_USD_FILENAME)

# --- palette -----------------------------------------------------------------------------
_GROUND = (0.34, 0.34, 0.35)     # factory floor
_CONCRETE = (0.62, 0.62, 0.60)   # perimeter walls
_PARTITION = (0.80, 0.79, 0.75)  # pause-room partitions, lighter so the room reads apart
_STEEL = (0.42, 0.44, 0.48)      # columns
_CRATE = (0.55, 0.42, 0.26)      # plywood crates
_TABLETOP = (0.141, 0.143, 0.149)  # the MJCF cloth the camera actually sees -- see below

# WHY `_TABLETOP` IS 0.141 AND NOT THE 0.30 THE MJCF ALSO CONTAINS.
# This was (0.30, 0.30, 0.31), copied from `g1_apple_pnp_scene.xml`'s
# `<material name="tablecloth" rgba="0.30 0.30 0.31 1">` on the belief that it was the
# training scene's tabletop. It is not. The comment two lines above that material, at
# `g1_apple_pnp_scene.xml:49-50`, says what it is:
#
#     <!-- Physics table faces (almost fully hidden under the visual cloth
#          plane): plain velvet grey matching the texture mean. -->
#
# `tablecloth` is the COLLISION box's material. The surface in every training frame is the
# visual plane 0.5 mm above it, wearing `cloth_real`: `textures/cloth.png` (1024x1024,
# measured mean RGB (0.29371, 0.29689, 0.30508)) tinted by rgba (0.48, 0.48, 0.49). The
# tint is not decoration -- the MJCF says so itself at line 54: "rgba < 1 compensates the
# scene lighting gain". Effective albedo (0.141, 0.143, 0.149), Rec.709 luminance 0.1427
# against the 0.3007 that was authored here: the Isaac table was painted 2.11x too light.
#
# THIS IS A PALETTE CORRECTION, NOT EXPOSURE COMPENSATION. It moves the constant onto the
# surface the policy was trained on, and it would be the right value at any light level.
# The lighting cut below is a separate, separately-derived number, and the two multiply:
# 2.11x of albedo x 3.95x of light = the 8.3x by which this scene's tabletop out-renders
# the training scene's. Section 19 of the offline verifier pins this constant against
# `cloth_real` (rgba parsed from the MJCF, texture mean cited with the texture's sha256),
# and deliberately does NOT pin it against `tablecloth`, which is invisible.
#
# The apple and the cloth are TEXTURED in the MJCF and flat here; no diffuse triple
# reproduces spatial variance, so that gap is accepted and unfixable by any colour edit.
#
# Everything else in this palette is unmeasured scene dressing -- there is no MuJoCo
# counterpart for a 26 x 18 m factory floor -- but it is all in the ego frame, so section 19
# pins every constant here as well. Not because the values are right: because the exposure
# below was calibrated against a render made with exactly these, and a repaint is a silent
# way to move the brightness the calibration is supposed to control.


def _static_box(prim_path: str, box: dict, colour: tuple, friction: float = 0.9) -> AssetBaseCfg:
    """A fixed, collidable, axis-aligned box: wall, column, crate or table.

    No `rigid_props`. A shape spawned with collision properties and NO rigid body is a
    STATIC COLLIDER -- that is the documented third mode of the shape spawners
    (`IsaacLab30/.../sim/spawners/shapes/__init__.py`: "a visual mesh (no physics) / a
    static collider (no rigid body) / a rigid body"). It is both cheaper and more
    immovable than the `kinematic_enabled=True` rigid body upstream puts on its
    PackingTables, and it cannot be woken by a contact.

    ⚠ These are `CuboidCfg`, i.e. `UsdGeom.Cube` prims, not meshes. A MESH-based ray cast
    such as `isaac_capture.py`'s `WarehouseRaycaster` (which collects `prim.IsA(UsdGeom.Mesh)`)
    will not see them -- the robot would walk through a wall the camera can see. This scene
    is authored for `sim_main.py`, which does not ray-cast, so `CuboidCfg` is correct here;
    if a raycasting sensor is ever pointed at this scene, swap these for `MeshCuboidCfg`.
    """
    return AssetBaseCfg(
        prim_path=prim_path,
        # rot is (x, y, z, w) -- Isaac Lab 3.0 order. All of this geometry is axis-aligned.
        init_state=AssetBaseCfg.InitialStateCfg(pos=tuple(box["pos"]), rot=IDENTITY_XYZW),
        spawn=sim_utils.CuboidCfg(
            size=tuple(box["size"]),
            collision_props=sim_utils.CollisionPropertiesCfg(collision_enabled=True),
            visual_material=sim_utils.PreviewSurfaceCfg(diffuse_color=colour, roughness=0.85),
            physics_material=sim_utils.RigidBodyMaterialCfg(
                friction_combine_mode="max",
                restitution_combine_mode="min",
                static_friction=friction,
                dynamic_friction=friction,
                restitution=0.0,
            ),
        ),
    )


def _usd_prop(prim_path: str, key: str) -> AssetBaseCfg:
    """One of the checkout's own prop USDs, kinematic so the robot cannot shove it.

    `kinematic_enabled=True` (rather than the static collider used for the primitives)
    mirrors `base_scene_pickplace_cylindercfg_wholebody.py:35-53`, which is where the three
    `PackingTable*` USDs are already known to load correctly under exactly this cfg.

    It is NOT prior art for `table_with_yellowbox.usd`. That asset has one call site in the
    whole checkout, `base_scene_pickplace_redblock.py:35-43`, and there the `rigid_props`
    line is COMMENTED OUT -- so the only configuration it is known to load under is the one
    with no rigid body at all. Applying kinematic rigid-body props to it here is an
    extrapolation, not a copy, and it is one of the things a launch would settle.
    """
    prop = USD_PROPS[key]
    return AssetBaseCfg(
        prim_path=prim_path,
        # rot is (x, y, z, w) -- Isaac Lab 3.0 order.
        init_state=AssetBaseCfg.InitialStateCfg(pos=tuple(prop["pos"]), rot=IDENTITY_XYZW),
        spawn=UsdFileCfg(
            usd_path=f"{project_root}/{prop['rel_path']}",
            rigid_props=sim_utils.RigidBodyPropertiesCfg(kinematic_enabled=True),
        ),
    )


def _overview_camera(prim_path: str, spec: dict, focal_length: float, aperture: float):
    """A fixed world camera aimed with a look-at rather than a hand-written quaternion."""
    return CameraBaseCfg.get_camera_config(
        prim_path=prim_path,
        pos_offset=tuple(spec["eye"]),
        # rot is (x, y, z, w) -- CameraCfg.OffsetCfg is XYZW too (camera_cfg.py:46-47) --
        # and it is interpreted in the ROS convention that get_camera_config hardcodes.
        rot_offset=look_at_quat_xyzw_ros(spec["eye"], spec["target"]),
        focal_length=focal_length,
        horizontal_aperture=aperture,
    )


@configclass
class FactoryPauseRoomSceneCfg(InteractiveSceneCfg):
    """Factory hall + walled pause room + apple/plate pick-and-place setup.

    WHAT GOES OUTSIDE /World/envs, AND WHY
    --------------------------------------
    The task sets `replicate_physics=True`, which clones everything under
    `/World/envs/env_.*` once per environment. Anything that must exist exactly once --
    the floor, the lights, the fixed world cameras -- therefore lives directly under
    `/World`. Getting this wrong is not a rendering nit: TASK-223 lost days to a scene
    whose only floor was inside the cloned env, so the G1 free-fell to -39 km while
    `projected_gravity` still read (0, 0, -1) and every "the policy cannot balance"
    hypothesis kept failing. See `base_scene_pickplace_cylindercfg_wholebody.py:78-96`.
    """

    # =====================================================================================
    # Floor. OUTSIDE /World/envs. Top face at exactly z = 0.
    # =====================================================================================
    ground = _static_box(GROUND_PRIM_PATH, GROUND, _GROUND, friction=1.0)

    # =====================================================================================
    # Factory perimeter, 4 m tall. Inner faces at x = +/-12, y = +/-8 -> 24 x 16 m of floor.
    # =====================================================================================
    wall_south = _static_box("/World/envs/env_.*/WallSouth", WALLS["wall_south"], _CONCRETE)
    wall_north = _static_box("/World/envs/env_.*/WallNorth", WALLS["wall_north"], _CONCRETE)
    wall_west = _static_box("/World/envs/env_.*/WallWest", WALLS["wall_west"], _CONCRETE)
    wall_east = _static_box("/World/envs/env_.*/WallEast", WALLS["wall_east"], _CONCRETE)

    # =====================================================================================
    # Pause-room partitions, 3 m tall. The room's north and east walls are the hall's own.
    # The doorway is the 1.40 m gap between the two south segments, centred on x = 10.0;
    # the lintel above it starts at z = 2.20, well clear of the ~1.32 m robot.
    # =====================================================================================
    pause_wall_west = _static_box(
        "/World/envs/env_.*/PauseWallWest", WALLS["pause_wall_west"], _PARTITION)
    pause_wall_south_left = _static_box(
        "/World/envs/env_.*/PauseWallSouthLeft", WALLS["pause_wall_south_left"], _PARTITION)
    pause_wall_south_right = _static_box(
        "/World/envs/env_.*/PauseWallSouthRight", WALLS["pause_wall_south_right"], _PARTITION)
    pause_door_lintel = _static_box(
        "/World/envs/env_.*/PauseDoorLintel", WALLS["pause_door_lintel"], _PARTITION)

    # =====================================================================================
    # THE DOOR. A powered, automatic, two-leaf sliding door in that 1.40 m gap.
    #
    # This is the only ARTICULATION in the scene other than the robot, and the only thing
    # loaded from a USD that this repo wrote. Both are forced: Isaac Lab cannot build an
    # articulation out of primitive spawn cfgs, so a door with joints has to come from a
    # file -- and there is no door USD anywhere on this machine (the checkout ships a
    # cabinet, a drawer and two warehouses; `{ISAAC_NUCLEUS_DIR}/...` is an HTTPS fetch).
    # `make_pause_room_door_usda.py` therefore GENERATES the file from the same layout
    # constants that cut the hole in the wall, and the offline verifier fails if the two
    # ever disagree.
    #
    # It is automatic because the alternative is worse. Making a humanoid work a door
    # handle is a contact-rich bimanual manipulation problem that nothing in this stack has
    # a policy for; a real factory pause room solves it with a presence sensor, and so does
    # this one. The robot walks up, the leaves retract, the robot walks through. It never
    # touches the door. See `mdp/pause_door.py` for the driver and
    # `factory_pauseroom_layout.py` for the sensor's radii.
    #
    # SHUT, THE LEAVES ARE REAL. They are two 0.72 x 0.06 x 2.16 m rigid bodies with box
    # colliders spanning x in [9.28, 10.72] -- 20 mm past each jamb -- so a robot that
    # walks into a shut door hits it. They are NOT hidden, scaled away or teleported.
    #
    # The structure (articulation root on the parent Xform, a `rootJoint` fixed joint
    # pinning the base link, one joint per moving part declared under its parent link)
    # copies `assets/objects/drawers/cabinet_collider.usd` and the way
    # `base_scene_pick_redblock_into_drawer.py:87-125` drives it, because that is the one
    # articulated prop this checkout is known to import successfully.
    # =====================================================================================
    pause_room_door = ArticulationCfg(
        prim_path="/World/envs/env_.*/PauseRoomDoor",
        spawn=sim_utils.UsdFileCfg(
            usd_path=door_usd_path,
            activate_contact_sensors=False,
            rigid_props=sim_utils.RigidBodyPropertiesCfg(
                disable_gravity=False,
                retain_accelerations=False,
            ),
        ),
        init_state=ArticulationCfg.InitialStateCfg(
            # rot is (x, y, z, w) -- Isaac Lab 3.0 order. The USD is authored in a frame
            # already aligned with the world, so the door needs no rotation at all.
            pos=tuple(DOOR_ORIGIN),
            rot=IDENTITY_XYZW,
            # Starts SHUT. An episode that begins with the door already open would never
            # exercise the thing this door exists to test.
            joint_pos=door_joint_targets(0.0),
        ),
        actuators={
            "leaves": ImplicitActuatorCfg(
                joint_names_expr=list(DOOR_JOINTS),
                effort_limit_sim=DOOR_DRIVE["max_force"],
                velocity_limit_sim=1.0,
                stiffness=DOOR_DRIVE["stiffness"],
                damping=DOOR_DRIVE["damping"],
            ),
        },
    )

    # =====================================================================================
    # Structural columns: two rows at y = +/-4 that break the hall into a central lane and
    # two side aisles, so "walk across the factory" is a route rather than a straight line
    # across an empty box. None at x >= 8 -- that is the pause room.
    # =====================================================================================
    column_00 = _static_box("/World/envs/env_.*/Column00", COLUMNS["column_00"], _STEEL)
    column_01 = _static_box("/World/envs/env_.*/Column01", COLUMNS["column_01"], _STEEL)
    column_02 = _static_box("/World/envs/env_.*/Column02", COLUMNS["column_02"], _STEEL)
    column_03 = _static_box("/World/envs/env_.*/Column03", COLUMNS["column_03"], _STEEL)
    column_04 = _static_box("/World/envs/env_.*/Column04", COLUMNS["column_04"], _STEEL)
    column_05 = _static_box("/World/envs/env_.*/Column05", COLUMNS["column_05"], _STEEL)
    column_06 = _static_box("/World/envs/env_.*/Column06", COLUMNS["column_06"], _STEEL)
    column_07 = _static_box("/World/envs/env_.*/Column07", COLUMNS["column_07"], _STEEL)

    # =====================================================================================
    # Palletised crates.
    # =====================================================================================
    crate_00 = _static_box("/World/envs/env_.*/Crate00", CRATES["crate_00"], _CRATE)
    crate_01 = _static_box("/World/envs/env_.*/Crate01", CRATES["crate_01"], _CRATE)
    crate_02 = _static_box("/World/envs/env_.*/Crate02", CRATES["crate_02"], _CRATE)
    crate_03 = _static_box("/World/envs/env_.*/Crate03", CRATES["crate_03"], _CRATE)
    crate_04 = _static_box("/World/envs/env_.*/Crate04", CRATES["crate_04"], _CRATE)
    crate_05 = _static_box("/World/envs/env_.*/Crate05", CRATES["crate_05"], _CRATE)

    # =====================================================================================
    # Dressing, from USDs that are on disk inside this checkout.
    # =====================================================================================
    packing_table_a = _usd_prop("/World/envs/env_.*/PackingTableA", "packing_table_a")
    packing_table_b = _usd_prop("/World/envs/env_.*/PackingTableB", "packing_table_b")
    packing_table_c = _usd_prop("/World/envs/env_.*/PackingTableC", "packing_table_c")
    yellowbox_table_a = _usd_prop("/World/envs/env_.*/YellowBoxTableA", "yellowbox_table_a")
    yellowbox_table_b = _usd_prop("/World/envs/env_.*/YellowBoxTableB", "yellowbox_table_b")

    # =====================================================================================
    # The pause room's work table. 1.22 x 1.20 x 0.75, top at z = 0.75 -- the MJCF's
    # half-extents (0.61, 0.60, 0.375) doubled. Its front (-y) edge faces the doorway.
    # =====================================================================================
    pause_table = _static_box("/World/envs/env_.*/PauseTable", TABLE, _TABLETOP, friction=0.8)

    # =====================================================================================
    # The white plate: the place TARGET, so it is static, not a manipuland. r = 0.095,
    # full height 0.02, centre z = 0.76 -> it rests on the 0.75 table top with its rim at
    # 0.77, exactly as in the MJCF.
    # =====================================================================================
    plate = AssetBaseCfg(
        prim_path="/World/envs/env_.*/Plate",
        # rot is (x, y, z, w) -- Isaac Lab 3.0 order.
        init_state=AssetBaseCfg.InitialStateCfg(pos=tuple(PLATE["pos"]), rot=IDENTITY_XYZW),
        spawn=sim_utils.CylinderCfg(
            radius=PLATE["radius"],
            height=PLATE["height"],
            axis="Z",
            collision_props=sim_utils.CollisionPropertiesCfg(collision_enabled=True),
            visual_material=sim_utils.PreviewSurfaceCfg(
                diffuse_color=PLATE["colour"], roughness=0.35),
            physics_material=sim_utils.RigidBodyMaterialCfg(
                friction_combine_mode="max",
                restitution_combine_mode="min",
                static_friction=0.8,
                dynamic_friction=0.8,
                restitution=0.0,
            ),
        ),
    )

    # =====================================================================================
    # The apple. NAMED `object` DELIBERATELY -- do not rename it.
    #
    # `SceneEntityCfg("object")` is hard-coded in the reward, the termination and the reset
    # event of every task in this checkout (e.g. base_reward_pickplace_cylindercfg.py:50,
    # base_termination_pick_place_cylinder.py:17, neodem_push_probe.py:103). An apple called
    # `apple` would make all of them raise at scene build.
    #
    # A SPHERE, not the MJCF's ellipsoid (0.04, 0.04, 0.036): Isaac Lab has no ellipsoid
    # spawner. The apple is therefore 4 mm taller and perfectly round. Radius and mass match.
    #
    # Friction 1.2 is carried over from the MJCF, where it is load-bearing twice over: it is
    # what lets a closed Dex3 hand hold the apple at all, and the low-friction version rolled
    # more than a metre off the table on any grazing contact. MuJoCo's rolling-friction term
    # (0.02, condim 6) has no direct PhysX equivalent, so an Isaac apple will roll further
    # than the MuJoCo one for the same nudge -- an accepted, unverified-until-launch
    # difference between the two sims.
    # =====================================================================================
    object = RigidObjectCfg(
        prim_path="/World/envs/env_.*/Object",
        # rot is (x, y, z, w) -- Isaac Lab 3.0 order.
        init_state=RigidObjectCfg.InitialStateCfg(pos=tuple(APPLE["pos"]), rot=IDENTITY_XYZW),
        spawn=sim_utils.SphereCfg(
            radius=APPLE["radius"],
            rigid_props=sim_utils.RigidBodyPropertiesCfg(
                disable_gravity=False,
                retain_accelerations=False,
            ),
            mass_props=sim_utils.MassPropertiesCfg(mass=APPLE["mass"]),
            collision_props=sim_utils.CollisionPropertiesCfg(
                collision_enabled=True,
                contact_offset=0.005,
                rest_offset=0.0,
            ),
            visual_material=sim_utils.PreviewSurfaceCfg(
                diffuse_color=APPLE["colour"], roughness=0.35, metallic=0.0),
            physics_material=sim_utils.RigidBodyMaterialCfg(
                friction_combine_mode="max",
                restitution_combine_mode="min",
                static_friction=APPLE["friction"],
                dynamic_friction=APPLE["friction"],
                restitution=APPLE["restitution"],
            ),
        ),
    )

    # =====================================================================================
    # Lights. OUTSIDE /World/envs. The hall has no roof, so the dome reaches the floor and
    # the interior of the (also roofless) pause room; there are no RectLights here because
    # the warehouse USD that used to supply them is deliberately not spawned.
    #
    # THE INTENSITIES WERE 3000 AND 1200 AND THEY PUT ~4x TOO MUCH LIGHT IN THE ROOM.
    # On the matched tabletop region -- one surface, in both scenes, and nothing else in
    # the rectangle -- the Isaac ego view renders 8.33x more light than the MuJoCo scene
    # the manipulation policy was trained on. 2.11x of that is the albedo bug fixed above;
    # the remaining 3.95x is this rig, and all three terms that light the room are divided
    # by it: dome 3000 -> 760, distant 1200 -> 304, and
    # `/rtx/sceneDb/ambientLightIntensity` 1.0 -> 0.253 in the env cfg's `__post_init__`.
    #
    # Uniform, because nothing offline can say how the room's light divides between those
    # three, and one factor applied to all of them is exact for any division while leaving
    # the shadow contrast where it is. `factory_pauseroom_layout.py` holds the measurement,
    # the derivation, what is still unknown, and the three environment variables that sweep
    # it; `measure_scene_exposure.py --roi` is what produced the measurement and what will
    # judge the fix. NONE OF THE NEW VALUES HAS BEEN RENDERED -- they are arithmetic.
    #
    # An earlier version of this comment sized the cut at 7.18x from WHOLE-FRAME medians
    # and asserted "the palette is NOT the problem". Both were wrong, and in the same way:
    # a median over a tabletop close-up and a median over a wide shot of a hall are not
    # measurements of the same thing. Do not re-derive anything here from a whole frame.
    #
    # `visible_in_primary_ray=False` is separate from the exposure cut and costs nothing:
    # both rooms are deliberately roofless, so the head camera sees the DomeLight itself
    # above the wall line as sky. Those are light-source pixels at full intensity, not lit
    # surfaces, and they are the most likely single explanation of the 65 % of hall-frame
    # pixels above 0.90. Turning them off changes the room's illumination by not one photon
    # (the dome still lights every surface); it removes only the sky the camera was staring
    # into -- and, because the calibration above is measured on a tabletop rectangle rather
    # than on whole frames, it does not disturb that calibration either.
    #
    # The two resolvers are called HERE, in the class body, so they run once at import --
    # the same timing as `robot_spawn()` in the env cfg, and for the same reason: a
    # launcher sets `NEODEM_DOME_INTENSITY` / `NEODEM_DISTANT_INTENSITY` before
    # `sim_main.py` imports the task. They RAISE on a malformed value rather than falling
    # back to the authored default, because a sweep whose typo'd value silently reverted
    # would report that the default was right.
    # =====================================================================================
    light = AssetBaseCfg(
        prim_path="/World/light",
        spawn=sim_utils.DomeLightCfg(
            color=DOME_COLOUR,
            intensity=dome_intensity(),
            visible_in_primary_ray=False,
        ),
    )
    sun = AssetBaseCfg(
        prim_path="/World/sun",
        # rot is (x, y, z, w). DistantLightCfg emits along the prim's -z, so this identity
        # orientation shines straight down; it exists to give the columns and the table a
        # readable shadow, which a dome light alone does not. It is cut by EXACTLY the same
        # factor as the dome (3000/760 = 1200/304 = 3.947), which keeps the directional
        # share of the room's light at the 33 % the ego view was measured with. An earlier
        # version cut it less, to "fix" a 6x flatness deficit read off whole-frame p90/p10;
        # on the matched tabletop region the two scenes' spreads are 1.23x and 1.29x and
        # there is no flatness deficit to fix.
        init_state=AssetBaseCfg.InitialStateCfg(pos=(0.0, 0.0, 9.0), rot=IDENTITY_XYZW),
        spawn=sim_utils.DistantLightCfg(
            color=DISTANT_COLOUR,
            intensity=distant_intensity(),
        ),
    )

    # =====================================================================================
    # Fixed world cameras. OUTSIDE /World/envs (same clone rule as the floor).
    # =====================================================================================
    # Establishing shot of the hall, from above the south wall looking north-east. The
    # sight-line crosses the 4 m south wall at z = 6.65, so it is not occluded.
    world_camera = _overview_camera(
        "/World/PerspectiveCamera", WORLD_CAMERA, focal_length=12.0, aperture=27.0)

    # The pause room shot, taken from INSIDE the room's south-west corner at 2.4 m. An
    # outside camera cannot cover both: any angle shallow enough to also show the factory
    # is occluded by the 3 m partitions.
    pause_room_camera = _overview_camera(
        "/World/PauseRoomCam", PAUSE_ROOM_CAMERA, focal_length=14.0, aperture=24.0)
