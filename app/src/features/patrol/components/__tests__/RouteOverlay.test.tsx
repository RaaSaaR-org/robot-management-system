/**
 * @file RouteOverlay.test.tsx
 * @description The map overlay: numbered checkpoint markers for legs WITH a
 *              pose, red pins for findings with a pose, nothing at all when the
 *              robot has no run, and markers placed through the panel's own
 *              projection.
 * @feature patrol
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { RouteOverlay, overlayMarkers } from '../RouteOverlay';
import { usePatrolStore } from '../../store/patrolStore';
import { patrolApi } from '../../api/patrolApi';
import type { PatrolFinding, PatrolRun } from '../../types/patrol.types';

vi.mock('../../api/patrolApi', () => ({
  patrolApi: { listRuns: vi.fn(), getRun: vi.fn() },
  photoKeyBasename: (k: string) => k,
}));
const api = vi.mocked(patrolApi);

const run: PatrolRun = {
  runId: 'run-1', routeId: 'route-1', routeName: 'Round', robotId: 'g1', mode: 'patrol', origin: 'operator', window: null,
  status: 'running', startedAt: '2026-08-16T01:00:00.000Z',
  legs: [
    { index: 0, checkpointId: 'a', placeId: 'hall', name: 'Hall', status: 'done', findingIds: [], pose: { x: 1, y: 0, yawDeg: 0 } },
    { index: 1, checkpointId: 'b', placeId: 'kitchen', name: 'Kitchen', status: 'running', findingIds: [], pose: { x: 2, y: 1, yawDeg: 0 } },
    { index: 2, checkpointId: 'c', placeId: 'dock', name: 'Dock', status: 'pending', findingIds: [] },
  ],
  findingCount: 1,
};
const finding: PatrolFinding = {
  id: 'f-1', runId: 'run-1', routeId: 'route-1', robotId: 'g1', legIndex: 0, type: 'unexpected_object', severity: 'medium',
  source: 'enroute_geometric', place: 'hall', pose: { x: 1.5, y: 0.5, yawDeg: 0 }, at: 'x', summary: 'crate in Hall',
  evidence: {}, model: null, confidence: 0.7, status: 'open',
};

// 100 px per metre from the bottom-left corner of a 400×300 view.
const project = (x: number, y: number): [number, number] => [x * 100, 300 - y * 100];

beforeEach(() => {
  usePatrolStore.getState().reset();
  vi.clearAllMocks();
  api.listRuns.mockResolvedValue([]);
});

describe('overlayMarkers (pure)', () => {
  it('yields one marker per leg with a pose and one pin per finding with a pose', () => {
    const { checkpoints, pins } = overlayMarkers(run, [finding, { ...finding, id: 'f-2', pose: null }]);
    expect(checkpoints.map((c) => c.index)).toEqual([0, 1]);
    expect(pins.map((p) => p.id)).toEqual(['f-1']);
  });
  it('yields nothing without a run', () => {
    expect(overlayMarkers(null, [finding])).toEqual({ checkpoints: [], pins: [] });
  });
  it('ignores findings of another run', () => {
    expect(overlayMarkers(run, [{ ...finding, runId: 'other' }]).pins).toHaveLength(0);
  });
});

describe('RouteOverlay', () => {
  it('renders nothing when the robot has no run (no permanent pill on the map)', async () => {
    render(<RouteOverlay robotId="g1" project={project} widthPx={400} heightPx={300} />);
    await waitFor(() => expect(api.listRuns).toHaveBeenCalledWith({ robotId: 'g1', limit: 1 }));
    expect(screen.queryByTestId('patrol-route-overlay')).toBeNull();
  });

  it('draws numbered markers and finding pins from the store, through the projection', () => {
    usePatrolStore.getState().applyEvent({ type: 'agent:patrol:started', robotId: 'g1', patrol: run, timestamp: 'x' });
    usePatrolStore.getState().applyEvent({ type: 'agent:finding:detected', robotId: 'g1', patrol: run, finding, timestamp: 'x' });
    render(<RouteOverlay robotId="g1" project={project} widthPx={400} heightPx={300} />);
    const overlay = screen.getByTestId('patrol-route-overlay');
    expect(overlay).toHaveAttribute('data-run-id', 'run-1');
    const markers = screen.getAllByTestId('patrol-overlay-checkpoint');
    expect(markers).toHaveLength(2);
    expect(markers[0]).toHaveTextContent('1');
    expect(markers[1]).toHaveTextContent('2');
    const circle = markers[0].querySelector('circle');
    expect(circle?.getAttribute('cx')).toBe('100');
    expect(circle?.getAttribute('cy')).toBe('300');
    const pins = screen.getAllByTestId('patrol-overlay-finding');
    expect(pins).toHaveLength(1);
    expect(pins[0]).toHaveAttribute('transform', 'translate(150 250)');
    expect(screen.getByTestId('patrol-overlay-legend')).toHaveTextContent('Patrol Round: running · 1/3 · 1 finding');
  });

  it('follows the robot: another robot’s run is not drawn', () => {
    usePatrolStore.getState().applyEvent({ type: 'agent:patrol:started', robotId: 'g1', patrol: run, timestamp: 'x' });
    render(<RouteOverlay robotId="h1" project={project} widthPx={400} heightPx={300} />);
    expect(screen.queryByTestId('patrol-route-overlay')).toBeNull();
  });
});
