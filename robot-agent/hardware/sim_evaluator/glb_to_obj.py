"""
@file glb_to_obj.py
@description Real-to-sim mesh pipeline: turn a scanned-room GLB/glTF into
    MuJoCo-loadable collision geometry. MuJoCo loads OBJ/STL/MSH (not GLB) AND
    replaces every mesh geom with its CONVEX HULL — so a single room-shell mesh
    collapses the concave interior into a solid block you can't walk into. The
    fix is GLB -> OBJ (trimesh) -> CoACD convex decomposition into a union of
    convex collision pieces, kept separate from one decimated visual mesh.

This module owns the GLB->OBJ conversion and the convex decomposition. It is
heavy + optional: `trimesh`/`coacd` are import-guarded so the evaluator still
boots without them (scene_builder then degrades to the occupancy/AABB walls,
never crashing). `scene_builder.py` consumes the resulting collision/visual mesh
paths; the single world->MJCF transform stays defined there.

@feature simulation
@status live
"""

from __future__ import annotations

import logging
import math
from dataclasses import dataclass, field
from pathlib import Path

logger = logging.getLogger(__name__)

# A converted mesh whose convex-decomposed solid volume occupies more than this
# fraction of its own AABB is treated as a SOLID BLOCK, not a walkable room
# (e.g. the twin-builder's `bounds-box` placeholder GLB). The pipeline then
# defers to the occupancy/AABB wall path so the robot is never trapped.
_SOLIDITY_MAX_DEFAULT = 0.6
# A mesh with no more faces than this is a trivial placeholder (a box is 12) —
# skip conversion entirely and fall back, cheaply.
_TRIVIAL_FACE_MAX = 12
# CoACD concavity threshold (lower = finer/more pieces). 0.05 is CoACD's own
# default; 0.08 trades a little fidelity for fewer pieces / faster sim.
_THRESHOLD_DEFAULT = 0.08
# Hard cap on convex pieces so a noisy scan can't explode the contact count.
_MAX_PARTS_DEFAULT = 64
# CoACD voxel resolution for its manifold preprocess (lower = faster/coarser).
_PREPROCESS_RES_DEFAULT = 40


class MeshDepsMissing(RuntimeError):
    """Raised when trimesh/coacd are needed but not installed."""


@dataclass
class RoomCollision:
    """Result of converting + decomposing a room mesh for MuJoCo.

    `collision_mesh_paths` is empty when the mesh was rejected (trivial/solid/
    failed) — the caller then falls back to occupancy/AABB walls. `deferred`
    records *why* it was rejected, for logging.
    """

    collision_mesh_paths: list[str] = field(default_factory=list)
    visual_mesh_path: str | None = None
    n_parts: int = 0
    solidity: float = 0.0
    rotated_y_up: bool = False
    units_scale: float = 1.0
    deferred: str | None = None  # non-None => caller should use walls instead


# --------------------------------------------------------------------------- deps
def _trimesh():
    try:
        import trimesh  # type: ignore[import-not-found]

        return trimesh
    except ImportError as e:  # pragma: no cover - exercised via fallback path
        raise MeshDepsMissing(
            "trimesh not installed — cannot convert GLB. `uv pip install trimesh scipy`"
        ) from e


def _coacd():
    try:
        import coacd  # type: ignore[import-not-found]

        return coacd
    except ImportError as e:  # pragma: no cover - exercised via fallback path
        raise MeshDepsMissing(
            "coacd not installed — cannot decompose room mesh. `uv pip install coacd`"
        ) from e


# --------------------------------------------------------------------------- load + frame
def load_mesh(path: str | Path):
    """Load a mesh file (GLB/glTF/OBJ/STL/PLY) as a single concatenated Trimesh.

    A GLB imports as a multi-geometry Scene; `force='mesh'` applies the scene
    graph node transforms and concatenates everything into one mesh in the
    file's own coordinate frame.
    """
    tm = _trimesh()
    mesh = tm.load(str(path), force="mesh")
    if mesh is None or not hasattr(mesh, "vertices") or len(mesh.vertices) == 0:
        raise ValueError(f"mesh {path} loaded empty")
    return mesh


def _declared_extents(aabb: tuple[float, float, float, float, float, float]):
    min_x, min_y, min_z, max_x, max_y, max_z = aabb
    return (
        max(max_x - min_x, 1e-6),
        max(max_y - min_y, 1e-6),
        max(max_z - min_z, 1e-6),
    )


def _yup_to_zup_matrix():
    """+90° about X: glTF Y-up -> MuJoCo Z-up. Maps (x,y,z) -> (x,-z,y)."""
    tm = _trimesh()
    return tm.transformations.rotation_matrix(math.pi / 2.0, [1.0, 0.0, 0.0])


