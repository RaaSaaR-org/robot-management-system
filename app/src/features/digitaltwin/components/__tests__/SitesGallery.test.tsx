/**
 * @file SitesGallery.test.tsx
 * @description The Sites tab of Fleet keeps every view the standalone Digital
 *              Twin page had: the search, the five status filters, the card grid
 *              with a building room's live progress, and the empty state that
 *              offers "New scan" a second time.
 * @feature digitaltwin
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// The gallery's plumbing stays out of the test: the REST client (the store's
// fetch and the occupancy thumbnail), the robot list, and the twin WebSocket.
vi.mock('../../api/twinApi', () => ({
  twinApi: { listTwins: vi.fn(), getOccupancyPgm: vi.fn() },
}));
vi.mock('../../hooks/useScanCapableRobots', () => ({
  useScanCapableRobots: () => ({ robots: [], isLoading: false }),
}));
vi.mock('../../hooks/useTwinEvents', () => ({
  useTwinEvents: () => ({ isConnected: false }),
}));

import { twinApi } from '../../api/twinApi';
import { useTwinStore } from '../../store/twinStore';
import { SitesGallery } from '../SitesGallery';
import type { DigitalTwinDTO, TwinStatus } from '../../types/twin.types';

const twin = (id: string, name: string, status: TwinStatus): DigitalTwinDTO => ({
  id,
  name,
  robotId: 'g1-001',
  floor: '1',
  status,
  version: 1,
  worldOrigin: { x: 0, y: 0, z: 0 },
  resolution: 0.05,
  bounds: { minX: 0, minY: 0, minZ: 0, maxX: 8, maxY: 5, maxZ: 3 },
  pointCount: 1000,
  hasCloud: true,
  hasMesh: false,
  // No grid: the thumbnail then needs no fetch and no canvas.
  hasOccupancy: false,
  hasSimScene: false,
  createdAt: '2026-09-01T10:00:00.000Z',
  updatedAt: '2026-09-01T10:00:00.000Z',
});

const TWINS = [
  twin('t-ready', 'Warehouse aisle', 'ready'),
  twin('t-building', 'Loading dock', 'processing'),
  twin('t-empty', 'Office corridor', 'draft'),
];

function renderGallery(onNewScanOpenChange = vi.fn()) {
  render(
    <MemoryRouter>
      <SitesGallery newScanOpen={false} onNewScanOpenChange={onNewScanOpenChange} />
    </MemoryRouter>,
  );
  return { onNewScanOpenChange };
}

const statusFilter = () => screen.getByRole('combobox', { name: 'Status' });
const cardNames = () =>
  screen.queryAllByTestId('site-card').map((card) => card.querySelector('h3')?.textContent);

beforeEach(() => {
  vi.clearAllMocks();
  // The mount refetch resolves to the same rooms, so it cannot race the state
  // the test seeded.
  vi.mocked(twinApi.listTwins).mockResolvedValue(TWINS);
  useTwinStore.setState({ twins: TWINS, isLoading: false, error: null });
});

describe('SitesGallery', () => {
  it('renders a card per scanned room, and no page header of its own', () => {
    renderGallery();
    expect(cardNames()).toEqual(['Warehouse aisle', 'Loading dock', 'Office corridor']);
    // FleetPage owns the header — the tab body must not draw a second one.
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull();
  });

  it('offers the five status filters behind "All statuses"', () => {
    renderGallery();
    expect(Array.from(statusFilter().querySelectorAll('option')).map((o) => o.textContent)).toEqual([
      'All statuses',
      'Empty',
      'Scanning',
      'Building',
      'Scanned',
      'Failed',
    ]);
  });

  it('filters the grid down to the scanned rooms', () => {
    renderGallery();
    fireEvent.change(statusFilter(), { target: { value: 'ready' } });
    expect(cardNames()).toEqual(['Warehouse aisle']);
  });

  it('searches by room name', () => {
    renderGallery();
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search sites' }), {
      target: { value: 'dock' },
    });
    expect(cardNames()).toEqual(['Loading dock']);
  });

  it('shows the live build progress of a room that is still building', () => {
    renderGallery();
    expect(screen.getByRole('progressbar', { name: 'Building' })).toBeInTheDocument();
  });

  // The mount fetch owns `isLoading` and `error`, so both of these wait for it
  // to settle rather than seeding a state the fetch would immediately overwrite.
  it('offers "New scan" from the empty state, through the parent', async () => {
    useTwinStore.setState({ twins: [], isLoading: false, error: null });
    vi.mocked(twinApi.listTwins).mockResolvedValue([]);
    const { onNewScanOpenChange } = renderGallery();

    expect(await screen.findByText('No sites yet')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'New scan' }));
    expect(onNewScanOpenChange).toHaveBeenCalledWith(true);
  });

  it('shows the error state with a retry when the sites cannot be loaded', async () => {
    useTwinStore.setState({ twins: [], isLoading: false, error: null });
    vi.mocked(twinApi.listTwins).mockRejectedValue(new Error('Network down'));
    renderGallery();

    expect(await screen.findByText("Couldn't load sites")).toBeInTheDocument();
    expect(screen.getByText('Network down')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /retry|try again/i })).toBeInTheDocument();
  });
});
