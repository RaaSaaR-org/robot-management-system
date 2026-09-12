/**
 * @file ZonePermissions.test.tsx
 * @description Zone readers keep selection and the map; only managers reach the
 *   verbs that write. The three places a zone write starts are all covered: the
 *   Zones panel's row actions, the form modal's submit, and the map gestures.
 * @feature fleet
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useAuthStore } from '@/features/auth/store/authStore';
import { MOCK_USER } from '@/mocks/mockData';
import { ZoneConfigPanel } from '../ZoneConfigPanel';
import { ZoneEditor } from '../ZoneEditor';
import { ZoneFormModal } from '../ZoneFormModal';
import { useZoneStore } from '../../store/zoneStore';
import type { Zone } from '../../types/fleet.types';

const zone: Zone = { id: 'zone-1', name: 'Hall', floor: '1', type: 'operational', bounds: { x: 0, y: 0, width: 10, height: 10 }, createdAt: 'x', updatedAt: 'x' };

beforeEach(() => {
  useZoneStore.setState({ zones: [zone], currentFloor: '1', selectedZoneId: null, editorMode: 'view', showFormModal: false, fetchZones: vi.fn().mockResolvedValue(undefined) });
});

/** Open the Zones panel's kebab for the one row and return its menu items. */
function openRowActions(): HTMLElement {
  fireEvent.click(screen.getByRole('button', { name: `Actions for ${zone.name}` }));
  return screen.getByRole('menu');
}

describe('the Zones panel', () => {
  it.each(['viewer', 'member'] as const)('lets a %s select a zone but not edit or delete it', (role) => {
    useAuthStore.setState({ user: { ...MOCK_USER, role } });
    const onEditZone = vi.fn();
    render(<ZoneConfigPanel onEditZone={onEditZone} onCreateZone={vi.fn()} />);

    const menu = openRowActions();
    for (const name of ['Edit', 'Delete']) {
      const item = screen.getByRole('menuitem', { name });
      expect(item).toBeDisabled();
      fireEvent.click(item);
    }
    expect(onEditZone).not.toHaveBeenCalled();
    expect(menu).toBeInTheDocument();

    // Reading is untouched: the row still selects the zone on the map.
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.click(screen.getByText(zone.name));
    expect(useZoneStore.getState().selectedZoneId).toBe(zone.id);
    expect(useZoneStore.getState().showFormModal).toBe(false);
    expect(useZoneStore.getState().editorMode).toBe('view');
  });

  it('lets an owner open the editor for a zone', () => {
    useAuthStore.setState({ user: { ...MOCK_USER, role: 'owner' } });
    const onEditZone = vi.fn();
    render(<ZoneConfigPanel onEditZone={onEditZone} onCreateZone={vi.fn()} />);

    openRowActions();
    const edit = screen.getByRole('menuitem', { name: 'Edit' });
    expect(edit).toBeEnabled();
    fireEvent.click(edit);
    expect(onEditZone).toHaveBeenCalledWith(zone);
  });

  it('offers no "New zone" in the empty state below an owner role', () => {
    useAuthStore.setState({ user: { ...MOCK_USER, role: 'member' } });
    useZoneStore.setState({ zones: [] });
    render(<ZoneConfigPanel onEditZone={vi.fn()} onCreateZone={vi.fn()} />);
    expect(screen.getByText('No zones on this floor')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /New zone/ })).not.toBeInTheDocument();
  });
});

describe('the zone form', () => {
  it.each(['viewer', 'member'] as const)('cannot be submitted by a %s', (role) => {
    useAuthStore.setState({ user: { ...MOCK_USER, role } });
    render(<ZoneFormModal isOpen zone={zone} currentFloor="1" onClose={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();
  });

  it('can be submitted by an owner', () => {
    useAuthStore.setState({ user: { ...MOCK_USER, role: 'owner' } });
    render(<ZoneFormModal isOpen zone={zone} currentFloor="1" onClose={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeEnabled();
  });
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
