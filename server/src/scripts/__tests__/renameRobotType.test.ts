/**
 * @file renameRobotType.test.ts
 * @description The `rename:robot-type` script's own parts (TASK-493): argument
 *   parsing, and how it reads a server that refuses, predates the route or
 *   fails. The happy path runs against the real routes in
 *   `robot-type-rename.integration.test.ts`.
 * @feature training
 */

import { describe, it, expect, vi } from 'vitest';
import { parseArgs, renameRobotType } from '../rename-robot-type.js';

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

const OLD = 'unitree_g1_dex3 (action 31, state 31)';
const NEW = 'Unitree G1 upper body + Dex3-1 hands';
const LIST = {
  robotTypes: [
    { id: 'rt-31', name: OLD, actionDim: 31, proprioceptionDim: 31 },
    { id: 'rt-28', name: 'Unitree G1 arms + Dex3-1 hands', actionDim: 28, proprioceptionDim: 28 },
  ],
};

describe('parseArgs', () => {
  it('needs the type (by name or id, not both) and the new name', () => {
    expect(() => parseArgs(['--to', NEW], {})).toThrow(/--name/);
    expect(() => parseArgs(['--name', 'a', '--id', 'b', '--to', NEW], {})).toThrow(/not both/);
    expect(() => parseArgs(['--name', OLD], {})).toThrow(/--to/);
    expect(() => parseArgs(['--name', OLD, '--to', '  '], {})).toThrow(/--to/);
    expect(parseArgs(['--help'], {}).help).toBe(true);
  });

  it('reads every flag', () => {
    expect(parseArgs(['--base-url', 'https://a', '--name', OLD, '--to', NEW, '--dry-run', '--token', 't'], {})).toEqual({
      baseUrl: 'https://a', name: OLD, to: NEW, dryRun: true, token: 't', help: false,
    });
    expect(parseArgs(['--base-url=https://b', '--id=rt-31', `--to=${NEW}`], { NEODEM_TOKEN: 'env' })).toMatchObject({
      baseUrl: 'https://b', id: 'rt-31', to: NEW, token: 'env',
    });
  });

  it('refuses an unknown flag or a flag without its value', () => {
    expect(() => parseArgs(['--name', 'a', '--to', 'b', '--force'], {})).toThrow(/Unknown option/);
    expect(() => parseArgs(['--name', 'a', '--to'], {})).toThrow(/needs a value/);
  });
});

describe('renameRobotType', () => {
  it('sends one PATCH with the new name for the type with that exact name, with the token', async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer t0k');
      return init?.method === 'PATCH' ? json(200, {}) : json(200, LIST);
    });
    const result = await renameRobotType({ baseUrl: 'https://host/api', name: OLD, to: ` ${NEW} `, token: 't0k', fetchImpl: fetchImpl as typeof fetch });
    expect(result).toMatchObject({ outcome: 'renamed', robotType: { id: 'rt-31', name: OLD }, to: NEW });
    expect(fetchImpl.mock.calls.map(([url, init]) => `${init?.method ?? 'GET'} ${String(url)}`)).toEqual([
      'GET https://host/api/datasets/robot-types',
      'PATCH https://host/api/datasets/robot-types/rt-31',
    ]);
    expect(JSON.parse(String(fetchImpl.mock.calls[1][1]?.body))).toEqual({ name: NEW });
  });

  it('writes nothing on a dry run, when the name is already right, or when no type has that name', async () => {
    const fetchImpl = vi.fn(async () => json(200, LIST));
    const run = (o: { name: string; to: string; dryRun?: boolean }) =>
      renameRobotType({ baseUrl: 'http://x', fetchImpl: fetchImpl as typeof fetch, ...o });
    expect((await run({ name: OLD, to: NEW, dryRun: true })).outcome).toBe('would-rename');
    expect((await run({ name: OLD, to: OLD })).outcome).toBe('unchanged');
    // The second run after a rename: the old name is gone, the new one is there.
    expect((await run({ name: 'gone', to: 'Unitree G1 arms + Dex3-1 hands' })).outcome).toBe('unchanged');
    expect(await run({ name: 'unitree_g1_dex3', to: NEW })).toEqual({ outcome: 'absent' });
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it('says on a dry run that the name is taken', async () => {
    const fetchImpl = vi.fn(async () => json(200, LIST));
    const result = await renameRobotType({ baseUrl: 'http://x', name: OLD, to: 'unitree g1 arms + dex3-1 hands', dryRun: true, fetchImpl: fetchImpl as typeof fetch });
    expect(result.outcome).toBe('refused');
    expect(result.reason).toContain('Unitree G1 arms + Dex3-1 hands');
  });

  it('says on a dry run that a standard type cannot be renamed, as the server would', async () => {
    const fetchImpl = vi.fn(async () => json(200, LIST));
    const result = await renameRobotType({ baseUrl: 'http://x', name: 'Unitree G1 arms + Dex3-1 hands', to: 'Anything', dryRun: true, fetchImpl: fetchImpl as typeof fetch });
    expect(result).toMatchObject({ outcome: 'refused', reason: expect.stringContaining('standard robot type') });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('reports a 409 as refused with the server’s sentence', async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) =>
      init?.method === 'PATCH' ? json(409, { error: 'A robot type named "X" already exists; pick another name' }) : json(200, LIST));
    const result = await renameRobotType({ baseUrl: 'http://x', name: OLD, to: 'X', fetchImpl: fetchImpl as typeof fetch });
    expect(result).toMatchObject({ outcome: 'refused', reason: expect.stringContaining('already exists') });
  });

  it('tells a server without the route from a type that vanished meanwhile', async () => {
    const without = vi.fn(async (_url: string | URL | Request, init?: RequestInit) =>
      init?.method === 'PATCH' ? new Response('Cannot PATCH', { status: 404 }) : json(200, LIST));
    await expect(renameRobotType({ baseUrl: 'http://x', name: OLD, to: NEW, fetchImpl: without as typeof fetch }))
      .rejects.toThrow(/no robot-type rename route/);

    const vanished = vi.fn(async (_url: string | URL | Request, init?: RequestInit) =>
      init?.method === 'PATCH' ? json(404, { error: 'Robot type not found: rt-31' }) : json(200, LIST));
    expect(await renameRobotType({ baseUrl: 'http://x', name: OLD, to: NEW, fetchImpl: vanished as typeof fetch }))
      .toEqual({ outcome: 'absent' });
  });

  it('throws on any other answer', async () => {
    const down = vi.fn(async () => json(503, { error: 'down' }));
    await expect(renameRobotType({ baseUrl: 'http://x', name: OLD, to: NEW, fetchImpl: down as typeof fetch })).rejects.toThrow(/503/);
    const forbidden = vi.fn(async (_url: string | URL | Request, init?: RequestInit) =>
      init?.method === 'PATCH' ? json(403, { error: 'Forbidden' }) : json(200, LIST));
    await expect(renameRobotType({ baseUrl: 'http://x', name: OLD, to: NEW, fetchImpl: forbidden as typeof fetch })).rejects.toThrow(/403: Forbidden/);
  });
});
