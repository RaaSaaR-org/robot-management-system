/**
 * @file RunDetail.test.tsx
 * @description RunDetail renders the header, legs, photo pairs and findings of
 *              a run; the three finding actions call the API and the buttons
 *              follow the finding's status; Promote is only offered for a
 *              finished patrol run.
 * @feature patrol
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/test/utils';
import { RunDetail } from '../RunDetail';
import { usePatrolStore } from '../../store/patrolStore';
import { patrolApi } from '../../api/patrolApi';
import type { PatrolFinding, PatrolRoute, PatrolRun } from '../../types/patrol.types';

vi.mock('../../api/patrolApi', () => ({
  patrolApi: {
    getRun: vi.fn(),
    getRoute: vi.fn(),
    getBaseline: vi.fn(),
    promoteRun: vi.fn(),
    acknowledgeFinding: vi.fn(),
    markFindingNormal: vi.fn(),
    escalateFinding: vi.fn(),
    fetchPhotoUrl: vi.fn(),
  },
  photoKeyBasename: (k: string) => k.split('/').pop(),
}));
const api = vi.mocked(patrolApi);

const route: PatrolRoute = {
  id: 'route-1', name: 'Night round', robotId: 'g1', twinId: null,
  checkpoints: [
    { id: 'cp-a', placeId: 'hall', name: 'Hall', actions: ['capture'], dwellMs: 0 },
    { id: 'cp-b', placeId: 'kitchen', name: 'Kitchen', actions: ['capture', 'scan'], dwellMs: 0 },
  ],
  cronExpression: '0 22 * * *', enabled: true,
  timeWindows: [{ id: 'night', name: 'Night', startHour: 19, endHour: 7 }],
  homePlaceId: 'dock', createdAt: 'x', updatedAt: 'x',
};

const run: PatrolRun = {
  runId: 'run-1', routeId: 'route-1', routeName: 'Night round', robotId: 'g1', mode: 'patrol', origin: 'scheduled',
  window: 'night', status: 'done', startedAt: '2026-08-16T01:00:00.000Z', finishedAt: '2026-08-16T01:12:00.000Z',
  legs: [
    { index: 0, checkpointId: 'cp-a', placeId: 'hall', name: 'Hall', status: 'done', photoKey: 'run-1/cp-a.jpg', inspection: 'changed', findingIds: ['f-1'], message: 'arrived after 3 stages' },
    { index: 1, checkpointId: 'cp-b', placeId: 'kitchen', name: 'Kitchen', status: 'failed', photoDropped: 'person', inspection: 'skipped', findingIds: [], message: 'goto failed: blocked' },
  ],
  findingCount: 1,
};

const finding: PatrolFinding = {
  id: 'f-1', runId: 'run-1', routeId: 'route-1', robotId: 'g1', checkpointId: 'cp-a', legIndex: 0,
  type: 'door_open', severity: 'high', source: 'checkpoint', place: 'hall', pose: { x: 1, y: 1, yawDeg: 0 },
  at: '2026-08-16T01:03:00.000Z', summary: 'door open in Hall',
  evidence: { checklistDiff: [{ item: 'doorState', baseline: 'closed', current: 'open' }], baselinePhotoKey: 'b/cp-a.jpg', currentPhotoKey: 'run-1/cp-a.jpg' },
  model: 'gemma3:4b', confidence: 0.9, status: 'open',
};

beforeEach(() => {
  usePatrolStore.getState().reset();
  vi.clearAllMocks();
  api.getRun.mockResolvedValue({ ...run, findings: [finding] });
  api.getRoute.mockResolvedValue(route);
  api.getBaseline.mockResolvedValue({ runId: 'run-base', window: 'night', photos: { 'cp-a': 'cp-a.jpg', 'cp-b': 'cp-b.jpg' } });
  api.fetchPhotoUrl.mockResolvedValue('blob:photo');
  Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:x'), revokeObjectURL: vi.fn() });
});

describe('RunDetail', () => {
  it('renders header, legs, photo pairs and findings from the server', async () => {
    renderWithProviders(<RunDetail runId="run-1" robotNames={{ g1: 'Alpha' }} />, { withAuth: false });
    const detail = await screen.findByTestId('patrol-run-detail');
    expect(detail).toHaveTextContent('Night round');
    expect(detail).toHaveTextContent('Patrol · scheduled · window night');
    expect(detail).toHaveTextContent('Alpha');

    const legs = screen.getAllByTestId('patrol-leg');
    expect(legs).toHaveLength(2);
    expect(legs[0]).toHaveTextContent('Hall');
    expect(legs[0]).toHaveTextContent('changed');
    expect(legs[1]).toHaveTextContent('goto failed: blocked');
    expect(legs[1]).toHaveTextContent('photo not stored (person)');

    // One pair per capture leg; baseline from the route's baseline run, current from this run.
    const pairs = await screen.findAllByTestId('patrol-photo-pair');
    expect(pairs).toHaveLength(2);
    await waitFor(() => expect(api.fetchPhotoUrl).toHaveBeenCalledWith('g1', 'run-base', 'cp-a.jpg'));
    expect(api.fetchPhotoUrl).toHaveBeenCalledWith('g1', 'run-1', 'run-1/cp-a.jpg');
    // The person-dropped leg says why the current photo is missing.
    await waitFor(() => expect(pairs[1]).toHaveTextContent('not stored — a person was in frame'));

    const findings = screen.getAllByTestId('patrol-finding');
    expect(findings).toHaveLength(1);
    expect(findings[0]).toHaveAttribute('id', 'finding-f-1');
    expect(findings[0]).toHaveTextContent('door open in Hall');
    expect(findings[0]).toHaveTextContent('doorState: closed → open');
    expect(findings[0]).toHaveTextContent('High');
  });

  it('Acknowledge / This is normal / Escalate call the API and update the finding', async () => {
    api.acknowledgeFinding.mockResolvedValue({ ...finding, status: 'acknowledged' });
    api.markFindingNormal.mockResolvedValue({ finding: { ...finding, status: 'dismissed_normal' }, robotNotified: true });
    api.escalateFinding.mockResolvedValue({ ...finding, status: 'escalated' });
    renderWithProviders(<RunDetail runId="run-1" />, { withAuth: false });
    await screen.findAllByTestId('patrol-finding');

    fireEvent.click(screen.getByTestId('patrol-finding-ack'));
    await waitFor(() => expect(api.acknowledgeFinding).toHaveBeenCalledWith('f-1'));
    await waitFor(() => expect(screen.getByTestId('patrol-finding')).toHaveAttribute('data-status', 'acknowledged'));
    // Acknowledged: Acknowledge is spent, the other two remain.
    expect(screen.getByTestId('patrol-finding-ack')).toBeDisabled();
    expect(screen.getByTestId('patrol-finding-normal')).not.toBeDisabled();

    fireEvent.click(screen.getByTestId('patrol-finding-normal'));
    await waitFor(() => expect(api.markFindingNormal).toHaveBeenCalledWith('f-1'));
    await waitFor(() => expect(screen.getByTestId('patrol-finding')).toHaveAttribute('data-status', 'dismissed_normal'));
    expect(screen.getByTestId('patrol-finding-escalate')).toBeDisabled();
  });

  it('Escalate marks the finding escalated', async () => {
    api.escalateFinding.mockResolvedValue({ ...finding, status: 'escalated' });
    renderWithProviders(<RunDetail runId="run-1" />, { withAuth: false });
    await screen.findAllByTestId('patrol-finding');
    fireEvent.click(screen.getByTestId('patrol-finding-escalate'));
    await waitFor(() => expect(api.escalateFinding).toHaveBeenCalledWith('f-1'));
    await waitFor(() => expect(screen.getByTestId('patrol-finding')).toHaveAttribute('data-status', 'escalated'));
  });

  it('Promote to baseline is offered for a finished patrol run and calls the API', async () => {
    api.promoteRun.mockResolvedValue({ ok: true });
    renderWithProviders(<RunDetail runId="run-1" />, { withAuth: false });
    const btn = await screen.findByTestId('patrol-run-promote');
    expect(btn).not.toBeDisabled();
    fireEvent.click(btn);
    await waitFor(() => expect(api.promoteRun).toHaveBeenCalledWith('run-1'));
    await waitFor(() => expect(screen.getByTestId('patrol-run-detail')).toHaveTextContent('Run promoted'));
  });

  it('a skipped run shows its reason and no legs to walk', async () => {
    api.getRun.mockResolvedValue({
      ...run, runId: 'run-skip', status: 'skipped', reason: 'battery 12% below the 30% minimum', legs: [], findingCount: 0, findings: [],
    });
    renderWithProviders(<RunDetail runId="run-skip" />, { withAuth: false });
    const reason = await screen.findByTestId('patrol-run-reason');
    expect(reason).toHaveTextContent('battery 12% below the 30% minimum');
    expect(screen.queryAllByTestId('patrol-leg')).toHaveLength(0);
    expect(screen.getByTestId('patrol-run-promote')).toBeDisabled();
  });

  it('a baseline run raises no findings and shows no baseline column fetch', async () => {
    api.getRun.mockResolvedValue({ ...run, runId: 'run-base', mode: 'baseline', findingCount: 0, findings: [] });
    renderWithProviders(<RunDetail runId="run-base" />, { withAuth: false });
    await screen.findByTestId('patrol-run-detail');
    expect(screen.getByTestId('patrol-findings')).toHaveTextContent('records what is normal');
    expect(api.getBaseline).not.toHaveBeenCalled();
    expect(screen.getByTestId('patrol-run-promote')).toBeDisabled();
  });
});
