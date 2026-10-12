/**
 * @file AlertBanner.tsx
 * @description Banner displaying the most critical unacknowledged alert. Rendered
 *              by AppLayout in normal flow (sticky below the TopBar) so it never
 *              overlaps page content. A critical alert is the one saturated red
 *              on screen (bg-stop); everything else is a tinted signal tone.
 * @feature alerts
 * @dependencies @/shared/utils/cn, @/features/alerts/hooks
 */

import { useCallback, useMemo } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { OctagonAlert } from 'lucide-react';
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
  critical: 'bg-stop border-transparent text-on-stop',
  error: 'bg-signal-stopped/10 border-signal-stopped/30 text-ink-primary',
  warning: 'bg-signal-unknown/10 border-signal-unknown/30 text-ink-primary',
  info: 'bg-signal-estimated/10 border-signal-estimated/30 text-ink-primary',
};

/** Secondary-style action, readable on the STOP fill. */
const CRITICAL_BUTTON = 'border-on-stop/60 text-on-stop hover:bg-on-stop/15 hover:text-on-stop';

// ============================================================================
// SUB-COMPONENTS
// ============================================================================

/**
 * The unacknowledged alerts that repeat `alert`: same title, source and
 * sourceId. They read as one line, so they count and clear as one (TASK-388).
 */
export function sameAlertGroup(alert: Alert, unacknowledged: Alert[]): Alert[] {
  return unacknowledged.filter(
    (a) =>
      a.id === alert.id ||
      (a.title === alert.title && a.source === alert.source && a.sourceId === alert.sourceId)
  );
}

interface AlertBannerContentProps {
  alert: Alert;
  /** How many identical unacknowledged alerts this line stands for. */
  count: number;
  onAcknowledge: () => void;
  onDismiss: () => void;
}

function AlertBannerContent({ alert, count, onAcknowledge, onDismiss }: AlertBannerContentProps) {
  const isCritical = alert.severity === 'critical';
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
    <div className="flex items-center justify-between gap-3 px-3 py-2 sm:gap-4 sm:px-4 sm:py-2.5">
      <div className="flex min-w-0 items-center gap-2.5 sm:gap-3">
        {/* On the STOP fill a severity chip would be red on red — the fill
            already says "critical", so an icon carries it instead. */}
        {isCritical ? (
          <OctagonAlert className="h-4 w-4 shrink-0" strokeWidth={1.75} aria-hidden="true" />
        ) : (
          <AlertSeverityBadge severity={alert.severity} showDot />
        )}
        <div className="min-w-0 truncate text-sm">
          <span className="font-semibold">{alert.title}</span>
          {count > 1 && (
            <span
              className={cn('ml-1.5 font-mono text-xs', isCritical ? 'opacity-90' : 'text-ink-muted')}
              data-testid="alert-banner-count"
              title={`${count} identical alerts`}
            >
              ×{count}
            </span>
          )}
          <span aria-hidden="true" className={cn('mx-1.5 sm:mx-2', isCritical ? 'opacity-70' : 'text-ink-muted')}>
            ·
          </span>
          <span className={isCritical ? 'opacity-90' : 'text-ink-secondary'}>{message}</span>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-3">
        {findingPath && (
          <Link
            to={findingPath}
            onClick={(e) => e.stopPropagation()}
            className={cn(
              'whitespace-nowrap text-xs font-medium underline underline-offset-2',
              isCritical ? 'text-on-stop hover:opacity-80' : 'text-primary hover:text-primary-hover'
            )}
            data-testid="alert-banner-open-finding"
          >
            {linkLabel}
          </Link>
        )}
        {isCritical ? (
          <Button size="sm" variant="secondary" onClick={onAcknowledge} className={CRITICAL_BUTTON}>
            Acknowledge
          </Button>
        ) : (
          alert.dismissable && (
            <Button size="sm" variant="secondary" onClick={onDismiss}>
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
 * Sticky banner that displays the most critical unacknowledged alert.
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
  const { mostCriticalAlert, unacknowledgedAlerts, acknowledgeAlertAsync, dismissAlert, error } =
    useAlerts();

  // Identical repeats of the shown alert: one click clears them all, otherwise
  // each Dismiss puts the same line straight back and looks like a no-op.
  const group = useMemo(
    () => (mostCriticalAlert ? sameAlertGroup(mostCriticalAlert, unacknowledgedAlerts) : []),
    [mostCriticalAlert, unacknowledgedAlerts]
  );

  // Hooks must be declared before any early returns (React Rules of Hooks).
  // Both actions go to the server: acknowledging only in memory hides the
  // banner until the next fetch of /alerts/active hands the same alert back.
  const handleAcknowledge = useCallback(() => {
    for (const a of group) void acknowledgeAlertAsync(a.id);
  }, [group, acknowledgeAlertAsync]);

  const handleDismiss = useCallback(() => {
    for (const a of group) void dismissAlert(a.id);
  }, [group, dismissAlert]);

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
  // The non-critical tones are translucent tints, so the sticky bar needs an
  // opaque canvas plate under it — without one the page scrolls *through* the
  // alert and neither the alert nor the content stays readable.
  return (
    <div
      role="alert"
      aria-live="assertive"
      className={cn('sticky top-16 z-30 rounded-control bg-canvas', className)}
    >
      <div className={cn('rounded-control border animate-fade-in', SEVERITY_STYLES[mostCriticalAlert.severity])}>
        <AlertBannerContent
          alert={mostCriticalAlert}
          count={group.length}
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
