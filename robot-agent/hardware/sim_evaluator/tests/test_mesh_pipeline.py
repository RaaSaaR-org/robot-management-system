"""
@file test_mesh_pipeline.py
@description Tests for the TASK-173 GLB->MuJoCo room-collision pipeline:
    glb_to_obj conversion (axis/scale), CoACD decomposition + solidity/trivial
    guards, scene_builder's decomposed-geom emission, and the CONCAVITY
    REGRESSION — the bug the whole task exists to prevent: a single room-shell
    mesh is convex-hulled into a solid block, while the decomposition keeps the
    interior hollow so a body falls inside it.

Heavy deps are import-skipped PER TEST, not module-wide: the two pure
scene_builder tests (geom emission + determinism) run with no extra deps, while
the GLB/decomposition tests skip individually when trimesh/coacd/mujoco are
absent. scene_builder imports glb_to_obj lazily, so this module collects without
trimesh installed.
"""

from __future__ import annotations

import sys
import xml.etree.ElementTree as ET
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from scene_builder import TwinSceneInput, build_scene_xml  # noqa: E402


def _trimesh():
    """Import trimesh or skip the calling test (kept out of module scope so the
    pure scene_builder tests below collect + run without trimesh)."""
    return pytest.importorskip("trimesh", reason="mesh pipeline needs trimesh")


# --------------------------------------------------------------------------- helpers
def _open_box_shell(sx=4.0, sy=3.0, sz=2.5, t=0.1):
    """A CONCAVE room: floor + 4 walls, OPEN top (no lid). Its convex hull is a
    solid block (volume == sx*sy*sz); only decomposition keeps it hollow."""
    trimesh = _trimesh()
    T = trimesh.transformations.translation_matrix
    parts = [
        trimesh.creation.box([sx, sy, t], T([0, 0, t / 2])),
        trimesh.creation.box([t, sy, sz], T([-sx / 2 + t / 2, 0, sz / 2])),
        trimesh.creation.box([t, sy, sz], T([sx / 2 - t / 2, 0, sz / 2])),
        trimesh.creation.box([sx, t, sz], T([0, -sy / 2 + t / 2, sz / 2])),
        trimesh.creation.box([sx, t, sz], T([0, sy / 2 - t / 2, sz / 2])),
    ]
    return trimesh.util.concatenate(parts)


def _export_glb(mesh, path: Path) -> str:
    mesh.export(str(path))
    return str(path)


# AABB of the open-box shell: centered at origin, z in [0, 2.5].
_SHELL_AABB = (-2.0, -1.5, 0.0, 2.0, 1.5, 2.5)


# --------------------------------------------------------------------------- glb_to_obj
def test_glb_roundtrip_preserves_axes_and_scale(tmp_path):
    """trimesh round-trips an Open3D-style GLB without a silent Y<->Z swap."""
    from glb_to_obj import convert_glb_to_obj, load_mesh

    glb = _export_glb(_open_box_shell(), tmp_path / "room.glb")
    obj, rotated = convert_glb_to_obj(glb, tmp_path / "room.obj", declared_aabb=_SHELL_AABB)
    assert Path(obj).exists()
    assert rotated is False  # already z-up => no rotation
    m = load_mesh(obj)
    ext = [round(float(v), 2) for v in m.extents]
    assert ext == [4.0, 3.0, 2.5], f"extents drifted: {ext}"


def test_auto_align_rotates_a_yup_mesh(tmp_path):
    """A Y-up GLB + a z-up declared AABB => converter rotates it back to z-up."""
    import math

    trimesh = _trimesh()
    from glb_to_obj import convert_glb_to_obj, load_mesh

    shell = _open_box_shell()  # z-up (4,3,2.5)
    # Author it Y-up: rotate -90° about X so 'up' becomes +Y -> extents (4,2.5,3).
    shell.apply_transform(trimesh.transformations.rotation_matrix(-math.pi / 2, [1, 0, 0]))
    glb = _export_glb(shell, tmp_path / "yup.glb")
    obj, rotated = convert_glb_to_obj(glb, tmp_path / "fixed.obj", declared_aabb=_SHELL_AABB)
    assert rotated is True
    ext = [round(float(v), 2) for v in load_mesh(obj).extents]
    assert ext == [4.0, 3.0, 2.5], f"auto-align failed: {ext}"


