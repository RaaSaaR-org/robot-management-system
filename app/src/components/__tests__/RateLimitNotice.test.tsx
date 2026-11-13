/**
 * @file RateLimitNotice.test.tsx
 * @description The shell says "retrying" only while a 429 wait has lasted more
 *              than a moment, and takes the notice away by itself (TASK-482).
 * @feature api
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { RATE_LIMIT_HINT_DELAY_MS, beginRateLimitWait, resetRateLimitStatus } from '@/api/rateLimitStatus';
import { FeedbackProvider } from '@/shared/components/ui/FeedbackProvider';
import { dismissToast } from '@/shared/components/ui';
import { RATE_LIMIT_TITLE, RateLimitNotice } from '../RateLimitNotice';

beforeEach(() => {
  vi.useFakeTimers();
  resetRateLimitStatus();
  dismissToast();
});

afterEach(() => {
  act(() => {
    resetRateLimitStatus();
    dismissToast();
  });
  vi.useRealTimers();
});

function renderShell() {
  return render(
    <FeedbackProvider>
      <RateLimitNotice />
    </FeedbackProvider>
  );
}

describe('RateLimitNotice', () => {
  it('is silent when nothing is throttled', () => {
    renderShell();
    expect(screen.queryByText(RATE_LIMIT_TITLE)).not.toBeInTheDocument();
  });

  it('is silent for a wait that ends within a moment', () => {
    renderShell();
    let end = () => {};
    act(() => { end = beginRateLimitWait(); });
    act(() => { vi.advanceTimersByTime(RATE_LIMIT_HINT_DELAY_MS - 100); });
    act(() => { end(); });
    act(() => { vi.advanceTimersByTime(5000); });

    expect(screen.queryByText(RATE_LIMIT_TITLE)).not.toBeInTheDocument();
  });

  it('says so once the wait lasts, stays as long as it does, and leaves when it is over', () => {
    renderShell();
    let end = () => {};
    act(() => { end = beginRateLimitWait(); });
    act(() => { vi.advanceTimersByTime(RATE_LIMIT_HINT_DELAY_MS); });

    expect(screen.getByText(RATE_LIMIT_TITLE)).toBeInTheDocument();
    expect(screen.getByText(/Retrying automatically/)).toBeInTheDocument();

    // Not a toast that times out while the wait goes on.
    act(() => { vi.advanceTimersByTime(60_000); });
    expect(screen.getByText(RATE_LIMIT_TITLE)).toBeInTheDocument();

    act(() => { end(); });
    expect(screen.queryByText(RATE_LIMIT_TITLE)).not.toBeInTheDocument();
  });
});
