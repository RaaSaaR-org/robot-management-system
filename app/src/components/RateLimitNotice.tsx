/**
 * @file RateLimitNotice.tsx
 * @description One calm toast while the app waits out a "too many requests"
 *              answer for more than a moment (TASK-482). It appears by itself
 *              and leaves by itself: the retry is automatic, so there is
 *              nothing for the viewer to do but know why a panel is still
 *              loading.
 * @feature api
 */

import { useEffect } from 'react';
import { useRateLimitHint } from '@/api/rateLimitStatus';
import { dismissToast, toast } from '@/shared/components/ui';

/** The id the notice's toast carries, so it replaces itself and tests can find it. */
export const RATE_LIMIT_TOAST_ID = 'rate-limit-wait';

export const RATE_LIMIT_TITLE = 'The server asked us to slow down';
export const RATE_LIMIT_DESCRIPTION = 'Retrying automatically — this page will catch up in a moment.';

/** Mount once inside the toast host. Renders nothing itself. */
export function RateLimitNotice() {
  const waiting = useRateLimitHint();

  useEffect(() => {
    if (!waiting) return;
    toast.info(RATE_LIMIT_TITLE, {
      id: RATE_LIMIT_TOAST_ID,
      description: RATE_LIMIT_DESCRIPTION,
      duration: null,
    });
    return () => dismissToast(RATE_LIMIT_TOAST_ID);
  }, [waiting]);

  return null;
}