def test_trivial_box_glb_defers_to_walls(tmp_path):
    """A 12-face bounds-box placeholder (the twin-builder fallback) is rejected
    cheaply — no CoACD run, defers to occupancy/AABB walls."""
    trimesh = _trimesh()
    from glb_to_obj import build_room_collision

    box = trimesh.creation.box([4.0, 3.0, 2.5])
    glb = _export_glb(box, tmp_path / "bounds.glb")
    res = build_room_collision(glb, tmp_path / "meshes", declared_aabb=_SHELL_AABB)
    assert res.collision_mesh_paths == []
    assert res.deferred and "placeholder" in res.deferred


def test_missing_deps_defers_gracefully(tmp_path, monkeypatch):
    """If trimesh is unavailable the pipeline defers instead of crashing."""
    import glb_to_obj

    def _boom():
        raise glb_to_obj.MeshDepsMissing("trimesh not installed")

    monkeypatch.setattr(glb_to_obj, "_trimesh", _boom)
    res = glb_to_obj.build_room_collision(tmp_path / "x.glb", tmp_path / "m", declared_aabb=_SHELL_AABB)
    assert res.collision_mesh_paths == []
    assert res.deferred


def test_coacd_missing_defers_gracefully(tmp_path, monkeypatch):
    """trimesh present but coacd absent: a real (>12-face) shell reaches
    decompose_mesh, _coacd() raises MeshDepsMissing, and the pipeline defers to
    walls instead of crashing. Exercises the heavier native dep's missing path."""
    _trimesh()  # skip if trimesh itself is absent (we need it to write the GLB)
    import glb_to_obj

    glb = _export_glb(_open_box_shell(), tmp_path / "room.glb")

    def _boom():
        raise glb_to_obj.MeshDepsMissing("coacd not installed")

    monkeypatch.setattr(glb_to_obj, "_coacd", _boom)
    res = glb_to_obj.build_room_collision(glb, tmp_path / "meshes", declared_aabb=_SHELL_AABB)
    assert res.collision_mesh_paths == []
    assert res.deferred and "coacd" in res.deferred


# --------------------------------------------------------------------------- scene emission (pure)
def test_scene_emits_decomposed_collision_and_visual_geoms():
    """build_scene_xml emits N collision geoms (contype=1) + 1 visual geom
    (contype=0) when given decomposed mesh paths — no MuJoCo/coacd needed."""
    scene = TwinSceneInput(
        aabb=_SHELL_AABB,
        collision_mesh_paths=["/tmp/a.obj", "/tmp/b.obj", "/tmp/c.obj"],
        visual_mesh_path="/tmp/visual.obj",
    )
    root = ET.fromstring(build_scene_xml(scene))
    col = [g for g in root.iter("geom") if (g.get("name") or "").startswith("room_col_")]
    assert len(col) == 3, f"expected 3 collision geoms, got {len(col)}"
    for g in col:
        assert g.get("contype") == "1" and g.get("conaffinity") == "1"
        assert g.get("type") == "mesh"
    visual = [g for g in root.iter("geom") if g.get("name") == "room_visual"]
    assert len(visual) == 1
    assert visual[0].get("contype") == "0" and visual[0].get("conaffinity") == "0"
    # 3 collision + 1 visual mesh assets registered.
    meshes = {m.get("name") for m in root.iter("mesh")}
    assert {"room_col_0", "room_col_1", "room_col_2", "room_visual"} <= meshes
    # No perimeter wall fallback when decomposed pieces are present.
    walls = [g for g in root.iter("geom") if (g.get("name") or "").startswith("wall_")]
    assert walls == []


