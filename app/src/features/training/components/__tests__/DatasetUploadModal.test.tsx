/**
 * @file DatasetUploadModal.test.tsx
 * @description The upload dialog on the direct upload API (TASK-481): what it
 *              shows about a folder before anything is sent, which folders it
 *              refuses, how a server refusal reads, and what closing and
 *              cancelling do to an upload that is running.
 * @feature training
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import { DatasetUploadModal } from '../DatasetUploadModal';
import { UploadRefusal, type PartAck, type PartRequest } from '../../api/datasetUploadApi';
import { resetDatasetUploadStore, useDatasetUploadStore } from '../../store/datasetUploadStore';
import { useTrainingStore } from '../../store/trainingStore';

const api = vi.hoisted(() => ({
  start: vi.fn(), status: vi.fn(), finish: vi.fn(), cancel: vi.fn(), sendPart: vi.fn(),
}));
const training = vi.hoisted(() => ({ listRobotTypes: vi.fn(), getDataset: vi.fn() }));
const confirmMock = vi.hoisted(() => vi.fn());

vi.mock('../../api/datasetUploadApi', async (original) => ({
  ...(await original<typeof import('../../api/datasetUploadApi')>()),
  datasetUploadApi: api,
}));
vi.mock('../../api/trainingApi', () => ({ trainingApi: training }));
vi.mock('@/shared/components/ui', async (original) => ({
  ...(await original<typeof import('@/shared/components/ui')>()),
  confirm: confirmMock,
}));

const CHUNK = 10;
const INFO = {
  codebase_version: 'v3.0', robot_type: 'unitree_g1_dex3', fps: 30,
  total_episodes: 80, total_frames: 55695,
  features: {
    action: { dtype: 'float32', shape: [31] },
    'observation.state': { dtype: 'float32', shape: [31] },
    'observation.images.head': { dtype: 'video' },
    'observation.images.wrist': { dtype: 'video' },
  },
};

/** A file as a directory input hands it over, readable in jsdom. */
function picked(relativePath: string, content: string, size = content.length): File {
  const file = new File([content], relativePath.split('/').pop()!);
  Object.defineProperties(file, {
    webkitRelativePath: { value: relativePath },
    size: { value: size },
    text: { value: () => Promise.resolve(content) },
    slice: { value: (start: number, end: number) => ({ arrayBuffer: () => Promise.resolve(new ArrayBuffer(end - start)) }) },
  });
  return file;
}

const DATASET = () => [
  picked('bottles/README.md', 'read me'),
  picked('bottles/meta/info.json', JSON.stringify(INFO)),
  picked('bottles/meta/episodes/chunk-000/file-000.parquet', 'e'),
  picked('bottles/data/chunk-000/file-000.parquet', 'd'),
  picked('bottles/videos/observation.images.head/chunk-000/file-000.mp4', 'v', 25),
];

/** The start answer for `DATASET()`: ids in manifest order, parts of ten bytes. */
function started() {
  const files = [
    { path: 'data/chunk-000/file-000.parquet', size: 1 },
    { path: 'meta/episodes/chunk-000/file-000.parquet', size: 1 },
    { path: 'meta/info.json', size: JSON.stringify(INFO).length },
    { path: 'videos/observation.images.head/chunk-000/file-000.mp4', size: 25 },
  ].map((f, id) => ({ ...f, id, partCount: Math.max(1, Math.ceil(f.size / CHUNK)) }));
  return {
    datasetId: 'ds1', status: 'uploading', state: 'uploading', robotTypeId: 'rt1', storage: 'rustfs',
    chunkSize: CHUNK, totalBytes: files.reduce((n, f) => n + f.size, 0), files, ignored: [],
    idleTimeoutSeconds: 21600, expiresAt: null,
  };
}

const ack = (req: PartRequest): PartAck => ({
  fileId: req.fileId, partNumber: req.partNumber, size: (req.body as ArrayBuffer).byteLength,
});

/** A part request that stays in flight until the upload is stopped. */
const hang = (req: PartRequest) => new Promise<PartAck>((_resolve, reject) => {
  req.signal?.addEventListener('abort', () => reject(new UploadRefusal({ status: 0, code: 'ABORTED', message: 'stopped' })));
});

function open(): void {
  render(<DatasetUploadModal />);
  act(() => useDatasetUploadStore.getState().openDialog());
}

async function pick(files: File[]): Promise<void> {
  fireEvent.change(screen.getByTestId('upload-folder-input'), { target: { files } });
  await waitFor(() => expect(screen.getByTestId('upload-folder-facts')).toBeInTheDocument());
}

