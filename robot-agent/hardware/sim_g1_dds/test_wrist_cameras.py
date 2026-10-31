"""The G1 Dex3 includes carry a left and a right wrist camera (TASK-440).

    python -m pytest robot-agent/hardware/sim_g1_dds/test_wrist_cameras.py

`sim_node.py` serves every MJCF `<camera>` by name, so a camera in the robot
include is all it takes for `/cameras` to list it and for
`/cameras/<name>/snapshot` and `/stream` to render it. Loading the scenes is the
whole test; no DDS and no renderer.

What these protect:

* **The names are the contract.** `left_wrist_camera` / `right_wrist_camera` are
  what the real sidecar serves, what the agent's camera map turns into
  `cam_left_wrist` / `cam_right_wrist`, and what the session page and the headset
  look for. A sim camera called anything else is a camera nothing downstream
  shows or records.
* **Each sits on its own wrist.** On the wrist yaw link it follows the hand; on
  any body further up it would film the forearm, and on the wrong side it would
  record the left hand into the right hand's column.
* **The head camera keeps the lowest id of the robot's cameras.** `/cameras`
  lists in model order, and the pick-place scenes have no scene camera before
  it, so `head_camera` stays first there -- the lead camera everywhere a client
  takes the first name.
* **A camera is not physics.** Removing the two cameras must compile to the same
  masses, inertias, geoms, joints and actuators: the pick-place checkpoints were
  trained and scored on this model.
* **The generated include is regenerated.** `g1_43dof_planarbase.xml` is built
  from the fixed-base include; a hand edit to one that is not carried to the
  other gives the room robot a different camera set from the pick-place robot.
"""
from __future__ import annotations

import importlib.util
import re
from pathlib import Path

import numpy as np
import pytest

mujoco = pytest.importorskip("mujoco")

MJCF = Path(__file__).resolve().parent.parent / "sim_evaluator" / "mjcf"
G1_DEX3 = MJCF / "g1_dex3"

WRIST_CAMERAS = {
    "left_wrist_camera": "left_wrist_yaw_link",
    "right_wrist_camera": "right_wrist_yaw_link",
}

# Every scene that includes a G1 Dex3 robot, and which include it uses.
G1_SCENES = [
    "g1_dex3_pickplace_scene.xml",  # fixedbase -- the sim-g1-edu-dev scene
    "g1_apple_pnp_scene.xml",  # fixedbase_realism
    "g1_dex3_room_scene.xml",  # planarbase
    "g1_dex3_house_scene.xml",  # planarbase
    "g1_warehouse_scene.xml",  # planarbase
]

# Scenes with no world camera declared before the robot include.
HEAD_FIRST_SCENES = ["g1_dex3_pickplace_scene.xml", "g1_apple_pnp_scene.xml"]

PHYSICS_FIELDS = (
    "body_parentid",
    "body_pos",
    "body_quat",
    "body_mass",
    "body_inertia",
    "body_ipos",
    "body_iquat",
    "geom_type",
    "geom_size",
    "geom_pos",
    "geom_quat",
    "geom_friction",
    "geom_contype",
    "geom_conaffinity",
    "jnt_type",
    "jnt_axis",
    "jnt_range",
    "dof_armature",
    "dof_damping",
    "dof_frictionloss",
    "actuator_gainprm",
    "actuator_biasprm",
    "actuator_ctrlrange",
    "actuator_trnid",
)


def camera_names(model) -> list:
    return [model.camera(i).name for i in range(model.ncam)]


@pytest.fixture(scope="module", params=G1_SCENES)
def scene_model(request):
    return request.param, mujoco.MjModel.from_xml_path(str(MJCF / request.param))


class TestWristCameras:
    def test_both_wrist_cameras_exist_on_their_own_wrist(self, scene_model):
        scene, model = scene_model
        for camera, body in WRIST_CAMERAS.items():
            assert camera in camera_names(model), f"{scene} has no {camera}"
            mounted_on = model.body(int(model.camera(camera).bodyid[0])).name
            assert mounted_on == body, f"{scene}: {camera} is on {mounted_on}, not {body}"

    def test_the_head_camera_comes_before_the_wrists(self, scene_model):
        scene, model = scene_model
        head = model.camera("head_camera").id
        for camera in WRIST_CAMERAS:
            assert head < model.camera(camera).id, scene

    @pytest.mark.parametrize("scene", HEAD_FIRST_SCENES)
    def test_the_pickplace_scenes_list_the_head_camera_first(self, scene):
        model = mujoco.MjModel.from_xml_path(str(MJCF / scene))
        names = camera_names(model)
        assert names[0] == "head_camera"
        assert names[-2:] == ["left_wrist_camera", "right_wrist_camera"]

    def test_each_wrist_camera_looks_along_its_fingers(self, scene_model):
        # In the wrist yaw frame the fingers point along +x. The camera looks
        # along its own -z axis; that has to point forward and down at the hand,
        # not back up the forearm.
        scene, model = scene_model
        for camera in WRIST_CAMERAS:
            quat = model.cam_quat[model.camera(camera).id]
            mat = np.zeros(9)
            mujoco.mju_quat2Mat(mat, quat)
            forward = -mat.reshape(3, 3)[:, 2]
            assert forward[0] > 0.8, f"{scene}: {camera} looks along {forward}"
            assert forward[2] < 0.0, f"{scene}: {camera} does not look down at the hand"

    def test_removing_the_wrist_cameras_changes_no_physics(self, scene_model):
        scene, with_cameras = scene_model
        spec = mujoco.MjSpec.from_file(str(MJCF / scene))
        for camera in WRIST_CAMERAS:
            spec.delete(spec.camera(camera))
        without = spec.compile()
        assert without.ncam == with_cameras.ncam - 2
        for field in PHYSICS_FIELDS:
            assert np.array_equal(getattr(without, field), getattr(with_cameras, field)), (
                f"{scene}: {field} differs"
            )


class TestIncludesAgree:
    def test_fixedbase_and_realism_mount_the_same_cameras(self):
        pattern = re.compile(r'<camera name="(?:left|right)_wrist_camera"[^>]*/>')
        fixed = pattern.findall((G1_DEX3 / "g1_43dof_fixedbase.xml").read_text())
        realism = pattern.findall((G1_DEX3 / "g1_43dof_fixedbase_realism.xml").read_text())
        assert len(fixed) == 2
        assert fixed == realism

    def test_the_planar_base_include_is_regenerated(self):
        spec = importlib.util.spec_from_file_location(
            "build_planarbase_include", G1_DEX3 / "build_planarbase_include.py"
        )
        builder = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(builder)
        source = (G1_DEX3 / "g1_43dof_fixedbase.xml").read_text()
        generated = (G1_DEX3 / "g1_43dof_planarbase.xml").read_text()
        assert builder.build(source) == generated, (
            "g1_43dof_planarbase.xml is stale: run build_planarbase_include.py"
        )
