/**
 * @file DatasetCard.test.tsx
 * @description The three things the card can say about validation, and the
 *              difference between them.
 * @feature training
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DatasetCard } from '../DatasetCard';
import type { Dataset, DatasetValidation } from '../../types';

vi.mock('../../api/trainingApi', () => ({
  trainingApi: { getEpisodeVideoUrl: () => 'about:blank' },
}));

function makeDataset(over: Partial<Dataset> = {}): Dataset {
  return {
    id: 'ds1',
    name: 'Pick and place',
    robotTypeId: 'rt1',
    storagePath: '/data/ds1/',
    lerobotVersion: 'v3.0',
    fps: 30,
    totalFrames: 1200,
    totalDuration: 40,
    demonstrationCount: 4,
    qualityScore: 72,
    infoJson: {} as Dataset['infoJson'],
    statsJson: {} as Dataset['statsJson'],
    status: 'ready',
    createdAt: '2026-08-22T00:00:00.000Z',
    updatedAt: '2026-08-22T00:00:00.000Z',
    ...over,
  };
}

function makeValidation(over: Partial<DatasetValidation> = {}): DatasetValidation {
  return {
    validatedAt: '2026-08-22T00:00:00.000Z',
    valid: true,
    lerobotVersion: 'v3.0',
    errors: [],
    warnings: [],
    imageKeys: ['observation.images.cam_high'],
    fileCount: 8,
    ...over,
  };
}

describe('what the card says about validation', () => {
  it('says nothing has opened the files, when nothing has', () => {
    // The state that used to be invisible. `register-local-dataset.ts` writes
    // `status: 'ready'` without a check, so a green badge on a locally
    // registered dataset meant nobody had looked at it — and looked exactly
    // like one that had passed.
    render(<DatasetCard dataset={makeDataset({ validation: undefined })} />);
    expect(screen.getByTestId('dataset-not-validated')).toBeInTheDocument();
    expect(screen.queryByTestId('dataset-no-images')).not.toBeInTheDocument();
  });

  it('does not say that about a dataset that HAS been validated', () => {
    render(<DatasetCard dataset={makeDataset({ validation: makeValidation() })} />);
    expect(screen.queryByTestId('dataset-not-validated')).not.toBeInTheDocument();
    expect(screen.queryByTestId('dataset-no-images')).not.toBeInTheDocument();
    expect(screen.queryByTestId('dataset-validation-errors')).not.toBeInTheDocument();
  });

  it('warns on the card when the dataset has no camera features', () => {
    // THE warning. It is not an error — a state-only dataset is a legitimate
    // thing to hold — so without somewhere to be seen it only surfaced hours
    // into a training run as "All image features are missing from the batch".
    render(<DatasetCard dataset={makeDataset({
      validation: makeValidation({
        imageKeys: [],
        warnings: [{ code: 'NO_IMAGE_FEATURES', message: 'No camera features…' }],
      }),
    })} />);
    expect(screen.getByTestId('dataset-no-images')).toHaveTextContent('No camera features');
  });

  it('shows how many structural problems there are, and what the first one IS', () => {
    // A count alone sends whoever reads it to the logs, and the logs are on a
    // machine they may not have.
    render(<DatasetCard dataset={makeDataset({
      status: 'failed',
      validation: makeValidation({
        valid: false,
        errors: [
          { code: 'MISSING_DATA_FILE', message: 'info.json names data/chunk-000/file-000.parquet and it is not there' },
          { code: 'EMPTY_FILE', message: 'videos/observation.images.cam_high/chunk-000/file-000.mp4 is zero bytes' },
        ],
      }),
    })} />);
    const panel = screen.getByTestId('dataset-validation-errors');
    expect(panel).toHaveTextContent('2 structural problems');
    expect(panel).toHaveTextContent('data/chunk-000/file-000.parquet');
  });

  it('says "1 structural problem", not "1 structural problems"', () => {
    render(<DatasetCard dataset={makeDataset({
      status: 'failed',
      validation: makeValidation({
        valid: false,
        errors: [{ code: 'MISSING_INFO', message: 'Missing required file: meta/info.json' }],
      }),
    })} />);
    expect(screen.getByTestId('dataset-validation-errors')).toHaveTextContent('1 structural problem');
  });
});
