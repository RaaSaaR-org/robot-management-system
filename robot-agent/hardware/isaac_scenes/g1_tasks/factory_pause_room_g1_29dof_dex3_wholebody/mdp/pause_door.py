# NeoDEM. Apache License, Version 2.0 (same terms as the surrounding Unitree checkout).
"""The pause room's automatic door: the bit that senses the robot and moves the leaves.

The GEOMETRY of the door is in `common_scene/pause_room_door.usda` (generated) and the
POLICY -- the sensor radii, the leaf speed, the openness-to-joint-coordinate mapping -- is
in `common_scene/factory_pauseroom_layout.py`, where it is pure arithmetic that
`verify_factory_scene_offline.py` can check without a GPU. This module is only the wiring
between them and a running `env`.

WHERE THIS RUNS, AND WHY IT IS AN OBSERVATION TERM
--------------------------------------------------
A `*Wholebody*` task never executes `env.step()`. `sim_main.py:476-479` forces
`use_rl_action_mode = True` for any task id containing "Wholebody", and
`layeredcontrol/robot_control_system.py:120-127` then skips the step entirely -- which is
why this task's reward manager is dead code (see `rewards.py`). So a reward term, a
termination term or an `EventTermCfg` would never fire, and the door would never move.

What DOES run every control step is the wholebody DDS provider's own hand-rolled loop:

    action_provider/action_provider_wh_dds.py:721-729
        for _ in range(4):
            self.env.scene["robot"].set_joint_position_target(...)
            self.env.scene.write_data_to_sim()
            self.env.sim.step(render=False)
            self.env.scene.update(dt=self.env.physics_dt)
        self.env.sim.render()
        self.env.observation_manager.compute()      <-- this line

`observation_manager.compute()` is called unconditionally at the end of every control
step. That is the one per-step hook reachable from inside this task package, so the door
driver is an observation term. It is a slightly unusual place for a side effect, and it is
deliberate: the alternative is patching the vendor's action provider, which this scene has
no business owning.

Two consequences worth knowing:

1. The target written here is picked up by the NEXT step's `scene.write_data_to_sim()`,
   because the obs are computed after that call. The door therefore lags the sensor by one
   control step (~20 ms at decimation 4 and dt 0.005). Against a 1.17 s stroke and a robot
   closing at ~0.11 m/s, that is nothing.
2. The term lives in its OWN observation group (`door`), not in `policy`. The policy group
   is the wholebody DDS contract -- body joints, hand joints, camera image -- and appending
   to it would change what the DDS publishers see. A second group is purely additive.

The term also RETURNS the door's state, so the same call both drives the door and makes it
observable: openness, both leaf coordinates, the clear width and the robot's distance to
the doorway. That is what a scoring run needs to answer "did the robot get through a door
that was actually open?" rather than "did the robot get through".
"""

from __future__ import annotations

import math

import torch

from tasks.common_scene import factory_pauseroom_layout as FPR

DOOR_ASSET_NAME = "pause_room_door"
ROBOT_ASSET_NAME = "robot"

# Attribute the per-env driver state is parked on. `env` is the only object that lives for
# the whole run and is reachable from an observation term; the vendor's own TASK-186 probe
# uses the same trick (`env._neodem_push_probe`, sim_main.py:531-537).
_STATE_ATTR = "_neodem_pause_door"

OBS_DIM = 5
"""[openness, left joint m, right joint m, clear width m, robot distance to door m]."""


