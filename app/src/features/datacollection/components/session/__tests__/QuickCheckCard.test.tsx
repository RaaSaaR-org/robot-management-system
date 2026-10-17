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
    render(<QuickCheckCard sessionId="s1" quickCheck={qc({ warnings: [warning] })} onKeep={onKeep} onDiscard={onDiscard} />);
    expect(screen.getByTestId('quick-check-discard')).toHaveFocus();
    expect(screen.getByTestId(`quick-check-warning-${warning}`)).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(QUICK_CHECK_VISIBLE_MS); });
    expect(onDiscard).not.toHaveBeenCalled();
    expect(onKeep).toHaveBeenCalledTimes(1);
  });

  it('hides itself after 8 s, unless the pointer is on it', () => {
    vi.useFakeTimers();
    const onKeep = vi.fn();
    render(<QuickCheckCard sessionId="s1" quickCheck={qc()} onKeep={onKeep} onDiscard={vi.fn()} />);
    fireEvent.mouseEnter(screen.getByTestId('quick-check'));
    act(() => { vi.advanceTimersByTime(QUICK_CHECK_VISIBLE_MS * 2); });
    expect(onKeep).not.toHaveBeenCalled();
    fireEvent.mouseLeave(screen.getByTestId('quick-check'));
    act(() => { vi.advanceTimersByTime(QUICK_CHECK_VISIBLE_MS); });
    expect(onKeep).toHaveBeenCalledTimes(1);
  });
});
