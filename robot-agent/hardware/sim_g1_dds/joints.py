"""SDK motor index -> MJCF actuator/joint name tables for the G1 EDU + Dex3-1.

Shared by sim_node.py and any script that has to translate between the Unitree
wire protocol and our MuJoCo scenes. The ordering here IS the protocol: index i
of `LowCmd_.motor_cmd` / `LowState_.motor_state` is BODY[i], and index i of a
Dex3 `HandCmd_` is LHAND[i] / RHAND[i] for that side.
"""
from __future__ import annotations

# rt/lowstate and rt/arm_sdk motor order 0..28 (legs | waist | arms).
BODY: list[str] = [
    "left_hip_pitch_joint", "left_hip_roll_joint", "left_hip_yaw_joint",
    "left_knee_joint", "left_ankle_pitch_joint", "left_ankle_roll_joint",
    "right_hip_pitch_joint", "right_hip_roll_joint", "right_hip_yaw_joint",
    "right_knee_joint", "right_ankle_pitch_joint", "right_ankle_roll_joint",
    "waist_yaw_joint", "waist_roll_joint", "waist_pitch_joint",
    "left_shoulder_pitch_joint", "left_shoulder_roll_joint",
    "left_shoulder_yaw_joint", "left_elbow_joint", "left_wrist_roll_joint",
    "left_wrist_pitch_joint", "left_wrist_yaw_joint",
    "right_shoulder_pitch_joint", "right_shoulder_roll_joint",
    "right_shoulder_yaw_joint", "right_elbow_joint", "right_wrist_roll_joint",
    "right_wrist_pitch_joint", "right_wrist_yaw_joint",
]

# rt/dex3/*/{cmd,state} motor order. The left/right asymmetry (middle before
# index on the left, index before middle on the right) is real -- it comes from
# the hardware, not from a transcription mistake here.
LHAND: list[str] = [
    "left_hand_thumb_0_joint", "left_hand_thumb_1_joint",
    "left_hand_thumb_2_joint", "left_hand_middle_0_joint",
    "left_hand_middle_1_joint", "left_hand_index_0_joint",
    "left_hand_index_1_joint",
]
RHAND: list[str] = [
    "right_hand_thumb_0_joint", "right_hand_thumb_1_joint",
    "right_hand_thumb_2_joint", "right_hand_index_0_joint",
    "right_hand_index_1_joint", "right_hand_middle_0_joint",
    "right_hand_middle_1_joint",
]

# arm_sdk enable/blend slot (kNotUsedJoint). motor_cmd[29].q carries a 0..1
# weight: 0 = the robot's own controller owns the joints, 1 = the arm_sdk
# publisher does. Everything in between is a linear blend.
WEIGHT_IDX = 29

# Planar base DOFs added by g1_dex3/build_planarbase_include.py. Only present in
# the room scene; sim_node.py treats them as optional.
BASE_JOINTS: list[str] = ["base_x", "base_y", "base_yaw"]

# Indices into BODY for the joints the canned arm gestures drive.
WAIST_YAW = 12
L_SHOULDER_PITCH, L_SHOULDER_ROLL, L_ELBOW = 15, 16, 18
R_SHOULDER_PITCH, R_SHOULDER_ROLL, R_SHOULDER_YAW = 22, 23, 24
R_ELBOW, R_WRIST_ROLL = 25, 26

N_BODY = len(BODY)
N_HAND = len(LHAND)
