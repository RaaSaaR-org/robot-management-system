# NeoDEM. Apache License, Version 2.0 (same terms as the surrounding Unitree checkout).
"""Generate `pause_room_door.usda` from `factory_pauseroom_layout.py`.

WHY A GENERATOR AND NOT A HAND-WRITTEN USD
------------------------------------------
The pause room's door is the one piece of this scene that is NOT a spawn cfg: Isaac Lab
has no way to build an articulation out of primitive cfgs, so the two sliding leaves and
their prismatic joints have to live in a USD file. A hand-written USD would be the only
place in this directory where geometry is typed rather than derived -- and it would be the
place where a change to `DOOR["width"]` silently stops matching the hole in the wall.

So the USD is generated here, from the same constants the wall geometry, the verifier and
the runtime driver all read. `verify_factory_scene_offline.py` re-runs this generator into
a string and compares it against the checked-in file, which turns "the door fits the
doorway" from a claim into an assertion.

There is NO nucleus and NO network dependency: this writes plain ASCII USDA describing
three `UsdGeom.Cube` prims, and needs neither `pxr` nor Isaac to run.

WHAT IT BUILDS
--------------
    /Root/PauseRoomDoor                        Xform  + PhysicsArticulationRootAPI
    /Root/PauseRoomDoor/rootJoint              PhysicsFixedJoint  (world -> rail)
    /Root/PauseRoomDoor/door_frame             Xform  + RigidBody + Mass   <- the header rail
    /Root/PauseRoomDoor/door_frame/collision   Cube   + Collision
    /Root/PauseRoomDoor/door_frame/door_left_joint    PhysicsPrismaticJoint
    /Root/PauseRoomDoor/door_frame/door_right_joint   PhysicsPrismaticJoint
    /Root/PauseRoomDoor/door_left_leaf         Xform  + RigidBody + Mass
    /Root/PauseRoomDoor/door_left_leaf/collision      Cube + Collision
    /Root/PauseRoomDoor/door_right_leaf        ... likewise

The layout mirrors `assets/objects/drawers/cabinet_collider.usd`, the one articulated prop
this checkout already loads successfully (`/Root/cabinet` carries the articulation root, a
`rootJoint` fixed joint pins the base link to the world, and each moving part hangs off a
joint declared under its parent link). Copying a structure that is known to import is
worth more here than any tidier arrangement.

The local frame has its origin at the middle of the doorway, on the floor, on the leaves'
slide plane: +x along the slide, +y into the pause room, +z up. The scene cfg places it at
`DOOR_ORIGIN`.

Usage
-----
    python3 make_pause_room_door_usda.py            # rewrite pause_room_door.usda
    python3 make_pause_room_door_usda.py --check    # exit 1 if it is out of date

@status new -- authoring tool for isaac_scenes/, not part of the shipped robot software
"""

from __future__ import annotations

import argparse
import importlib.util
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
LAYOUT_PY = os.path.join(HERE, "factory_pauseroom_layout.py")


def load_layout(path: str = LAYOUT_PY):
    """Import the layout module by path, so this works in-repo and installed alike."""
    spec = importlib.util.spec_from_file_location("factory_pauseroom_layout", path)
    if spec is None or spec.loader is None:  # pragma: no cover - only if the file moved
        raise RuntimeError(f"cannot load {path}")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _f(x: float) -> str:
    """Format a float for USDA: fixed 6 dp, no exponent, no trailing '-0'."""
    s = f"{x:.6f}"
    return "0.000000" if s == "-0.000000" else s


def _v3(v) -> str:
    return f"({_f(v[0])}, {_f(v[1])}, {_f(v[2])})"


ROOT = "/Root/PauseRoomDoor"


def _box_prim(name: str, size, colour, indent: str) -> str:
    """A `UsdGeom.Cube` of edge 1 scaled to `size`, acting as visual AND collider.

    Edge 1 plus a non-uniform `xformOp:scale` is the standard Omniverse box: `extent` then
    describes the unscaled cube and the scale gives the real full extents, so the numbers
    below read as the box's actual dimensions in metres.
    """
    i = indent
    return (
        f'{i}def Cube "{name}" (\n'
        f'{i}    prepend apiSchemas = ["PhysicsCollisionAPI"]\n'
        f'{i})\n'
        f'{i}{{\n'
        f'{i}    float3[] extent = [(-0.5, -0.5, -0.5), (0.5, 0.5, 0.5)]\n'
        f'{i}    double size = 1\n'
        f'{i}    color3f[] primvars:displayColor = [{_v3(colour)}]\n'
        f'{i}    double3 xformOp:scale = {_v3(size)}\n'
        f'{i}    uniform token[] xformOpOrder = ["xformOp:scale"]\n'
        f'{i}}}\n'
    )


