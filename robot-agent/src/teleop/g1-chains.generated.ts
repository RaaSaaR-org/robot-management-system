/**
 * @file g1-chains.generated.ts
 * @description GENERATED — do not edit. The G1 EDU's two 7-DOF arm chains and
 *              six Dex3 finger chains, read out of the MJCF the sim runs.
 * @feature teleop
 * @status live
 *
 * Regenerate with:
 *
 *     python3 robot-agent/hardware/sim_evaluator/mjcf/g1_dex3/export_chains.py \
 *         > robot-agent/src/teleop/g1-chains.generated.ts
 *
 * Source: g1_43dof_fixedbase.xml. Frames compose as
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

/**
 * The eye point in the torso frame, metres, (x forward, y left, z up).
 *
 * This is the `head_camera_site`, which is a pure translation off
 * `torso_link` — deliberately the SITE and not the co-located `head_camera`,
 * whose `xyaxes` are yawed and tilted per scene. It is what turns a
 * head-relative wrist vector from the headset into a torso-relative one.
 */
export const HEAD_SITE_IN_TORSO: readonly [number, number, number] = [
  0.08,
  0.0,
  0.42
];

/** Arm chains, torso_link -> palm point. */
export const G1_ARM_CHAINS: Readonly<Record<Side, Chain>> = {
  "left": {
    "root": "torso_link",
    "links": [
      {
        "joint": "left_shoulder_pitch_joint",
        "body": "left_shoulder_pitch_link",
        "pos": [
          0.0039563,
          0.10022,
          0.24778
        ],
        "quat": [
          0.990264,
          0.139201,
          1.38722e-05,
          -9.86868e-05
        ],
        "axis": [
          0.0,
          1.0,
          0.0
        ],
        "lower": -3.0892,
        "upper": 2.6704
      },
      {
        "joint": "left_shoulder_roll_joint",
        "body": "left_shoulder_roll_link",
        "pos": [
          0.0,
          0.038,
          -0.013831
        ],
        "quat": [
          0.990268,
          -0.139172,
          0.0,
          0.0
        ],
        "axis": [
          1.0,
          0.0,
          0.0
        ],
        "lower": -1.5882,
        "upper": 2.2515
      },
      {
        "joint": "left_shoulder_yaw_joint",
        "body": "left_shoulder_yaw_link",
        "pos": [
          0.0,
          0.00624,
          -0.1032
        ],
        "quat": [
          1.0,
          0.0,
          0.0,
          0.0
        ],
        "axis": [
          0.0,
          0.0,
          1.0
        ],
        "lower": -2.618,
        "upper": 2.618
      },
      {
        "joint": "left_elbow_joint",
        "body": "left_elbow_link",
        "pos": [
          0.015783,
          0.0,
          -0.080518
        ],
        "quat": [
          1.0,
          0.0,
          0.0,
          0.0
        ],
        "axis": [
          0.0,
          1.0,
          0.0
        ],
        "lower": -1.0472,
        "upper": 2.0944
      },
      {
        "joint": "left_wrist_roll_joint",
        "body": "left_wrist_roll_link",
        "pos": [
          0.1,
          0.00188791,
          -0.01
        ],
        "quat": [
          1.0,
          0.0,
          0.0,
          0.0
        ],
        "axis": [
          1.0,
          0.0,
          0.0
        ],
        "lower": -1.97222,
        "upper": 1.97222
      },
      {
        "joint": "left_wrist_pitch_joint",
        "body": "left_wrist_pitch_link",
        "pos": [
          0.038,
          0.0,
          0.0
        ],
        "quat": [
          1.0,
          0.0,
          0.0,
          0.0
        ],
        "axis": [
          0.0,
          1.0,
          0.0
        ],
        "lower": -1.61443,
        "upper": 1.61443
      },
      {
        "joint": "left_wrist_yaw_joint",
        "body": "left_wrist_yaw_link",
        "pos": [
          0.046,
          0.0,
          0.0
        ],
        "quat": [
          1.0,
          0.0,
          0.0,
          0.0
        ],
        "axis": [
          0.0,
          0.0,
          1.0
        ],
        "lower": -1.61443,
        "upper": 1.61443
      }
    ],
    "tip": [
      0.1192,
      0.0046,
      0.0
    ],
    "tipOf": "left_wrist_yaw_link"
  },
  "right": {
    "root": "torso_link",
    "links": [
      {
        "joint": "right_shoulder_pitch_joint",
        "body": "right_shoulder_pitch_link",
        "pos": [
          0.0039563,
          -0.10021,
          0.24778
        ],
        "quat": [
          0.990264,
          -0.139201,
          1.38722e-05,
          9.86868e-05
        ],
        "axis": [
          0.0,
          1.0,
          0.0
        ],
        "lower": -3.0892,
        "upper": 2.6704
      },
      {
        "joint": "right_shoulder_roll_joint",
        "body": "right_shoulder_roll_link",
        "pos": [
          0.0,
          -0.038,
          -0.013831
        ],
        "quat": [
          0.990268,
          0.139172,
          0.0,
          0.0
        ],
        "axis": [
          1.0,
          0.0,
          0.0
        ],
        "lower": -2.2515,
        "upper": 1.5882
      },
      {
        "joint": "right_shoulder_yaw_joint",
        "body": "right_shoulder_yaw_link",
        "pos": [
          0.0,
          -0.00624,
          -0.1032
        ],
        "quat": [
          1.0,
          0.0,
          0.0,
          0.0
        ],
        "axis": [
          0.0,
          0.0,
          1.0
        ],
        "lower": -2.618,
        "upper": 2.618
      },
      {
        "joint": "right_elbow_joint",
        "body": "right_elbow_link",
        "pos": [
          0.015783,
          0.0,
          -0.080518
        ],
        "quat": [
          1.0,
          0.0,
          0.0,
          0.0
        ],
        "axis": [
          0.0,
          1.0,
          0.0
        ],
        "lower": -1.0472,
        "upper": 2.0944
      },
      {
        "joint": "right_wrist_roll_joint",
        "body": "right_wrist_roll_link",
        "pos": [
          0.1,
          -0.00188791,
          -0.01
        ],
        "quat": [
          1.0,
          0.0,
          0.0,
          0.0
        ],
        "axis": [
          1.0,
          0.0,
          0.0
        ],
        "lower": -1.97222,
        "upper": 1.97222
      },
      {
        "joint": "right_wrist_pitch_joint",
        "body": "right_wrist_pitch_link",
        "pos": [
          0.038,
          0.0,
          0.0
        ],
        "quat": [
          1.0,
          0.0,
          0.0,
          0.0
        ],
        "axis": [
          0.0,
          1.0,
          0.0
        ],
        "lower": -1.61443,
        "upper": 1.61443
      },
      {
        "joint": "right_wrist_yaw_joint",
        "body": "right_wrist_yaw_link",
        "pos": [
          0.046,
          0.0,
          0.0
        ],
        "quat": [
          1.0,
          0.0,
          0.0,
          0.0
        ],
        "axis": [
          0.0,
          0.0,
          1.0
        ],
        "lower": -1.61443,
        "upper": 1.61443
      }
    ],
    "tip": [
      0.1192,
      -0.0046,
      0.0
    ],
    "tipOf": "right_wrist_yaw_link"
  }
} as const;

