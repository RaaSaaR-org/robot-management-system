#!/usr/bin/env python3
"""
@file build_g1_include.py
@description Regenerates the INCLUDABLE Unitree G1 29-DOF MuJoCo model
  (`mjcf/g1/g1_29dof.xml`) from the upstream standalone model shipped in
  `unitreerobotics/unitree_mujoco`. Run this only to re-vendor / bump the
  upstream pin; the generated XML + STL meshes are committed, so the sim
  evaluator never needs this script or network access at runtime.

Why a derived model (not the upstream file verbatim):
  * Our scene_builder emits ONE parent `<compiler>` and `<include>`s this file,
    so the include must NOT carry its own `<compiler>` (MuJoCo allows one).
  * The parent compiler sets no `meshdir`, so mesh `file=` paths are resolved
    relative to the scene file (which lives in `mjcf/`) — hence the
    `g1/meshes/...` prefix.
  * The policy/env drives `data.ctrl` with joint POSITION targets, so the
    upstream TORQUE `<motor>` actuators are replaced with POSITION actuators in
    the canonical g1.yaml joint order (ctrlrange == each joint's real limit).
  * The env renders from a `head_camera`; upstream has none, so we mount one.

Usage:
    uv run python mjcf/g1/build_g1_include.py [SRC_G1_DIR]
      SRC_G1_DIR defaults to the local clone under temp/unitree_mujoco.

Upstream pin: unitreerobotics/unitree_mujoco @ ae6a8403 (BSD-3-Clause).
"""

import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
DEFAULT_SRC = (
    HERE.parents[2]  # sim_evaluator/
    / ".." / ".." / "temp" / "unitree_mujoco" / "unitree_robots" / "g1"
)

UPSTREAM = "unitreerobotics/unitree_mujoco"
COMMIT = "ae6a8403e272733e9996ef59990880330496177f"

# Position-actuator gains. Match the prior kinematic proxy (known-good in env).
KP, KV = 150, 5

HEADER = f"""<!--
    ==========================================================================
    Unitree G1 — 29-DOF MuJoCo model (REAL Unitree collision/visual meshes)
    ==========================================================================
    Derived from the upstream standalone model in
      {UPSTREAM} @ {COMMIT[:8]}
      unitree_robots/g1/g1_29dof.xml  (BSD-3-Clause, (c) Unitree Robotics)
    by mjcf/g1/build_g1_include.py. See mjcf/g1/MESHES_LICENSE.md for the
    vendored license + attribution. STL meshes live under mjcf/g1/meshes/.

    Modifications vs upstream (so it composes into scene_builder scenes):
      * Dropped the top-level <compiler> — the parent scene owns it (one per
        model). Mesh file= paths are prefixed `g1/meshes/` because the parent
        compiler sets no meshdir (paths resolve next to the scene file).
      * Replaced the 29 TORQUE <motor> actuators with 29 POSITION actuators in
        canonical g1.yaml order; ctrlrange == each joint's real limit. The env
        drives data.ctrl with joint position targets.
      * Mounted a forward-looking `head_camera` (+ site) on torso_link at eye
        height — the evaluator renders the head-camera view from it.
    Everything else (kinematics, inertials, real meshes, joint limits) is the
    upstream G1. The free root joint stays jnt 0 (env spawns the pelvis there).
    ==========================================================================
  -->"""


def build(src_dir: Path, out_path: Path) -> None:
    src = (src_dir / "g1_29dof.xml").read_text()

    # 1. Drop the upstream <compiler ...> (parent scene owns the single compiler).
    src = re.sub(r"\n\s*<compiler\b[^>]*/>", "", src, count=1)

    # 2. Prefix mesh asset paths so they resolve relative to the scene file.
    src = re.sub(r'file="([^"/]+\.STL)"', r'file="g1/meshes/\1"', src)

    # 3. Parse joints in body order (skip the free root) to build position
    #    actuators with ctrlrange == real joint limits, canonical g1.yaml order.
    joints = re.findall(
        r'<joint\s+name="([^"]+)"[^>]*?range="([^"]+)"', src
    )
    # Free joint has no range and is excluded by the regex; sanity-check count.
    if len(joints) != 29:
        raise SystemExit(f"expected 29 actuated joints, found {len(joints)}")

    # 4. Inject a position-actuator default class into the <default> block.
    src = src.replace(
        "  <default>\n",
        "  <default>\n"
        f'    <default class="g1_act">\n'
        f'      <position kp="{KP}" kv="{KV}"/>\n'
        f"    </default>\n",
        1,
    )

    # 5. Replace the torque <actuator> block with position actuators.
    act_lines = ["  <actuator>"]
    for name, rng in joints:
        act_lines.append(
            f'    <position class="g1_act" name="{name}" '
            f'joint="{name}" ctrlrange="{rng}"/>'
        )
    act_lines.append("  </actuator>")
    src = re.sub(
        r"  <actuator>.*?</actuator>",
        "\n".join(act_lines),
        src,
        count=1,
        flags=re.DOTALL,
    )

    # 6. Mount a head_camera on torso_link (env renders from it). torso_link
    #    stands at world z~0.847; eye height ~1.30 -> local +0.45, forward +0.10.
    cam = (
        '            <camera name="head_camera" pos="0.1 0 0.45" '
        'xyaxes="0 -1 0 0 0 1" fovy="90"/>\n'
        '            <site name="head_camera_site" pos="0.1 0 0.45" size="0.01"/>\n'
    )
    src, n = re.subn(
        r'(\n\s*<body name="torso_link"[^>]*>\n)', r"\1" + cam, src, count=1
    )
    if n != 1:
        raise SystemExit("could not locate torso_link body to mount head_camera")

    # 7. Prepend provenance header right after the root <mujoco ...> tag.
    src = re.sub(
        r"(<mujoco\b[^>]*>)\n", r"\1\n  " + HEADER + "\n", src, count=1
    )

    out_path.write_text(src)
    print(f"wrote {out_path}  ({len(src)} bytes, {len(joints)} position actuators)")


if __name__ == "__main__":
    src_dir = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else DEFAULT_SRC.resolve()
    if not (src_dir / "g1_29dof.xml").exists():
        raise SystemExit(f"upstream model not found under {src_dir}")
    build(src_dir, HERE / "g1_29dof.xml")
