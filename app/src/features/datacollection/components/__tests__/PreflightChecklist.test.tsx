/**
 * @file PreflightChecklist.test.tsx
 * @description Renders each check with its state tag and the next action.
 * @feature datacollection
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PreflightChecklist } from '../PreflightChecklist';
import { buildPreflight, summarizePreflight } from '../../utils/preflight';

describe('PreflightChecklist', () => {
  it('shows blocking and warning rows and the next action', () => {
    const items = buildPreflight({
      robot: { name: 'G1 EDU', online: false },
      agentConnected: false,
      cameras: { loading: false, names: [] },
      sessionType: 'gamepad',
      secureContext: true,
      vrSupported: null,
      gamepadConnected: false,
    });
    render(<PreflightChecklist items={items} summary={summarizePreflight(items)} />);
    expect(screen.getByTestId('preflight-robot')).toHaveAttribute('data-level', 'blocking');
    expect(screen.getByTestId('preflight-robot')).toHaveTextContent('Blocking');
    expect(screen.getByTestId('preflight-input')).toHaveTextContent('Check');
    expect(screen.getByText('Recording cannot start until the blocking item is fixed.')).toBeInTheDocument();
    expect(screen.getByTestId('preflight-next')).toHaveTextContent(/Next: Start the robot agent/);
  });
});
