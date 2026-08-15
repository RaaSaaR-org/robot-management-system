"""Geometry tests for the sim's ray-cast LiDAR (`sim_node.cast_lidar`).

The robot-agent's range sensing (src/agent-mode/range.ts) and the occupancy map
(TASK-206) consume `/pointcloud/mid360_lidar/snapshot`, and both take the cloud
at its word: a point IS a surface, a missing return is UNKNOWN. So the one thing
this facade must never do is put a surface where the MJCF has none, or put the
right surface at the wrong range. These tests pin the cast down against the
scene's own geometry, with no DDS in the loop:

* the room scene returns points at all;
* nothing survives inside `LIDAR_MIN_RANGE` of the sensor origin;
* the nearest surface straight ahead is the table's front face, at the range
  the MJCF says it is (table body pos + table_top half-size), to within 0.1 m --
  the same tolerance the navigator's stop-short logic works in;
* the robot never sees itself: no point inside its own footprint cylinder.

The cast is exercised through `_cast_ray_fan`, the pure function `cast_lidar`
wraps, so the test needs MuJoCo but no `ChannelFactoryInitialize` and no
cyclonedds runtime. Importing `sim_node` does pull in `unitree_sdk2py`, so the
test skips (never errors) when that is not installed. Run with the venv from
README.md:

    .venv/bin/python -m pytest test_lidar.py -q
"""
from __future__ import annotations

import math
import sys
from pathlib import Path

import pytest

mujoco = pytest.importorskip("mujoco")
np = pytest.importorskip("numpy")

sys.path.insert(0, str(Path(__file__).resolve().parent))
sim_node = pytest.importorskip("sim_node")  # needs unitree_sdk2py at import time

SCENE = sim_node.DEFAULT_SCENE  # ../sim_evaluator/mjcf/g1_dex3_room_scene.xml

# Where the robot stands for the head-on measurement: 2 m back from the table's
# front face, centred on it, facing +x (the table sits at +x in the room).
STANDOFF_M = 2.0
# Bearing cone and height band the consumer (range.ts) uses to pick a surface.
BEARING_TOL_DEG = 3.0
BAND_Z = (0.15, 1.8)
# Footprint the robot must not report returns inside of (self-hits).
ROBOT_RADIUS_M = 0.30
TABLE_TOL_M = 0.10


@pytest.fixture(scope="module")
def scene():
    if not SCENE.exists():
        pytest.skip(f"scene not found: {SCENE}")
    model = mujoco.MjModel.from_xml_path(str(SCENE))
    data = mujoco.MjData(model)
    mujoco.mj_forward(model, data)
    return model, data


def _table_front_x(model) -> float:
    """World x of the table's -x face, straight from the MJCF geometry."""
    body = mujoco.mj_name2id(model, mujoco.mjtObj.mjOBJ_BODY, "table")
    top = mujoco.mj_name2id(model, mujoco.mjtObj.mjOBJ_GEOM, "table_top")
    assert body >= 0 and top >= 0, "room scene has no table/table_top"
    return float(model.body_pos[body][0] + model.geom_pos[top][0] - model.geom_size[top][0])


def _table_y(model) -> float:
    body = mujoco.mj_name2id(model, mujoco.mjtObj.mjOBJ_BODY, "table")
    return float(model.body_pos[body][1])


def _place(model, data, x: float, y: float, yaw: float) -> None:
    for name, val in zip(("base_x", "base_y", "base_yaw"), (x, y, yaw)):
        jid = mujoco.mj_name2id(model, mujoco.mjtObj.mjOBJ_JOINT, name)
        assert jid >= 0, f"scene has no planar base joint {name}"
        data.qpos[model.jnt_qposadr[jid]] = val
    mujoco.mj_forward(model, data)


def _cast(model, data, x: float, y: float, yaw: float, **overrides) -> dict:
    """What `SimNode.cast_lidar` does, minus the DDS-bearing constructor."""
    site = mujoco.mj_name2id(model, mujoco.mjtObj.mjOBJ_SITE, sim_node.LIDAR_SITE)
    assert site >= 0, f"scene has no '{sim_node.LIDAR_SITE}' site"
    origin = np.array(data.site_xpos[site], dtype=np.float64)
    pelvis = mujoco.mj_name2id(model, mujoco.mjtObj.mjOBJ_BODY, "pelvis")
    mask, _desc = sim_node._robot_geom_mask(model)
    assert mask is not None, "robot geoms share a group with scene props -- self-filter off"
    params = dict(
        n_azimuth=sim_node.LIDAR_AZIMUTH_RAYS,
        n_elevation=sim_node.LIDAR_ELEVATION_RINGS,
        elev_min_deg=sim_node.LIDAR_ELEV_MIN_DEG,
        elev_max_deg=sim_node.LIDAR_ELEV_MAX_DEG,
        min_range=sim_node.LIDAR_MIN_RANGE,
        max_range=sim_node.LIDAR_MAX_RANGE,
        max_points=sim_node.LIDAR_MAX_POINTS,
    )
    params.update(overrides)
    return sim_node._cast_ray_fan(model, data, origin, x, y, yaw,
                                  bodyexclude=pelvis, geomgroup=mask, **params)


