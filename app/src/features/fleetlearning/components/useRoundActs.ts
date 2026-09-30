/**
 * @file useRoundActs.ts
 * @description The destructive round acts (cancel, delete) with their confirms
 *              and toasts, shared by the rounds table and the round detail page
 *              so both behave identically (TASK-272).
 * @feature fleetlearning
 */

import { useCallback } from 'react';
import { confirm, errorMessage, toast } from '@/shared/components/ui';
import { useFleetLearningStore } from '../store/fleetlearningStore';
import type { FederatedRound } from '../types/fleetlearning.types';

/** Short, readable round id: a hash sign and the first six characters of the id. */
export const shortRoundId = (id: string) => `#${id.slice(0, 6)}`;

export interface RoundActs {
  /** Confirm, cancel, toast. Resolves true when the round was cancelled. */
  cancel: (round: FederatedRound) => Promise<boolean>;
  /** Confirm, delete, toast. Resolves true when the round was deleted. */
  remove: (round: FederatedRound) => Promise<boolean>;
}

export function useRoundActs(): RoundActs {
  const cancelRound = useFleetLearningStore((s) => s.cancelRound);
  const deleteRound = useFleetLearningStore((s) => s.deleteRound);

  const cancel = useCallback(
    async (r: FederatedRound) => {
      const ok = await confirm({
        title: `Cancel round ${shortRoundId(r.id)}?`,
        description:
          r.status === 'created'
            ? 'The round never starts. It stays in the list as cancelled.'
            : 'Robots still training drop out and their updates are discarded; nothing is aggregated. Robots that already uploaded keep the privacy budget they spent.',
        confirmLabel: 'Cancel round',
        cancelLabel: 'Keep it',
        tone: 'danger',
      });
      if (!ok) return false;
      try {
        await cancelRound(r.id);
        toast.success('Round cancelled', { description: shortRoundId(r.id) });
        return true;
      } catch (err) {
        toast.error("Couldn't cancel the round", { description: errorMessage(err) });
        return false;
      }
    },
    [cancelRound],
  );

  const remove = useCallback(
    async (r: FederatedRound) => {
      const ok = await confirm({
        title: `Delete round ${shortRoundId(r.id)}?`,
        description:
          'The round, its participant records and its metrics are removed for good. A model it produced stays in the registry.',
        confirmLabel: 'Delete',
        tone: 'danger',
      });
      if (!ok) return false;
      try {
        await deleteRound(r.id);
        toast.success('Round deleted', { description: shortRoundId(r.id) });
        return true;
      } catch (err) {
        toast.error("Couldn't delete the round", { description: errorMessage(err) });
        return false;
      }
    },
    [deleteRound],
  );

  return { cancel, remove };
}