def test_decomposed_scene_is_deterministic():
    scene = TwinSceneInput(
        aabb=_SHELL_AABB,
        collision_mesh_paths=["/tmp/a.obj", "/tmp/b.obj"],
        visual_mesh_path="/tmp/v.obj",
    )
    assert build_scene_xml(scene) == build_scene_xml(scene)


# --------------------------------------------------------------------------- decomposition + physics
@pytest.mark.slow
def test_decompose_open_shell_is_hollow(tmp_path):
    """CoACD turns the open-box shell into >1 convex piece whose total volume is
    far below the AABB (interior stays hollow) => below the solidity guard."""
    coacd = pytest.importorskip("coacd", reason="needs coacd")  # noqa: F841
    from glb_to_obj import build_room_collision

    glb = _export_glb(_open_box_shell(), tmp_path / "room.glb")
    res = build_room_collision(glb, tmp_path / "meshes", declared_aabb=_SHELL_AABB)
    assert res.collision_mesh_paths, f"deferred unexpectedly: {res.deferred}"
    assert res.n_parts >= 2, f"expected multiple convex pieces, got {res.n_parts}"
    assert res.solidity < 0.6, f"shell should be hollow, solidity={res.solidity}"
    for p in res.collision_mesh_paths:
        assert Path(p).exists()
    assert res.visual_mesh_path and Path(res.visual_mesh_path).exists()


@pytest.mark.slow
def test_solid_block_defers_via_solidity_guard(tmp_path):
    """An AABB-filling SOLID block (not a hollow room) clears the trivial-face
    guard but trips the solidity guard => rejected, pieces cleaned up, walls used.
    This is the safety branch that keeps the robot from being trapped in a block."""
    trimesh = _trimesh()
    pytest.importorskip("coacd", reason="needs coacd")
    from glb_to_obj import build_room_collision

    # Subdivided closed cube: >12 faces (clears the trivial guard) and solid
    # (solidity ≈ 1.0). A sphere would be π/6≈0.52 < 0.6 and wrongly accepted —
    # a filled cube is the correct AABB-filling solid.
    box = trimesh.creation.box([3.0, 3.0, 3.0]).subdivide()
    glb = _export_glb(box, tmp_path / "solid.glb")
    out = tmp_path / "meshes"
    res = build_room_collision(glb, out, declared_aabb=(-1.5, -1.5, -1.5, 1.5, 1.5, 1.5))
    assert res.collision_mesh_paths == [], "solid block must not become collision geometry"
    assert res.deferred and "solid" in res.deferred
    assert res.solidity > 0.6, f"expected a solid block, solidity={res.solidity}"
    # Rejected pieces must be cleaned up — no orphan collision_*.obj left behind.
    assert list(out.glob("collision_*.obj")) == []


