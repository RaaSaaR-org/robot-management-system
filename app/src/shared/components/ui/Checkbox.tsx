/**
 * @file Checkbox.tsx
 * @description Native checkbox with the kit's look and an optional label and
 *              description. Checked = primary fill with an on-primary tick.
 * @feature shared
 */

import { forwardRef, useId, type InputHTMLAttributes, type ReactNode } from 'react';
import { Check } from 'lucide-react';
import { cn } from '@/shared/utils/cn';

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  /** Label to the right of the box (omit and pass aria-label for a bare box) */
  label?: ReactNode;
  /** Second line under the label */
  description?: ReactNode;
  /** Error look */
  invalid?: boolean;
}

/**
 * @example
 * ```tsx
 * <Checkbox label="Notify me when it finishes" checked={notify} onChange={(e) => setNotify(e.target.checked)} />
 * <Checkbox aria-label="Select row" checked={selected} onChange={toggle} />
 * ```
 */
export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox(
  { label, description, invalid, className, id, disabled, ...props },
  ref,
) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const descriptionId = description ? `${inputId}-description` : undefined;

  const box = (
    <span className="relative mt-px inline-flex h-4 w-4 shrink-0">
      <input
        ref={ref}
        id={inputId}
        type="checkbox"
        disabled={disabled}
        aria-describedby={descriptionId}
        aria-invalid={invalid || undefined}
        className={cn(
          'peer h-4 w-4 cursor-pointer appearance-none rounded-[4px] border bg-field',
          'transition-colors duration-150 checked:border-primary checked:bg-primary',
          'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary',
          'disabled:cursor-not-allowed disabled:opacity-50',
          invalid ? 'border-signal-stopped' : 'border-line-strong hover:border-ink-muted',
        )}
        {...props}
      />
      <Check
        aria-hidden="true"
        strokeWidth={3}
        className="pointer-events-none absolute inset-0 m-auto h-3 w-3 text-on-primary opacity-0 peer-checked:opacity-100"
      />
    </span>
  );

  if (!label) return <span className={cn('inline-flex', className)}>{box}</span>;

  return (
    <label
      htmlFor={inputId}
      className={cn('inline-flex items-start gap-2.5', disabled ? 'cursor-not-allowed opacity-70' : 'cursor-pointer', className)}
    >
      {box}
      <span className="min-w-0">
        <span className="block text-sm leading-[18px] text-ink-primary">{label}</span>
        {description && (
          <span id={descriptionId} className="mt-0.5 block text-xs text-ink-tertiary">
            {description}
          </span>
        )}
      </span>
    </label>
  );
});
