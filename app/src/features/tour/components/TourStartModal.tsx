/**
 * @file TourStartModal.tsx
 * @description "Start ‹tour›" dialog: pick the robot (prefilled with the
 *              tour's own robot, else the first robot), then walk the tour now
 *              as if a visitor had accepted the offer. The result — accepted or
 *              the robot's refusal reason — is a toast.
 * @feature tour
 */

import { useEffect, useMemo, useState } from 'react';
import { FormField, FormModal, Select, toast } from '@/shared/components/ui';
import type { TourRoute } from '../types/tour.types';
import { useTourStore } from '../store/tourStore';

export interface TourStartModalRobot {
  id: string;
  name: string;
}

export interface TourStartModalProps {
  route: TourRoute | null;
  robots: TourStartModalRobot[];
  onClose: () => void;
  /** Called after the server accepted the start. */
  onStarted?: () => void;
}

export function TourStartModal({ route, robots, onClose, onStarted }: TourStartModalProps) {
  const startRun = useTourStore((s) => s.startRun);
  const clearStartResult = useTourStore((s) => s.clearStartResult);
  const clearError = useTourStore((s) => s.clearError);
  const [robotId, setRobotId] = useState('');
  const [robotError, setRobotError] = useState<string>();
  const [formError, setFormError] = useState<string>();
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    if (!route) return;
    setRobotId(route.robotId ?? robots[0]?.id ?? '');
    setRobotError(undefined);
    setFormError(undefined);
    // Reset only when the dialog opens for a tour, not when the robot list refreshes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route]);

  const options = useMemo(() => {
    const list = robots.map((r) => ({ value: r.id, label: r.name }));
    if (route?.robotId && !robots.some((r) => r.id === route.robotId)) list.unshift({ value: route.robotId, label: route.robotId });
    return list;
  }, [robots, route]);

  const handleSubmit = async () => {
    if (!route) return;
    if (!robotId) {
      setRobotError('Choose the robot that gives the tour.');
      return;
    }
    setStarting(true);
    setFormError(undefined);
    try {
      const result = await startRun(route.id, robotId);
      if (!result) {
        const message = useTourStore.getState().error ?? 'The server did not answer.';
        clearError();
        setFormError(message);
        toast.error("Couldn't start the tour", { description: message });
        return;
      }
      clearStartResult();
      if (result.accepted) {
        toast.success('Tour started', { description: route.name });
        onStarted?.();
        onClose();
      } else {
        const reason = result.reason ? ` (${result.reason})` : '';
        setFormError(`Refused${reason}: ${result.message}`);
        toast.warning('The robot refused the tour', { description: `${result.message}${reason}` });
      }
    } finally {
      setStarting(false);
    }
  };

  return (
    <FormModal
      isOpen={route !== null}
      onClose={onClose}
      title={route ? `Start ${route.name}` : 'Start tour'}
      description={route ? `The robot walks ${route.stops.length} stop${route.stops.length === 1 ? '' : 's'} as if a visitor had said yes.` : undefined}
      submitLabel="Start tour"
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
          data-testid="tour-start-robot"
        />
      </FormField>
    </FormModal>
  );
}
