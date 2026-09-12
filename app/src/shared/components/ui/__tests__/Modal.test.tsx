/**
 * @file Modal.test.tsx
 * @description Tests for Modal: labelling, focus trap, Escape, focus return, scroll lock
 * @feature shared
 */

import { describe, it, expect, vi } from 'vitest';
import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Modal } from '../Modal';
import { Button } from '../Button';

function Harness({ onClose }: { onClose?: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>Open</Button>
      <Modal
        isOpen={open}
        onClose={() => {
          onClose?.();
          setOpen(false);
        }}
        title="Edit robot"
        description="Changes apply immediately."
        footer={<Button onClick={() => setOpen(false)}>Save</Button>}
      >
        <input aria-label="Name" />
      </Modal>
    </>
  );
}

describe('Modal', () => {
  it('is a labelled, described modal dialog', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Open' }));
    const dialog = screen.getByRole('dialog', { name: 'Edit robot' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAccessibleDescription('Changes apply immediately.');
  });

  it('focuses the first field and keeps Tab inside the dialog', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Open' }));
    const name = screen.getByLabelText('Name');
    const close = screen.getByRole('button', { name: 'Close dialog' });
    const save = screen.getByRole('button', { name: 'Save' });
    expect(name).toHaveFocus();

    await user.tab();
    expect(save).toHaveFocus();
    await user.tab();
    expect(close).toHaveFocus(); // wrapped to the first focusable
    await user.tab({ shift: true });
    expect(save).toHaveFocus(); // wrapped back to the last
  });

  it('closes on Escape and returns focus to the opener', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    const opener = screen.getByRole('button', { name: 'Open' });
    await user.click(opener);
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledOnce();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });

  it('locks body scroll while open', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Open' }));
    expect(document.body.style.overflow).toBe('hidden');
    await user.keyboard('{Escape}');
    expect(document.body.style.overflow).toBe('');
  });

  it('prevents the page reload before calling onSubmit', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(
      <Modal isOpen onClose={() => {}} title="Rename" onSubmit={onSubmit} footer={<Button type="submit">Save</Button>}>
        <input aria-label="Name" />
      </Modal>,
    );
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSubmit).toHaveBeenCalledOnce();
    expect(onSubmit.mock.calls[0][0].defaultPrevented).toBe(true);
    await user.type(screen.getByLabelText('Name'), 'x{Enter}');
    expect(onSubmit).toHaveBeenCalledTimes(2);
    expect(onSubmit.mock.calls[1][0].defaultPrevented).toBe(true);
  });

  it('puts testId on the dialog panel', () => {
    render(<Modal isOpen onClose={() => {}} title="Details" testId="details-dialog" />);
    expect(screen.getByTestId('details-dialog')).toBe(screen.getByRole('dialog', { name: 'Details' }));
  });

  it('only the top dialog reacts to Escape', async () => {
    const user = userEvent.setup();
    const outerClose = vi.fn();
    const innerClose = vi.fn();
    render(
      <Modal isOpen onClose={outerClose} title="Outer">
        <Modal isOpen onClose={innerClose} title="Inner">
          <button>Inside</button>
        </Modal>
      </Modal>,
    );
    await user.keyboard('{Escape}');
    expect(innerClose).toHaveBeenCalledOnce();
    expect(outerClose).not.toHaveBeenCalled();
  });
});
