/**
 * @file agent-card.test.ts
 * @description The A2A card stops advertising things the robot cannot do
 *              (TASK-198): skills are derived from the embodiment config and
 *              the live block vocabulary instead of being hardcoded.
 * @feature agentmode
 * @status test
 */

import { describe, it, expect } from 'vitest';
import { agentModeSkill, createRobotAgentCard, deriveAgentSkills } from '../agent-card.js';
import { AgentBlockKinds } from '../../agent-mode/types.js';
import type { EmbodimentConfig } from '../../embodiment/types.js';

function embodiment(over: Partial<EmbodimentConfig> = {}): EmbodimentConfig {
  return {
    embodiment_tag: 'unitree_g1_edu_dex3',
    manufacturer: 'Unitree',
    model: 'G1 EDU (Dex3-1)',
    action: { dim: 43, normalization: { mean: [], std: [1] } },
    proprioception: {
      dim: 86,
      joint_names: ['left_knee_joint', 'left_elbow_joint', 'left_hand_thumb_0_joint'],
    },
    cameras: [{ name: 'head_camera', resolution: [224, 224], enabled: true }],
    depth_sensors: [{ name: 'mid360_lidar', type: 'lidar', has_intensity: true, enabled: true }],
    version: '1.0.0',
    ...over,
  } as EmbodimentConfig;
}

const ids = (config?: EmbodimentConfig): string[] => deriveAgentSkills(config).map((s) => s.id);

describe('deriveAgentSkills', () => {
  it('advertises manipulation only when the body has hand joints', () => {
    expect(ids(embodiment())).toContain('manipulation');
    expect(
      ids(
        embodiment({
          proprioception: { dim: 24, joint_names: ['left_knee_joint', 'left_ankle_roll_joint'] },
        }),
      ),
    ).not.toContain('manipulation');
  });

  it('advertises perception only when a sensor is actually enabled', () => {
    expect(ids(embodiment())).toContain('perception');
    expect(
      ids(
        embodiment({
          cameras: [{ name: 'head_camera', resolution: [224, 224], enabled: false }],
          depth_sensors: [],
        }),
      ),
    ).not.toContain('perception');
  });

  it('keeps the previous set when no embodiment config is loaded', () => {
    // A config that failed to load is not evidence that the robot lost a
    // capability, so the card is not quietly narrowed on it.
    expect(ids(undefined)).toEqual(['navigation', 'manipulation', 'status_control']);
  });
});

describe('agentModeSkill', () => {
  it('is derived from the live block vocabulary', () => {
    const skill = agentModeSkill();
    for (const kind of AgentBlockKinds) {
      expect(skill.description).toContain(kind);
    }
  });
});

describe('createRobotAgentCard', () => {
  it('carries the derived skills plus Agent Mode', () => {
    const card = createRobotAgentCard({
      robotId: 'sim-robot-g1-edu',
      robotName: 'Nova',
      port: 41246,
      robotClass: 'standard',
      maxPayloadKg: 5,
      robotDescription: 'Unitree G1 EDU humanoid',
      hardwareConnected: true,
      embodiment: embodiment(),
    });

    expect(card.name).toBe('Nova');
    expect(card.skills.map((s) => s.id)).toEqual([
      'navigation',
      'manipulation',
      'perception',
      'status_control',
      'agent_mode',
    ]);
  });
});
