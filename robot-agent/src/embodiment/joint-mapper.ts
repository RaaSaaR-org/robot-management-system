/**
 * @file joint-mapper.ts
 * @description Joint mapping between VLA actions and robot joint commands
 * @feature vla
 */

import type { Action } from '../vla/types.js';
import type {
  EmbodimentConfig,
  JointCommand,
  JointState,
  ValidationResult,
} from './types.js';

/**
 * JointMapper handles the mapping between VLA action indices and
 * named robot joints, as well as converting between different
 * joint representations.
 *
 * @example
 * ```typescript
 * const mapper = new JointMapper();
 *
 * // Map VLA action to named joint commands
 * const commands = mapper.mapActionToJoints(action, config);
 *
 * // Map joint states to observation array
 * const observation = mapper.mapJointsToObservation(joints, config);
 * ```
 */
export class JointMapper {
  /**
   * Map a VLA action to an array of named joint commands.
   *
   * @param action VLA action with joint commands
   * @param config Embodiment configuration
   * @returns Array of JointCommand objects with joint names
   */
  mapActionToJoints(action: Action, config: EmbodimentConfig): JointCommand[] {
    const jointNames = config.proprioception.joint_names;
    const commands: JointCommand[] = [];

    for (let i = 0; i < Math.min(action.jointCommands.length, jointNames.length); i++) {
      commands.push({
        name: jointNames[i],
        position: action.jointCommands[i],
      });
    }

    // Handle dimension mismatch
    if (action.jointCommands.length !== jointNames.length) {
      console.warn(
        `[JointMapper] Dimension mismatch: action has ${action.jointCommands.length} joints, ` +
        `config has ${jointNames.length} joint names`
      );

      // Pad with zero-position commands if action is shorter
      for (let i = action.jointCommands.length; i < jointNames.length; i++) {
        commands.push({
          name: jointNames[i],
          position: 0,
        });
      }
    }

    return commands;
  }

  /**
   * Map joint states to a proprioception observation array.
   * The array contains [positions..., velocities...] in joint order.
   *
   * @param joints Array of joint states
   * @param config Embodiment configuration
   * @returns Proprioception observation array
   */
  mapJointsToObservation(joints: JointState[], config: EmbodimentConfig): number[] {
    const jointNames = config.proprioception.joint_names;
    const numJoints = jointNames.length;

    // Create observation array [positions, velocities]
    const observation: number[] = new Array(numJoints * 2).fill(0);

    // Build lookup map for fast joint access
    const jointMap = new Map<string, JointState>();
    for (const joint of joints) {
      jointMap.set(joint.name, joint);
    }

    // Fill in positions and velocities
    for (let i = 0; i < numJoints; i++) {
      const jointState = jointMap.get(jointNames[i]);
      if (jointState) {
        observation[i] = jointState.position;
        observation[numJoints + i] = jointState.velocity;
      } else {
        console.warn(
          `[JointMapper] Joint "${jointNames[i]}" not found in state, using default values`
        );
      }
    }

    return observation;
  }

  /**
   * Map a raw joint positions array to named JointState objects.
   *
   * @param positions Joint position values
   * @param velocities Joint velocity values (optional)
   * @param config Embodiment configuration
   * @returns Array of JointState objects
   */
  mapArrayToJointStates(
    positions: number[],
    velocities: number[] | undefined,
    config: EmbodimentConfig
  ): JointState[] {
    const jointNames = config.proprioception.joint_names;
    const states: JointState[] = [];

    for (let i = 0; i < jointNames.length; i++) {
      states.push({
        name: jointNames[i],
        position: i < positions.length ? positions[i] : 0,
        velocity: velocities && i < velocities.length ? velocities[i] : 0,
      });
    }

    return states;
  }

  /**
   * Validate that an action's dimension matches the configuration.
   *
   * @param action VLA action to validate
   * @param config Embodiment configuration
   * @returns Validation result
   */
  validateActionDim(action: Action, config: EmbodimentConfig): ValidationResult {
    const expected = config.action.dim;
    const actual = action.jointCommands.length;

    if (actual !== expected) {
      return {
        valid: false,
        expected,
        actual,
        message: `Action dimension mismatch: expected ${expected}, got ${actual}`,
      };
    }

    return { valid: true, expected, actual };
  }

