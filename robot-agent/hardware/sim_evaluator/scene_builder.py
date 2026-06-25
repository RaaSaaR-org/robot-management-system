"""
@file scene_builder.py
@description Real-to-sim converter: turn a NeoDEM digital-twin bundle (AABB +
    room mesh/occupancy + zones) into a MuJoCo MJCF scene with the G1 dropped in.

This is the KEYSTONE of TASK-171 Phase 1. It is pure-Python MJCF generation — it
does NOT import mujoco at module load (mujoco is optional, only for an opt-in
self-check). Output is deterministic (no random, no time) so tests can assert
exact site coordinates.

============================================================================
THE SINGLE world -> MJCF TRANSFORM (defined here and ONLY here)
============================================================================
The twin is already z-up and metric (meters), the same frame MuJoCo uses, so
there is NO rotation and NO scaling. The only transform is a planar translation
that re-centers the room so the AABB's XY-center sits at the MJCF origin and the
floor sits at z = minZ:

    cx = (minX + maxX) / 2
    cy = (minY + maxY) / 2

    mjcf_x = world_x - cx
    mjcf_y = world_y - cy
    mjcf_z = world_z            (z is preserved; floor plane is placed at minZ)

Every geom/site placement in this file applies exactly this transform via
`_to_mjcf(...)`. The G1 include is placed at its own origin (it spawns standing
near MJCF x=y=0); the SCENE is translated around the robot. If a `charging`
zone is present we additionally bias the recenter so that zone's centroid lands
near the origin, putting the spawned G1 on the charging pad.
============================================================================

@status live
"""

from __future__ import annotations

import argparse
import json
import logging
import math
import struct
from dataclasses import dataclass, field
from pathlib import Path

logger = logging.getLogger(__name__)

# Wall band (meters above floor) when extruding occupancy into box walls.
_WALL_HEIGHT_DEFAULT = 2.0
# Half-thickness of an occupancy wall cell box (meters).
_WALL_HALF_THICK = 0.03

# Zone type -> site naming prefix the G1Env reads.
_ZONE_PREFIX = {
    "charging": "zone_charging_",
    "workcell": "zone_workcell_",
    "keepout": "zone_keepout_",
    "speed": "zone_speed_",
}


@dataclass
class TwinZoneSpec:
    """One semantic zone from the twin (polygon in world XY, meters)."""

    name: str
    type: str  # 'keepout' | 'workcell' | 'charging' | 'speed'
    points: list[tuple[float, float]]  # polygon vertices in world XY (meters)
    min_z: float = 0.0
    max_z: float = 2.0


@dataclass
class TwinSceneInput:
    """Everything needed to build one sim scene from a twin."""

    # World-frame AABB: minX, minY, minZ, maxX, maxY, maxZ (meters, z-up).
    aabb: tuple[float, float, float, float, float, float]
    mesh_path: str | None = None  # path to mesh.glb room backdrop (collision-only)
    occupancy_pgm_path: str | None = None  # fallback when no mesh
    occupancy_yaml_path: str | None = None
    resolution: float = 0.05
    zones: list[TwinZoneSpec] = field(default_factory=list)
    embodiment: str = "g1"  # which robot to include


# --------------------------------------------------------------------------- helpers
def _sanitize(name: str) -> str:
    """Make an arbitrary zone name safe for an MJCF identifier."""
    out = []
    for ch in name:
        out.append(ch if (ch.isalnum() or ch in "_-") else "_")
    s = "".join(out).strip("_")
    return s or "zone"


def _fmt(v: float) -> str:
    """Deterministic fixed-precision float formatting for MJCF attributes."""
    # Round to 6 dp, strip trailing zeros, normalise -0.0 -> 0.
    r = round(float(v) + 0.0, 6)
    if r == 0:
        r = 0.0
    s = f"{r:.6f}".rstrip("0").rstrip(".")
    return s if s not in ("", "-0") else "0"


