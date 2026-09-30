/**
 * @file CreateProcessModal.test.tsx
 * @description "Move to place" steps store a place reference, not coordinates (TASK-332)
 * @feature processes
 */

import { beforeEach, describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const createTask = vi.fn();
const listTwins = vi.fn();
const getPlaceGraph = vi.fn();
// Stable references: the modal's reset effect depends on `fetchRobots`.
const clearError = vi.fn();
const fetchRobots = vi.fn();
const robots = [{ id: 'robot-1', name: 'G1', status: 'online', twinId: 'twin-1' }];

vi.mock('../../hooks/useTasks', () => ({
  useTasks: () => ({ createTask, clearError }),
}));

vi.mock('@/features/robots/hooks/useRobots', () => ({
  useRobots: () => ({ robots, isLoading: false, fetchRobots }),
}));

vi.mock('@/features/digitaltwin/api/twinApi', () => ({
  twinApi: {
    listTwins: () => listTwins(),
    getPlaceGraph: (id: string) => getPlaceGraph(id),
  },
}));

import { CreateProcessModal } from '../CreateProcessModal';

const square = (x: number): [number, number][] => [[x, 0], [x + 2, 0], [x + 2, 2], [x, 2]];

describe('CreateProcessModal — Move to place (TASK-332)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listTwins.mockResolvedValue([
      { id: 'twin-1', name: 'Demo Warehouse' },
      { id: 'twin-2', name: 'Hall B' },
    ]);
    getPlaceGraph.mockResolvedValue({
      version: 1,
      frame: { id: 'twin-twin-1', kind: 'site', units: 'm', yawConvention: 'ccw', twinId: 'twin-1' },
      places: [
        { id: 'DOCK', name: 'Dock', placeType: 'cell', floor: 0, polygon: square(0), source: 'surveyed', keepout: false },
        { id: 'PIT', name: 'Pit', placeType: 'unknown', floor: 0, polygon: square(5), source: 'surveyed', keepout: true },
      ],
    });
    createTask.mockResolvedValue({ id: 'proc-1', name: 'Dock run' });
  });

  it('stores actionConfig.place and no coordinates; keepouts are not offered', async () => {
    const onSuccess = vi.fn();
    render(<CreateProcessModal isOpen onClose={vi.fn()} onSuccess={onSuccess} />);
    const user = userEvent.setup();

    await user.type(screen.getByPlaceholderText('e.g. Shelf scan, aisle 3'), 'Dock run');
    await user.click(screen.getByRole('button', { name: 'Add step' }));
    await user.type(screen.getByLabelText('Step 1 name'), 'Go to dock');

    await screen.findByRole('option', { name: 'Demo Warehouse' });
    await user.selectOptions(screen.getByLabelText('Step 1 site'), 'twin-1');
    await screen.findByRole('option', { name: 'Dock' });
    expect(screen.queryByRole('option', { name: 'Pit' })).toBeNull();
    await user.selectOptions(screen.getByLabelText('Step 1 place'), 'DOCK');

    await user.click(screen.getByRole('button', { name: 'Create automation' }));

    await waitFor(() => expect(createTask).toHaveBeenCalledTimes(1));
    const step = createTask.mock.calls[0][0].steps[0];
    expect(step).toEqual({
      name: 'Go to dock',
      actionType: 'move_to_location',
      actionConfig: { place: { twinId: 'twin-1', placeId: 'DOCK' } },
    });
    expect(getPlaceGraph).toHaveBeenCalledWith('twin-1');
    expect(onSuccess).toHaveBeenCalledWith('proc-1');
  });

  it('defaults the site to the chosen robot and refuses a step with no place', async () => {
    render(<CreateProcessModal isOpen onClose={vi.fn()} preselectedRobotId="robot-1" />);
    const user = userEvent.setup();

    await user.type(screen.getByPlaceholderText('e.g. Shelf scan, aisle 3'), 'Dock run');
    await user.click(screen.getByRole('button', { name: 'Add step' }));
    await user.type(screen.getByLabelText('Step 1 name'), 'Go');
    await screen.findByRole('option', { name: 'Demo Warehouse' });
    expect((screen.getByLabelText('Step 1 site') as HTMLSelectElement).value).toBe('twin-1');

    await user.click(screen.getByRole('button', { name: 'Create automation' }));

    expect(await screen.findByText('Pick a site and a place for every "Move to place" step.')).toBeTruthy();
    expect(createTask).not.toHaveBeenCalled();
  });
});