def _link(name: str, translate, size, mass: float, colour, indent: str,
          extra: str = "") -> str:
    """One rigid link: an Xform carrying the body + mass, with the Cube collider below."""
    i = indent
    out = (
        f'{i}def Xform "{name}" (\n'
        f'{i}    prepend apiSchemas = ["PhysicsRigidBodyAPI", "PhysicsMassAPI"]\n'
        f'{i})\n'
        f'{i}{{\n'
        f'{i}    bool physics:rigidBodyEnabled = 1\n'
        f'{i}    bool physics:kinematicEnabled = 0\n'
        f'{i}    float physics:mass = {_f(mass)}\n'
        f'{i}    double3 xformOp:translate = {_v3(translate)}\n'
        f'{i}    uniform token[] xformOpOrder = ["xformOp:translate"]\n'
        f'\n'
    )
    out += _box_prim("collision", size, colour, i + "    ")
    out += extra
    out += f'{i}}}\n'
    return out


def _prismatic(name: str, body0: str, body1: str, local_pos0, lower: float, upper: float,
               drive: dict, indent: str) -> str:
    """One leaf's prismatic joint, drive and joint state.

    `PhysicsDriveAPI:linear` is present in the USD rather than being left for Isaac Lab to
    add, because `ImplicitActuatorCfg` configures an EXISTING drive: a joint that arrives
    with no drive API is imported as an unactuated DOF, and the door would then be a thing
    that swings freely instead of a thing that is commanded.

    There is deliberately NO `PhysicsJointStateAPI`. USD 25.11 in this checkout's conda env
    does not register it (applying it leaves the prim with only `PhysicsDriveAPI:linear`),
    and it would be redundant anyway: the leaves' own transforms author them shut, and
    `ArticulationCfg.InitialStateCfg.joint_pos` sets the joint coordinates explicitly.
    """
    i = indent
    return (
        f'{i}def PhysicsPrismaticJoint "{name}" (\n'
        f'{i}    prepend apiSchemas = ["PhysicsDriveAPI:linear"]\n'
        f'{i})\n'
        f'{i}{{\n'
        f'{i}    uniform token physics:axis = "X"\n'
        f'{i}    rel physics:body0 = <{body0}>\n'
        f'{i}    rel physics:body1 = <{body1}>\n'
        f'{i}    bool physics:collisionEnabled = 0\n'
        f'{i}    bool physics:jointEnabled = 1\n'
        f'{i}    bool physics:excludeFromArticulation = 0\n'
        f'{i}    float physics:breakForce = inf\n'
        f'{i}    float physics:breakTorque = inf\n'
        f'{i}    point3f physics:localPos0 = {_v3(local_pos0)}\n'
        f'{i}    point3f physics:localPos1 = (0, 0, 0)\n'
        f'{i}    quatf physics:localRot0 = (1, 0, 0, 0)\n'
        f'{i}    quatf physics:localRot1 = (1, 0, 0, 0)\n'
        f'{i}    float physics:lowerLimit = {_f(lower)}\n'
        f'{i}    float physics:upperLimit = {_f(upper)}\n'
        f'{i}    uniform token drive:linear:physics:type = "force"\n'
        f'{i}    float drive:linear:physics:stiffness = {_f(drive["stiffness"])}\n'
        f'{i}    float drive:linear:physics:damping = {_f(drive["damping"])}\n'
        f'{i}    float drive:linear:physics:maxForce = {_f(drive["max_force"])}\n'
        f'{i}    float drive:linear:physics:targetPosition = 0\n'
        f'{i}}}\n'
    )


# Colours. The leaves read as pale industrial glass so the doorway stays legible in the
# hall overview shot; the rail is the same grey as the steel columns.
_LEAF_COLOUR = (0.72, 0.78, 0.82)
_RAIL_COLOUR = (0.42, 0.44, 0.48)


