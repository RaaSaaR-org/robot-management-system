/**
 * @file OperatorCard.test.tsx
 * @description The assistant's Operator card from a fixture (TASK-414): status
 *              line, grip bars, the why line's severity and what was held; and
 *              the waiting state with the headset URL.
 * @feature datacollection
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { OperatorCard, operatorStatusLine } from '../OperatorCard';
import type { OperatorState } from '../../types/datacollection.types';

const fixture: OperatorState = {
  inVr: true,
  link: 'live',
  rttMs: 38.4,
  clutch: { left: false, right: true },
  grip: { left: 0.2, right: 0.95 },
  held: { side: 'right', reason: 'arm_gate' },
  why: { code: 'arm_refused', severity: 'block', text: "Arm refused by the robot's arm gate. Check the desktop window." },
  head: null,
  targets: { left: null, right: null },
};

describe('OperatorCard', () => {
  it('shows the operator in VR with link, grips, the why line and the held reason', () => {
    render(
      <OperatorCard
        robotId="sim-robot-g1-edu"
        sessionId="s1"
        operator={fixture}
        operatorViewer={{ userId: 'u1', displayName: 'Anna', role: 'operator', since: '' }}
      />,
    );
    expect(screen.getByTestId('operator-card')).toHaveAttribute('data-state', 'in-vr');
    expect(screen.getByTestId('operator-status')).toHaveTextContent('In VR · link live 38 ms');
    expect(screen.getByText('Anna · headset')).toBeInTheDocument();
    expect(screen.getByTestId('operator-grip-left')).toHaveAttribute('data-value', '20');
    expect(screen.getByTestId('operator-grip-right')).toHaveAttribute('data-value', '95');
    const why = screen.getByTestId('operator-why');
    expect(why).toHaveAttribute('data-severity', 'block');
    expect(why).toHaveClass('text-signal-stopped');
    expect(screen.getByTestId('operator-held')).toHaveTextContent('held: arm_gate (right)');
  });

  it('waits for the headset and names the live URL to open on the Quest', () => {
    render(
      <MemoryRouter>
        <OperatorCard robotId="sim-robot-g1-edu" sessionId="s1" operator={null} operatorViewer={null} />
      </MemoryRouter>,
    );
    expect(screen.getByTestId('operator-card')).toHaveAttribute('data-state', 'waiting');
    expect(screen.getByTestId('operator-status')).toHaveTextContent(
      'Waiting for the headset — open /data-collection/live?robot=sim-robot-g1-edu on the Quest.',
    );
  });

  it('says when the headset is open but not in VR', () => {
    expect(operatorStatusLine({ ...fixture, inVr: false })).toBe('Headset open, not in VR');
    expect(operatorStatusLine({ ...fixture, link: 'stale', rttMs: null })).toBe('In VR · link stale');
  });
});
