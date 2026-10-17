/**
 * @file CameraStreamView.test.tsx
 * @description The session page's camera tile reconnects on its own — also, and
 *              especially, while a recording runs (TASK-401).
 * @feature datacollection
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { CameraStreamView } from '../CameraStreamView';

const fetchCameraTicket = vi.fn();

vi.mock('../../../robots/api/cameraApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../robots/api/cameraApi')>();
  return { ...actual, fetchCameraTicket: (...args: unknown[]) => fetchCameraTicket(...args) };
});

async function flush(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
  });
}

async function advance(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe('CameraStreamView reconnects', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    let n = 0;
    fetchCameraTicket.mockReset();
    fetchCameraTicket.mockImplementation(async () => {
      n += 1;
      return { ticket: `t${n}`, expiresIn: 120 };
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('retries a stream that fails while recording, on the backoff, and comes back', async () => {
    render(<CameraStreamView robotId="g1" cameraName="head_camera" isRecording />);
    await flush();
    const first = screen.getByAltText('head_camera camera');
    expect(first.getAttribute('src')).toContain('ticket=t1');

    fireEvent.error(first);
    // Not a blank "Recording" plate any more: it says it is coming back.
    expect(screen.getByRole('status')).toHaveTextContent('Reconnecting in 1s');
    expect(screen.getByText('The recording continues.')).toBeInTheDocument();

    await advance(1000);
    // The dead URL is never remounted while the new ticket is in flight.
    expect(screen.queryByAltText('head_camera camera')?.getAttribute('src') ?? '').not.toContain('ticket=t1');
    await flush();
    expect(fetchCameraTicket).toHaveBeenCalledTimes(2);
    const second = screen.getByAltText('head_camera camera');
    expect(second.getAttribute('src')).toContain('ticket=t2');

    // Fails again: the next wait is 2 s.
    fireEvent.error(second);
    expect(screen.getByRole('status')).toHaveTextContent('Reconnecting in 2s');
    await advance(1000);
    expect(screen.getByRole('status')).toHaveTextContent('Reconnecting in 1s');
    await advance(1000);
    await flush();
    expect(fetchCameraTicket).toHaveBeenCalledTimes(3);

    // A frame arrives: live again, and the backoff starts over.
    const third = screen.getByAltText('head_camera camera');
    fireEvent.load(third);
    fireEvent.error(third);
    expect(screen.getByRole('status')).toHaveTextContent('Reconnecting in 1s');
  });

  it('retries a refused ticket too', async () => {
    fetchCameraTicket.mockRejectedValueOnce(new Error('500'));
    render(<CameraStreamView robotId="g1" cameraName="top" isRecording={false} />);
    await flush();
    expect(screen.getByRole('status')).toHaveTextContent('Reconnecting in 1s');
    await advance(1000);
    await flush();
    expect(screen.getByAltText('top camera').getAttribute('src')).toContain('ticket=');
  });

  it('keeps retrying past the old cut-off, holding at 15 s', async () => {
    fetchCameraTicket.mockRejectedValue(new Error('500'));
    render(<CameraStreamView robotId="g1" cameraName="top" isRecording />);
    await flush();
    for (const delay of [1, 2, 4, 8, 15, 15]) {
      expect(screen.getByRole('status')).toHaveTextContent(`Reconnecting in ${delay}s`);
      await advance(delay * 1000);
      await flush();
    }
    expect(fetchCameraTicket).toHaveBeenCalledTimes(7);
  });

  it('does not request a stream for an offline robot', async () => {
    render(<CameraStreamView robotId="g1" cameraName="top" offline />);
    await flush();
    await advance(20_000);
    expect(fetchCameraTicket).not.toHaveBeenCalled();
    expect(screen.getByText('top offline')).toBeInTheDocument();
  });
});