def _choose_yup(mesh, aabb) -> bool:
    """Auto-detect whether the mesh needs a Y-up -> Z-up rotation.

    Compare the mesh's extents as-is vs. with Y/Z swapped against the twin's
    DECLARED (z-up) AABB extents, and pick whichever matches better. Grounding
    in the declared AABB sidesteps the unprovable "canonical glTF transform":
    Open3D-authored twin GLBs come out z-up already, so identity usually wins.
    """
    dx, dy, dz = _declared_extents(aabb)
    ex, ey, ez = (float(v) for v in mesh.extents)
    # identity: extents (ex,ey,ez); y-up->z-up rotation swaps the y and z extents.
    err_identity = abs(ex - dx) + abs(ey - dy) + abs(ez - dz)
    err_rotated = abs(ex - dx) + abs(ez - dy) + abs(ey - dz)
    return err_rotated < err_identity - 1e-9


def load_and_orient(
    mesh_path: str | Path,
    *,
    declared_aabb: tuple[float, float, float, float, float, float] | None = None,
    up: str = "auto",  # 'auto' | 'y' | 'z'
    scale: float = 1.0,
):
    """Load a mesh and put it in MuJoCo's z-up metric WORLD frame (no export).

    Returns (mesh, rotated_y_up). Applies an optional uniform `scale` and, when
    `up='auto'` with a `declared_aabb`, a Y-up->Z-up rotation only if it better
    matches that AABB. Vertices stay in world coords so scene_builder's planar
    recenter aligns them with the occupancy/zones/AABB.
    """
    mesh = load_mesh(mesh_path)
    if scale and scale != 1.0:
        mesh.apply_scale(scale)
    rotate = up == "y" or (
        up == "auto" and declared_aabb is not None and _choose_yup(mesh, declared_aabb)
    )
    if rotate:
        mesh.apply_transform(_yup_to_zup_matrix())
    return mesh, rotate


def convert_glb_to_obj(
    glb_path: str | Path,
    out_obj: str | Path,
    *,
    declared_aabb: tuple[float, float, float, float, float, float] | None = None,
    up: str = "auto",  # 'auto' | 'y' | 'z'
    scale: float = 1.0,
) -> tuple[str, bool]:
    """Convert a GLB/glTF (or any mesh) to an OBJ in MuJoCo's z-up metric frame.

    Thin file-writing wrapper over load_and_orient(); returns (obj_path,
    rotated_y_up).
    """
    mesh, rotate = load_and_orient(glb_path, declared_aabb=declared_aabb, up=up, scale=scale)
    out = Path(out_obj)
    out.parent.mkdir(parents=True, exist_ok=True)
    mesh.export(str(out))  # extension drives format; .obj => Wavefront OBJ
    logger.info(
        "Converted %s -> %s (%d verts, %d faces, rotated_y_up=%s)",
        glb_path, out, len(mesh.vertices), len(mesh.faces), rotate,
    )
    return str(out), rotate


# --------------------------------------------------------------------------- decompose
def _part_volume(tm, verts, faces) -> float:
    try:
        return abs(float(tm.Trimesh(vertices=verts, faces=faces).volume))
    except Exception:  # noqa: BLE001 - degenerate part => ignore its volume
        return 0.0


def decompose_mesh(
    obj_path: str | Path | None,
    out_dir: str | Path,
    *,
    mesh=None,
    threshold: float = _THRESHOLD_DEFAULT,
    max_parts: int = _MAX_PARTS_DEFAULT,
    preprocess_resolution: int = _PREPROCESS_RES_DEFAULT,
    seed: int = 0,
) -> tuple[list[str], float]:
    """CoACD-decompose a mesh into convex OBJ pieces. Returns (paths, solidity).

    Pass either `obj_path` (loaded from disk) or an in-memory `mesh`. `solidity`
    = sum(part volume) / AABB volume — used by the caller's solidity guard. CoACD
    is seeded for reproducibility and voxelizes internally, so the input need not
    be watertight/manifold (scanned shells are neither).
    """
    tm = _trimesh()
    coacd = _coacd()
    coacd.set_log_level("error")

    if mesh is None:
        mesh = load_mesh(obj_path)
    cmesh = coacd.Mesh(mesh.vertices, mesh.faces)
    parts = coacd.run_coacd(
        cmesh,
        threshold=threshold,
        max_convex_hull=max_parts,
        preprocess_resolution=preprocess_resolution,
        merge=True,
        seed=seed,
    )

    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    # Pre-clean stale pieces: filenames are fixed (collision_NNN.obj), so a
    # re-decompose that yields FEWER parts would otherwise leave orphaned
    # higher-index files that an older MJCF still references by absolute path.
    _cleanup_glob(out)
    paths: list[str] = []
    solid = 0.0
    for i, (verts, faces) in enumerate(parts):
        p = out / f"collision_{i:03d}.obj"
        tm.Trimesh(vertices=verts, faces=faces).export(str(p))
        paths.append(str(p))
        solid += _part_volume(tm, verts, faces)

    ex, ey, ez = (max(float(v), 1e-6) for v in mesh.extents)
    aabb_vol = ex * ey * ez
    solidity = solid / aabb_vol if aabb_vol > 0 else 1.0
    logger.info("CoACD: %d parts, solidity=%.3f (thr=%.3f)", len(paths), solidity, threshold)
    return paths, solidity


