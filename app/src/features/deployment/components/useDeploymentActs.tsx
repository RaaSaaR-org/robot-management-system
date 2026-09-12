/**
 * @file useDeploymentActs.tsx
 * @description The deployment acts (start, promote, roll back, cancel) with their confirms and
 * toasts, shared by the list page and the detail page so both behave identically.
 * @feature deployment
 */

import { useCallback, useState, type ReactNode } from 'react';
import { confirm, toast } from '@/shared/components/ui';
import { useDeploymentStore } from '../store';
import type { Deployment } from '../types';
import { RollbackFormModal } from './RollbackFormModal';
import { deploymentName, errorMessage } from './deploymentHelpers';

export interface DeploymentActs {
  start: (d: Deployment) => Promise<boolean>;
  promote: (d: Deployment) => Promise<boolean>;
  cancel: (d: Deployment) => Promise<boolean>;
  openRollback: (d: Deployment) => void;
  /** Render this once in the page: the roll back FormModal. */
  rollbackModal: ReactNode;
}

/**
 * @param onChanged called after every successful act (e.g. to refetch the detail view)
 */
export function useDeploymentActs(onChanged?: (act: 'start' | 'promote' | 'rollback' | 'cancel') => void): DeploymentActs {
  const startDeployment = useDeploymentStore((s) => s.startDeployment);
  const promoteDeployment = useDeploymentStore((s) => s.promoteDeployment);
  const rollbackDeployment = useDeploymentStore((s) => s.rollbackDeployment);
  const cancelDeployment = useDeploymentStore((s) => s.cancelDeployment);
  const [rollbackTarget, setRollbackTarget] = useState<Deployment | null>(null);

  const start = useCallback(
    async (d: Deployment) => {
      const ok = await confirm({
        title: 'Start rollout?',
        description: `${deploymentName(d)} goes to the first canary stage and the matching robots start switching.`,
        confirmLabel: 'Start rollout',
      });
      if (!ok) return false;
      try {
        await startDeployment(d.id);
        toast.success('Deployment started', { description: deploymentName(d) });
        onChanged?.('start');
        return true;
      } catch (err) {
        toast.error("Couldn't start the deployment", { description: errorMessage(err) });
        return false;
      }
    },
    [startDeployment, onChanged],
  );

  const promote = useCallback(
    async (d: Deployment) => {
      const ok = await confirm({
        title: 'Promote to production?',
        description: `All robots in the target switch to ${deploymentName(d)}.`,
        confirmLabel: 'Promote',
      });
      if (!ok) return false;
      try {
        await promoteDeployment(d.id);
        toast.success('Deployment promoted', { description: deploymentName(d) });
        onChanged?.('promote');
        return true;
      } catch (err) {
        toast.error("Couldn't promote the deployment", { description: errorMessage(err) });
        return false;
      }
    },
    [promoteDeployment, onChanged],
  );

  const cancel = useCallback(
    async (d: Deployment) => {
      const ok = await confirm({
        title: 'Cancel this deployment?',
        description: `Robots already updated keep ${deploymentName(d)} until you roll back.`,
        confirmLabel: 'Cancel deployment',
        cancelLabel: 'Keep it',
        tone: 'danger',
      });
      if (!ok) return false;
      try {
        await cancelDeployment(d.id);
        toast.success('Deployment cancelled', { description: deploymentName(d) });
        onChanged?.('cancel');
        return true;
      } catch (err) {
        toast.error("Couldn't cancel the deployment", { description: errorMessage(err) });
        return false;
      }
    },
    [cancelDeployment, onChanged],
  );

  const submitRollback = useCallback(
    async (d: Deployment, reason: string) => {
      await rollbackDeployment(d.id, reason); // throws → stays in the modal
      toast.success('Deployment rolled back', { description: deploymentName(d) });
      onChanged?.('rollback');
    },
    [rollbackDeployment, onChanged],
  );

  return {
    start,
    promote,
    cancel,
    openRollback: setRollbackTarget,
    rollbackModal: (
      <RollbackFormModal
        deployment={rollbackTarget}
        onClose={() => setRollbackTarget(null)}
        onSubmit={submitRollback}
      />
    ),
  };
}
