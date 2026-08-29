# NeoDEM. Apache License, Version 2.0 (same terms as the surrounding Unitree checkout).
"""Stub-`env` tests for the pause room's door driver (`mdp/pause_door.py`).

WHY THIS EXISTS
---------------
`verify_factory_scene_offline.py` checks the door's ARITHMETIC -- the openness-to-joint
mapping, the clear widths, the sensor radii, the stroke timing -- because all of that lives
in `common_scene/factory_pauseroom_layout.py` as pure functions. What it does not check, at
all, is the DRIVER: its entire relationship to `mdp/pause_door.py` is one `os.path.isfile`,
so a syntax error in that module passes every offline check. This file closes that gap.

It needs no GPU, no Isaac Lab and no torch. The two imports the driver actually makes --
`torch` and `tasks.common_scene.factory_pauseroom_layout` -- are supplied here: the layout
is the REAL module loaded from this repo, and torch is a fifty-line stand-in that
implements only `tensor`/`zeros`/`float32` and the `[row, cols]` indexing the driver uses.
The stub is installed and removed around the import so a session that does have a real
torch is unaffected.

The leaves are simulated as the real position drive -- m x'' = k(target - x) - c x',
clipped at max_force, integrated at the physics dt with `decimation` substeps, which is the
loop `action_provider_wh_dds.py:721-729` runs. m, k, c and max_force all come from the
layout module, so the following error this reproduces is the scene's own and not a number
invented here. That matters: it is what makes the commanded-vs-measured test meaningful
rather than tautological.

Run it either way:

    python3 robot-agent/hardware/isaac_scenes/tests/test_pause_door.py
    pytest  robot-agent/hardware/isaac_scenes/tests/test_pause_door.py
"""

from __future__ import annotations

import contextlib
import importlib.util
import math
import pathlib
import sys
import types

_HERE = pathlib.Path(__file__).resolve().parent
_SCENES = _HERE.parent
_LAYOUT = _SCENES / "common_scene" / "factory_pauseroom_layout.py"
_DRIVER = (_SCENES / "g1_tasks" / "factory_pause_room_g1_29dof_dex3_wholebody"
           / "mdp" / "pause_door.py")

PHYS_DT = 0.005
DECIMATION = 4
STEP_DT = PHYS_DT * DECIMATION


# ---------------------------------------------------------------------------------------
# The torch stand-in. Only what pause_door.py touches.
# ---------------------------------------------------------------------------------------
class _Tensor:
    def __init__(self, rows):
        self.rows = [list(r) for r in rows]

    @property
    def shape(self):
        return (len(self.rows), len(self.rows[0]) if self.rows else 0)

    def repeat(self, n, _cols):
        return _Tensor([list(r) for _ in range(n) for r in self.rows])

    def __getitem__(self, key):
        if isinstance(key, tuple):
            r, c = key
            row = self.rows[r]
            return [row[i] for i in c] if isinstance(c, (list, tuple)) else row[c]
        return self.rows[key]


def _make_torch_stub():
    m = types.ModuleType("torch")
    m.float32 = "float32"
    m.Tensor = _Tensor
    m.tensor = lambda rows, dtype=None, device=None: _Tensor(rows)
    m.zeros = lambda shape, dtype=None, device=None: _Tensor(
        [[0.0] * shape[1] for _ in range(shape[0])])
    return m


def _load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


@contextlib.contextmanager
def _patched_imports():
    """Install the torch stub and the `tasks.common_scene` package the driver imports."""
    saved = {k: sys.modules.get(k) for k in
             ("torch", "tasks", "tasks.common_scene",
              "tasks.common_scene.factory_pauseroom_layout")}
    try:
        sys.modules["torch"] = _make_torch_stub()
        pkg = types.ModuleType("tasks")
        pkg.__path__ = []
        sub = types.ModuleType("tasks.common_scene")
        sub.__path__ = []
        sys.modules["tasks"] = pkg
        sys.modules["tasks.common_scene"] = sub
        layout = _load("tasks.common_scene.factory_pauseroom_layout", _LAYOUT)
        sub.factory_pauseroom_layout = layout
        yield layout
    finally:
        for k, v in saved.items():
            if v is None:
                sys.modules.pop(k, None)
            else:
                sys.modules[k] = v
        sys.modules.pop("neodem_pause_door_under_test", None)


