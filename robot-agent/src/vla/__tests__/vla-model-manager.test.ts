/**
 * @file vla-model-manager.test.ts
 * @description Tests for the real (non-simulated) model switch path.
 * @feature vla
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { VLAModelManager } from '../vla-model-manager.js';

const ARTIFACT = 's3://model-checkpoints/v1/adapter.tar.gz';
const MODEL_VERSION_ID = 'mv-test-001';

function makeFakeFetch(impl: (url: string, init?: RequestInit) => Response | Promise<Response>): typeof fetch {
  return (async (input: unknown, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : String(input);
    return impl(url, init);
  }) as unknown as typeof fetch;
}

describe('VLAModelManager.switchModel (real path)', () => {
  beforeEach(() => {
    process.env.VLA_SERVER_URL = 'http://localhost:8000';
  });

  it('happy path: health OK + load-adapter OK → success result', async () => {
    const fakeFetch = makeFakeFetch(async (url) => {
      if (url.endsWith('/health')) {
        return new Response(JSON.stringify({ status: 'ok', model_loaded: true }), { status: 200 });
      }
      if (url.endsWith('/load-adapter')) {
        return new Response(
          JSON.stringify({
            adapter_id: MODEL_VERSION_ID,
            loaded_at: 1700000000,
            load_time_ms: 1234,
            info: { strategy: 'peft_set_adapter' },
          }),
          { status: 200 },
        );
      }
      throw new Error(`Unexpected URL: ${url}`);
    });

    const mgr = new VLAModelManager({ fetchImpl: fakeFetch });
    const result = await mgr.switchModel({
      modelVersionId: MODEL_VERSION_ID,
      artifactUri: ARTIFACT,
    });

    expect(result.success).toBe(true);
    expect(result.newModelVersion).toBe(MODEL_VERSION_ID);
    expect(result.error).toBeUndefined();
    expect(mgr.getCurrentModelVersion()).toBe(MODEL_VERSION_ID);
  });

  it('vla-server returns 503 on /health → fails fast with clear error', async () => {
    const fakeFetch = makeFakeFetch(async (url) => {
      if (url.endsWith('/health')) {
        return new Response('not ready', { status: 503 });
      }
      throw new Error(`load-adapter should not be called`);
    });

    const mgr = new VLAModelManager({ fetchImpl: fakeFetch });
    const result = await mgr.switchModel({
      modelVersionId: MODEL_VERSION_ID,
      artifactUri: ARTIFACT,
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/vla-server unreachable/);
    expect(result.error).toMatch(/503/);
    expect(mgr.getCurrentModelVersion()).toBeNull();
  });

  it('/load-adapter returns 500 → surface server detail in error', async () => {
    const fakeFetch = makeFakeFetch(async (url) => {
      if (url.endsWith('/health')) {
        return new Response(JSON.stringify({ status: 'ok' }), { status: 200 });
      }
      return new Response(
        JSON.stringify({ detail: 'Adapter load failed: bad checksum' }),
        { status: 500 },
      );
    });

    const mgr = new VLAModelManager({ fetchImpl: fakeFetch });
    const result = await mgr.switchModel({
      modelVersionId: MODEL_VERSION_ID,
      artifactUri: ARTIFACT,
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/bad checksum/);
  });

  it('/load-adapter returns 404 (adapter not found) → surface 404 detail', async () => {
    const fakeFetch = makeFakeFetch(async (url) => {
      if (url.endsWith('/health')) {
        return new Response(JSON.stringify({ status: 'ok' }), { status: 200 });
      }
      return new Response(JSON.stringify({ detail: 'Adapter not found: /tmp/missing' }), { status: 404 });
    });

    const mgr = new VLAModelManager({ fetchImpl: fakeFetch });
    const result = await mgr.switchModel({
      modelVersionId: MODEL_VERSION_ID,
      artifactUri: '/tmp/missing',
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Adapter not found/);
  });

  it('concurrent switchModel calls → second call rejected with isSwitching error', async () => {
    let releaseFirst: () => void = () => {};
    const firstStarted = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const fakeFetch = makeFakeFetch(async (url) => {
      if (url.endsWith('/health')) {
        return new Response(JSON.stringify({ status: 'ok' }), { status: 200 });
      }
      // Block first /load-adapter until releaseFirst() is called
      await firstStarted;
      return new Response(
        JSON.stringify({ adapter_id: MODEL_VERSION_ID, loaded_at: 0, load_time_ms: 1, info: {} }),
        { status: 200 },
      );
    });

    const mgr = new VLAModelManager({ fetchImpl: fakeFetch });
    const p1 = mgr.switchModel({ modelVersionId: 'a', artifactUri: ARTIFACT });
    // Yield once so p1 reaches the awaiting state
    await new Promise((r) => setImmediate(r));
    const p2 = await mgr.switchModel({ modelVersionId: 'b', artifactUri: ARTIFACT });

    expect(p2.success).toBe(false);
    expect(p2.error).toMatch(/in progress/);

    releaseFirst();
    const r1 = await p1;
    expect(r1.success).toBe(true);
  });

  it('emits model:switching → model:switched on success', async () => {
    const fakeFetch = makeFakeFetch(async (url) => {
      if (url.endsWith('/health')) return new Response(JSON.stringify({}), { status: 200 });
      return new Response(
        JSON.stringify({ adapter_id: 'x', loaded_at: 0, load_time_ms: 1, info: {} }),
        { status: 200 },
      );
    });

    const mgr = new VLAModelManager({ fetchImpl: fakeFetch });
    const events: string[] = [];
    mgr.onModelSwitch((e) => events.push(e.type));

    await mgr.switchModel({ modelVersionId: 'x', artifactUri: ARTIFACT });

    expect(events).toEqual(['model:switching', 'model:switched']);
  });

  it('emits model:switching → model:switch_failed on error', async () => {
    const fakeFetch = makeFakeFetch(async () => {
      return new Response('boom', { status: 503 });
    });

    const mgr = new VLAModelManager({ fetchImpl: fakeFetch });
    const events: string[] = [];
    mgr.onModelSwitch((e) => events.push(e.type));

    await mgr.switchModel({ modelVersionId: 'x', artifactUri: ARTIFACT });

    expect(events).toEqual(['model:switching', 'model:switch_failed']);
  });
});
