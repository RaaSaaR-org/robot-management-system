/**
 * @file EmergencyStopButtons.roles.test.tsx
 * @description Per-role state of the fleet, robot and zone E-stops (TASK-370).
 *              The server admits every E-stop write to member and above, so a
 *              viewer gets the stop disabled with the reason instead of a 403 —
 *              and every role that can stop must always find it enabled.
 * @feature safety
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { signInAs } from '@/test/utils';
import type { UserRole } from '@/features/auth/types/auth.types';

// The hooks are not the seam under test — only the role is.
const { safety } = vi.hoisted(() => ({
  safety: {
    hasTriggeredEStop: false,
    isTriggered: false,
    triggeredCount: 0,
    isTriggering: false,
    isResetting: false,
    triggerEStop: vi.fn().mockResolvedValue(true),
    resetEStop: vi.fn().mockResolvedValue(true),
  },
}));
vi.mock('../../hooks/useSafety', () => ({
  useFleetSafety: () => safety,
  useRobotSafety: () => safety,
  useZoneSafety: () => safety,
}));

import { FleetEmergencyStopButton } from '../FleetEmergencyStopButton';
import { RobotEmergencyStopButton } from '../RobotEmergencyStopButton';
import { ZoneEmergencyStopButton } from '../ZoneEmergencyStopButton';
import { STOP_FORBIDDEN_HINT } from '../stopStyles';

const STOPS = [
  { name: 'fleet', label: 'Emergency stop all robots', el: () => <FleetEmergencyStopButton /> },
  { name: 'robot', label: 'Emergency stop Atlas', el: () => <RobotEmergencyStopButton robotId="r1" robotName="Atlas" /> },
  { name: 'zone', label: 'Emergency stop zone Dock', el: () => <ZoneEmergencyStopButton zoneId="z1" zoneName="Dock" /> },
];

beforeEach(() => {
  vi.clearAllMocks();
  safety.hasTriggeredEStop = false;
  safety.isTriggered = false;
});

describe.each(STOPS)('$name E-stop', ({ label, el }) => {
  it('is disabled for a viewer, with the reason, and fires nothing', () => {
    signInAs('viewer');
    render(el());
    const stop = screen.getByRole('button', { name: label });
    expect(stop).toBeDisabled();
    expect(stop.closest(`[title="${STOP_FORBIDDEN_HINT}"]`)).not.toBeNull();
    fireEvent.click(stop);
    expect(safety.triggerEStop).not.toHaveBeenCalled();
  });

  it.each<UserRole>(['member', 'owner', 'super-admin'])('fires on one press for a %s', (role) => {
    signInAs(role);
    render(el());
    const stop = screen.getByRole('button', { name: label });
    expect(stop).toBeEnabled();
    fireEvent.click(stop);
    expect(safety.triggerEStop).toHaveBeenCalledTimes(1);
  });
});

describe('resume while stopped', () => {
  it.each([
    ['fleet', 'Resume fleet', () => <FleetEmergencyStopButton />],
    ['robot', 'Resume robot', () => <RobotEmergencyStopButton robotId="r1" robotName="Atlas" />],
  ] as const)('the %s resume is disabled for a viewer and enabled for a member', (_n, resume, el) => {
    safety.hasTriggeredEStop = true;
    safety.isTriggered = true;

    signInAs('viewer');
    const { unmount } = render(el());
    expect(screen.getByRole('button', { name: resume })).toBeDisabled();
    unmount();

    signInAs('member');
    render(el());
    expect(screen.getByRole('button', { name: resume })).toBeEnabled();
  });
});
