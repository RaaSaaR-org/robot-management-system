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

COMMANDED IS NOT MEASURED
-------------------------
That question only gets a real answer if the reported numbers come off the JOINTS. They
did not use to: this term used to report `self.openness`, which is the rate limiter's own
internal command, and never read `door.data.joint_pos` at all. The rate limiter is a
kinematic ramp; the leaves are a position drive being dragged along behind it, and the two
are not the same number.

How far apart they get is set by the drive in `FPR.DOOR_DRIVE`: stiffness 800 N/m, damping
120 N-s/m, and a commanded ramp of `leaf_speed` 0.60 m/s. A position drive tracking a
constant-velocity target settles at a steady-state following error of

    damping * velocity / stiffness  =  120 * 0.60 / 800  =  0.090 m   PER LEAF

and the doorway loses that twice over, once per leaf, so a commanded row overstated the
real gap by up to 0.18 m for the whole stroke. The drive's damping ratio is
120 / (2 * sqrt(800 * 25)) = 0.42, so the leaves also need roughly 0.4 s to settle after
the ramp stops, on top of the 1.17 s stroke.

None of that changes this mission's outcome -- 2.5-3 s of door against a 16.4 s approach --
but "the openness I asked for" is not an answer to "was the door actually open", and this
term exists to answer the second one. So every measured column below is read back from
`door.data.joint_pos`, and the command is carried alongside as one extra column, because
the difference between the two IS the lag and a scoring run should be able to see it.
"""

from __future__ import annotations

import math
import sys
import traceback

import torch

from tasks.common_scene import factory_pauseroom_layout as FPR

DOOR_ASSET_NAME = "pause_room_door"
ROBOT_ASSET_NAME = "robot"

# Attribute the per-env driver state is parked on. `env` is the only object that lives for
# the whole run and is reachable from an observation term; the vendor's own TASK-186 probe
# uses the same trick (`env._neodem_push_probe`, sim_main.py:531-537).
_STATE_ATTR = "_neodem_pause_door"

OBS_DIM = 6
"""[openness, left joint m, right joint m, clear width m, robot distance m, commanded].