/**
 * Dex3 finger chains, `<side>_wrist_yaw_link` -> fingertip.
 *
 * Note the thumb has three joints and the other two have two, and that the
 * RANGES are sign-flipped between sides (the left index closes toward
 * negative, the right toward positive). Mirroring one side's table onto the
 * other produces fingers that open when they should close.
 */
export const G1_FINGER_CHAINS: Readonly<Record<Side, Readonly<Record<Finger, Chain>>>> = {
  "left": {
    "thumb": {
      "root": "left_wrist_yaw_link",
      "links": [
        {
          "joint": "left_hand_thumb_0_joint",
          "body": "left_hand_thumb_0_link",
          "pos": [
            0.067,
            0.003,
            0.0
          ],
          "quat": [
            1.0,
            0.0,
            0.0,
            0.0
          ],
          "axis": [
            0.0,
            1.0,
            0.0
          ],
          "lower": -1.0472,
          "upper": 1.0472
        },
        {
          "joint": "left_hand_thumb_1_joint",
          "body": "left_hand_thumb_1_link",
          "pos": [
            -0.0025,
            -0.0193,
            0.0
          ],
          "quat": [
            1.0,
            0.0,
            0.0,
            0.0
          ],
          "axis": [
            0.0,
            0.0,
            1.0
          ],
          "lower": -0.724312,
          "upper": 1.0472
        },
        {
          "joint": "left_hand_thumb_2_joint",
          "body": "left_hand_thumb_2_link",
          "pos": [
            0.0,
            -0.0458,
            0.0
          ],
          "quat": [
            1.0,
            0.0,
            0.0,
            0.0
          ],
          "axis": [
            0.0,
            0.0,
            1.0
          ],
          "lower": 0.0,
          "upper": 1.74533
        }
      ],
      "tip": [
        0.0,
        -0.048,
        0.0
      ],
      "tipOf": "left_hand_thumb_2_link"
    },
    "index": {
      "root": "left_wrist_yaw_link",
      "links": [
        {
          "joint": "left_hand_index_0_joint",
          "body": "left_hand_index_0_link",
          "pos": [
            0.1192,
            0.0046,
            0.0285
          ],
          "quat": [
            1.0,
            0.0,
            0.0,
            0.0
          ],
          "axis": [
            0.0,
            0.0,
            1.0
          ],
          "lower": -1.5708,
          "upper": 0.0
        },
        {
          "joint": "left_hand_index_1_joint",
          "body": "left_hand_index_1_link",
          "pos": [
            0.0458,
            0.0,
            0.0
          ],
          "quat": [
            1.0,
            0.0,
            0.0,
            0.0
          ],
          "axis": [
            0.0,
            0.0,
            1.0
          ],
          "lower": -1.74533,
          "upper": 0.0
        }
      ],
      "tip": [
        0.048,
        0.0,
        0.0
      ],
      "tipOf": "left_hand_index_1_link"
    },
    "middle": {
      "root": "left_wrist_yaw_link",
      "links": [
        {
          "joint": "left_hand_middle_0_joint",
          "body": "left_hand_middle_0_link",
          "pos": [
            0.1192,
            0.0046,
            -0.0285
          ],
          "quat": [
            1.0,
            0.0,
            0.0,
            0.0
          ],
          "axis": [
            0.0,
            0.0,
            1.0
          ],
          "lower": -1.5708,
          "upper": 0.0
        },
        {
          "joint": "left_hand_middle_1_joint",
          "body": "left_hand_middle_1_link",
          "pos": [
            0.0458,
            0.0,
            0.0
          ],
          "quat": [
            1.0,
            0.0,
            0.0,
            0.0
          ],
          "axis": [
            0.0,
            0.0,
            1.0
          ],
          "lower": -1.74533,
          "upper": 0.0
        }
      ],
      "tip": [
        0.048,
        0.0,
        0.0
      ],
      "tipOf": "left_hand_middle_1_link"
    }
  },
  "right": {
    "thumb": {
      "root": "right_wrist_yaw_link",
      "links": [
        {
          "joint": "right_hand_thumb_0_joint",
          "body": "right_hand_thumb_0_link",
          "pos": [
            0.067,
            -0.003,
            0.0
          ],
          "quat": [
            1.0,
            0.0,
            0.0,
            0.0
          ],
          "axis": [
            0.0,
            1.0,
            0.0
          ],
          "lower": -1.0472,
          "upper": 1.0472
        },
        {
          "joint": "right_hand_thumb_1_joint",
          "body": "right_hand_thumb_1_link",
          "pos": [
            -0.0025,
            0.0193,
            0.0
          ],
          "quat": [
            1.0,
            0.0,
            0.0,
            0.0
          ],
          "axis": [
            0.0,
            0.0,
            1.0
          ],
          "lower": -1.0472,
          "upper": 0.724312
        },
        {
          "joint": "right_hand_thumb_2_joint",
          "body": "right_hand_thumb_2_link",
          "pos": [
            0.0,
            0.0458,
            0.0
          ],
          "quat": [
            1.0,
            0.0,
            0.0,
            0.0
          ],
          "axis": [
            0.0,
            0.0,
            1.0
          ],
          "lower": -1.74533,
          "upper": 0.0
        }
      ],
      "tip": [
        0.0,
        0.048,
        0.0
      ],
      "tipOf": "right_hand_thumb_2_link"
    },
    "index": {
      "root": "right_wrist_yaw_link",
      "links": [
        {
          "joint": "right_hand_index_0_joint",
          "body": "right_hand_index_0_link",
          "pos": [
            0.1192,
            -0.0046,
            0.0285
          ],
          "quat": [
            1.0,
            0.0,
            0.0,
            0.0
          ],
          "axis": [
            0.0,
            0.0,
            1.0
          ],
          "lower": 0.0,
          "upper": 1.5708
        },
        {
          "joint": "right_hand_index_1_joint",
          "body": "right_hand_index_1_link",
          "pos": [
            0.0458,
            0.0,
            0.0
          ],
          "quat": [
            1.0,
            0.0,
            0.0,
            0.0
          ],
          "axis": [
            0.0,
            0.0,
            1.0
          ],
          "lower": 0.0,
          "upper": 1.74533
        }
      ],
      "tip": [
        0.048,
        0.0,
        0.0
      ],
      "tipOf": "right_hand_index_1_link"
    },
    "middle": {
      "root": "right_wrist_yaw_link",
      "links": [
        {
          "joint": "right_hand_middle_0_joint",
          "body": "right_hand_middle_0_link",
          "pos": [
            0.1192,
            -0.0046,
            -0.0285
          ],
          "quat": [
            1.0,
            0.0,
            0.0,
            0.0
          ],
          "axis": [
            0.0,
            0.0,
            1.0
          ],
          "lower": 0.0,
          "upper": 1.5708
        },
        {
          "joint": "right_hand_middle_1_joint",
          "body": "right_hand_middle_1_link",
          "pos": [
            0.0458,
            0.0,
            0.0
          ],
          "quat": [
            1.0,
            0.0,
            0.0,
            0.0
          ],
          "axis": [
            0.0,
            0.0,
            1.0
          ],
          "lower": 0.0,
          "upper": 1.74533
        }
      ],
      "tip": [
        0.048,
        0.0,
        0.0
      ],
      "tipOf": "right_hand_middle_1_link"
    }
  }
} as const;
