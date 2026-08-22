#!/usr/bin/env python3
"""Emit the G1 EDU arm and Dex3 finger kinematics as a TypeScript constant table.

    python3 robot-agent/hardware/sim_evaluator/mjcf/g1_dex3/export_chains.py \
        > robot-agent/src/teleop/g1-chains.generated.ts

Why a generator and not a hand-written table. The robot agent solves arm IK in
TypeScript, in-process, with no MuJoCo and no Pinocchio (TASK-216 decision 1 —
the solver stays off the sim's physics thread and off the headset). It therefore
needs the same numbers MuJoCo has, and there is exactly one way to be sure they
are the same numbers: read them out of the MJCF MuJoCo reads.

Transcribing them by hand is how the two drift. Two of these fourteen rows carry
a shoulder-mount quaternion of 16.00335 degrees about an axis that is not quite
x, and `robot-agent/src/teleop/__tests__/g1-chains.test.ts` exists because
rounding one of them to "16 degrees about x" leaves an arm that looks almost
right and reaches a centimetre wrong.

Composition rule, verified against `mj_forward` to 1e-6:

    T_child = T_parent · Trans(body.pos) · Rot(body.quat) · Rot(joint.axis, q)

with MJCF quaternions in (w, x, y, z) order. None of the 28 joints carries a
`pos=` of its own, so every anchor is its body's origin; the exporter asserts
that rather than assuming it.
"""
from __future__ import annotations

import json
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

HERE = Path(__file__).resolve().parent
MODEL = HERE / "g1_43dof_fixedbase.xml"

# The chains we export, as (name, root body, tip body, ordered joint names).
# The tip body contributes its OFFSET only — it carries no joint.
ARM_JOINTS = ["shoulder_pitch", "shoulder_roll", "shoulder_yaw", "elbow",
              "wrist_roll", "wrist_pitch", "wrist_yaw"]
FINGERS = {
    "thumb": ["thumb_0", "thumb_1", "thumb_2"],
    "index": ["index_0", "index_1"],
    "middle": ["middle_0", "middle_1"],
}


def parse_floats(text: str | None, default: list[float]) -> list[float]:
    if text is None:
        return list(default)
    return [float(v) for v in text.split()]


def index_bodies(root: ET.Element) -> tuple[dict[str, ET.Element], dict[str, str]]:
    """name -> body element, and name -> parent body name."""
    bodies: dict[str, ET.Element] = {}
    parents: dict[str, str] = {}

    def walk(body: ET.Element, parent: str | None) -> None:
        name = body.get("name")
        if name is None:
            raise SystemExit("a body in the MJCF has no name; the exporter needs names")
        bodies[name] = body
        if parent is not None:
            parents[name] = parent
        for child in body.findall("body"):
            walk(child, name)

    world = root.find("worldbody")
    if world is None:
        raise SystemExit("no <worldbody> in the model")
    for body in world.findall("body"):
        walk(body, None)
    return bodies, parents


def link_of(bodies: dict[str, ET.Element], body_name: str, joint_name: str) -> dict:
    body = bodies[body_name]
    joints = body.findall("joint")
    if len(joints) != 1 or joints[0].get("name") != joint_name:
        raise SystemExit(f"{body_name} does not carry exactly the joint {joint_name}")
    joint = joints[0]
    # An anchor offset would change the Jacobian, and nothing downstream models
    # one. Refuse rather than silently drop it.
    if joint.get("pos") is not None:
        raise SystemExit(f"{joint_name} has a pos= anchor the TS chain cannot express")
    if joint.get("ref") is not None:
        raise SystemExit(f"{joint_name} has a ref= the TS chain cannot express")
    if (joint.get("type") or "hinge") != "hinge":
        raise SystemExit(f"{joint_name} is not a hinge")
    rng = parse_floats(joint.get("range"), [])
    if len(rng) != 2:
        raise SystemExit(f"{joint_name} has no range=; the solver would have no limits")
    return {
        "joint": joint_name,
        "body": body_name,
        "pos": parse_floats(body.get("pos"), [0.0, 0.0, 0.0]),
        # MJCF default orientation is the identity quaternion, (w,x,y,z).
        "quat": parse_floats(body.get("quat"), [1.0, 0.0, 0.0, 0.0]),
        "axis": parse_floats(joint.get("axis"), [0.0, 0.0, 1.0]),
        "lower": rng[0],
        "upper": rng[1],
    }


def tip_offset(bodies: dict[str, ET.Element], name: str) -> list[float]:
    body = bodies[name]
    if body.findall("joint"):
        raise SystemExit(f"{name} carries a joint; it is not a rigid tip")
    if parse_floats(body.get("quat"), [1, 0, 0, 0]) != [1.0, 0.0, 0.0, 0.0]:
        raise SystemExit(f"{name} is rotated relative to its parent; the tip is a point only")
    return parse_floats(body.get("pos"), [0.0, 0.0, 0.0])