The first four are MEASURED -- read back from the articulation this step. The last is the
rate limiter's command, kept only so the drive lag described in the module docstring is
visible to whatever is logging this. Anything scoring "was the door open" wants column 0
or column 3, never column 5.
"""

# -- how a scene reset is recognised ------------------------------------------------------
# `reset_scene_to_default` snaps the leaf joints back to their authored pose (shut) without
# telling this module anything, so the driver has to notice on its own. It notices the way
# the checkout's own push reward notices an object teleport (`reset_jump_m`, see
# `tasks/common_rewards/base_reward_push_cylindercfg.py:63-66`): by the size of the jump.
#
# In one control step the ramp moves the leaves by `leaf_speed * dt / travel`, which at
# dt 0.02 s is 0.017 of openness. A reset from a fully open door is a drop of 1.0 in a
# single step -- about 58 times that -- and the drive itself cannot come close: at
# `max_force` 200 N on a 25 kg leaf the acceleration is 8 m/s^2, so 20 ms buys about 1.6 mm
# of extra travel. Five ramp steps is therefore far above anything physics can produce and
# far below any real reset, and it still catches a reset from a door only 9% open.
_RESET_JUMP_RAMP_STEPS = 5.0

# ...and the jump has to land on the authored pose, not just be large. A shove that drives
# the leaves somewhere else is a collision, not a reset, and must not silently re-baseline
# the driver. 2 mm of joint travel is comfortably inside solver noise on a snapped joint.
_SHUT_TOL_M = 0.002

# -- how long a broken door is tolerated before it is declared dead -----------------------
# This used to latch on the FIRST exception, which was wrong in the one case that matters.
# The first call to this term is not a control step: it is
# `ObservationManager._prepare_terms` at `observation_manager.py:559`,
#
#     obs_dims = tuple(term_cfg.func(self._env, **term_cfg.params).shape)
#
# which -- unlike the IO-descriptor probe forty lines earlier -- is NOT wrapped in a try.
# It also runs before the manager will touch anything play-dependent: `manager_base.py:375`
# only calls `_process_term_cfg_at_play` when `sim.is_playing()`, so the manager itself
# expects terms to be invoked while the articulation may not be resolvable yet. A term that
# latched on that call swallowed its own exception, returned a correctly-shaped zero row,
# let construction succeed, and left the door dead for the entire run behind a single
# printed line -- which is exactly the failure the scene README names: "the door never
# opens and the robot walks into it".
#
# So: retry, count, and only give up after the failure has persisted for long enough that
# it cannot be a not-yet-playing sim. 100 consecutive failures is ~2 s at the 50 Hz control
# rate, and a door that has been unable to move for two seconds really is broken.
_MAX_CONSECUTIVE_FAILURES = 100
_FAILURE_REPRINT_EVERY = 25


class PauseDoorDriver:
    """Per-run state for the automatic door. One instance, parked on `env`."""

    def __init__(self) -> None:
        self.openness: float = 0.0     # 0 = shut, 1 = the full declared clear width.
                                       # This is the COMMAND. The leaves lag it; see above.
        self.measured: float = 0.0     # what the joints last actually read back as
        self.commanded_open: bool = False
        self.forced: float | None = None   # set by the manual open/close events
        self.joint_ids = None              # resolved lazily, once the articulation exists
        self.joint_names: list[str] = []
        self.failures: int = 0             # CONSECUTIVE failures; any success clears it
        self.failed: bool = False          # latched only after _MAX_CONSECUTIVE_FAILURES
        self.resets: int = 0               # scene resets this driver has re-synced to
        self.calls: int = 0                # every step() that got this far
        self._logged_openness: float | None = None   # last MEASURED openness we reported

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

    # -- reading the leaves back ---------------------------------------------------------
    def _read_leaves(self, door) -> tuple[dict[str, float], float]:
        """Where the leaves ARE, as joint metres and as an openness scalar.

        `door_joint_targets` maps openness to metres as `sign * u * travel`, so one leaf
        inverts to `sign * position / travel`. The two leaves are then averaged rather than
        picked between, because the thing the robot has to fit through is the GAP, and the
        gap is the sum of the two leaves' travel: with `u = (u_left + u_right) / 2`,
        `door_clear_width(u)` is `u * 2 * travel`, which is exactly that sum. Averaging is
        therefore not a fudge -- it is the openness whose declared clear width equals the
        real one, and it stays correct when the leaves disagree because one of them is
        being held up by a shoulder.

        Reads env 0 and lets the caller broadcast, which is the same convention the rest of
        this term already uses for the robot's position and the presence sensor.
        """
        pos = door.data.joint_pos[0, self.joint_ids]
        metres = {name: float(pos[i]) for i, name in enumerate(self.joint_names)}
        per_leaf = [FPR.DOOR_JOINT_SIGN[name] * metres[name] / FPR.DOOR_LEAF_TRAVEL
                    for name in self.joint_names]
        u = sum(per_leaf) / len(per_leaf)
        return metres, min(1.0, max(0.0, u))

    def _note_reset(self, measured: float, dt: float) -> bool:
        """Did the scene just get reset out from under us? If so, re-sync and say so.

        Only the command is re-synced. `forced` deliberately survives: it is an operator's
        or an evaluation's explicit instruction ("hold this door shut while I measure
        something"), and `reset_scene_to_default` restores the SCENE, not somebody's
        intent. Silently un-pinning a pinned door on reset would be a worse surprise than
        leaving it pinned.
        """
        ramp_step = FPR.DOOR_AUTOMATION["leaf_speed"] * max(0.0, dt) / FPR.DOOR_LEAF_TRAVEL
        shut_tol = _SHUT_TOL_M / FPR.DOOR_LEAF_TRAVEL
        jumped = (self.measured - measured) > _RESET_JUMP_RAMP_STEPS * ramp_step
        if not (jumped and measured <= shut_tol and self.openness > shut_tol):
            return False
        self.openness = measured
        self.commanded_open = False
        self.failures = 0
        self.failed = False
        self.resets += 1
        print(f"[NeoDEM] pause-room door: scene reset detected (leaves snapped to shut); "
              f"driver re-synced, ramp restarts from {measured:.3f}", flush=True)
        return True

    # -- the driver ----------------------------------------------------------------------
    def step(self, env) -> torch.Tensor:
        """Sense, move, and report. Returns the state row, shape (num_envs, OBS_DIM)."""
        door = env.scene[DOOR_ASSET_NAME]
        if self.joint_ids is None:
            self._resolve(door)

        dt = getattr(env, "step_dt", None) or (env.physics_dt * env.cfg.decimation)

        # Read the leaves FIRST. This is where they ended up after last step's target was
        # written, so it is both the honest answer to "where is the door" and the only
        # place a scene reset becomes visible.
        metres, measured = self._read_leaves(door)
        self._note_reset(measured, float(dt))
        self.measured = measured

        robot_xy = env.scene[ROBOT_ASSET_NAME].data.root_pos_w[0, :2]
        # Root positions are in WORLD coordinates. With num_envs=1 the env origin is the
        # world origin, so this needs no offset -- but subtract it anyway, so the numbers
        # stay right if this scene is ever cloned. (`env_origins` is (num_envs, 3).)
        origin = env.scene.env_origins[0, :2]
        rx = float(robot_xy[0] - origin[0])
        ry = float(robot_xy[1] - origin[1])

        if self.forced is None:
            self.commanded_open = FPR.door_should_open((rx, ry), self.commanded_open)
            target = 1.0 if self.commanded_open else 0.0
        else:
            # `forced` is a TARGET OPENNESS, not a flag. The registered events pass 1.0 and
            # 0.0 so they are unaffected, but `set_pause_door(env, 0.30)` now pins the door
            # 30% open, which is what its docstring has always promised. It used to be read
            # as `forced >= 0.5`, so every fractional value below a half pinned the door
            # fully SHUT -- the opposite of the request, and silent.
            target = min(1.0, max(0.0, self.forced))
            # Keep the sensor's hysteresis latch coherent for whenever control is handed
            # back, so `auto_pause_door` does not resume from a stale idea of the state.
            self.commanded_open = target > 0.5

        # Ramp toward the target at the leaves' real speed. `door_advance_openness` only
        # travels toward a fully open or fully shut end state, so the direction is handed
        # to it and the result is clamped at the fractional target -- that reuses the
        # layout's rate arithmetic rather than restating the speed constant here.
        opening = target > self.openness
        stepped = FPR.door_advance_openness(self.openness, opening, float(dt))
        self.openness = min(stepped, target) if opening else max(stepped, target)

        targets = FPR.door_joint_targets(self.openness)
        row = [targets[n] for n in self.joint_names]
        cmd = torch.tensor([row], dtype=torch.float32,
                           device=env.device).repeat(env.num_envs, 1)
        door.set_joint_position_target(cmd, joint_ids=self.joint_ids)

        d = math.hypot(rx - FPR.DOOR["centre"][0], ry - FPR.DOOR["centre"][1])
        # Columns 0-3 are MEASURED: this is the row that gets logged and scored, so it has
        # to be the door the robot actually walked at. Column 5 is the command, for the
        # lag. `door_clear_width` is reused rather than recomputed so the openness-to-width
        # relationship stays owned by the layout module.
        state = [measured, metres[FPR.DOOR_JOINTS[0]], metres[FPR.DOOR_JOINTS[1]],
                 FPR.door_clear_width(measured), d, self.openness]
        return torch.tensor([state], dtype=torch.float32,
                            device=env.device).repeat(env.num_envs, 1)


def get_driver(env) -> PauseDoorDriver:
    """The run's one driver, created on first use."""
    drv = getattr(env, _STATE_ATTR, None)
    if drv is None:
        drv = PauseDoorDriver()
        setattr(env, _STATE_ATTR, drv)
    return drv


