/**
 * @file HFDatasetBrowserModal.test.tsx
 * @description What the import modal shows before it spends a gigabyte, and
 *              what it hears while the POST is still in flight.
 * @feature training
 *
 * Every case here is a TASK-220 defect reproduced against the running app: an
 * import that never passed `includeVideos` and so downloaded no video at all, a
 * progress socket subscribed to only AFTER the POST returned (so a fast failure
 * arrived while nothing was listening and the modal sat on "Importing…"
 * forever), a backdrop click that could abandon a running download, and a
 * search that reported "No datasets found" for a repo that plainly exists.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { HFDatasetBrowserModal } from '../HFDatasetBrowserModal';
import type { HFDatasetPreview } from '../../types';

const listRobotTypes = vi.fn();
const previewHuggingFace = vi.fn();
const importFromHuggingFace = vi.fn();
const searchHuggingFace = vi.fn();

vi.mock('../../api', () => ({
  trainingApi: {
    listRobotTypes: (...a: unknown[]) => listRobotTypes(...a),
    previewHuggingFace: (...a: unknown[]) => previewHuggingFace(...a),
    importFromHuggingFace: (...a: unknown[]) => importFromHuggingFace(...a),
    searchHuggingFace: (...a: unknown[]) => searchHuggingFace(...a),
  },
}));

/** Records every socket that gets opened, and lets a test push frames down it. */
class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;

  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this);
  }

  close(): void {
    this.closed = true;
  }

  emit(payload: unknown): void {
    this.onmessage?.({ data: JSON.stringify(payload) });
  }
}

vi.stubGlobal('WebSocket', FakeWebSocket);

/** The real numbers off nvidia/GR00T-N1.7-AppleToPlate. */
function grootPreview(over: Partial<HFDatasetPreview> = {}): HFDatasetPreview {
  return {
    repoId: 'nvidia/GR00T-N1.7-AppleToPlate',
    revision: 'main',
    resolvedRevision: 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678',
    lerobotVersion: 'v2.1',
    robotType: 'unitree_g1',
    fps: 30,
    totalEpisodes: 402,
    totalFrames: 171625,
    stateWidth: 43,
    actionWidth: 43,
    cameraKeys: ['observation.images.ego_view'],
    fileCount: 806,
    dataBytes: 73 * 1024 * 1024,
    videoBytes: 929 * 1024 * 1024,
    license: 'cc-by-4.0',
    ...over,
  };
}

