/**
 * @file FleetPage.test.tsx
 * @description Fleet's three tabs: which body ?tab= selects, that the Map tab
 *              is the site map (TASK-331) with no fleet-zone authoring left in
 *              the header, and New scan only on Sites.
 * @feature fleet
 */

import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// Every tab body is stubbed: this is a test about the tab switch and the
// header, not about the map, the robot list or the twin gallery.
vi.mock('../../components/SiteMap', () => ({
  SiteMap: () => <div data-testid="site-map" />,
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

import { FleetPage } from '../FleetPage';

function renderAt(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <FleetPage />
    </MemoryRouter>,
  );
}

describe('FleetPage tabs', () => {
  it('offers Map · Robots · Sites, in that order', () => {
    renderAt('/fleet');
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Map', 'Robots', 'Sites']);
  });

  it('shows the site map on the default tab, with no fleet-zone authoring', () => {
    renderAt('/fleet');
    expect(screen.getByTestId('site-map')).toBeInTheDocument();
    expect(screen.queryByTestId('sites-gallery')).toBeNull();
    // Zones are authored on a site's twin now; the header offers no zone writes.
    expect(screen.queryByRole('button', { name: 'Draw zone' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'New zone' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'New scan' })).toBeNull();
  });

  it('deep-links ?tab=sites to the gallery, with New scan as the only action', () => {
    renderAt('/fleet?tab=sites');
    expect(screen.getByTestId('sites-gallery')).toBeInTheDocument();
    expect(screen.queryByTestId('site-map')).toBeNull();
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
    expect(screen.getByTestId('site-map')).toBeInTheDocument();
  });
});
