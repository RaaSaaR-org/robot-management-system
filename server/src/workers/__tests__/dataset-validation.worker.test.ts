/**
 * @file dataset-validation.worker.test.ts
 * @description Unit tests for the dataset-validation NATS consumer worker. The
 *   external boundaries — the NATS client (connection / JetStream / consumer)
 *   and the DatasetService — are mocked. All worker control flow (start/stop
 *   guards, stream-existence checks, message routing by subject, ack/nak/term
 *   retry logic) runs for real against fake JsMsg objects.
 * @feature datasets
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { JsMsg } from 'nats';

// ---------------------------------------------------------------------------
// Mock the external boundaries before importing the worker.
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
  natsClient: {
    isConnected: vi.fn(),
    getJetStream: vi.fn(),
    getJetStreamManager: vi.fn(),
  },
  datasetService: {
    validateAndUpdateDataset: vi.fn(),
  },
}));

vi.mock('../../messaging/index.js', () => ({
  natsClient: mocks.natsClient,
}));

vi.mock('../../services/DatasetService.js', () => ({
  datasetService: mocks.datasetService,
}));

import {
  startDatasetValidationWorker,
  stopDatasetValidationWorker,
  datasetValidationWorker,
} from '../dataset-validation.worker.js';
import { STREAM_NAMES, CONSUMER_NAMES, SUBJECTS } from '../../messaging/streams.js';

const natsClient = vi.mocked(mocks.natsClient, true);
const datasetService = vi.mocked(mocks.datasetService, true);

// ---------------------------------------------------------------------------
// Test doubles for the NATS consumer / JetStream surface.
// ---------------------------------------------------------------------------

/** Build a fake JsMsg with spyable ack/nak/term. */
function makeMsg(
  subject: string,
  payload: unknown,
  redeliveryCount = 0,
): JsMsg {
  return {
    subject,
    string: () => JSON.stringify(payload),
    info: { redeliveryCount },
    ack: vi.fn(),
    nak: vi.fn(),
    term: vi.fn(),
  } as unknown as JsMsg;
}

/**
 * Build a fake "messages" object that is async-iterable and exposes stop().
 * Iterating yields the provided messages once, then completes.
 */
function makeMessages(msgs: JsMsg[]) {
  const stop = vi.fn();
  return {
    stop,
    async *[Symbol.asyncIterator]() {
      for (const m of msgs) {
        yield m;
      }
    },
  };
}

/** Build a fake jsm whose streams.info resolves (stream exists) or rejects. */
function makeJsm(streamExists: boolean) {
  return {
    streams: {
      info: streamExists
        ? vi.fn().mockResolvedValue({ config: { name: STREAM_NAMES.DATASET_VALIDATION } })
        : vi.fn().mockRejectedValue(new Error('stream not found')),
    },
  };
}

