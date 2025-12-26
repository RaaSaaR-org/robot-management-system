/**
 * @file CreateTaskModal.tsx
 * @description Modal form for creating new tasks
 * @feature processes
 * @dependencies @/shared/components/ui, @/features/processes/hooks, @/features/robots/hooks
 */

import { useState } from 'react';
import { Modal, Input, Button, Spinner } from '@/shared/components/ui';
import { cn } from '@/shared/utils/cn';
import { useTasks } from '../hooks/useTasks';
import { useRobots } from '@/features/robots/hooks/useRobots';
import type { ProcessPriority as TaskPriority, CreateProcessRequest as CreateTaskRequest, CreateProcessStep as CreateTaskStep } from '../types';
import { PROCESS_PRIORITY_LABELS as TASK_PRIORITY_LABELS } from '../types';

// ============================================================================
// TYPES
// ============================================================================

export interface CreateTaskModalProps {
  /** Control modal visibility */
  isOpen: boolean;
  /** Callback when modal closes */
  onClose: () => void;
  /** Callback when task is created successfully */
  onSuccess?: (taskId: string) => void;
  /** Pre-selected robot ID (optional) */
  preselectedRobotId?: string;
}

// ============================================================================
// COMPONENT
// ============================================================================

/**
 * Modal form for creating new tasks.
 *
 * @example
 * ```tsx
 * const [showModal, setShowModal] = useState(false);
 *
 * <CreateTaskModal
 *   isOpen={showModal}
 *   onClose={() => setShowModal(false)}
 *   onSuccess={(taskId) => navigate(`/tasks/${taskId}`)}
 * />
 * ```
 */
