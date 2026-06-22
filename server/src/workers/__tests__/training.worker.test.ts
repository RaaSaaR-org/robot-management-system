/**
 * @file training.worker.test.ts
 * @description Unit tests for the training NATS-consumer worker. The external
 *   boundaries — the NATS client (`../messaging/index.js`) and the training
 *   orchestrator (`../services/TrainingOrchestrator.js`) — are mocked. The
 *   worker's own control flow (start/stop guards, message dispatch, ack/nak/term
 *   retry logic) runs for real against fake NATS consumer/message objects.
 * @feature vla
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { JsMsg, Consumer } from 'nats';

// ---------------------------------------------------------------------------
// Mock the external boundaries. natsClient is the NATS connection facade;
// trainingOrchestrator is the job state machine. streams.js exports plain
// constants and is NOT mocked (pure data).
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
  natsClient: {
    isConnected: vi.fn(),
    getJetStream: vi.fn(),
    getJetStreamManager: vi.fn(),
  },
  trainingOrchestrator: {
    startJob: vi.fn(),
  },
}));

vi.mock('../../messaging/index.js', () => ({
  natsClient: mocks.natsClient,
  STREAM_NAMES: { TRAINING_JOBS: 'TRAINING_JOBS' },
  CONSUMER_NAMES: { TRAINING_WORKERS: 'training-workers' },
}));

vi.mock('../../messaging/streams.js', () => ({
  STREAM_NAMES: { TRAINING_JOBS: 'TRAINING_JOBS' },
  CONSUMER_NAMES: { TRAINING_WORKERS: 'training-workers' },
}));

vi.mock('../../services/TrainingOrchestrator.js', () => ({
  trainingOrchestrator: mocks.trainingOrchestrator,
}));

const natsClient = mocks.natsClient;
const trainingOrchestrator = mocks.trainingOrchestrator;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * A fake JetStream message that records its lifecycle calls. `string()` returns
 * the JSON-encoded payload that handleMessage parses.
 */
function makeMsg(
  payload: unknown,
  opts: { redeliveryCount?: number; rawString?: string } = {}
): JsMsg & {
  ack: ReturnType<typeof vi.fn>;
  nak: ReturnType<typeof vi.fn>;
  term: ReturnType<typeof vi.fn>;
} {
  const str = opts.rawString ?? JSON.stringify(payload);
  return {
    string: () => str,
    ack: vi.fn(),
    nak: vi.fn(),
    term: vi.fn(),
    info: { redeliveryCount: opts.redeliveryCount ?? 0 },
  } as unknown as JsMsg & {
    ack: ReturnType<typeof vi.fn>;
    nak: ReturnType<typeof vi.fn>;
    term: ReturnType<typeof vi.fn>;
  };
}

/**
 * Build a fake Consumer whose `consume()` returns an async-iterable that yields
 * the given messages then completes. The iterable exposes `stop()` (recorded).
 */
function makeConsumer(
  messages: JsMsg[],
  opts: { consumeRejects?: Error } = {}
): { consumer: Consumer; stop: ReturnType<typeof vi.fn>; consume: ReturnType<typeof vi.fn> } {
  const stop = vi.fn();
  const consume = vi.fn(async () => {
    if (opts.consumeRejects) {
      throw opts.consumeRejects;
    }
    const iterable = {
      stop,
      async *[Symbol.asyncIterator]() {
        for (const m of messages) {
          yield m;
        }
      },
    };
    return iterable;
  });
  const consumer = { consume } as unknown as Consumer;
  return { consumer, stop, consume };
}

/** Default happy-path NATS wiring with the given consumer (or none). */
function wireNats(consumer: Consumer | null, opts: { streamExists?: boolean } = {}) {
  natsClient.isConnected.mockReturnValue(true);
  const jsm = {
    streams: {
      info: vi.fn(async () => {
        if (opts.streamExists === false) {
          throw new Error('stream not found');
        }
        return {} as unknown;
      }),
    },
  };
  const js = {
    consumers: {
      get: vi.fn(async () => consumer),
    },
  };
  natsClient.getJetStream.mockReturnValue(js as never);
  natsClient.getJetStreamManager.mockReturnValue(jsm as never);
  return { js, jsm };
}

