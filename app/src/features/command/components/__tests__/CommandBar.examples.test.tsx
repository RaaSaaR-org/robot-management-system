/**
 * @file CommandBar.examples.test.tsx
 * @description TASK-505: the example chips under the command input are only
 *              phrases that succeed on a robot without a site or places. "Go to
 *              DOCK-1" resolved nowhere on such a robot and failed with a red
 *              toast at the demo.
 * @feature command
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CommandBar } from '../CommandBar';

vi.mock('../../hooks', () => ({
  useCommand: () => ({
    currentText: '',
    setCurrentText: vi.fn(),
    interpretation: null,
    interpretCommand: vi.fn(),
    executeCommand: vi.fn(),
    clearInterpretation: vi.fn(),
    isInterpreting: false,
    isExecuting: false,
    canExecute: false,
    error: null,
    clearError: vi.fn(),
  }),
  useSimulation: () => ({
    canvasRobotPosition: null,
    canvasDestination: null,
    canvasObstacles: [],
    shouldShowSimulation: false,
  }),
}));

describe('the command bar examples', () => {
  it('offers only phrases that need no named place', () => {
    render(<CommandBar robotId="robot-1" robotName="SimBot-01" />);

    expect(screen.getByRole('button', { name: 'Go to the charging station' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Return home' })).toBeInTheDocument();
    expect(screen.queryByText('Go to DOCK-1')).not.toBeInTheDocument();
  });
});
