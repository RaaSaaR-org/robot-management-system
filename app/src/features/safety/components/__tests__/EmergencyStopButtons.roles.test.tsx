/**
 * @file EmergencyStopButtons.roles.test.tsx
 * @description Per-role state of the fleet, robot and zone E-stops (TASK-370).
 *              The fleet stop is a halt the server grants every role
 *              (`SAFETY_HALT_WRITES`, TASK-282/284), so it is enabled for a
 *              viewer too. The robot and zone stops under `/api/safety` and
 *              every resume are member-only, so a viewer gets those disabled
 *              with the reason instead of a 403.
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
import { RESUME_FORBIDDEN_HINT, STOP_FORBIDDEN_HINT } from '../stopStyles';

const FLEET_STOP = { label: 'Emergency stop all robots', el: () => <FleetEmergencyStopButton /> };

// Member-only on the server: a viewer gets them disabled.
const GATED_STOPS = [
  { name: 'robot', label: 'Emergency stop Atlas', el: () => <RobotEmergencyStopButton robotId="r1" robotName="Atlas" /> },
  { name: 'zone', label: 'Emergency stop zone Dock', el: () => <ZoneEmergencyStopButton zoneId="z1" zoneName="Dock" /> },
];

beforeEach(() => {
  vi.clearAllMocks();
  safety.hasTriggeredEStop = false;
  safety.isTriggered = false;
});

describe('fleet E-stop', () => {
  it.each<UserRole>(['viewer', 'member', 'owner', 'super-admin'])(
    'fires on one press for a %s — a viewer who sees a hazard can stop the fleet',
    (role) => {
      signInAs(role);
      render(FLEET_STOP.el());
      const stop = screen.getByRole('button', { name: FLEET_STOP.label });
      expect(stop).toBeEnabled();
      expect(stop.closest(`[title="${STOP_FORBIDDEN_HINT}"]`)).toBeNull();
      fireEvent.click(stop);
      expect(safety.triggerEStop).toHaveBeenCalledTimes(1);
    },
  );

  it('stays enabled for a viewer while the fleet is stopped', () => {
    safety.hasTriggeredEStop = true;
    signInAs('viewer');
    render(FLEET_STOP.el());
    expect(screen.getByRole('button', { name: FLEET_STOP.label })).toBeEnabled();
  });
});

describe.each(GATED_STOPS)('$name E-stop', ({ label, el }) => {
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
    const disabled = screen.getByRole('button', { name: resume });
    expect(disabled).toBeDisabled();
    expect(disabled).toHaveAttribute('title', RESUME_FORBIDDEN_HINT);
    unmount();

    signInAs('member');
    render(el());
    expect(screen.getByRole('button', { name: resume })).toBeEnabled();
  });
});
