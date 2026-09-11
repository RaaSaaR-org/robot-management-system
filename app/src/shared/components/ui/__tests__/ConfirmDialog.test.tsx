/**
 * @file ConfirmDialog.test.tsx
 * @description Tests for ConfirmDialog, ConfirmHost and the imperative confirm()
 * @feature shared
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfirmDialog, ConfirmHost } from '../ConfirmDialog';
import { confirm } from '../confirm';

describe('ConfirmDialog', () => {
  it('renders an alertdialog with title and description', () => {
    render(
      <ConfirmDialog isOpen onClose={() => {}} onConfirm={() => {}} title="Delete Dock A?" description="Runs stop." tone="danger" />,
    );
    const dialog = screen.getByRole('alertdialog', { name: 'Delete Dock A?' });
    expect(dialog).toHaveAccessibleDescription('Runs stop.');
  });

  it('labels the confirm button Delete for danger and Confirm otherwise', () => {
    const { rerender } = render(
      <ConfirmDialog isOpen onClose={() => {}} onConfirm={() => {}} title="Delete?" tone="danger" />,
    );
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument();
    rerender(<ConfirmDialog isOpen onClose={() => {}} onConfirm={() => {}} title="Proceed?" />);
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeInTheDocument();
  });

  it('calls onConfirm when confirmed', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    render(<ConfirmDialog isOpen onClose={onClose} onConfirm={onConfirm} title="Delete?" tone="danger" />);
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    expect(onConfirm).toHaveBeenCalledOnce();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('calls onClose on Cancel', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    render(<ConfirmDialog isOpen onClose={onClose} onConfirm={onConfirm} title="Delete?" tone="danger" />);
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledOnce();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('calls onClose on Escape', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<ConfirmDialog isOpen onClose={onClose} onConfirm={() => {}} title="Delete?" tone="danger" />);
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('starts focus on Cancel for danger confirmations', () => {
    render(<ConfirmDialog isOpen onClose={() => {}} onConfirm={() => {}} title="Delete?" tone="danger" />);
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
  });

  it('shows loading while an async onConfirm is pending', async () => {
    const user = userEvent.setup();
    let resolve: () => void = () => {};
    const onConfirm = vi.fn(() => new Promise<void>((r) => (resolve = r)));
    render(<ConfirmDialog isOpen onClose={() => {}} onConfirm={onConfirm} title="Delete?" tone="danger" />);
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    expect(screen.getByRole('button', { name: /loading/i })).toBeDisabled();
    await act(async () => resolve());
    expect(screen.getByRole('button', { name: 'Delete' })).toBeEnabled();
  });
});

describe('confirm()', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('resolves true when the user confirms', async () => {
    const user = userEvent.setup();
    render(<ConfirmHost />);
    let result: Promise<boolean> = Promise.resolve(false);
    act(() => {
      result = confirm({ title: 'Delete route?', description: 'Runs stop.', tone: 'danger' });
    });
    const dialog = await screen.findByRole('alertdialog', { name: 'Delete route?' });
    expect(dialog).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    await expect(result).resolves.toBe(true);
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
  });

  it('resolves false on Cancel and on Escape', async () => {
    const user = userEvent.setup();
    render(<ConfirmHost />);

    let first: Promise<boolean> = Promise.resolve(true);
    act(() => {
      first = confirm({ title: 'First?', confirmLabel: 'Go' });
    });
    await screen.findByRole('alertdialog', { name: 'First?' });
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await expect(first).resolves.toBe(false);

    let second: Promise<boolean> = Promise.resolve(true);
    act(() => {
      second = confirm({ title: 'Second?' });
    });
    await screen.findByRole('alertdialog', { name: 'Second?' });
    await user.keyboard('{Escape}');
    await expect(second).resolves.toBe(false);
  });

  it('shows queued requests one after another', async () => {
    const user = userEvent.setup();
    render(<ConfirmHost />);
    let a: Promise<boolean> = Promise.resolve(false);
    let b: Promise<boolean> = Promise.resolve(false);
    act(() => {
      a = confirm({ title: 'A?' });
      b = confirm({ title: 'B?' });
    });
    await screen.findByRole('alertdialog', { name: 'A?' });
    await user.click(screen.getByRole('button', { name: 'Confirm' }));
    await expect(a).resolves.toBe(true);
    await screen.findByRole('alertdialog', { name: 'B?' });
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await expect(b).resolves.toBe(false);
  });

  it('renders once even when two hosts are mounted', async () => {
    render(
      <>
        <ConfirmHost />
        <ConfirmHost />
      </>,
    );
    let result: Promise<boolean> = Promise.resolve(false);
    act(() => {
      result = confirm({ title: 'Only once?' });
    });
    await screen.findByRole('alertdialog', { name: 'Only once?' });
    expect(screen.getAllByRole('alertdialog')).toHaveLength(1);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Confirm' }));
    await expect(result).resolves.toBe(true);
  });

  it('falls back to window.confirm when no host is mounted', async () => {
    const spy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    await expect(confirm({ title: 'Delete it?', description: 'Gone for good.' })).resolves.toBe(true);
    expect(spy).toHaveBeenCalledWith('Delete it?\n\nGone for good.');
  });
});
