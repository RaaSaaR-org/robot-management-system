"""The TypeScript kinematic table still describes the robot MuJoCo loads.

    .venv/bin/python -m pytest test_teleop_chains.py -q

`robot-agent/src/teleop/g1-chains.generated.ts` is the G1 EDU's arm and Dex3
finger kinematics, exported out of the MJCF by
`sim_evaluator/mjcf/g1_dex3/export_chains.py`. The IK solver that reads it runs
in-process in the robot agent with no MuJoCo and no Pinocchio, so nothing on the
TypeScript side can notice when the table stops agreeing with the model: the
arm just reaches somewhere slightly wrong, consistently, and an operator puts it
down to their own aim. `g1-chains.test.ts` pins the numbers against themselves.
THIS test is the only thing that pins them against MuJoCo.

Three ways they drift, and what catches each:

* **Somebody re-runs the exporter against a changed MJCF** (Unitree ships new
  offsets, a link gets re-parented) and commits the table without the frames
  agreeing any more. Caught by the pose comparison: FK composed from the table
  in pure numpy against `mj_forward`, in the chain's own root frame, over a
  fixed set of joint configurations.
* **Somebody edits the table by hand** — the whole reason the generator exists.
  Same check.
* **A scene loses `<compiler angle="radian">`.** MuJoCo then reads every
  `range=` as degrees and stores it 57.3x smaller, while the exporter's plain
  XML parse does not. The arms keep working and the LIMITS silently shrink to a
  few degrees of travel. Caught by the joint-range comparison, which is exact.

Everything here is frame-RELATIVE: arm chains are compared in `torso_link`, the
frame the browser sends wrist poses in, and finger chains in the wrist. The
poses deliberately move the waist as well, so a check that only worked with the
torso at the identity would fail.
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

import pytest

mujoco = pytest.importorskip("mujoco")
np = pytest.importorskip("numpy")

sys.path.insert(0, str(Path(__file__).resolve().parent))

from joints import ARM_REST, BODY  # noqa: E402

HERE = Path(__file__).resolve().parent
CHAINS_TS = HERE.parent.parent / "src" / "teleop" / "g1-chains.generated.ts"
SCENE = HERE.parent / "sim_evaluator" / "mjcf" / "g1_dex3_pickplace_scene.xml"

# Positions in metres, orientations as direction-cosine entries. The exporter's
# docstring claims 1e-6 against mj_forward; this is that claim, asserted.
TOL_M = 1e-6
TOL_ROT = 1e-6
# Limits are the same decimal text on both sides -- one parsed by MuJoCo, one by
# Python -- so anything above float noise means a real disagreement.
TOL_RAD = 1e-9

# The waist rides between the pelvis and torso_link. Driving it proves the
# comparison really is done in the torso frame rather than the world's.
WAIST_JOINTS = ["waist_yaw_joint", "waist_roll_joint", "waist_pitch_joint"]

# One seed, one draw order, one set of poses -- forever. A test that sampled
# fresh angles each run would fail on somebody else's machine and pass on yours.
POSE_SEED = 20260822
N_SPREAD_POSES = 6
POSE_LABELS = ["zeros", "arm_rest"] + [f"spread{i}" for i in range(N_SPREAD_POSES)]


# ------------------------------------------------------- reading the TS table


def _ts_literal(source: str, name: str):
    """The JSON object literal `export const <name> ... = <literal>;` holds.

    The generator writes `json.dumps(..., indent=2)` straight into the file, so
    the literal is valid JSON -- but only up to the `as const` assertion the
    chain tables carry, and only up to the RIGHT semicolon. Scanning for
    brackets rather than for the first `;` keeps this honest if the table ever
    grows a string containing one.
    """
    head = re.search(rf"export const {re.escape(name)}\s*:[^=]*=\s*", source)
    if head is None:
        pytest.fail(f"{name} is not exported from {CHAINS_TS.name} any more")

    depth = 0
    in_string = False
    escaped = False
    end = None
    for i in range(head.end(), len(source)):
        ch = source[i]
        if in_string:
            if escaped:
                escaped = False
            elif ch == "\\":
                escaped = True
            elif ch == '"':
                in_string = False
            continue
        if ch == '"':
            in_string = True
        elif ch in "{[":
            depth += 1
        elif ch in "}]":
            depth -= 1
        elif ch == ";" and depth == 0:
            end = i
            break
    if end is None:
        pytest.fail(f"{name} has no terminating ';' -- the file is not the generator's output")

    literal = re.sub(r"\s+as\s+const\s*$", "", source[head.end():end].strip())
    return json.loads(literal)


@pytest.fixture(scope="module")
def table() -> dict:
    """The three exported constants, parsed out of the generated TypeScript."""
    if not CHAINS_TS.exists():
        pytest.skip(f"generated chain table not found: {CHAINS_TS}")
    source = CHAINS_TS.read_text(encoding="utf-8")
    return {
        "arms": _ts_literal(source, "G1_ARM_CHAINS"),
        "fingers": _ts_literal(source, "G1_FINGER_CHAINS"),
        "head": _ts_literal(source, "HEAD_SITE_IN_TORSO"),
    }


def _all_chains(table: dict):
    """(label, chain) for every chain in the table, arms first."""
    for side in ("left", "right"):
        yield f"{side} arm", table["arms"][side]
    for side in ("left", "right"):
        for finger in ("thumb", "index", "middle"):
            yield f"{side} {finger}", table["fingers"][side][finger]


# ------------------------------------------------------------------ the model


@pytest.fixture(scope="module")
def sim():
    if not SCENE.exists():
        pytest.skip(f"scene not found: {SCENE}")
    model = mujoco.MjModel.from_xml_path(str(SCENE))
    data = mujoco.MjData(model)
    return model, data


def _jid(model, name: str) -> int:
    jid = mujoco.mj_name2id(model, mujoco.mjtObj.mjOBJ_JOINT, name)
    if jid < 0:
        pytest.fail(f"the table names a joint the model does not have: {name}")
    return jid


def _body_frame(model, data, name: str):
    bid = mujoco.mj_name2id(model, mujoco.mjtObj.mjOBJ_BODY, name)
    if bid < 0:
        pytest.fail(f"the table names a body the model does not have: {name}")
    return np.array(data.xpos[bid], dtype=float), np.array(data.xmat[bid], dtype=float).reshape(3, 3)


@pytest.fixture(scope="module")
def poses(sim, table) -> dict[str, dict[str, float]]:
    """label -> {joint name: radians}. Built once, identical on every machine."""
    model, _ = sim
    driven = [link["joint"] for _, chain in _all_chains(table) for link in chain["links"]]
    driven += WAIST_JOINTS

    out: dict[str, dict[str, float]] = {}
    out["zeros"] = {name: 0.0 for name in driven}

    # The sim's own standing pose: the MJCF zero holds both arms straight out in
    # front, which exercises none of the shoulder mount rotations.
    rest = dict(out["zeros"])
    for index, angle in ARM_REST.items():
        rest[BODY[index]] = angle
    out["arm_rest"] = rest

    # Sample inside the MODEL's ranges, not the table's: the model is the thing
    # being trusted here, and a table with a broken range must not get to choose
    # the configurations it is tested at.
    rng = np.random.default_rng(POSE_SEED)
    for i in range(N_SPREAD_POSES):
        pose = {}
        for name in driven:
            lower, upper = model.jnt_range[_jid(model, name)]
            pose[name] = float(rng.uniform(lower, upper))
        out[f"spread{i}"] = pose
    return out


def _apply(model, data, pose: dict[str, float]) -> None:
    # mj_resetData first, so a pose that names fewer joints than its predecessor
    # cannot inherit the leftovers and quietly test the same configuration twice.
    mujoco.mj_resetData(model, data)
    for name, angle in pose.items():
        data.qpos[model.jnt_qposadr[_jid(model, name)]] = angle
    mujoco.mj_forward(model, data)


# ----------------------------------------------- forward kinematics, in numpy


def _quat_to_mat(quat) -> np.ndarray:
    """MJCF (w, x, y, z) as a rotation matrix, normalised like MuJoCo does.

    Unitree's quaternions are unit only to ~1e-6 (0.990264, 0.139201, ... is
    off by 4e-7). MuJoCo normalises at compile time; skipping it here would
    leave a scale error big enough to eat most of the 1e-6 budget on a 30 cm
    forearm, and the test would be measuring its own sloppiness.
    """
    w, x, y, z = np.asarray(quat, dtype=float) / np.linalg.norm(quat)
    return np.array([
        [1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y)],
        [2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x)],
        [2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y)],
    ])


def _axis_angle_to_mat(axis, angle: float) -> np.ndarray:
    a = np.asarray(axis, dtype=float)
    a = a / np.linalg.norm(a)
    k = np.array([[0.0, -a[2], a[1]], [a[2], 0.0, -a[0]], [-a[1], a[0], 0.0]])
    return np.eye(3) + np.sin(angle) * k + (1.0 - np.cos(angle)) * (k @ k)


def _fk(chain: dict, q) -> tuple[np.ndarray, np.ndarray]:
    """Tip position and orientation in the chain's root frame, from the table.

    Exactly the generator's stated composition, and exactly what
    `kinematics.ts::forwardKinematics` does:
    `T_child = T_parent . Trans(pos) . Rot(quat) . Rot(axis, q)`.
    """
    rot = np.eye(3)
    pos = np.zeros(3)
    for link, angle in zip(chain["links"], q):
        pos = pos + rot @ np.asarray(link["pos"], dtype=float)
        rot = rot @ _quat_to_mat(link["quat"])
        rot = rot @ _axis_angle_to_mat(link["axis"], angle)
    return pos + rot @ np.asarray(chain["tip"], dtype=float), rot


def _fk_mujoco(model, data, chain: dict) -> tuple[np.ndarray, np.ndarray]:
    """The same tip, read off `mj_forward`'s body poses and re-expressed in the
    chain's root frame."""
    root_pos, root_rot = _body_frame(model, data, chain["root"])
    tip_pos, tip_rot = _body_frame(model, data, chain["tipOf"])
    tip_world = tip_pos + tip_rot @ np.asarray(chain["tip"], dtype=float)
    return root_rot.T @ (tip_world - root_pos), root_rot.T @ tip_rot


