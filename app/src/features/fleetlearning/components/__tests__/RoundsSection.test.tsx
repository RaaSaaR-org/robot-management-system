/**
 * @file RoundsSection.test.tsx
 * @description The rounds table offers Cancel on an unfinished round and
 *              Delete on a finished one, each behind a danger confirm that
 *              spells out the consequence and ending in a toast (TASK-272).
 * @feature fleetlearning
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { confirm, toast } from '@/shared/components/ui';
import { fleetlearningApi } from '../../api/fleetlearningApi';
import { useFleetLearningStore } from '../../store/fleetlearningStore';
import { RoundsSection } from '../RoundsSection';
import type { FederatedRound } from '../../types/fleetlearning.types';

vi.mock('@/shared/components/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/shared/components/ui')>();
  return {
    ...actual,
    confirm: vi.fn(),
    toast: { ...actual.toast, success: vi.fn(), error: vi.fn() },
  };
});

vi.mock('../../api/fleetlearningApi');

const api = vi.mocked(fleetlearningApi);

function makeRound(overrides: Partial<FederatedRound> = {}): FederatedRound {
  return {
    id: 'abcdef123',
    status: 'training',
    globalModelVersion: 'v1',
    config: {
      minParticipants: 3,
      maxParticipants: 50,
      trainingTimeout: 3600,
      uploadTimeout: 600,
      aggregationMethod: 'fedavg',
      selectionStrategy: 'random',
      localEpochs: 1,
      localLearningRate: 0.001,
      minLocalSamples: 10,
      secureAggregation: false,
    },
    participantCount: 3,
    completedParticipants: 0,
    failedParticipants: 0,
    totalLocalSamples: 0,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  };
}

async function openMenu(round: FederatedRound) {
  api.listRounds.mockResolvedValue({ rounds: [round], total: 1, limit: 20, offset: 0 });
  render(
    <MemoryRouter>
      <RoundsSection newAction={null} />
    </MemoryRouter>,
  );
  fireEvent.click(await screen.findByRole('button', { name: 'Actions for round #abcdef' }));
}

describe('RoundsSection acts (TASK-272)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useFleetLearningStore.setState({ rounds: [], selectedRound: null, error: null, isLoading: false });
  });

  it('cancels a training round through a danger confirm and a toast', async () => {
    const round = makeRound();
    vi.mocked(confirm).mockResolvedValue(true);
    api.cancelRound.mockResolvedValue({ ...round, status: 'cancelled' });

    await openMenu(round);
    expect(screen.queryByRole('menuitem', { name: /Delete/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('menuitem', { name: /Cancel round/ }));

    await waitFor(() => expect(api.cancelRound).toHaveBeenCalledWith('abcdef123'));
    expect(vi.mocked(confirm).mock.calls[0][0]).toMatchObject({ tone: 'danger', confirmLabel: 'Cancel round' });
    expect(String(vi.mocked(confirm).mock.calls[0][0].description)).toContain('discarded');
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Round cancelled', expect.anything()));
  });

  it('deletes a completed round, and offers no cancel for it', async () => {
    const round = makeRound({ status: 'completed' });
    vi.mocked(confirm).mockResolvedValue(true);
    api.deleteRound.mockResolvedValue(undefined);

    await openMenu(round);
    expect(screen.queryByRole('menuitem', { name: /Cancel round/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('menuitem', { name: /Delete/ }));

    await waitFor(() => expect(api.deleteRound).toHaveBeenCalledWith('abcdef123'));
    expect(vi.mocked(confirm).mock.calls[0][0]).toMatchObject({
      title: 'Delete round #abcdef?',
      confirmLabel: 'Delete',
      tone: 'danger',
    });
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Round deleted', expect.anything()));
  });

  it("toasts the server's reason and keeps the table when a cancel is refused", async () => {
    vi.mocked(confirm).mockResolvedValue(true);
    api.cancelRound.mockRejectedValue({ message: 'Round is already completed and cannot be cancelled' });

    await openMenu(makeRound());
    fireEvent.click(screen.getByRole('menuitem', { name: /Cancel round/ }));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Couldn't cancel the round", {
        description: 'Round is already completed and cannot be cancelled',
      }),
    );
    expect(screen.queryByText("Couldn't load rounds")).not.toBeInTheDocument();
  });
});
