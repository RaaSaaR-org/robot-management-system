/**
 * @file DatasetProvenance.test.tsx
 * @description A Hub import's source reads as provenance — "Imported from
 *              Hugging Face: …", a link to the pinned commit — and not as a
 *              second name under the dataset's title (TASK-493).
 * @feature training
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DatasetProvenance, hubDatasetUrl } from '../DatasetProvenance';

const SHA = '37cb1d6e0a1b2c3d4e5f60718293a4b5c6d7e8f9';

describe('hubDatasetUrl', () => {
  it('points at the commit the dataset was imported from', () => {
    expect(hubDatasetUrl('ycchen0106/g1-apple-to-plate', SHA)).toBe(
      `https://huggingface.co/datasets/ycchen0106/g1-apple-to-plate/tree/${SHA}`,
    );
  });

  it('falls back to the repo page, and encodes a revision with a slash', () => {
    expect(hubDatasetUrl('lerobot/pusht')).toBe('https://huggingface.co/datasets/lerobot/pusht');
    expect(hubDatasetUrl('lerobot/pusht', 'refs/pr/3')).toBe('https://huggingface.co/datasets/lerobot/pusht/tree/refs%2Fpr%2F3');
  });
});

describe('DatasetProvenance', () => {
  it('says where the dataset was imported from, links the repo and shortens the commit', () => {
    render(<DatasetProvenance dataset={{ huggingFaceRepoId: 'ycchen0106/g1-apple-to-plate', sourceRevision: SHA }} />);
    const source = screen.getByTestId('dataset-source');
    expect(source).toHaveTextContent(/^Imported from Hugging Face:\s*ycchen0106\/g1-apple-to-plate.*at revision 37cb1d6e$/);
    expect(source).not.toHaveTextContent('@');

    const link = screen.getByRole('link', { name: /ycchen0106\/g1-apple-to-plate/ });
    expect(link).toHaveAttribute('href', hubDatasetUrl('ycchen0106/g1-apple-to-plate', SHA));
    expect(link).toHaveAttribute('target', '_blank');
    expect(link.getAttribute('rel')).toContain('noreferrer');
    // The whole commit stays one hover away.
    expect(screen.getByText('37cb1d6e').parentElement).toHaveAttribute('title', SHA);
  });

  it('names a branch or tag as it is, and no revision when none was recorded', () => {
    const { rerender } = render(<DatasetProvenance dataset={{ huggingFaceRepoId: 'lerobot/pusht', sourceRevision: 'v2.1' }} />);
    expect(screen.getByTestId('dataset-source')).toHaveTextContent('at revision v2.1');
    rerender(<DatasetProvenance dataset={{ huggingFaceRepoId: 'lerobot/pusht', sourceRevision: null }} />);
    expect(screen.getByTestId('dataset-source')).not.toHaveTextContent('revision');
    expect(screen.getByRole('link')).toHaveAttribute('href', 'https://huggingface.co/datasets/lerobot/pusht');
  });

  it('renders nothing for a dataset that was not imported from the Hub', () => {
    const { container } = render(<DatasetProvenance dataset={{ huggingFaceRepoId: undefined, sourceRevision: null }} />);
    expect(container).toBeEmptyDOMElement();
  });
});
