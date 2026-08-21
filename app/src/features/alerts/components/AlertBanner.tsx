/**
 * @file AlertBanner.tsx
 * @description Banner displaying the most critical unacknowledged alert. Rendered
 *              by AppLayout in normal flow (sticky below the TopBar) so it never
 *              overlaps page content.
 * @feature alerts
 * @dependencies @/shared/utils/cn, @/features/alerts/hooks
 */

import { useCallback } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { cn } from '@/shared/utils/cn';
import { Button } from '@/shared/components/ui/Button';
import { useAlerts } from '../hooks/useAlerts';
import { AlertSeverityBadge } from './AlertSeverityBadge';
import type { Alert, AlertSeverity } from '../types/alerts.types';
import { findingLinkPath, parseFindingLink, stripFindingLink } from '@/features/patrol/utils/patrolFormat';

// ============================================================================
// TYPES
// ============================================================================

export interface AlertBannerProps {
  /** Additional class names */
  className?: string;
}

// ============================================================================
// STYLES
// ============================================================================

const SEVERITY_STYLES: Record<AlertSeverity, string> = {
  critical: 'bg-red-500 border-red-600 text-white',
  error: 'bg-red-100 border-red-200 text-red-900 dark:bg-red-900/20 dark:border-red-800 dark:text-red-200',
  warning: 'bg-yellow-100 border-yellow-200 text-yellow-900 dark:bg-yellow-900/20 dark:border-yellow-800 dark:text-yellow-200',
  info: 'bg-blue-100 border-blue-200 text-blue-900 dark:bg-blue-900/20 dark:border-blue-800 dark:text-blue-200',
};

const SEVERITY_BUTTON_STYLES: Record<AlertSeverity, string> = {
  critical: 'bg-white/20 hover:bg-white/30 text-white border-white/30',
  error: 'bg-red-200 hover:bg-red-300 text-red-900 dark:bg-red-800 dark:hover:bg-red-700 dark:text-red-100',
  warning: 'bg-yellow-200 hover:bg-yellow-300 text-yellow-900 dark:bg-yellow-800 dark:hover:bg-yellow-700 dark:text-yellow-100',
  info: 'bg-blue-200 hover:bg-blue-300 text-blue-900 dark:bg-blue-800 dark:hover:bg-blue-700 dark:text-blue-100',
};

/** "Open finding" link tint — readable on each severity's banner background. */
const SEVERITY_LINK_STYLES: Record<AlertSeverity, string> = {
  critical: 'text-white/90 hover:text-white',
  error: 'text-red-800 hover:text-red-900 dark:text-red-200 dark:hover:text-red-100',
  warning: 'text-yellow-800 hover:text-yellow-900 dark:text-yellow-200 dark:hover:text-yellow-100',
  info: 'text-blue-800 hover:text-blue-900 dark:text-blue-200 dark:hover:text-blue-100',
};

// ============================================================================
// SUB-COMPONENTS
// ============================================================================

interface AlertBannerContentProps {
  alert: Alert;
  onAcknowledge: () => void;
  onDismiss: () => void;
}