@pytest.fixture(scope="module")
def facing_table(scene):
    """Robot 2 m in front of the table's front face, looking at it. Returns
    (cloud, points[N,3] in base_link, origin[3] in base_link, analytic range)."""
    model, data = scene
    x = _table_front_x(model) - STANDOFF_M
    y = _table_y(model)
    _place(model, data, x, y, 0.0)
    cloud = _cast(model, data, x, y, 0.0)
    pts = np.asarray(cloud["positions"], dtype=np.float64).reshape(-1, 3)
    origin = np.asarray(cloud["origin"], dtype=np.float64)
    # Planar range from the SENSOR (not the base) to the face: the face is at
    # base_link x = STANDOFF_M, the sensor sits origin[0] ahead of the base.
    analytic = STANDOFF_M - float(origin[0])
    return cloud, pts, origin, analytic


def test_returns_points(facing_table):
    cloud, pts, _origin, _ = facing_table
    assert cloud["point_count"] > 0
    assert pts.shape == (cloud["point_count"], 3)
    assert cloud["returns"] >= cloud["point_count"]
    assert cloud["method"] in ("mj_multiRay", "mj_ray")


def test_no_point_inside_min_range(facing_table):
    _cloud, pts, origin, _ = facing_table
    planar = np.hypot(pts[:, 0] - origin[0], pts[:, 1] - origin[1])
    assert planar.min() >= sim_node.LIDAR_MIN_RANGE, (
        f"nearest planar return {planar.min():.3f} m < LIDAR_MIN_RANGE")
    r3 = np.linalg.norm(pts - origin[None, :], axis=1)
    assert r3.min() >= sim_node.LIDAR_MIN_RANGE


def test_nearest_ahead_is_table_front_at_analytic_range(facing_table):
    _cloud, pts, origin, analytic = facing_table
    dx, dy = pts[:, 0] - origin[0], pts[:, 1] - origin[1]
    bearing = np.degrees(np.arctan2(dy, dx))
    band = (np.abs(bearing) <= BEARING_TOL_DEG) & (pts[:, 2] >= BAND_Z[0]) & (pts[:, 2] <= BAND_Z[1])
    assert band.any(), "no returns straight ahead in the height band"
    planar = np.hypot(dx, dy)[band]
    # "Nearest cluster": everything within the tolerance of the nearest return.
    nearest = planar.min()
    cluster = planar[planar <= nearest + TABLE_TOL_M]
    assert len(cluster) >= 3, f"only {len(cluster)} returns on the nearest surface ahead"
    assert abs(float(cluster.mean()) - analytic) <= TABLE_TOL_M, (
        f"nearest surface ahead at {cluster.mean():.3f} m, table front analytically at "
        f"{analytic:.3f} m")
    assert abs(nearest - analytic) <= TABLE_TOL_M


def test_no_self_hits(facing_table):
    # base_link is the frame the cast returns in, so the robot's own footprint
    # is a cylinder about (0, 0) at any height.
    _cloud, pts, _origin, _ = facing_table
    footprint = np.hypot(pts[:, 0], pts[:, 1])
    assert footprint.min() > ROBOT_RADIUS_M, (
        f"return {footprint.min():.3f} m from the base axis -- inside the robot")


def test_self_filter_is_what_keeps_the_robot_out(scene):
    """The self-hits test above passes BECAUSE of the geom-group mask, not by
    luck: with the mask off, the torso shell around the origin comes back."""
    model, data = scene
    x = _table_front_x(model) - STANDOFF_M
    y = _table_y(model)
    _place(model, data, x, y, 0.0)
    site = mujoco.mj_name2id(model, mujoco.mjtObj.mjOBJ_SITE, sim_node.LIDAR_SITE)
    origin = np.array(data.site_xpos[site], dtype=np.float64)
    pelvis = mujoco.mj_name2id(model, mujoco.mjtObj.mjOBJ_BODY, "pelvis")
    raw = sim_node._cast_ray_fan(
        model, data, origin, x, y, 0.0,
        n_azimuth=sim_node.LIDAR_AZIMUTH_RAYS, n_elevation=sim_node.LIDAR_ELEVATION_RINGS,
        elev_min_deg=sim_node.LIDAR_ELEV_MIN_DEG, elev_max_deg=sim_node.LIDAR_ELEV_MAX_DEG,
        min_range=0.0, max_range=sim_node.LIDAR_MAX_RANGE,
        max_points=sim_node.LIDAR_MAX_POINTS, bodyexclude=pelvis, geomgroup=None)
    pts = np.asarray(raw["positions"], dtype=np.float64).reshape(-1, 3)
    assert np.hypot(pts[:, 0], pts[:, 1]).min() <= ROBOT_RADIUS_M