def _polygon_centroid_bbox(
    points: list[tuple[float, float]],
) -> tuple[float, float, float, float, float, float]:
    """Return (cx, cy, half_x, half_y, min_x, min_y) for a polygon's XY bbox.

    Uses the bbox center (not the area centroid) so a rectangular zone's site is
    centered on the rectangle — deterministic and matches how the env reasons
    about a box zone.
    """
    xs = [p[0] for p in points]
    ys = [p[1] for p in points]
    min_x, max_x = min(xs), max(xs)
    min_y, max_y = min(ys), max(ys)
    cx = (min_x + max_x) / 2.0
    cy = (min_y + max_y) / 2.0
    half_x = max((max_x - min_x) / 2.0, 1e-3)
    half_y = max((max_y - min_y) / 2.0, 1e-3)
    return cx, cy, half_x, half_y, min_x, min_y


def _recenter_offset(
    scene: TwinSceneInput,
) -> tuple[float, float]:
    """Compute (cx, cy): the world XY point that maps to the MJCF origin.

    Default: the AABB XY center. If a `charging` zone is present, bias toward its
    bbox center so the spawned G1 (at MJCF origin) stands on the charging pad.
    """
    min_x, min_y, _min_z, max_x, max_y, _max_z = scene.aabb
    cx = (min_x + max_x) / 2.0
    cy = (min_y + max_y) / 2.0
    for z in scene.zones:
        if z.type == "charging" and z.points:
            zcx, zcy, *_ = _polygon_centroid_bbox(z.points)
            return zcx, zcy
    return cx, cy


# --------------------------------------------------------------------------- PGM parse
def _parse_pgm_occupied_cells(
    pgm_path: Path,
    resolution: float,
    occupancy_yaml_path: str | None,
) -> tuple[list[tuple[float, float]], float] | None:
    """Parse a binary P5 PGM into a list of occupied (world_x, world_y) cell
    centers. Occupied = dark pixels (ROS map_server convention: 0 = occupied).

    Returns (cell_centers, resolution) or None if the file can't be parsed.
    The map origin (lower-left, world) is read from the YAML `origin:` if given,
    else assumed (0,0). Row 0 of the PGM is the TOP of the image (see
    twin-builder occupancy.py), so we flip Y back to world.
    """
    try:
        raw = pgm_path.read_bytes()
    except OSError as e:  # noqa: BLE001
        logger.warning("Could not read occupancy PGM %s: %s", pgm_path, e)
        return None
    if not raw.startswith(b"P5"):
        logger.warning("Occupancy PGM %s is not a binary P5 file", pgm_path)
        return None

    # Parse the ASCII header: P5 <width> <height> <maxval>, then raw bytes.
    tokens: list[bytes] = []
    i = 2
    n = len(raw)
    while len(tokens) < 3 and i < n:
        # skip whitespace + comment lines
        while i < n and raw[i : i + 1].isspace():
            i += 1
        if i < n and raw[i : i + 1] == b"#":
            while i < n and raw[i : i + 1] != b"\n":
                i += 1
            continue
        start = i
        while i < n and not raw[i : i + 1].isspace():
            i += 1
        tokens.append(raw[start:i])
    if len(tokens) < 3:
        logger.warning("Occupancy PGM %s header malformed", pgm_path)
        return None
    # single whitespace byte after maxval before pixel data
    i += 1
    try:
        width = int(tokens[0])
        height = int(tokens[1])
    except ValueError:
        logger.warning("Occupancy PGM %s has non-integer dimensions", pgm_path)
        return None

    body = raw[i : i + width * height]
    if len(body) < width * height:
        logger.warning("Occupancy PGM %s body truncated", pgm_path)
        return None

    # Map origin (lower-left corner in world) from YAML if present.
    origin_x, origin_y = 0.0, 0.0
    res = resolution
    if occupancy_yaml_path:
        try:
            text = Path(occupancy_yaml_path).read_text(encoding="ascii")
            for line in text.splitlines():
                key, _, val = line.partition(":")
                key = key.strip()
                val = val.strip()
                if key == "resolution":
                    res = float(val)
                elif key == "origin" and val.startswith("[") and val.endswith("]"):
                    parts = [p.strip() for p in val[1:-1].split(",")]
                    if len(parts) >= 2:
                        origin_x = float(parts[0])
                        origin_y = float(parts[1])
        except (OSError, ValueError) as e:  # noqa: BLE001
            logger.warning("Could not parse occupancy YAML %s: %s", occupancy_yaml_path, e)

    cells: list[tuple[float, float]] = []
    occupied_thresh = 64  # treat dark cells (< 64) as occupied
    for row in range(height):
        # Row 0 = top of image => largest world Y. Flip back.
        py_world = height - 1 - row
        base = row * width
        for col in range(width):
            if body[base + col] < occupied_thresh:
                wx = origin_x + (col + 0.5) * res
                wy = origin_y + (py_world + 0.5) * res
                cells.append((wx, wy))
    return cells, res


