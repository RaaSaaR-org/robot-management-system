/**
 * @file hardware-measured-sample.test.ts
 * @description `getMeasuredSample` — the recorder's read of `/state/fast` —
 *              carries the simulator's sample clock so a 30 fps recorder can
 *              tell a new sample from the same one read twice (TASK-415), and
 *              reports no clock at all for a sidecar that has none.
 * @feature hardware
 * @status test
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { HardwareClient } from '../HardwareClient.js';

function stubState(body: unknown, status = 200): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('HardwareClient.getMeasuredSample', () => {
  it('returns the sim clock with the name-keyed pose, from /state/fast', async () => {
    const fetchMock = stubState({
      joints: [
        { name: 'left_elbow_joint', position: 0.25 },
        { name: 'bad', position: 'x' },
        { name: 'nan_joint', position: Number.NaN },
      ],
      sim_time: 12.346,
      timestamp: 1792276066.1,
    });
    const sample = await new HardwareClient().getMeasuredSample();
    expect(String(fetchMock.mock.calls[0]![0])).toMatch(/\/state\/fast$/);
    expect(sample).toEqual({ joints: { left_elbow_joint: 0.25 }, sampleTime: 12.346 });
  });

  it('reports no clock for the real sidecar, whose timestamp is the reply time', async () => {
    stubState({ joints: [{ name: 'left_elbow_joint', position: 0.1 }], timestamp: 1792276066.1 });
    const sample = await new HardwareClient().getMeasuredSample();
    expect(sample.sampleTime).toBeNull();
  });

  it('keeps getJointMapNow answering the pose alone', async () => {
    stubState({ joints: [{ name: 'left_elbow_joint', position: 0.1 }], sim_time: 1 });
    expect(await new HardwareClient().getJointMapNow()).toEqual({ left_elbow_joint: 0.1 });
  });

  it('throws on a non-2xx reply rather than returning an empty pose', async () => {
    stubState({}, 503);
    await expect(new HardwareClient().getMeasuredSample()).rejects.toThrow(/503/);
  });
});
