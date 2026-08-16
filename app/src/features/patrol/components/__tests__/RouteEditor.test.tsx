/**
 * @file RouteEditor.test.tsx
 * @description The route editor: checkpoints are added in order and can be
 *              moved/removed; the cron field is validated on the server
 *              (debounced) and shows the next runs or the error; an invalid
 *              cron or an empty route blocks Save; save posts the draft.
 * @feature patrol
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { RouteEditor, moveCheckpoint, draftToInput, validateDraft } from '../RouteEditor';
import { usePatrolStore } from '../../store/patrolStore';
import { patrolApi } from '../../api/patrolApi';
import type { PatrolCheckpoint, PatrolRoute } from '../../types/patrol.types';

vi.mock('../../api/patrolApi', () => ({
  patrolApi: {
    listPlaces: vi.fn(),
    validateCron: vi.fn(),
    createRoute: vi.fn(),
    updateRoute: vi.fn(),
    exportVda5050: vi.fn(),
  },
  photoKeyBasename: (k: string) => k,
}));
const api = vi.mocked(patrolApi);

const ROBOTS = [{ id: 'g1', name: 'G1' }];

const cp = (id: string, placeId: string): PatrolCheckpoint => ({ id, placeId, name: placeId, actions: ['capture'], dwellMs: 0, expectations: [] });

beforeEach(() => {
  usePatrolStore.getState().reset();
  vi.clearAllMocks();
  api.listPlaces.mockResolvedValue([
    { id: 'hall', name: 'Hallway', placeType: 'corridor' },
    { id: 'kitchen', name: 'Kitchen', placeType: 'room' },
  ]);
  api.validateCron.mockResolvedValue({ valid: true, nextRuns: ['2026-08-16T22:00:00.000Z', '2026-08-17T03:00:00.000Z', '2026-08-17T22:00:00.000Z', 'x', 'y'] });
});
afterEach(() => {
  vi.useRealTimers();
});

describe('moveCheckpoint / draft helpers (pure)', () => {
  it('moves one slot and refuses to fall off either end', () => {
    const list = [cp('a', 'a'), cp('b', 'b'), cp('c', 'c')];
    expect(moveCheckpoint(list, 0, 1).map((c) => c.id)).toEqual(['b', 'a', 'c']);
    expect(moveCheckpoint(list, 2, -1).map((c) => c.id)).toEqual(['a', 'c', 'b']);
    expect(moveCheckpoint(list, 0, -1)).toBe(list);
    expect(moveCheckpoint(list, 2, 1)).toBe(list);
  });

  it('draftToInput trims, nulls the empty fields and drops blank expectations', () => {
    const input = draftToInput({
      name: '  Round ',
      robotId: '',
      twinId: '',
      checkpoints: [{ ...cp('a', ' hall '), headingDeg: 90, expectations: [' extinguisher ', ''] }],
      cronExpression: ' ',
      enabled: true,
      timeWindows: [{ id: 'day', name: 'Day', startHour: 7, endHour: 19 }],
      homePlaceId: '',
    });
    expect(input.name).toBe('Round');
    expect(input.robotId).toBeNull();
    expect(input.cronExpression).toBeNull();
    expect(input.homePlaceId).toBeNull();
    expect(input.checkpoints[0]).toMatchObject({ placeId: 'hall', headingDeg: 90, expectations: ['extinguisher'], dwellMs: 0 });
  });

  it('validateDraft names what is missing', () => {
    expect(validateDraft({ name: '', robotId: '', twinId: '', checkpoints: [], cronExpression: '', enabled: true, timeWindows: [], homePlaceId: '' })).toEqual([
      'Give the route a name.',
      'Add at least one checkpoint.',
    ]);
  });
});

describe('RouteEditor', () => {
  it('lists the robot’s places and adds checkpoints in order; up/down/remove reorder them', async () => {
    render(<RouteEditor robots={ROBOTS} defaultRobotId="g1" onSaved={() => {}} />);
    await waitFor(() => expect(api.listPlaces).toHaveBeenCalledWith('g1'));
    const pick = (await screen.findByTestId('patrol-place-pick')) as HTMLSelectElement;
    await waitFor(() => expect(pick.options.length).toBeGreaterThan(2));

    fireEvent.change(pick, { target: { value: 'hall' } });
    fireEvent.click(screen.getByTestId('patrol-checkpoint-add'));
    fireEvent.change(pick, { target: { value: 'kitchen' } });
    fireEvent.click(screen.getByTestId('patrol-checkpoint-add'));

    let rows = screen.getAllByTestId('patrol-checkpoint');
    expect(rows).toHaveLength(2);
    expect(screen.getByLabelText('Checkpoint 1 place id')).toHaveValue('hall');
    expect(screen.getByLabelText('Checkpoint 1 name')).toHaveValue('Hallway');
    expect(screen.getByLabelText('Checkpoint 2 place id')).toHaveValue('kitchen');

    fireEvent.click(screen.getByLabelText('Move checkpoint 2 up'));
    expect(screen.getByLabelText('Checkpoint 1 place id')).toHaveValue('kitchen');
    expect(screen.getByLabelText('Checkpoint 2 place id')).toHaveValue('hall');

    fireEvent.click(screen.getByLabelText('Remove checkpoint 1'));
    rows = screen.getAllByTestId('patrol-checkpoint');
    expect(rows).toHaveLength(1);
    expect(screen.getByLabelText('Checkpoint 1 place id')).toHaveValue('hall');
  });

  it('accepts a typed place id when the robot lists none', async () => {
    api.listPlaces.mockResolvedValue([]);
    render(<RouteEditor robots={ROBOTS} defaultRobotId="g1" onSaved={() => {}} />);
    const pick = (await screen.findByTestId('patrol-place-pick')) as HTMLSelectElement;
    fireEvent.change(pick, { target: { value: '__manual__' } });
    fireEvent.change(screen.getByTestId('patrol-place-manual'), { target: { value: 'garage' } });
    fireEvent.click(screen.getByTestId('patrol-checkpoint-add'));
    expect(screen.getAllByTestId('patrol-checkpoint')).toHaveLength(1);
    expect(screen.getByLabelText('Checkpoint 1 place id')).toHaveValue('garage');
  });

  it('validates the cron on the server (debounced) and shows the next three runs', async () => {
    render(<RouteEditor robots={ROBOTS} onSaved={() => {}} />);
    fireEvent.change(screen.getByTestId('patrol-cron-input'), { target: { value: '0 22,3 * * 1-5' } });
    await waitFor(() => expect(api.validateCron).toHaveBeenCalledWith('0 22,3 * * 1-5'), { timeout: 2000 });
    await waitFor(() => expect(screen.getByTestId('patrol-cron-next')).toHaveTextContent(/Next:/));
    // Three, not five: the contract shows the next three runs.
    const text = screen.getByTestId('patrol-cron-next').textContent ?? '';
    expect(text.split('·')).toHaveLength(3);
  });

  it('an invalid cron shows the server’s error and blocks Save', async () => {
    api.validateCron.mockResolvedValue({ valid: false, nextRuns: [], error: 'Invalid cron expression: expected 5 fields' });
    render(<RouteEditor robots={ROBOTS} onSaved={() => {}} />);
    fireEvent.change(screen.getByTestId('patrol-route-name'), { target: { value: 'R' } });
    fireEvent.change(screen.getByTestId('patrol-cron-input'), { target: { value: 'nonsense' } });
    await waitFor(() => expect(screen.getByTestId('patrol-cron-next')).toHaveTextContent(/expected 5 fields/), { timeout: 2000 });
    expect(screen.getByTestId('patrol-route-save')).toBeDisabled();
  });

  it('save posts the draft and reports the saved route', async () => {
    const saved: PatrolRoute = {
      id: 'route-1', name: 'Round', robotId: 'g1', twinId: null, checkpoints: [cp('a', 'hall')], cronExpression: null,
      enabled: true, timeWindows: [], homePlaceId: null, createdAt: 'x', updatedAt: 'x',
    };
    api.createRoute.mockResolvedValue(saved);
    const onSaved = vi.fn();
    render(<RouteEditor robots={ROBOTS} defaultRobotId="g1" onSaved={onSaved} />);
    fireEvent.change(screen.getByTestId('patrol-route-name'), { target: { value: 'Round' } });
    const pick = (await screen.findByTestId('patrol-place-pick')) as HTMLSelectElement;
    await waitFor(() => expect(pick.options.length).toBeGreaterThan(2));
    fireEvent.change(pick, { target: { value: 'hall' } });
    fireEvent.click(screen.getByTestId('patrol-checkpoint-add'));
    expect(screen.getByTestId('patrol-route-save')).not.toBeDisabled();
    await act(async () => {
      fireEvent.click(screen.getByTestId('patrol-route-save'));
    });
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(saved));
    const body = api.createRoute.mock.calls[0][0];
    expect(body.name).toBe('Round');
    expect(body.robotId).toBe('g1');
    expect(body.checkpoints[0].placeId).toBe('hall');
    // Day/night defaults travel with a new route.
    expect(body.timeWindows?.map((w) => w.id)).toEqual(['day', 'night']);
  });

  it('exports VDA5050 for an existing route', async () => {
    const route: PatrolRoute = {
      id: 'route-1', name: 'Round', robotId: 'g1', twinId: null, checkpoints: [cp('a', 'hall')], cronExpression: null,
      enabled: true, timeWindows: [], homePlaceId: null, createdAt: 'x', updatedAt: 'x',
    };
    api.exportVda5050.mockResolvedValue({ nodes: [], edges: [] });
    const createObjectURL = vi.fn(() => 'blob:x');
    const revokeObjectURL = vi.fn();
    Object.assign(URL, { createObjectURL, revokeObjectURL });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    render(<RouteEditor route={route} robots={ROBOTS} onSaved={() => {}} />);
    fireEvent.click(screen.getByTestId('patrol-export-vda5050'));
    await waitFor(() => expect(api.exportVda5050).toHaveBeenCalledWith('route-1'));
    await waitFor(() => expect(click).toHaveBeenCalled());
    click.mockRestore();
  });
});
