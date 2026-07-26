#!/usr/bin/env python3
"""Generate g1_43dof_planarbase.xml from g1_43dof_fixedbase.xml.

Agent Mode (TASK-194) needs a G1 that can *move through a room* while the
existing pick-place workstream keeps its fixed-base robot untouched. Walking is
out of scope for v1 (see the task's follow-ups: a real gait policy is a separate
piece of work), so the base is driven **kinematically**: the pelvis gets three
planar DOFs (x, y, yaw) that the loco service position-controls directly. The
legs stay in the stand pose and the feet float ~1.5 cm above the floor, so foot
friction never fights the base actuators -- verify that claim with `mj_forward`
on the room scene rather than trusting it: `d.ncon` must be 0 at qpos 0, and the
first version of this file got it wrong by 3.2 cm in the wrong direction (see
PELVIS_Z).

What matters for Agent Mode is that the head camera genuinely moves with the
base -- `look` must return different images from different places in the room.

Regenerate with:

    python3 robot-agent/hardware/sim_evaluator/mjcf/g1_dex3/build_planarbase_include.py

Transform applied to the fixed-base source:
  1. pelvis pos/quat: the baked-in pick-place pose (-0.15, 0, 0.76) + 90 deg yaw
     is replaced by the origin at standing height with identity orientation, so
     the robot faces world +x and the planar joints define its pose.
  2. three joints (base_x, base_y, base_yaw) inserted as the pelvis' first
     children, with the class-g1 armature/frictionloss defaults overridden to 0
     -- this is a kinematic carrier, not a physical joint.
  3. three position actuators appended *after* the existing 43, so the SDK motor
     index -> actuator index mapping used by sim_g1_dds/joints.py is unchanged.
  4. head_camera re-aimed: the fixed-base camera is yawed/tilted at the table;
     the room robot needs a forward view (+x) with a 15 deg downward tilt so
     floor, furniture and people are all in frame.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
SRC = HERE / "g1_43dof_fixedbase.xml"
DST = HERE / "g1_43dof_planarbase.xml"

# Feet float ~1.5 cm above the floor at this pelvis height (legs at qpos 0), so
# the kinematic base never fights foot contact friction.
#
# Measured, not guessed: at qpos 0 the ankle_roll foot geoms sit at centre
# z = -0.01186 with radius 0.005 below the pelvis-relative -0.775 the fixed-base
# model was posed at, so PELVIS_Z = 0.775 actually buried both feet 1.69 cm in
# the floor (mj_forward -> ncon = 8, dist = -0.016864 on every floor<->foot
# pair). That fired a ~46 kN contact impulse on the first step and ratcheted the
# legs out of the stand pose. 0.775 + 0.016864 = 0.7919 rests them exactly on the
# floor; 0.807 is that plus the documented ~1.5 cm of clearance (verified:
# ncon = 0 at rest).
PELVIS_Z = 0.807

# Camera looks along +x, tilted 15 deg down. MuJoCo xyaxes = (right, up):
#   right = -y = (0,-1,0);  up = (sin15, 0, cos15) = (0.2588, 0, 0.9659)
#   => -z_cam = right x up reversed = (0.9659, 0, -0.2588) = forward, 15 deg down
HEAD_CAM_XYAXES = "0 -1 0 0.2588 0 0.9659"

BASE_JOINTS = f"""      <!-- Kinematic planar base (Agent Mode). Position-actuated by the loco
           service; armature/frictionloss zeroed so it carries rather than
           simulates the robot. Range is the largest room we care about. -->
      <joint name="base_x" type="slide" axis="1 0 0" range="-25 25"
        armature="0" frictionloss="0" damping="0"/>
      <joint name="base_y" type="slide" axis="0 1 0" range="-25 25"
        armature="0" frictionloss="0" damping="0"/>
      <joint name="base_yaw" type="hinge" axis="0 0 1" range="-100 100"
        armature="0" frictionloss="0" damping="0"/>
"""

BASE_ACTUATORS = """    <!-- Planar base, appended after the 43 robot actuators so existing SDK
         motor-index -> actuator-index mapping is untouched. High gain: these
         carry the full ~35 kg robot and must track the commanded pose. -->
    <position name="base_x" joint="base_x" kp="40000" dampratio="1" ctrlrange="-25 25"/>
    <position name="base_y" joint="base_y" kp="40000" dampratio="1" ctrlrange="-25 25"/>
    <position name="base_yaw" joint="base_yaw" kp="20000" dampratio="1" ctrlrange="-100 100"/>
"""

HEADER_NOTE = """<!--
    GENERATED FILE - do not edit by hand.
    Produced by build_planarbase_include.py from g1_43dof_fixedbase.xml.
    See that script for the exact transform and the rationale.
  -->
"""


def build(src_text: str) -> str:
    out = src_text

    # 1 + 2: re-pose the pelvis and give it the planar DOFs.
    pelvis_re = re.compile(
        r'(<body name="pelvis")\s+pos="[^"]*"\s+quat="[^"]*"(\s+childclass="g1">\n)'
    )
    if not pelvis_re.search(out):
        raise SystemExit("pelvis body tag not found - source layout changed")
    out = pelvis_re.sub(
        lambda m: f'{m.group(1)} pos="0 0 {PELVIS_Z}"{m.group(2)}{BASE_JOINTS}',
        out,
        count=1,
    )

    # 3: append the base actuators just before </actuator>.
    if "</actuator>" not in out:
        raise SystemExit("no </actuator> in source")
    out = out.replace("  </actuator>", BASE_ACTUATORS + "  </actuator>", 1)

    # 4: re-aim the head camera.
    cam_re = re.compile(r'(<camera name="head_camera" pos="[^"]*" xyaxes=")[^"]*(")')
    if not cam_re.search(out):
        raise SystemExit("head_camera not found - source layout changed")
    out = cam_re.sub(lambda m: f"{m.group(1)}{HEAD_CAM_XYAXES}{m.group(2)}", out, count=1)

    # Model name + generated-file banner.
    out = out.replace(
        '<mujoco model="g1_dex3_43dof_fixedbase">',
        '<mujoco model="g1_dex3_43dof_planarbase">\n  ' + HEADER_NOTE.strip(),
        1,
    )
    return out


def main() -> int:
    if not SRC.exists():
        raise SystemExit(f"missing source: {SRC}")
    DST.write_text(build(SRC.read_text()), encoding="utf-8")
    print(f"wrote {DST.relative_to(HERE.parent)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
