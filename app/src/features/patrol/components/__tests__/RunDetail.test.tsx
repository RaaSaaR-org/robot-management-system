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
    // Marked normal: that verdict is spent, but escalating stays possible — a
    // mis-clicked "normal" on a person in the hallway must be correctable, and
    // the server accepts the transition from any status.
    expect(screen.getByTestId('patrol-finding-normal')).toBeDisabled();
    expect(screen.getByTestId('patrol-finding-escalate')).not.toBeDisabled();
    // The robot took the lesson: no warning.
    expect(screen.queryByTestId('patrol-finding-robot-not-notified')).not.toBeInTheDocument();
  });

  it('lets an operator escalate a finding they had marked normal, and not escalate twice', async () => {
    api.markFindingNormal.mockResolvedValue({ finding: { ...finding, status: 'dismissed_normal' }, robotNotified: true });
    api.escalateFinding.mockResolvedValue({ ...finding, status: 'escalated' });
    renderWithProviders(<RunDetail runId="run-1" />, { withAuth: false });
    await screen.findAllByTestId('patrol-finding');

    fireEvent.click(screen.getByTestId('patrol-finding-normal'));
    await waitFor(() => expect(screen.getByTestId('patrol-finding')).toHaveAttribute('data-status', 'dismissed_normal'));

    fireEvent.click(screen.getByTestId('patrol-finding-escalate'));
    await waitFor(() => expect(api.escalateFinding).toHaveBeenCalledWith('f-1'));
    await waitFor(() => expect(screen.getByTestId('patrol-finding')).toHaveAttribute('data-status', 'escalated'));
    expect(screen.getByTestId('patrol-finding-escalate')).toBeDisabled();
    expect(screen.getByTestId('patrol-finding-normal')).not.toBeDisabled();
  });

  it('This is normal tells the operator when the robot could not be taught (robotNotified: false)', async () => {
    api.markFindingNormal.mockResolvedValue({ finding: { ...finding, status: 'dismissed_normal' }, robotNotified: false });
    renderWithProviders(<RunDetail runId="run-1" />, { withAuth: false });
    await screen.findAllByTestId('patrol-finding');
    expect(screen.queryByTestId('patrol-finding-robot-not-notified')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('patrol-finding-normal'));
    await waitFor(() => expect(screen.getByTestId('patrol-finding')).toHaveAttribute('data-status', 'dismissed_normal'));
    const note = await screen.findByTestId('patrol-finding-robot-not-notified');
    expect(note).toHaveTextContent(/robot was offline/i);
    expect(note).toHaveTextContent(/baseline was not updated/i);
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

  it('when this run already IS the baseline it says so, does not compare it with itself, and cannot be promoted again', async () => {
    api.getBaseline.mockResolvedValue({ runId: 'run-1', window: 'night', photos: { 'cp-a': 'cp-a.jpg', 'cp-b': 'cp-b.jpg' } });
    renderWithProviders(<RunDetail runId="run-1" />, { withAuth: false });
    expect(await screen.findByTestId('patrol-run-is-baseline')).toHaveTextContent(/this run is the route's baseline/i);
    const btn = screen.getByTestId('patrol-run-promote');
    expect(btn).toBeDisabled();
    expect(btn).toHaveTextContent('Current baseline');
    // The baseline slot is a placeholder, not this run's own photo again.
    expect(screen.getAllByText('this run is the baseline').length).toBeGreaterThan(0);
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

  it('a blind checkpoint says it was not inspected, and a done run with blind legs shows its reason in amber', async () => {
    // The robot reached the kitchen but the capture and the checklist both
    // failed: patrol.ts leaves the leg 'done' and writes the run's reason.
    // Rendered like any other done leg, that reads as "nothing wrong here".
    api.getRun.mockResolvedValue({
      ...run,
      runId: 'run-blind',
      status: 'done',
      reason: '1 checkpoint(s) not inspected',
      legs: [
        run.legs[0],
        { index: 1, checkpointId: 'cp-b', placeId: 'kitchen', name: 'Kitchen', status: 'done', photoKey: null, photoDropped: 'error', inspection: 'error', findingIds: [], message: 'capture failed: camera sidecar is down' },
      ],
      findings: [finding],
    });
    renderWithProviders(<RunDetail runId="run-blind" />, { withAuth: false });
    await screen.findByTestId('patrol-run-detail');

    const notes = await screen.findAllByTestId('patrol-leg-blind');
    expect(notes).toHaveLength(1);
    expect(notes[0]).toHaveTextContent('Checkpoint not inspected');
    expect(notes[0]).toHaveTextContent('no control photo and no checklist answer');
    expect(notes[0]).toHaveTextContent(/nothing here was compared with the baseline/i);
    // The inspected leg carries no such note.
    expect(screen.getAllByTestId('patrol-leg')[0]).not.toHaveTextContent('Checkpoint not inspected');
    // The photo pair of the blind checkpoint says it too.
    expect(screen.getByTestId('patrol-photo-blind')).toHaveTextContent('Not inspected');

    // The run-level reason is shown for a `done` run and reads as attention,
    // not as ordinary metadata.
    const reason = screen.getByTestId('patrol-run-reason');
    expect(reason).toHaveTextContent('1 checkpoint(s) not inspected');
    expect(reason.className).toMatch(/amber/);
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
