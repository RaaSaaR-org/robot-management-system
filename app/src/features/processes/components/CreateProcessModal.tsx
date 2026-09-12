/**
 * @file CreateProcessModal.tsx
 * @description FormModal "New automation": name, description, priority, robot and
 *              steps, each an action the robot agent really executes plus the one
 *              parameter that action needs. Toasts the result and hands the new id back.
 * @feature processes
 */

import { useEffect, useMemo, useState } from 'react';
import { Plus, X } from 'lucide-react';
import { Button, Checkbox, FormField, FormModal, Input, Select, Textarea, toast } from '@/shared/components/ui';
import { getErrorMessage } from '@/shared/utils';
import { useRobots } from '@/features/robots/hooks/useRobots';
import { useZones } from '@/features/fleet/hooks/useZones';
import { useTasks } from '../hooks/useTasks';
import {
  PROCESS_PRIORITY_LABELS,
  PROCESS_STEP_ACTION_LABELS,
  type CreateProcessStep,
  type ProcessPriority,
  type StepActionType,
} from '../types';

export interface CreateProcessModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Called with the new automation's id after it was created */
  onSuccess?: (processId: string) => void;
  /** Robot to preselect */
  preselectedRobotId?: string;
}

const PRIORITY_OPTIONS = (Object.keys(PROCESS_PRIORITY_LABELS) as ProcessPriority[]).map((p) => ({
  value: p,
  label: PROCESS_PRIORITY_LABELS[p],
}));

const ACTION_OPTIONS = (Object.keys(PROCESS_STEP_ACTION_LABELS) as StepActionType[]).map((a) => ({
  value: a,
  label: PROCESS_STEP_ACTION_LABELS[a],
}));

/**
 * A step being edited. `zoneId` is local to the form: the server is sent
 * coordinates, because `TaskQueue` hands `actionConfig.location` to the robot's
 * mover as a `RobotLocation` and a zone *name* has no x/y.
 */
interface StepDraft extends CreateProcessStep {
  zoneId?: string;
}

const DEFAULT_ACTION: StepActionType = 'move_to_location';

function newStep(): StepDraft {
  return { name: '', actionType: DEFAULT_ACTION, actionConfig: {} };
}

/** The problem with a step, or undefined when it is ready to send. */
function stepProblem(step: StepDraft): string | undefined {
  if (!step.name.trim()) return 'Name every step, or remove the empty ones.';
  switch (step.actionType) {
    case 'move_to_location':
      return step.actionConfig.location ? undefined : 'Pick a zone for every "Move to zone" step.';
    case 'pickup_object':
      return String(step.actionConfig.objectId ?? '').trim()
        ? undefined
        : 'Name the object for every "Pick up object" step.';
    case 'wait': {
      const ms = Number(step.actionConfig.durationMs ?? 0);
      return Number.isFinite(ms) && ms > 0 ? undefined : 'Give every "Wait" step a duration in seconds.';
    }
    default:
      return undefined;
  }
}

