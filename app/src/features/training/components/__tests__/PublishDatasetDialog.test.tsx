/**
 * @file PublishDatasetDialog.test.tsx
 * @description The Hugging Face publish dialog (TASK-394): prefilled from the
 *              server's account and the dataset name, private by default,
 *              progress then link, the degraded-data gate, and no token.
 * @feature training
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { PublishDatasetDialog, repoNameFrom } from '../PublishDatasetDialog';
import type { DatasetPublishJob, HubPublishStatus } from '../../types';

const getHubPublishStatus = vi.fn();
const getDatasetPublish = vi.fn();
const publishDataset = vi.fn();
const getDataset = vi.fn();

vi.mock('../../api', () => ({
  trainingApi: {
    getHubPublishStatus: (...a: unknown[]) => getHubPublishStatus(...a),
    getDatasetPublish: (...a: unknown[]) => getDatasetPublish(...a),
    publishDataset: (...a: unknown[]) => publishDataset(...a),
    getDataset: (...a: unknown[]) => getDataset(...a),
  },
}));

const STATUS: HubPublishStatus = {
  configured: true,
  source: 'file',
  user: 'huhn511',
  orgs: ['zemarobotik'],
  defaultNamespace: 'zemarobotik',
};

function job(over: Partial<DatasetPublishJob> = {}): DatasetPublishJob {
  return {
    datasetId: 'ds-1',
    repoId: 'zemarobotik/g1-pick-apple',
    private: true,
    license: 'apache-2.0',
    status: 'running',
    phase: 'uploading',
    message: 'Uploading 6 files',
    filesTotal: 6,
    filesDone: 2,
    bytesTotal: 2048,
    bytesDone: 1024,
    card: 'generated',
    repoCreated: true,
    url: 'https://huggingface.co/datasets/zemarobotik/g1-pick-apple',
    warnings: [],
    forced: false,
    startedAt: '2026-10-17T12:00:00.000Z',
    ...over,
  };
}

function apiError(message: string, code: string, statusCode = 409) {
  return Object.assign(new Error(message), { code, statusCode });
}

function renderDialog(props: Partial<Parameters<typeof PublishDatasetDialog>[0]> = {}) {
  return render(
    <PublishDatasetDialog isOpen onClose={vi.fn()} datasetId="ds-1" datasetName="G1 Pick Apple" {...props} />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  getHubPublishStatus.mockResolvedValue(STATUS);
  getDatasetPublish.mockResolvedValue({ status: 'none' });
});

describe('PublishDatasetDialog', () => {
  it('prefills the repo from the default namespace and the dataset name, private by default', async () => {
    renderDialog();
    await waitFor(() => expect(screen.getByDisplayValue('zemarobotik/g1-pick-apple')).toBeInTheDocument());
    expect(screen.getByTestId('publish-account')).toHaveTextContent('huhn511');
    expect(screen.getByRole('switch', { name: /Private repository/ })).toHaveAttribute('aria-checked', 'true');
  });

  it('fetches the dataset name when the caller has none', async () => {
    getDataset.mockResolvedValue({ id: 'ds-1', name: 'session apple 3' });
    renderDialog({ datasetName: undefined });
    await waitFor(() => expect(screen.getByDisplayValue('zemarobotik/session-apple-3')).toBeInTheDocument());
  });

  it('sends the form, shows progress, then the link', async () => {
    publishDataset.mockResolvedValue(job());
    getDatasetPublish.mockResolvedValueOnce({ status: 'none' });
    renderDialog();
    await screen.findByDisplayValue('zemarobotik/g1-pick-apple');

    fireEvent.change(screen.getByLabelText('Tags'), { target: { value: 'apple, pick-and-place, apple' } });
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }));

    await waitFor(() => expect(publishDataset).toHaveBeenCalledWith('ds-1', {
      repoId: 'zemarobotik/g1-pick-apple',
      private: true,
      license: 'apache-2.0',
      tags: ['apple', 'pick-and-place'],
    }));
    expect(await screen.findByTestId('publish-progress')).toHaveTextContent('2 of 6 files');

    // The next poll (real timer, 1.5 s) sees the finished job.
    getDatasetPublish.mockResolvedValue(job({ status: 'done', phase: 'done', filesDone: 6, bytesDone: 2048 }));
    const done = await screen.findByTestId('publish-done', {}, { timeout: 4000 });
    expect(done).toHaveTextContent('Published privately to zemarobotik/g1-pick-apple');
    expect(screen.getByRole('link', { name: /huggingface\.co\/datasets\/zemarobotik\/g1-pick-apple/ }))
      .toHaveAttribute('href', 'https://huggingface.co/datasets/zemarobotik/g1-pick-apple');
  });

  it('asks before publishing a degraded dataset, then sends force', async () => {
    publishDataset
      .mockRejectedValueOnce(apiError('This dataset is degraded — 2 errors', 'DATASET_DEGRADED'))
      .mockResolvedValueOnce(job());
    renderDialog();
    await screen.findByDisplayValue('zemarobotik/g1-pick-apple');
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }));

    expect(await screen.findByTestId('publish-degraded')).toHaveTextContent('degraded');
    const publish = screen.getByRole('button', { name: 'Publish' });
    expect(publish).toBeDisabled();

    fireEvent.click(screen.getByLabelText('Publish anyway'));
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }));
    await waitFor(() => expect(publishDataset).toHaveBeenLastCalledWith('ds-1', expect.objectContaining({ force: true })));
  });

  it('says how to set up a token and does not let you publish without one', async () => {
    getHubPublishStatus.mockResolvedValue({ configured: false, source: null, user: null, orgs: [], defaultNamespace: null });
    renderDialog();
    expect(await screen.findByTestId('publish-not-configured')).toHaveTextContent('hf auth login');
    expect(screen.getByRole('button', { name: 'Publish' })).toBeDisabled();
  });

  it('rejects a malformed repo id before calling the server', async () => {
    renderDialog();
    const input = await screen.findByDisplayValue('zemarobotik/g1-pick-apple');
    fireEvent.change(input, { target: { value: 'no namespace here' } });
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }));
    expect(await screen.findByText(/Use namespace\/name/)).toBeInTheDocument();
    expect(publishDataset).not.toHaveBeenCalled();
  });

  it('shows a running publish instead of the form when reopened', async () => {
    getDatasetPublish.mockResolvedValue(job({ phase: 'committing' }));
    renderDialog();
    expect(await screen.findByTestId('publish-progress')).toHaveTextContent('Creating the commit');
  });
});

describe('repoNameFrom', () => {
  it('makes a Hub-safe name', () => {
    expect(repoNameFrom('G1 Pick Apple')).toBe('g1-pick-apple');
    expect(repoNameFrom('--weird__name..!!')).toBe('weird__name');
    expect(repoNameFrom('a'.repeat(120))).toHaveLength(96);
  });
});