beforeEach(() => {
  vi.clearAllMocks();
  resetDatasetUploadStore();
  useTrainingStore.setState({ datasets: [] });
  training.listRobotTypes.mockResolvedValue([{ id: 'rt1', name: 'Unitree G1 EDU (Dex3-1)', manufacturer: 'Unitree' }]);
  training.getDataset.mockResolvedValue({ id: 'ds1', name: 'bottles', status: 'uploading' });
  api.start.mockResolvedValue(started());
  api.finish.mockResolvedValue({ datasetId: 'ds1', state: 'processing', status: 'uploading' });
  api.status.mockResolvedValue({ datasetId: 'ds1', state: 'completed', status: 'ready', files: [], importError: null });
  api.cancel.mockResolvedValue({ datasetId: 'ds1', status: 'cancelled' });
  api.sendPart.mockImplementation(async (req: PartRequest) => ack(req));
  confirmMock.mockResolvedValue(true);
});

afterEach(() => resetDatasetUploadStore());

describe('DatasetUploadModal', () => {
  it('asks for a folder, not a file', () => {
    open();
    const input = screen.getByTestId('upload-folder-input');
    expect(input).toHaveAttribute('webkitdirectory');
    expect(screen.getByRole('button', { name: 'Choose folder' })).toBeInTheDocument();
    // Nothing to upload yet.
    expect(screen.getByTestId('upload-start')).toBeDisabled();
  });

  it('shows what the folder holds before anything is sent', async () => {
    open();
    await pick(DATASET());

    const facts = screen.getByTestId('upload-folder-facts');
    expect(facts).toHaveTextContent('bottles');
    expect(facts).toHaveTextContent('LeRobot v3.0');
    expect(facts).toHaveTextContent('80');
    expect(facts).toHaveTextContent('55,695');
    expect(facts).toHaveTextContent('30 fps');
    expect(facts).toHaveTextContent('2 (head, wrist)');
    expect(screen.getByTestId('upload-folder-files')).toHaveTextContent('4 files to upload');
    expect(screen.getByTestId('upload-folder-files')).toHaveTextContent('1 other file is not part of the dataset');
    // The folder's name is the default dataset name; the robot type is detected.
    expect(screen.getByTestId('upload-name')).toHaveValue('bottles');
    expect(screen.getByTestId('upload-robot-type')).toHaveTextContent('Auto-detect (unitree_g1_dex3)');
    expect(screen.getByTestId('upload-start')).toBeEnabled();

    expect(api.start).not.toHaveBeenCalled();
    expect(api.sendPart).not.toHaveBeenCalled();
  });

  it('flags a folder that is not a LeRobot dataset and does not let it be uploaded', async () => {
    open();
    await pick([picked('holiday/a.mp4', 'v'), picked('holiday/b.mp4', 'v')]);

    expect(screen.getByTestId('upload-folder-problems')).toHaveTextContent('No meta/info.json in this folder');
    expect(screen.getByTestId('upload-start')).toBeDisabled();
    expect(screen.queryByTestId('upload-name')).not.toBeInTheDocument();
  });

  it('takes a folder dropped on it', async () => {
    open();
    const fileEntry = (file: File) => ({
      isFile: true, isDirectory: false, name: file.name,
      fullPath: `/${(file as File & { webkitRelativePath: string }).webkitRelativePath}`,
      file: (ok: (f: File) => void) => ok(file),
    });
    const queue = [DATASET().map(fileEntry), []];
    const folder = {
      isFile: false, isDirectory: true, name: 'bottles', fullPath: '/bottles',
      createReader: () => ({ readEntries: (ok: (entries: unknown[]) => void) => ok(queue.shift() ?? []) }),
    };
    fireEvent.drop(screen.getByTestId('upload-dropzone'), {
      dataTransfer: { items: [{ kind: 'file', webkitGetAsEntry: () => folder }], files: [] },
    });

    await waitFor(() => expect(screen.getByTestId('upload-folder-facts')).toHaveTextContent('LeRobot v3.0'));
    expect(screen.getByTestId('upload-folder-files')).toHaveTextContent('4 files to upload');
  });

  it('declares only the dataset files, with name, description and robot type', async () => {
    api.sendPart.mockImplementation(hang);
    open();
    await pick(DATASET());
    fireEvent.change(screen.getByTestId('upload-name'), { target: { value: 'bottle sorting' } });
    fireEvent.change(screen.getByPlaceholderText('What was recorded, and how'), { target: { value: 'Sim, 80 episodes' } });
    await waitFor(() => expect(screen.getByRole('option', { name: 'Unitree G1 EDU (Dex3-1)' })).toBeInTheDocument());
    fireEvent.change(screen.getByTestId('upload-robot-type'), { target: { value: 'rt1' } });
    fireEvent.click(screen.getByTestId('upload-start'));

    await waitFor(() => expect(api.start).toHaveBeenCalledTimes(1));
    const input = api.start.mock.calls[0][0];
    expect(input).toMatchObject({ name: 'bottle sorting', description: 'Sim, 80 episodes', robotTypeId: 'rt1', info: INFO });
    expect(input.chunkSize).toBe(8 * 1024 * 1024);
    expect(input.files.map((f: { path: string }) => f.path)).toEqual([
      'data/chunk-000/file-000.parquet',
      'meta/episodes/chunk-000/file-000.parquet',
      'meta/info.json',
      'videos/observation.images.head/chunk-000/file-000.mp4',
    ]);
  });

  it('leaves the robot type to the server unless one is picked', async () => {
    api.sendPart.mockImplementation(hang);
    open();
    await pick(DATASET());
    fireEvent.click(screen.getByTestId('upload-start'));
    await waitFor(() => expect(api.start).toHaveBeenCalledTimes(1));
    expect(api.start.mock.calls[0][0].robotTypeId).toBeUndefined();
  });

  it('wants a name', async () => {
    open();
    await pick(DATASET());
    fireEvent.change(screen.getByTestId('upload-name'), { target: { value: '  ' } });
    fireEvent.click(screen.getByTestId('upload-start'));
    expect(await screen.findByText('Give the dataset a name.')).toBeInTheDocument();
    expect(api.start).not.toHaveBeenCalled();
  });

  it('shows a refused start with the server\'s sentence, code and context, and keeps the form', async () => {
    api.start.mockRejectedValue(new UploadRefusal({
      status: 413, code: 'UPLOAD_TOO_LARGE',
      message: 'This upload declares 12.0 GB; the limit is 10.0 GB.',
      context: { totalBytes: 12884901888, maxBytes: 10737418240 },
    }));
    open();
    await pick(DATASET());
    fireEvent.click(screen.getByTestId('upload-start'));

    const block = await screen.findByTestId('upload-start-error');
    expect(block).toHaveTextContent('This upload declares 12.0 GB; the limit is 10.0 GB.');
    expect(block).toHaveTextContent('UPLOAD_TOO_LARGE (HTTP 413)');
    expect(block).toHaveTextContent('Limit');
    expect(block).toHaveTextContent('10737418240');
    // Nothing was created, nothing is running, and the folder is still picked.
    expect(useDatasetUploadStore.getState().job).toBeNull();
    expect(screen.getByTestId('upload-name')).toHaveValue('bottles');
    expect(api.sendPart).not.toHaveBeenCalled();
  });

  it('shows overall and per-file progress while it sends', async () => {
    api.sendPart.mockImplementation(hang);
    open();
    await pick(DATASET());
    fireEvent.click(screen.getByTestId('upload-start'));

    await waitFor(() => expect(screen.getByTestId('upload-run')).toBeInTheDocument());
    expect(screen.getByTestId('upload-overall')).toHaveTextContent('of 4 files');
    expect(screen.getAllByTestId('upload-file')).toHaveLength(4);
    expect(screen.getByTestId('upload-files')).toHaveTextContent('videos/observation.images.head/chunk-000/file-000.mp4');
    // Never more than three requests at once, however many parts wait.
    await waitFor(() => expect(api.sendPart).toHaveBeenCalledTimes(3));
    expect(screen.getByTestId('upload-background-note')).toHaveTextContent('the upload keeps running');
  });

  it('sends every part, finishes, and hands over to the dataset\'s row', async () => {
    // The verdict is still out when finish is accepted.
    api.status.mockResolvedValue({ datasetId: 'ds1', state: 'completed', status: 'validating', files: [], importError: null });
    training.getDataset.mockResolvedValue({ id: 'ds1', name: 'bottles', status: 'validating' });
    open();
    await pick(DATASET());
    fireEvent.click(screen.getByTestId('upload-start'));

    await waitFor(() => expect(api.finish).toHaveBeenCalledWith('ds1'));
    // Every part of every file, once.
    expect(api.sendPart).toHaveBeenCalledTimes(started().files.reduce((n, f) => n + f.partCount, 0));
    const video = api.sendPart.mock.calls.map(([req]) => req as PartRequest).filter((req) => req.fileId === 3);
    expect(video.map((req) => [req.partNumber, (req.body as ArrayBuffer).byteLength]).sort()).toEqual([[1, 10], [2, 10], [3, 5]]);

    // The dialog gets out of the way; the row carries it from here.
    await waitFor(() => expect(screen.queryByTestId('dataset-upload-modal')).not.toBeInTheDocument());
    await waitFor(() => expect(useDatasetUploadStore.getState().job?.phase).toBe('validating'));
    await waitFor(() => expect(useTrainingStore.getState().datasets.map((d) => d.id)).toEqual(['ds1']));
  });

  it('keeps uploading when the dialog is closed', async () => {
    api.sendPart.mockImplementation(hang);
    open();
    await pick(DATASET());
    fireEvent.click(screen.getByTestId('upload-start'));
    await waitFor(() => expect(screen.getByTestId('upload-run')).toBeInTheDocument());

    fireEvent.click(screen.getByTestId('upload-background'));

    await waitFor(() => expect(screen.queryByTestId('dataset-upload-modal')).not.toBeInTheDocument());
    expect(useDatasetUploadStore.getState().job?.phase).toBe('uploading');
    expect(api.cancel).not.toHaveBeenCalled();

    // Opening it again shows the same upload, not an empty form.
    act(() => useDatasetUploadStore.getState().openDialog());
    expect(screen.getByTestId('upload-run')).toBeInTheDocument();
    expect(screen.queryByTestId('upload-dropzone')).not.toBeInTheDocument();
  });

  it('cancels on the server only after asking, and leaves nothing behind', async () => {
    api.sendPart.mockImplementation(hang);
    useTrainingStore.setState({ datasets: [{ id: 'ds1', name: 'bottles' } as never] });
    open();
    await pick(DATASET());
    fireEvent.click(screen.getByTestId('upload-start'));
    await waitFor(() => expect(screen.getByTestId('upload-run')).toBeInTheDocument());

    confirmMock.mockResolvedValueOnce(false);
    fireEvent.click(screen.getByTestId('upload-cancel'));
    await waitFor(() => expect(confirmMock).toHaveBeenCalledTimes(1));
    expect(api.cancel).not.toHaveBeenCalled();
    expect(useDatasetUploadStore.getState().job?.phase).toBe('uploading');

    fireEvent.click(screen.getByTestId('upload-cancel'));
    await waitFor(() => expect(api.cancel).toHaveBeenCalledWith('ds1'));
    await waitFor(() => expect(useDatasetUploadStore.getState().job).toBeNull());
    expect(screen.queryByTestId('dataset-upload-modal')).not.toBeInTheDocument();
    expect(useTrainingStore.getState().datasets).toEqual([]);
  });

  it('shows why an upload stopped and resumes with only what the server does not hold', async () => {
    api.sendPart.mockImplementation(async (req: PartRequest) => {
      if (req.fileId === 3 && req.partNumber === 2) {
        throw new UploadRefusal({
          status: 400, code: 'PART_SIZE_MISMATCH',
          message: 'Part 2 must be exactly 10 bytes.', context: { expectedSize: 10 },
        });
      }
      return ack(req);
    });
    open();
    await pick(DATASET());
    fireEvent.click(screen.getByTestId('upload-start'));

    const block = await screen.findByTestId('upload-error');
    expect(block).toHaveTextContent('Part 2 must be exactly 10 bytes.');
    expect(block).toHaveTextContent('PART_SIZE_MISMATCH (HTTP 400)');
    expect(block).toHaveTextContent('Expected size');
    expect(api.finish).not.toHaveBeenCalled();

    // The server holds everything but that one part.
    const files = started().files.map((f) => ({
      ...f, complete: f.id !== 3, receivedParts: f.id === 3 ? [1, 3] : [],
    }));
    api.status
      .mockResolvedValueOnce({ datasetId: 'ds1', state: 'uploading', status: 'uploading', chunkSize: CHUNK, files, importError: null })
      .mockResolvedValue({ datasetId: 'ds1', state: 'completed', status: 'ready', files: [], importError: null });
    api.sendPart.mockClear();
    api.sendPart.mockImplementation(async (req: PartRequest) => ack(req));
    fireEvent.click(screen.getByTestId('upload-resume'));

    await waitFor(() => expect(api.finish).toHaveBeenCalledWith('ds1'));
    expect(api.sendPart.mock.calls.map(([req]) => [(req as PartRequest).fileId, (req as PartRequest).partNumber])).toEqual([[3, 2]]);
    // Ready: the upload is over and the dialog is gone.
    await waitFor(() => expect(useDatasetUploadStore.getState().job).toBeNull());
    expect(screen.queryByTestId('dataset-upload-modal')).not.toBeInTheDocument();
  });

  it('ends without an error when the dataset is deleted under the upload', async () => {
    // Deleted from its row while parts were going up: the server no longer knows it.
    api.sendPart.mockRejectedValue(new UploadRefusal({ status: 404, code: 'NOT_FOUND', message: 'Dataset not found' }));
    useTrainingStore.setState({ datasets: [{ id: 'ds1', name: 'bottles' } as never] });
    open();
    await pick(DATASET());
    fireEvent.click(screen.getByTestId('upload-start'));

    await waitFor(() => expect(api.sendPart).toHaveBeenCalled());
    await waitFor(() => expect(useDatasetUploadStore.getState().job).toBeNull());
    // Nothing to try again and nothing to cancel: no stopped upload is left behind.
    expect(screen.queryByTestId('upload-error')).not.toBeInTheDocument();
    expect(screen.queryByTestId('dataset-upload-modal')).not.toBeInTheDocument();
    expect(useTrainingStore.getState().datasets).toEqual([]);
    expect(api.cancel).not.toHaveBeenCalled();
    expect(api.finish).not.toHaveBeenCalled();
  });

  it('ends a stopped upload whose dataset is gone when it is tried again', async () => {
    api.sendPart.mockRejectedValue(new UploadRefusal({ status: 400, code: 'PART_SIZE_MISMATCH', message: 'Wrong size.' }));
    open();
    await pick(DATASET());
    fireEvent.click(screen.getByTestId('upload-start'));
    await screen.findByTestId('upload-error');

    api.status.mockRejectedValue(new UploadRefusal({ status: 404, code: 'NOT_FOUND', message: 'Dataset not found' }));
    fireEvent.click(screen.getByTestId('upload-resume'));
    await waitFor(() => expect(useDatasetUploadStore.getState().job).toBeNull());
    expect(screen.queryByTestId('dataset-upload-modal')).not.toBeInTheDocument();
  });

  it('does not report a failure for a finish that a cancel overtook', async () => {
    let refuseFinish: (error: unknown) => void = () => {};
    api.finish.mockImplementation(() => new Promise((_resolve, reject) => { refuseFinish = reject; }));
    let answerCancel: (value: unknown) => void = () => {};
    api.cancel.mockImplementation(() => new Promise((resolve) => { answerCancel = resolve; }));
    open();
    await pick(DATASET());
    fireEvent.click(screen.getByTestId('upload-start'));
    await waitFor(() => expect(useDatasetUploadStore.getState().job?.phase).toBe('finishing'));

    fireEvent.click(screen.getByTestId('upload-cancel'));
    await waitFor(() => expect(api.cancel).toHaveBeenCalledWith('ds1'));
    // The server cancelled first; the finish that was on its way is refused.
    await act(async () => {
      refuseFinish(new UploadRefusal({ status: 409, code: 'UPLOAD_NOT_ACCEPTING', message: 'The upload was cancelled.' }));
      await Promise.resolve();
    });
    expect(useDatasetUploadStore.getState().job?.phase).toBe('cancelling');
    expect(screen.queryByTestId('upload-error')).not.toBeInTheDocument();

    await act(async () => { answerCancel({ datasetId: 'ds1', status: 'cancelled' }); });
    await waitFor(() => expect(useDatasetUploadStore.getState().job).toBeNull());
  });

  it('follows the verdict once when finish was accepted before a cancel arrived', async () => {
    let acceptFinish: (value: unknown) => void = () => {};
    api.finish.mockImplementation(() => new Promise((resolve) => { acceptFinish = resolve; }));
    api.cancel.mockRejectedValue(new UploadRefusal({ status: 409, code: 'UPLOAD_PROCESSING', message: 'Finish was accepted.' }));
    api.status.mockResolvedValue({ datasetId: 'ds1', state: 'processing', status: 'uploading', files: [], importError: null });
    open();
    await pick(DATASET());
    fireEvent.click(screen.getByTestId('upload-start'));
    await waitFor(() => expect(useDatasetUploadStore.getState().job?.phase).toBe('finishing'));

    fireEvent.click(screen.getByTestId('upload-cancel'));
    await waitFor(() => expect(useDatasetUploadStore.getState().job?.phase).toBe('processing'));
    await act(async () => { acceptFinish({ datasetId: 'ds1', state: 'processing', status: 'uploading' }); });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)); });

    // One poll loop: the cancel's hand-over and the finish's are the same upload.
    expect(api.status).toHaveBeenCalledTimes(1);
    expect(useDatasetUploadStore.getState().job?.phase).toBe('processing');
  });
});
