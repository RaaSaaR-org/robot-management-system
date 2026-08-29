# NeoDEM. Apache License, Version 2.0 (same terms as the surrounding Unitree checkout).
"""Gym registration for the factory + pause-room apple task.

The id MUST contain "Wholebody": `sim_main.py:476-479` keys off that substring (or
`--enable_wholebody_dds`) to force `action_source = "dds_wholebody"` and
`use_rl_action_mode = True`. Without it the task would build but the DDS wholebody
provider would never take control of the robot.

This package is picked up automatically -- `tasks/__init__.py` ends in
`import_packages(__name__, _BLACKLIST_PKGS)`, which walks and imports every sub-package
recursively. Adding the import to `tasks/g1_tasks/__init__.py` is therefore optional; the
copy shipped alongside this file exists only to keep that list honest.

(The blacklist is a substring test against the full dotted name, over
`["utils", ".mdp", "pick_place"]`. "factory_pause_room_g1_29dof_dex3_wholebody" matches
none of them; the `.mdp` sub-package is skipped by the walker and imported explicitly by
the env cfg instead, exactly as in the move_cylinder task.)
"""

import gymnasium as gym

from . import factory_pause_room_g1_29dof_dex3_hw_env_cfg


gym.register(
    id="Isaac-Factory-PauseRoom-G129-Dex3-Wholebody",
    entry_point="isaaclab.envs:ManagerBasedRLEnv",
    kwargs={
        "env_cfg_entry_point":
            factory_pause_room_g1_29dof_dex3_hw_env_cfg.FactoryPauseRoomG129Dex3WholebodyEnvCfg,
    },
    disable_env_checker=True,
)
