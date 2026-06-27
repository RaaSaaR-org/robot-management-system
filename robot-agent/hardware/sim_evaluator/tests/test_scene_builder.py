"""
@file test_scene_builder.py
@description Tests for the real-to-sim MJCF scene_builder. No mujoco required —
    parse the emitted XML with xml.etree and assert structure + EXACT transformed
    site coordinates derived by hand from the documented world->MJCF transform.
"""

from __future__ import annotations

import json
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

# Make the package importable when run as `pytest tests/`.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from scene_builder import (  # noqa: E402
    TwinSceneInput,
    TwinZoneSpec,
    build_scene_xml,
)

# ---------------------------------------------------------------------------
# Known fixture.
#
# AABB = (0,0,0, 4,3,2.5).
# Zones:
#   charging "dock"    : square [(0.5,0.5),(1.5,0.5),(1.5,1.5),(0.5,1.5)]
#                        -> bbox center (1.0, 1.0)
#   workcell "bench"   : square [(3.0,2.0),(4.0,2.0),(4.0,3.0),(3.0,3.0)]
#                        -> bbox center (3.5, 2.5)
#   keepout "hazard"   : square [(1.5,1.0),(2.5,1.0),(2.5,2.0),(1.5,2.0)]
#                        -> bbox center (2.0, 1.5)
#
# Because a charging zone is present, the world->MJCF recenter offset (cx,cy)
# equals the charging zone bbox center => (cx,cy) = (1.0, 1.0).
# The transform: mjcf_x = wx - 1.0, mjcf_y = wy - 1.0, z preserved.
# minZ = 0.0 so floor z = 0.0 and site z = 0.01.
# ---------------------------------------------------------------------------
CX, CY = 1.0, 1.0
MIN_Z = 0.0
SITE_Z = MIN_Z + 0.01

_SCENE = TwinSceneInput(
    aabb=(0.0, 0.0, 0.0, 4.0, 3.0, 2.5),
    zones=[
        TwinZoneSpec("dock", "charging",
                     [(0.5, 0.5), (1.5, 0.5), (1.5, 1.5), (0.5, 1.5)]),
        TwinZoneSpec("bench", "workcell",
                     [(3.0, 2.0), (4.0, 2.0), (4.0, 3.0), (3.0, 3.0)]),
        TwinZoneSpec("hazard", "keepout",
                     [(1.5, 1.0), (2.5, 1.0), (2.5, 2.0), (1.5, 2.0)]),
    ],
)


def _parse():
    xml = build_scene_xml(_SCENE)
    return xml, ET.fromstring(xml)


def _approx(a: float, b: float, tol: float = 1e-6) -> bool:
    return abs(a - b) <= tol


def test_root_is_mujoco():
    _xml, root = _parse()
    assert root.tag == "mujoco"


def test_floor_plane_at_minz():
    _xml, root = _parse()
    floor = None
    for g in root.iter("geom"):
        if g.get("name") == "floor":
            floor = g
            break
    assert floor is not None, "no geom named 'floor'"
    assert floor.get("type") == "plane"
    pos = [float(v) for v in floor.get("pos").split()]
    assert _approx(pos[2], MIN_Z), f"floor z {pos[2]} != minZ {MIN_Z}"


def test_includes_g1():
    _xml, root = _parse()
    includes = [inc.get("file") for inc in root.iter("include")]
    assert any("g1" in (f or "") for f in includes), f"no g1 include: {includes}"


def test_goal_site_present():
    _xml, root = _parse()
    names = {s.get("name") for s in root.iter("site")}
    assert "goal_site" in names, f"sites: {names}"


def test_zone_sites_have_exact_transformed_coords():
    _xml, root = _parse()
    sites = {s.get("name"): s for s in root.iter("site")}

    # charging "dock": world center (1,1) -> mjcf (0,0); half extents 0.5,0.5
    dock = sites["zone_charging_dock"]
    dpos = [float(v) for v in dock.get("pos").split()]
    dsize = [float(v) for v in dock.get("size").split()]
    assert _approx(dpos[0], 1.0 - CX) and _approx(dpos[1], 1.0 - CY)
    assert _approx(dpos[2], SITE_Z)
    assert _approx(dsize[0], 0.5) and _approx(dsize[1], 0.5)

    # workcell "bench": world center (3.5,2.5) -> mjcf (2.5,1.5)
    bench = sites["zone_workcell_bench"]
    bpos = [float(v) for v in bench.get("pos").split()]
    assert _approx(bpos[0], 3.5 - CX) and _approx(bpos[1], 2.5 - CY)
    assert _approx(bpos[2], SITE_Z)

    # goal_site is the alias of the first workcell -> same coords.
    goal = sites["goal_site"]
    gpos = [float(v) for v in goal.get("pos").split()]
    assert _approx(gpos[0], 3.5 - CX) and _approx(gpos[1], 2.5 - CY)

    # keepout "hazard": world center (2.0,1.5) -> mjcf (1.0,0.5)
    hazard = sites["zone_keepout_hazard"]
    hpos = [float(v) for v in hazard.get("pos").split()]
    assert _approx(hpos[0], 2.0 - CX) and _approx(hpos[1], 1.5 - CY)


def test_keepout_has_noncolliding_visual_geom():
    _xml, root = _parse()
    marker = None
    for g in root.iter("geom"):
        if g.get("name") == "zone_keepout_hazard_marker":
            marker = g
            break
    assert marker is not None, "keepout marker geom missing"
    assert marker.get("type") == "box"
    assert marker.get("contype") == "0"
    assert marker.get("conaffinity") == "0"
    # centered at the same XY as the keepout site (world (2,1.5)->mjcf (1,0.5))
    mpos = [float(v) for v in marker.get("pos").split()]
    assert _approx(mpos[0], 2.0 - CX) and _approx(mpos[1], 1.5 - CY)


