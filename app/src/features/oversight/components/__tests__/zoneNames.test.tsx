/**
 * @file zoneNames.test.tsx
 * @description Deployment and verification views store TwinZone ids (TASK-330)
 *              and must show the zone's name, falling back to the id when the
 *              zone is unknown.
 * @feature oversight
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderWithProviders, screen } from '@/test/utils';

vi.mock('@/features/digitaltwin/api/twinApi', () => ({
  twinApi: { listTwins: vi.fn() },
}));
vi.mock('@/features/digitaltwin/api/twinZoneApi', () => ({
  twinZoneApi: { getZones: vi.fn() },
}));

import { twinApi } from '@/features/digitaltwin/api/twinApi';
import { twinZoneApi } from '@/features/digitaltwin/api/twinZoneApi';
import { VerificationsPanel } from '../VerificationsPanel';
import { DeploymentOverview } from '@/features/deployment/components/DeploymentOverview';
import type { DueVerification } from '../../types';
import type { Deployment } from '@/features/deployment/types';
import type { DigitalTwinDTO, TwinZoneDTO } from '@/features/digitaltwin/types/twin.types';

beforeEach(() => {
  vi.mocked(twinApi.listTwins).mockResolvedValue([{ id: 't1' } as DigitalTwinDTO]);
  vi.mocked(twinZoneApi.getZones).mockResolvedValue([
    { id: 'tz-kitchen', twinId: 't1', name: 'Kitchen' } as TwinZoneDTO,
  ]);
});

function dueForZone(scopeId: string): DueVerification {
  return {
    schedule: {
      id: `s-${scopeId}`,
      name: `Check ${scopeId}`,
      description: null,
      intervalMinutes: 60,
      robotScope: 'zone',
      scopeId,
      isActive: true,
      createdAt: '2026-09-30T10:00:00.000Z',
      updatedAt: '2026-09-30T10:00:00.000Z',
    },
    lastCompletion: null,
    dueAt: '2026-09-30T10:00:00.000Z',
    overdueSinceMinutes: 5,
  } as DueVerification;
}

describe('TwinZone names (TASK-330)', () => {
  it('verification panel shows the zone name, and the id when unknown', async () => {
    renderWithProviders(
      <VerificationsPanel
        due={[dueForZone('tz-kitchen'), dueForZone('tz-gone')]}
        isLoading={false}
        robotName={(id) => id ?? ''}
        onComplete={vi.fn()}
      />,
    );
    expect(await screen.findByText(/Zone Kitchen/)).toBeInTheDocument();
    expect(screen.getByText(/Zone tz-gone/)).toBeInTheDocument();
  });

  it('deployment overview shows target zone names, and the id when unknown', async () => {
    const deployment = {
      id: 'd1',
      modelVersionId: 'mv-1',
      strategy: 'canary',
      targetRobotTypes: [],
      targetZones: ['tz-kitchen', 'tz-gone'],
      trafficPercentage: 0,
      canaryConfig: { stages: [], successThreshold: 0.95 },
      rollbackThresholds: { errorRate: 0.05, latencyP99: 500, failureRate: 0.1 },
      status: 'pending',
      deployedRobotIds: [],
      failedRobotIds: [],
      createdAt: '2026-09-30T10:00:00.000Z',
      updatedAt: '2026-09-30T10:00:00.000Z',
    } as unknown as Deployment;
    renderWithProviders(<DeploymentOverview deployment={deployment} />);
    expect(await screen.findByText('Kitchen')).toBeInTheDocument();
    expect(screen.getByText('tz-gone')).toBeInTheDocument();
  });
});
