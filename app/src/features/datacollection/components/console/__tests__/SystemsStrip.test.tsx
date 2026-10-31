/**
 * @file SystemsStrip.test.tsx
 * @description The Record console's systems strip (TASK-428): one button per
 *              cell with its status, the value's own test id (the lease holder,
 *              the headset's why line), a popover with that cell's body that
 *              opens on a click and closes on Escape or a second click, every
 *              body kept mounted while hidden, and the phone's summary of the
 *              worst cell.
 * @feature datacollection
 */

import { describe, it, expect } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { SystemsStrip, worstCell, type StripCell } from '../SystemsStrip';

const cells: StripCell[] = [
  { id: 'robot', label: 'Robot side', value: 'Running', status: 'ok', reason: null },
  { id: 'control', label: 'Control', value: 'Anna', status: 'ok', reason: null, valueTestId: 'control-lease-holder' },
  { id: 'mode', label: 'Mode', value: 'Stand', status: 'warn', reason: null },
  { id: 'hands', label: 'Hands', value: 'Right lost', status: 'fail', reason: null },
];

const body = (c: StripCell) => <button type="button" data-testid={`body-${c.id}`}>{c.label} body</button>;

describe('SystemsStrip', () => {
  it('draws one cell per system with its status and value ids', () => {
    render(<SystemsStrip cells={cells} renderBody={body} />);
    expect(screen.getByTestId('systems-cell-mode')).toHaveAttribute('data-status', 'warn');
    expect(screen.getByTestId('systems-cell-hands')).toHaveAttribute('data-status', 'fail');
    expect(screen.getByTestId('control-lease-holder')).toHaveTextContent('Anna');
    expect(screen.getByTestId('systems-cell-hands').className).toContain('text-signal-stopped');
  });

  it("opens a cell's body in a popover, keeps the others mounted and hidden, and closes on Escape", () => {
    render(<SystemsStrip cells={cells} renderBody={body} />);
    const pop = screen.getByTestId('systems-popover');
    expect(pop).not.toBeVisible();
    // Every body is in the DOM while closed (the lease bar and the Quest controls keep their state).
    expect(screen.getByTestId('body-control')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('systems-cell-mode'));
    expect(pop).toBeVisible();
    expect(pop).toHaveAttribute('data-cell', 'mode');
    expect(screen.getByTestId('body-mode')).toBeVisible();
    expect(screen.getByTestId('body-control')).not.toBeVisible();
    expect(screen.getByTestId('systems-cell-mode')).toHaveAttribute('aria-expanded', 'true');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(pop).not.toBeVisible();
    // A second click on the open cell closes it too.
    fireEvent.click(screen.getByTestId('systems-cell-robot'));
    expect(screen.getByTestId('body-robot')).toBeVisible();
    fireEvent.click(screen.getByTestId('systems-cell-robot'));
    expect(pop).not.toBeVisible();
  });

  it("can be opened by the page (the dock's fix button)", () => {
    const { rerender } = render(<SystemsStrip cells={cells} renderBody={body} openId={null} />);
    expect(screen.getByTestId('systems-popover')).not.toBeVisible();
    rerender(<SystemsStrip cells={cells} renderBody={body} openId="robot" />);
    expect(screen.getByTestId('body-robot')).toBeVisible();
  });

  it('sums the strip up by its worst cell, for the phone', () => {
    expect(worstCell(cells)?.id).toBe('hands');
    expect(worstCell(cells.filter((c) => c.status === 'ok'))).toBeNull();
    render(<SystemsStrip cells={cells} renderBody={body} />);
    expect(screen.getByTestId('systems-summary')).toHaveTextContent('Hands: Right lost');
  });
});

describe('SystemsStrip grid (TASK-442)', () => {
  const cell = (id: StripCell['id']): StripCell => ({ id, label: id, value: 'ok', status: 'ok', reason: null });
  const grid = () => screen.getByTestId('systems-cell-robot').parentElement!;

  it('keeps seven cells at 4 + 3, one row from 1440 px', () => {
    render(<SystemsStrip cells={(['robot', 'control', 'arm_control', 'mode', 'headset', 'arms', 'hands'] as const).map(cell)} renderBody={body} />);
    expect(grid().className).toContain('grid-cols-4 min-[1440px]:grid-cols-7');
  });

  it('lays eight cells (a Cameras cell) out as 4 + 4, one row from 1440 px', () => {
    render(<SystemsStrip cells={(['robot', 'control', 'arm_control', 'mode', 'headset', 'arms', 'hands', 'cameras'] as const).map(cell)} renderBody={body} />);
    expect(grid().className).toContain('grid-cols-4 min-[1440px]:grid-cols-8');
    expect(grid().className).not.toContain('grid-cols-7');
    const cameras = screen.getByTestId('systems-cell-cameras').className;
    expect(cameras).toContain('max-[1439px]:border-t');
    expect(cameras).toContain('min-[1440px]:border-l');
    expect(screen.getByTestId('systems-cell-headset').className).toContain('min-[1440px]:border-l');
  });

  it('keeps three cells in one row, and puts four in one row', () => {
    const { unmount } = render(<SystemsStrip cells={(['robot', 'control', 'input'] as const).map(cell)} renderBody={body} />);
    expect(grid().className).toContain('grid-cols-3');
    unmount();
    render(<SystemsStrip cells={(['robot', 'control', 'input', 'cameras'] as const).map(cell)} renderBody={body} />);
    expect(grid().className).toContain('grid-cols-4');
  });
});
