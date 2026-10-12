/**
 * @file OrganizationsPage.sample.test.tsx
 * @description The "Load sample (Acme Robotics)" offer (TASK-370). The Default
 *              organization is always listed, so the offer keys on "no customer
 *              organization yet" — keying on an empty list made it unreachable.
 * @feature organizations
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { Organization } from '../../types/organizations.types';

vi.mock('@/shared/hooks', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/shared/hooks')>()),
  useFeatures: () => ({ multiTenancyEnabled: true }),
}));
vi.mock('../../components/OnboardingWizard', () => ({ OnboardingWizard: () => null }));
vi.mock('../../components/OrganizationFormModal', () => ({
  orgErrorMessage: (_e: unknown, f: string) => f,
  OrganizationFormModal: ({ isOpen, prefill }: { isOpen: boolean; prefill?: { name: string; slug: string } }) =>
    isOpen ? <div data-testid="org-form">{prefill ? `${prefill.name}/${prefill.slug}` : 'blank'}</div> : null,
}));

import { useOrganizationsStore } from '../../store/organizationsStore';
import { OrganizationsPage } from '../OrganizationsPage';

function org(id: string, isDefault: boolean): Organization {
  return {
    id, slug: id, name: id === 'default' ? 'Default' : id, logoUrl: null, plan: null, settings: '{}',
    createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z', isDefault,
    counts: { users: 0, robots: 0, datasets: 0, trainingJobs: 0 },
  };
}

function seed(list: Organization[]) {
  useOrganizationsStore.setState({ list, listLoaded: true, listLoading: false, error: null });
}

function renderPage() {
  return render(
    <MemoryRouter>
      <OrganizationsPage />
    </MemoryRouter>,
  );
}

const SAMPLE = { name: 'Load sample (Acme Robotics)' };

describe('OrganizationsPage sample offer', () => {
  beforeEach(() => seed([]));

  it('offers the sample while only the Default organization exists', () => {
    seed([org('default', true)]);
    renderPage();
    expect(screen.getByTestId('org-sample-offer')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', SAMPLE));
    expect(screen.getByTestId('org-form')).toHaveTextContent('Acme Robotics/acme');
  });

  it('drops the offer once a customer organization exists', () => {
    seed([org('default', true), org('contoso', false)]);
    renderPage();
    expect(screen.queryByTestId('org-sample-offer')).toBeNull();
    expect(screen.queryByRole('button', SAMPLE)).toBeNull();
  });

  it('shows one offer, not two, when the list is truly empty', () => {
    renderPage();
    expect(screen.queryByTestId('org-sample-offer')).toBeNull();
    expect(screen.getAllByRole('button', SAMPLE)).toHaveLength(1);
  });
});
