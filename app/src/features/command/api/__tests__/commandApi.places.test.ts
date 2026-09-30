/**
 * @file commandApi.places.test.ts
 * @description NL "move to X" resolves X against the robot's site places (TASK-332)
 * @feature command
 */

import { beforeEach, describe, it, expect, vi } from 'vitest';

const get = vi.fn();

vi.mock('@/api/client', () => ({
  apiClient: { get: (url: string) => get(url), post: vi.fn(), patch: vi.fn() },
}));

vi.mock('@/features/robots/api', () => ({ robotsApi: {} }));

import { clearNamedLocationCache, fetchNamedLocations, getLocationByName } from '../commandApi';

const graph = {
  version: 1,
  frame: { id: 'twin-t1', kind: 'site', units: 'm', yawConvention: 'ccw', twinId: 't1' },
  places: [
    { id: 'LOADING-DOCK', name: 'Loading Dock', placeType: 'cell', floor: 0, polygon: [[0, 0], [4, 0], [4, 2], [0, 2]], source: 'surveyed', keepout: false },
    { id: 'PIT', name: 'Pit', placeType: 'unknown', floor: 0, polygon: [[9, 9], [10, 9], [10, 10]], source: 'surveyed', keepout: true },
  ],
};

describe('commandApi named locations (TASK-332)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearNamedLocationCache();
  });

  it("reads the robot's places and resolves a name to the place centroid", async () => {
    get.mockResolvedValue({ data: graph });

    const loc = await getLocationByName('robot-1', 'Loading Dock');

    expect(get).toHaveBeenCalledWith('/robots/robot-1/places');
    expect(loc).toEqual({ x: 2, y: 1, place: 'LOADING-DOCK' });
    expect(await getLocationByName('robot-1', 'loading-dock')).toEqual({ x: 2, y: 1, place: 'LOADING-DOCK' });
  });

  it('never offers a keepout place', async () => {
    get.mockResolvedValue({ data: graph });
    const locations = await fetchNamedLocations('robot-1');
    expect(locations.pit).toBeUndefined();
  });

  it('caches per robot', async () => {
    get.mockResolvedValue({ data: graph });
    await fetchNamedLocations('robot-1');
    await fetchNamedLocations('robot-1');
    await fetchNamedLocations('robot-2');
    expect(get).toHaveBeenCalledTimes(2);
  });

  it('a robot with no site only knows home', async () => {
    get.mockRejectedValue({ response: { status: 404 } });
    expect(await fetchNamedLocations('robot-1')).toEqual({ home: { x: 0, y: 0 } });
    expect(await getLocationByName('robot-1', 'Loading Dock')).toBeUndefined();
  });
});