def build() -> dict:
    root = ET.parse(MODEL).getroot()
    bodies, parents = index_bodies(root)

    out: dict = {"model": MODEL.name, "arms": {}, "hands": {}}

    for side in ("left", "right"):
        links = [link_of(bodies, f"{side}_{j}_link", f"{side}_{j}_joint") for j in ARM_JOINTS]
        # Every arm chain must hang off torso_link, or the frame the browser
        # sends poses in is not the frame the solver works in.
        if parents[links[0]["body"]] != "torso_link":
            raise SystemExit(f"{side} arm does not hang off torso_link")
        # The palm point: the midpoint of the index and middle finger roots. The
        # MJCF has no palm site, and the palm MESH origin is not a grasp centre.
        idx = parse_floats(bodies[f"{side}_hand_index_0_link"].get("pos"), [0, 0, 0])
        mid = parse_floats(bodies[f"{side}_hand_middle_0_link"].get("pos"), [0, 0, 0])
        palm = [(a + b) / 2 for a, b in zip(idx, mid)]
        out["arms"][side] = {"root": "torso_link", "links": links, "tip": palm,
                             "tipOf": links[-1]["body"]}

        fingers = {}
        for finger, names in FINGERS.items():
            flinks = [link_of(bodies, f"{side}_hand_{n}_link", f"{side}_hand_{n}_joint")
                      for n in names]
            if parents[flinks[0]["body"]] != f"{side}_wrist_yaw_link":
                raise SystemExit(f"{side} {finger} does not hang off the wrist")
            fingers[finger] = {
                "root": f"{side}_wrist_yaw_link",
                "links": flinks,
                "tip": tip_offset(bodies, f"{side}_hand_{finger}_finger_tip"),
                "tipOf": flinks[-1]["body"],
            }
        out["hands"][side] = fingers

    site = root.find(".//site[@name='head_camera_site']")
    if site is None:
        raise SystemExit("no head_camera_site")
    if site.get("quat") is not None:
        raise SystemExit("head_camera_site is rotated; the headset mapping assumes identity")
    out["headSiteInTorso"] = parse_floats(site.get("pos"), [0, 0, 0])
    return out


HEADER = '''/**
 * @file g1-chains.generated.ts
 * @description GENERATED — do not edit. The G1 EDU's two 7-DOF arm chains and
 *              six Dex3 finger chains, read out of the MJCF the sim runs.
 * @feature teleop
 * @status live
 *
 * Regenerate with:
 *
 *     python3 robot-agent/hardware/sim_evaluator/mjcf/g1_dex3/export_chains.py \\
 *         > robot-agent/src/teleop/g1-chains.generated.ts
 *
 * Source: %(model)s. Frames compose as
 * `T_child = T_parent · Trans(pos) · Rot(quat) · Rot(axis, q)`, quaternions in
 * (w, x, y, z) — MJCF order, NOT three.js order.
 *
 * The numbers are Unitree's, not ours: `g1-chains.test.ts` pins the ones a
 * careless edit would round away (the 16.00335° shoulder mounts, and the fact
 * that the left and right shoulder-roll LIMITS are not mirrors of each other).
 */

/** One revolute joint and the rigid offset that precedes it. */
export interface ChainLink {
  /** Joint name — the same string `setTeleopJoint` takes. */
  joint: string;
  /** The body this joint lives on, for error messages and tests. */
  body: string;
  /** Body origin relative to its parent, metres. */
  pos: readonly [number, number, number];
  /** Body orientation relative to its parent, (w, x, y, z). */
  quat: readonly [number, number, number, number];
  /** Rotation axis in the body frame, unit length. */
  axis: readonly [number, number, number];
  /** Advertised limits, radians. Not mirrored between sides — see the test. */
  lower: number;
  upper: number;
}

/** A serial chain from `root` to a rigid tip offset on the last link's body. */
export interface Chain {
  /** The body the chain hangs off. Poses are solved in THIS frame. */
  root: string;
  links: readonly ChainLink[];
  /** Tip point in the last link's body frame, metres. */
  tip: readonly [number, number, number];
  /** The body `tip` is expressed in. */
  tipOf: string;
}

export type Side = 'left' | 'right';
export type Finger = 'thumb' | 'index' | 'middle';

'''


def ts(value) -> str:
    """Pretty JSON is valid TypeScript, and a table nobody can read is a table
    nobody will notice has drifted."""
    return json.dumps(value, indent=2)


def emit(data: dict) -> str:
    parts = [HEADER % {"model": data["model"]}]
    parts.append(
        "/**\n"
        " * The eye point in the torso frame, metres, (x forward, y left, z up).\n"
        " *\n"
        " * This is the `head_camera_site`, which is a pure translation off\n"
        " * `torso_link` — deliberately the SITE and not the co-located `head_camera`,\n"
        " * whose `xyaxes` are yawed and tilted per scene. It is what turns a\n"
        " * head-relative wrist vector from the headset into a torso-relative one.\n"
        " */\n"
        f"export const HEAD_SITE_IN_TORSO: readonly [number, number, number] = "
        f"{ts(data['headSiteInTorso'])};\n\n"
    )
    parts.append("/** Arm chains, torso_link -> palm point. */\n")
    parts.append("export const G1_ARM_CHAINS: Readonly<Record<Side, Chain>> = "
                 + ts(data["arms"]) + " as const;\n\n")
    parts.append(
        "/**\n"
        " * Dex3 finger chains, `<side>_wrist_yaw_link` -> fingertip.\n"
        " *\n"
        " * Note the thumb has three joints and the other two have two, and that the\n"
        " * RANGES are sign-flipped between sides (the left index closes toward\n"
        " * negative, the right toward positive). Mirroring one side's table onto the\n"
        " * other produces fingers that open when they should close.\n"
        " */\n"
    )
    parts.append("export const G1_FINGER_CHAINS: Readonly<Record<Side, Readonly<Record<Finger, Chain>>>> = "
                 + ts(data["hands"]) + " as const;\n")
    return "".join(parts)


if __name__ == "__main__":
    sys.stdout.write(emit(build()))
