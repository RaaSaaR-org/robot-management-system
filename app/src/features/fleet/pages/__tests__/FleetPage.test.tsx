/**
 * @file FleetPage.test.tsx
 * @description Fleet's three tabs: which body ?tab= selects, the header actions
 *              each tab brings (New scan only on Sites), that switching away
 *              from the map cancels zone drawing, and that the zone form stays
 *              mounted whatever the tab.
 * @feature fleet
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// Every tab body is stubbed: this is a test about the tab switch and the
// header, not about the map, the robot list or the twin gallery.
vi.mock('../../components/FleetMap', () => ({
  FleetMap: () => <div data-testid="fleet-map" />,
}));
vi.mock('../../components/ZoneConfigPanel', () => ({
  ZoneConfigPanel: () => <div data-testid="zone-config" />,
}));
vi.mock('../../components/ZoneFormModal', () => ({
  ZoneFormModal: ({ isOpen }: { isOpen: boolean }) => (
    <div data-testid="zone-form" data-open={isOpen} />
  ),
}));
vi.mock('@/features/robots/pages/RobotsPage', () => ({
  RobotsPage: () => <div data-testid="robots-list" />,
}));
// The stub echoes the controlled flag back, so the header button's effect on
// the gallery's "New scan" modal is observable.
vi.mock('@/features/digitaltwin/components/SitesGallery', () => ({
  SitesGallery: ({ newScanOpen }: { newScanOpen: boolean }) => (
    <div data-testid="sites-gallery">{newScanOpen ? 'scan modal open' : 'scan modal closed'}</div>
  ),
}));

const zoneEditor = vi.hoisted(() => ({
  editorMode: 'view' as 'view' | 'draw',
  setEditorMode: vi.fn(),
}));

vi.mock('../../hooks', () => ({
  useZones: () => ({
    zones: [],
    selectedZone: null,
    selectZone: vi.fn(),
    setCurrentFloor: vi.fn(),
  }),
  useZoneEditor: () => zoneEditor,
}));
vi.mock('@/features/robots/hooks/useRobots', () => ({
  useRobots: () => ({ robots: [], fetchRobots: vi.fn() }),
}));

import { FleetPage } from '../FleetPage';

function renderAt(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <FleetPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  zoneEditor.editorMode = 'view';
  zoneEditor.setEditorMode = vi.fn();
});

describe('FleetPage tabs', () => {
  it('offers Map · Robots · Sites, in that order', () => {
    renderAt('/fleet');
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Map', 'Robots', 'Sites']);
  });

  it('shows the map and the zone actions on the default tab', () => {
    renderAt('/fleet');
    expect(screen.getByTestId('fleet-map')).toBeInTheDocument();
    expect(screen.queryByTestId('sites-gallery')).toBeNull();
    expect(screen.getByRole('button', { name: 'Draw zone' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New zone' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'New scan' })).toBeNull();
  });

  it('deep-links ?tab=sites to the gallery, with New scan as the only action', () => {
    renderAt('/fleet?tab=sites');
    expect(screen.getByTestId('sites-gallery')).toBeInTheDocument();
    expect(screen.queryByTestId('fleet-map')).toBeNull();
    expect(screen.getByRole('button', { name: 'New scan' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'New zone' })).toBeNull();
  });

  it('opens the gallery\'s scan modal from the header button', () => {
    renderAt('/fleet?tab=sites');
    expect(screen.getByTestId('sites-gallery')).toHaveTextContent('scan modal closed');
    fireEvent.click(screen.getByRole('button', { name: 'New scan' }));
    expect(screen.getByTestId('sites-gallery')).toHaveTextContent('scan modal open');
  });

  it('deep-links ?tab=list to the robot list, which brings no header action', () => {
    renderAt('/fleet?tab=list');
    expect(screen.getByTestId('robots-list')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'New scan' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'New zone' })).toBeNull();
  });

  it('falls back to the map for a ?tab= value it does not know', () => {
    renderAt('/fleet?tab=nonsense');
    expect(screen.getByTestId('fleet-map')).toBeInTheDocument();
  });

  it('cancels zone drawing when the Sites tab takes over', () => {
    zoneEditor.editorMode = 'draw';
    renderAt('/fleet');
    expect(screen.getByRole('status')).toHaveTextContent('Drag on the map to draw the zone.');

    fireEvent.click(screen.getByRole('tab', { name: 'Sites' }));
    expect(zoneEditor.setEditorMode).toHaveBeenCalledWith('view');
    expect(screen.getByTestId('sites-gallery')).toBeInTheDocument();
  });

  it('keeps the zone form mounted on every tab', () => {
    renderAt('/fleet?tab=sites');
    expect(screen.getByTestId('zone-form')).toHaveAttribute('data-open', 'false');
  });
});
