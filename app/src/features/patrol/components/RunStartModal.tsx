/**
 * @file RunStartModal.tsx
 * @description "Start ‹route›" dialog: pick the robot (prefilled with the
 *              route's own robot, else the first robot) and the mode (patrol or
 *              baseline), then start the run. The result — accepted or the
 *              robot's refusal reason — is a toast.
 * @feature patrol
 */

import { useEffect, useMemo, useState } from 'react';
import { FormField, FormModal, SegmentedControl, Select, toast } from '@/shared/components/ui';
import type { PatrolRoute, PatrolRunMode } from '../types/patrol.types';
import { usePatrolStore } from '../store/patrolStore';

export interface RunStartModalRobot {
  id: string;
  name: string;
}

export interface RunStartModalProps {
  route: PatrolRoute | null;
  /** Mode the dialog opens with. */
  initialMode?: PatrolRunMode;
  robots: RunStartModalRobot[];
  onClose: () => void;
  /** Called after the server accepted the start. */
  onStarted?: () => void;
}

const MODE_OPTIONS: { value: PatrolRunMode; label: string }[] = [
  { value: 'patrol', label: 'Patrol' },
  { value: 'baseline', label: 'Baseline' },
];

export function RunStartModal({ route, initialMode = 'patrol', robots, onClose, onStarted }: RunStartModalProps) {
  const startRun = usePatrolStore((s) => s.startRun);
  const clearStartResult = usePatrolStore((s) => s.clearStartResult);
  const clearError = usePatrolStore((s) => s.clearError);
  const [robotId, setRobotId] = useState('');
  const [mode, setMode] = useState<PatrolRunMode>(initialMode);
  const [robotError, setRobotError] = useState<string>();
  const [formError, setFormError] = useState<string>();
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    if (!route) return;
    setRobotId(route.robotId ?? robots[0]?.id ?? '');
    setMode(initialMode);
    setRobotError(undefined);
    setFormError(undefined);
    // Reset only when the dialog opens for a route, not when the robot list refreshes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route, initialMode]);

  const options = useMemo(() => {
    const list = robots.map((r) => ({ value: r.id, label: r.name }));
    if (route?.robotId && !robots.some((r) => r.id === route.robotId)) {
      list.unshift({ value: route.robotId, label: route.robotId });
    }
    return list;
  }, [robots, route]);

  const handleSubmit = async () => {
    if (!route) return;
    if (!robotId) {
      setRobotError('Choose the robot that walks the route.');
      return;
    }
    setStarting(true);
    setFormError(undefined);
    try {
      const result = await startRun(route.id, mode, robotId);
      if (!result) {
        const message = usePatrolStore.getState().error ?? 'The server did not answer.';
        clearError();
        setFormError(message);
        toast.error("Couldn't start the run", { description: message });
        return;
      }
      clearStartResult();
      if (result.accepted) {
        toast.success('Run started', { description: `${route.name} · ${mode === 'baseline' ? 'Baseline' : 'Patrol'}` });
        onStarted?.();
        onClose();
      } else {
        const reason = result.reason ? ` (${result.reason})` : '';
        setFormError(`Refused${reason}: ${result.message}`);
        toast.warning('The robot refused the run', { description: `${result.message}${reason}` });
      }
    } finally {
      setStarting(false);
    }
  };

  return (
    <FormModal
      isOpen={route !== null}
      onClose={onClose}
      title={route ? `Start ${route.name}` : 'Start run'}
      description={route ? `The robot walks ${route.checkpoints.length} checkpoint${route.checkpoints.length === 1 ? '' : 's'}.` : undefined}
      submitLabel="Start run"
      submittingLabel="Starting…"
      isSubmitting={starting}
      error={formError}
      onSubmit={handleSubmit}
      noValidate
    >
      <FormField label="Robot" required error={robotError}>
        <Select
          placeholder={options.length === 0 ? 'No robots' : 'Choose a robot…'}
          options={options}
          value={robotId}
          onChange={(e) => setRobotId(e.target.value)}
          data-testid="patrol-start-robot"
        />
      </FormField>
      <FormField label="Mode" hint={mode === 'baseline' ? 'Walk supervised and record what is normal.' : 'Walk and compare against the baseline.'}>
        <SegmentedControl label="Mode" options={MODE_OPTIONS} value={mode} onChange={setMode} />
      </FormField>
    </FormModal>
  );
}