def _zeros(env) -> torch.Tensor:
    return torch.zeros((env.num_envs, OBS_DIM), dtype=torch.float32, device=env.device)


def pause_door_state(env, inspect: bool = False) -> torch.Tensor:
    """Observation term: drive the automatic door, and report what it is doing.

    Shape (num_envs, 6): measured openness 0-1, measured left leaf metres, measured right
    leaf metres, measured clear width metres, robot-to-doorway distance metres, and the
    rate limiter's commanded openness. The first four come off the joints; see the module
    docstring for why that distinction is the whole point of the term.

    Never raises. A door that cannot be driven -- a renamed joint, a scene without the
    articulation -- must not take the whole run down with it: the term degrades to
    reporting zeros. But it does NOT give up on the first exception, because the first
    exception is very likely not a control step at all (see `_MAX_CONSECUTIVE_FAILURES`
    above), and a door that quietly never opens is precisely the failure this term exists
    to prevent. It retries, complains on the way, and only latches once the failure has
    lasted about two seconds -- at which point it says so loudly, on stderr.

    `inspect` exists only because Isaac Lab 3.0's `ObservationManager.get_IO_descriptors`
    (`observation_manager.py:259`) calls terms with `inspect=True` to harvest an IO
    descriptor. Nothing in this run path calls it -- it is reached only via an explicit
    `env.export_IO_descriptors()`, and it defaults to the `policy` group, not `door` -- but
    if it ever is, the probe must not drive the door, so it returns the zero row and stops.
    Note that this has to be a real defaulted parameter and NOT `**kwargs`:
    `manager_base.py:358-371` compares the signature against the configured params, and a
    VAR_KEYWORD parameter fails that check and takes the whole term down at construction.
    """
    drv = get_driver(env)
    if inspect or drv.failed:
        return _zeros(env)

    try:
        state = drv.step(env)
    except Exception as exc:  # noqa: BLE001 - deliberately broad, see docstring
        drv.failures += 1
        if drv.failures >= _MAX_CONSECUTIVE_FAILURES:
            drv.failed = True
            print("[NeoDEM] ***** pause-room door driver DEAD *****\n"
                  f"[NeoDEM] {drv.failures} consecutive failures; giving up. The leaves "
                  f"will stay where they were authored (SHUT) and the robot will walk "
                  f"into a closed door. Last error:\n"
                  f"[NeoDEM] {type(exc).__name__}: {exc}",
                  file=sys.stderr, flush=True)
            traceback.print_exc()
        elif drv.failures == 1:
            print(f"[NeoDEM] pause-room door driver failed: "
                  f"{type(exc).__name__}: {exc} -- retrying "
                  f"(giving up after {_MAX_CONSECUTIVE_FAILURES} consecutive failures)",
                  file=sys.stderr, flush=True)
            traceback.print_exc()
        elif drv.failures % _FAILURE_REPRINT_EVERY == 0:
            print(f"[NeoDEM] pause-room door driver still failing "
                  f"({drv.failures}/{_MAX_CONSECUTIVE_FAILURES}): "
                  f"{type(exc).__name__}: {exc}", file=sys.stderr, flush=True)
        return _zeros(env)

    if drv.failures:
        print(f"[NeoDEM] pause-room door driver recovered after {drv.failures} "
              f"failed call(s)", flush=True)
        drv.failures = 0

    # MAKE THE DOOR OBSERVABLE FROM OUTSIDE THE SIM.
    #
    # Until this existed, "the door is actually driven every control step" was an inference
    # -- from the driver being an observation term and the vendor calling
    # observation_manager.compute() unconditionally -- with no way to check it against a
    # running sim. The `door` observation group goes nowhere: it is not on the DDS wire and
    # no camera can see the leaves from behind the robot, so a door that never moved and a
    # door that opened perfectly produced identical evidence. The first live run had to
    # settle it by eye, from a chase-camera frame that happened to catch the doorway.
    #
    # Logged ON CHANGE rather than periodically: a rate-limited sample of a value that is
    # constant 95 % of the time is nearly all noise and still misses the transition, which
    # is the only part anyone wants. One line when the driver comes up, then one whenever
    # the MEASURED openness moves by 5 % of full travel -- so an open-close cycle is about
    # forty lines and a door that never moves is exactly one.
    drv.calls += 1
    if drv._logged_openness is None:
        print(f"[NeoDEM] pause-room door driver live: joints {drv.joint_names}, "
              f"opens within {FPR.DOOR_AUTOMATION['open_radius']} m, "
              f"shuts beyond {FPR.DOOR_AUTOMATION['shut_radius']} m, "
              f"leaf speed {FPR.DOOR_AUTOMATION['leaf_speed']} m/s", flush=True)
        drv._logged_openness = -1.0
    row = state[0]
    measured_now = float(row[0])
    if abs(measured_now - drv._logged_openness) >= 0.05:
        drv._logged_openness = measured_now
        print(f"[NeoDEM] door call={drv.calls:6d} robot_d={float(row[4]):5.2f}m "
              f"commanded={float(row[5]):.2f} measured={measured_now:.2f} "
              f"leaves=({float(row[1]):+.3f},{float(row[2]):+.3f})m "
              f"clear_width={float(row[3]):.2f}m", flush=True)

    return state


def set_pause_door(env, openness: float | None) -> None:
    """Manual override, for the `open_pause_door` / `close_pause_door` events.

    `openness=None` hands control back to the presence sensor. Anything else pins the door
    at that openness -- 0.0 shut, 1.0 fully open, and fractions in between -- which is what
    an evaluation that wants to test walking into a SHUT door, or into a half-open one,
    needs. The leaves still ramp to the pinned value at `leaf_speed` rather than jumping.
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
