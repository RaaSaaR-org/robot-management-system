/**
 * @file SearchInput.tsx
 * @description The list filter box: search icon, the field look, a clear
 *              button once there is text, and Esc to clear.
 * @feature shared
 */

import { forwardRef, type InputHTMLAttributes } from 'react';
import { Search, X } from 'lucide-react';
import { cn } from '@/shared/utils/cn';
import { fieldBase, fieldSizes, fieldValid, focusRing, type FieldSize } from './styles';

export interface SearchInputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'size' | 'type'> {
  value: string;
  onChange: (value: string) => void;
  /** Default "Search" */
  placeholder?: string;
  /** Accessible name; defaults to the placeholder */
  'aria-label'?: string;
  size?: FieldSize;
  /** Classes for the wrapper */
  className?: string;
}

/**
 * @example
 * ```tsx
 * <SearchInput value={query} onChange={setQuery} placeholder="Search routes" />
 * ```
 */
export const SearchInput = forwardRef<HTMLInputElement, SearchInputProps>(function SearchInput(
  { value, onChange, placeholder = 'Search', size = 'md', className, onKeyDown, ...props },
  ref,
) {
  return (
    <div className={cn('relative w-full min-w-0', className)}>
      <Search
        aria-hidden="true"
        strokeWidth={1.75}
        className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-tertiary"
      />
      <input
        ref={ref}
        type="search"
        role="searchbox"
        value={value}
        placeholder={placeholder}
        aria-label={props['aria-label'] ?? placeholder}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          onKeyDown?.(event);
          if (event.key === 'Escape' && value) {
            event.preventDefault();
            event.stopPropagation();
            onChange('');
          }
        }}
        className={cn(
          fieldBase,
          fieldSizes[size],
          fieldValid,
          'pl-9 pr-9 [&::-webkit-search-cancel-button]:appearance-none',
        )}
        {...props}
      />
      {value && (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => onChange('')}
          className={cn(
            'absolute right-1.5 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-tag text-ink-tertiary',
            'transition-colors hover:bg-raised hover:text-ink-primary',
            focusRing,
          )}
        >
          <X className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
        </button>
      )}
    </div>
  );
});