def _joint_vector(chain: dict, pose: dict[str, float]) -> list[float]:
    return [pose[link["joint"]] for link in chain["links"]]


def _geodesic(a: np.ndarray, b: np.ndarray) -> float:
    """Angle in radians between two rotations -- the number a human can judge."""
    trace = float(np.trace(b @ a.T))
    return float(np.arccos(np.clip((trace - 1.0) / 2.0, -1.0, 1.0)))


# ---------------------------------------------------------------- the checks


@pytest.mark.parametrize("label", POSE_LABELS)
class TestChainsAgreeWithMuJoCo:
    def test_every_tip_lands_where_mujoco_puts_it(self, sim, table, poses, label):
        model, data = sim
        pose = poses[label]
        _apply(model, data, pose)
        for name, chain in _all_chains(table):
            want, _ = _fk_mujoco(model, data, chain)
            got, _ = _fk(chain, _joint_vector(chain, pose))
            error = float(np.max(np.abs(got - want)))
            assert error < TOL_M, (
                f"{name} tip at pose '{label}' is {error:.3e} m from MuJoCo's, in the "
                f"{chain['root']} frame: table {got} vs model {want}. Regenerate "
                f"g1-chains.generated.ts with export_chains.py."
            )

    def test_every_tip_is_oriented_the_way_mujoco_orients_it(self, sim, table, poses, label):
        # Position alone would pass a table whose last link had the wrong axis
        # but the right offset -- and the wrist roll the headset drives is
        # orientation only, so that arm would look right and hold the bottle
        # sideways.
        model, data = sim
        pose = poses[label]
        _apply(model, data, pose)
        for name, chain in _all_chains(table):
            _, want = _fk_mujoco(model, data, chain)
            _, got = _fk(chain, _joint_vector(chain, pose))
            error = float(np.max(np.abs(got - want)))
            assert error < TOL_ROT, (
                f"{name} tip orientation at pose '{label}' is off by {error:.3e} "
                f"({np.degrees(_geodesic(got, want)):.4f} deg) in the {chain['root']} frame"
            )