with _patched_imports() as _layout:
    FPR = _layout
    M = _load("neodem_pause_door_under_test", _DRIVER)


# ---------------------------------------------------------------------------------------
# The stub env
# ---------------------------------------------------------------------------------------
class _Buf:
    """A (num_envs, N) buffer supporting the [row, col] forms the driver uses."""

    def __init__(self, rows):
        self.rows = [list(r) for r in rows]

    def __getitem__(self, key):
        if isinstance(key, tuple):
            r, c = key
            row = self.rows[r]
            return [row[i] for i in c] if isinstance(c, (list, tuple)) else row[c]
        return self.rows[key]


class _Leaves:
    """The two-leaf articulation, driven by the scene's own position drive."""

    def __init__(self):
        self.names = list(FPR.DOOR_JOINTS)
        self.pos = {n: 0.0 for n in self.names}
        self.vel = {n: 0.0 for n in self.names}
        self.target = {n: 0.0 for n in self.names}
        self.resolve_failures = 0
        self.data = self

    def find_joints(self, names):
        if self.resolve_failures > 0:
            self.resolve_failures -= 1
            raise RuntimeError("articulation not resolvable yet (simulated transient)")
        return [self.names.index(n) for n in names], list(names)

    @property
    def joint_pos(self):
        return _Buf([[self.pos[n] for n in self.names]])

    def set_joint_position_target(self, cmd, joint_ids=None):
        row = cmd.rows[0]
        for i, jid in enumerate(joint_ids):
            self.target[self.names[jid]] = row[i]

    def advance(self):
        k = FPR.DOOR_DRIVE["stiffness"]
        c = FPR.DOOR_DRIVE["damping"]
        fmax = FPR.DOOR_DRIVE["max_force"]
        m = FPR.DOOR_LEAF_MASS
        for _ in range(DECIMATION):
            for n in self.names:
                f = max(-fmax, min(fmax, k * (self.target[n] - self.pos[n])
                                   - c * self.vel[n]))
                self.vel[n] += (f / m) * PHYS_DT
                self.pos[n] += self.vel[n] * PHYS_DT

    def snap_shut(self):
        """What `reset_scene_to_default` does: authored pose, instantly, no physics."""
        for n in self.names:
            self.pos[n] = 0.0
            self.vel[n] = 0.0


class _Robot:
    def __init__(self, xy):
        self.xy = list(xy)
        self.data = self

    @property
    def root_pos_w(self):
        return _Buf([[self.xy[0], self.xy[1], 0.0]])


class _Scene:
    def __init__(self, robot, door):
        self._d = {"robot": robot, "pause_room_door": door}
        self.env_origins = _Buf([[0.0, 0.0, 0.0]])

    def __getitem__(self, k):
        return self._d[k]


class Env:
    def __init__(self, robot_xy=(10.0, 4.9)):
        self.leaves = _Leaves()
        self.robot = _Robot(robot_xy)
        self.scene = _Scene(self.robot, self.leaves)
        self.num_envs = 1
        self.device = "cpu"
        self.step_dt = STEP_DT
        self.physics_dt = PHYS_DT


def run(env, n):
    rows = []
    for _ in range(n):
        rows.append(M.pause_door_state(env).rows[0])
        env.leaves.advance()
    return rows


def gap(env):
    """The clear width the two leaves physically leave, in metres."""
    return sum(FPR.DOOR_JOINT_SIGN[n] * env.leaves.pos[n] for n in FPR.DOOR_JOINTS)


