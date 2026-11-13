/**
 * @file SiteMap.test.tsx
 * @description The site map (TASK-331): plots only the robots bound to the
 *              chosen site whose pose is in its frame, lists the rest, remembers
 *              the last site per viewer (and survives storage that throws),
 *              E-stops a zone by its TwinZone id after a confirm (for every
 *              role, a viewer included — TASK-374), and renders compact on the
 *              dashboard.
 * @feature fleet
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { signInAs } from '@/test/utils';
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
import { SiteMap, LAST_SITE_KEY, MAP_LABEL_PX, groupSiteRobots, mapLabelSize, plannedMarkerPositions, sitePoseOf } from '../SiteMap';

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

/** An expected robot (TASK-477): offline, no agent, `metadata.provisioning` set by the server. */
const expected = (id: string, twinId: string | null, plannedPlace?: string, state = 'awaiting_agent'): Robot =>
  ({
    id,
    name: `Robot ${id}`,
    status: 'offline',
    location: { x: 0, y: 0 },
    twinId,
    metadata: { provisioning: state, ...(plannedPlace ? { plannedPlace } : {}) },
  }) as unknown as Robot;

const KEEPOUT: TwinZoneDTO = { ...DOCK, id: 'tz-edge', name: 'Edge', type: 'keepout' } as TwinZoneDTO;