class TestChainsMatchTheModelsStructure:
    def test_the_bodies_and_joints_still_exist_and_are_parented_as_exported(self, sim, table):
        model, _ = sim
        for name, chain in _all_chains(table):
            root_id = mujoco.mj_name2id(model, mujoco.mjtObj.mjOBJ_BODY, chain["root"])
            assert root_id >= 0, f"{name} hangs off a body the model does not have"
            for link in chain["links"]:
                jid = _jid(model, link["joint"])
                # The joint must live on the body the table says it does, or the
                # rigid offset preceding it belongs to somebody else.
                owner = model.jnt_bodyid[jid]
                owner_name = mujoco.mj_id2name(model, mujoco.mjtObj.mjOBJ_BODY, owner)
                assert owner_name == link["body"], (
                    f"{link['joint']} has moved from {link['body']} to {owner_name}"
                )
                assert model.jnt_type[jid] == mujoco.mjtJoint.mjJNT_HINGE, (
                    f"{link['joint']} is no longer a hinge; the table cannot express it"
                )

    def test_the_limits_are_the_models_limits_in_radians(self, sim, table):
        # The 57.3x check. A scene that loses `<compiler angle="radian">` reads
        # every range= as degrees, so MuJoCo's stored limits shrink by pi/180
        # while the exporter's raw XML parse does not. Nothing else notices: the
        # arm still moves, it just refuses to travel more than a few degrees.
        model, _ = sim
        for name, chain in _all_chains(table):
            for link in chain["links"]:
                jid = _jid(model, link["joint"])
                assert model.jnt_limited[jid], f"{link['joint']} has lost its range="
                lower, upper = (float(v) for v in model.jnt_range[jid])
                assert abs(link["lower"] - lower) < TOL_RAD, (
                    f"{name}: {link['joint']} lower limit is {link['lower']} in the table "
                    f"and {lower} in the model (ratio {link['lower'] / lower if lower else float('nan'):.3f})"
                )
                assert abs(link["upper"] - upper) < TOL_RAD, (
                    f"{name}: {link['joint']} upper limit is {link['upper']} in the table "
                    f"and {upper} in the model (ratio {link['upper'] / upper if upper else float('nan'):.3f})"
                )


