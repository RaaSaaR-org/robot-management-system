/**
 * @file FormRenderer.tsx
 * @description Renders a form an agent asks the user to fill in, and its completed state
 * @feature a2a
 */

import { memo, useCallback, useState, type FormEvent } from 'react';
import { Button, Checkbox, FormField, Input, Select } from '@/shared/components/ui';
import { cn } from '@/shared/utils/cn';
import type { FormSchema, FormElement } from '../types';
import { parseFormSchema, getFormInstructions } from '../types';

interface FormRendererProps {
  /** The form schema from agent DataPart */
  schema: FormSchema;
  /** The message ID this form is associated with */
  messageId: string;
  /** The task ID this form is associated with (unused but kept for context) */
  taskId?: string;
  onSubmit: (data: Record<string, string>) => void;
  onCancel: () => void;
  isSubmitting?: boolean;
  className?: string;
}

/**
 * Read-only card of a submitted (or canceled) agent form.
 */
export const CompletedFormCard = memo(function CompletedFormCard({
  data,
  className,
}: {
  data: Record<string, string> | null;
  className?: string;
}) {
  return (
    <div className={cn('rounded-control border border-line-subtle bg-panel px-3 py-2 text-sm', className)}>
      {data === null ? (
        <p className="text-ink-tertiary">Form canceled</p>
      ) : (
        <dl className="flex flex-col gap-0.5">
          {Object.entries(data).map(([key, value]) => (
            <div key={key} className="flex gap-1.5">
              <dt className="text-ink-tertiary">{key}:</dt>
              <dd className="text-ink-primary">{value}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
});

/**
 * Interactive agent form built from kit fields.
 */
export const FormRenderer = memo(function FormRenderer({
  schema,
  messageId,
  onSubmit,
  onCancel,
  isSubmitting = false,
  className,
}: FormRendererProps) {
  const elements = parseFormSchema(schema);
  const instructions = getFormInstructions(schema);

  const [formData, setFormData] = useState<Record<string, string>>(() =>
    Object.fromEntries(elements.map((el) => [el.name, el.value])),
  );
  const [errors, setErrors] = useState<Record<string, string>>({});

  const handleChange = useCallback((name: string, value: string) => {
    setFormData((prev) => ({ ...prev, [name]: value }));
    setErrors((prev) => {
      if (!prev[name]) return prev;
      const next = { ...prev };
      delete next[name];
      return next;
    });
  }, []);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const next: Record<string, string> = {};
    elements.forEach((el) => {
      if (el.required && !formData[el.name]?.trim()) next[el.name] = `${el.label} is required.`;
    });
    setErrors(next);
    if (Object.keys(next).length === 0) onSubmit(formData);
  };

  const renderField = (el: FormElement) => {
    const value = formData[el.name] || '';
    if (el.type === 'checkbox') {
      return (
        <Checkbox
          key={el.name}
          id={`${messageId}-${el.name}`}
          label={el.label}
          description={el.description}
          checked={value === 'true'}
          onChange={(e) => handleChange(el.name, e.target.checked ? 'true' : 'false')}
          disabled={isSubmitting}
        />
      );
    }
    return (
      <FormField key={el.name} label={el.label} required={el.required} error={errors[el.name]} hint={el.description}>
        {el.options && el.options.length > 0 ? (
          <Select
            placeholder="Choose…"
            options={el.options.map((o) => ({ value: o, label: o }))}
            value={value}
            onChange={(e) => handleChange(el.name, e.target.value)}
            disabled={isSubmitting}
          />
        ) : (
          <Input
            type={el.type}
            value={value}
            onChange={(e) => handleChange(el.name, e.target.value)}
            disabled={isSubmitting}
          />
        )}
      </FormField>
    );
  };

  return (
    <form
      onSubmit={handleSubmit}
      noValidate
      className={cn('flex flex-col gap-4 rounded-control border border-line bg-panel p-4', className)}
    >
      {instructions && <p className="text-sm font-semibold text-ink-primary">{instructions}</p>}
      {elements.map(renderField)}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel} disabled={isSubmitting}>
          Cancel
        </Button>
        <Button type="submit" isLoading={isSubmitting} loadingText="Sending…">
          Send answer
        </Button>
      </div>
    </form>
  );
});