def test_perimeter_walls_when_no_mesh_or_occupancy():
    # No mesh, no occupancy => perimeter box walls fallback (4 walls).
    _xml, root = _parse()
    wall_geoms = [g for g in root.iter("geom") if (g.get("name") or "").startswith("wall_")]
    assert len(wall_geoms) == 4, f"expected 4 perimeter walls, got {len(wall_geoms)}"


def test_determinism():
    a = build_scene_xml(_SCENE)
    b = build_scene_xml(_SCENE)
    assert a == b, "build_scene_xml must be deterministic"


# ---------------------------------------------------------------------------
# Occupancy floor-plan threading (TASK-171 fidelity follow-up): when an
# occupancy PGM is supplied the room walls follow the REAL scan (one box geom
# per occupied cell) instead of the 4-wall AABB perimeter box.
# ---------------------------------------------------------------------------
def _write_pgm(path: Path, width: int, height: int, occupied: set) -> None:
    """Write a tiny binary P5 PGM. `occupied` = set of (col, row) dark cells."""
    body = bytearray()
    for row in range(height):
        for col in range(width):
            body.append(0 if (col, row) in occupied else 255)
    header = f"P5\n{width} {height}\n255\n".encode("ascii")
    path.write_bytes(header + bytes(body))


def test_occupancy_pgm_produces_real_walls(tmp_path):
    pgm = tmp_path / "occupancy.pgm"
    _write_pgm(pgm, 3, 3, occupied={(0, 0), (2, 2)})
    scene = TwinSceneInput(
        aabb=(0.0, 0.0, 0.0, 4.0, 3.0, 2.5),
        occupancy_pgm_path=str(pgm),
        resolution=0.05,
    )
    root = ET.fromstring(build_scene_xml(scene))
    walls = [g for g in root.iter("geom") if (g.get("name") or "").startswith("wall_")]
    # Two occupied cells => two wall box geoms (NOT the 4-wall perimeter fallback).
    assert len(walls) == 2, f"expected 2 occupancy walls, got {len(walls)}"
    for w in walls:
        assert w.get("type") == "box"
        assert w.get("contype") == "1", "occupancy walls must collide"


def test_generate_cli_writes_scene_with_occupancy(tmp_path):
    from scene_builder import main

    pgm = tmp_path / "occupancy.pgm"
    _write_pgm(pgm, 3, 3, occupied={(1, 1)})
    out = tmp_path / "scene.mjcf.xml"
    rc = main([
        "generate",
        "--aabb", "0", "0", "0", "4", "3", "2.5",
        "--out", str(out),
        "--occupancy-pgm", str(pgm),
        "--resolution", "0.05",
    ])
    assert rc == 0
    assert out.exists(), "generate CLI must write the scene file"
    root = ET.fromstring(out.read_text())
    walls = [g for g in root.iter("geom") if (g.get("name") or "").startswith("wall_")]
    assert len(walls) == 1, f"expected 1 occupancy wall, got {len(walls)}"
    assert any("g1" in (inc.get("file") or "") for inc in root.iter("include"))


def test_generate_cli_with_zones_json(tmp_path):
    from scene_builder import _load_zones, main

    zones = [
        {"name": "bench", "type": "workcell",
         "points": [[3.0, 2.0], [4.0, 2.0], [4.0, 3.0], [3.0, 3.0]]},
    ]
    zpath = tmp_path / "zones.json"
    zpath.write_text(json.dumps(zones))
    parsed = _load_zones(str(zpath))
    assert len(parsed) == 1 and parsed[0].type == "workcell"

    out = tmp_path / "scene.xml"
    rc = main([
        "generate", "--aabb", "0", "0", "0", "4", "3", "2.5",
        "--out", str(out), "--zones-json", str(zpath),
    ])
    assert rc == 0
    root = ET.fromstring(out.read_text())
    names = {s.get("name") for s in root.iter("site")}
    assert "zone_workcell_bench" in names
    assert "goal_site" in names


def test_load_zones_accepts_dict_points_and_skips_garbage(tmp_path):
    from scene_builder import _load_zones

    zpath = tmp_path / "zones.json"
    zpath.write_text(json.dumps([
        {"name": "a", "type": "keepout", "points": [{"x": 1, "y": 1}, {"x": 2, "y": 2}]},
        {"name": "empty", "type": "workcell", "points": []},  # dropped (no points)
        "not-a-zone",  # dropped
    ]))
    parsed = _load_zones(str(zpath))
    assert len(parsed) == 1
    assert parsed[0].points == [(1.0, 1.0), (2.0, 2.0)]
    # Missing/garbage path never raises.
    assert _load_zones(str(tmp_path / "nope.json")) == []
    assert _load_zones(None) == []


def test_no_charging_zone_recenters_on_aabb():
    # Without a charging zone, recenter offset = AABB XY center.
    scene = TwinSceneInput(
        aabb=(0.0, 0.0, 0.0, 4.0, 3.0, 2.5),
        zones=[
            TwinZoneSpec("bench", "workcell",
                         [(3.0, 2.0), (4.0, 2.0), (4.0, 3.0), (3.0, 3.0)]),
        ],
    )
    root = ET.fromstring(build_scene_xml(scene))
    # AABB center = (2.0, 1.5). workcell center (3.5,2.5) -> mjcf (1.5, 1.0).
    sites = {s.get("name"): s for s in root.iter("site")}
    bpos = [float(v) for v in sites["zone_workcell_bench"].get("pos").split()]
    assert _approx(bpos[0], 3.5 - 2.0) and _approx(bpos[1], 2.5 - 1.5)