class TestHeadSite:
    def test_the_eye_point_is_the_head_camera_site_in_the_torso_frame(self, sim, table, poses):
        model, data = sim
        # Under a bent waist too: the eye point is a constant in the TORSO frame,
        # and the headset mapping would be wrong the moment it stopped being one.
        for label in ("zeros", "spread0"):
            _apply(model, data, poses[label])
            sid = mujoco.mj_name2id(model, mujoco.mjtObj.mjOBJ_SITE, "head_camera_site")
            assert sid >= 0, "the model has no head_camera_site any more"
            torso_pos, torso_rot = _body_frame(model, data, "torso_link")
            want = torso_rot.T @ (np.array(data.site_xpos[sid], dtype=float) - torso_pos)
            got = np.asarray(table["head"], dtype=float)
            assert float(np.max(np.abs(got - want))) < TOL_M, (
                f"HEAD_SITE_IN_TORSO is {got} but the site sits at {want} at pose '{label}'"
            )

    def test_the_site_is_a_pure_translation_off_the_torso(self, sim, poses):
        # HEAD_SITE_IN_TORSO is three numbers and no rotation, which is only
        # enough if the site is unrotated. `head_camera` next to it IS yawed and
        # tilted -- exporting that one instead would be silently wrong.
        model, data = sim
        _apply(model, data, poses["spread1"])
        sid = mujoco.mj_name2id(model, mujoco.mjtObj.mjOBJ_SITE, "head_camera_site")
        site_rot = np.array(data.site_xmat[sid], dtype=float).reshape(3, 3)
        _, torso_rot = _body_frame(model, data, "torso_link")
        assert float(np.max(np.abs(site_rot - torso_rot))) < TOL_ROT


class TestThePosesAreWorthRunning:
    """A comparison at a pose where nothing moves proves nothing."""

    def test_the_spread_poses_actually_bend_the_joints(self, sim, table, poses):
        model, _ = sim
        for i in range(N_SPREAD_POSES):
            pose = poses[f"spread{i}"]
            assert all(abs(v) > 1e-3 for v in pose.values()), (
                f"spread{i} left a joint at zero; it is testing the identity"
            )
            for name, angle in pose.items():
                lower, upper = model.jnt_range[_jid(model, name)]
                assert lower <= angle <= upper, f"spread{i} put {name} outside its range"

    def test_the_waist_moves_so_the_torso_frame_is_not_the_world_frame(self, sim, poses):
        model, data = sim
        _apply(model, data, poses["spread0"])
        _, torso_rot = _body_frame(model, data, "torso_link")
        assert float(np.max(np.abs(torso_rot - np.eye(3)))) > 0.1, (
            "the torso is aligned with the world, so a world-frame comparison would "
            "have passed too and this suite would not be testing what it claims"
        )
