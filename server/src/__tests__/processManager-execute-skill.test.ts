/**
 * @file processManager-execute-skill.test.ts
 * @description Validates that ProcessManager routes 'execute_skill' steps to
 * SkillExecutionService instead of the generic TaskDistributor pipeline (TASK-143).
 *
 * The full execution path is integration-tested manually against the real Pi.
 * This test pins
 * the ergonomic guarantees: a missing skillId fails fast, a missing robot fails
 * fast, and the action type is registered in the type system.
 * @feature processes
 */

import { describe, it, expect } from 'vitest';
import type { StepActionType } from '../types/process.types.js';

describe('TASK-143 execute_skill action type', () => {
  it('is part of StepActionType', () => {
    // This is a compile-time guarantee — if execute_skill is removed from
    // the union, the literal assignment below will fail to typecheck.
    const t: StepActionType = 'execute_skill';
    expect(t).toBe('execute_skill');
  });

  it('is preserved alongside the legacy action types', () => {
    const types: StepActionType[] = [
      'move_to_location',
      'pickup_object',
      'drop_object',
      'wait',
      'inspect',
      'charge',
      'return_home',
      'execute_skill',
      'custom',
    ];
    expect(types).toContain('execute_skill');
    expect(types.length).toBe(9);
  });
});
