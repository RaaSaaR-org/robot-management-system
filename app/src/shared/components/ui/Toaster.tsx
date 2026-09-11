/**
 * @file Toaster.tsx
 * @description Renders the toast queue: bottom-right stack (bottom, full width
 *              below 640px), matte raised cards, tone icon, close button.
 *              Polite live region; errors are role="alert". Mount once
 *              (FeedbackProvider does); extra instances render nothing.
 * @feature shared
 */

import { createPortal } from 'react-dom';
import { AlertTriangle, Bell, CheckCircle2, Info, X, XCircle, type LucideIcon } from 'lucide-react';
import { cn } from '@/shared/utils/cn';
import { focusRing } from './styles';
import { dismissToast, pauseToast, resumeToast, toastHosts, useToasts, type ToastItem, type ToastTone } from './toast';

const TONE_ICON: Record<ToastTone, LucideIcon> = {
  success: CheckCircle2,
  error: XCircle,
  warning: AlertTriangle,
  info: Info,
  neutral: Bell,
};

const TONE_TEXT: Record<ToastTone, string> = {
  success: 'text-signal-measured',
  error: 'text-signal-stopped',
  warning: 'text-signal-unknown',
  info: 'text-signal-estimated',
  neutral: 'text-ink-tertiary',
};

function ToastCard({ item }: { item: ToastItem }) {
  const Icon = TONE_ICON[item.tone];
  return (
    <li
      role={item.tone === 'error' ? 'alert' : undefined}
      data-tone={item.tone}
      onMouseEnter={() => pauseToast(item.id)}
      onMouseLeave={() => resumeToast(item.id)}
      onFocus={() => pauseToast(item.id)}
      onBlur={() => resumeToast(item.id)}
      className={cn(
        'pointer-events-auto flex items-start gap-3 rounded-control border border-line-strong bg-raised py-3 pl-3.5 pr-2',
        'shadow-[0_12px_32px_rgba(0,0,0,0.35)]',
      )}
    >
      <Icon className={cn('mt-px h-4 w-4 shrink-0', TONE_TEXT[item.tone])} strokeWidth={1.75} aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium leading-5 text-ink-primary">{item.title}</p>
        {item.description && (
          <div className="mt-0.5 break-words text-[13px] leading-relaxed text-ink-secondary">{item.description}</div>
        )}
        {item.action && (
          <button
            type="button"
            onClick={() => {
              item.action?.onClick();
              dismissToast(item.id);
            }}
            className={cn('mt-2 rounded-tag text-[13px] font-medium text-primary hover:underline', focusRing)}
          >
            {item.action.label}
          </button>
        )}
      </div>
      <button
        type="button"
        aria-label="Dismiss notification"
        onClick={() => dismissToast(item.id)}
        className={cn(
          'flex h-7 w-7 shrink-0 items-center justify-center rounded-tag text-ink-tertiary transition-colors',
          'hover:bg-ink-primary/[0.06] hover:text-ink-primary',
          focusRing,
        )}
      >
        <X className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
      </button>
    </li>
  );
}

/**
 * @example
 * ```tsx
 * // once, in the app shell (or use <FeedbackProvider>)
 * <Toaster />
 * ```
 */
export function Toaster() {
  const active = toastHosts.useIsActiveHost();
  const toasts = useToasts();
  if (!active || typeof document === 'undefined') return null;

  return createPortal(
    <section aria-label="Notifications" className="pointer-events-none fixed inset-x-4 bottom-4 z-[80] sm:inset-x-auto sm:bottom-5 sm:right-5 sm:w-[22rem]">
      <ol aria-live="polite" aria-relevant="additions" className="flex flex-col gap-2">
        {toasts.map((item) => (
          <ToastCard key={item.id} item={item} />
        ))}
      </ol>
    </section>,
    document.body,
  );
}
