/**
 * @file ModelVersionCard.test.tsx
 * @description Tests for the model version card headline, source badge and lineage link
 * @feature deployment
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ModelVersionCard } from '../ModelVersionCard';
import type { ModelVersion } from '../../types';

function makeVersion(overrides: Partial<ModelVersion> = {}): ModelVersion {
  return {
    id: 'mv-1',
    skillId: '',
    trainingJobId: null,
    version: '2026-09-04-g1-apple-pnp',
    artifactUri: 'hf://neodem/g1-apple-pnp',
    trainingMetrics: {},
    validationMetrics: {},
    deploymentStatus: 'staging',
    createdAt: '2026-09-04T10:00:00.000Z',
    updatedAt: '2026-09-04T10:00:00.000Z',
    ...overrides,
  };
}

describe('ModelVersionCard', () => {
  it('renders the model name when present', () => {
    render(<ModelVersionCard version={makeVersion({ name: 'GR00T-N1.7 AppleToPlate' })} />);

    expect(screen.getByText('GR00T-N1.7 AppleToPlate')).toBeInTheDocument();
  });

  it('does not print "Unknown Skill" for a model with no skill', () => {
    render(<ModelVersionCard version={makeVersion()} />);

    expect(screen.queryByText(/Unknown Skill/i)).not.toBeInTheDocument();
    expect(screen.getByText('Model 2026-09-04-g1-apple-pnp')).toBeInTheDocument();
  });

  it('prefers the model name over the skill name', () => {
    const version = makeVersion({
      name: 'GR00T-N1.7 AppleToPlate',
      skill: { name: 'pick-and-place' } as ModelVersion['skill'],
    });

    render(<ModelVersionCard version={version} />);

    expect(screen.getByText('GR00T-N1.7 AppleToPlate')).toBeInTheDocument();
    expect(screen.queryByText('pick-and-place')).not.toBeInTheDocument();
  });

  it('renders the source kind badge', () => {
    render(<ModelVersionCard version={makeVersion({ sourceKind: 'imported' })} />);

    expect(screen.getByText('Imported')).toBeInTheDocument();
  });

  it('links to the parent model when the version has one', () => {
    render(
      <ModelVersionCard version={makeVersion({ parentModelVersionId: 'mv-parent-0001' })} />
    );

    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('href', '#model-mv-parent-0001');
    expect(link).toHaveTextContent('Derived from model mv-paren');
  });

  it('renders no lineage link when the version has no parent', () => {
    render(<ModelVersionCard version={makeVersion()} />);

    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });
});
