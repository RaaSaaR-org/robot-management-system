/**
 * @file job-queue.test.ts
 * @description Unit tests for the JetStream-based JetStreamJobQueue. The NATS
 *   I/O boundaries — the natsClient singleton (JetStream client / manager / KV)
 *   and the kv-store helper functions — are mocked. All pure queue logic
 *   (subject routing, progress merging, status counting, cancellation tracking,
 *   message ack/nak flow) runs for real and is asserted end-to-end.
 * @feature messaging
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mock fns for the NATS boundaries. The JetStream client/manager are
// fabricated objects whose methods we control per-test; the kv-store helpers
// are replaced wholesale so KV reads/writes are observable without a server.
// ---------------------------------------------------------------------------

const h = vi.hoisted(() => {
  const consumersGet = vi.fn();
  const jetPublish = vi.fn();
  const getKV = vi.fn();
  const streamsInfo = vi.fn();
  const consumersInfo = vi.fn();

  const jetStream = {
    consumers: { get: consumersGet },
  };
  const jetStreamManager = {
    streams: { info: streamsInfo },
    consumers: { info: consumersInfo },
  };

  return {
    consumersGet,
    jetPublish,
    getKV,
    streamsInfo,
    consumersInfo,
    jetStream,
    jetStreamManager,
    kvGet: vi.fn(),
    kvPut: vi.fn(),
    kvDelete: vi.fn(),
    kvWatch: vi.fn(),
  };
});

vi.mock('../nats-client.js', () => ({
  natsClient: {
    getJetStream: () => h.jetStream,
    getJetStreamManager: () => h.jetStreamManager,
    getKV: h.getKV,
    jetPublish: h.jetPublish,
  },
}));

vi.mock('../kv-stores.js', async () => {
  // Keep the real KV_STORE_NAMES constant; replace only the I/O helpers.
  const actual = await vi.importActual<typeof import('../kv-stores.js')>('../kv-stores.js');
  return {
    ...actual,
    kvGet: h.kvGet,
    kvPut: h.kvPut,
    kvDelete: h.kvDelete,
    kvWatch: h.kvWatch,
  };
});

import { StringCodec } from 'nats';
import {
  JetStreamJobQueue,
  getJobQueue,
  initializeJobQueue,
  type JobPayload,
} from '../job-queue.js';
import { SUBJECTS, STREAM_NAMES, CONSUMER_NAMES } from '../streams.js';
import { KV_STORE_NAMES } from '../kv-stores.js';
import type { JobProgress } from '../../types/training.types.js';

const sc = StringCodec();

// A sentinel KV handle returned by natsClient.getKV — the helpers are mocked,
// so its identity is all that matters (passed through to kvGet/kvPut/etc.).
const FAKE_KV = { keys: vi.fn() } as unknown as import('nats').KV;

function makePayload(overrides: Partial<JobPayload> = {}): JobPayload {
  return {
    jobId: 'job-1',
    datasetId: 'ds-1',
    baseModel: 'smolvla' as JobPayload['baseModel'],
    fineTuneMethod: 'lora' as JobPayload['fineTuneMethod'],
    hyperparameters: {} as JobPayload['hyperparameters'],
    gpuRequirements: {} as JobPayload['gpuRequirements'],
    priority: 0,
    ...overrides,
  };
}

/** Build an initialized queue: progressKV is set to FAKE_KV. */
async function makeInitializedQueue(): Promise<JetStreamJobQueue> {
  h.getKV.mockResolvedValue(FAKE_KV);
  const q = new JetStreamJobQueue();
  await q.initialize();
  return q;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// initialize
// ---------------------------------------------------------------------------

describe('JetStreamJobQueue.initialize', () => {
  it('fetches the JOB_PROGRESS KV store', async () => {
    h.getKV.mockResolvedValue(FAKE_KV);
    const q = new JetStreamJobQueue();

    await q.initialize();

    expect(h.getKV).toHaveBeenCalledWith(KV_STORE_NAMES.JOB_PROGRESS);
  });

  it('leaves the queue usable for progress operations afterwards', async () => {
    const q = await makeInitializedQueue();
    h.kvGet.mockResolvedValue(null);

    await expect(q.getJobProgress('x')).resolves.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Guard: operations before initialize throw "not initialized"
// ---------------------------------------------------------------------------

describe('uninitialized queue guards', () => {
  it('getJobProgress throws when not initialized', async () => {
    const q = new JetStreamJobQueue();
    await expect(q.getJobProgress('j')).rejects.toThrow('Job queue not initialized');
  });

  it('updateJobProgress throws when not initialized', async () => {
    const q = new JetStreamJobQueue();
    await expect(q.updateJobProgress('j', { progress: 1 })).rejects.toThrow(
      'Job queue not initialized'
    );
  });

  it('watchJobProgress throws when not initialized', async () => {
    const q = new JetStreamJobQueue();
    await expect(q.watchJobProgress('j', () => {})).rejects.toThrow('Job queue not initialized');
  });

  it('deleteJobProgress throws when not initialized', async () => {
    const q = new JetStreamJobQueue();
    await expect(q.deleteJobProgress('j')).rejects.toThrow('Job queue not initialized');
  });

  it('addJob throws (via initializeProgress) when not initialized', async () => {
    const q = new JetStreamJobQueue();
    h.jetPublish.mockResolvedValue({ seq: 1, duplicate: false });
    await expect(q.addJob('finetune', makePayload())).rejects.toThrow(
      'Job queue not initialized'
    );
  });
});

// ---------------------------------------------------------------------------
// addJob — subject routing, msgID defaulting, dedup logging, progress init
// ---------------------------------------------------------------------------

describe('JetStreamJobQueue.addJob', () => {
  it('routes finetune to the finetune subject and defaults msgID to jobId', async () => {
    const q = await makeInitializedQueue();
    h.jetPublish.mockResolvedValue({ seq: 7, duplicate: false });

    const result = await q.addJob('finetune', makePayload({ jobId: 'abc' }));

    expect(h.jetPublish).toHaveBeenCalledWith(
      SUBJECTS.TRAINING_FINETUNE,
      expect.objectContaining({ jobId: 'abc' }),
      { msgID: 'abc' }
    );
    expect(result).toBe('abc');
  });

  it('routes evaluate and export to their subjects', async () => {
    const q = await makeInitializedQueue();
    h.jetPublish.mockResolvedValue({ seq: 1, duplicate: false });

    await q.addJob('evaluate', makePayload());
    await q.addJob('export', makePayload());

    expect(h.jetPublish).toHaveBeenNthCalledWith(
      1,
      SUBJECTS.TRAINING_EVALUATE,
      expect.anything(),
      expect.anything()
    );
    expect(h.jetPublish).toHaveBeenNthCalledWith(
      2,
      SUBJECTS.TRAINING_EXPORT,
      expect.anything(),
      expect.anything()
    );
  });

  it('throws on an unknown job type', async () => {
    const q = await makeInitializedQueue();
    await expect(
      q.addJob('bogus' as unknown as 'finetune', makePayload())
    ).rejects.toThrow('Unknown job type: bogus');
  });

  it('uses an explicit msgID override when provided', async () => {
    const q = await makeInitializedQueue();
    h.jetPublish.mockResolvedValue({ seq: 1, duplicate: false });

    await q.addJob('finetune', makePayload({ jobId: 'real' }), { msgID: 'override' });

    expect(h.jetPublish).toHaveBeenCalledWith(
      SUBJECTS.TRAINING_FINETUNE,
      expect.anything(),
      { msgID: 'override' }
    );
  });

  it('still returns the jobId (not the msgID) when a duplicate is detected', async () => {
    const q = await makeInitializedQueue();
    h.jetPublish.mockResolvedValue({ seq: 1, duplicate: true });

    const result = await q.addJob('finetune', makePayload({ jobId: 'dup' }));

    expect(result).toBe('dup');
  });

  it('initializes progress to pending/0 in the KV store', async () => {
    const q = await makeInitializedQueue();
    h.jetPublish.mockResolvedValue({ seq: 1, duplicate: false });

    await q.addJob('finetune', makePayload({ jobId: 'p1' }));

    expect(h.kvPut).toHaveBeenCalledWith(
      FAKE_KV,
      'job.p1',
      expect.objectContaining({ status: 'pending', progress: 0 })
    );
  });
});

// ---------------------------------------------------------------------------
// getJobProgress
// ---------------------------------------------------------------------------

describe('JetStreamJobQueue.getJobProgress', () => {
  it('reads from KV under the namespaced key', async () => {
    const q = await makeInitializedQueue();
    const progress: JobProgress = { status: 'running', progress: 42, updatedAt: 't' };
    h.kvGet.mockResolvedValue(progress);

    const result = await q.getJobProgress('xyz');

    expect(h.kvGet).toHaveBeenCalledWith(FAKE_KV, 'job.xyz');
    expect(result).toEqual(progress);
  });

  it('returns null when KV has no value', async () => {
    const q = await makeInitializedQueue();
    h.kvGet.mockResolvedValue(null);

    expect(await q.getJobProgress('none')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// updateJobProgress — merge semantics over the current value
// ---------------------------------------------------------------------------

describe('JetStreamJobQueue.updateJobProgress', () => {
  it('merges partial fields over the current progress', async () => {
    const q = await makeInitializedQueue();
    h.kvGet.mockResolvedValue({
      status: 'running',
      progress: 50,
      currentEpoch: 2,
      totalEpochs: 10,
      updatedAt: 'old',
    } satisfies JobProgress);

    await q.updateJobProgress('j', { progress: 75, message: 'almost' });

    expect(h.kvPut).toHaveBeenCalledWith(
      FAKE_KV,
      'job.j',
      expect.objectContaining({
        status: 'running',
        progress: 75,
        currentEpoch: 2,
        totalEpochs: 10,
        message: 'almost',
      })
    );
  });

  it('falls back to defaults (pending/0) when no current value exists', async () => {
    const q = await makeInitializedQueue();
    h.kvGet.mockResolvedValue(null);

    await q.updateJobProgress('j', {});

    const written = h.kvPut.mock.calls[0][2] as JobProgress;
    expect(written.status).toBe('pending');
    expect(written.progress).toBe(0);
    expect(typeof written.updatedAt).toBe('string');
  });

  it('honours an explicit updatedAt instead of generating one', async () => {
    const q = await makeInitializedQueue();
    h.kvGet.mockResolvedValue(null);

    await q.updateJobProgress('j', { updatedAt: '2026-01-01T00:00:00.000Z' });

    const written = h.kvPut.mock.calls[0][2] as JobProgress;
    expect(written.updatedAt).toBe('2026-01-01T00:00:00.000Z');
  });
});

// ---------------------------------------------------------------------------
// watchJobProgress
// ---------------------------------------------------------------------------

describe('JetStreamJobQueue.watchJobProgress', () => {
  it('delegates to kvWatch with the namespaced key and returns its unsubscribe', async () => {
    const q = await makeInitializedQueue();
    const unsub = vi.fn();
    h.kvWatch.mockResolvedValue(unsub);
    const cb = vi.fn();

    const result = await q.watchJobProgress('w1', cb);

    expect(h.kvWatch).toHaveBeenCalledWith(FAKE_KV, 'job.w1', cb);
    expect(result).toBe(unsub);
  });
});

// ---------------------------------------------------------------------------
// cancelJob / clearCancelledJob
// ---------------------------------------------------------------------------

describe('JetStreamJobQueue.cancelJob', () => {
  it('marks progress cancelled with a message and returns true', async () => {
    const q = await makeInitializedQueue();
    h.kvGet.mockResolvedValue(null);

    const ok = await q.cancelJob('c1');

    expect(ok).toBe(true);
    expect(h.kvPut).toHaveBeenCalledWith(
      FAKE_KV,
      'job.c1',
      expect.objectContaining({ status: 'cancelled', message: 'Job cancelled by user' })
    );
  });
});

// ---------------------------------------------------------------------------
// deleteJobProgress
// ---------------------------------------------------------------------------

describe('JetStreamJobQueue.deleteJobProgress', () => {
  it('deletes the namespaced key from KV', async () => {
    const q = await makeInitializedQueue();
    h.kvDelete.mockResolvedValue(undefined);

    await q.deleteJobProgress('d1');

    expect(h.kvDelete).toHaveBeenCalledWith(FAKE_KV, 'job.d1');
  });
});

// ---------------------------------------------------------------------------
// getQueueStats — counts by status + stream info coercion
// ---------------------------------------------------------------------------

describe('JetStreamJobQueue.getQueueStats', () => {
  function stubStreamInfo() {
    h.streamsInfo.mockResolvedValue({
      state: {
        messages: 5n as unknown as number,
        bytes: 1024n as unknown as number,
        first_seq: 1n as unknown as number,
        last_seq: 5n as unknown as number,
        consumer_count: 2,
      },
    });
    h.consumersInfo.mockResolvedValue({});
  }

  it('queries the training stream and consumer, and coerces bigint state to numbers', async () => {
    const q = await makeInitializedQueue();
    stubStreamInfo();
    (FAKE_KV.keys as ReturnType<typeof vi.fn>).mockResolvedValue(
      (async function* () {
        /* no keys */
      })()
    );

    const stats = await q.getQueueStats();

    expect(h.streamsInfo).toHaveBeenCalledWith(STREAM_NAMES.TRAINING_JOBS);
    expect(h.consumersInfo).toHaveBeenCalledWith(
      STREAM_NAMES.TRAINING_JOBS,
      CONSUMER_NAMES.TRAINING_WORKERS
    );
    expect(stats.streamInfo).toEqual({
      messages: 5,
      bytes: 1024,
      firstSeq: 1,
      lastSeq: 5,
      consumerCount: 2,
    });
    expect(stats.pending).toBe(0);
  });

  it('aggregates job statuses across KV keys (queued->pending, cancelled->failed)', async () => {
    const q = await makeInitializedQueue();
    stubStreamInfo();

    const keys = ['job.a', 'job.b', 'job.c', 'job.d', 'job.e', 'job.f'];
    (FAKE_KV.keys as ReturnType<typeof vi.fn>).mockResolvedValue(
      (async function* () {
        for (const k of keys) yield k;
      })()
    );
    const byKey: Record<string, JobProgress> = {
      'job.a': { status: 'pending', progress: 0, updatedAt: 't' },
      'job.b': { status: 'queued', progress: 0, updatedAt: 't' },
      'job.c': { status: 'running', progress: 50, updatedAt: 't' },
      'job.d': { status: 'completed', progress: 100, updatedAt: 't' },
      'job.e': { status: 'failed', progress: 0, updatedAt: 't' },
      'job.f': { status: 'cancelled', progress: 0, updatedAt: 't' },
    };
    h.kvGet.mockImplementation(async (_kv: unknown, key: string) => byKey[key] ?? null);

    const stats = await q.getQueueStats();

    expect(stats.pending).toBe(2); // pending + queued
    expect(stats.running).toBe(1);
    expect(stats.completed).toBe(1);
    expect(stats.failed).toBe(2); // failed + cancelled
  });

  it('skips KV entries that resolve to null', async () => {
    const q = await makeInitializedQueue();
    stubStreamInfo();
    (FAKE_KV.keys as ReturnType<typeof vi.fn>).mockResolvedValue(
      (async function* () {
        yield 'job.x';
      })()
    );
    h.kvGet.mockResolvedValue(null);

    const stats = await q.getQueueStats();

    expect(stats.pending).toBe(0);
    expect(stats.running).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// process — message lifecycle (success ack, failure nak), real JSON decode
// ---------------------------------------------------------------------------

describe('JetStreamJobQueue.process', () => {
  /** Build a fake JsMsg whose .data is the StringCodec-encoded JSON payload. */
  function makeMsg(payload: JobPayload) {
    return {
      data: sc.encode(JSON.stringify(payload)),
      ack: vi.fn(),
      nak: vi.fn(),
      working: vi.fn(),
    };
  }

  /**
   * Wire a consumer whose consume() yields exactly the provided messages on the
   * FIRST call, then PARKS forever on subsequent calls. The internal while-loop
   * in process() awaits consumer.consume(); by returning a never-resolving
   * promise after the first batch we prevent a busy-spin (which would OOM) while
   * still letting the first batch flow through. The pending promise is harmless:
   * the vitest worker exits when the run finishes.
   */
  function wireConsumer(messages: Array<ReturnType<typeof makeMsg>>) {
    let first = true;
    const consume = vi.fn(() => {
      if (first) {
        first = false;
        return Promise.resolve(
          (async function* () {
            for (const m of messages) yield m;
          })()
        );
      }
      // Park: the loop awaits this and never proceeds to spin.
      return new Promise(() => {});
    });
    h.consumersGet.mockResolvedValue({ consume });
    return consume;
  }

  it('decodes the payload, marks running then completed, and acks on success', async () => {
    const q = await makeInitializedQueue();
    h.kvGet.mockResolvedValue(null);
    const payload = makePayload({ jobId: 'ok-1' });
    const msg = makeMsg(payload);
    wireConsumer([msg]);

    const processor = vi.fn(async () => {});
    const stop = await q.process(processor);

    // Let the async processing loop run.
    await vi.waitFor(() => expect(msg.ack).toHaveBeenCalledTimes(1));
    stop();

    expect(processor).toHaveBeenCalledWith(payload, expect.objectContaining({ jobId: 'ok-1' }));
    // running (progress 0) then completed (progress 100)
    expect(h.kvPut).toHaveBeenCalledWith(
      FAKE_KV,
      'job.ok-1',
      expect.objectContaining({ status: 'running' })
    );
    expect(h.kvPut).toHaveBeenCalledWith(
      FAKE_KV,
      'job.ok-1',
      expect.objectContaining({ status: 'completed', progress: 100 })
    );
    expect(msg.nak).not.toHaveBeenCalled();
  });

  it('naks and records a failed status when the processor throws', async () => {
    const q = await makeInitializedQueue();
    h.kvGet.mockResolvedValue(null);
    const payload = makePayload({ jobId: 'bad-1' });
    const msg = makeMsg(payload);
    wireConsumer([msg]);

    const processor = vi.fn(async () => {
      throw new Error('boom');
    });
    const stop = await q.process(processor);

    await vi.waitFor(() => expect(msg.nak).toHaveBeenCalledTimes(1));
    stop();

    expect(msg.ack).not.toHaveBeenCalled();
    expect(h.kvPut).toHaveBeenCalledWith(
      FAKE_KV,
      'job.bad-1',
      expect.objectContaining({ status: 'failed', message: 'boom' })
    );
  });

  it('exposes a working context: heartbeat calls msg.working and isCancelled reflects cancelJob', async () => {
    const q = await makeInitializedQueue();
    h.kvGet.mockResolvedValue(null);
    const payload = makePayload({ jobId: 'ctx-1' });
    const msg = makeMsg(payload);
    wireConsumer([msg]);

    let observedCancelled: boolean | undefined;
    const processor = vi.fn(async (_p: JobPayload, ctx) => {
      ctx.heartbeat();
      await ctx.updateProgress({ progress: 10 });
      observedCancelled = await ctx.isCancelled();
    });
    const stop = await q.process(processor);

    await vi.waitFor(() => expect(msg.ack).toHaveBeenCalled());
    stop();

    expect(msg.working).toHaveBeenCalled();
    expect(observedCancelled).toBe(false);
    expect(h.kvPut).toHaveBeenCalledWith(
      FAKE_KV,
      'job.ctx-1',
      expect.objectContaining({ progress: 10 })
    );
  });

  it('returns a stop function that halts the loop without throwing', async () => {
    const q = await makeInitializedQueue();
    wireConsumer([]);

    const stop = await q.process(vi.fn());
    expect(typeof stop).toBe('function');
    expect(() => stop()).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Singleton + initializeJobQueue
// ---------------------------------------------------------------------------

describe('getJobQueue / initializeJobQueue', () => {
  it('returns the same singleton instance on repeated calls', () => {
    expect(getJobQueue()).toBe(getJobQueue());
  });

  it('initializeJobQueue initializes and returns the singleton', async () => {
    h.getKV.mockResolvedValue(FAKE_KV);

    const queue = await initializeJobQueue();

    expect(queue).toBe(getJobQueue());
    expect(h.getKV).toHaveBeenCalledWith(KV_STORE_NAMES.JOB_PROGRESS);
  });
});
