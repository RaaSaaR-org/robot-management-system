/**
 * @file Textarea.tsx
 * @description Multi-line text field on the kit's field look.
 * @feature shared
 */

import { forwardRef, type TextareaHTMLAttributes } from 'react';
import { cn } from '@/shared/utils/cn';
import { fieldBase, fieldInvalid, fieldValid } from './styles';

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  /** Error look (FormField's aria-invalid works too) */
  invalid?: boolean;
}

/**
 * @example
 * ```tsx
 * <FormField label="Notes"><Textarea rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} /></FormField>
 * ```
 */
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { invalid, className, rows = 4, ...props },
  ref,
) {
  const ariaInvalid = props['aria-invalid'];
  const hasError = Boolean(invalid) || ariaInvalid === true || ariaInvalid === 'true';
  return (
    <textarea
      ref={ref}
      rows={rows}
      aria-invalid={hasError || undefined}
      className={cn(
        fieldBase,
        'min-h-[88px] resize-y px-3 py-2.5 text-sm leading-relaxed',
        hasError ? fieldInvalid : fieldValid,
        className,
      )}
      {...props}
    />
  );
});
