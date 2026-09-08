/**
 * @file ZonePermissions.test.tsx
 * @description Zone readers retain selection while only managers can open editing controls.
 * @feature fleet
 */
import { beforeEach, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useAuthStore } from '@/features/auth/store/authStore';
import { MOCK_USER } from '@/mocks/mockData';
import { ZoneConfigPanel } from '../ZoneConfigPanel';
import { ZoneEditor } from '../ZoneEditor';
import { useZoneStore } from '../../store/zoneStore';
import type { Zone } from '../../types/fleet.types';

const zone: Zone = { id: 'zone-1', name: 'Hall', floor: '1', type: 'operational', bounds: { x: 0, y: 0, width: 10, height: 10 }, createdAt: 'x', updatedAt: 'x' };

beforeEach(() => {
  useZoneStore.setState({ zones: [zone], currentFloor: '1', selectedZoneId: null, editorMode: 'view', showFormModal: false, fetchZones: vi.fn().mockResolvedValue(undefined) });
});

it.each(['viewer', 'member'] as const)('%s can select zones but cannot create, edit, delete or draw', (role) => {
  useAuthStore.setState({ user: { ...MOCK_USER, role } });
  render(<ZoneConfigPanel />);
  for (const name of ['Add Zone', 'Draw zone', 'Edit zone', 'Delete zone']) {
    const button = screen.getByRole('button', { name });
    expect(button).toBeDisabled();
    fireEvent.click(button);
  }
  fireEvent.click(screen.getByText('Hall'));
  expect(useZoneStore.getState().selectedZoneId).toBe(zone.id);
  expect(useZoneStore.getState().showFormModal).toBe(false);
  expect(useZoneStore.getState().editorMode).toBe('view');
});

it('an owner can create a zone', () => {
  useAuthStore.setState({ user: { ...MOCK_USER, role: 'owner' } });
  render(<ZoneConfigPanel />);
  fireEvent.click(screen.getByRole('button', { name: 'Add Zone' }));
  expect(useZoneStore.getState().showFormModal).toBe(true);
});

it('ignores map edit gestures for viewers even if drawing mode was already active', () => {
  useAuthStore.setState({ user: { ...MOCK_USER, role: 'viewer' } });
  useZoneStore.setState({ editorMode: 'draw' });
  const onEdit = vi.fn();
  const onDraw = vi.fn();
  const { container } = render(<svg><ZoneEditor zones={[zone]} scale={1} offset={{ x: 0, y: 0 }} selectedZoneId={null} onSelectZone={vi.fn()} onEditZone={onEdit} onZoneDrawn={onDraw} /></svg>);
  fireEvent.doubleClick(screen.getByText('Hall'));
  const layer = container.querySelector('svg > g')!;
  fireEvent.mouseDown(layer, { clientX: 10, clientY: 10 });
  fireEvent.mouseMove(layer, { clientX: 30, clientY: 30 });
  fireEvent.mouseUp(layer);
  expect(onEdit).not.toHaveBeenCalled();
  expect(onDraw).not.toHaveBeenCalled();
});
