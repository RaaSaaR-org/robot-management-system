/**
 * @file UploadedModel.test.tsx
 * @description A model uploaded straight into the instance's storage, as the
 *              registry shows it (TASK-498): name, version, base model, size
 *              and source in the table; the training dataset, metrics, notes
 *              and stored files in its details; and an upload that is still
 *              on its way.
 * @feature deployment
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const api = vi.hoisted(() => ({
  getModelVersionOrigin: vi.fn(),
  listModelFiles: vi.fn(),
  listModelUploads: vi.fn(),
}));

vi.mock('../../api', () => ({ deploymentApi: api }));
// The details modal embeds two panels of other features; neither is under test.
vi.mock('@/features/social', () => ({ SocialPanel: () => null }));
vi.mock('@/features/experiments', () => ({ ModelExperimentsLink: () => null }));

import { ModelBrowser } from '../ModelBrowser';
import { ModelDetailsModal } from '../models/ModelDetailsModal';
import { ModelUploadsPanel } from '../models/ModelUploadsPanel';
import { formatArtifactSize, getBaseModelLabel, getVersionLabel } from '../models/modelDisplay';
import { useDeploymentStore } from '../../store';
import type { ModelFileManifest, ModelUploadSummary, ModelVersion } from '../../types';

const DATASET = '9b7c63ca-fc76-4dd1-aed2-2dada9bdcb64';

function g11(overrides: Partial<ModelVersion> = {}): ModelVersion {
  return {
    id: 'fe89db46-d44b-4edc-8794-cfe95facb611',
    skillId: '',
    trainingJobId: null,
    name: 'GR00T N1.7 AppleToPlate g11',
    sourceKind: 'uploaded',
    modelType: 'vla',
    version: 'g11-step-5000',
    artifactUri: 's3://production-models/uploads/fe89db46-d44b-4edc-8794-cfe95facb611/',
    // What `rmsctl models upload --metrics k=v` sends: free scalar keys, not the
    // per-epoch arrays a training job reports.
    trainingMetrics: { final_loss: 0.0264, steps: 5000, learning_rate: 0.0001 } as unknown as ModelVersion['trainingMetrics'],
    validationMetrics: { success_rate: 0.52, eval_episodes: 50 } as unknown as ModelVersion['validationMetrics'],
    deploymentStatus: 'staging',
    baseModel: 'groot_n1_7',
    datasetId: DATASET,
    notes: '5000 steps, lr 1e-4, batch 128, seed 42',
    artifactSizeBytes: 6_918_209_810,
    artifactFileCount: 15,
    createdAt: '2026-11-13T14:48:02.000Z',
    updatedAt: '2026-11-13T14:48:02.000Z',
    ...overrides,
  };
}

const FILES: ModelFileManifest = {
  modelVersionId: g11().id,
  artifactUri: g11().artifactUri,
  storage: 'rustfs',
  totalBytes: 6_918_209_810,
  fileCount: 3,
  files: [
    { path: 'config.json', size: 2147, sha256: 'a'.repeat(64) },
    { path: 'model-00001-of-00002.safetensors', size: 4_990_519_232, sha256: 'b'.repeat(64) },
    { path: 'processor/statistics.json', size: 4_363_954, sha256: null },
  ],
  nextCursor: null,
};

function details(version: ModelVersion) {
  return render(
    <MemoryRouter>
      <ModelDetailsModal version={version} skillName={null} parentName={null} onClose={() => undefined} />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  useDeploymentStore.setState({ skills: [] });
  api.getModelVersionOrigin.mockResolvedValue({
    trainedOnDataset: { id: DATASET, name: 'NVIDIA AppleToPlate' },
    storage: { uploadId: g11().id, storage: 'rustfs', filesRemovedAt: null },
  });
  api.listModelFiles.mockResolvedValue(FILES);
  api.listModelUploads.mockResolvedValue([]);
});

describe('naming an uploaded model', () => {
  it('names GR00T N1.7 as what it is, and shows a base model it does not know as given', () => {
    expect(getBaseModelLabel({ baseModel: 'groot_n1_7' })).toBe('GR00T N1.7');
    expect(getBaseModelLabel({ baseModel: 'pi0' })).toBe('Pi0');
    expect(getBaseModelLabel({ baseModel: 'some_new_model' })).toBe('some_new_model');
    expect(getBaseModelLabel({ baseModel: null })).toBeNull();
    expect(getBaseModelLabel({})).toBeNull();
  });

  it('prefixes "v" only to a version that starts with a digit', () => {
    expect(getVersionLabel('1.2.0')).toBe('v1.2.0');
    expect(getVersionLabel('2026-09-04-g1-apple-pnp')).toBe('v2026-09-04-g1-apple-pnp');
    expect(getVersionLabel('g11-step-5000')).toBe('g11-step-5000');
  });

  it('writes a size in binary units', () => {
    expect(formatArtifactSize(6_918_209_810)).toBe('6.4 GB');
    expect(formatArtifactSize(4_990_519_232)).toBe('4.6 GB');
    expect(formatArtifactSize(2147)).toBe('2.1 KB');
    expect(formatArtifactSize(0)).toBe('0 B');
  });
});

describe('the registry table', () => {
  it('shows name, version, base model, size and "Uploaded directly"', () => {
    render(<ModelBrowser modelVersions={[g11()]} />);
    const row = screen.getByText('GR00T N1.7 AppleToPlate g11').closest('tr') as HTMLElement;
    expect(within(row).getByText('g11-step-5000 · GR00T N1.7')).toBeInTheDocument();
    expect(within(row).getByText('Uploaded directly')).toBeInTheDocument();
    expect(within(row).getByText('6.4 GB')).toBeInTheDocument();
  });

  it('shows no size for a model that only points somewhere else', () => {
    render(
      <ModelBrowser
        modelVersions={[g11({ sourceKind: 'imported', artifactUri: 'hf://x/y', artifactSizeBytes: null, baseModel: null })]}
      />,
    );
    const row = screen.getByText('GR00T N1.7 AppleToPlate g11').closest('tr') as HTMLElement;
    expect(within(row).getByText('g11-step-5000')).toBeInTheDocument();
    expect(within(row).queryByText(/GB|MB/)).not.toBeInTheDocument();
  });

  it('says how a checkpoint gets here when the registry is empty', () => {
    render(<ModelBrowser modelVersions={[]} />);
    expect(screen.getByText('No models yet')).toBeInTheDocument();
    expect(screen.getByText(/rmsctl models upload <dir> --version <v>/)).toBeInTheDocument();
  });
});

describe('the details of an uploaded model', () => {
  it('shows base model, size, source, notes and metrics', async () => {
    details(g11());
    expect(screen.getByText('Uploaded directly')).toBeInTheDocument();
    expect(screen.getByText('GR00T N1.7')).toBeInTheDocument();
    expect(screen.getByText('6.4 GB in 15 files')).toBeInTheDocument();
    expect(screen.getByText('5000 steps, lr 1e-4, batch 128, seed 42')).toBeInTheDocument();
    // A success rate reads as a share, a loss and a learning rate as numbers.
    expect(screen.getByText('52.0 %')).toBeInTheDocument();
    expect(screen.getByText('0.0264')).toBeInTheDocument();
    expect(screen.getByText('1.0e-4')).toBeInTheDocument();
    await screen.findByRole('list', { name: 'Stored files' });
  });

  it('links to the dataset it was trained on', async () => {
    details(g11());
    const link = await screen.findByRole('link', { name: 'NVIDIA AppleToPlate' });
    expect(link).toHaveAttribute('href', `/datasets/${DATASET}/episodes`);
  });

  it('says so when that dataset is no longer on the instance', async () => {
    api.getModelVersionOrigin.mockResolvedValue({
      trainedOnDataset: null,
      storage: { uploadId: 'u', storage: 'rustfs', filesRemovedAt: null },
    });
    details(g11());
    expect(await screen.findByText('Dataset 9b7c63ca (no longer on this instance)')).toBeInTheDocument();
  });

  it('lists the stored files, largest first, with how to download them', async () => {
    details(g11());
    const list = await screen.findByRole('list', { name: 'Stored files' });
    const items = within(list).getAllByRole('listitem');
    expect(items.map((li) => li.textContent)).toEqual([
      'model-00001-of-00002.safetensors4.6 GB',
      'processor/statistics.json4.2 MB',
      'config.json2.1 KB',
    ]);
    expect(screen.getByText('Files (3)')).toBeInTheDocument();
    expect(screen.getByText(`rmsctl models download ${g11().id}`)).toBeInTheDocument();
    expect(api.listModelFiles).toHaveBeenCalledWith(g11().id);
  });

  it('says the files were removed once the model was deleted, and lists none', async () => {
    api.getModelVersionOrigin.mockResolvedValue({
      trainedOnDataset: null,
      storage: { uploadId: 'u', storage: 'rustfs', filesRemovedAt: '2026-11-14T09:00:00.000Z' },
    });
    details(g11({ deploymentStatus: 'archived' }));
    expect(await screen.findByText(/stored files were removed when this model was deleted/)).toBeInTheDocument();
    expect(screen.getByText('6.4 GB in 15 files — removed')).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Stored files' })).not.toBeInTheDocument();
    expect(api.listModelFiles).not.toHaveBeenCalled();
  });

  it('asks the server nothing about a model that states no dataset and stores nothing here', () => {
    details(g11({ sourceKind: 'imported', artifactSizeBytes: null, artifactFileCount: null, datasetId: null }));
    expect(api.getModelVersionOrigin).not.toHaveBeenCalled();
    expect(api.listModelFiles).not.toHaveBeenCalled();
    expect(screen.queryByText(/^Files/)).not.toBeInTheDocument();
  });
});

describe('uploads on their way', () => {
  afterEach(() => vi.useRealTimers());

  const upload: ModelUploadSummary = {
    uploadId: 'up-1',
    state: 'uploading',
    name: 'GR00T N1.7 AppleToPlate g11',
    version: 'g11-step-5000',
    baseModel: 'groot_n1_7',
    totalBytes: 6_918_209_810,
    totalFiles: 15,
    error: null,
    createdAt: new Date().toISOString(),
    lastActivityAt: new Date().toISOString(),
    expiresAt: null,
  };

  it('renders nothing while no upload is open', async () => {
    const { container } = render(<ModelUploadsPanel />);
    await waitFor(() => expect(api.listModelUploads).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it('shows an open upload and a failed one with its reason', async () => {
    api.listModelUploads.mockResolvedValue([
      upload,
      { ...upload, uploadId: 'up-2', state: 'failed', version: 'bad', error: 'Checksum mismatch for config.json' },
    ]);
    render(<ModelUploadsPanel pollMs={60_000} />);
    expect(await screen.findByText('Uploads in progress')).toBeInTheDocument();
    expect(screen.getByText(/^g11-step-5000 · GR00T N1.7 · 6.4 GB in 15 files/)).toBeInTheDocument();
    expect(screen.getByText('Uploading')).toBeInTheDocument();
    expect(screen.getByText('Failed')).toBeInTheDocument();
    expect(screen.getByText('Checksum mismatch for config.json')).toBeInTheDocument();
  });

  it('tells the page when an upload it showed is gone — it became a model', async () => {
    api.listModelUploads.mockResolvedValueOnce([upload]).mockResolvedValue([]);
    const onSettled = vi.fn();
    render(<ModelUploadsPanel pollMs={20} onSettled={onSettled} />);
    expect(await screen.findByText('Uploads in progress')).toBeInTheDocument();
    await waitFor(() => expect(onSettled).toHaveBeenCalledTimes(1));
    expect(screen.queryByText('Uploads in progress')).not.toBeInTheDocument();
  });
});