# --------------------------------------------------------------------------- XML build
def build_scene_xml(scene: TwinSceneInput, g1_include: str = "g1/g1_29dof.xml") -> str:
    """Build the MJCF scene XML for a twin and return it as a string.

    The room becomes static collision geometry (mesh if `mesh_path` given, else
    extruded occupancy walls, else a perimeter box approximation from the AABB).
    The G1 is included via `<include file="{g1_include}"/>`. Zones become named
    sites the env reads (charging->spawn, workcell->goal, keepout->penalty).

    Deterministic: identical input yields a byte-identical string.
    """
    min_x, min_y, min_z, max_x, max_y, max_z = scene.aabb
    cx, cy = _recenter_offset(scene)

    def _to_mjcf(wx: float, wy: float, wz: float) -> tuple[float, float, float]:
        """The single world->MJCF transform (translate XY by -(cx,cy); keep z)."""
        return wx - cx, wy - cy, wz

    res = scene.resolution if scene.resolution and scene.resolution > 0 else 0.05

    lines: list[str] = []
    lines.append('<mujoco model="twin_scene">')
    lines.append(
        "  <!-- Auto-generated by sim_evaluator/scene_builder.py from a NeoDEM "
        "digital twin. -->"
    )
    lines.append(
        f"  <!-- world->MJCF recenter offset (cx,cy)=({_fmt(cx)},{_fmt(cy)}); "
        f"floor z={_fmt(min_z)} -->"
    )
    # Compiler: meshdir kept minimal — the G1 proxy uses primitives; room mesh
    # paths are emitted as absolute so they resolve regardless of meshdir.
    lines.append('  <compiler angle="radian" autolimits="true"/>')
    lines.append(f'  <include file="{g1_include}"/>')
    lines.append('  <option timestep="0.002" gravity="0 0 -9.81"/>')

    # ----- visual + base assets ------------------------------------------------
    lines.append("  <visual>")
    lines.append(
        '    <headlight diffuse="0.6 0.6 0.6" ambient="0.3 0.3 0.3" specular="0 0 0"/>'
    )
    lines.append('    <rgba haze="0.15 0.25 0.35 1"/>')
    lines.append('    <global azimuth="160" elevation="-20"/>')
    lines.append("  </visual>")

    lines.append("  <asset>")
    lines.append(
        '    <texture type="skybox" builtin="gradient" rgb1="0.3 0.5 0.7" '
        'rgb2="0 0 0" width="512" height="3072"/>'
    )
    lines.append(
        '    <texture type="2d" name="groundplane" builtin="checker" mark="edge" '
        'rgb1="0.2 0.3 0.4" rgb2="0.1 0.2 0.3" markrgb="0.8 0.8 0.8" '
        'width="300" height="300"/>'
    )
    lines.append(
        '    <material name="groundplane" texture="groundplane" texuniform="true" '
        'texrepeat="5 5" reflectance="0.2"/>'
    )
    lines.append('    <material name="wall_material" rgba="0.55 0.57 0.62 1"/>')
    lines.append('    <material name="goal_material" rgba="0.2 0.8 0.3 0.4"/>')
    lines.append('    <material name="keepout_material" rgba="0.9 0.15 0.15 0.3"/>')

    # Room mesh asset (collision-only static mesh), if provided.
    # NOTE: MuJoCo loads OBJ/STL/MSH meshes, NOT GLB. The twin produces mesh.glb,
    # so a GLB path is intentionally NOT used as a <mesh> here — we fall through
    # to occupancy/perimeter walls instead (which always load). TODO: convert
    # the twin GLB to OBJ in the pipeline and feed that here for true room
    # collision geometry.
    use_mesh = bool(scene.mesh_path) and Path(scene.mesh_path).suffix.lower() in (
        ".obj",
        ".stl",
        ".msh",
    )
    if use_mesh:
        mesh_abs = str(Path(scene.mesh_path).resolve())
        lines.append(f'    <mesh name="room" file="{mesh_abs}"/>')
    lines.append("  </asset>")

    # ----- worldbody -----------------------------------------------------------
    lines.append("  <worldbody>")
    lines.append('    <light pos="0 0 4.0" dir="0 0 -1" directional="true"/>')
    lines.append(
        '    <light pos="2.0 -2.0 3.0" dir="-0.3 0.3 -1" diffuse="0.4 0.4 0.4" '
        'specular="0.1 0.1 0.1"/>'
    )

    # Floor plane at z = minZ (transformed: minZ is preserved by _to_mjcf).
    lines.append(
        f'    <geom name="floor" type="plane" size="0 0 0.05" '
        f'pos="0 0 {_fmt(min_z)}" material="groundplane"/>'
    )

    # Room geometry.
    if use_mesh:
        # Static collision mesh (no body/freejoint => world-static). Translated
        # by the recenter offset; z preserved.
        ox, oy, oz = _to_mjcf(0.0, 0.0, 0.0)
        lines.append(
            f'    <geom name="room_mesh" type="mesh" mesh="room" '
            f'pos="{_fmt(ox)} {_fmt(oy)} {_fmt(oz)}" material="wall_material" '
            f'contype="1" conaffinity="1"/>'
        )
    else:
        wall_geoms = _build_wall_geoms(scene, res, _to_mjcf, min_z)
        if wall_geoms:
            lines.extend(wall_geoms)
        else:
            lines.extend(_build_perimeter_walls(scene, _to_mjcf, min_z))

    # ----- zones ---------------------------------------------------------------
    first_workcell_emitted = False
    goal_site_emitted = False
    for z in scene.zones:
        if not z.points:
            continue
        prefix = _ZONE_PREFIX.get(z.type, "zone_")
        sname = f"{prefix}{_sanitize(z.name)}"
        zcx, zcy, half_x, half_y, _mnx, _mny = _polygon_centroid_bbox(z.points)
        sx, sy, _sz = _to_mjcf(zcx, zcy, 0.0)
        site_z = min_z + 0.01
        material = "keepout_material" if z.type == "keepout" else "goal_material"
        lines.append(
            f'    <site name="{sname}" type="box" '
            f'pos="{_fmt(sx)} {_fmt(sy)} {_fmt(site_z)}" '
            f'size="{_fmt(half_x)} {_fmt(half_y)} 0.005" material="{material}"/>'
        )
        # First workcell also gets the `goal_site` alias the env reads as goal.
        if z.type == "workcell" and not first_workcell_emitted:
            first_workcell_emitted = True
            goal_site_emitted = True
            lines.append(
                f'    <site name="goal_site" type="box" '
                f'pos="{_fmt(sx)} {_fmt(sy)} {_fmt(site_z)}" '
                f'size="{_fmt(half_x)} {_fmt(half_y)} 0.005" material="goal_material"/>'
            )
        # Keepout zones get a translucent red visual marker box (no collision).
        if z.type == "keepout":
            box_h = max((z.max_z - z.min_z) / 2.0, 0.05)
            box_cz = min_z + box_h
            lines.append(
                f'    <geom name="{sname}_marker" type="box" '
                f'pos="{_fmt(sx)} {_fmt(sy)} {_fmt(box_cz)}" '
                f'size="{_fmt(half_x)} {_fmt(half_y)} {_fmt(box_h)}" '
                f'material="keepout_material" contype="0" conaffinity="0"/>'
            )

    # Always provide a `goal_site` so the env has a target even with no workcell.
    if not goal_site_emitted:
        # Default goal: 1.5 m in +x from the (recentered) origin, on the floor.
        gx, gy, _gz = 1.5, 0.0, 0.0
        lines.append(
            f'    <site name="goal_site" type="box" '
            f'pos="{_fmt(gx)} {_fmt(gy)} {_fmt(min_z + 0.01)}" '
            f'size="0.25 0.25 0.005" material="goal_material"/>'
        )

    # ----- cameras -------------------------------------------------------------
    # A third-person `front` camera framing the room; head_camera comes from the
    # G1 include.
    span = max(max_x - min_x, max_y - min_y, 1.0)
    cam_d = span * 0.9 + 1.5
    lines.append(
        f'    <camera name="front" pos="{_fmt(cam_d)} {_fmt(-cam_d)} '
        f'{_fmt(min_z + 2.0)}" xyaxes="1 1 0 -0.4 0.4 1.4" fovy="55"/>'
    )
    lines.append("  </worldbody>")
    lines.append("</mujoco>")
    return "\n".join(lines) + "\n"


