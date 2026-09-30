/**
 * @file SiteMap.test.tsx
 * @description The site map (TASK-331): plots only the robots bound to the
 *              chosen site whose pose is in its frame, lists the rest, remembers
 *              the last site per viewer (and survives storage that throws),
 *              E-stops a zone by its TwinZone id after a confirm, and renders
 *              compact on the dashboard.
 * @feature fleet
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { DigitalTwinDTO, TwinZoneDTO } from '@/features/digitaltwin/types/twin.types';
import type { Robot } from '@/features/robots/types/robots.types';

const api = vi.hoisted(() => ({
  listTwins: vi.fn(),
  listZones: vi.fn(),
}));
vi.mock('@/features/digitaltwin/api/twinApi', () => ({ twinApi: api }));

const robotsHook = vi.hoisted(() => ({ robots: [] as Robot[], fetchRobots: vi.fn() }));
vi.mock('@/features/robots/hooks/useRobots', () => ({ useRobots: () => robotsHook }));

vi.mock('@/shared/components/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/shared/components/ui')>();
  return {
    ...actual,
    confirm: vi.fn(),
    toast: { ...actual.toast, warning: vi.fn(), error: vi.fn() },
  };
});

import { confirm, toast } from '@/shared/components/ui';
import { useTwinStore } from '@/features/digitaltwin/store/twinStore';
import { useSafetyStore } from '@/features/safety/store/safetyStore';
import { SiteMap, LAST_SITE_KEY, groupSiteRobots } from '../SiteMap';

const BOUNDS = { minX: 0, minY: 0, minZ: 0, maxX: 10, maxY: 10, maxZ: 3 };
const twin = (id: string, name: string) =>
  ({ id, name, status: 'ready', worldOrigin: { x: 0, y: 0, z: 0 }, bounds: BOUNDS }) as unknown as DigitalTwinDTO;
const WAREHOUSE = twin('tw-1', 'Demo Warehouse');
const LAB = twin('tw-2', 'Lab');

const DOCK: TwinZoneDTO = {
  id: 'tz-dock',
  twinId: 'tw-1',
  name: 'Dock',
  type: 'workcell',
  points: [
    { x: 1, y: 1 },
    { x: 4, y: 1 },
    { x: 4, y: 4 },
  ],
} as unknown as TwinZoneDTO;

const robot = (id: string, twinId: string | null, siteAligned?: boolean): Robot =>
  ({
    id,
    name: `Robot ${id}`,
    status: 'online',
    location: { x: 2, y: 3, heading: 90, siteAligned },
    twinId,
  }) as unknown as Robot;

function renderMap(size?: 'full' | 'compact') {
  return render(
    <MemoryRouter>
      <SiteMap size={size} />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  window.localStorage.clear();
  useTwinStore.setState({ twins: [], isLoading: false, error: null });
  api.listTwins.mockResolvedValue([WAREHOUSE, LAB]);
  api.listZones.mockResolvedValue([DOCK]);
  robotsHook.robots = [];
  vi.mocked(confirm).mockReset();
  vi.mocked(toast.warning).mockReset();
  vi.mocked(toast.error).mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('groupSiteRobots', () => {
  it('plots only aligned robots of the site, lists the rest, ignores other sites', () => {
    const g = groupSiteRobots(
      [robot('a', 'tw-1', true), robot('b', 'tw-1', false), robot('c', 'tw-1'), robot('d', null), robot('e', 'tw-2', true)],
      'tw-1',
    );
    expect(g.plotted.map((r) => r.id)).toEqual(['a']);
    expect(g.unaligned.map((r) => r.id)).toEqual(['b', 'c']);
    expect(g.unbound.map((r) => r.id)).toEqual(['d']);
  });
});

describe('SiteMap', () => {
  it('draws the first site with its zones and only its aligned robots', async () => {
    robotsHook.robots = [robot('a', 'tw-1', true), robot('b', 'tw-1', false), robot('d', null)];
    renderMap();

    expect(await screen.findByRole('button', { name: /Stop zone Dock/ })).toBeInTheDocument();
    expect(api.listZones).toHaveBeenCalledWith('tw-1');
    expect(screen.getByLabelText('Site')).toHaveValue('tw-1');

    const plotted = screen.getByTestId('site-map-robots');
    expect(within(plotted).getByTestId('site-map-robot-a')).toBeInTheDocument();
    expect(within(plotted).queryByTestId('site-map-robot-b')).toBeNull();
    expect(within(plotted).queryByTestId('site-map-robot-d')).toBeNull();

    const unaligned = screen.getByTestId('site-map-unaligned');
    expect(unaligned).toHaveTextContent('Robot b');
    expect(unaligned).toHaveTextContent('not aligned — fence not enforcing');
    expect(screen.getByTestId('site-map-unbound')).toHaveTextContent('Robot d');
  });

  it('remembers the picked site across a remount', async () => {
    const { unmount } = renderMap();
    fireEvent.change(await screen.findByLabelText('Site'), { target: { value: 'tw-2' } });
    expect(window.localStorage.getItem(LAST_SITE_KEY)).toBe('tw-2');
    unmount();

    renderMap();
    await waitFor(() => expect(screen.getByLabelText('Site')).toHaveValue('tw-2'));
    await waitFor(() => expect(api.listZones).toHaveBeenLastCalledWith('tw-2'));
  });

  it('falls back to the first site when localStorage throws', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    renderMap();
    const picker = await screen.findByLabelText('Site');
    expect(picker).toHaveValue('tw-1');
    fireEvent.change(picker, { target: { value: 'tw-2' } });
    expect(picker).toHaveValue('tw-2');
  });

  it('E-stops a clicked zone by its TwinZone id once confirmed', async () => {
    const trigger = vi.fn().mockResolvedValue(true);
    useSafetyStore.setState({
      triggerZoneEStop: trigger,
      lastZoneEStop: { successCount: 2 } as never,
    });
    vi.mocked(confirm).mockResolvedValue(true);
    renderMap();

    fireEvent.click(await screen.findByRole('button', { name: /Stop zone Dock/ }));
    await waitFor(() => expect(trigger).toHaveBeenCalledWith('tz-dock', expect.stringContaining('Dock')));
    expect(toast.warning).toHaveBeenCalledWith('Dock stopped', { description: '2 robots received the stop.' });
  });

  it('does nothing when the confirm is cancelled', async () => {
    const trigger = vi.fn();
    useSafetyStore.setState({ triggerZoneEStop: trigger });
    vi.mocked(confirm).mockResolvedValue(false);
    renderMap();

    fireEvent.click(await screen.findByRole('button', { name: /Stop zone Dock/ }));
    await waitFor(() => expect(confirm).toHaveBeenCalled());
    expect(trigger).not.toHaveBeenCalled();
  });

  it('points to the Sites tab when no site exists', async () => {
    api.listTwins.mockResolvedValue([]);
    renderMap();
    expect(await screen.findByText('No site to show yet')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to Sites' })).toHaveAttribute('href', '/fleet?tab=sites');
  });

  it('renders compact: the same map without the legend', async () => {
    renderMap('compact');
    expect(await screen.findByRole('button', { name: /Stop zone Dock/ })).toBeInTheDocument();
    expect(screen.queryByLabelText('Zone colours')).toBeNull();
  });
});