# ---------------------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------------------
def test_drive_lag_is_real():
    """The premise of test_reports_measured_not_commanded: the leaves DO lag the ramp.

    A position drive tracking a constant-velocity target settles at damping * v / stiffness
    of following error, which for this scene is 120 * 0.60 / 800 = 0.090 m per leaf. If
    this ever stops being true the lag test below would pass vacuously.
    """
    env = Env()
    predicted = (FPR.DOOR_DRIVE["damping"] * FPR.DOOR_AUTOMATION["leaf_speed"]
                 / FPR.DOOR_DRIVE["stiffness"])
    run(env, 40)                      # mid-ramp, past the initial transient
    lag = max(abs(FPR.door_joint_targets(M.get_driver(env).openness)[n] - env.leaves.pos[n])
              for n in FPR.DOOR_JOINTS)
    assert 0.5 * predicted < lag < 2.0 * predicted, (
        f"per-leaf following error {lag:.4f} m is nowhere near the predicted "
        f"{predicted:.4f} m -- the drive model or DOOR_DRIVE has changed")


def test_reports_measured_not_commanded():
    """Columns 0-3 must come off the joints, not out of the rate limiter.

    Reporting the command overstated the real clear width by up to ~0.18 m for the whole
    stroke (0.090 m of following error per leaf, and the doorway loses it twice).
    """
    env = Env()
    worst = 0.0
    for _ in range(200):
        row = M.pause_door_state(env).rows[0]
        true_gap = min(gap(env), FPR.DOOR["width"])   # door_clear_width clamps at u=1
        worst = max(worst, abs(row[3] - true_gap))
        env.leaves.advance()
    assert worst < 1e-9, f"reported clear width diverged from the leaves by {worst:.4f} m"


def test_survives_a_transient_failure_on_the_construction_probe():
    """The FIRST call is `ObservationManager._prepare_terms` (observation_manager.py:559).

    That call is not wrapped in a try, and the manager deliberately invokes terms before
    the sim is playing (`manager_base.py:375` guards `_process_term_cfg_at_play` on
    `sim.is_playing()`). A driver that latched on it returned a correctly shaped zero row,
    let construction succeed, and left the door dead for the whole run.
    """
    env = Env()
    env.leaves.resolve_failures = 1                  # one transient, on the probe itself
    probe = M.pause_door_state(env)                  # observation_manager.py:559
    assert probe.shape == (1, M.OBS_DIM), "construction probe must still get a valid shape"
    run(env, 200)
    assert not M.get_driver(env).failed, "a single transient must not disable the door"
    assert gap(env) > 1.35, f"door never opened after a transient failure (gap {gap(env):.3f} m)"


def test_latches_only_after_sustained_failure():
    env = Env()
    env.leaves.resolve_failures = 10 ** 6
    drv = M.get_driver(env)
    for i in range(M._MAX_CONSECUTIVE_FAILURES - 1):
        M.pause_door_state(env)
        assert not drv.failed, f"latched early, after {i + 1} failures"
    M.pause_door_state(env)
    assert drv.failed, "a door broken for ~2 s must eventually be declared dead"


def test_resyncs_after_a_scene_reset():
    """`reset_scene_to_default` snaps the leaves shut without telling the driver.

    With stale state the driver re-commands the open target against leaves at zero, so they
    cross the whole stroke at actuator speed instead of the intended 0.60 m/s ramp.
    """
    env = Env()
    run(env, 150)
    assert gap(env) > 1.35
    drv = M.get_driver(env)
    env.leaves.snap_shut()

    peak = 0.0
    for _ in range(80):
        M.pause_door_state(env)
        before = dict(env.leaves.pos)
        env.leaves.advance()
        peak = max(peak, max(abs(env.leaves.pos[n] - before[n])
                             for n in FPR.DOOR_JOINTS) / STEP_DT)

    assert drv.resets == 1, f"reset not detected (resets={drv.resets})"
    assert peak < 2.0 * FPR.DOOR_AUTOMATION["leaf_speed"], (
        f"leaves slammed at {peak:.3f} m/s after the reset; the ramp is "
        f"{FPR.DOOR_AUTOMATION['leaf_speed']:.2f} m/s")
    assert gap(env) > 1.35, "door failed to re-open after the reset"


