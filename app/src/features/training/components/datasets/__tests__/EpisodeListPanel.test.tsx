/**
 * @file EpisodeListPanel.test.tsx
 * @description The episode list keeps the selected row in sight (TASK-501):
 *              it scrolls itself just far enough, and never for a row already
 *              in view.
 * @feature training
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EpisodeListPanel, type EpisodeListPanelProps } from '../EpisodeListPanel';
import type { EpisodeMeta } from '../../../types';

const ROW_PX = 50;
let BOX_PX = 200;

const EPISODES: EpisodeMeta[] = Array.from({ length: 40 }, (_, index) => ({
  index,
  frameCount: 100,
  durationSeconds: 3.3,
  flagged: false,
}));

function props(overrides: Partial<EpisodeListPanelProps> = {}): EpisodeListPanelProps {
  return {
    episodes: EPISODES,
    isLoading: false,
    selected: 0,
    onSelect: vi.fn(),
    checked: [],
    onToggleChecked: vi.fn(),
    onSetChecked: vi.fn(),
    flagged: {},
    onToggleFlag: vi.fn(),
    scores: {},
    onCreateView: vi.fn(),
    ...overrides,
  };
}

/**
 * jsdom lays nothing out, so the boxes are given: a 200 px list whose rows are
 * 50 px each, placed by the list's own `scrollTop`.
 */
function layOut() {
  const rect = (top: number, height: number) =>
    ({ top, bottom: top + height, height, left: 0, right: 0, width: 0, x: 0, y: top, toJSON: () => ({}) }) as DOMRect;
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    if (this.dataset.testid === 'episode-list-scroll') return rect(100, BOX_PX);
    if (this.tagName === 'LI') {
      const box = this.closest<HTMLElement>('[data-testid="episode-list-scroll"]')!;
      const position = Array.from(this.parentElement!.children).indexOf(this);
      return rect(100 + position * ROW_PX - box.scrollTop, ROW_PX);
    }
    return rect(0, 0);
  });
}

const scroller = () => screen.getByTestId('episode-list-scroll');

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  BOX_PX = 200;
});

describe('the selected row of the episode list', () => {
  it('is scrolled into view when the page opens on an episode far down', () => {
    layOut();
    render(<EpisodeListPanel {...props({ selected: 30 })} />);
    // Row 30 ends at 1550 px; the list shows 200 px: its bottom edge meets the list's.
    expect(scroller().scrollTop).toBe(31 * ROW_PX - BOX_PX);
  });

  it('is scrolled back up to when it lies above what is shown', () => {
    layOut();
    const { rerender } = render(<EpisodeListPanel {...props({ selected: 30 })} />);
    rerender(<EpisodeListPanel {...props({ selected: 2 })} />);
    expect(scroller().scrollTop).toBe(2 * ROW_PX);
  });

  it('moves nothing for a row that is already in view', () => {
    layOut();
    const { rerender } = render(<EpisodeListPanel {...props({ selected: 0 })} />);
    scroller().scrollTop = 20;
    rerender(<EpisodeListPanel {...props({ selected: 2 })} />);
    expect(scroller().scrollTop).toBe(20);
  });

  it('waits for the list: nothing is scrolled while it loads', () => {
    layOut();
    const { rerender } = render(<EpisodeListPanel {...props({ episodes: [], isLoading: true, selected: null })} />);
    expect(scroller().scrollTop).toBe(0);
    rerender(<EpisodeListPanel {...props({ selected: 30 })} />);
    expect(scroller().scrollTop).toBe(31 * ROW_PX - BOX_PX);
  });

  it('is kept in view when the list gets shorter after it was scrolled to', () => {
    // the stage, and the list with it, shrinks when the page header arrives late and wraps
    const resized: Array<() => void> = [];
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: () => void) { resized.push(callback); }
      observe() {}
      disconnect() {}
    });
    layOut();
    render(<EpisodeListPanel {...props({ selected: 30 })} />);
    expect(scroller().scrollTop).toBe(31 * ROW_PX - 200);

    BOX_PX = 150;
    resized.forEach((notify) => notify());
    expect(scroller().scrollTop).toBe(31 * ROW_PX - 150);
  });
});
