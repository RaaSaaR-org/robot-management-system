/**
 * @file robotTypeLabel.test.ts
 * @description Robot types an import named after a manifest's `robot_type: "unknown"` read as a label, not a raw value (TASK-363)
 * @feature training
 */

import { describe, it, expect } from 'vitest';
import { robotTypeLabel } from '../datasetFormat';

describe('robotTypeLabel', () => {
  it.each(['unknown', 'Unknown', 'unknown (action 6, state 6)', '', '  ', 'none', 'null', 'N/A'])(
    'names %j "Unidentified robot"',
    (name) => expect(robotTypeLabel({ name })).toBe('Unidentified robot'),
  );

  it('keeps a real name, even one containing the word', () => {
    expect(robotTypeLabel({ name: 'Unitree G1 EDU (Dex3-1)' })).toBe('Unitree G1 EDU (Dex3-1)');
    expect(robotTypeLabel({ name: 'unknown_arm_v2' })).toBe('unknown_arm_v2');
  });

  it('says when there is no robot type at all', () => {
    expect(robotTypeLabel(null)).toBe('No robot type');
    expect(robotTypeLabel(undefined)).toBe('No robot type');
  });
});
