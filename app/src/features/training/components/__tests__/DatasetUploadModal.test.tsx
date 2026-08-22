/**
 * @file DatasetUploadModal.test.tsx
 * @description What the wizard does while the server is still working, and what
 *              it says when it cannot find out.
 * @feature training
 *
 * The modal had no tests. Every case here is one the TASK-217 review
 * reproduced against the running app: a successful upload reported as failed, a
 * poll that kept running after the modal was closed, a green tick painted over
 * sixty consecutive failed status queries, and a robot-types fetch whose
 * failure was swallowed.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import { DatasetUploadModal } from '../DatasetUploadModal';
import type { Dataset } from '../../types';

const listRobotTypes = vi.fn();
const createDataset = vi.fn();
const initiateUpload = vi.fn();
const completeUpload = vi.fn();
const getDataset = vi.fn();

vi.mock('../../api', () => ({
  trainingApi: {
    listRobotTypes: (...a: unknown[]) => listRobotTypes(...a),
    createDataset: (...a: unknown[]) => createDataset(...a),
    initiateUpload: (...a: unknown[]) => initiateUpload(...a),
    completeUpload: (...a: unknown[]) => completeUpload(...a),
    getDataset: (...a: unknown[]) => getDataset(...a),
  },
}));

// The PUT to the presigned URL. Not the subject here.
vi.stubGlobal('XMLHttpRequest', class {
  upload = { addEventListener: () => {} };
  addEventListener(event: string, fn: () => void) { if (event === 'load') this.onload = fn; }
  onload: (() => void) | null = null;
  status = 200;
  open() {}
  setRequestHeader() {}
  send() { queueMicrotask(() => this.onload?.()); }
});

function ready(over: Partial<Dataset> = {}): Dataset {
  return {
    id: 'ds1', name: 'Stub', robotTypeId: 'rt1', storagePath: '/x/',
    lerobotVersion: 'v3.0', fps: 10.12, totalFrames: 1234, totalDuration: 121.9,
    demonstrationCount: 1, qualityScore: 70,
    infoJson: {} as Dataset['infoJson'], statsJson: {} as Dataset['statsJson'],
    status: 'ready', createdAt: '2026-08-23T00:00:00.000Z', updatedAt: '2026-08-23T00:00:00.000Z',
    ...over,
  };
}

/** Fill step 1, pick the file, and press Upload. */
async function startUpload(): Promise<void> {
  await waitFor(() => expect(screen.getByRole('combobox')).toBeInTheDocument());
  fireEvent.change(screen.getByPlaceholderText('e.g., pick-and-place-v1'), {
    target: { value: 'Stub' },
  });
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'rt1' } });
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

  const file = new File(['x'], 'probe.tar.gz', { type: 'application/gzip' });
  const input = document.querySelector('input[type=file]') as HTMLInputElement;
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  fireEvent.change(input);
  fireEvent.click(await screen.findByRole('button', { name: 'Upload' }));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ shouldAdvanceTime: true });
  listRobotTypes.mockResolvedValue([{ id: 'rt1', name: 'G1 EDU', manufacturer: 'Unitree' }]);
  createDataset.mockResolvedValue({ id: 'ds1', name: 'Stub', status: 'uploading' });
  initiateUpload.mockResolvedValue({ uploadUrl: 'http://x/put', objectKey: 'k' });
  completeUpload.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('while the server is still working', () => {
  it('does not report a failed upload when the completion request times out', async () => {
    // `upload/complete` now downloads the archive, unpacks it and (without
    // NATS) validates it inside the request. The shared axios client aborted at
    // 30 s, and treating that rejection as a failed upload reported "Upload
    // failed" for every upload big enough to be worth making — while the server
    // finished the job and the row went `ready`.
    completeUpload.mockRejectedValue(new Error('timeout of 30000ms exceeded'));
    getDataset.mockResolvedValue(ready());

    render(<DatasetUploadModal isOpen onClose={() => {}} />);
    await startUpload();

    expect(await screen.findByTestId('upload-complete')).toBeInTheDocument();
    expect(screen.queryByText(/timeout of 30000ms/)).not.toBeInTheDocument();
    expect(screen.getByText(/1 episode, 1,234 frames/)).toBeInTheDocument();
  });

  it('says "1 episode", and formats the frame count in the UI locale', async () => {
    // Was `${n} episodes` unconditionally, and a bare `toLocaleString()` — which
    // on a de-DE machine renders 1234 as "1.234" inside an English sentence.
    getDataset.mockResolvedValue(ready());
    render(<DatasetUploadModal isOpen onClose={() => {}} />);
    await startUpload();
    expect(await screen.findByText(/1 episode, 1,234 frames/)).toBeInTheDocument();
  });

  it('surfaces a completion failure when the row never left `uploading`', async () => {
    // The one case that IS a failed upload: nothing on the server took the
    // archive. Reported straight away rather than after the poll's full minute.
    completeUpload.mockRejectedValue(new Error('unpack exploded'));
    getDataset.mockResolvedValue(ready({ status: 'uploading' }));

    render(<DatasetUploadModal isOpen onClose={() => {}} />);
    await startUpload();

    expect(await screen.findByText('unpack exploded')).toBeInTheDocument();
    expect(screen.queryByTestId('upload-complete')).not.toBeInTheDocument();
  });
});

