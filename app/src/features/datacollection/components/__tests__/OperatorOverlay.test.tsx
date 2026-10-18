/**
 * @file OperatorOverlay.test.tsx
 * @description Where the ghost hands and the head frustum go (TASK-414): the
 *              relayed robot-frame targets, offset by the eye point, in the
 *              torso frame; nothing while the operator is out of VR. Also the
 *              presence bar from a fixture.
 * @feature datacollection
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EYE_IN_TORSO, operatorOverlayPoses } from '../OperatorOverlay';
import { PresenceBar } from '../PresenceBar';
import type { OperatorState } from '../../types/datacollection.types';

const base: OperatorState = {
  inVr: true,
  link: 'live',
  rttMs: 20,
  clutch: { left: true, right: false },
  grip: { left: 1, right: 0 },
  held: null,
  why: { code: 'following', severity: 'ok', text: 'Following.' },
  head: { p: [0, 0, 0], q: [0, 0, 0.3827, 0.9239] },
  targets: { left: { p: [0.3, 0.2, -0.35], q: [0, 0, 0, 1] }, right: null },
};

describe('operatorOverlayPoses', () => {
  it('puts a target at the eye point plus its offset, in the torso frame', () => {
    const poses = operatorOverlayPoses(base);
    expect(poses.left?.position[0]).toBeCloseTo(EYE_IN_TORSO[0] + 0.3);
    expect(poses.left?.position[1]).toBeCloseTo(0.2);
    expect(poses.left?.position[2]).toBeCloseTo(EYE_IN_TORSO[2] - 0.35);
    expect(poses.left?.quaternion).toEqual([0, 0, 0, 1]);
    expect(poses.right).toBeNull();
    expect(poses.head?.position).toEqual([...EYE_IN_TORSO]);
    expect(poses.head?.quaternion).toEqual([0, 0, 0.3827, 0.9239]);
  });

  it('draws nothing without an operator in VR', () => {
    expect(operatorOverlayPoses(null)).toEqual({ left: null, right: null, head: null });
    expect(operatorOverlayPoses({ ...base, inVr: false })).toEqual({ left: null, right: null, head: null });
  });
});

describe('PresenceBar', () => {
  it('shows each viewer with where they are', () => {
    render(
      <PresenceBar
        viewers={[
          { userId: 'u1', displayName: 'Anna', role: 'operator', since: '2026-10-18T10:00:00Z' },
          { userId: 'u2', displayName: 'Ben', role: 'assistant', since: '2026-10-18T10:00:05Z' },
        ]}
      />,
    );
    const chips = screen.getAllByTestId('presence-viewer');
    expect(chips.map((c) => c.getAttribute('data-role'))).toEqual(['operator', 'assistant']);
    expect(chips[0]).toHaveTextContent('Anna · headset');
    expect(chips[1]).toHaveTextContent('Ben · desktop');
  });

  it('renders nothing for nobody', () => {
    const { container } = render(<PresenceBar viewers={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
