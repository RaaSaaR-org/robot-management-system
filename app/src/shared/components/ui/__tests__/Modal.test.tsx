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