describe('when the status cannot be read at all', () => {
  it('does not paint the green tick over sixty failed queries', async () => {
    // The catch returned `null`, `null` fell into the success branch, and the
    // modal asserted "Still validating — it will finish in the background"
    // without one successful reply to base it on.
    getDataset.mockRejectedValue(new Error('status unavailable'));

    render(<DatasetUploadModal isOpen onClose={() => {}} />);
    await startUpload();

    await act(async () => { await vi.advanceTimersByTimeAsync(61_000); });

    expect(await screen.findByTestId('upload-status-unknown')).toBeInTheDocument();
    expect(screen.queryByTestId('upload-complete')).not.toBeInTheDocument();
    expect(screen.getByText(/status unavailable/)).toBeInTheDocument();
  });
});

describe('closing the modal mid-upload', () => {
  it('stops the poll instead of writing its result into a closed modal', async () => {
    // The loop had no cancellation link to the component, and `Modal` only
    // returns null when closed — so the poll kept firing, then set
    // `step: 'complete'`, and the NEXT open landed on the previous upload's
    // result screen instead of the metadata form.
    getDataset.mockResolvedValue(ready({ status: 'validating' }));
    const onClose = vi.fn();

    render(<DatasetUploadModal isOpen onClose={onClose} />);
    await startUpload();
    await act(async () => { await vi.advanceTimersByTimeAsync(3_000); });
    const during = getDataset.mock.calls.length;
    expect(during).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await act(async () => { await vi.advanceTimersByTimeAsync(6_000); });

    expect(onClose).toHaveBeenCalled();
    expect(getDataset.mock.calls.length).toBe(during);
  });
});

describe('the robot type select', () => {
  it('says the fetch failed instead of leaving an empty required field', async () => {
    // Swallowed with `.catch(() => setFetchedTypes([]))`, so the operator got
    // "Please fill in all required fields" about a field with nothing in it.
    listRobotTypes.mockRejectedValue(new Error('boom'));
    render(<DatasetUploadModal isOpen onClose={() => {}} />);
    expect(await screen.findByTestId('robot-types-error')).toHaveTextContent('boom');
  });

  it('distinguishes "none registered" from "could not load"', async () => {
    listRobotTypes.mockResolvedValue([]);
    render(<DatasetUploadModal isOpen onClose={() => {}} />);
    expect(await screen.findByTestId('robot-types-empty')).toBeInTheDocument();
    expect(screen.queryByTestId('robot-types-error')).not.toBeInTheDocument();
  });
});