def _build_wall_geoms(scene, res, to_mjcf, min_z):  # noqa: ANN001
    """Extrude occupancy PGM occupied cells into thin box wall segments."""
    if not scene.occupancy_pgm_path:
        return []
    parsed = _parse_pgm_occupied_cells(
        Path(scene.occupancy_pgm_path), res, scene.occupancy_yaml_path
    )
    if not parsed:
        return []
    cells, cell_res = parsed
    if not cells:
        return []
    geoms: list[str] = []
    half = max(cell_res / 2.0, _WALL_HALF_THICK)
    wall_h = _WALL_HEIGHT_DEFAULT / 2.0
    wall_cz = min_z + wall_h
    # Deterministic order: sort cells.
    for idx, (wx, wy) in enumerate(sorted(cells)):
        mx, my, _mz = to_mjcf(wx, wy, 0.0)
        geoms.append(
            f'    <geom name="wall_{idx}" type="box" '
            f'pos="{_fmt(mx)} {_fmt(my)} {_fmt(wall_cz)}" '
            f'size="{_fmt(half)} {_fmt(half)} {_fmt(wall_h)}" material="wall_material" '
            f'contype="1" conaffinity="1"/>'
        )
    logger.info("Extruded %d occupancy cells into wall geoms", len(geoms))
    return geoms


