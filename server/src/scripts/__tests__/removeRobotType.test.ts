/**
 * @file removeRobotType.test.ts
 * @description The `remove:robot-type` script's own parts (TASK-485): argument
 *   parsing, and how it reads a server that refuses, predates the route or
 *   fails. The happy path runs against the real routes in
 *   `robot-type-removal.integration.test.ts`.
 * @feature training
 */

import { describe, it, expect, vi } from 'vitest';
import { parseArgs, removeRobotType } from '../remove-robot-type.js';
import { DEMO_FLEET } from '../demoFleet.js';

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

const LIST = { robotTypes: [{ id: 'rt-1', name: 'Unitree_G1', actionDim: 28, proprioceptionDim: 28 }] };

describe('parseArgs', () => {
  it('needs a name or an id, and not both', () => {
    expect(() => parseArgs([], {})).toThrow(/--name/);
    expect(() => parseArgs(['--name', 'a', '--id', 'b'], {})).toThrow(/not both/);
    expect(parseArgs(['--help'], {}).help).toBe(true);
  });

  it('reads every flag', () => {
    expect(parseArgs(['--base-url', 'https://a', '--name', 'Unitree_G1', '--dry-run', '--token', 't'], {})).toEqual({
      baseUrl: 'https://a', name: 'Unitree_G1', dryRun: true, token: 't', help: false,
    });
    expect(parseArgs(['--base-url=https://b', '--id=rt-1'], { NEODEM_TOKEN: 'env' })).toMatchObject({
      baseUrl: 'https://b', id: 'rt-1', token: 'env',
    });
  });

  it('refuses an unknown flag or a flag without its value', () => {
    expect(() => parseArgs(['--name', 'a', '--force'], {})).toThrow(/Unknown option/);
    expect(() => parseArgs(['--name'], {})).toThrow(/needs a value/);
  });
});

describe('removeRobotType', () => {
  it('sends one DELETE for the type with that exact name, with the token', async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer t0k');
      return init?.method === 'DELETE' ? json(200, {}) : json(200, LIST);
    });
    const result = await removeRobotType({ baseUrl: 'https://host/api', name: 'Unitree_G1', token: 't0k', fetchImpl: fetchImpl as typeof fetch });
    expect(result.outcome).toBe('removed');
    expect(fetchImpl.mock.calls.map(([url, init]) => `${init?.method ?? 'GET'} ${String(url)}`)).toEqual([
      'GET https://host/api/datasets/robot-types',
      'DELETE https://host/api/datasets/robot-types/rt-1',
    ]);
  });

  it('writes nothing on a dry run or when no type has that name', async () => {
    const fetchImpl = vi.fn(async () => json(200, LIST));
    expect((await removeRobotType({ baseUrl: 'http://x', name: 'Unitree_G1', dryRun: true, fetchImpl: fetchImpl as typeof fetch })).outcome).toBe('would-remove');
    expect(await removeRobotType({ baseUrl: 'http://x', name: 'Unitree G1', fetchImpl: fetchImpl as typeof fetch })).toEqual({ outcome: 'absent' });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('reports a 409 as refused with the server’s sentence', async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) =>
      init?.method === 'DELETE' ? json(409, { error: 'still in use by 1 dataset ("apples")' }) : json(200, LIST),
    );
    expect(await removeRobotType({ baseUrl: 'http://x', id: 'rt-1', fetchImpl: fetchImpl as typeof fetch })).toMatchObject({
      outcome: 'refused',
      reason: 'still in use by 1 dataset ("apples")',
    });
  });

  it('says so when the server predates the delete route, and stops on any other failure', async () => {
    const old = vi.fn(async (_url: string | URL | Request, init?: RequestInit) =>
      init?.method === 'DELETE' ? json(404, { error: 'Not found' }) : json(200, LIST),
    );
    await expect(removeRobotType({ baseUrl: 'http://x', name: 'Unitree_G1', fetchImpl: old as typeof fetch })).rejects.toThrow(/TASK-485/);
    const broken = vi.fn(async () => json(500, { error: 'boom' }));
    await expect(removeRobotType({ baseUrl: 'http://x', name: 'Unitree_G1', fetchImpl: broken as typeof fetch })).rejects.toThrow(/500: boom/);
  });
});

describe('DEMO_FLEET', () => {
  it('states each robot’s type in its metadata, so the link does not hang on the model string', () => {
    for (const robot of DEMO_FLEET) expect(robot.metadata.robotTypeName).toBe(robot.robotTypeName);
    expect(DEMO_FLEET.find((r) => r.id === 'demo-microduck')?.model).not.toBe('Microduck');
  });
});
