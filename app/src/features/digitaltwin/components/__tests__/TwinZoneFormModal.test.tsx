/**
 * @file TwinZoneFormModal.test.tsx
 * @description TASK-326: a zone name the server rejects (409 duplicate, 400 not
 *              a place id) is shown inline on the Name field, not as a
 *              form-wide error; other failures stay form-wide.
 * @feature digitaltwin
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('../../api/twinZoneApi', () => ({
  twinZoneApi: { createZone: vi.fn(), updateZone: vi.fn(), listZones: vi.fn(), deleteZone: vi.fn() },
}));

import { twinZoneApi } from '../../api/twinZoneApi';
import { useTwinZoneStore } from '../../store/twinZoneStore';
import { TwinZoneFormModal } from '../TwinZoneFormModal';

const POLYGON = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
];

function openCreateModal() {
  useTwinZoneStore.setState({
    twinId: 'twin-1',
    showFormModal: true,
    pendingPolygon: POLYGON,
    editingZone: null,
    isLoading: false,
    error: null,
    errorStatus: null,
  });
  render(<TwinZoneFormModal twinId="twin-1" />);
}

async function submitName(name: string) {
  const input = screen.getByRole('textbox', { name: /^Name/ });
  fireEvent.change(input, { target: { value: name } });
  fireEvent.click(screen.getByRole('button', { name: 'Create zone' }));
  return input;
}

describe('TwinZoneFormModal', () => {
  beforeEach(() => {
    vi.mocked(twinZoneApi.createZone).mockReset();
  });

  it('shows a duplicate-name 409 on the Name field', async () => {
    const message = 'A zone named "aisle-1" already exists in this twin';
    vi.mocked(twinZoneApi.createZone).mockRejectedValue({ message, statusCode: 409 });
    openCreateModal();

    const input = await submitName('aisle-1');

    await waitFor(() => expect(input).toHaveAttribute('aria-invalid', 'true'));
    const alert = screen.getByText(message);
    expect(input.getAttribute('aria-describedby')).toContain(alert.id);
  });

  it('shows an unsafe-name 400 on the Name field', async () => {
    const message = 'Zone name "Aisle 1 / north" is not a valid place id';
    vi.mocked(twinZoneApi.createZone).mockRejectedValue({ message, statusCode: 400 });
    openCreateModal();

    const input = await submitName('Aisle 1 / north');

    await waitFor(() => expect(input).toHaveAttribute('aria-invalid', 'true'));
    expect(screen.getByText(message)).toBeInTheDocument();
  });

  it('keeps other failures form-wide, off the Name field', async () => {
    vi.mocked(twinZoneApi.createZone).mockRejectedValue({ message: 'Server exploded', statusCode: 500 });
    openCreateModal();

    const input = await submitName('aisle-3');

    await waitFor(() => expect(screen.getByText('Server exploded')).toBeInTheDocument());
    expect(input).not.toHaveAttribute('aria-invalid', 'true');
  });
});
