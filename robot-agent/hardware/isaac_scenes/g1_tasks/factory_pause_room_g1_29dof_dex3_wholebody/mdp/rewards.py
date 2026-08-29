# NeoDEM. Apache License, Version 2.0 (same terms as the surrounding Unitree checkout).
"""Reward dispatch, mirroring `move_cylinder_g1_29dof_dex3_wholebody/mdp/rewards.py`.

Two differences from that file, both deliberate:

1. The push reward is imported LAZILY inside a try/except. In the move_cylinder task the
   import is unconditional, which makes that module unimportable unless
   `isaac_sim_patches/0003-neodem-push-slide-reward.patch` has been applied (it is the
   patch that creates `tasks/common_rewards/base_reward_push_cylindercfg.py`). This task
   must load with or without 0003, so a missing push reward degrades to the stock
   pick-place reward with a printed warning instead of an ImportError at scene build.

2. ⚠ NEITHER REWARD IS EVER CALLED IN A `*Wholebody*` TASK. `sim_main.py:476-479` sets
   `use_rl_action_mode = True` for any task whose id contains "Wholebody", and
   `layeredcontrol/robot_control_system.py:120-127` then skips `env.step()` entirely; the
   wholebody DDS provider hand-rolls the physics stepping and never calls
   `reward_manager.compute()`. This module exists for structural parity with the other
   tasks and so the reward becomes live the moment that is fixed -- not because this scene
   currently scores anything. See `isaac_sim_patches/README.md:445-478`.
"""

from tasks.common_rewards.base_reward_pickplace_cylindercfg import (
    compute_reward as _compute_reward_pickplace,
)

try:
    from tasks.common_rewards.base_reward_push_cylindercfg import (
        compute_reward as _compute_reward_push,
    )
except ImportError:  # isaac_sim_patches/0003 not applied
    _compute_reward_push = None


def compute_reward(env):
    """Dispatch to the reward the run was launched for.

    `sim_main.py` sets `env._reward_mode` from `--reward_mode`; anything other than "push"
    keeps the stock pick-place behaviour, so a run that does not pass the flag behaves
    exactly like upstream.
    """
    if getattr(env, "_reward_mode", "pickplace") == "push":
        if _compute_reward_push is None:
            print("[NeoDEM] --reward_mode push requested but "
                  "tasks/common_rewards/base_reward_push_cylindercfg.py is absent "
                  "(isaac_sim_patches/0003 not applied); falling back to pick-place.",
                  flush=True)
        else:
            return _compute_reward_push(env)
    return _compute_reward_pickplace(env)


__all__ = ["compute_reward"]
