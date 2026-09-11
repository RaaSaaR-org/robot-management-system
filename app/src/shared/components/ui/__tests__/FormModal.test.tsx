/**
 * @file FormModal.test.tsx
 * @description Tests for FormModal submit, cancel, error and submitting states
 * @feature shared
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FormModal } from '../FormModal';
import { FormField } from '../FormField';
import { Input } from '../Input';

function renderForm(props: Partial<Parameters<typeof FormModal>[0]> = {}) {
  const onSubmit = vi.fn();
  const onClose = vi.fn();
  render(
    <FormModal isOpen onClose={onClose} onSubmit={onSubmit} title="New route" submitLabel="Create route" {...props}>
      <FormField label="Name">
        <Input defaultValue="" />
      </FormField>
    </FormModal>,
  );
  return { onSubmit: (props.onSubmit as typeof onSubmit) ?? onSubmit, onClose };
}

describe('FormModal', () => {
  it('renders a titled dialog containing a form and focuses the first field', () => {
    renderForm();
    const dialog = screen.getByRole('dialog', { name: 'New route' });
    expect(dialog.tagName).toBe('FORM');
    expect(screen.getByLabelText('Name')).toHaveFocus();
  });

  it('submits via the submit button', async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderForm();
    await user.click(screen.getByRole('button', { name: 'Create route' }));
    expect(onSubmit).toHaveBeenCalledOnce();
    expect(onSubmit.mock.calls[0][0].defaultPrevented).toBe(true);
  });

  it('submits on Enter in a field', async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderForm();
    await user.type(screen.getByLabelText('Name'), 'Dock A{Enter}');
    expect(onSubmit).toHaveBeenCalledOnce();
  });

  it('closes on Cancel without submitting', async () => {
    const user = userEvent.setup();
    const { onSubmit, onClose } = renderForm();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledOnce();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('shows a form-level error', () => {
    renderForm({ error: "Couldn't create route: name taken" });
    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't create route: name taken");
  });

  it('disables the fields and the buttons while submitting, and ignores Escape', async () => {
    const user = userEvent.setup();
    const { onSubmit, onClose } = renderForm({ isSubmitting: true, submittingLabel: 'Creating…' });
    expect(screen.getByLabelText('Name')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Creating…/ })).toBeDisabled();
    await user.keyboard('{Escape}');
    expect(onClose).not.toHaveBeenCalled();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('puts submitTestId and cancelTestId on the footer buttons', () => {
    renderForm({ submitTestId: 'route-submit', cancelTestId: 'route-cancel' });
    expect(screen.getByTestId('route-submit')).toBe(screen.getByRole('button', { name: 'Create route' }));
    expect(screen.getByTestId('route-cancel')).toBe(screen.getByRole('button', { name: 'Cancel' }));
  });

  it('does not submit when submitDisabled', async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderForm({ submitDisabled: true });
    await user.type(screen.getByLabelText('Name'), 'x{Enter}');
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Create route' })).toBeDisabled();
  });
});