/** Fresh import of the SUT module so module-level state does not leak. */
async function loadWorker() {
  vi.resetModules();
  return import('../training.worker.js');
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
// startTrainingWorker — guard clauses
// ---------------------------------------------------------------------------

describe('startTrainingWorker guards', () => {
  it('skips start when NATS is not connected', async () => {
    const { startTrainingWorker, trainingWorker } = await loadWorker();
    natsClient.isConnected.mockReturnValue(false);

    await startTrainingWorker();

    expect(trainingWorker.isRunning()).toBe(false);
    expect(natsClient.getJetStream).not.toHaveBeenCalled();
  });

  it('skips start when JetStream is not available', async () => {
    const { startTrainingWorker, trainingWorker } = await loadWorker();
    natsClient.isConnected.mockReturnValue(true);
    natsClient.getJetStream.mockReturnValue(null as never);

    await startTrainingWorker();

    expect(trainingWorker.isRunning()).toBe(false);
    expect(natsClient.getJetStreamManager).not.toHaveBeenCalled();
  });

  it('skips start when JetStreamManager is not available', async () => {
    const { startTrainingWorker, trainingWorker } = await loadWorker();
    natsClient.isConnected.mockReturnValue(true);
    natsClient.getJetStream.mockReturnValue({ consumers: { get: vi.fn() } } as never);
    natsClient.getJetStreamManager.mockReturnValue(null as never);

    await startTrainingWorker();

    expect(trainingWorker.isRunning()).toBe(false);
  });

  it('skips start when the TRAINING_JOBS stream does not exist', async () => {
    const { startTrainingWorker, trainingWorker } = await loadWorker();
    const { consumer } = makeConsumer([]);
    const { js } = wireNats(consumer, { streamExists: false });

    await startTrainingWorker();

    expect(trainingWorker.isRunning()).toBe(false);
    // Never attempts to fetch the consumer once the stream is missing.
    expect(js.consumers.get).not.toHaveBeenCalled();
  });

  it('skips start when consumer fetch resolves null', async () => {
    const { startTrainingWorker, trainingWorker } = await loadWorker();
    wireNats(null);

    await startTrainingWorker();

    expect(trainingWorker.isRunning()).toBe(false);
  });

  it('sets isRunning=false and swallows the error when consumer fetch throws', async () => {
    const { startTrainingWorker, trainingWorker } = await loadWorker();
    natsClient.isConnected.mockReturnValue(true);
    const jsm = { streams: { info: vi.fn(async () => ({})) } };
    const js = { consumers: { get: vi.fn(async () => { throw new Error('boom'); }) } };
    natsClient.getJetStream.mockReturnValue(js as never);
    natsClient.getJetStreamManager.mockReturnValue(jsm as never);

    await expect(startTrainingWorker()).resolves.toBeUndefined();
    expect(trainingWorker.isRunning()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// startTrainingWorker — happy path + idempotency
// ---------------------------------------------------------------------------

describe('startTrainingWorker happy path', () => {
  it('marks the worker running and begins consuming when fully wired', async () => {
    const { startTrainingWorker, stopTrainingWorker, trainingWorker } = await loadWorker();
    const { consumer, consume } = makeConsumer([]);
    wireNats(consumer);

    await startTrainingWorker();

    expect(trainingWorker.isRunning()).toBe(true);
    expect(consume).toHaveBeenCalledWith({ max_messages: 5 });

    await stopTrainingWorker();
  });

  it('is idempotent: a second start while running is a no-op', async () => {
    const { startTrainingWorker, stopTrainingWorker, trainingWorker } = await loadWorker();
    const { consumer } = makeConsumer([]);
    wireNats(consumer);

    await startTrainingWorker();
    natsClient.isConnected.mockClear();

    await startTrainingWorker();

    // Second call returns before touching NATS again.
    expect(natsClient.isConnected).not.toHaveBeenCalled();
    expect(trainingWorker.isRunning()).toBe(true);

    await stopTrainingWorker();
  });
});

// ---------------------------------------------------------------------------
// Message handling via the consume loop
// ---------------------------------------------------------------------------

describe('message handling', () => {
  const validPayload = {
    jobId: 'job-1',
    datasetId: 'ds-1',
    baseModel: 'smolvla',
    fineTuneMethod: 'lora',
    hyperparameters: { epochs: 3 },
    gpuRequirements: { vram: 16 },
    priority: 1,
  };

  it('starts the job via the orchestrator and acks a valid message', async () => {
    const { startTrainingWorker, stopTrainingWorker } = await loadWorker();
    trainingOrchestrator.startJob.mockResolvedValue({ id: 'job-1' } as never);
    const msg = makeMsg(validPayload);
    const { consumer } = makeConsumer([msg]);
    wireNats(consumer);

    await startTrainingWorker();
    // The async-iterator drains synchronously enough that we let microtasks flush.
    await vi.waitFor(() => expect(msg.ack).toHaveBeenCalledTimes(1));

    expect(trainingOrchestrator.startJob).toHaveBeenCalledWith('job-1');
    expect(msg.nak).not.toHaveBeenCalled();
    expect(msg.term).not.toHaveBeenCalled();

    await stopTrainingWorker();
  });

  it('naks with a 30s delay when handling fails below the retry limit', async () => {
    const { startTrainingWorker, stopTrainingWorker } = await loadWorker();
    // Invalid JSON triggers a parse error inside handleMessage.
    const msg = makeMsg(null, { rawString: 'not-json', redeliveryCount: 1 });
    const { consumer } = makeConsumer([msg]);
    wireNats(consumer);

    await startTrainingWorker();
    await vi.waitFor(() => expect(msg.nak).toHaveBeenCalledTimes(1));

    expect(msg.nak).toHaveBeenCalledWith(30000);
    expect(msg.term).not.toHaveBeenCalled();
    expect(msg.ack).not.toHaveBeenCalled();

    await stopTrainingWorker();
  });

  it('terminates the message (DLQ) once the redelivery count reaches 3', async () => {
    const { startTrainingWorker, stopTrainingWorker } = await loadWorker();
    const msg = makeMsg(null, { rawString: 'not-json', redeliveryCount: 3 });
    const { consumer } = makeConsumer([msg]);
    wireNats(consumer);

    await startTrainingWorker();
    await vi.waitFor(() => expect(msg.term).toHaveBeenCalledTimes(1));

    expect(msg.nak).not.toHaveBeenCalled();
    expect(msg.ack).not.toHaveBeenCalled();

    await stopTrainingWorker();
  });

  it('treats a missing redeliveryCount as 0 and naks', async () => {
    const { startTrainingWorker, stopTrainingWorker } = await loadWorker();
    const msg = makeMsg(null, { rawString: 'not-json' });
    // Force redeliveryCount undefined.
    (msg.info as { redeliveryCount?: number }).redeliveryCount = undefined;
    const { consumer } = makeConsumer([msg]);
    wireNats(consumer);

    await startTrainingWorker();
    await vi.waitFor(() => expect(msg.nak).toHaveBeenCalledWith(30000));

    await stopTrainingWorker();
  });

  it('naks when the orchestrator rejects starting the job', async () => {
    const { startTrainingWorker, stopTrainingWorker } = await loadWorker();
    trainingOrchestrator.startJob.mockRejectedValue(new Error('orchestrator down'));
    const msg = makeMsg(validPayload, { redeliveryCount: 0 });
    const { consumer } = makeConsumer([msg]);
    wireNats(consumer);

    await startTrainingWorker();
    await vi.waitFor(() => expect(msg.nak).toHaveBeenCalledWith(30000));

    expect(msg.ack).not.toHaveBeenCalled();

    await stopTrainingWorker();
  });
});

// ---------------------------------------------------------------------------
// processMessages error path (consume() throwing) + retry scheduling
// ---------------------------------------------------------------------------

describe('consume() failure handling', () => {
  it('schedules a restart via setTimeout when consume rejects while running', async () => {
    vi.useFakeTimers();
    const { startTrainingWorker, stopTrainingWorker } = await loadWorker();
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    const { consumer } = makeConsumer([], { consumeRejects: new Error('consume failed') });
    wireNats(consumer);

    await startTrainingWorker();
    // Let the rejected consume() promise settle.
    await vi.waitFor(() => expect(setTimeoutSpy).toHaveBeenCalled());

    expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 5000);

    // Stop before advancing timers so the scheduled restart is a no-op.
    await stopTrainingWorker();
    setTimeoutSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// stopTrainingWorker
// ---------------------------------------------------------------------------

describe('stopTrainingWorker', () => {
  it('is a no-op when the worker was never started', async () => {
    const { stopTrainingWorker, trainingWorker } = await loadWorker();

    await expect(stopTrainingWorker()).resolves.toBeUndefined();
    expect(trainingWorker.isRunning()).toBe(false);
  });

  it('clears isRunning and invokes the consumer stop function', async () => {
    const { startTrainingWorker, stopTrainingWorker, trainingWorker } = await loadWorker();
    // A consumer whose iterator never completes so stopFn stays registered.
    const stop = vi.fn();
    const consume = vi.fn(async () => ({
      stop,
      async *[Symbol.asyncIterator]() {
        // Yield nothing but keep the iterable alive long enough to register stopFn.
        await Promise.resolve();
      },
    }));
    const consumer = { consume } as unknown as Consumer;
    wireNats(consumer);

    await startTrainingWorker();
    await vi.waitFor(() => expect(consume).toHaveBeenCalled());

    await stopTrainingWorker();

    expect(trainingWorker.isRunning()).toBe(false);
    expect(stop).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// trainingWorker facade
// ---------------------------------------------------------------------------

describe('trainingWorker facade', () => {
  it('exposes start/stop/isRunning bound to the module functions', async () => {
    const { trainingWorker, startTrainingWorker, stopTrainingWorker } = await loadWorker();

    expect(trainingWorker.start).toBe(startTrainingWorker);
    expect(trainingWorker.stop).toBe(stopTrainingWorker);
    expect(typeof trainingWorker.isRunning).toBe('function');
    expect(trainingWorker.isRunning()).toBe(false);
  });
});
