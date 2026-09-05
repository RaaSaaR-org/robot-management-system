/**
 * @file ModelBrowser.test.tsx
 * @description Tests for the model browser's skill grouping — a model with no
 *              skill must read as unlinked, never as an error (TASK-238)
 * @feature deployment
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ModelBrowser } from '../ModelBrowser';
import { useDeploymentStore } from '../../store';
import type { ModelVersion, SkillDefinition } from '../../types';

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

function makeSkill(overrides: Partial<SkillDefinition> = {}): SkillDefinition {
  return {
    id: 'skill-1',
    name: 'Pick and place',
    version: '1.0.0',
    status: 'published',
    requiredCapabilities: [],
    maxRetries: 0,
    createdAt: '2026-09-04T10:00:00.000Z',
    updatedAt: '2026-09-04T10:00:00.000Z',
    ...overrides,
  } as SkillDefinition;
}

describe('ModelBrowser skill grouping', () => {
  beforeEach(() => {
    // The browser resolves skill names from the store; start each case empty.
    useDeploymentStore.setState({ skills: [] });
  });

  it('does not print "Unknown Skill" for a model with no skill', () => {
    render(<ModelBrowser modelVersions={[makeVersion()]} />);

    expect(screen.queryByText(/Unknown Skill/i)).not.toBeInTheDocument();
    expect(screen.getByText('Not linked to a skill')).toBeInTheDocument();
  });

  it('groups every skill-less model under one unlinked heading', () => {
    render(
      <ModelBrowser
        modelVersions={[
          makeVersion({ id: 'mv-1', version: 'v1' }),
          makeVersion({ id: 'mv-2', version: 'v2', skillId: '' }),
        ]}
      />
    );

    expect(screen.getAllByText('Not linked to a skill')).toHaveLength(1);
    expect(screen.getByText('2 version(s)')).toBeInTheDocument();
  });

  it('names the skill from the store when the list endpoint omits the relation', () => {
    useDeploymentStore.setState({ skills: [makeSkill({ id: 'skill-1', name: 'Pick and place' })] });

    render(<ModelBrowser modelVersions={[makeVersion({ skillId: 'skill-1' })]} />);

    expect(screen.getByText('Pick and place')).toBeInTheDocument();
    expect(screen.queryByText('Not linked to a skill')).not.toBeInTheDocument();
  });

  it('falls back to the skill id, not the unlinked heading, for an unresolvable skill', () => {
    render(<ModelBrowser modelVersions={[makeVersion({ skillId: 'skill-deleted-0001' })]} />);

    expect(screen.getByText('Skill skill-de')).toBeInTheDocument();
    expect(screen.queryByText('Not linked to a skill')).not.toBeInTheDocument();
  });

  it('sorts the unlinked group after the named skills', () => {
    useDeploymentStore.setState({ skills: [makeSkill({ id: 'skill-1', name: 'Zip the bag' })] });

    render(
      <ModelBrowser
        modelVersions={[
          makeVersion({ id: 'mv-unlinked', version: 'v1' }),
          makeVersion({ id: 'mv-linked', version: 'v2', skillId: 'skill-1' }),
        ]}
      />
    );

    const headings = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
    expect(headings).toEqual(['Zip the bag', 'Not linked to a skill']);
  });
});