function AlertBannerContent({ alert, onAcknowledge, onDismiss }: AlertBannerContentProps) {
  const isCritical = alert.severity === 'critical';
  const buttonStyle = SEVERITY_BUTTON_STYLES[alert.severity];
  // TASK-212: an alert raised for a patrol finding carries a machine tag
  // `[finding:<id> run:<runId>]` in its message tail. Keep it out of the prose
  // and offer it as a deep link into the run instead.
  const findingLink = parseFindingLink(alert.message) ?? parseFindingLink(alert.title);
  const findingPath = findingLink ? findingLinkPath(findingLink) : null;
  const message = findingLink ? stripFindingLink(alert.message) : alert.message;
  // A skipped-run alert carries a bare `[run:<id>]` — the target is the run
  // itself. Saying "Open finding" there promises evidence that does not exist.
  // A tour run (TASK-213) is a visit, and the page it opens says "Visit".
  const linkLabel = findingLink?.findingId
    ? 'Open finding →'
    : findingLink?.kind === 'tour'
      ? 'Open visit →'
      : 'Open run →';

  return (
    <div className="flex items-center justify-between gap-2 px-3 py-2 sm:gap-4 sm:px-4 sm:py-3">
      <div className="flex items-center gap-2 min-w-0 sm:gap-3">
        {/* On the solid red critical banner the severity chip is red-on-red —
            the banner color already says "critical", so skip the chip there. */}
        {!isCritical && <AlertSeverityBadge severity={alert.severity} showDot />}
        <div className="min-w-0 truncate">
          <span className="font-medium">{alert.title}</span>
          <span className="mx-1 sm:mx-2">-</span>
          <span className="opacity-90">{message}</span>
        </div>
      </div>

      <div className="flex items-center gap-2 flex-shrink-0">
        {findingPath && (
          <Link
            to={findingPath}
            onClick={(e) => e.stopPropagation()}
            className={cn(
              'text-xs underline underline-offset-2 whitespace-nowrap',
              SEVERITY_LINK_STYLES[alert.severity]
            )}
            data-testid="alert-banner-open-finding"
          >
            {linkLabel}
          </Link>
        )}
        {isCritical ? (
          <Button size="sm" variant="ghost" onClick={onAcknowledge} className={cn('border', buttonStyle)}>
            Acknowledge
          </Button>
        ) : (
          alert.dismissable && (
            <Button size="sm" variant="ghost" onClick={onDismiss} className={cn('border', buttonStyle)}>
              Dismiss
            </Button>
          )
        )}
      </div>
    </div>
  );
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

/**
 * Fixed banner that displays the most critical unacknowledged alert.
 * Renders at the top of the viewport with severity-based styling.
 *
 * @example
 * ```tsx
 * function AppLayout({ children }) {
 *   return (
 *     <div>
 *       <AlertBanner />
 *       <main>{children}</main>
 *     </div>
 *   );
 * }
 * ```
 */
export function AlertBanner({ className }: AlertBannerProps) {
  const location = useLocation();
  const { mostCriticalAlert, acknowledgeAlertAsync, dismissAlert, error } = useAlerts();

  // Hooks must be declared before any early returns (React Rules of Hooks).
  // Both actions go to the server: acknowledging only in memory hides the
  // banner until the next fetch of /alerts/active hands the same alert back.
  const handleAcknowledge = useCallback(() => {
    if (mostCriticalAlert) {
      void acknowledgeAlertAsync(mostCriticalAlert.id);
    }
  }, [mostCriticalAlert, acknowledgeAlertAsync]);

  const handleDismiss = useCallback(() => {
    if (mostCriticalAlert) {
      void dismissAlert(mostCriticalAlert.id);
    }
  }, [mostCriticalAlert, dismissAlert]);

  // Hide banner on landing page
  if (location.pathname === '/') {
    return null;
  }

  // Hide alerts in demo mode — they show mock data that confuses visitors
  if (import.meta.env.VITE_DEMO_MODE === 'true') {
    return null;
  }

  if (!mostCriticalAlert) {
    return null;
  }

  // In normal layout flow (rendered by AppLayout above the page content) so it
  // never overlaps page titles; sticks below the 56px TopBar while scrolling.
  // The severity tints are translucent in dark mode (`dark:bg-*-900/20`), so the
  // sticky bar needs an opaque plate under it — without one the page scrolls
  // *through* the alert and neither the alert nor the content stays readable.
  return (
    <div
      role="alert"
      aria-live="assertive"
      className={cn('sticky top-14 z-30 rounded-brand bg-theme-primary', className)}
    >
      <div
        className={cn(
          'border rounded-brand transition-all duration-300 animate-fade-in',
          SEVERITY_STYLES[mostCriticalAlert.severity]
        )}
      >
        <AlertBannerContent
          alert={mostCriticalAlert}
          onAcknowledge={handleAcknowledge}
          onDismiss={handleDismiss}
        />
        {/* A rejected acknowledge/dismiss puts the banner straight back; say why
            instead of letting the click look like it did nothing. Inside the
            tinted layer, so the reason sits on the severity colour and within
            the border rather than on the bare plate under it. */}
        {error && (
          <p className="px-3 pb-2 text-xs opacity-90 sm:px-4" data-testid="alert-banner-error">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
