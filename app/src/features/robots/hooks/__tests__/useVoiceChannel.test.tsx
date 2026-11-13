/**
 * @file useVoiceChannel.test.tsx
 * @description TASK-499: asked to (`whenAvailable`), the voice channel reads
 *   health first and leaves the status call and the event stream alone while
 *   there is no voice service — on the demo's simulated robot those two
 *   answered 502 every few seconds. Without the option nothing changes.
 * @feature robots
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

vi.mock('../../api/voiceApi', () => ({
  voiceApi: { getHealth: vi.fn(), getStatus: vi.fn() },
  voiceEventsUrl: (robotId: string) => `/api/robots/${robotId}/voice/events`,
}));

import { voiceApi } from '../../api/voiceApi';
import { useVoiceChannel } from '../useVoiceChannel';
import { useVoiceStore } from '../../store/voiceStore';

const getHealth = vi.mocked(voiceApi.getHealth);
const getStatus = vi.mocked(voiceApi.getStatus);

const streams: string[] = [];
class FakeEventSource {
  onopen: (() => void) | null = null;
  onmessage: ((message: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(url: string) {
    streams.push(url);
  }
  close() {}
}

const down = { available: false, service: null, adapter: null } as never;
const up = { available: true, service: { status: 'ok' }, adapter: null } as never;

beforeEach(() => {
  streams.length = 0;
  getHealth.mockReset();
  getStatus.mockReset().mockResolvedValue({ state: 'idle' } as never);
  useVoiceStore.setState({ health: {}, status: {}, connection: {} });
  vi.stubGlobal('EventSource', FakeEventSource);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useVoiceChannel', () => {
  it('asks only health of a robot whose voice service is not there', async () => {
    getHealth.mockResolvedValue(down);
    const { result } = renderHook(() => useVoiceChannel('sim-robot-001', { whenAvailable: true }));

    await waitFor(() => expect(result.current.health).toEqual(down));
    expect(getHealth).toHaveBeenCalledWith('sim-robot-001');
    // The two calls that could only answer 502.
    expect(getStatus).not.toHaveBeenCalled();
    expect(streams).toEqual([]);
  });

  it('reads the status and opens the stream once health says the service is up', async () => {
    getHealth.mockResolvedValue(up);
    const { result } = renderHook(() => useVoiceChannel('sim-g1-edu-dev', { whenAvailable: true }));

    await waitFor(() => expect(result.current.status).toEqual({ state: 'idle' }));
    await waitFor(() => expect(streams).toEqual(['/api/robots/sim-g1-edu-dev/voice/events']));
  });

  it('keeps today\'s behaviour without the option: status and stream at once', async () => {
    getHealth.mockResolvedValue(down);
    const { result } = renderHook(() => useVoiceChannel('g1-edu-4'));

    // The stream is open before health has answered anything.
    expect(streams).toEqual(['/api/robots/g1-edu-4/voice/events']);
    await waitFor(() => expect(result.current.health).toEqual(down));
    expect(getStatus).toHaveBeenCalledWith('g1-edu-4');
  });
});