/** Build a fake JetStream client whose consumers.get returns a consumer. */
function makeJs(consumer: unknown) {
  return {
    consumers: {
      get: vi.fn().mockResolvedValue(consumer),
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(async () => {
  // Ensure module-level isRunning state never leaks between tests.
  await stopDatasetValidationWorker();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('startDatasetValidationWorker — guard clauses', () => {
  it('skips start when NATS is not connected', async () => {
    natsClient.isConnected.mockReturnValue(false);

    await startDatasetValidationWorker();

    expect(datasetValidationWorker.isRunning()).toBe(false);
    expect(natsClient.getJetStream).not.toHaveBeenCalled();
  });

  it('skips start when JetStream is unavailable', async () => {
    natsClient.isConnected.mockReturnValue(true);
    natsClient.getJetStream.mockReturnValue(null as never);

    await startDatasetValidationWorker();

    expect(datasetValidationWorker.isRunning()).toBe(false);
    expect(natsClient.getJetStreamManager).not.toHaveBeenCalled();
  });

  it('skips start when JetStreamManager is unavailable', async () => {
    natsClient.isConnected.mockReturnValue(true);
    natsClient.getJetStream.mockReturnValue(makeJs(undefined) as never);
    natsClient.getJetStreamManager.mockReturnValue(null as never);

    await startDatasetValidationWorker();

    expect(datasetValidationWorker.isRunning()).toBe(false);
  });

  it('skips start when the DATASET_VALIDATION stream does not exist', async () => {
    natsClient.isConnected.mockReturnValue(true);
    const js = makeJs(undefined);
    natsClient.getJetStream.mockReturnValue(js as never);
    natsClient.getJetStreamManager.mockReturnValue(makeJsm(false) as never);

    await startDatasetValidationWorker();

    expect(datasetValidationWorker.isRunning()).toBe(false);
    expect(js.consumers.get).not.toHaveBeenCalled();
  });
});

describe('startDatasetValidationWorker — happy path & idempotency', () => {
  it('starts, fetches the correct consumer, and reports running', async () => {
    natsClient.isConnected.mockReturnValue(true);
    const consumer = { consume: vi.fn().mockResolvedValue(makeMessages([])) };
    const js = makeJs(consumer);
    natsClient.getJetStream.mockReturnValue(js as never);
    natsClient.getJetStreamManager.mockReturnValue(makeJsm(true) as never);

    await startDatasetValidationWorker();
    // Let the fire-and-forget processMessages microtasks settle.
    await Promise.resolve();
    await Promise.resolve();

    expect(js.consumers.get).toHaveBeenCalledWith(
      STREAM_NAMES.DATASET_VALIDATION,
      CONSUMER_NAMES.DATASET_VALIDATORS,
    );
    expect(consumer.consume).toHaveBeenCalledWith({ max_messages: 5 });
    expect(datasetValidationWorker.isRunning()).toBe(true);
  });

  it('is idempotent — a second start while running does nothing', async () => {
    natsClient.isConnected.mockReturnValue(true);
    const consumer = { consume: vi.fn().mockResolvedValue(makeMessages([])) };
    natsClient.getJetStream.mockReturnValue(makeJs(consumer) as never);
    natsClient.getJetStreamManager.mockReturnValue(makeJsm(true) as never);

    await startDatasetValidationWorker();
    await Promise.resolve();
    consumer.consume.mockClear();

    await startDatasetValidationWorker();

    expect(consumer.consume).not.toHaveBeenCalled();
    expect(datasetValidationWorker.isRunning()).toBe(true);
  });

  it('handles a thrown error during start and stays not-running', async () => {
    natsClient.isConnected.mockReturnValue(true);
    const js = {
      consumers: { get: vi.fn().mockRejectedValue(new Error('boom')) },
    };
    natsClient.getJetStream.mockReturnValue(js as never);
    natsClient.getJetStreamManager.mockReturnValue(makeJsm(true) as never);

    await startDatasetValidationWorker();

    expect(datasetValidationWorker.isRunning()).toBe(false);
    expect(console.error).toHaveBeenCalled();
  });
});

describe('message handling — subject routing', () => {
  async function runWithMessages(msgs: JsMsg[]) {
    natsClient.isConnected.mockReturnValue(true);
    const consumer = { consume: vi.fn().mockResolvedValue(makeMessages(msgs)) };
    natsClient.getJetStream.mockReturnValue(makeJs(consumer) as never);
    natsClient.getJetStreamManager.mockReturnValue(makeJsm(true) as never);

    await startDatasetValidationWorker();
    // Allow the async iteration over messages to drain fully.
    for (let i = 0; i < 10; i++) {
      await Promise.resolve();
    }
  }

  it('routes a validation subject to datasetService.validateAndUpdateDataset and acks', async () => {
    datasetService.validateAndUpdateDataset.mockResolvedValue(undefined);
    const msg = makeMsg(SUBJECTS.DATASET_VALIDATE, {
      datasetId: 'ds-1',
      storagePath: 's3://bucket/ds-1',
    });

    await runWithMessages([msg]);

    expect(datasetService.validateAndUpdateDataset).toHaveBeenCalledWith(
      'ds-1',
      's3://bucket/ds-1',
    );
    expect(msg.ack).toHaveBeenCalledTimes(1);
  });

  it('routes a prefixed validation subject (jobs.dataset.validate.*) to validation handler', async () => {
    datasetService.validateAndUpdateDataset.mockResolvedValue(undefined);
    const msg = makeMsg('jobs.dataset.validate.tenant-a', {
      datasetId: 'ds-2',
      storagePath: 's3://bucket/ds-2',
    });

    await runWithMessages([msg]);

    expect(datasetService.validateAndUpdateDataset).toHaveBeenCalledWith(
      'ds-2',
      's3://bucket/ds-2',
    );
    expect(msg.ack).toHaveBeenCalledTimes(1);
  });

  it('routes a compute-stats subject to the stub (no validate call) and acks', async () => {
    const msg = makeMsg(SUBJECTS.DATASET_COMPUTE_STATS, {
      datasetId: 'ds-3',
      storagePath: 's3://bucket/ds-3',
      force: true,
    });

    await runWithMessages([msg]);

    expect(datasetService.validateAndUpdateDataset).not.toHaveBeenCalled();
    expect(msg.ack).toHaveBeenCalledTimes(1);
  });

  it('warns and acks an unknown subject without dispatching', async () => {
    const msg = makeMsg('jobs.unknown.thing', { foo: 'bar' });

    await runWithMessages([msg]);

    expect(datasetService.validateAndUpdateDataset).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('Unknown subject'),
    );
    expect(msg.ack).toHaveBeenCalledTimes(1);
  });
});

describe('message handling — error / retry / DLQ logic', () => {
  async function runWithMessages(msgs: JsMsg[]) {
    natsClient.isConnected.mockReturnValue(true);
    const consumer = { consume: vi.fn().mockResolvedValue(makeMessages(msgs)) };
    natsClient.getJetStream.mockReturnValue(makeJs(consumer) as never);
    natsClient.getJetStreamManager.mockReturnValue(makeJsm(true) as never);

    await startDatasetValidationWorker();
    for (let i = 0; i < 10; i++) {
      await Promise.resolve();
    }
  }

  it('naks with a 30s delay when the handler throws and redelivery count is below 3', async () => {
    datasetService.validateAndUpdateDataset.mockRejectedValue(new Error('validation failed'));
    const msg = makeMsg(
      SUBJECTS.DATASET_VALIDATE,
      { datasetId: 'ds-err', storagePath: 's3://x' },
      1,
    );

    await runWithMessages([msg]);

    expect(msg.nak).toHaveBeenCalledWith(30000);
    expect(msg.term).not.toHaveBeenCalled();
    expect(msg.ack).not.toHaveBeenCalled();
  });

  it('terminates (DLQ) when redelivery count has reached 3', async () => {
    datasetService.validateAndUpdateDataset.mockRejectedValue(new Error('validation failed'));
    const msg = makeMsg(
      SUBJECTS.DATASET_VALIDATE,
      { datasetId: 'ds-dlq', storagePath: 's3://x' },
      3,
    );

    await runWithMessages([msg]);

    expect(msg.term).toHaveBeenCalledTimes(1);
    expect(msg.nak).not.toHaveBeenCalled();
    expect(msg.ack).not.toHaveBeenCalled();
  });

  it('naks (not term) when redeliveryCount is undefined (defaults to 0)', async () => {
    datasetService.validateAndUpdateDataset.mockRejectedValue(new Error('fail'));
    const msg = {
      subject: SUBJECTS.DATASET_VALIDATE,
      string: () => JSON.stringify({ datasetId: 'ds', storagePath: 's3://x' }),
      info: {}, // redeliveryCount missing -> ?? 0
      ack: vi.fn(),
      nak: vi.fn(),
      term: vi.fn(),
    } as unknown as JsMsg;

    await runWithMessages([msg]);

    expect(msg.nak).toHaveBeenCalledWith(30000);
    expect(msg.term).not.toHaveBeenCalled();
  });

  it('naks when the message body is not valid JSON (parse error path)', async () => {
    const msg = {
      subject: SUBJECTS.DATASET_VALIDATE,
      string: () => 'not-json{',
      info: { redeliveryCount: 0 },
      ack: vi.fn(),
      nak: vi.fn(),
      term: vi.fn(),
    } as unknown as JsMsg;

    await runWithMessages([msg]);

    expect(msg.nak).toHaveBeenCalledWith(30000);
    expect(datasetService.validateAndUpdateDataset).not.toHaveBeenCalled();
  });

  it('logs and schedules a restart when consume() itself rejects', async () => {
    vi.useFakeTimers();
    natsClient.isConnected.mockReturnValue(true);
    const consumer = {
      consume: vi
        .fn()
        .mockRejectedValueOnce(new Error('consume failed'))
        .mockResolvedValue(makeMessages([])),
    };
    natsClient.getJetStream.mockReturnValue(makeJs(consumer) as never);
    natsClient.getJetStreamManager.mockReturnValue(makeJsm(true) as never);

    await startDatasetValidationWorker();
    // Drain the rejected consume() promise.
    await Promise.resolve();
    await Promise.resolve();

    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('Error processing messages'),
      expect.anything(),
    );

    // The 5s restart timer should be registered; advancing it triggers a
    // second consume() call (still running).
    expect(consumer.consume).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(5000);
    expect(consumer.consume).toHaveBeenCalledTimes(2);
  });
});

describe('stopDatasetValidationWorker', () => {
  it('is a no-op when not running', async () => {
    expect(datasetValidationWorker.isRunning()).toBe(false);

    await expect(stopDatasetValidationWorker()).resolves.toBeUndefined();

    expect(datasetValidationWorker.isRunning()).toBe(false);
  });

  it('stops the active message subscription and clears running state', async () => {
    natsClient.isConnected.mockReturnValue(true);
    const messages = makeMessages([]);
    const consumer = { consume: vi.fn().mockResolvedValue(messages) };
    natsClient.getJetStream.mockReturnValue(makeJs(consumer) as never);
    natsClient.getJetStreamManager.mockReturnValue(makeJsm(true) as never);

    await startDatasetValidationWorker();
    await Promise.resolve();
    await Promise.resolve();
    expect(datasetValidationWorker.isRunning()).toBe(true);

    await stopDatasetValidationWorker();

    expect(datasetValidationWorker.isRunning()).toBe(false);
    expect(messages.stop).toHaveBeenCalledTimes(1);
  });
});

describe('datasetValidationWorker facade', () => {
  it('exposes start, stop, and isRunning bound to the worker functions', () => {
    expect(datasetValidationWorker.start).toBe(startDatasetValidationWorker);
    expect(datasetValidationWorker.stop).toBe(stopDatasetValidationWorker);
    expect(typeof datasetValidationWorker.isRunning).toBe('function');
  });
});
