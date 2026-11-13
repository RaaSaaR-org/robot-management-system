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
      baseUrl: 'http://localhost:3001', remove: false, dryRun: false, withoutMicroduck: false, token: undefined, help: false,
    });
  });

  it('reads every flag, in both --base-url forms', () => {
    expect(parseArgs(['--base-url', 'https://a', '--dry-run', '--remove', '--without-microduck', '--token', 't'], {})).toMatchObject({
      baseUrl: 'https://a', dryRun: true, remove: true, withoutMicroduck: true, token: 't',
    });
    expect(parseArgs(['--base-url=https://b'], { NEODEM_TOKEN: 'env' })).toMatchObject({ baseUrl: 'https://b', token: 'env' });
  });

  it('refuses an unknown flag or a flag without its value', () => {
    expect(() => parseArgs(['--prod'], {})).toThrow(/Unknown option/);
    expect(() => parseArgs(['--base-url'], {})).toThrow(/needs a value/);
    expect(() => parseArgs(['--base-url', '--remove'], {})).toThrow(/needs a value/);
  });
});
