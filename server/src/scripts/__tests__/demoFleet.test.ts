/**
 * @file demoFleet.test.ts
 * @description The demo-fleet script's pure parts (TASK-477): argument parsing,
 *   base-URL handling, the ownership test, and how it reacts to a server that
 *   answers something unexpected.
 * @feature robots
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('../../database/index.js', () => ({ prisma: {} }));

import { DEMO_FLEET, DEMO_FLEET_MARKER, apiRoot, isOurs, matches, syncDemoFleet } from '../demoFleet.js';
import { parseArgs } from '../seed-demo-fleet.js';
import { DEMO_PLANNED_PLACE_TYPES, placeDemoRobots, plannedPlaceFor, resolveDemoSite } from '../demoFleetSites.js';
import { STANDARD_ROBOT_TYPES } from '../../database/seedStandardRobotTypes.js';

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('DEMO_FLEET', () => {
  it('is a G1 with Dex3 hands, an SO-101 and a MicroDuck, each of a seeded robot type', () => {
    expect(DEMO_FLEET.map((r) => r.name)).toEqual(['Unitree G1 with Dex3 hands', 'SO-101', 'MicroDuck']);
    const seeded = new Set(STANDARD_ROBOT_TYPES.map((t) => t.name));
    for (const robot of DEMO_FLEET) {
      expect(seeded.has(robot.robotTypeName)).toBe(true);
      expect(robot.metadata.seededBy).toBe(DEMO_FLEET_MARKER);
    }
  });

  it('marks only the MicroDuck as not delivered yet', () => {
    expect(DEMO_FLEET.filter((r) => r.provisioning === 'arriving').map((r) => r.id)).toEqual(['demo-microduck']);
  });

  it('gives each robot the widths of its type as degrees of freedom', () => {
    for (const robot of DEMO_FLEET) {
      const type = STANDARD_ROBOT_TYPES.find((t) => t.name === robot.robotTypeName);
      expect(robot.metadata.degreesOfFreedom).toBe(type?.actionDim);
    }
  });
});

describe('apiRoot', () => {
  it.each([
    ['https://neodem.example.org', 'https://neodem.example.org/api'],
    ['https://neodem.example.org/', 'https://neodem.example.org/api'],
    ['https://neodem.example.org/api', 'https://neodem.example.org/api'],
    ['http://localhost:3001/api/', 'http://localhost:3001/api'],
    ['https://host/prefix', 'https://host/prefix/api'],
  ])('%s → %s', (input, expected) => expect(apiRoot(input)).toBe(expected));

  it('refuses a non-http URL', () => {
    expect(() => apiRoot('ftp://host')).toThrow(/http\(s\)/);
    expect(() => apiRoot('neodem')).toThrow();
  });
});

describe('ownership', () => {
  const g1 = DEMO_FLEET[0];
  const stored = {
    name: g1.name,
    model: g1.model,
    capabilities: g1.capabilities,
    metadata: { ...g1.metadata, provisioning: g1.provisioning },
  };

  it('a row with the marker that is still expected is ours and matches', () => {
    expect(isOurs(stored)).toBe(true);
    expect(matches(stored, g1)).toBe(true);
    expect(matches({ ...stored, name: 'other' }, g1)).toBe(false);
    expect(matches({ ...stored, metadata: { ...stored.metadata, provisioningNote: 'stale' } }, g1)).toBe(false);
    const duck = DEMO_FLEET[2];
    const storedDuck = {
      name: duck.name,
      model: duck.model,
      capabilities: duck.capabilities,
      metadata: { provisioningNote: duck.note, provisioning: duck.provisioning, ...duck.metadata },
    };
    expect(matches(storedDuck, duck)).toBe(true);
  });

  it('a row without the marker, or one an agent took over, is not ours', () => {
    expect(isOurs({ metadata: { provisioning: 'awaiting_agent' } })).toBe(false);
    expect(isOurs({ metadata: { seededBy: DEMO_FLEET_MARKER } })).toBe(false);
    expect(isOurs({ metadata: null })).toBe(false);
    expect(isOurs({})).toBe(false);
  });
});

describe('syncDemoFleet against a server that misbehaves', () => {
  it('never sends a write for a robot that is not ours', async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(init?.method ?? 'GET').toBe('GET');
      return json(200, { name: 'someone else', metadata: {} });
    });
    for (const remove of [false, true]) {
      const results = await syncDemoFleet({ baseUrl: 'http://x', remove, fetchImpl: fetchImpl as typeof fetch });
      expect(results.every((r) => r.outcome === 'skipped')).toBe(true);
    }
    expect(fetchImpl).toHaveBeenCalledTimes(DEMO_FLEET.length * 2);
  });

  it('says so when the server predates the expected-robot route', async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) =>
      init?.method === 'PUT' ? json(404, { error: 'Not found' }) : json(404, { error: 'Robot not found' }),
    );
    await expect(syncDemoFleet({ baseUrl: 'http://x', fetchImpl: fetchImpl as typeof fetch })).rejects.toThrow(/TASK-477/);
  });

  it('reports a 409 from the write as skipped, with the server’s reason', async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) =>
      init?.method === 'PUT' ? json(409, { error: 'already registered' }) : json(404, {}),
    );
    const results = await syncDemoFleet({ baseUrl: 'http://x', fetchImpl: fetchImpl as typeof fetch, robots: [DEMO_FLEET[0]] });
    expect(results).toEqual([{ id: 'demo-g1-dex3', name: DEMO_FLEET[0].name, outcome: 'skipped', reason: 'already registered' }]);
  });

  it('stops on any other failure instead of carrying on', async () => {
    const fetchImpl = vi.fn(async () => json(500, { error: 'boom' }));
    await expect(syncDemoFleet({ baseUrl: 'http://x', fetchImpl: fetchImpl as typeof fetch })).rejects.toThrow(/500: boom/);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('sends the bearer token when one is given', async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer t0k');
      return init?.method === 'PUT' ? json(201, {}) : json(404, {});
    });
    await syncDemoFleet({ baseUrl: 'http://x', token: 't0k', fetchImpl: fetchImpl as typeof fetch });
    expect(fetchImpl).toHaveBeenCalledTimes(DEMO_FLEET.length * 2);
  });
});

describe('parseArgs', () => {
  it('defaults to the local server and a normal run', () => {
    expect(parseArgs([], {})).toEqual({
      baseUrl: 'http://localhost:3001', remove: false, dryRun: false, withoutMicroduck: false,
      noSite: false, also: [], token: undefined, help: false,
    });
  });

  it('reads every flag, in both --base-url forms', () => {
    expect(parseArgs(['--base-url', 'https://a', '--dry-run', '--remove', '--without-microduck', '--token', 't'], {})).toMatchObject({
      baseUrl: 'https://a', dryRun: true, remove: true, withoutMicroduck: true, token: 't',
    });
    expect(parseArgs(['--base-url=https://b'], { NEODEM_TOKEN: 'env' })).toMatchObject({ baseUrl: 'https://b', token: 'env' });
  });

  it('reads the site flags (TASK-493)', () => {
    expect(parseArgs(['--site', 'Demo Warehouse', '--also', 'sim-robot-001', '--also=lab-g1'], {})).toMatchObject({
      site: 'Demo Warehouse', also: ['sim-robot-001', 'lab-g1'], noSite: false,
    });
    expect(parseArgs(['--site=9a53'], {}).site).toBe('9a53');
    expect(parseArgs(['--no-site'], {}).noSite).toBe(true);
    expect(() => parseArgs(['--no-site', '--also', 'x'], {})).toThrow(/--no-site/);
    expect(() => parseArgs(['--remove', '--site', 'x'], {})).toThrow(/--remove/);
    expect(() => parseArgs(['--also'], {})).toThrow(/needs a value/);
  });

  it('refuses an unknown flag or a flag without its value', () => {
    expect(() => parseArgs(['--prod'], {})).toThrow(/Unknown option/);
    expect(() => parseArgs(['--base-url'], {})).toThrow(/needs a value/);
    expect(() => parseArgs(['--base-url', '--remove'], {})).toThrow(/needs a value/);
  });
});

describe('planned places (TASK-493)', () => {
  const zone = (name: string, placeType: string | null, type = 'room') => ({ name, type, placeType });
  const site = (zones: ReturnType<typeof zone>[]) => ({ id: 'tw-1', name: 'Demo Warehouse', zones });

  it('has a preference for every demo robot', () => {
    expect(Object.keys(DEMO_PLANNED_PLACE_TYPES).sort()).toEqual(DEMO_FLEET.map((r) => r.id).sort());
  });

  it('puts the manipulators in staging and the undelivered MicroDuck at the dock', () => {
    const warehouse = site([zone('AISLE-1', 'aisle'), zone('DOCK-1', 'dock'), zone('STAGING', 'staging')]);
    expect(placeDemoRobots(DEMO_FLEET, warehouse).map((r) => r.metadata.plannedPlace)).toEqual(['STAGING', 'STAGING', 'DOCK-1']);
  });

  it('never plans a robot into a keep-out, and falls back down its list', () => {
    const edgeOnly = site([zone('DOCK-1-EDGE', 'dock', 'keepout'), zone('STAGING', 'staging')]);
    expect(plannedPlaceFor('demo-microduck', edgeOnly)).toBe('STAGING');
    expect(plannedPlaceFor('demo-g1-dex3', site([zone('Cell 2', null, 'workcell'), zone('Cell 1', null, 'workcell')]))).toBe('Cell 1');
  });

  it('plans nothing where no zone fits or there is no site, and leaves the robot as it is', () => {
    expect(plannedPlaceFor('demo-g1-dex3', site([zone('AISLE-1', 'aisle')]))).toBeNull();
    expect(plannedPlaceFor('some-other-robot', site([zone('STAGING', 'staging')]))).toBeNull();
    expect(placeDemoRobots(DEMO_FLEET, null)).toEqual([...DEMO_FLEET]);
    expect(placeDemoRobots(DEMO_FLEET, site([]))[0]).toBe(DEMO_FLEET[0]);
  });
});

describe('resolveDemoSite (TASK-493)', () => {
  it('reads a server without the sites route as "no site", and fails loudly on anything else', async () => {
    const without = vi.fn(async () => new Response('Cannot GET', { status: 404 }));
    expect(await resolveDemoSite({ baseUrl: 'http://x', fetchImpl: without as typeof fetch })).toEqual({
      site: null, reason: 'this server has no sites',
    });
    const down = vi.fn(async () => json(503, { error: 'down' }));
    await expect(resolveDemoSite({ baseUrl: 'http://x', fetchImpl: down as typeof fetch })).rejects.toThrow(/503: down/);
  });

  it('sends the token and reads the place type of each zone', async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer t0k');
      return String(url).endsWith('/zones')
        ? json(200, [{ name: 'STAGING', type: 'room', metadata: { placeType: 'staging' } }, { name: 'Bare', type: 'room', metadata: null }])
        : json(200, [{ id: 'tw-1', name: 'Demo Warehouse' }]);
    });
    expect(await resolveDemoSite({ baseUrl: 'https://host', token: 't0k', fetchImpl: fetchImpl as typeof fetch })).toEqual({
      site: {
        id: 'tw-1',
        name: 'Demo Warehouse',
        zones: [{ name: 'STAGING', type: 'room', placeType: 'staging' }, { name: 'Bare', type: 'room', placeType: null }],
      },
    });
    expect(fetchImpl.mock.calls.map(([url]) => String(url))).toEqual([
      'https://host/api/digital-twins',
      'https://host/api/digital-twins/tw-1/zones',
    ]);
  });
});
