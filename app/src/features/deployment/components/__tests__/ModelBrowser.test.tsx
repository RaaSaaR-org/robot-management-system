/**
 * @file ModelBrowser.test.tsx
 * @description Tests for the model registry table's skill column — a model
 *              with no skill must read as unlinked, never as an error
 *              (TASK-238, TASK-266)
 * @feature deployment
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
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

/** The body rows of the table (the header row excluded). */
function bodyRows(): HTMLElement[] {
  return screen.getAllByRole('row').filter((row) => within(row).queryAllByRole('columnheader').length === 0);
}

describe('ModelBrowser skill column', () => {
  beforeEach(() => {
    // The table resolves skill names from the store; start each case empty.
    useDeploymentStore.setState({ skills: [] });
  });

  it('does not print "Unknown Skill" for a model with no skill', () => {
    render(<ModelBrowser modelVersions={[makeVersion()]} />);

    expect(screen.queryByText(/Unknown Skill/i)).not.toBeInTheDocument();
    const [row] = bodyRows();
    expect(within(row).getByText('Not linked to a skill')).toBeInTheDocument();
  });

  it('marks every skill-less model as unlinked, one row each', () => {
    render(
      <ModelBrowser
        modelVersions={[
          makeVersion({ id: 'mv-1', version: 'v1' }),
          makeVersion({ id: 'mv-2', version: 'v2', skillId: '' }),
        ]}
      />
    );

    const rows = bodyRows();
    expect(rows).toHaveLength(2);
    rows.forEach((row) => expect(within(row).getByText('Not linked to a skill')).toBeInTheDocument());
  });

  it('names the skill from the store when the list endpoint omits the relation', () => {
    useDeploymentStore.setState({ skills: [makeSkill({ id: 'skill-1', name: 'Pick and place' })] });

    render(<ModelBrowser modelVersions={[makeVersion({ skillId: 'skill-1' })]} />);

    const [row] = bodyRows();
    expect(within(row).getByText('Pick and place')).toBeInTheDocument();
    expect(within(row).queryByText('Not linked to a skill')).not.toBeInTheDocument();
  });

  it('falls back to the skill id, not the unlinked label, for an unresolvable skill', () => {
    render(<ModelBrowser modelVersions={[makeVersion({ skillId: 'skill-deleted-0001' })]} />);

    const [row] = bodyRows();
    expect(within(row).getByText('Skill skill-de')).toBeInTheDocument();
    expect(within(row).queryByText('Not linked to a skill')).not.toBeInTheDocument();
  });

  it('sorts unlinked models after the named skills', () => {
    useDeploymentStore.setState({ skills: [makeSkill({ id: 'skill-1', name: 'Zip the bag' })] });

    render(
      <ModelBrowser
        modelVersions={[
          makeVersion({ id: 'mv-unlinked', version: 'v1' }),
          makeVersion({ id: 'mv-linked', version: 'v2', skillId: 'skill-1' }),
        ]}
      />
    );

    const rows = bodyRows();
    expect(within(rows[0]).getByText('Zip the bag')).toBeInTheDocument();
    expect(within(rows[1]).getByText('Not linked to a skill')).toBeInTheDocument();
  });

  it('offers Deploy only for staging versions', () => {
    render(
      <ModelBrowser
        modelVersions={[makeVersion({ deploymentStatus: 'production' })]}
        onDeploy={() => undefined}
        onCopyUri={() => undefined}
      />
    );

    expect(screen.getByRole('button', { name: /Actions for/ })).toBeInTheDocument();
  });

  it('offers Edit first and Archive last on a staging version', () => {
    render(
      <ModelBrowser
        modelVersions={[makeVersion({ name: 'Staged model' })]}
        onEdit={() => undefined}
        onDeploy={() => undefined}
        onCopyUri={() => undefined}
        onArchive={() => undefined}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Actions for Staged model' }));
    const items = screen.getAllByRole('menuitem').map((item) => item.textContent?.trim());
    expect(items).toEqual(['Edit', 'Deploy', 'Copy artifact URI', 'Archive']);
  });

  it('does not offer Archive on a version that is already archived', () => {
    render(
      <ModelBrowser
        modelVersions={[makeVersion({ name: 'Old model', deploymentStatus: 'archived' })]}
        onEdit={() => undefined}
        onArchive={() => undefined}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Actions for Old model' }));
    expect(screen.getByRole('menuitem', { name: /Edit/ })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: /Archive/ })).not.toBeInTheDocument();
  });
});
