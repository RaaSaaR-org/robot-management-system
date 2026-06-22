/**
 * @file streams.test.ts
 * @description Unit tests for the JetStream stream/consumer provisioning helpers.
 *   The only external boundary is the `JetStreamManager` (from the `nats` SDK),
 *   which every public function receives as an argument — so it is replaced with
 *   a hand-built fake (vi.fn-backed `streams`/`consumers` namespaces). The pure
 *   provisioning logic (idempotency checks, ordering, error propagation, stream
 *   and consumer config payloads) runs for real and is asserted against the
 *   actual nats enum values. console.log/error are silenced to keep output clean.
 * @feature messaging
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { JetStreamManager } from 'nats';

import {
  STREAM_NAMES,
  CONSUMER_NAMES,
  SUBJECTS,
  createStreams,
  getStreamInfo,
  getConsumerInfo,
} from '../streams.js';

// ---------------------------------------------------------------------------
// Fake JetStreamManager. Only the members the module touches are implemented:
//   jsm.streams.info / jsm.streams.add
//   jsm.consumers.info / jsm.consumers.add
// All are vi.fn() so calls/arguments can be asserted.
// ---------------------------------------------------------------------------

interface FakeJsm {
  streams: {
    info: ReturnType<typeof vi.fn>;
    add: ReturnType<typeof vi.fn>;
  };
  consumers: {
    info: ReturnType<typeof vi.fn>;
    add: ReturnType<typeof vi.fn>;
  };
}

function makeJsm(): FakeJsm {
  return {
    streams: {
      info: vi.fn(),
      add: vi.fn(),
    },
    consumers: {
      info: vi.fn(),
      add: vi.fn(),
    },
  };
}

// Cast helper so the fake satisfies the JetStreamManager parameter type.
const asJsm = (j: FakeJsm) => j as unknown as JetStreamManager;

let logSpy: ReturnType<typeof vi.spyOn>;
let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

describe('STREAM_NAMES / CONSUMER_NAMES / SUBJECTS constants', () => {
  it('exposes the four stream names', () => {
    expect(STREAM_NAMES).toEqual({
      TRAINING_JOBS: 'TRAINING_JOBS',
      DATASET_VALIDATION: 'DATASET_VALIDATION',
      SYNTHETIC_DATA: 'SYNTHETIC_DATA',
      DEAD_LETTER_QUEUE: 'DEAD_LETTER_QUEUE',
    });
  });

  it('exposes the three consumer names', () => {
    expect(CONSUMER_NAMES).toEqual({
      TRAINING_WORKERS: 'training-workers',
      DATASET_VALIDATORS: 'dataset-validators',
      SYNTHETIC_WORKERS: 'synthetic-workers',
    });
  });

  it('exposes the job subjects', () => {
    expect(SUBJECTS).toEqual({
      TRAINING_FINETUNE: 'jobs.training.finetune',
      TRAINING_EVALUATE: 'jobs.training.evaluate',
      TRAINING_EXPORT: 'jobs.training.export',
      DATASET_VALIDATE: 'jobs.dataset.validate',
      DATASET_COMPUTE_STATS: 'jobs.dataset.compute-stats',
      SYNTHETIC_GENERATE: 'synthetic.jobs.generate',
    });
  });
});

// ---------------------------------------------------------------------------
// createStreams — happy path (nothing exists yet)
// ---------------------------------------------------------------------------

describe('createStreams (fresh server, nothing exists)', () => {
  function freshJsm(): FakeJsm {
    const jsm = makeJsm();
    // No stream / consumer exists -> info rejects, swallowed by .catch(() => null)
    jsm.streams.info.mockRejectedValue(new Error('stream not found'));
    jsm.consumers.info.mockRejectedValue(new Error('consumer not found'));
    jsm.streams.add.mockResolvedValue({} as never);
    jsm.consumers.add.mockResolvedValue({} as never);
    return jsm;
  }

  it('creates all four streams', async () => {
    const jsm = freshJsm();

    await createStreams(asJsm(jsm));

    const addedStreamNames = jsm.streams.add.mock.calls.map((c) => c[0].name);
    expect(addedStreamNames).toEqual([
      STREAM_NAMES.TRAINING_JOBS,
      STREAM_NAMES.DATASET_VALIDATION,
      STREAM_NAMES.SYNTHETIC_DATA,
      STREAM_NAMES.DEAD_LETTER_QUEUE,
    ]);
  });

  it('creates the three job consumers (DLQ has none)', async () => {
    const jsm = freshJsm();

    await createStreams(asJsm(jsm));

    const addedConsumerNames = jsm.consumers.add.mock.calls.map((c) => c[1].name);
    expect(addedConsumerNames).toEqual([
      CONSUMER_NAMES.TRAINING_WORKERS,
      CONSUMER_NAMES.DATASET_VALIDATORS,
      CONSUMER_NAMES.SYNTHETIC_WORKERS,
    ]);
  });

  it('logs the overall success line', async () => {
    const jsm = freshJsm();

    await createStreams(asJsm(jsm));

    expect(logSpy).toHaveBeenCalledWith('[Streams] All streams created successfully');
  });

  it('configures the TRAINING_JOBS stream with workqueue retention and file storage', async () => {
    const jsm = freshJsm();

    await createStreams(asJsm(jsm));

    const trainingStream = jsm.streams.add.mock.calls
      .map((c) => c[0])
      .find((cfg) => cfg.name === STREAM_NAMES.TRAINING_JOBS);

    expect(trainingStream).toMatchObject({
      name: 'TRAINING_JOBS',
      subjects: [
        SUBJECTS.TRAINING_FINETUNE,
        SUBJECTS.TRAINING_EVALUATE,
        SUBJECTS.TRAINING_EXPORT,
      ],
      retention: 'workqueue',
      storage: 'file',
      discard: 'old',
      num_replicas: 1,
      max_msgs: 10000,
      max_bytes: 100 * 1024 * 1024,
      max_msg_size: 1024 * 1024,
    });
  });

  it('configures the training-workers consumer with explicit ack and exponential backoff', async () => {
    const jsm = freshJsm();

    await createStreams(asJsm(jsm));

    const call = jsm.consumers.add.mock.calls.find(
      (c) => c[0] === STREAM_NAMES.TRAINING_JOBS,
    );
    expect(call).toBeDefined();
    const [streamName, cfg] = call!;
    expect(streamName).toBe('TRAINING_JOBS');
    expect(cfg).toMatchObject({
      name: 'training-workers',
      durable_name: 'training-workers',
      ack_policy: 'explicit',
      deliver_policy: 'all',
      replay_policy: 'instant',
      max_deliver: 3,
      max_ack_pending: 5,
      filter_subjects: ['jobs.training.>'],
      backoff: [30 * 1e9, 5 * 60 * 1e9, 30 * 60 * 1e9],
    });
  });

  it('configures the DEAD_LETTER_QUEUE stream with Limits retention and no consumer', async () => {
    const jsm = freshJsm();

    await createStreams(asJsm(jsm));

    const dlq = jsm.streams.add.mock.calls
      .map((c) => c[0])
      .find((cfg) => cfg.name === STREAM_NAMES.DEAD_LETTER_QUEUE);

    expect(dlq).toMatchObject({
      name: 'DEAD_LETTER_QUEUE',
      subjects: ['dlq.training.>'],
      retention: 'limits',
      storage: 'file',
      discard: 'old',
      max_bytes: 500 * 1024 * 1024,
    });
    // DLQ stream has no associated consumer
    const dlqConsumer = jsm.consumers.add.mock.calls.find(
      (c) => c[0] === STREAM_NAMES.DEAD_LETTER_QUEUE,
    );
    expect(dlqConsumer).toBeUndefined();
  });

  it('checks for stream existence before adding each stream', async () => {
    const jsm = freshJsm();

    await createStreams(asJsm(jsm));

    // info() probed for all four streams (DLQ probed once; job streams probed
    // for stream existence, consumers probed separately).
    const probedStreams = jsm.streams.info.mock.calls.map((c) => c[0]);
    expect(probedStreams).toContain(STREAM_NAMES.TRAINING_JOBS);
    expect(probedStreams).toContain(STREAM_NAMES.DATASET_VALIDATION);
    expect(probedStreams).toContain(STREAM_NAMES.SYNTHETIC_DATA);
    expect(probedStreams).toContain(STREAM_NAMES.DEAD_LETTER_QUEUE);
  });
});

// ---------------------------------------------------------------------------
// createStreams — idempotency (everything already exists)
// ---------------------------------------------------------------------------

describe('createStreams (everything already exists)', () => {
  function existingJsm(): FakeJsm {
    const jsm = makeJsm();
    jsm.streams.info.mockResolvedValue({ config: {} } as never);
    jsm.consumers.info.mockResolvedValue({ config: {} } as never);
    jsm.streams.add.mockResolvedValue({} as never);
    jsm.consumers.add.mockResolvedValue({} as never);
    return jsm;
  }

  it('adds no streams when they all already exist', async () => {
    const jsm = existingJsm();

    await createStreams(asJsm(jsm));

    expect(jsm.streams.add).not.toHaveBeenCalled();
  });

  it('adds no consumers when stream and consumer already exist', async () => {
    const jsm = existingJsm();

    await createStreams(asJsm(jsm));

    expect(jsm.consumers.add).not.toHaveBeenCalled();
  });

  it('logs "already exists" for each existing stream', async () => {
    const jsm = existingJsm();

    await createStreams(asJsm(jsm));

    expect(logSpy).toHaveBeenCalledWith(
      `[Streams] Stream ${STREAM_NAMES.TRAINING_JOBS} already exists`,
    );
    expect(logSpy).toHaveBeenCalledWith(
      `[Streams] Stream ${STREAM_NAMES.DEAD_LETTER_QUEUE} already exists`,
    );
  });
});

// ---------------------------------------------------------------------------
// createStreams — stream exists but its consumer is missing
// ---------------------------------------------------------------------------

describe('createStreams (job stream exists, consumer missing)', () => {
  it('creates only the missing consumers, not the streams', async () => {
    const jsm = makeJsm();
    jsm.streams.info.mockResolvedValue({ config: {} } as never); // streams exist
    jsm.consumers.info.mockRejectedValue(new Error('not found')); // consumers missing
    jsm.streams.add.mockResolvedValue({} as never);
    jsm.consumers.add.mockResolvedValue({} as never);

    await createStreams(asJsm(jsm));

    expect(jsm.streams.add).not.toHaveBeenCalled();
    const addedConsumerNames = jsm.consumers.add.mock.calls.map((c) => c[1].name);
    expect(addedConsumerNames).toEqual([
      CONSUMER_NAMES.TRAINING_WORKERS,
      CONSUMER_NAMES.DATASET_VALIDATORS,
      CONSUMER_NAMES.SYNTHETIC_WORKERS,
    ]);
  });
});

// ---------------------------------------------------------------------------
// createStreams — error propagation
// ---------------------------------------------------------------------------

describe('createStreams (error paths)', () => {
  it('rejects and logs when stream creation fails', async () => {
    const jsm = makeJsm();
    jsm.streams.info.mockRejectedValue(new Error('not found'));
    const boom = new Error('add failed');
    jsm.streams.add.mockRejectedValue(boom);

    await expect(createStreams(asJsm(jsm))).rejects.toThrow('add failed');
    expect(errorSpy).toHaveBeenCalledWith(
      `[Streams] Error creating stream ${STREAM_NAMES.TRAINING_JOBS}:`,
      boom,
    );
  });

  it('stops at the first failing stream (does not proceed to later streams)', async () => {
    const jsm = makeJsm();
    jsm.streams.info.mockRejectedValue(new Error('not found'));
    jsm.streams.add.mockRejectedValue(new Error('add failed'));

    await expect(createStreams(asJsm(jsm))).rejects.toThrow('add failed');

    // Only the first stream (TRAINING_JOBS) was attempted.
    expect(jsm.streams.add).toHaveBeenCalledTimes(1);
    expect(jsm.streams.add.mock.calls[0][0].name).toBe(STREAM_NAMES.TRAINING_JOBS);
  });

  it('rejects and logs when consumer creation fails', async () => {
    const jsm = makeJsm();
    jsm.streams.info.mockRejectedValue(new Error('not found'));
    jsm.streams.add.mockResolvedValue({} as never);
    jsm.consumers.info.mockRejectedValue(new Error('not found'));
    const boom = new Error('consumer add failed');
    jsm.consumers.add.mockRejectedValue(boom);

    await expect(createStreams(asJsm(jsm))).rejects.toThrow('consumer add failed');
    expect(errorSpy).toHaveBeenCalledWith(
      `[Streams] Error creating consumer ${CONSUMER_NAMES.TRAINING_WORKERS}:`,
      boom,
    );
  });
});

// ---------------------------------------------------------------------------
// getStreamInfo
// ---------------------------------------------------------------------------

describe('getStreamInfo', () => {
  it('returns the stream info on success', async () => {
    const jsm = makeJsm();
    const info = { config: { name: 'TRAINING_JOBS' } };
    jsm.streams.info.mockResolvedValue(info as never);

    const result = await getStreamInfo(asJsm(jsm), 'TRAINING_JOBS');

    expect(jsm.streams.info).toHaveBeenCalledWith('TRAINING_JOBS');
    expect(result).toBe(info);
  });

  it('returns null when the stream does not exist (info throws)', async () => {
    const jsm = makeJsm();
    jsm.streams.info.mockRejectedValue(new Error('stream not found'));

    const result = await getStreamInfo(asJsm(jsm), 'MISSING');

    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// getConsumerInfo
// ---------------------------------------------------------------------------

describe('getConsumerInfo', () => {
  it('returns the consumer info on success', async () => {
    const jsm = makeJsm();
    const info = { name: 'training-workers' };
    jsm.consumers.info.mockResolvedValue(info as never);

    const result = await getConsumerInfo(asJsm(jsm), 'TRAINING_JOBS', 'training-workers');

    expect(jsm.consumers.info).toHaveBeenCalledWith('TRAINING_JOBS', 'training-workers');
    expect(result).toBe(info);
  });

  it('returns null when the consumer does not exist (info throws)', async () => {
    const jsm = makeJsm();
    jsm.consumers.info.mockRejectedValue(new Error('consumer not found'));

    const result = await getConsumerInfo(asJsm(jsm), 'TRAINING_JOBS', 'missing');

    expect(result).toBeNull();
  });
});
