/**
 * @file FormRenderer.tsx
 * @description Dynamic form renderer for A2A agent form requests
 * @feature a2a
 */

import { memo, useState, useCallback } from 'react';
import { cn } from '@/shared/utils';
import { Button } from '@/shared/components/ui/Button';
import { Card } from '@/shared/components/ui/Card';
import { Input } from '@/shared/components/ui/Input';
import type { FormSchema, FormElement } from '../types';
import { parseFormSchema, getFormInstructions } from '../types';

// ============================================================================
// TYPES
// ============================================================================

interface FormRendererProps {
  /** The form schema from agent DataPart */
  schema: FormSchema;
  /** The message ID this form is associated with */
  messageId: string;
  /** The task ID this form is associated with (unused but kept for context) */
  taskId?: string;
  /** Called when form is submitted with valid data */
  onSubmit: (data: Record<string, string>) => void;
  /** Called when form is canceled */
  onCancel: () => void;
  /** Whether the form is currently submitting */
  isSubmitting?: boolean;
  /** Additional CSS classes */
  className?: string;
}

interface CompletedFormCardProps {
  /** The form data that was submitted, or null if canceled */
  data: Record<string, string> | null;
  /** Additional CSS classes */
  className?: string;
}

// ============================================================================
// COMPLETED FORM CARD
// ============================================================================

/**
 * Displays a completed or canceled form as a read-only card
 */
export const CompletedFormCard = memo(function CompletedFormCard({
  data,
  className,
}: CompletedFormCardProps) {
  if (data === null) {
    return (
      <Card
        variant="glass"
        className={cn('p-4', className)}
      >
        <p className="text-sm text-gray-500 dark:text-gray-400 italic">
          Form canceled
        </p>
      </Card>
    );
  }

  return (
    <Card
      variant="glass"
      className={cn('p-4', className)}
    >
      <div className="space-y-1">
        {Object.entries(data).map(([key, value]) => (
          <div key={key} className="text-sm">
            <span className="font-medium text-gray-700 dark:text-gray-300">
              {key}:
            </span>{' '}
            <span className="text-gray-600 dark:text-gray-400">{value}</span>
          </div>
        ))}
      </div>
    </Card>
  );
});

// ============================================================================
// FORM RENDERER
// ============================================================================

/**
 * Renders an interactive form based on A2A form schema
 */
export const FormRenderer = memo(function FormRenderer({
  schema,
  messageId,
  taskId: _taskId,
  onSubmit,
  onCancel,
  isSubmitting = false,
  className,
}: FormRendererProps) {
  // Parse form schema into elements
  const elements = parseFormSchema(schema);
  const instructions = getFormInstructions(schema);

  // Form state
  const [formData, setFormData] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    elements.forEach((el) => {
      initial[el.name] = el.value;
    });
    return initial;
  });

  const [errors, setErrors] = useState<Record<string, string>>({});

  // Handle field change
  const handleChange = useCallback((name: string, value: string) => {
    setFormData((prev) => ({ ...prev, [name]: value }));
    // Clear error when user types
    setErrors((prev) => {
      if (prev[name]) {
        const { [name]: _, ...rest } = prev;
        return rest;
      }
      return prev;
    });
  }, []);

  // Validate form
  const validate = useCallback((): boolean => {
    const newErrors: Record<string, string> = {};

    elements.forEach((el) => {
      if (el.required && !formData[el.name]?.trim()) {
        newErrors[el.name] = `${el.label} is required`;
      }
    });

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }, [elements, formData]);

  // Handle submit
  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (validate()) {
        onSubmit(formData);
      }
    },
    [formData, onSubmit, validate]
  );

  // Handle cancel
  const handleCancel = useCallback(() => {
    onCancel();
  }, [onCancel]);

  // Render form field based on type
  const renderField = (element: FormElement) => {
    const { name, label, type, required, description, options } = element;
    const value = formData[name] || '';
    const error = errors[name];

    // Handle select/radio with options
    if (options && options.length > 0) {
      return (
        <div key={name} className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
            {label}
            {required && <span className="text-red-500 ml-1">*</span>}
          </label>
          <select
            value={value}
            onChange={(e) => handleChange(name, e.target.value)}
            disabled={isSubmitting}
            className={cn(
              'w-full rounded-lg border bg-white dark:bg-gray-800 px-3 py-2.5',
              'text-gray-900 dark:text-gray-100',
              'transition-colors duration-200',
              'focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent',
              error ? 'border-red-500' : 'border-gray-200 dark:border-gray-700'
            )}
          >
            <option value="">Select...</option>
            {options.map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </select>
          {error && (
            <p className="text-sm text-red-500" role="alert">
              {error}
            </p>
          )}
          {description && !error && (
            <p className="text-sm text-gray-500 dark:text-gray-400">{description}</p>
          )}
        </div>
      );
    }

    // Handle checkbox
    if (type === 'checkbox') {
      return (
        <div key={name} className="flex items-center gap-2">
          <input
            type="checkbox"
            id={`${messageId}-${name}`}
            checked={value === 'true'}
            onChange={(e) => handleChange(name, e.target.checked ? 'true' : 'false')}
            disabled={isSubmitting}
            className="h-4 w-4 rounded border-gray-300 text-primary-500 focus:ring-primary-500"
          />
          <label
            htmlFor={`${messageId}-${name}`}
            className="text-sm text-gray-900 dark:text-gray-100"
          >
            {label}
            {required && <span className="text-red-500 ml-1">*</span>}
          </label>
        </div>
      );
    }

    // Default input field
    return (
      <Input
        key={name}
        label={label + (required ? ' *' : '')}
        type={type}
        value={value}
        onChange={(e) => handleChange(name, e.target.value)}
        error={error}
        helperText={description}
        disabled={isSubmitting}
        fullWidth
      />
    );
  };

  return (
    <form
      onSubmit={handleSubmit}
      className={cn(
        'glass-card rounded-brand p-4',
        'transition-all duration-300',
        className
      )}
    >
      {/* Instructions */}
      {instructions && (
        <h4 className="text-base font-semibold text-gray-900 dark:text-gray-100 mb-4">
          {instructions}
        </h4>
      )}

      {/* Form fields */}
      <div className="space-y-4">
        {elements.map(renderField)}
      </div>

      {/* Actions */}
      <div className="flex gap-3 mt-6">
        <Button
          type="button"
          variant="ghost"
          onClick={handleCancel}
          disabled={isSubmitting}
        >
          Cancel
        </Button>
        <Button
          type="submit"
          variant="primary"
          isLoading={isSubmitting}
          loadingText="Submitting..."
        >
          Submit
        </Button>
      </div>
    </form>
  );
});
