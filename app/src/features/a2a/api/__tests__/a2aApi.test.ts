/**
 * @file a2aApi.test.ts
 * @description A list endpoint that answers without its list rejects instead of
 *   resolving `undefined` (TASK-373): an HTML page served by another process on
 *   the API port used to crash every /a2a page on `.length`.
 * @feature a2a
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { post } = vi.hoisted(() => ({ post: vi.fn() }));
vi.mock('@/api/client', () => ({ apiClient: { post, get: vi.fn(), delete: vi.fn() } }));

import { a2aApi, readList } from '../a2aApi';

const HTML = '<!DOCTYPE html><html><head><title>Some other app</title></head></html>';

describe('readList', () => {
  it('returns the wrapped array', () => {
    expect(readList<number>({ items: [1, 2] }, 'items', '/x')).toEqual([1, 2]);
  });

  it.each([
    ['an HTML string', HTML],
    ['null', null],
    ['an object without the key', { error: 'nope' }],
    ['a non-array value', { items: 'nope' }],
  ])('throws on %s', (_label, body) => {
    expect(() => readList(body, 'items', '/x')).toThrow('Unexpected response from /x');
  });
});

describe('a2aApi list endpoints', () => {
  beforeEach(() => post.mockReset());

  it.each([
    ['listAgents', () => a2aApi.listAgents()],
    ['listTasks', () => a2aApi.listTasks()],
    ['getEvents', () => a2aApi.getEvents()],
    ['listConversations', () => a2aApi.listConversations()],
    ['listMessages', () => a2aApi.listMessages('c1')],
  ])('%s rejects when the body is an HTML page', async (_name, call) => {
    post.mockResolvedValue({ data: HTML, status: 200 });
    await expect(call()).rejects.toThrow(/Unexpected response/);
  });

  it('resolves the list when the body carries it', async () => {
    post.mockResolvedValue({ data: { agents: [{ name: 'a' }] }, status: 200 });
    await expect(a2aApi.listAgents()).resolves.toEqual([{ name: 'a' }]);
  });
});
