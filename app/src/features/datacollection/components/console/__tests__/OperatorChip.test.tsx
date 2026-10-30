/**
 * @file OperatorChip.test.tsx
 * @description The operator chip on the Record live view (TASK-428), from a
 *              fixture: the avatar, the link latency in its colour (mint live,
 *              amber stale, red lost) with the status line for screen readers,
 *              and the grip bars, filled mint while that grip clutches; "not in
 *              VR" while the headset only has the session open; nothing at all
 *              without an operator. The chip data helpers (the old Operator
 *              card's) keep their lines.
 * @feature datacollection
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { OperatorChip } from '../OperatorChip';
import { heldLine, operatorLatency, operatorStatusLine } from '../../OperatorCard';
import type { OperatorState, PresenceViewer } from '../../../types/datacollection.types';

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
const anna: PresenceViewer = { userId: 'u1', displayName: 'Anna Keller', role: 'operator', since: '' } as PresenceViewer;

describe('OperatorChip', () => {
  it('shows the avatar, the latency and the grips while the operator is in VR', () => {
    render(<OperatorChip operator={fixture} operatorViewer={anna} />);
    const chip = screen.getByTestId('operator-card');
    expect(chip).toHaveAttribute('data-state', 'in-vr');
    expect(chip).toHaveTextContent('AK');
    const status = screen.getByTestId('operator-status');
    expect(status).toHaveTextContent('In VR · link live · 38 ms');
    expect(status.className).toContain('text-signal-measured');
    expect(screen.getByTestId('operator-grip-left')).toHaveAttribute('data-value', '20');
    expect(screen.getByTestId('operator-grip-right')).toHaveAttribute('data-value', '95');
    expect(screen.getByTestId('operator-grip-right')).toHaveAttribute('data-clutched', 'true');
    expect(screen.getByTestId('operator-grip-left')).toHaveAttribute('data-clutched', 'false');
    // The why line and the held reason live in the Arms cell and the dock, not here.
    expect(screen.queryByTestId('operator-why')).toBeNull();
    expect(screen.queryByTestId('operator-held')).toBeNull();
  });

  it('colours a stale link amber and a lost one red', () => {
    const { rerender } = render(<OperatorChip operator={{ ...fixture, link: 'stale' }} operatorViewer={anna} />);
    expect(screen.getByTestId('operator-status').className).toContain('text-signal-unknown');
    rerender(<OperatorChip operator={{ ...fixture, link: 'lost' }} operatorViewer={anna} />);
    expect(screen.getByTestId('operator-status').className).toContain('text-signal-stopped');
    expect(screen.getByTestId('operator-status')).toHaveTextContent('Link lost');
  });

  it('says not in VR while the headset only has the session open', () => {
    render(<OperatorChip operator={null} operatorViewer={anna} />);
    expect(screen.getByTestId('operator-card')).toHaveAttribute('data-state', 'connected');
    expect(screen.getByTestId('operator-status')).toHaveTextContent('Headset open, not in VR');
    expect(screen.queryByTestId('operator-grip-left')).toBeNull();
  });

  it('renders nothing without an operator', () => {
    const { container } = render(<OperatorChip operator={null} operatorViewer={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('operator chip data', () => {
  it('keeps the status line, the latency and the held line', () => {
    expect(operatorStatusLine(fixture)).toBe('In VR · link live 38 ms');
    expect(operatorStatusLine({ ...fixture, inVr: false })).toBe('Headset open, not in VR');
    expect(operatorStatusLine({ ...fixture, link: 'stale', rttMs: null })).toBe('In VR · link stale');
    expect(operatorLatency(fixture)).toBe('38 ms');
    expect(operatorLatency({ ...fixture, rttMs: null })).toBe('Link live');
    expect(heldLine(fixture.held!)).toBe('held: arm_gate (right)');
    expect(heldLine({ side: 'both', reason: 'ik' })).toBe('held: ik');
  });
});
