/**
 * @file AccountPage.sharedUser.test.tsx
 * @description TASK-483: on a server without sign-in the account page shows
 *              the shared user as what it is — no Sign out, no password or
 *              second factor to manage, no placeholder address or "member
 *              since" date. With sign-in the page is unchanged.
 * @feature auth
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const features = vi.hoisted(() => ({ signInRequired: true }));

vi.mock('@/shared/hooks/useFeatures', () => ({
  useFeatures: () => ({ signInRequired: features.signInRequired }),
}));
vi.mock('../hooks/useAuth', () => ({
  useAuth: () => ({
    user: {
      id: 'dev-user-id',
      name: 'Demo user',
      email: 'dev@neodem.local',
      role: 'super-admin',
      createdAt: '2026-11-13T09:00:00.000Z',
      updatedAt: '2026-11-13T09:00:00.000Z',
    },
    logout: vi.fn(),
  }),
}));
vi.mock('../components/ChangePasswordForm', () => ({ ChangePasswordForm: () => <form aria-label="Change password form" /> }));
vi.mock('../components/SecuritySettings', () => ({ SecuritySettings: () => <section aria-label="Two-step verification" /> }));

import { AccountPage } from '../pages/AccountPage';

function renderPage() {
  render(
    <MemoryRouter>
      <AccountPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  features.signInRequired = true;
});

describe('AccountPage', () => {
  it('shows the shared user without sign-in chrome on a server without sign-in', () => {
    features.signInRequired = false;
    renderPage();

    expect(screen.getByText('Demo user')).toBeInTheDocument();
    expect(screen.getByText('Shared account')).toBeInTheDocument();
    expect(screen.getByText(/Sign-in is turned off on this server/)).toBeInTheDocument();

    expect(screen.queryByRole('button', { name: 'Sign out' })).not.toBeInTheDocument();
    expect(screen.queryByText('dev@neodem.local')).not.toBeInTheDocument();
    expect(screen.queryByText('Member since')).not.toBeInTheDocument();
    expect(screen.queryByText('Last sign-in')).not.toBeInTheDocument();
    expect(screen.queryByRole('form', { name: 'Change password form' })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Two-step verification' })).not.toBeInTheDocument();
  });

  it('keeps Sign out, the address, the dates and the security panels with sign-in', () => {
    renderPage();

    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument();
    expect(screen.getByText('dev@neodem.local')).toBeInTheDocument();
    expect(screen.getByText('Member since')).toBeInTheDocument();
    expect(screen.getByRole('form', { name: 'Change password form' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Two-step verification' })).toBeInTheDocument();
  });
});