export function CreateProcessModal({ isOpen, onClose, onSuccess, preselectedRobotId }: CreateProcessModalProps) {
  const { createTask, clearError } = useTasks();
  const { robots, isLoading: robotsLoading, fetchRobots } = useRobots();
  const { zones, isLoading: zonesLoading } = useZones();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [robotId, setRobotId] = useState(preselectedRobotId ?? '');
  const [priority, setPriority] = useState<ProcessPriority>('normal');
  const [steps, setSteps] = useState<StepDraft[]>([]);
  const [startNow, setStartNow] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string>();
  const [saving, setSaving] = useState(false);

  // Reset whenever the modal opens
  useEffect(() => {
    if (!isOpen) return;
    setName('');
    setDescription('');
    setRobotId(preselectedRobotId ?? '');
    setPriority('normal');
    setSteps([]);
    setStartNow(false);
    setErrors({});
    setFormError(undefined);
    void fetchRobots();
  }, [isOpen, preselectedRobotId, fetchRobots]);

  // Every robot is listed with its status: an automation can be queued for a
  // robot that is offline now and runs once it comes back.
  const robotOptions = useMemo(
    () => robots.map((r) => ({ value: r.id, label: `${r.name} (${r.status})` })),
    [robots],
  );
  const noneOnline = robots.length > 0 && !robots.some((r) => r.status === 'online' || r.status === 'busy');

  const zoneOptions = useMemo(
    () => zones.map((z) => ({ value: z.id, label: `${z.name} · floor ${z.floor}` })),
    [zones],
  );

  const patchStep = (index: number, patch: Partial<StepDraft>) =>
    setSteps((prev) => prev.map((s, i) => (i === index ? { ...s, ...patch } : s)));

  /** Switching action type drops the previous action's parameters with it. */
  const changeAction = (index: number, actionType: StepActionType) =>
    patchStep(index, { actionType, actionConfig: {}, zoneId: undefined });

  const selectZone = (index: number, zoneId: string) => {
    const zone = zones.find((z) => z.id === zoneId);
    if (!zone) {
      patchStep(index, { zoneId: '', actionConfig: {} });
      return;
    }
    // The zone's centre, derived exactly as the robot agent derives it
    // (robot-agent/src/tools/navigation.ts).
    patchStep(index, {
      zoneId,
      actionConfig: {
        location: {
          x: Math.round(zone.bounds.x + zone.bounds.width / 2),
          y: Math.round(zone.bounds.y + zone.bounds.height / 2),
          floor: zone.floor,
          zone: zone.name,
        },
      },
    });
  };

  const handleSubmit = async () => {
    const next: FieldErrors = {};
    if (!name.trim()) next.name = 'Give the automation a name.';
    if (steps.length === 0) {
      next.steps = 'Add at least one step — an automation with no steps does nothing.';
    } else {
      const problem = steps.map(stepProblem).find(Boolean);
      if (problem) next.steps = problem;
    }
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    setSaving(true);
    setFormError(undefined);
    try {
      const created = await createTask({
        name: name.trim(),
        description: description.trim() || undefined,
        robotId,
        priority,
        steps: steps.map((s) => ({
          name: s.name.trim(),
          actionType: s.actionType,
          actionConfig: s.actionConfig,
        })),
        startNow,
      });
      toast.success(startNow ? 'Automation created and started' : 'Automation created', { description: created.name });
      onClose();
      onSuccess?.(created.id);
    } catch (err) {
      setFormError(getErrorMessage(err));
      clearError();
    } finally {
      setSaving(false);
    }
  };

  return (
    <FormModal
      isOpen={isOpen}
      onClose={onClose}
      title="New automation"
      description="A multi-step job one robot runs on its own."
      submitLabel="Create automation"
      submittingLabel="Creating…"
      isSubmitting={saving}
      error={formError}
      onSubmit={handleSubmit}
      size="lg"
      noValidate
    >
      <FormField label="Name" required error={errors.name}>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Shelf scan, aisle 3" />
      </FormField>
      <FormField label="Description" aside="Optional">
        <Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
      </FormField>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FormField
          label="Robot"
          aside="Optional"
          error={errors.robot}
          hint={noneOnline ? 'No robot is online right now; it runs when one comes back.' : 'Leave empty to let the fleet pick one.'}
        >
          <Select
            placeholder={robotsLoading ? 'Loading robots…' : 'Any available robot'}
            options={robotOptions}
            value={robotId}
            onChange={(e) => setRobotId(e.target.value)}
          />
        </FormField>
        <FormField label="Priority">
          <Select options={PRIORITY_OPTIONS} value={priority} onChange={(e) => setPriority(e.target.value as ProcessPriority)} />
        </FormField>
      </div>

      <FormField
        label="Steps"
        required
        error={errors.steps}
        hint="Each step is one action the robot carries out, in order."
      >
        <div className="flex flex-col gap-3">
          {steps.map((step, index) => {
            const invalid = Boolean(errors.steps) && Boolean(stepProblem(step));
            return (
              <div key={index} className="flex flex-col gap-2 rounded-control border border-line-subtle bg-inset p-2.5">
                <div className="flex items-center gap-2">
                  <span className="w-5 shrink-0 text-right text-[13px] text-ink-tertiary">{index + 1}.</span>
                  <Input
                    aria-label={`Step ${index + 1} name`}
                    value={step.name}
                    onChange={(e) => patchStep(index, { name: e.target.value })}
                    placeholder="Step name"
                    invalid={invalid && !step.name.trim()}
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    iconOnly
                    aria-label={`Remove step ${index + 1}`}
                    onClick={() => setSteps((prev) => prev.filter((_, i) => i !== index))}
                  >
                    <X className="h-4 w-4" strokeWidth={1.75} />
                  </Button>
                </div>
                <div className="flex flex-wrap items-center gap-2 pl-7">
                  <Select
                    aria-label={`Step ${index + 1} action`}
                    className="w-48"
                    fullWidth={false}
                    size="sm"
                    options={ACTION_OPTIONS}
                    value={step.actionType}
                    onChange={(e) => changeAction(index, e.target.value as StepActionType)}
                  />
                  {step.actionType === 'move_to_location' && (
                    <Select
                      aria-label={`Step ${index + 1} zone`}
                      className="w-56"
                      fullWidth={false}
                      size="sm"
                      placeholder={zonesLoading ? 'Loading zones…' : 'Choose a zone'}
                      options={zoneOptions}
                      value={step.zoneId ?? ''}
                      invalid={invalid && !step.actionConfig.location}
                      onChange={(e) => selectZone(index, e.target.value)}
                    />
                  )}
                  {step.actionType === 'pickup_object' && (
                    <Input
                      aria-label={`Step ${index + 1} object`}
                      size="sm"
                      className="w-56"
                      placeholder="Object id, e.g. pallet-12"
                      value={String(step.actionConfig.objectId ?? '')}
                      invalid={invalid && !String(step.actionConfig.objectId ?? '').trim()}
                      onChange={(e) => patchStep(index, { actionConfig: { objectId: e.target.value } })}
                    />
                  )}
                  {step.actionType === 'wait' && (
                    <div className="flex items-center gap-2">
                      <Input
                        aria-label={`Step ${index + 1} duration in seconds`}
                        type="number"
                        min={1}
                        size="sm"
                        className="w-24"
                        placeholder="Seconds"
                        value={
                          step.actionConfig.durationMs === undefined
                            ? ''
                            : String(Number(step.actionConfig.durationMs) / 1000)
                        }
                        invalid={invalid && !(Number(step.actionConfig.durationMs ?? 0) > 0)}
                        onChange={(e) => {
                          const seconds = Number(e.target.value);
                          patchStep(index, {
                            actionConfig:
                              e.target.value === '' || !Number.isFinite(seconds)
                                ? {}
                                : { durationMs: Math.round(seconds * 1000) },
                          });
                        }}
                      />
                      <span className="text-[13px] text-ink-tertiary">seconds</span>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
          <div>
            <Button
              variant="ghost"
              size="sm"
              leftIcon={<Plus className="h-4 w-4" strokeWidth={1.75} />}
              onClick={() => setSteps((prev) => [...prev, newStep()])}
            >
              Add step
            </Button>
          </div>
        </div>
      </FormField>

      <Checkbox
        label="Run it now"
        description="Off: the automation is created and waits until you press Run."
        checked={startNow}
        onChange={(e) => setStartNow(e.target.checked)}
      />
    </FormModal>
  );
}

interface FieldErrors {
  name?: string;
  robot?: string;
  steps?: string;
}