function renderMap(size?: 'full' | 'compact') {
  return render(
    <MemoryRouter>
      <SiteMap size={size} />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  window.localStorage.clear();
  signInAs('member');
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

describe('sitePoseOf (TASK-343)', () => {
  it('plots a registered robot at its twin pose, not its raw odometry', () => {
    const r = robot('a', 'tw-1', true);
    r.location = { ...r.location, x: -3, y: 0, heading: -90, sitePose: { x: 3, y: -1, heading: 0 } };
    expect(sitePoseOf(r)).toEqual({ x: 3, y: -1, heading: 0 });
  });

  it('falls back to x/y/heading for a robot that reports no site pose', () => {
    const r = robot('a', 'tw-1', true);
    r.location = { ...r.location, x: 2, y: 5, heading: 45 };
    expect(sitePoseOf(r)).toEqual({ x: 2, y: 5, heading: 45 });
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

  it('compact lists a robot off the map on one line, name and reason side by side (TASK-489)', async () => {
    robotsHook.robots = [robot('a', null), robot('b', null)];
    renderMap('compact');
    const group = await screen.findByTestId('site-map-unbound');
    expect(group.querySelector('h3')).toHaveTextContent('No site2');
    const row = screen.getByRole('link', { name: 'Robot a' }).closest('li');
    expect(row).toHaveClass('items-center', 'justify-between');
    expect(row).toHaveTextContent('no site');
  });

  it.each(['viewer', 'owner', 'super-admin'] as const)(
    'lets a %s stop a zone — the server grants the zone stop to every role (TASK-374)',
    async (role) => {
      signInAs(role);
      const trigger = vi.fn().mockResolvedValue(true);
      useSafetyStore.setState({ triggerZoneEStop: trigger });
      vi.mocked(confirm).mockResolvedValue(true);
      renderMap();

      fireEvent.click(await screen.findByRole('button', { name: /Stop zone Dock/ }));
      await waitFor(() => expect(trigger).toHaveBeenCalledWith('tz-dock', expect.stringContaining('Dock')));
      expect(screen.queryByText(/Your role can't use this stop/)).toBeNull();
    },
  );
});

describe('expected robots on the site map (TASK-493)', () => {
  it('groups one with a planned zone as planned, one without as expected, and neither as unaligned', () => {
    const g = groupSiteRobots(
      [
        expected('g1', 'tw-1', 'Dock'),
        expected('arm', 'tw-1'),
        expected('typo', 'tw-1', 'No such zone'),
        expected('fence', 'tw-1', 'Edge'),
        expected('lab', 'tw-2', 'Dock'),
        expected('loose', null, 'Dock'),
        robot('b', 'tw-1', false),
      ],
      'tw-1',
      [DOCK, KEEPOUT],
    );
    expect(g.planned.map((p) => `${p.robot.id}@${p.zone.name}`)).toEqual(['g1@Dock']);
    // A zone that is not there, and a keep-out, are no place to stand.
    expect(g.expected.map((r) => r.id)).toEqual(['arm', 'typo', 'fence']);
    expect(g.unaligned.map((r) => r.id)).toEqual(['b']);
    expect(g.unbound.map((r) => r.id)).toEqual(['loose']);
    expect(g.plotted).toEqual([]);
  });

  it('believes a live pose over a planned place once the robot is connected', () => {
    const live = { ...expected('g1', 'tw-1', 'Dock'), status: 'online', location: { x: 2, y: 3, siteAligned: true } } as unknown as Robot;
    const stale = { ...expected('g2', 'tw-1', 'Dock'), status: 'online' } as unknown as Robot;
    const g = groupSiteRobots([live, stale], 'tw-1', [DOCK]);
    expect(g.plotted.map((r) => r.id)).toEqual(['g1']);
    expect(g.planned).toEqual([]);
    // Connected but not aligned: the planned place is not its position.
    expect(g.unaligned.map((r) => r.id)).toEqual(['g2']);
  });

  // At 100 px a metre DOCK is 300 px wide and its name sits at (300, 200).
  const px = (p: { x: number; y: number }) => ({ x: p.x * 100, y: p.y * 100 });
  const FAR: TwinZoneDTO = { ...DOCK, id: 'tz-far', points: DOCK.points.map((p) => ({ x: p.x + 10, y: p.y })) };

  it('writes the robots planned into one zone on the lines around its name, not on top of each other', () => {
    const at = plannedMarkerPositions(
      [
        { robot: expected('a', 'tw-1', 'Dock'), zone: DOCK },
        { robot: expected('b', 'tw-1', 'Dock'), zone: DOCK },
        { robot: expected('c', 'tw-1', 'Far'), zone: FAR },
      ],
      px,
    ).map((m) => m.at);
    // The line over the zone's name, then the line under it.
    expect(at[0]).toEqual({ x: 300, y: 184 });
    expect(at[1]).toEqual({ x: 300, y: 218 });
    // Another zone is another place: its first robot gets the first line again.
    expect(at[2]).toEqual({ x: 1300, y: 184 });
  });

  it('keeps a planned label off the zone names on the map (TASK-495)', () => {
    const planned = [{ robot: expected('a', 'tw-1', 'Dock'), zone: DOCK }];
    // A neighbour's name where the line over "Dock" would be.
    const neighbour = { x: 250, y: 174, w: 100, h: 12 };
    expect(plannedMarkerPositions(planned, px, { obstacles: [neighbour] })[0]!.at).toEqual({ x: 300, y: 218 });
    // One that is out of the way changes nothing.
    expect(plannedMarkerPositions(planned, px, { obstacles: [{ ...neighbour, x: 600 }] })[0]!.at).toEqual({ x: 300, y: 184 });
  });

  it('lets the longest label of a zone pick its line first, and answers in the order asked', () => {
    const long = { ...expected('g1', 'tw-1', 'Dock'), name: 'Unitree G1 with Dex3 hands' } as Robot;
    const at = plannedMarkerPositions(
      [
        { robot: expected('a', 'tw-1', 'Dock'), zone: DOCK },
        { robot: long, zone: DOCK },
      ],
      px,
    );
    expect(at.map((m) => m.robot.id)).toEqual(['a', 'g1']);
    expect(at[1]!.at.y).toBe(184);
    expect(at[0]!.at.y).toBe(218);
  });

  it('starts a label that is wider than its zone at the zone, so the ring stays over it', () => {
    const narrow = (p: { x: number; y: number }) => ({ x: p.x * 10, y: p.y * 10 });
    const [marker] = plannedMarkerPositions([{ robot: expected('a', 'tw-1', 'Dock'), zone: DOCK }], narrow);
    // The zone is 10…40 px; the label is some 120 px wide and centred would start at −31.
    const width = (marker!.at.x - 16) * 2;
    expect(marker!.at.x - width / 2).toBe(16);
    expect(width).toBeGreaterThan(100);
  });

  it('grows the labels with the font, so two lines never close up on a small map', () => {
    const at = plannedMarkerPositions(
      [
        { robot: expected('a', 'tw-1', 'Dock'), zone: DOCK },
        { robot: expected('b', 'tw-1', 'Dock'), zone: DOCK },
      ],
      px,
      { fontSize: 24 },
    ).map((m) => m.at.y);
    expect(at).toEqual([168, 236]);
  });

  it('sizes map labels in screen px: larger in viewBox px the smaller the map is shown (TASK-495)', () => {
    // The dashboard's map is 256 px tall for a 540-unit viewBox: 12 units were 5.7 px.
    expect(mapLabelSize(MAP_LABEL_PX.compact, 540 / 256)).toBeCloseTo(23.2, 1);
    expect(mapLabelSize(MAP_LABEL_PX.full, 540 / 448)).toBeCloseTo(14.46, 1);
    // Never under the viewBox's own size, never so large that names outgrow the map.
    expect(mapLabelSize(12, 0.5)).toBe(12);
    expect(mapLabelSize(12, 10)).toBe(28);
    // Not measured yet (and in jsdom): the viewBox's own size.
    expect(mapLabelSize(12, undefined)).toBe(12);
  });

  it('draws a planned robot as planned — never among the live robots — and lists it as not connected', async () => {
    robotsHook.robots = [expected('g1', 'tw-1', 'Dock'), expected('duck', 'tw-1', 'Dock', 'arriving'), robot('a', 'tw-1', true)];
    renderMap();

    const marker = await screen.findByTestId('site-map-planned-g1');
    expect(marker).toHaveTextContent('Robot g1 (planned)');
    expect(marker.querySelector('title')).toHaveTextContent('Robot g1 — planned position in Dock. Not connected, not a live position.');
    expect(marker.querySelector('circle')).toHaveAttribute('stroke-dasharray');
    const live = screen.getByTestId('site-map-robots');
    expect(within(live).getByTestId('site-map-robot-a')).toBeInTheDocument();
    expect(live).not.toHaveTextContent('Robot g1');

    expect(screen.getByTestId('site-map-count')).toHaveTextContent(
      '1 robot live on the map. 2 expected robots are drawn where they are planned to stand.',
    );
    const list = screen.getByTestId('site-map-planned');
    expect(list.querySelector('h3')).toHaveTextContent('Planned position2');
    const row = within(list).getByRole('link', { name: 'Robot g1' }).closest('li');
    expect(row).toHaveTextContent('planned in Dock');
    expect(row).toHaveTextContent('not connected');
    expect(within(list).getByRole('link', { name: 'Robot duck' }).closest('li')).toHaveTextContent('arriving');
    expect(screen.queryByTestId('site-map-unaligned')).toBeNull();
  });

  it('lists an expected robot without a planned place as not connected, not as "not aligned"', async () => {
    robotsHook.robots = [expected('arm', 'tw-1')];
    renderMap('compact');
    const group = await screen.findByTestId('site-map-expected');
    expect(group).toHaveTextContent('Robot arm');
    expect(group).toHaveTextContent('not connected');
    expect(screen.queryByTestId('site-map-unaligned')).toBeNull();
    expect(screen.queryByTestId('site-map-planned-arm')).toBeNull();
  });

  it('compact says a planned robot on two lines without a tag, and shortens "not aligned"', async () => {
    robotsHook.robots = [expected('g1', 'tw-1', 'Dock'), robot('b', 'tw-1', false)];
    renderMap('compact');
    const planned = await screen.findByTestId('site-map-planned');
    const row = within(planned).getByRole('link', { name: 'Robot g1' }).closest('li');
    expect(row).toHaveTextContent('Robot g1planned in Dock · not connected');
    expect(row?.querySelector('[data-tone]')).toBeNull();

    const unaligned = screen.getByTestId('site-map-unaligned');
    const tag = unaligned.querySelector('[data-tone]');
    expect(tag).toHaveTextContent(/^not aligned$/);
    expect(tag?.getAttribute('title')).toMatch(/fences do not hold it/);
  });
});