@pytest.mark.slow
def test_concavity_regression_body_falls_inside(tmp_path):
    """THE regression. Drop a sphere from above an open-box room:
      * single-hull collision  => solid block, sphere lands on TOP (z high);
      * CoACD decomposition     => open top, sphere falls THROUGH to the floor.
    Asserts the decomposed final height is far below the hull's."""
    pytest.importorskip("coacd", reason="needs coacd")
    mujoco = pytest.importorskip("mujoco", reason="needs mujoco")
    from glb_to_obj import build_room_collision, convert_glb_to_obj

    glb = _export_glb(_open_box_shell(), tmp_path / "room.glb")
    res = build_room_collision(glb, tmp_path / "meshes", declared_aabb=_SHELL_AABB)
    assert res.collision_mesh_paths, f"deferred: {res.deferred}"
    # A single-mesh OBJ for the hull (solid-block) baseline.
    hull_obj, _ = convert_glb_to_obj(glb, tmp_path / "hull.obj", declared_aabb=_SHELL_AABB)

    def _settle(asset_xml: str, body_xml: str) -> float:
        xml = f"""<mujoco>
          <option timestep="0.002" gravity="0 0 -9.81"/>
          <asset>{asset_xml}</asset>
          <worldbody>
            <!-- Ground sits FAR below the room (z=-5) so it can't backstop the
                 ball: in the decomposed run the ball must come to rest on a real
                 floor PIECE (~0.25), not on this plane. The hull baseline rests
                 on the solid block at ~2.65 and is unaffected. -->
            <geom name="ground" type="plane" size="0 0 0.05" pos="0 0 -5"/>
            {body_xml}
            <body name="ball" pos="0 0 3.4">
              <freejoint/>
              <geom type="sphere" size="0.15" mass="1"/>
            </body>
          </worldbody>
        </mujoco>"""
        m = mujoco.MjModel.from_xml_string(xml)
        d = mujoco.MjData(m)
        for _ in range(2500):
            mujoco.mj_step(m, d)
        return float(d.body("ball").xpos[2])

    # Decomposed: N convex collision geoms (open top).
    dec_assets = "".join(
        f'<mesh name="c{i}" file="{p}"/>' for i, p in enumerate(res.collision_mesh_paths)
    )
    dec_body = "".join(
        f'<geom type="mesh" mesh="c{i}" contype="1" conaffinity="1"/>'
        for i in range(len(res.collision_mesh_paths))
    )
    z_decomposed = _settle(dec_assets, dec_body)

    # Hull: one mesh geom — MuJoCo replaces it with its convex hull (solid block).
    z_hull = _settle('<mesh name="h" file="%s"/>' % hull_obj,
                     '<geom type="mesh" mesh="h" contype="1" conaffinity="1"/>')

    # Lower bound 0.1: the ball must rest ON a decomposed floor piece (~0.25), not
    # fall past it — a non-colliding / mis-scaled / degenerate decomposition would
    # let it drop toward the z=-5 ground and fail here.
    assert 0.1 < z_decomposed < 0.6, (
        f"ball should rest on a real floor piece inside, got z={z_decomposed:.3f}"
    )
    assert z_hull > 1.5, f"hull should trap the ball up high, got z={z_hull:.3f}"
    assert z_hull - z_decomposed > 1.0, (
        f"decomposition must let the ball fall inside: hull z={z_hull:.3f}, "
        f"decomposed z={z_decomposed:.3f}"
    )


@pytest.mark.slow
def test_full_twin_scene_loads_in_mujoco(tmp_path):
    """End-to-end: a full scene_builder scene with decomposed room collision +
    the G1 include loads in MuJoCo without error."""
    pytest.importorskip("coacd", reason="needs coacd")
    mujoco = pytest.importorskip("mujoco", reason="needs mujoco")
    from glb_to_obj import build_room_collision
    from scene_builder import write_scene

    glb = _export_glb(_open_box_shell(), tmp_path / "room.glb")
    here = Path(__file__).resolve().parent.parent
    mesh_dir = here / "mjcf" / "_test_room_meshes"
    res = build_room_collision(glb, mesh_dir, declared_aabb=_SHELL_AABB)
    assert res.collision_mesh_paths, f"deferred: {res.deferred}"

    scene_path = here / "mjcf" / "_test_twin_scene.xml"
    try:
        scene = TwinSceneInput(
            aabb=_SHELL_AABB,
            collision_mesh_paths=res.collision_mesh_paths,
            visual_mesh_path=res.visual_mesh_path,
        )
        write_scene(scene, str(scene_path), g1_include="g1/g1_29dof.xml")
        m = mujoco.MjModel.from_xml_path(str(scene_path))
        assert m.ngeom > len(res.collision_mesh_paths)  # room + G1 + floor
    finally:
        scene_path.unlink(missing_ok=True)
        for p in mesh_dir.glob("*.obj"):
            p.unlink(missing_ok=True)
        if mesh_dir.exists():
            mesh_dir.rmdir()