def _build_perimeter_walls(scene, to_mjcf, min_z):  # noqa: ANN001
    """Simplified fallback: 4 perimeter box walls from the AABB footprint."""
    min_x, min_y, _mnz, max_x, max_y, max_z = scene.aabb
    wall_h = max((max_z - min_z) / 2.0, 1.0)
    wall_cz = min_z + wall_h
    t = _WALL_HALF_THICK
    span_x = max((max_x - min_x) / 2.0, 0.1)
    span_y = max((max_y - min_y) / 2.0, 0.1)
    geoms: list[str] = []
    # (center_world_x, center_world_y, half_x, half_y)
    walls = [
        (min_x, (min_y + max_y) / 2.0, t, span_y),  # west
        (max_x, (min_y + max_y) / 2.0, t, span_y),  # east
        ((min_x + max_x) / 2.0, min_y, span_x, t),  # south
        ((min_x + max_x) / 2.0, max_y, span_x, t),  # north
    ]
    for idx, (wx, wy, hx, hy) in enumerate(walls):
        mx, my, _mz = to_mjcf(wx, wy, 0.0)
        geoms.append(
            f'    <geom name="wall_{idx}" type="box" '
            f'pos="{_fmt(mx)} {_fmt(my)} {_fmt(wall_cz)}" '
            f'size="{_fmt(hx)} {_fmt(hy)} {_fmt(wall_h)}" material="wall_material" '
            f'contype="1" conaffinity="1"/>'
        )
    return geoms


