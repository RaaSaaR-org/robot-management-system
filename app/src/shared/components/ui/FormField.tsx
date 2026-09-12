/**
 * @file FormField.tsx
 * @description Label + control + hint/error, the one way to lay out a form
 *              field. When it wraps a single control it wires the control's
 *              id, aria-describedby and aria-invalid for you.
 * @feature shared
 */

import { Children, cloneElement, isValidElement, useId, type ReactElement, type ReactNode } from 'react';
import { cn } from '@/shared/utils/cn';
import { fieldError, fieldHint, fieldLabel } from './styles';

export interface FormFieldProps {
  label: ReactNode;
  /** id of the control; generated and injected into a single child when omitted */
  htmlFor?: string;
  /** Help text under the control */
  hint?: ReactNode;
  /** Error under the control (replaces the hint); turns the control red */
  error?: ReactNode;
  /** Shows a required marker after the label */
  required?: boolean;
  /** Right side of the label row ("Optional", a link) */
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
}

type ControlProps = {
  id?: string;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean | 'true' | 'false';
};

/**
 * @example
 * ```tsx
 * <FormField label="Name" required error={errors.name}>
 *   <Input value={name} onChange={(e) => setName(e.target.value)} />
 * </FormField>
 * <FormField label="Robot" hint="Only online robots can run a patrol.">
 *   <Select options={robotOptions} placeholder="Choose a robot…" value={robotId} onChange={…} />
 * </FormField>
 * ```
 */
export function FormField({ label, htmlFor, hint, error, required = false, aside, children, className }: FormFieldProps) {
  const generatedId = useId();
  const onlyChild = Children.count(children) === 1 && isValidElement(children) ? (children as ReactElement<ControlProps>) : null;
  const controlId = htmlFor ?? onlyChild?.props.id ?? `${generatedId}-control`;
  const messageId = `${controlId}-message`;
  const hasMessage = Boolean(error) || Boolean(hint);

  const control = onlyChild
    ? cloneElement(onlyChild, {
        id: controlId,
        'aria-describedby':
          [onlyChild.props['aria-describedby'], hasMessage ? messageId : undefined].filter(Boolean).join(' ') || undefined,
        'aria-invalid': error ? true : onlyChild.props['aria-invalid'],
      })
    : children;

  return (
    <div className={cn('flex min-w-0 flex-col gap-1.5', className)}>
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={controlId} className={fieldLabel}>
          {label}
          {required && (
            <span className="ml-0.5 text-signal-stopped" aria-hidden="true">
              *
            </span>
          )}
        </label>
        {aside && <div className="text-xs text-ink-tertiary">{aside}</div>}
      </div>
      {control}
      {error ? (
        <p id={messageId} role="alert" className={fieldError}>
          {error}
        </p>
      ) : hint ? (
        <p id={messageId} className={fieldHint}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}