class PauseDoorDriver:
    """Per-run state for the automatic door. One instance, parked on `env`."""

    def __init__(self) -> None:
        self.openness: float = 0.0     # 0 = shut, 1 = the full declared clear width
        self.commanded_open: bool = False
        self.forced: float | None = None   # set by the manual open/close events
        self.joint_ids = None              # resolved lazily, once the articulation exists
        self.joint_names: list[str] = []
        self.failed: bool = False          # latched, so a broken door logs once not 8000x

    # -- resolution ----------------------------------------------------------------------
    def _resolve(self, door) -> None:
        """Find the two leaf joints by NAME.

        Never by index: joint ordering in an Isaac Lab articulation comes out of the USD
        traversal, and a scene that silently drove the wrong DOF would be very hard to see
        in a render. `find_joints` preserves the order of the names it is given.
        """
        ids, names = door.find_joints(list(FPR.DOOR_JOINTS))
        if len(ids) != len(FPR.DOOR_JOINTS):
            raise RuntimeError(
                f"pause_room_door is missing joints: wanted {list(FPR.DOOR_JOINTS)}, "
                f"found {names}")
        self.joint_ids = ids
        self.joint_names = list(names)

    # -- the driver ----------------------------------------------------------------------
    def step(self, env) -> torch.Tensor:
        """Sense, move, and report. Returns the state row, shape (num_envs, OBS_DIM)."""
        door = env.scene[DOOR_ASSET_NAME]
        if self.joint_ids is None:
            self._resolve(door)

        robot_xy = env.scene[ROBOT_ASSET_NAME].data.root_pos_w[0, :2]
        # Root positions are in WORLD coordinates. With num_envs=1 the env origin is the
        # world origin, so this needs no offset -- but subtract it anyway, so the numbers
        # stay right if this scene is ever cloned. (`env_origins` is (num_envs, 3).)
        origin = env.scene.env_origins[0, :2]
        rx = float(robot_xy[0] - origin[0])
        ry = float(robot_xy[1] - origin[1])

        if self.forced is None:
            self.commanded_open = FPR.door_should_open((rx, ry), self.commanded_open)
            want = self.commanded_open
        else:
            want = self.forced >= 0.5

        dt = getattr(env, "step_dt", None) or (env.physics_dt * env.cfg.decimation)
        self.openness = FPR.door_advance_openness(self.openness, want, float(dt))

        targets = FPR.door_joint_targets(self.openness)
        row = [targets[n] for n in self.joint_names]
        cmd = torch.tensor([row], dtype=torch.float32,
                           device=env.device).repeat(env.num_envs, 1)
        door.set_joint_position_target(cmd, joint_ids=self.joint_ids)

        d = math.hypot(rx - FPR.DOOR["centre"][0], ry - FPR.DOOR["centre"][1])
        state = [self.openness, targets[FPR.DOOR_JOINTS[0]], targets[FPR.DOOR_JOINTS[1]],
                 FPR.door_clear_width(self.openness), d]
        return torch.tensor([state], dtype=torch.float32,
                            device=env.device).repeat(env.num_envs, 1)


def get_driver(env) -> PauseDoorDriver:
    """The run's one driver, created on first use."""
    drv = getattr(env, _STATE_ATTR, None)
    if drv is None:
        drv = PauseDoorDriver()
        setattr(env, _STATE_ATTR, drv)
    return drv


def pause_door_state(env) -> torch.Tensor:
    """Observation term: drive the automatic door, and report what it is doing.

    Shape (num_envs, 5): openness 0-1, left leaf metres, right leaf metres, clear width
    metres, robot-to-doorway distance metres.

    Never raises. A door that cannot be driven -- a renamed joint, a scene without the
    articulation -- must not take the whole run down with it: the failure is printed once
    and the term degrades to reporting zeros. The scene is still walkable in that state,
    because a door that is never commanded stays where it was authored (shut), which is a
    visible, diagnosable failure rather than a silent one.
    """
    drv = get_driver(env)
    if not drv.failed:
        try:
            return drv.step(env)
        except Exception as exc:  # noqa: BLE001 - deliberately broad, see docstring
            drv.failed = True
            print(f"[NeoDEM] pause-room door driver disabled: "
                  f"{type(exc).__name__}: {exc}", flush=True)
    return torch.zeros((env.num_envs, OBS_DIM), dtype=torch.float32, device=env.device)


def set_pause_door(env, openness: float | None) -> None:
    """Manual override, for the `open_pause_door` / `close_pause_door` events.

    `openness=None` hands control back to the presence sensor. Anything else pins the door,
    which is what an evaluation that wants to test walking into a SHUT door needs.
    """
    drv = get_driver(env)
    drv.forced = None if openness is None else float(openness)


__all__ = [
    "OBS_DIM",
    "PauseDoorDriver",
    "get_driver",
    "pause_door_state",
    "set_pause_door",
]
