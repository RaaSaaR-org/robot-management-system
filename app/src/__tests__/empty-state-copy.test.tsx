/**
 * @file empty-state-copy.test.tsx
 * @description Empty and not-set-up states speak to the person looking at them
 *              (TASK-486). Each of these used to lead with a developer's
 *              instruction — an API route, an environment variable, a file
 *              path. The sentence a visitor reads is now plain; the setup
 *              detail is still there, folded under "For administrators".
 * @feature shared
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AdminCode, AdminHint, EmptyState } from '@/shared/components/ui';
import { WorkerStatusPanel } from '@/features/training/components/WorkerStatusPanel';
import { GatedNotice, EnvVar } from '@/features/organizations/components/GatedNotice';
import { LiveSessionRedirect } from '@/features/datacollection/pages/LiveSessionRedirect';

vi.mock('@/features/experiments/hooks/useExperiments', () => ({
  useExperiments: () => ({ experiments: [], loading: false, error: null, reload: vi.fn() }),
}));

/** Text a visitor sees without opening anything: everything outside a <details> body. */
function visibleText(root: HTMLElement): string {
  const clone = root.cloneNode(true) as HTMLElement;
  const folded = [...(clone.tagName === 'DETAILS' ? [clone] : []), ...Array.from(clone.querySelectorAll('details'))];
  folded.forEach((d) => {
    Array.from(d.children).forEach((child) => { if (child.tagName !== 'SUMMARY') child.remove(); });
  });
  return clone.textContent ?? '';
}

const JARGON = /POST \/api|GET \/api|[A-Z_]{4,}=|\.py\b|hf auth|\?robot=|HF_TOKEN|\.env\b/;

describe('AdminHint', () => {
  it('is closed until asked for, and keeps the detail in the page for whoever opens it', () => {
    render(
      <AdminHint data-testid="hint">
        Set <AdminCode>EXAMPLE_FLAG=true</AdminCode>.
      </AdminHint>,
    );
    const hint = screen.getByTestId('hint');
    expect(hint.tagName).toBe('DETAILS');
    expect(hint).not.toHaveAttribute('open');
    expect(hint.querySelector('summary')).toHaveTextContent('For administrators');
    expect(hint).toHaveTextContent('EXAMPLE_FLAG=true');
    expect(visibleText(hint)).not.toMatch(JARGON);
  });

  it('sits under an empty state’s actions', () => {
    const { container } = render(<EmptyState title="Nothing yet" description="Plain words." hint={<AdminHint>Run a thing.</AdminHint>} />);
    expect(container.querySelector('details')).not.toBeNull();
  });
});

describe('what a visitor reads', () => {
  it('Experiments: says what an experiment is, not which route creates one', async () => {
    const { ExperimentsPage } = await import('@/features/experiments/pages/ExperimentsPage');
    const { container } = render(<MemoryRouter><ExperimentsPage /></MemoryRouter>);
    expect(screen.getByText('No experiments yet')).toBeInTheDocument();
    expect(visibleText(container)).toMatch(/tests one idea with several training runs/);
    expect(visibleText(container)).not.toMatch(JARGON);
    expect(screen.getByTestId('experiments-admin-hint')).toHaveTextContent('POST /api/experiments');
  });

  it('Training: an empty worker list is "no training machine is online"', () => {
    const { container } = render(<WorkerStatusPanel workers={{ workers: [] } as never} />);
    expect(screen.getByText('No training machine is online')).toBeInTheDocument();
    expect(screen.queryByText('No workers connected')).toBeNull();
    expect(visibleText(container)).toMatch(/wait in the queue and start on their own/);
    expect(screen.getByTestId('workers-admin-hint')).toHaveTextContent('training worker');
  });

  it('Organizations and Team: the notice says what sharing means, the flag is the admin’s', () => {
    const { container } = render(
      <GatedNotice adminHint={<>Set <EnvVar>MULTI_TENANCY_ENABLED=true</EnvVar>.</>}>
        Organizations are listed here, but on this instance everyone shares the same robots and data.
      </GatedNotice>,
    );
    expect(screen.getByText('Shared workspace')).toBeInTheDocument();
    expect(visibleText(container)).not.toMatch(JARGON);
    expect(screen.getByTestId('gated-admin-hint')).toHaveTextContent('MULTI_TENANCY_ENABLED=true');
  });

  it('Live session: without a robot it explains itself and offers a way on', () => {
    const { container } = render(
      <MemoryRouter initialEntries={['/data-collection/live']}>
        <Routes>
          <Route path="/data-collection/live" element={<LiveSessionRedirect pollMs={50} />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByTestId('live-session-status')).toHaveTextContent('No robot selected');
    expect(screen.getByRole('link', { name: 'Go to recording sessions' })).toHaveAttribute('href', '/data-collection');
    expect(visibleText(container)).not.toMatch(JARGON);
    expect(screen.getByTestId('live-session-admin-hint')).toHaveTextContent('/data-collection/live?robot=<robot id>');
  });
});

describe('the pages that carry the notice', () => {
  const PAGES = import.meta.glob<string>(
    ['/src/features/organizations/pages/OrganizationsPage.tsx', '/src/features/team/pages/TeamPage.tsx', '/src/features/training/components/GenerateSyntheticModal.tsx'],
    { query: '?raw', import: 'default', eager: true },
  );
  const text = (suffix: string) => Object.entries(PAGES).find(([path]) => path.endsWith(suffix))?.[1] ?? '';

  it('pass the multi-tenancy flag as the admin hint, never as the sentence', () => {
    for (const page of ['OrganizationsPage.tsx', 'TeamPage.tsx']) {
      const source = text(page);
      expect(source, page).toMatch(/adminHint=\{<>[^}]*<EnvVar>MULTI_TENANCY_ENABLED=true<\/EnvVar>/);
      expect(source, page).not.toMatch(/only applies when the server runs with/);
    }
    expect(text('OrganizationsPage.tsx')).not.toContain('Load sample (');
  });

  it('keep the synthetic generator’s file path inside the admin hint', () => {
    const source = text('GenerateSyntheticModal.tsx');
    expect(source).not.toContain('Generator not found on the server');
    expect(source).toContain('is not installed on this instance');
    const hint = source.slice(source.indexOf('data-testid="synthetic-admin-hint"'));
    expect(hint.slice(0, 400)).toContain('server/curation/cosmos3_synth.py');
  });
});
