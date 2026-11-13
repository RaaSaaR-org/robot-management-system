/**
 * @file standardRobotTypes.ts
 * @description The standard robot types as plain data (TASK-363), apart from
 *              the seed that writes them: a script that only talks to a remote
 *              instance (`rename:robot-type`, TASK-493) reads the names without
 *              loading the database client.
 * @feature training
 */

/** One standard robot configuration. Widths are `observation.state` and `action`. */
export interface StandardRobotType {
  name: string;
  manufacturer: string;
  model: string;
  actionDim: number;
  proprioceptionDim: number;
}

export const STANDARD_ROBOT_TYPES: readonly StandardRobotType[] = [
  {
    // 29 body joints + 7 per Dex3-1 hand — the whole-body layout (GR00T-N1.7-AppleToPlate).
    name: 'Unitree G1 EDU (Dex3-1)',
    manufacturer: 'Unitree',
    model: 'unitree_g1_edu_dex3',
    actionDim: 43,
    proprioceptionDim: 43,
  },
  {
    // 7 per arm + 7 per Dex3-1 hand — the upper-body teleop layout.
    name: 'Unitree G1 arms + Dex3-1 hands',
    manufacturer: 'Unitree',
    model: 'unitree_g1_dex3_arms',
    actionDim: 28,
    proprioceptionDim: 28,
  },
  {
    // 5 joints + gripper; SO-100 recordings share the layout.
    name: 'SO-101 Follower',
    manufacturer: 'TheRobotStudio',
    model: 'so101_follower',
    actionDim: 6,
    proprioceptionDim: 6,
  },
  {
    // Pollen Robotics / Hugging Face Microduck (TASK-477): a 25 cm biped driven
    // by fifteen servos from RL policies. No LeRobot dataset of one exists yet,
    // so the widths are the one thing the maker states — one value per servo —
    // not a recorded layout. The create-only rule above means a correction
    // lands as a new name, not an edit.
    name: 'Microduck',
    manufacturer: 'Pollen Robotics',
    model: 'microduck',
    actionDim: 15,
    proprioceptionDim: 15,
  },
];
