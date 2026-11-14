/**
 * @file commandRefusal.test.ts
 * @description A refused command's toast title names the robot and its reason
 *              (TASK-504); any other error keeps the caller's own title.
 * @feature robots
 */

import { describe, expect, it } from 'vitest';
import { RobotCommandFailedError } from '../../api/robotsApi';
import { commandRefusalTitle } from '../commandRefusal';
import type { RobotCommand } from '../../types/robots.types';

function refused(errorMessage?: string): RobotCommandFailedError {
  const command: RobotCommand = {
    id: 'c1',
    robotId: 'sim-robot-001',
    type: 'move',
    payload: {},
    status: 'failed',
    priority: 'normal',
    errorMessage,
    createdAt: '2026-11-14T10:00:00.000Z',
  };
  return new RobotCommandFailedError(command);
}

describe('commandRefusalTitle (TASK-504)', () => {
  it('reads "<robot> refused: <reason>" for a refusal', () => {
    expect(commandRefusalTitle('SimBot-01', refused('No destination provided'))).toBe(
      'SimBot-01 refused: No destination provided'
    );
  });

  it('falls back to the generic reason when the robot gave none', () => {
    expect(commandRefusalTitle('SimBot-01', refused())).toBe(
      'SimBot-01 refused: The robot rejected the command.'
    );
  });

  it('is null for an error that is not a refusal', () => {
    expect(commandRefusalTitle('SimBot-01', new Error('Network Error'))).toBeNull();
    expect(commandRefusalTitle('SimBot-01', 'boom')).toBeNull();
  });
});
