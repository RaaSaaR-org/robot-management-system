/**
 * @file SiteSelect.test.tsx
 * @description The Info tab's "Site" picker binds a robot to a twin (TASK-327)
 * @feature robots
 */

import { beforeEach, describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const listTwins = vi.fn();
const updateRobotSite = vi.fn();

vi.mock('@/features/digitaltwin', () => ({
  twinApi: { listTwins: () => listTwins() },
}));

vi.mock('../../../api/robotsApi', () => ({
  robotsApi: { updateRobotSite: (id: string, twinId: string | null) => updateRobotSite(id, twinId) },
}));

import { SiteSelect } from '../SiteSelect';

describe('SiteSelect (TASK-327)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listTwins.mockResolvedValue([
      { id: 'twin-1', name: 'Demo Warehouse' },
      { id: 'twin-2', name: 'Hall B' },
    ]);
  });

  it("lists the tenant's twins plus No site, showing the current binding", async () => {
    render(<SiteSelect robotId="robot-1" twinId="twin-2" />);
    const select = screen.getByLabelText('Site') as HTMLSelectElement;
    await waitFor(() => expect(screen.getByRole('option', { name: 'Demo Warehouse' })).toBeTruthy());
    expect(screen.getByRole('option', { name: 'No site' })).toBeTruthy();
    expect(select.value).toBe('twin-2');
  });

  it('binds the robot to the chosen twin', async () => {
    updateRobotSite.mockResolvedValue({ id: 'robot-1', twinId: 'twin-1' });
    render(<SiteSelect robotId="robot-1" twinId={null} />);
    await screen.findByRole('option', { name: 'Demo Warehouse' });

    await userEvent.selectOptions(screen.getByLabelText('Site'), 'twin-1');

    await waitFor(() => expect(updateRobotSite).toHaveBeenCalledWith('robot-1', 'twin-1'));
    expect((screen.getByLabelText('Site') as HTMLSelectElement).value).toBe('twin-1');
  });

  it('unbinds with null when No site is chosen', async () => {
    updateRobotSite.mockResolvedValue({ id: 'robot-1', twinId: null });
    render(<SiteSelect robotId="robot-1" twinId="twin-1" />);
    await screen.findByRole('option', { name: 'Demo Warehouse' });

    await userEvent.selectOptions(screen.getByLabelText('Site'), '');

    await waitFor(() => expect(updateRobotSite).toHaveBeenCalledWith('robot-1', null));
  });

  it('reverts the choice when the server refuses it', async () => {
    updateRobotSite.mockRejectedValue(new Error('Digital twin not found'));
    render(<SiteSelect robotId="robot-1" twinId={null} />);
    await screen.findByRole('option', { name: 'Hall B' });

    await userEvent.selectOptions(screen.getByLabelText('Site'), 'twin-2');

    await waitFor(() => expect((screen.getByLabelText('Site') as HTMLSelectElement).value).toBe(''));
  });
});
