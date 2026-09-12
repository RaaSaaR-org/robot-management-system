/**
 * @file kitPieces.test.tsx
 * @description Tests for the small kit pieces: test ids on menu items and stat
 *              tiles, the indeterminate ProgressBar, Panel's ref, ChoiceCard,
 *              cssColor and the focusRing export
 * @feature shared
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRef } from 'react';
import { act, render, renderHook, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  Button,
  ChoiceCard,
  ChoiceCardGroup,
  DropdownMenu,
  Panel,
  ProgressBar,
  RowActions,
  StatTile,
  cssColor,
  focusRing,
  focusRingInset,
  useCssColor,
} from '..';

describe('test ids', () => {
  it('puts testId on DropdownMenu and RowActions items', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <>
        <DropdownMenu trigger={<Button>Export</Button>} items={[{ label: 'CSV', onSelect, testId: 'export-csv' }]} />
        <RowActions label="Actions for Dock A" items={[{ label: 'Delete', onSelect, tone: 'danger', testId: 'row-delete' }]} />
      </>,
    );
    await user.click(screen.getByRole('button', { name: 'Export' }));
    await user.click(screen.getByTestId('export-csv'));
    await user.click(screen.getByRole('button', { name: 'Actions for Dock A' }));
    expect(screen.getByTestId('row-delete')).toHaveAttribute('role', 'menuitem');
    await user.click(screen.getByTestId('row-delete'));
    expect(onSelect).toHaveBeenCalledTimes(2);
  });

  it('passes data-testid through StatTile', () => {
    render(<StatTile label="Robots online" value={12} data-testid="tile-online" />);
    expect(screen.getByTestId('tile-online')).toHaveTextContent('Robots online');
  });
});

describe('ProgressBar', () => {
  it('reports a determinate value', () => {
    render(<ProgressBar value={40} label="Upload" />);
    const bar = screen.getByRole('progressbar', { name: 'Upload' });
    expect(bar).toHaveAttribute('aria-valuenow', '40');
    expect(screen.getByText('40%')).toBeInTheDocument();
  });

  it('has no value and no percentage when indeterminate', () => {
    render(<ProgressBar indeterminate label="Starting job" />);
    const bar = screen.getByRole('progressbar', { name: 'Starting job' });
    expect(bar).not.toHaveAttribute('aria-valuenow');
    expect(bar).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByText(/%$/)).not.toBeInTheDocument();
  });
});

describe('Panel', () => {
  it('forwards a ref to its element', () => {
    const ref = createRef<HTMLDivElement>();
    render(
      <Panel ref={ref} data-testid="panel">
        Body
      </Panel>,
    );
    expect(ref.current).toBe(screen.getByTestId('panel'));
  });
});

describe('ChoiceCard', () => {
  it('is a labelled group of pressed/unpressed buttons', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <ChoiceCardGroup label="Training type">
        <ChoiceCard selected title="Supervised fine-tune" description="On a dataset" onSelect={() => {}} data-testid="kind-sl" />
        <ChoiceCard selected={false} title="Sim-RL policy" onSelect={onSelect} />
      </ChoiceCardGroup>,
    );
    expect(screen.getByRole('group', { name: 'Training type' })).toBeInTheDocument();
    expect(screen.getByTestId('kind-sl')).toHaveAttribute('aria-pressed', 'true');
    const rl = screen.getByRole('button', { name: /Sim-RL policy/ });
    expect(rl).toHaveAttribute('aria-pressed', 'false');
    await user.click(rl);
    expect(onSelect).toHaveBeenCalledOnce();
  });
});

describe('cssColor', () => {
  afterEach(() => {
    document.documentElement.style.removeProperty('--test-color');
  });

  it('reads a token off the root, with a fallback when unset', () => {
    document.documentElement.style.setProperty('--test-color', 'rgb(1, 2, 3)');
    expect(cssColor('--test-color')).toBe('rgb(1, 2, 3)');
    expect(cssColor('--not-set', 'black')).toBe('black');
  });

  it('re-reads when the root changes', async () => {
    document.documentElement.style.setProperty('--test-color', 'red');
    const { result } = renderHook(() => useCssColor('--test-color'));
    expect(result.current).toBe('red');
    await act(async () => {
      document.documentElement.style.setProperty('--test-color', 'blue');
      await Promise.resolve();
    });
    expect(result.current).toBe('blue');
  });
});

describe('focusRing', () => {
  it('is exported for elements that are not kit components', () => {
    expect(focusRing).toContain('focus-visible:outline-primary');
    expect(focusRingInset).toContain('-outline-offset-2');
  });
});