export function CreateTaskModal({
  isOpen,
  onClose,
  onSuccess,
  preselectedRobotId,
}: CreateTaskModalProps) {
  const { createTask, isExecuting, error } = useTasks();
  const { robots, isLoading: robotsLoading } = useRobots();

  // Form state
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [robotId, setRobotId] = useState(preselectedRobotId ?? '');
  const [priority, setPriority] = useState<TaskPriority>('normal');
  const [steps, setSteps] = useState<CreateTaskStep[]>([]);
  const [formError, setFormError] = useState<string | null>(null);

  // Handle adding a step
  const addStep = () => {
    setSteps([...steps, { name: '', description: '' }]);
  };

  // Handle removing a step
  const removeStep = (index: number) => {
    setSteps(steps.filter((_, i) => i !== index));
  };

  // Handle updating a step
  const updateStep = (index: number, field: 'name' | 'description', value: string) => {
    const newSteps = [...steps];
    newSteps[index] = { ...newSteps[index], [field]: value };
    setSteps(newSteps);
  };

  // Validate form
  const validateForm = (): boolean => {
    if (!name.trim()) {
      setFormError('Process name is required');
      return false;
    }
    if (!robotId) {
      setFormError('Please select a robot');
      return false;
    }
    // Validate steps have names
    for (const step of steps) {
      if (!step.name.trim()) {
        setFormError('All steps must have a name');
        return false;
      }
    }
    setFormError(null);
    return true;
  };

  // Handle form submission
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!validateForm()) return;

    try {
      const data: CreateTaskRequest = {
        name: name.trim(),
        description: description.trim() || undefined,
        robotId,
        priority,
        steps: steps.length > 0 ? steps.filter((s) => s.name.trim()) : undefined,
      };

      const task = await createTask(data);
      onSuccess?.(task.id);
      onClose();
    } catch {
      // Error is handled by the store
    }
  };

  // Handle close
  const handleClose = () => {
    if (!isExecuting) {
      onClose();
    }
  };

  // Priority options
  const priorityOptions: TaskPriority[] = ['low', 'normal', 'high', 'critical'];

  // Available robots (online or busy)
  const availableRobots = robots.filter((r) => r.status === 'online' || r.status === 'busy');

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title="Create New Process"
      size="lg"
      closeOnBackdrop={!isExecuting}
      closeOnEscape={!isExecuting}
      footer={
        <div className="flex justify-end gap-3">
          <Button variant="ghost" onClick={handleClose} disabled={isExecuting}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleSubmit} disabled={isExecuting}>
            {isExecuting ? (
              <>
                <Spinner size="sm" className="mr-2" />
                Creating...
              </>
            ) : (
              'Create Process'
            )}
          </Button>
        </div>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Error display */}
        {(formError || error) && (
          <div className="p-3 rounded-brand bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-sm">
            {formError || error}
          </div>
        )}

        {/* Task Name */}
        <div>
          <label htmlFor="task-name" className="block text-sm font-medium text-theme-primary mb-1">
            Task Name <span className="text-red-500">*</span>
          </label>
          <Input
            id="task-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Enter task name"
            disabled={isExecuting}
          />
        </div>

        {/* Description */}
        <div>
          <label htmlFor="task-description" className="block text-sm font-medium text-theme-primary mb-1">
            Description
          </label>
          <textarea
            id="task-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Enter task description (optional)"
            disabled={isExecuting}
            rows={3}
            className={cn(
              'w-full px-3 py-2 rounded-brand border border-theme bg-theme-bg text-theme-primary',
              'placeholder:text-theme-tertiary',
              'focus:outline-none focus:ring-2 focus:ring-cobalt-500 focus:border-cobalt-500',
              'disabled:opacity-50 disabled:cursor-not-allowed',
              'resize-none'
            )}
          />
        </div>

        {/* Robot Selection */}
        <div>
          <label htmlFor="task-robot" className="block text-sm font-medium text-theme-primary mb-1">
            Assign Robot <span className="text-red-500">*</span>
          </label>
          {robotsLoading ? (
            <div className="flex items-center gap-2 text-sm text-theme-secondary py-2">
              <Spinner size="sm" />
              Loading robots...
            </div>
          ) : (
            <select
              id="task-robot"
              value={robotId}
              onChange={(e) => setRobotId(e.target.value)}
              disabled={isExecuting}
              className={cn(
                'w-full px-3 py-2 rounded-brand border border-theme bg-theme-bg text-theme-primary',
                'focus:outline-none focus:ring-2 focus:ring-cobalt-500 focus:border-cobalt-500',
                'disabled:opacity-50 disabled:cursor-not-allowed'
              )}
            >
              <option value="">Select a robot</option>
              {availableRobots.length === 0 ? (
                <option value="" disabled>
                  No available robots
                </option>
              ) : (
                availableRobots.map((robot) => (
                  <option key={robot.id} value={robot.id}>
                    {robot.name} ({robot.model}) - {robot.status}
                  </option>
                ))
              )}
            </select>
          )}
          {availableRobots.length === 0 && !robotsLoading && (
            <p className="text-xs text-theme-tertiary mt-1">
              All robots must have online status to be assigned tasks
            </p>
          )}
        </div>

        {/* Priority */}
        <div>
          <label className="block text-sm font-medium text-theme-primary mb-1">Priority</label>
          <div className="flex items-center gap-2">
            {priorityOptions.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setPriority(p)}
                disabled={isExecuting}
                className={cn(
                  'px-3 py-1.5 text-sm rounded-brand transition-colors',
                  priority === p
                    ? 'bg-cobalt-500 text-white'
                    : 'bg-theme-elevated text-theme-secondary hover:text-theme-primary',
                  'disabled:opacity-50 disabled:cursor-not-allowed'
                )}
              >
                {TASK_PRIORITY_LABELS[p]}
              </button>
            ))}
          </div>
        </div>

        {/* Steps */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="block text-sm font-medium text-theme-primary">
              Steps (Optional)
            </label>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={addStep}
              disabled={isExecuting}
            >
              <svg className="h-4 w-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 4v16m8-8H4"
                />
              </svg>
              Add Step
            </Button>
          </div>

          {steps.length === 0 ? (
            <p className="text-sm text-theme-tertiary py-2">
              No steps defined. The task will execute as a single action.
            </p>
          ) : (
            <div className="space-y-3">
              {steps.map((step, index) => (
                <div
                  key={index}
                  className="p-3 rounded-brand border border-theme bg-theme-elevated"
                >
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <span className="text-xs text-theme-tertiary">Step {index + 1}</span>
                    <button
                      type="button"
                      onClick={() => removeStep(index)}
                      disabled={isExecuting}
                      className="text-red-500 hover:text-red-600 disabled:opacity-50"
                    >
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M6 18L18 6M6 6l12 12"
                        />
                      </svg>
                    </button>
                  </div>
                  <Input
                    value={step.name}
                    onChange={(e) => updateStep(index, 'name', e.target.value)}
                    placeholder="Step name"
                    disabled={isExecuting}
                    size="sm"
                    className="mb-2"
                  />
                  <Input
                    value={step.description ?? ''}
                    onChange={(e) => updateStep(index, 'description', e.target.value)}
                    placeholder="Step description (optional)"
                    disabled={isExecuting}
                    size="sm"
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      </form>
    </Modal>
  );
}
