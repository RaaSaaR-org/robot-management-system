/**
 * @file CreateProcessModal.tsx
 * @description FormModal "New automation": name, description, priority, robot and
 *              repeatable steps. Toasts the result and hands the new id back.
 * @feature processes
 */

import { useEffect, useMemo, useState } from 'react';
import { Plus, X } from 'lucide-react';
import { Button, Checkbox, FormField, FormModal, Input, Select, Textarea, toast } from '@/shared/components/ui';
import { useRobots } from '@/features/robots/hooks/useRobots';
import { useTasks } from '../hooks/useTasks';
import { PROCESS_PRIORITY_LABELS, type CreateProcessStep, type ProcessPriority } from '../types';

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

interface FieldErrors {
  name?: string;
  robot?: string;
  steps?: string;
}

export function CreateProcessModal({ isOpen, onClose, onSuccess, preselectedRobotId }: CreateProcessModalProps) {
  const { createTask, clearError } = useTasks();
  const { robots, isLoading: robotsLoading, fetchRobots } = useRobots();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [robotId, setRobotId] = useState(preselectedRobotId ?? '');
  const [priority, setPriority] = useState<ProcessPriority>('normal');
  const [steps, setSteps] = useState<CreateProcessStep[]>([]);
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

  const updateStep = (index: number, value: string) =>
    setSteps((prev) => prev.map((s, i) => (i === index ? { ...s, name: value } : s)));

  const handleSubmit = async () => {
    const next: FieldErrors = {};
    if (!name.trim()) next.name = 'Give the automation a name.';
    if (steps.some((s) => !s.name.trim())) next.steps = 'Name every step, or remove the empty ones.';
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
        steps: steps.length > 0 ? steps.map((s) => ({ name: s.name.trim() })) : undefined,
        startNow,
      });
      toast.success(startNow ? 'Automation created and started' : 'Automation created', { description: created.name });
      onClose();
      onSuccess?.(created.id);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err));
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
        aside="Optional"
        error={errors.steps}
        hint={steps.length === 0 ? 'Without steps the automation runs as a single action.' : undefined}
      >
        <div className="flex flex-col gap-2">
          {steps.map((step, index) => (
            <div key={index} className="flex items-center gap-2">
              <span className="w-5 shrink-0 text-right text-[13px] text-ink-tertiary">{index + 1}.</span>
              <Input
                aria-label={`Step ${index + 1} name`}
                value={step.name}
                onChange={(e) => updateStep(index, e.target.value)}
                placeholder="Step name"
                invalid={Boolean(errors.steps) && !step.name.trim()}
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
          ))}
          <div>
            <Button
              variant="ghost"
              size="sm"
              leftIcon={<Plus className="h-4 w-4" strokeWidth={1.75} />}
              onClick={() => setSteps((prev) => [...prev, { name: '' }])}
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