def write_scene(
    scene: TwinSceneInput, out_path: str, g1_include: str = "g1/g1_29dof.xml"
) -> str:
    """Build the scene and write it to `out_path`. Returns the path written."""
    xml = build_scene_xml(scene, g1_include=g1_include)
    out = Path(out_path)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(xml, encoding="utf-8")
    logger.info("Wrote MJCF scene -> %s (%d bytes)", out, len(xml))
    return str(out)


# --------------------------------------------------------------------------- USD (Isaac)
def write_usd(scene: TwinSceneInput, out_path: str) -> str | None:
    """Optional Isaac/USD export. No-op + warning when USD libs are absent.

    Mirrors the runner mock-fallback pattern: if `pxr` (OpenUSD) isn't installed
    we log a warning and return None instead of failing, so the MuJoCo path
    always works offline.
    """
    try:
        from pxr import Usd, UsdGeom  # type: ignore[import-not-found]  # noqa: F401
    except ImportError:
        logger.warning(
            "USD (pxr/OpenUSD) not available — skipping Isaac scene export for %s. "
            "Install the Isaac/USD libs to enable write_usd().",
            out_path,
        )
        return None

    # Minimal USD stage with the AABB as a reference box + floor. The Isaac
    # pipeline (Phase B) will flesh this out; for now we emit a valid stage.
    min_x, min_y, min_z, max_x, max_y, max_z = scene.aabb
    stage = Usd.Stage.CreateNew(str(out_path))
    UsdGeom.SetStageUpAxis(stage, UsdGeom.Tokens.z)
    world = UsdGeom.Xform.Define(stage, "/World")  # noqa: F841
    floor = UsdGeom.Cube.Define(stage, "/World/Floor")
    floor.AddTranslateOp().Set((0.0, 0.0, min_z))
    floor.AddScaleOp().Set(
        ((max_x - min_x) / 2.0, (max_y - min_y) / 2.0, 0.01)
    )
    stage.GetRootLayer().Save()
    logger.info("Wrote USD scene -> %s", out_path)
    return str(out_path)


# --------------------------------------------------------------------------- self-check
def _selfcheck() -> bool:
    """Opt-in: build a synthetic scene and (if mujoco present) load it.

    Run with `python scene_builder.py`. Returns True on success.
    """
    logging.basicConfig(level=logging.INFO)
    scene = TwinSceneInput(
        aabb=(0.0, 0.0, 0.0, 4.0, 3.0, 2.5),
        zones=[
            TwinZoneSpec("dock", "charging", [(0.2, 0.2), (0.8, 0.2), (0.8, 0.8), (0.2, 0.8)]),
            TwinZoneSpec("bench", "workcell", [(3.0, 2.0), (3.8, 2.0), (3.8, 2.8), (3.0, 2.8)]),
            TwinZoneSpec("hazard", "keepout", [(1.5, 1.0), (2.0, 1.0), (2.0, 1.5), (1.5, 1.5)]),
        ],
    )
    xml = build_scene_xml(scene)
    assert xml.startswith("<mujoco"), "scene must be a mujoco doc"
    assert "goal_site" in xml, "scene must define goal_site"
    assert "<include" in xml, "scene must include the G1"
    print(f"build_scene_xml OK ({len(xml)} bytes)")

    try:
        import mujoco  # type: ignore[import-not-found]
    except ImportError:
        print("mujoco not installed — skipping load check (XML-only self-check passed)")
        return True

    here = Path(__file__).resolve().parent
    tmp = here / "mjcf" / "_selfcheck_scene.xml"
    try:
        # g1_include must resolve relative to the scene file's directory.
        write_scene(scene, str(tmp), g1_include="g1/g1_29dof.xml")
        m = mujoco.MjModel.from_xml_path(str(tmp))
        print(f"mujoco load OK: nq={m.nq} nv={m.nv} nu={m.nu}")
    finally:
        tmp.unlink(missing_ok=True)
    return True


# struct imported for potential future binary mesh inspection; keep referenced.
_ = struct


