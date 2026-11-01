/**
 * @file QuickCheckCard.test.tsx
 * @description The glance after a take (TASK-410): what it shows, Keep and
 *              Discard, the 8 s auto-hide that a pointer holds, and Discard
 *              pre-focused — never pressed — on a short or motionless take.
 * @feature datacollection
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QuickCheckCard, QUICK_CHECK_VISIBLE_MS } from '../QuickCheckCard';
import type { QuickCheck } from '../../../types/datacollection.types';

vi.mock('../../../api/datacollectionApi', () => ({
  datacollectionApi: { fetchThumbnail: vi.fn().mockResolvedValue(new Blob(['x'], { type: 'image/jpeg' })) },
}));

function qc(over: Partial<QuickCheck> = {}): QuickCheck {
  return {
    take: 4, frames: 707, durationS: 23.42, droppedFrames: 0, fpsActual: 30.2,
    jointsMoved: [
      { name: 'waist_yaw_joint', rangeRad: 0.1 },
      { name: 'left_elbow_joint', rangeRad: 0.9 },
      { name: 'left_shoulder_pitch_joint', rangeRad: 1.2 },
      { name: 'left_wrist_roll_joint', rangeRad: 0.4 },
      { name: 'left_hand_thumb_0_joint', rangeRad: 0.3 },
      { name: 'left_wrist_pitch_joint', rangeRad: 0.05 },
    ],
    groupsMoved: ['left_arm', 'left_hand', 'waist'],
    warnings: [],
    thumbnailUrl: '/api/teleoperation/sessions/s1/episodes/4/thumbnail',
    stopReason: 'operator',
    discarded: false,
    ...over,
  };
}

afterEach(() => vi.useRealTimers());

describe('QuickCheckCard', () => {
  it('shows the take 1-based, its length, frames, rate, moved parts and the top five joints', async () => {
    URL.createObjectURL = vi.fn(() => 'blob:thumb');
    render(<QuickCheckCard sessionId="s1" quickCheck={qc()} onKeep={vi.fn()} onDiscard={vi.fn()} />);
    expect(screen.getByTestId('quick-check-title')).toHaveTextContent('Take 5');
    expect(screen.getByTestId('quick-check-stats')).toHaveTextContent('23.4 s · 707 frames · 30 fps');
    expect(screen.getByTestId('quick-check-groups')).toHaveTextContent('L arm');
    expect(screen.getByTestId('quick-check-groups')).toHaveTextContent('L hand');
    expect(screen.getByTestId('quick-check-groups')).toHaveTextContent('Waist');
    const joints = screen.getByTestId('quick-check-joints').querySelectorAll('li');
    expect(joints).toHaveLength(5);
    expect(joints[0]).toHaveTextContent('left shoulder pitch');
    expect(screen.queryByText(/wrist pitch/)).toBeNull();
    await waitFor(() => expect(screen.getByAltText('Take 5 thumbnail')).toHaveAttribute('src', 'blob:thumb'));
  });

  it('says "No thumbnail" when the take has none', () => {
    render(<QuickCheckCard sessionId="s1" quickCheck={qc({ thumbnailUrl: null })} onKeep={vi.fn()} onDiscard={vi.fn()} />);
    expect(screen.getByTestId('take-thumbnail-4')).toHaveAttribute('data-state', 'none');
    expect(screen.getByText('No thumbnail')).toBeInTheDocument();
  });

  it('Keep dismisses; Discard discards that take', () => {
    const onKeep = vi.fn();
    const onDiscard = vi.fn();
    render(<QuickCheckCard sessionId="s1" quickCheck={qc()} onKeep={onKeep} onDiscard={onDiscard} />);
    fireEvent.click(screen.getByTestId('quick-check-discard'));
    expect(onDiscard).toHaveBeenCalledWith(4);
    fireEvent.click(screen.getByTestId('quick-check-keep'));
    expect(onKeep).toHaveBeenCalledTimes(1);
  });

  it('keeps by default: Discard is not focused on a good take', () => {
    render(<QuickCheckCard sessionId="s1" quickCheck={qc()} onKeep={vi.fn()} onDiscard={vi.fn()} />);
    expect(screen.getByTestId('quick-check-discard')).not.toHaveFocus();
  });

  it.each(['no_motion', 'short'])('pre-focuses Discard on a %s take, and never discards by itself', (warning) => {
    vi.useFakeTimers();
    const onDiscard = vi.fn();
    const onKeep = vi.fn();
    render(<QuickCheckCard sessionId="s1" quickCheck={qc({ warnings: [warning] })} onKeep={onKeep} onDiscard={onDiscard} visibleMs={QUICK_CHECK_VISIBLE_MS} />);
    expect(screen.getByTestId('quick-check-discard')).toHaveFocus();
    expect(screen.getByTestId(`quick-check-warning-${warning}`)).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(QUICK_CHECK_VISIBLE_MS); });
    expect(onDiscard).not.toHaveBeenCalled();
    expect(onKeep).toHaveBeenCalledTimes(1);
  });

  it('stays by default until Keep or the next Start, like the headset board (TASK-418 D3)', () => {
    vi.useFakeTimers();
    const onKeep = vi.fn();
    render(<QuickCheckCard sessionId="s1" quickCheck={qc()} onKeep={onKeep} onDiscard={vi.fn()} />);
    act(() => { vi.advanceTimersByTime(60_000); });
    expect(onKeep).not.toHaveBeenCalled();
    expect(screen.getByTestId('quick-check')).toBeInTheDocument();
  });

  it('with an opt-in auto-hide, hides itself after it, unless the pointer is on it', () => {
    vi.useFakeTimers();
    const onKeep = vi.fn();
    render(<QuickCheckCard sessionId="s1" quickCheck={qc()} onKeep={onKeep} onDiscard={vi.fn()} visibleMs={QUICK_CHECK_VISIBLE_MS} />);
    fireEvent.mouseEnter(screen.getByTestId('quick-check'));
    act(() => { vi.advanceTimersByTime(QUICK_CHECK_VISIBLE_MS * 2); });
    expect(onKeep).not.toHaveBeenCalled();
    fireEvent.mouseLeave(screen.getByTestId('quick-check'));
    act(() => { vi.advanceTimersByTime(QUICK_CHECK_VISIBLE_MS); });
    expect(onKeep).toHaveBeenCalledTimes(1);
  });

  it('says a take the E-stop aborted was discarded and offers only Dismiss (TASK-416)', () => {
    const onKeep = vi.fn();
    render(<QuickCheckCard sessionId="s1" quickCheck={qc({ take: 10, frames: 0, stopReason: 'estop', discarded: true, warnings: ['short'] })} onKeep={onKeep} onDiscard={vi.fn()} />);
    expect(screen.getByTestId('quick-check-verdict')).toHaveTextContent('Take 11 stopped by the E-stop — discarded');
    expect(screen.queryByTestId('quick-check-discard')).toBeNull();
    // The thrown-away frames' numbers and warnings are not shown.
    expect(screen.queryByTestId('quick-check-stats')).toBeNull();
    expect(screen.queryByTestId('quick-check-warning-short')).toBeNull();
    fireEvent.click(screen.getByTestId('quick-check-keep'));
    expect(screen.getByTestId('quick-check-keep')).toHaveTextContent('Dismiss');
    expect(onKeep).toHaveBeenCalledTimes(1);
  });
});

describe('QuickCheckCard dock variant (TASK-428)', () => {
  it('shows the take, when and by whom, its numbers and groups; Top 5 joints is a disclosure', async () => {
    render(<QuickCheckCard variant="dock" sessionId="s1" quickCheck={qc()} by="by Anna" onKeep={vi.fn()} onDiscard={vi.fn()} />);
    const card = screen.getByTestId('quick-check');
    expect(card).toHaveAttribute('data-variant', 'dock');
    expect(screen.getByTestId('quick-check-title')).toHaveTextContent('Take 5');
    expect(card).toHaveTextContent('just now, by Anna');
    expect(screen.getByTestId('quick-check-stats')).toHaveTextContent('23.4 s707 frames30 fps');
    expect(screen.getByTestId('quick-check-groups')).toHaveTextContent('L arm');
    expect(await screen.findByTestId('take-thumbnail-4')).toBeInTheDocument();
    expect(screen.queryByTestId('quick-check-joints')).toBeNull();
    fireEvent.click(screen.getByTestId('quick-check-joints-toggle'));
    expect(screen.getByTestId('quick-check-joints').querySelectorAll('li')).toHaveLength(5);
  });

  it('Keep (ghost) dismisses; Discard (secondary) discards that take; no fill on either', () => {
    const onKeep = vi.fn();
    const onDiscard = vi.fn();
    render(<QuickCheckCard variant="dock" sessionId="s1" quickCheck={qc()} onKeep={onKeep} onDiscard={onDiscard} />);
    const keep = screen.getByTestId('quick-check-keep');
    const discard = screen.getByTestId('quick-check-discard');
    expect(keep.className).not.toMatch(/(^| )bg-primary( |$)/);
    expect(discard.className).not.toMatch(/bg-stop/);
    fireEvent.click(keep);
    expect(onKeep).toHaveBeenCalledTimes(1);
    fireEvent.click(discard);
    expect(onDiscard).toHaveBeenCalledWith(4);
  });

  it('turns red and focuses Discard on a take worth discarding, without the E-STOP red fill', () => {
    render(<QuickCheckCard variant="dock" sessionId="s1" quickCheck={qc({ warnings: ['short'] })} onKeep={vi.fn()} onDiscard={vi.fn()} />);
    expect(screen.getByTestId('quick-check').className).toContain('border-signal-stopped/40');
    const discard = screen.getByTestId('quick-check-discard');
    expect(discard).toHaveFocus();
    expect(discard.className).not.toMatch(/bg-stop/);
  });

  it('keeps the E-stop verdict and offers only Dismiss', () => {
    const onKeep = vi.fn();
    render(<QuickCheckCard variant="dock" sessionId="s1" quickCheck={qc({ take: 10, frames: 0, stopReason: 'estop', discarded: true })} onKeep={onKeep} onDiscard={vi.fn()} />);
    expect(screen.getByTestId('quick-check-verdict')).toHaveTextContent('Take 11 stopped by the E-stop — discarded');
    expect(screen.queryByTestId('quick-check-discard')).toBeNull();
    expect(screen.queryByTestId('quick-check-stats')).toBeNull();
    fireEvent.click(screen.getByTestId('quick-check-keep'));
    expect(screen.getByTestId('quick-check-keep')).toHaveTextContent('Dismiss');
    expect(onKeep).toHaveBeenCalledTimes(1);
  });
});