def build_usda(L) -> str:
    """The whole file, as a string, derived from the layout module `L`."""
    ox, oy, _oz = L.DOOR_ORIGIN
    rail = L.door_rail_box()
    leaves = L.door_leaf_boxes(0.0)          # authored SHUT: openness 0 is the rest state
    limits = L.door_joint_limits()

    # Everything below is expressed in the articulation's own local frame, so subtract the
    # world origin the scene cfg will place it at.
    def local(pos):
        return (pos[0] - ox, pos[1] - oy, pos[2])

    rail_local = local(rail["pos"])

    body = []
    for name in L.DOOR_JOINTS:
        leaf = leaves[name]
        leaf_local = local(leaf["pos"])
        link_name = name.replace("_joint", "_leaf")
        body.append((name, link_name, leaf_local, leaf["size"]))

    joints = ""
    for name, link_name, leaf_local, _size in body:
        lo, hi = limits[name]
        joints += _prismatic(
            name,
            body0=f"{ROOT}/door_frame",
            body1=f"{ROOT}/{link_name}",
            # The joint frame on the rail is where the leaf sits when shut, so joint
            # coordinate 0 IS the shut position and `door_joint_targets` needs no offset.
            local_pos0=(leaf_local[0] - rail_local[0],
                        leaf_local[1] - rail_local[1],
                        leaf_local[2] - rail_local[2]),
            lower=lo, upper=hi, drive=L.DOOR_DRIVE, indent="            ",
        )

    links = ""
    for _name, link_name, leaf_local, size in body:
        links += "\n" + _link(link_name, leaf_local, size, L.DOOR_LEAF_MASS,
                              _LEAF_COLOUR, "        ")

    return f'''#usda 1.0
(
    doc = """Pause-room automatic sliding door for Isaac-Factory-PauseRoom-G129-Dex3-Wholebody.

    GENERATED FILE -- do not edit. Regenerate with:
        python3 make_pause_room_door_usda.py
    Every dimension comes from factory_pauseroom_layout.py; verify_factory_scene_offline.py
    fails if this file and that module disagree.

    Two leaves on prismatic joints, authored SHUT (joint position 0). Each opens by
    {_f(L.DOOR_LEAF_TRAVEL)} m, which together restore the doorway's full
    {_f(L.DOOR['width'])} m clear width. Local frame: origin at the middle of the doorway
    at floor level, +x along the slide, +y into the pause room."""
    defaultPrim = "Root"
    metersPerUnit = 1
    upAxis = "Z"
)

def Xform "Root"
{{
    def Xform "PauseRoomDoor" (
        prepend apiSchemas = ["PhysicsArticulationRootAPI"]
    )
    {{
        # Pins the header rail to the world. body0 is empty == the world frame, which is
        # how cabinet_collider.usd fixes its own base link (/Root/cabinet/rootJoint).
        def PhysicsFixedJoint "rootJoint"
        {{
            rel physics:body1 = <{ROOT}/door_frame>
            bool physics:collisionEnabled = 0
            bool physics:jointEnabled = 1
            bool physics:excludeFromArticulation = 0
            float physics:breakForce = inf
            float physics:breakTorque = inf
            point3f physics:localPos0 = {_v3(rail_local)}
            point3f physics:localPos1 = (0, 0, 0)
            quatf physics:localRot0 = (1, 0, 0, 0)
            quatf physics:localRot1 = (1, 0, 0, 0)
        }}

{_link("door_frame", rail_local, rail["size"], L.DOOR_RAIL_MASS, _RAIL_COLOUR, "        ", extra="\n" + joints)}{links}    }}
}}
'''


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--check", action="store_true",
                    help="do not write; exit 1 if the checked-in file is out of date")
    args = ap.parse_args()

    L = load_layout()
    text = build_usda(L)
    out = os.path.join(HERE, L.DOOR_USD_FILENAME)

    if args.check:
        if not os.path.isfile(out):
            print(f"MISSING: {out}")
            return 1
        with open(out, encoding="utf-8") as fh:
            current = fh.read()
        if current != text:
            print(f"STALE: {out} differs from what the layout module generates")
            return 1
        print(f"OK: {out} is up to date")
        return 0

    with open(out, "w", encoding="utf-8") as fh:
        fh.write(text)
    print(f"wrote {out} ({len(text)} bytes)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