# --------------------------------------------------------------------------- CLI
def _load_zones(zones_json_path: str | None) -> list[TwinZoneSpec]:
    """Parse a zones JSON file into a list of TwinZoneSpec.

    Expected shape: a JSON list of objects
    `{name, type, points, minZ?, maxZ?}` where `points` is a list of `[x, y]`
    pairs (or `{x, y}` objects — both accepted). A missing/empty/malformed file
    yields no zones, so the perimeter/occupancy fallback still produces a valid
    scene. Never raises.
    """
    if not zones_json_path:
        return []
    try:
        raw = json.loads(Path(zones_json_path).read_text(encoding="utf-8"))
    except (OSError, ValueError) as e:  # noqa: BLE001
        logger.warning("Could not read zones JSON %s: %s", zones_json_path, e)
        return []
    if not isinstance(raw, list):
        return []
    out: list[TwinZoneSpec] = []
    for z in raw:
        if not isinstance(z, dict):
            continue
        pts_raw = z.get("points") or z.get("polygon") or []
        points: list[tuple[float, float]] = []
        for p in pts_raw:
            try:
                if isinstance(p, dict):
                    points.append((float(p["x"]), float(p["y"])))
                else:
                    points.append((float(p[0]), float(p[1])))
            except (TypeError, ValueError, KeyError, IndexError):
                continue
        if not points:
            continue
        out.append(
            TwinZoneSpec(
                name=str(z.get("name", "zone")),
                type=str(z.get("type", "workcell")),
                points=points,
                min_z=float(z.get("minZ", z.get("min_z", 0.0))),
                max_z=float(z.get("maxZ", z.get("max_z", 2.0))),
            )
        )
    return out


def _generate_cli(ns: argparse.Namespace) -> int:
    """`generate` subcommand: build a scene MJCF from explicit twin inputs.

    This is the canonical, server-callable entrypoint — the NeoDEM server spawns
    `uv run python scene_builder.py generate ...` so the single world->MJCF
    transform stays defined ONLY here. Threading `--occupancy-pgm` makes the room
    walls follow the real scan instead of the AABB perimeter box.
    """
    logging.basicConfig(level=logging.INFO)
    scene = TwinSceneInput(
        aabb=tuple(ns.aabb),  # type: ignore[arg-type]
        mesh_path=ns.mesh,
        occupancy_pgm_path=ns.occupancy_pgm,
        occupancy_yaml_path=ns.occupancy_yaml,
        resolution=ns.resolution,
        zones=_load_zones(ns.zones_json),
        embodiment=ns.embodiment,
    )
    write_scene(scene, ns.out, g1_include=ns.g1_include)
    print(ns.out)
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Real-to-sim: turn a NeoDEM digital twin into a MuJoCo MJCF scene."
    )
    sub = parser.add_subparsers(dest="command")

    gen = sub.add_parser("generate", help="Build a scene MJCF from twin inputs.")
    gen.add_argument(
        "--aabb", type=float, nargs=6, required=True,
        metavar=("MINX", "MINY", "MINZ", "MAXX", "MAXY", "MAXZ"),
        help="World-frame AABB (meters, z-up).",
    )
    gen.add_argument("--out", required=True, help="Output MJCF path to write.")
    gen.add_argument(
        "--occupancy-pgm", dest="occupancy_pgm", default=None,
        help="Occupancy PGM (real floor-plan walls; preferred over AABB box).",
    )
    gen.add_argument(
        "--occupancy-yaml", dest="occupancy_yaml", default=None,
        help="Occupancy YAML (map origin + resolution).",
    )
    gen.add_argument(
        "--mesh", default=None, help="Room mesh (OBJ/STL/MSH; GLB is ignored)."
    )
    gen.add_argument("--resolution", type=float, default=0.05)
    gen.add_argument(
        "--zones-json", dest="zones_json", default=None,
        help="JSON file: list of {name,type,points,minZ,maxZ}.",
    )
    gen.add_argument("--embodiment", default="g1")
    gen.add_argument("--g1-include", dest="g1_include", default="g1/g1_29dof.xml")
    gen.set_defaults(func=_generate_cli)

    ns = parser.parse_args(argv)
    if getattr(ns, "func", None) is not None:
        return ns.func(ns)
    # No subcommand: run the opt-in self-check.
    ok = _selfcheck()
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
