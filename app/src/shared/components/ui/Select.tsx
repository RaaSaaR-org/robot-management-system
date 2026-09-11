/**
 * @file Select.tsx
 * @description Styled native <select>: the field look plus a chevron. Native on
 *              purpose — keyboard, mobile pickers and forms work for free.
 * @feature shared
 */

import { forwardRef, type ReactNode, type SelectHTMLAttributes } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/shared/utils/cn';
import { fieldBase, fieldInvalid, fieldValid, type FieldSize } from './styles';

export interface SelectOption {
  value: string;
  label: ReactNode;
  disabled?: boolean;
}

export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'size'> {
  /** Options; alternatively pass <option> children */
  options?: SelectOption[];
  /** First, empty-valued option ("All statuses", "Choose a robot…") */
  placeholder?: string;
  /** Error look (FormField's aria-invalid works too) */
  invalid?: boolean;
  /** sm 32px · md 38px · lg 44px */
  size?: FieldSize;
  /** Stretch to the container (default true). Use false in toolbars. */
  fullWidth?: boolean;
  /** Classes for the wrapper (width lives here, e.g. "w-44") */
  className?: string;
  /** Classes for the <select> element itself */
  selectClassName?: string;
}

const sizeStyles: Record<FieldSize, string> = {
  sm: 'h-8 pl-2.5 pr-8 text-[13px]',
  md: 'h-[38px] pl-3 pr-9 text-sm',
  lg: 'h-11 pl-3.5 pr-10 text-[15px]',
};

/**
 * @example
 * ```tsx
 * <Select
 *   aria-label="Status"
 *   fullWidth={false}
 *   placeholder="All statuses"
 *   options={[{ value: 'online', label: 'Online' }, { value: 'offline', label: 'Offline' }]}
 *   value={status}
 *   onChange={(e) => setStatus(e.target.value)}
 * />
 * ```
 */
export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { options, placeholder, invalid, size = 'md', fullWidth = true, className, selectClassName, children, ...props },
  ref,
) {
  const ariaInvalid = props['aria-invalid'];
  const hasError = Boolean(invalid) || ariaInvalid === true || ariaInvalid === 'true';

  return (
    <div className={cn('relative', fullWidth ? 'w-full' : 'inline-flex w-auto', className)}>
      <select
        ref={ref}
        aria-invalid={hasError || undefined}
        className={cn(
          fieldBase,
          'cursor-pointer appearance-none truncate',
          '[&>option]:bg-raised [&>option]:text-ink-primary',
          sizeStyles[size],
          hasError ? fieldInvalid : fieldValid,
          selectClassName,
        )}
        {...props}
      >
        {placeholder !== undefined && <option value="">{placeholder}</option>}
        {options?.map((option) => (
          <option key={option.value} value={option.value} disabled={option.disabled}>
            {typeof option.label === 'string' || typeof option.label === 'number' ? option.label : option.value}
          </option>
        ))}
        {children}
      </select>
      <ChevronDown
        aria-hidden="true"
        strokeWidth={1.75}
        className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-tertiary"
      />
    </div>
  );
});
