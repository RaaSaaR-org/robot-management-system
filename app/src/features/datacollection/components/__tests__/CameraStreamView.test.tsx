/**
 * @file CameraStreamView.test.tsx
 * @description The session page's camera tile reconnects on its own — also, and
 *              especially, while a recording runs (TASK-401). TASK-430: in a
 *              picture-in-picture (`compact`) the placeholder names nothing —
 *              the PiP's bar does — and starts below that bar. TASK-448:
 *              a stream `<img>` that leaves the page closes its stream, and
 *              the `error` that closing fires is not a failure.
 * @feature datacollection
 */

import { StrictMode } from 'react';
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

  it('in a PiP (compact) draws the reconnect line and Retry once, below the bar, without the name', async () => {
    fetchCameraTicket.mockRejectedValue(new Error('500'));
    render(<CameraStreamView robotId="g1" cameraName="head_camera" label="Head camera" fit compact isRecording />);
    await flush();
    const placeholder = screen.getByTestId('camera-placeholder');
    expect(placeholder).toHaveTextContent(/^Reconnecting in 1sRetry now$/);
    expect(screen.queryByText('Head camera')).toBeNull();
    expect(screen.queryByText('The recording continues.')).toBeNull();
    // Below the PiP's 30 px bar.
    expect(placeholder.className).toContain('pt-8');
  });

  it('a full-size frame keeps the name and the recording line', async () => {
    fetchCameraTicket.mockRejectedValue(new Error('500'));
    render(<CameraStreamView robotId="g1" cameraName="head_camera" label="Head camera" fit isRecording />);
    await flush();
    expect(screen.getByText('Head camera')).toBeInTheDocument();
    expect(screen.getByText('The recording continues.')).toBeInTheDocument();
  });

  it('does not request a stream for an offline robot', async () => {
    render(<CameraStreamView robotId="g1" cameraName="top" offline />);
    await flush();
    await advance(20_000);
    expect(fetchCameraTicket).not.toHaveBeenCalled();
    expect(screen.getByText('top offline')).toBeInTheDocument();
  });
});

describe('CameraStreamView closes its stream when the <img> leaves (TASK-448)', () => {
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
    vi.restoreAllMocks();
  });

  it('empties src on unmount', async () => {
    const { unmount } = render(<CameraStreamView robotId="g1" cameraName="head_camera" />);
    await flush();
    const img = screen.getByAltText('head_camera camera');
    expect(img.getAttribute('src')).toContain('ticket=t1');

    unmount();
    await flush();
    expect(img.getAttribute('src')).toBe('');
  });

  it('empties src when the robot goes offline', async () => {
    const { rerender } = render(<CameraStreamView robotId="g1" cameraName="head_camera" />);
    await flush();
    const img = screen.getByAltText('head_camera camera');

    rerender(<CameraStreamView robotId="g1" cameraName="head_camera" offline />);
    await flush();
    expect(img.getAttribute('src')).toBe('');
    expect(screen.getByText('head_camera offline')).toBeInTheDocument();
  });

  it('leaves src alone on a re-render with the same URL, also under StrictMode', async () => {
    const { rerender } = render(
      <StrictMode>
        <CameraStreamView robotId="g1" cameraName="head_camera" />
      </StrictMode>,
    );
    await flush();
    const img = screen.getByAltText('head_camera camera');
    const url = img.getAttribute('src');
    expect(url).toContain('ticket=');

    rerender(
      <StrictMode>
        <CameraStreamView robotId="g1" cameraName="head_camera" className="ring-1" isRecording />
      </StrictMode>,
    );
    await flush();
    await advance(3000);
    expect(screen.getByAltText('head_camera camera')).toBe(img);
    expect(img.getAttribute('src')).toBe(url);
  });

  it('keeps the new URL after a ticket change on a mounted view', async () => {
    const { rerender } = render(<CameraStreamView robotId="g1" cameraName="head_camera" />);
    await flush();
    const first = screen.getByAltText('head_camera camera');

    rerender(<CameraStreamView robotId="g1" cameraName="head_camera" label="Head" />);
    rerender(<CameraStreamView robotId="g1" cameraName="wrist" label="Head" />);
    await flush();
    const second = screen.getByAltText('Head camera');
    expect(second.getAttribute('src')).toContain('ticket=t2');
    expect(first.getAttribute('src')).toBe('');

    await advance(3000);
    expect(second.getAttribute('src')).toContain('ticket=t2');
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('an emptied src firing error after unmount starts no retry and warns about nothing', async () => {
    const consoleError = vi.spyOn(console, 'error');
    const { unmount } = render(<CameraStreamView robotId="g1" cameraName="head_camera" />);
    await flush();
    const img = screen.getByAltText('head_camera camera');
    unmount();
    await flush();

    fireEvent.error(img);
    await advance(20_000);
    await flush();
    expect(fetchCameraTicket).toHaveBeenCalledTimes(1);
    expect(consoleError).not.toHaveBeenCalled();
  });

  it('an emptied src firing error does not fail the URL that replaced it', async () => {
    const { rerender } = render(<CameraStreamView robotId="g1" cameraName="head_camera" />);
    await flush();
    const old = screen.getByAltText('head_camera camera');

    rerender(<CameraStreamView robotId="g1" cameraName="head_camera" offline />);
    await flush();
    rerender(<CameraStreamView robotId="g1" cameraName="head_camera" />);
    await flush();
    const current = screen.getByAltText('head_camera camera');
    expect(current).not.toBe(old);
    expect(current.getAttribute('src')).toContain('ticket=t2');

    // The old element's closing `error` lands after the new stream is up.
    fireEvent.error(old);
    await advance(20_000);
    await flush();
    expect(screen.getByAltText('head_camera camera')).toBe(current);
    expect(current.getAttribute('src')).toContain('ticket=t2');
    expect(screen.queryByRole('status')).toBeNull();
    expect(fetchCameraTicket).toHaveBeenCalledTimes(2);
  });
});
