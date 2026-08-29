# NeoDEM. Apache License, Version 2.0 (same terms as the surrounding Unitree checkout).
"""Env cfg for `Isaac-Factory-PauseRoom-G129-Dex3-Wholebody`.

Structurally a copy of `move_cylinder_g1_29dof_dex3_hw_env_cfg.py`: the same managers, the
same `__post_init__`, the same event registrations. The differences are exactly four:

  1. the scene base class is `FactoryPauseRoomSceneCfg` instead of `TableCylinderSceneCfgWH`;
  2. the robot starts on the factory floor at (4.0, -2.0, 0.8) with a 45 deg yaw, facing
     the pause-room door 8.4 m away, rather than standing at a table;
  3. `reset_object_self` re-samples the apple over a smaller box (+/-0.03 m, from
     `APPLE_RESET_JITTER`) than the cylinder task used, because the plate is only 0.195 m
     away and the cylinder task's +/-0.05 / +/-0.04 would sometimes spawn the apple already
     touching it;
  4. there is a second observation group, `door`, which drives and reports the pause
     room's automatic sliding door. The `policy` group -- the wholebody DDS contract -- is
     untouched; see `DoorCfg` below and `mdp/pause_door.py` for why a door ends up being
     an observation.

Everything else is held identical on purpose -- the wholebody DDS path, the observation
shapes and the reward wiring are what the rest of the stack already talks to.
"""

import torch

import isaaclab.envs.mdp as base_mdp
from isaaclab.assets import ArticulationCfg
from isaaclab.envs import ManagerBasedRLEnvCfg
from isaaclab.managers import ObservationGroupCfg as ObsGroup
from isaaclab.managers import ObservationTermCfg as ObsTerm
from isaaclab.managers import RewardTermCfg as RewTerm
from isaaclab.managers import SceneEntityCfg
from isaaclab.sensors import ContactSensorCfg
from isaaclab.utils import configclass

from . import mdp

from tasks.common_config import CameraPresets, G1RobotPresets  # isort: skip
from tasks.common_config.camera_configs import CameraBaseCfg
from tasks.common_event.event_manager import SimpleEvent, SimpleEventManager

from tasks.common_scene import factory_pauseroom_layout as FPR_LAYOUT
from tasks.common_scene.base_scene_factory_pauseroom import FactoryPauseRoomSceneCfg
from tasks.common_scene.factory_pauseroom_layout import ROBOT, yaw_quat_wxyz

##
# Scene definition
##


@configclass
class ObjectTableSceneCfg(FactoryPauseRoomSceneCfg):
    """The factory scene plus the robot, its contact sensors and its onboard cameras."""

    # The robot stands on the factory floor, NOT in the pause room: reaching the apple is
    # supposed to require walking there.
    #
    # ⚠ `init_rot` here is (w, x, y, z), which is the OPPOSITE order to every `rot=` in the
    # scene cfg. That is not an inconsistency in this file -- `G1RobotPresets` documents
    # (w, x, y, z) and reorders to Isaac Lab 3.0's (x, y, z, w) itself at
    # `tasks/common_config/robot_configs.py:230-239`. Passing XYZW here would double-swap.
    #
    # Yaw 0 points the G1 along world +x, so 45 deg aims it at the pause-room door at
    # (10.0, 3.9); the exact bearing from (4.0, -2.0) is atan2(5.9, 6.0) = 44.5 deg.
    robot: ArticulationCfg = G1RobotPresets.g1_29dof_dex3_wholebody(
        init_pos=tuple(ROBOT["pos"]),
        init_rot=yaw_quat_wxyz(ROBOT["yaw_deg"]),
    )

    contact_forces = ContactSensorCfg(
        prim_path="/World/envs/env_.*/Robot/.*", history_length=10,
        track_air_time=True, debug_vis=False)

    front_camera = CameraPresets.g1_front_camera()
    left_wrist_camera = CameraPresets.left_dex3_wrist_camera()
    right_wrist_camera = CameraPresets.right_dex3_wrist_camera()
    robot_camera = CameraPresets.g1_world_camera()

    # TASK-203's free tracking camera, kept byte-for-byte from the move_cylinder task so
    # `action_provider_wh_dds.py:551-568` can keep repositioning it when NEODEM_FILM_DIR is
    # set. It looks up `env.scene["film_camera"]` by name; dropping it here would silently
    # disable filming in this scene only.
    #
    # /World/FilmCam is OUTSIDE /World/envs deliberately -- the same clone rule as the floor.
    film_camera = CameraBaseCfg.get_camera_config(
        prim_path="/World/FilmCam",
        update_period=0.0,          # every step; the encoder decimates, not the sensor
        height=720, width=1280,
        focal_length=18.0, horizontal_aperture=20.955,
    )


##
# MDP settings
##


@configclass
class ActionsCfg:
    """Direct joint-angle control, as in every wholebody task here."""

    joint_pos = mdp.JointPositionActionCfg(
        asset_name="robot", joint_names=[".*"], scale=1.0, use_default_offset=True)