/** Direct Link tab → type the repo → Preview. */
async function openPreview(repoId = 'nvidia/GR00T-N1.7-AppleToPlate'): Promise<void> {
  fireEvent.click(screen.getByRole('tab', { name: 'Direct Link' }));
  fireEvent.change(screen.getByLabelText('HuggingFace Dataset URL or Repo ID'), {
    target: { value: repoId },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
  await screen.findByTestId('hf-preview-step');
}

beforeEach(() => {
  vi.clearAllMocks();
  FakeWebSocket.instances = [];
  listRobotTypes.mockResolvedValue([]);
  previewHuggingFace.mockResolvedValue(grootPreview());
  importFromHuggingFace.mockResolvedValue({ datasetId: 'ds-new' });
  searchHuggingFace.mockResolvedValue([]);
});

describe('what the modal shows before committing to a download', () => {
  it('shows data and video size separately, and the shape of the dataset', async () => {
    render(<HFDatasetBrowserModal isOpen onClose={() => {}} />);
    await openPreview();

    await waitFor(() => expect(screen.getByTestId('hf-preview-facts')).toBeInTheDocument());
    // 73 MB of parquet next to 929 MB of video is the whole decision, and one
    // combined number would have hidden it.
    expect(screen.getByTestId('preview-data-bytes')).toHaveTextContent('73');
    expect(screen.getByTestId('preview-video-bytes')).toHaveTextContent('929');

    const facts = screen.getByTestId('hf-preview-facts');
    expect(facts).toHaveTextContent('v2.1');
    expect(facts).toHaveTextContent('unitree_g1');
    expect(facts).toHaveTextContent('402');
    expect(facts).toHaveTextContent('171,625');
    expect(facts).toHaveTextContent('43');
    expect(facts).toHaveTextContent('observation.images.ego_view');
    expect(facts).toHaveTextContent('cc-by-4.0');
  });

  it('passes includeVideos through to the import', async () => {
    // B3: the modal called `importFromHuggingFace(repoId)` with one argument,
    // so the flag the wrapper accepts was always undefined and the import took
    // the metadata-only path — 73 MB of parquet and none of the video.
    render(<HFDatasetBrowserModal isOpen onClose={() => {}} />);
    await openPreview();
    await screen.findByTestId('hf-preview-facts');

    fireEvent.click(screen.getByRole('button', { name: /^Import/ }));

    await waitFor(() => expect(importFromHuggingFace).toHaveBeenCalled());
    expect(importFromHuggingFace).toHaveBeenCalledWith(
      'nvidia/GR00T-N1.7-AppleToPlate',
      expect.objectContaining({ includeVideos: true })
    );
  });

  it('defaults "Include videos" off for a dataset that has no cameras', async () => {
    previewHuggingFace.mockResolvedValue(grootPreview({ cameraKeys: [], videoBytes: 0 }));
    render(<HFDatasetBrowserModal isOpen onClose={() => {}} />);
    await openPreview();
    await screen.findByTestId('hf-preview-facts');

    expect(screen.getByTestId('include-videos')).not.toBeChecked();
  });

  it('sends the revision and robot-type overrides', async () => {
    listRobotTypes.mockResolvedValue([
      { id: 'rt-g1', name: 'Unitree G1 EDU (Dex3-1)', manufacturer: 'Unitree' },
    ]);
    render(<HFDatasetBrowserModal isOpen onClose={() => {}} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Direct Link' }));
    await waitFor(() => expect(listRobotTypes).toHaveBeenCalled());

    fireEvent.change(screen.getByLabelText('HuggingFace Dataset URL or Repo ID'), {
      target: { value: 'nvidia/GR00T-N1.7-AppleToPlate' },
    });
    fireEvent.change(screen.getByLabelText('Revision'), { target: { value: 'v1.1' } });
    await waitFor(() =>
      expect(screen.getByLabelText('Robot type')).toHaveDisplayValue('Auto-detect from info.json')
    );
    fireEvent.change(screen.getByLabelText('Robot type'), { target: { value: 'rt-g1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }));

    await screen.findByTestId('hf-preview-facts');
    expect(previewHuggingFace).toHaveBeenCalledWith('nvidia/GR00T-N1.7-AppleToPlate', 'v1.1');

    fireEvent.click(screen.getByRole('button', { name: /^Import/ }));
    await waitFor(() => expect(importFromHuggingFace).toHaveBeenCalled());
    expect(importFromHuggingFace).toHaveBeenCalledWith(
      'nvidia/GR00T-N1.7-AppleToPlate',
      expect.objectContaining({ revision: 'v1.1', robotTypeId: 'rt-g1' })
    );
  });
});

describe('the progress socket', () => {
  it('is open before the POST is issued', async () => {
    let socketsWhenPosted = -1;
    importFromHuggingFace.mockImplementation(() => {
      socketsWhenPosted = FakeWebSocket.instances.length;
      return new Promise(() => { /* never settles */ });
    });

    render(<HFDatasetBrowserModal isOpen onClose={() => {}} />);
    await openPreview();
    await screen.findByTestId('hf-preview-facts');
    fireEvent.click(screen.getByRole('button', { name: /^Import/ }));

    await waitFor(() => expect(importFromHuggingFace).toHaveBeenCalled());
    expect(socketsWhenPosted).toBe(1);
  });

  it('does not miss a failure that lands before the POST resolves', async () => {
    // The bug this replaces: subscribing after the POST returned meant an
    // import that died in its first second published its failure frame into a
    // socket that did not exist yet, and the modal spun forever.
    let resolvePost: ((value: { datasetId: string }) => void) | undefined;
    importFromHuggingFace.mockImplementation(
      () => new Promise<{ datasetId: string }>((resolve) => { resolvePost = resolve; })
    );

    render(<HFDatasetBrowserModal isOpen onClose={() => {}} />);
    await openPreview();
    await screen.findByTestId('hf-preview-facts');
    fireEvent.click(screen.getByRole('button', { name: /^Import/ }));

    await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));
    FakeWebSocket.instances[0].emit({
      type: 'dataset:import:failed',
      datasetId: 'ds-new',
      error: 'RustFS is unreachable at http://localhost:9000',
    });

    resolvePost?.({ datasetId: 'ds-new' });

    expect(await screen.findByTestId('hf-import-error')).toHaveTextContent(
      'RustFS is unreachable'
    );
  });

  it('ignores frames about somebody else’s import', async () => {
    render(<HFDatasetBrowserModal isOpen onClose={() => {}} />);
    await openPreview();
    await screen.findByTestId('hf-preview-facts');
    fireEvent.click(screen.getByRole('button', { name: /^Import/ }));

    await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));
    await waitFor(() => expect(importFromHuggingFace).toHaveBeenCalled());
    FakeWebSocket.instances[0].emit({
      type: 'dataset:import:failed',
      datasetId: 'some-other-dataset',
      error: 'not ours',
    });

    await waitFor(() => expect(screen.queryByTestId('hf-import-error')).not.toBeInTheDocument());
  });
});

describe('while an import is running', () => {
  it('does not close on Escape', async () => {
    const onClose = vi.fn();
    importFromHuggingFace.mockImplementation(() => new Promise(() => {}));

    render(<HFDatasetBrowserModal isOpen onClose={onClose} />);
    await openPreview();
    await screen.findByTestId('hf-preview-facts');
    fireEvent.click(screen.getByRole('button', { name: /^Import/ }));
    await waitFor(() => expect(importFromHuggingFace).toHaveBeenCalled());

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('still closes on Escape when nothing is running', async () => {
    const onClose = vi.fn();
    render(<HFDatasetBrowserModal isOpen onClose={onClose} />);
    await waitFor(() => expect(listRobotTypes).toHaveBeenCalled());

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });
});

describe('search', () => {
  it('widens to an unfiltered search when the lerobot tag finds nothing, and says so', async () => {
    // Searching "AppleToPlate" reported "No datasets found" for a dataset that
    // plainly exists: the repo is a LeRobot v2.1 dataset that does not carry
    // the `lerobot` tag the query hardcoded.
    searchHuggingFace
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'nvidia/GR00T-N1.7-AppleToPlate', downloads: 12 }]);

    render(<HFDatasetBrowserModal isOpen onClose={() => {}} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Search' }));
    fireEvent.change(screen.getByPlaceholderText(/Search Hub datasets/), {
      target: { value: 'AppleToPlate' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));

    expect(await screen.findByText('nvidia/GR00T-N1.7-AppleToPlate')).toBeInTheDocument();
    expect(searchHuggingFace).toHaveBeenNthCalledWith(1, 'AppleToPlate', true);
    expect(searchHuggingFace).toHaveBeenNthCalledWith(2, 'AppleToPlate', false);
    expect(screen.getByTestId('search-widened')).toBeInTheDocument();
  });

  it('does not widen when the filtered search already found something', async () => {
    searchHuggingFace.mockResolvedValue([{ id: 'lerobot/pusht', downloads: 3 }]);

    render(<HFDatasetBrowserModal isOpen onClose={() => {}} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Search' }));
    fireEvent.change(screen.getByPlaceholderText(/Search Hub datasets/), {
      target: { value: 'pusht' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));

    expect(await screen.findByText('lerobot/pusht')).toBeInTheDocument();
    expect(searchHuggingFace).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('search-widened')).not.toBeInTheDocument();
  });
});