# --------------------------------------------------------------------------- orchestrator
def build_room_collision(
    mesh_path: str | Path,
    out_dir: str | Path,
    *,
    declared_aabb: tuple[float, float, float, float, float, float] | None = None,
    up: str = "auto",
    scale: float = 1.0,
    threshold: float = _THRESHOLD_DEFAULT,
    max_parts: int = _MAX_PARTS_DEFAULT,
    preprocess_resolution: int = _PREPROCESS_RES_DEFAULT,
    solidity_max: float = _SOLIDITY_MAX_DEFAULT,
    seed: int = 0,
) -> RoomCollision:
    """Full pipeline: (GLB->OBJ if needed) -> CoACD -> collision + visual meshes.

    NEVER raises: any failure (missing deps, bad mesh, solid/trivial mesh) is
    reported via `RoomCollision.deferred` with empty `collision_mesh_paths` so
    the caller falls back to occupancy/AABB walls. Writes all artifacts under
    `out_dir`. The visual mesh is the full-resolution converted OBJ (group-2,
    no-contact in MuJoCo); collision is the union of convex pieces.
    """
    out = Path(out_dir)
    try:
        _trimesh()
    except MeshDepsMissing as e:
        return RoomCollision(deferred=str(e))

    try:
        # 1) Load + orient once (GLB or OBJ/STL) into the z-up metric world frame.
        mesh, rotated = load_and_orient(
            mesh_path, declared_aabb=declared_aabb, up=up, scale=scale
        )

        # 2) Trivial-placeholder guard BEFORE writing anything: a box (≤12 faces)
        #    is the twin-builder's `bounds-box` fallback, never a real room.
        if len(mesh.faces) <= _TRIVIAL_FACE_MAX:
            return RoomCollision(
                rotated_y_up=rotated,
                deferred=f"mesh is a {len(mesh.faces)}-face placeholder (not a real scan)",
            )

        # 3) Convex decomposition (in-memory mesh — no redundant re-load).
        paths, solidity = decompose_mesh(
            None, out, mesh=mesh, threshold=threshold, max_parts=max_parts,
            preprocess_resolution=preprocess_resolution, seed=seed,
        )

        # 4) Solidity guard: a mesh that fills most of its own AABB is a solid
        #    block, not a walkable room — occupancy walls are strictly better.
        if not paths:
            _cleanup(paths)
            return RoomCollision(
                rotated_y_up=rotated, solidity=solidity,
                deferred="decomposition produced no parts",
            )
        if solidity > solidity_max:
            _cleanup(paths)  # don't leave orphan collision pieces for a rejected mesh
            return RoomCollision(
                rotated_y_up=rotated, n_parts=len(paths), solidity=solidity,
                deferred=f"mesh is solid (solidity {solidity:.2f} > {solidity_max:.2f}); using walls",
            )

        # 5) Accepted — only now write the full-res visual mesh.
        visual_obj = out / "room_visual.obj"
        mesh.export(str(visual_obj))
        return RoomCollision(
            collision_mesh_paths=paths,
            visual_mesh_path=str(visual_obj),
            n_parts=len(paths),
            solidity=solidity,
            rotated_y_up=rotated,
            units_scale=scale,
        )
    except MeshDepsMissing as e:
        _cleanup_glob(out)  # an export may have raised mid-loop; paths is unbound here
        return RoomCollision(deferred=str(e))
    except Exception as e:  # noqa: BLE001 - real-to-sim must degrade, never crash
        _cleanup_glob(out)  # don't leave half-written pieces for a rejected mesh
        logger.warning("Room mesh pipeline failed for %s: %s", mesh_path, e)
        return RoomCollision(deferred=f"mesh pipeline error: {e}")


def _cleanup(paths: list[str]) -> None:
    for p in paths:
        try:
            Path(p).unlink(missing_ok=True)
        except OSError:
            pass


def _cleanup_glob(out_dir: str | Path) -> None:
    """Best-effort remove every collision/visual piece under out_dir.

    Used on the error path (where the written-paths list may be unbound after a
    mid-loop export raise) and as a pre-clean before a fresh decomposition.
    """
    out = Path(out_dir)
    if not out.exists():
        return
    for pattern in ("collision_*.obj", "room_visual.obj"):
        for p in out.glob(pattern):
            try:
                p.unlink()
            except OSError:
                pass
