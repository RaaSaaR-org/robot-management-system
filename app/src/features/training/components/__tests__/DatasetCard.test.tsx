/**
 * @file DatasetCard.test.tsx
 * @description The three things the card can say about validation and the
 *              difference between them; what it says about a failed import;
 *              and whether a keyboard can reach any of it.
 * @feature training
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, createEvent } from '@testing-library/react';
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
    const panel = screen.getByTestId('dataset-validation-errors');
    expect(panel).toHaveTextContent('1 structural problem');
    // `toHaveTextContent` is a substring match, so the assertion above is
    // satisfied by the very string this test is named after. This is the half
    // that bites: rendering "1 structural problems" fails here.
    expect(panel).not.toHaveTextContent('structural problems');
  });

  it('keeps "Not validated" off a card that is still uploading', () => {
    // The line is about a dataset nobody has checked, not about one where
    // there is nothing to check yet. Without the status guard, every card
    // mid-upload claims it was never validated.
    render(<DatasetCard dataset={makeDataset({ status: 'uploading', validation: undefined })} />);
    expect(screen.queryByTestId('dataset-not-validated')).not.toBeInTheDocument();
  });
});

describe('what the card says about a failed import (TASK-220)', () => {
  const failedImport = makeDataset({
    status: 'failed',
    huggingFaceRepoId: 'nvidia/GR00T-N1.7-AppleToPlate',
    importError: {
      phase: 'download',
      error: 'RustFS is unreachable at http://localhost:9000',
      repoId: 'nvidia/GR00T-N1.7-AppleToPlate',
      failedAt: '2026-08-23T01:20:11.361Z',
    },
  });

  it('says which phase failed and why', () => {
    // A "Failed" badge and nothing else sent whoever read it to the server's
    // log, on a machine they may not have.
    render(<DatasetCard dataset={failedImport} />);
    const panel = screen.getByTestId('dataset-import-error');
    expect(panel).toHaveTextContent('Import failed during download');
    expect(panel).toHaveTextContent('RustFS is unreachable');
  });

  it('offers a retry for a row that came from the Hub', () => {
    const onRetryImport = vi.fn();
    render(<DatasetCard dataset={failedImport} onRetryImport={onRetryImport} />);
    fireEvent.click(screen.getByRole('button', { name: 'Retry import' }));
    expect(onRetryImport).toHaveBeenCalledTimes(1);
  });

  it('offers no retry when there is no Hub repo to retry from', () => {
    render(
      <DatasetCard
        dataset={makeDataset({
          status: 'failed',
          huggingFaceRepoId: undefined,
          importError: { phase: 'extract', error: 'archive holds no members', failedAt: '2026-08-23T01:20:11.361Z' },
        })}
        onRetryImport={() => {}}
      />
    );
    expect(screen.queryByRole('button', { name: 'Retry import' })).not.toBeInTheDocument();
  });

  it('keeps the retry click off the card body', () => {
    // The card navigates to the episode viewer, which for a failed import is a
    // page with nothing on it.
    const onClick = vi.fn();
    render(<DatasetCard dataset={failedImport} onClick={onClick} onRetryImport={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Retry import' }));
    expect(onClick).not.toHaveBeenCalled();
  });
});

describe('what a mixture is judged on', () => {
  it('shows robot type, both widths and the camera count', () => {
    render(<DatasetCard dataset={makeDataset({
      robotType: { id: 'rt1', name: 'unitree_g1' } as Dataset['robotType'],
      infoJson: {
        features: {
          'observation.state': { dtype: 'float32', shape: [43] },
          action: { dtype: 'float32', shape: [43] },
          'observation.images.ego_view': { dtype: 'video', shape: [480, 640, 3] },
        },
      } as Dataset['infoJson'],
    })} />);
    const shape = screen.getByTestId('dataset-shape');
    expect(shape).toHaveTextContent('unitree_g1');
    expect(shape).toHaveTextContent('43 / 43');
    expect(shape).toHaveTextContent('Cameras1');
  });

  it('says a width is unknown rather than calling it zero', () => {
    // A failed import has an empty info.json. "0-wide" is a fact about a
    // dataset; this one has no facts.
    render(<DatasetCard dataset={makeDataset({ infoJson: {} as Dataset['infoJson'] })} />);
    expect(screen.getByTestId('dataset-shape')).toHaveTextContent('State/Actionunknown');
  });

  it('shows the pinned revision, shortened, and links to the source repo', () => {
    render(<DatasetCard dataset={makeDataset({
      huggingFaceRepoId: 'nvidia/GR00T-N1.7-AppleToPlate',
      sourceRevision: 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678',
    })} />);
    expect(screen.getByTestId('dataset-shape')).toHaveTextContent('a1b2c3d');
    expect(screen.getByRole('link', { name: /GR00T-N1.7-AppleToPlate/ })).toHaveAttribute(
      'href',
      'https://huggingface.co/datasets/nvidia/GR00T-N1.7-AppleToPlate'
    );
  });
});

describe('reaching the card without a mouse', () => {
  it('is focusable and activates on Enter', () => {
    // It was a div with an onClick: no role, no tabIndex, unreachable by
    // keyboard and invisible to a screen reader.
    const onClick = vi.fn();
    render(<DatasetCard dataset={makeDataset()} onClick={onClick} />);
    const card = screen.getByRole('button', { name: /Pick and place/ });
    expect(card).toHaveAttribute('tabindex', '0');
    fireEvent.keyDown(card, { key: 'Enter' });
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('activates on Space', () => {
    const onClick = vi.fn();
    render(<DatasetCard dataset={makeDataset()} onClick={onClick} />);
    fireEvent.keyDown(screen.getByRole('button', { name: /Pick and place/ }), { key: ' ' });
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('is not a button when there is nothing to click', () => {
    render(<DatasetCard dataset={makeDataset()} />);
    expect(screen.queryByRole('button', { name: /Pick and place/ })).not.toBeInTheDocument();
  });

  // ---------------------------------------------------------------------------
  // …and does NOT answer for the controls inside it.
  //
  // Keydown bubbles. The card's handler ran for Enter and Space raised on every
  // control in the card, and called `preventDefault()` on the way: Enter on
  // "Retry import" retried AND navigated away from the page you were retrying
  // on, and Space on the mixture checkbox was cancelled before it could toggle.
  // Keyboard users got a different card from mouse users.
  // ---------------------------------------------------------------------------

  it('does not navigate when Enter is pressed on a button inside it', () => {
    const onClick = vi.fn();
    const onRetryImport = vi.fn();
    const dataset = makeDataset({
      status: 'failed',
      huggingFaceRepoId: 'nvidia/GR00T-N1.7-AppleToPlate',
      importError: {
        phase: 'download',
        error: 'RustFS is unreachable at http://localhost:9000',
        repoId: 'nvidia/GR00T-N1.7-AppleToPlate',
        failedAt: '2026-08-23T01:20:11.361Z',
      },
    });
    render(<DatasetCard dataset={dataset} onClick={onClick} onRetryImport={onRetryImport} />);

    fireEvent.keyDown(screen.getByRole('button', { name: 'Retry import' }), {
      key: 'Enter',
      bubbles: true,
    });

    expect(onClick).not.toHaveBeenCalled();
  });

  it('does not swallow Space on the mixture checkbox', () => {
    const onClick = vi.fn();
    render(
      <DatasetCard
        dataset={makeDataset()}
        selectable
        checked={false}
        onToggleChecked={() => {}}
        onClick={onClick}
      />
    );
    const checkbox = screen.getByRole('checkbox', {
      name: 'Select Pick and place for a training mixture',
    });

    const event = createEvent.keyDown(checkbox, { key: ' ', bubbles: true });
    fireEvent(checkbox, event);

    // The browser toggles a focused checkbox on Space unless the default is
    // prevented — which is exactly what the card used to do to it.
    expect(event.defaultPrevented).toBe(false);
    expect(onClick).not.toHaveBeenCalled();
  });
});

describe('mixture selection', () => {
  it('checks and unchecks without opening the dataset', () => {
    const onClick = vi.fn();
    const onToggleChecked = vi.fn();
    render(
      <DatasetCard
        dataset={makeDataset()}
        selectable
        checked={false}
        onToggleChecked={onToggleChecked}
        onClick={onClick}
      />
    );
    const checkbox = screen.getByRole('checkbox', {
      name: 'Select Pick and place for a training mixture',
    });
    fireEvent.click(checkbox);
    expect(onToggleChecked).toHaveBeenCalledTimes(1);
    expect(onClick).not.toHaveBeenCalled();
  });
});