def test_no_spurious_reset_during_normal_cycling():
    """The reset detector keys on a jump the ramp cannot produce; normal motion must not
    trip it, in either direction, including the drive catching up after the ramp stops."""
    env = Env()
    run(env, 150)                       # open
    env.robot.xy[1] = 20.0
    run(env, 250)                       # walk away, door shuts
    env.robot.xy[1] = 4.9
    run(env, 250)                       # come back, door opens
    drv = M.get_driver(env)
    assert drv.resets == 0, f"{drv.resets} phantom reset(s) during normal cycling"
    assert not drv.failed and drv.failures == 0
    assert gap(env) > 1.35


def test_forced_override_is_a_target_openness():
    """`set_pause_door(env, 0.30)` must pin the door 30% open, as its docstring says.

    It used to be read as `forced >= 0.5`, so every fractional value below a half pinned the
    door fully SHUT -- the opposite of the request, and silent. The two registered events
    pass 1.0 and 0.0, so they were and remain correct.
    """
    for u in (0.0, 0.30, 0.75, 1.0):
        env = Env(robot_xy=(10.0, 20.0))      # far away: the sensor alone would keep it shut
        M.set_pause_door(env, u)
        run(env, 250)
        want = FPR.door_clear_width(u)
        assert abs(gap(env) - want) < 0.05, (
            f"set_pause_door({u}) gave {gap(env):.3f} m of clear width, wanted {want:.3f} m")


def test_forced_override_survives_a_reset():
    """A scene reset restores the SCENE, not an operator's explicit instruction."""
    env = Env()
    M.set_pause_door(env, 1.0)
    run(env, 150)
    drv = M.get_driver(env)
    env.leaves.snap_shut()
    run(env, 5)
    assert drv.forced == 1.0, "a pinned door must stay pinned across a reset"
    assert drv.resets == 1 and not drv.failed


def test_inspect_probe_has_no_side_effects():
    """Isaac Lab 3.0 calls terms with `inspect=True` to harvest an IO descriptor
    (`observation_manager.py:259`). That probe must not drive the door."""
    env = Env()
    targets_before = dict(env.leaves.target)
    out = M.pause_door_state(env, inspect=True)
    assert out.shape == (1, M.OBS_DIM)
    assert env.leaves.target == targets_before, "inspect probe wrote a joint target"
    assert M.get_driver(env).openness == 0.0, "inspect probe advanced the ramp"


def test_signature_passes_isaaclab_arg_validation():
    """`manager_base.py:358-371` compares the term signature against the configured params.

    This is why `inspect` is a real defaulted parameter and not `**kwargs`: a VAR_KEYWORD
    parameter has no default, so it lands in the mandatory list, fails this check, and
    takes the whole term down at construction.
    """
    import inspect as _inspect
    args = _inspect.signature(M.pause_door_state).parameters
    optional = [a for a in args if args[a].default is not _inspect.Parameter.empty]
    mandatory = [a for a in args if args[a].default is _inspect.Parameter.empty]
    ordered = mandatory + optional
    configured: list[str] = []          # DoorCfg passes no params
    assert not (len(ordered) > 1 and set(ordered[1:]) != set(configured + optional)), (
        f"IsaacLab would reject this term: mandatory={mandatory} optional={optional}")


def test_obs_row_is_self_consistent():
    env = Env()
    run(env, 60)
    row = M.pause_door_state(env).rows[0]
    assert len(row) == M.OBS_DIM == 6
    u, left, right, width, dist, commanded = row
    assert abs(width - FPR.door_clear_width(u)) < 1e-9
    assert left <= 0.0 <= right, "left leaf opens toward -x, right toward +x"
    assert abs(dist - math.hypot(env.robot.xy[0] - FPR.DOOR["centre"][0],
                                 env.robot.xy[1] - FPR.DOOR["centre"][1])) < 1e-9
    assert commanded >= u - 1e-9, "the command should lead the leaves while opening"


if __name__ == "__main__":
    failed = 0
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            try:
                fn()
                print(f"  PASS  {name}")
            except AssertionError as exc:
                failed += 1
                print(f"  FAIL  {name}\n        {exc}")
    print("\n" + ("ALL PASS" if not failed else f"{failed} FAILED"))
    sys.exit(1 if failed else 0)