  /**
   * Get the joint name for a given action index.
   *
   * @param actionIndex Index in the action array
   * @param config Embodiment configuration
   * @returns Joint name or undefined if out of range
   */
  getJointName(actionIndex: number, config: EmbodimentConfig): string | undefined {
    const jointNames = config.proprioception.joint_names;
    if (actionIndex < 0 || actionIndex >= jointNames.length) {
      return undefined;
    }
    return jointNames[actionIndex];
  }

  /**
   * Get the action index for a given joint name.
   *
   * @param jointName Name of the joint
   * @param config Embodiment configuration
   * @returns Index in action array or -1 if not found
   */
  getJointIndex(jointName: string, config: EmbodimentConfig): number {
    return config.proprioception.joint_names.indexOf(jointName);
  }

  /**
   * Create a zero action for the given configuration.
   * Useful for initialization or neutral positions.
   *
   * @param config Embodiment configuration
   * @returns Action with all joints at zero
   */
  createZeroAction(config: EmbodimentConfig): Action {
    return {
      jointCommands: new Array(config.action.dim).fill(0),
      gripperCommand: 0,
      timestamp: Date.now() / 1000,
    };
  }

  /**
   * Create an action from mean positions (default stance).
   *
   * @param config Embodiment configuration
   * @returns Action with joints at mean positions
   */
  createMeanAction(config: EmbodimentConfig): Action {
    return {
      jointCommands: [...config.action.normalization.mean],
      gripperCommand: 0,
      timestamp: Date.now() / 1000,
    };
  }

  /**
   * Extract gripper command from action if last joint is gripper.
   * Many embodiments have gripper as the last DOF.
   *
   * @param action VLA action
   * @param config Embodiment configuration
   * @returns Gripper command value or undefined
   */
  extractGripperCommand(action: Action, config: EmbodimentConfig): number | undefined {
    const jointNames = config.proprioception.joint_names;
    const lastJointName = jointNames[jointNames.length - 1];

    // Check if last joint is a gripper
    if (lastJointName.toLowerCase().includes('gripper')) {
      const gripperIndex = jointNames.length - 1;
      if (gripperIndex < action.jointCommands.length) {
        return action.jointCommands[gripperIndex];
      }
    }

    // Return the explicit gripper command if available
    return action.gripperCommand;
  }

  /**
   * Check if a joint name represents a gripper.
   *
   * @param jointName Joint name to check
   * @returns True if joint is a gripper
   */
  isGripperJoint(jointName: string): boolean {
    const lower = jointName.toLowerCase();
    return lower.includes('gripper') || lower.includes('finger') || lower.includes('hand');
  }

  /**
   * Get joint groups by body part (for humanoids).
   *
   * @param config Embodiment configuration
   * @returns Map of body part to joint indices
   */
  getJointGroups(config: EmbodimentConfig): Map<string, number[]> {
    const groups = new Map<string, number[]>();
    const jointNames = config.proprioception.joint_names;

    // Initialize groups
    groups.set('left_leg', []);
    groups.set('right_leg', []);
    groups.set('left_arm', []);
    groups.set('right_arm', []);
    groups.set('torso', []);
    groups.set('head', []);
    groups.set('gripper', []);
    groups.set('other', []);

    for (let i = 0; i < jointNames.length; i++) {
      const name = jointNames[i].toLowerCase();

      if (name.includes('left') && (name.includes('leg') || name.includes('hip') ||
          name.includes('knee') || name.includes('ankle'))) {
        groups.get('left_leg')!.push(i);
      } else if (name.includes('right') && (name.includes('leg') || name.includes('hip') ||
          name.includes('knee') || name.includes('ankle'))) {
        groups.get('right_leg')!.push(i);
      } else if (name.includes('left') && (name.includes('arm') || name.includes('shoulder') ||
          name.includes('elbow') || name.includes('wrist'))) {
        groups.get('left_arm')!.push(i);
      } else if (name.includes('right') && (name.includes('arm') || name.includes('shoulder') ||
          name.includes('elbow') || name.includes('wrist'))) {
        groups.get('right_arm')!.push(i);
      } else if (name.includes('torso') || name.includes('waist') || name.includes('spine')) {
        groups.get('torso')!.push(i);
      } else if (name.includes('head') || name.includes('neck')) {
        groups.get('head')!.push(i);
      } else if (this.isGripperJoint(name)) {
        groups.get('gripper')!.push(i);
      } else {
        groups.get('other')!.push(i);
      }
    }

    // Remove empty groups
    for (const [key, indices] of groups) {
      if (indices.length === 0) {
        groups.delete(key);
      }
    }

    return groups;
  }
}
