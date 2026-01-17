/**
 * @file joint-mapper.test.ts
 * @description Unit tests for JointMapper
 * @feature vla
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { JointMapper } from '../joint-mapper.js';
import type { EmbodimentConfig, JointState } from '../types.js';
import type { Action } from '../../vla/types.js';

describe('JointMapper', () => {
  let mapper: JointMapper;
  let mockH1Config: EmbodimentConfig;
  let mockSo101Config: EmbodimentConfig;

  beforeEach(() => {
    mapper = new JointMapper();

    // H1 humanoid config (simplified to 6 joints)
    mockH1Config = {
      embodiment_tag: 'unitree_h1',
      manufacturer: 'Unitree',
      model: 'H1',
      action: {
        dim: 6,
        normalization: {
          mean: [0, 0, 0, 0, 0, 0],
          std: [1, 1, 1, 1, 1, 1],
        },
      },
      proprioception: {
        dim: 12,
        joint_names: [
          'left_hip_yaw',
          'left_hip_roll',
          'left_hip_pitch',
          'right_hip_yaw',
          'right_hip_roll',
          'right_hip_pitch',
        ],
      },
      cameras: [],
      version: '1.0.0',
    };

    // SO101 arm config
    mockSo101Config = {
      embodiment_tag: 'so101_arm',
      manufacturer: 'SO-ARM100',
      model: 'SO101',
      action: {
        dim: 6,
        normalization: {
          mean: [0, 0, 0, 0, 0, 0.785],
          std: [1.92, 1.75, 1.69, 1.66, 2.79, 0.96],
        },
      },
      proprioception: {
        dim: 12,
        joint_names: [
          'shoulder_pan',
          'shoulder_lift',
          'elbow_flex',
          'wrist_flex',
          'wrist_roll',
          'gripper',
        ],
      },
      cameras: [],
      version: '1.0.0',
    };
  });

  describe('mapActionToJoints', () => {
    it('should map action to named joint commands', () => {
      const action: Action = {
        jointCommands: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6],
        gripperCommand: 0.5,
        timestamp: 1000,
      };

      const commands = mapper.mapActionToJoints(action, mockH1Config);

      expect(commands.length).toBe(6);
      expect(commands[0]).toEqual({ name: 'left_hip_yaw', position: 0.1 });
      expect(commands[5]).toEqual({ name: 'right_hip_pitch', position: 0.6 });
    });

    it('should handle dimension mismatch by padding', () => {
      const action: Action = {
        jointCommands: [0.1, 0.2], // Too short
        gripperCommand: 0.5,
        timestamp: 1000,
      };

      const commands = mapper.mapActionToJoints(action, mockH1Config);

      expect(commands.length).toBe(6);
      expect(commands[0].position).toBe(0.1);
      expect(commands[1].position).toBe(0.2);
      // Padded with zeros
      expect(commands[2].position).toBe(0);
      expect(commands[5].position).toBe(0);
    });
  });

  describe('mapJointsToObservation', () => {
    it('should map joint states to observation array', () => {
      const joints: JointState[] = [
        { name: 'left_hip_yaw', position: 0.1, velocity: 0.01 },
        { name: 'left_hip_roll', position: 0.2, velocity: 0.02 },
        { name: 'left_hip_pitch', position: 0.3, velocity: 0.03 },
        { name: 'right_hip_yaw', position: 0.4, velocity: 0.04 },
        { name: 'right_hip_roll', position: 0.5, velocity: 0.05 },
        { name: 'right_hip_pitch', position: 0.6, velocity: 0.06 },
      ];

      const observation = mapper.mapJointsToObservation(joints, mockH1Config);

      // Should be [positions..., velocities...]
      expect(observation.length).toBe(12);
      // Positions
      expect(observation[0]).toBe(0.1);
      expect(observation[5]).toBe(0.6);
      // Velocities
      expect(observation[6]).toBe(0.01);
      expect(observation[11]).toBe(0.06);
    });

    it('should handle missing joints by using zeros', () => {
      const joints: JointState[] = [
        { name: 'left_hip_yaw', position: 0.1, velocity: 0.01 },
        // Missing other joints
      ];

      const observation = mapper.mapJointsToObservation(joints, mockH1Config);

      expect(observation[0]).toBe(0.1);
      expect(observation[1]).toBe(0); // Missing joint
      expect(observation[6]).toBe(0.01);
      expect(observation[7]).toBe(0); // Missing joint velocity
    });
  });

  describe('mapArrayToJointStates', () => {
    it('should convert position/velocity arrays to JointState objects', () => {
      const positions = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6];
      const velocities = [0.01, 0.02, 0.03, 0.04, 0.05, 0.06];

      const states = mapper.mapArrayToJointStates(positions, velocities, mockH1Config);

      expect(states.length).toBe(6);
      expect(states[0]).toEqual({
        name: 'left_hip_yaw',
        position: 0.1,
        velocity: 0.01,
      });
    });

    it('should handle undefined velocities', () => {
      const positions = [0.1, 0.2];

      const states = mapper.mapArrayToJointStates(positions, undefined, mockH1Config);

      expect(states[0].velocity).toBe(0);
      expect(states[1].velocity).toBe(0);
    });
  });

  describe('validateActionDim', () => {
    it('should validate matching dimensions', () => {
      const action: Action = {
        jointCommands: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6],
        gripperCommand: 0.5,
        timestamp: 1000,
      };

      const result = mapper.validateActionDim(action, mockH1Config);

      expect(result.valid).toBe(true);
      expect(result.expected).toBe(6);
      expect(result.actual).toBe(6);
    });

    it('should detect mismatched dimensions', () => {
      const action: Action = {
        jointCommands: [0.1, 0.2],
        gripperCommand: 0.5,
        timestamp: 1000,
      };

      const result = mapper.validateActionDim(action, mockH1Config);

      expect(result.valid).toBe(false);
      expect(result.message).toContain('mismatch');
    });
  });

  describe('getJointName', () => {
    it('should return joint name for valid index', () => {
      expect(mapper.getJointName(0, mockH1Config)).toBe('left_hip_yaw');
      expect(mapper.getJointName(5, mockH1Config)).toBe('right_hip_pitch');
    });

    it('should return undefined for invalid index', () => {
      expect(mapper.getJointName(-1, mockH1Config)).toBeUndefined();
      expect(mapper.getJointName(10, mockH1Config)).toBeUndefined();
    });
  });

  describe('getJointIndex', () => {
    it('should return index for valid joint name', () => {
      expect(mapper.getJointIndex('left_hip_yaw', mockH1Config)).toBe(0);
      expect(mapper.getJointIndex('right_hip_pitch', mockH1Config)).toBe(5);
    });

    it('should return -1 for invalid joint name', () => {
      expect(mapper.getJointIndex('nonexistent', mockH1Config)).toBe(-1);
    });
  });

  describe('createZeroAction', () => {
    it('should create action with all zeros', () => {
      const action = mapper.createZeroAction(mockH1Config);

      expect(action.jointCommands.length).toBe(6);
      expect(action.jointCommands.every((v) => v === 0)).toBe(true);
      expect(action.gripperCommand).toBe(0);
    });
  });

  describe('createMeanAction', () => {
    it('should create action with mean values', () => {
      const action = mapper.createMeanAction(mockSo101Config);

      expect(action.jointCommands.length).toBe(6);
      expect(action.jointCommands[0]).toBe(0);
      expect(action.jointCommands[5]).toBe(0.785); // Gripper mean
    });
  });

  describe('extractGripperCommand', () => {
    it('should extract gripper command from gripper joint', () => {
      const action: Action = {
        jointCommands: [0.1, 0.2, 0.3, 0.4, 0.5, 0.8],
        gripperCommand: 0.5,
        timestamp: 1000,
      };

      const gripperValue = mapper.extractGripperCommand(action, mockSo101Config);

      expect(gripperValue).toBe(0.8); // Last joint is gripper
    });

    it('should fall back to explicit gripper command', () => {
      const action: Action = {
        jointCommands: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6],
        gripperCommand: 0.5,
        timestamp: 1000,
      };

      // H1 config doesn't have gripper in joint names
      const gripperValue = mapper.extractGripperCommand(action, mockH1Config);

      expect(gripperValue).toBe(0.5);
    });
  });

  describe('isGripperJoint', () => {
    it('should identify gripper joints', () => {
      expect(mapper.isGripperJoint('gripper')).toBe(true);
      expect(mapper.isGripperJoint('left_gripper')).toBe(true);
      expect(mapper.isGripperJoint('finger_joint')).toBe(true);
      expect(mapper.isGripperJoint('hand_close')).toBe(true);
    });

    it('should not identify non-gripper joints', () => {
      expect(mapper.isGripperJoint('shoulder_pan')).toBe(false);
      expect(mapper.isGripperJoint('elbow_flex')).toBe(false);
    });
  });

  describe('getJointGroups', () => {
    it('should group joints by body part', () => {
      const groups = mapper.getJointGroups(mockH1Config);

      expect(groups.has('left_leg')).toBe(true);
      expect(groups.has('right_leg')).toBe(true);
      expect(groups.get('left_leg')?.length).toBe(3);
      expect(groups.get('right_leg')?.length).toBe(3);
    });

    it('should identify gripper group for SO101', () => {
      const groups = mapper.getJointGroups(mockSo101Config);

      expect(groups.has('gripper')).toBe(true);
      expect(groups.get('gripper')).toEqual([5]);
    });
  });
});