@configclass
class ObservationsCfg:
    """Observation groups."""

    @configclass
    class PolicyCfg(ObsGroup):
        """Body joints, Dex3 joints and the camera image -- the wholebody DDS contract."""

        robot_joint_state = ObsTerm(func=mdp.get_robot_boy_joint_states)
        robot_gipper_state = ObsTerm(func=mdp.get_robot_dex3_joint_states)
        camera_image = ObsTerm(func=mdp.get_camera_image)

        def __post_init__(self):
            self.enable_corruption = False
            self.concatenate_terms = False

    policy: PolicyCfg = PolicyCfg()

    @configclass
    class DoorCfg(ObsGroup):
        """The pause room's automatic door: its state, and the thing that drives it.

        A SEPARATE GROUP, not a fourth term in `policy`. The policy group is the wholebody
        DDS contract that the rest of the stack already reads; appending to it would change
        what those publishers see. A new group is purely additive -- `ObservationManager`
        computes every group, and nothing else looks at this one.

        And it is an OBSERVATION at all because `env.step()` never runs in a `*Wholebody*`
        task (`sim_main.py:476-479` + `robot_control_system.py:120-127`), so a reward,
        termination or event term would never fire. The wholebody provider does call
        `observation_manager.compute()` every control step
        (`action_provider_wh_dds.py:728`), which makes this the one per-step hook reachable
        from inside this task package. `mdp/pause_door.py` explains the consequences.
        """

        door_state = ObsTerm(func=mdp.pause_door_state)

        def __post_init__(self):
            self.enable_corruption = False
            self.concatenate_terms = False

    door: DoorCfg = DoorCfg()


@configclass
class TerminationsCfg:
    """No terminations: the wholebody provider drives the sim itself and never ends an
    episode from the manager side. Matches the move_cylinder task."""

    pass


@configclass
class RewardsCfg:
    reward = RewTerm(func=mdp.compute_reward, weight=1.0)


@configclass
class EventCfg:
    """Empty. Resets are triggered explicitly through `SimpleEventManager`, below."""

    pass


@configclass
class FactoryPauseRoomG129Dex3WholebodyEnvCfg(ManagerBasedRLEnvCfg):
    """The full env: factory + pause room + G1 + apple.

    ⚠ `num_envs=1`. Every world coordinate documented for this scene assumes it: with
    num_envs > 1 the `/World/envs/env_.*` content is offset per env while the floor, the
    lights and the fixed world cameras (all outside `/World/envs`) are not, so a second env
    would get walls but share one floor and one camera. The DDS bridge is single-robot
    anyway.
    """

    scene: ObjectTableSceneCfg = ObjectTableSceneCfg(
        num_envs=1,
        env_spacing=2.5,
        replicate_physics=True,
    )

    observations: ObservationsCfg = ObservationsCfg()
    actions: ActionsCfg = ActionsCfg()
    terminations: TerminationsCfg = TerminationsCfg()
    events = EventCfg()
    commands = None
    rewards: RewardsCfg = RewardsCfg()
    curriculum = None

    def __post_init__(self):
        """Post initialization."""
        self.decimation = 4
        self.episode_length_s = 20.0
        self.sim.dt = 0.005
        self.scene.contact_forces.update_period = self.sim.dt
        self.sim.render_interval = self.decimation

        # Isaac Lab 3.0: SimulationCfg.physx -> .physics (PhysxCfg, now in the separate
        # isaaclab_physx distribution). It defaults to None at config time.
        from isaaclab_physx.physics.physx_manager_cfg import PhysxCfg

        if self.sim.physics is None:
            self.sim.physics = PhysxCfg()
        self.sim.physics.bounce_threshold_velocity = 0.01
        self.sim.physics.gpu_found_lost_aggregate_pairs_capacity = 1024 * 1024 * 4
        self.sim.physics.gpu_total_aggregate_pairs_capacity = 16 * 1024
        self.sim.physics.friction_correlation_distance = 0.00625

        # Physics material defaults. `friction_combine_mode="max"` means the scene's own
        # per-prim materials win where they are higher -- which is how the apple keeps its
        # 1.2 against this 1.0 default.
        self.sim.physics_material.static_friction = 1.0
        self.sim.physics_material.dynamic_friction = 1.0
        self.sim.physics_material.friction_combine_mode = "max"
        self.sim.physics_material.restitution_combine_mode = "max"

        self.event_manager = SimpleEventManager()

        # Re-place the apple without resetting the robot. The jitter half-widths come from
        # the layout module rather than being written here, because they are not free: the
        # apple starts 0.195 m from the plate centre and the plate rim plus the apple radius
        # is 0.135 m, so the move_cylinder task's +/-0.05 / +/-0.04 would put the worst
        # corner at 0.132 m and occasionally spawn the apple already touching the plate it
        # is meant to be moved to. `verify_factory_scene_offline.py` checks the corner.
        _jx = FPR_LAYOUT.APPLE_RESET_JITTER["x"]
        _jy = FPR_LAYOUT.APPLE_RESET_JITTER["y"]
        self.event_manager.register("reset_object_self", SimpleEvent(
            func=lambda env: base_mdp.reset_root_state_uniform(
                env,
                torch.arange(env.num_envs, device=env.device),
                pose_range={"x": [-_jx, _jx], "y": [-_jy, _jy]},
                velocity_range={},
                asset_cfg=SceneEntityCfg("object"),
            )
        ))

        self.event_manager.register("reset_all_self", SimpleEvent(
            func=lambda env: base_mdp.reset_scene_to_default(
                env,
                torch.arange(env.num_envs, device=env.device))
        ))

        # Manual overrides for the automatic door. Nothing in `sim_main.py` triggers these
        # today -- the door drives itself off the robot's position, which is the point --
        # but an evaluation that wants to test the robot arriving at a SHUT door, or to
        # hold the door open while something else is measured, needs a way to pin it.
        # `set_pause_door(env, None)` hands control back to the presence sensor.
        self.event_manager.register("open_pause_door", SimpleEvent(
            func=lambda env: mdp.set_pause_door(env, 1.0)))
        self.event_manager.register("close_pause_door", SimpleEvent(
            func=lambda env: mdp.set_pause_door(env, 0.0)))
        self.event_manager.register("auto_pause_door", SimpleEvent(
            func=lambda env: mdp.set_pause_door(env, None)))
