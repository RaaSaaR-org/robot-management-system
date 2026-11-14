/**
 * @file RegisterPage.test.tsx
 * @description TASK-369: the register page shows a "sign-up is disabled" state
 *   when the server reports self-registration closed, and the form otherwise.
 *   TASK-503: on a server without sign-in there is no account to create, so
 *   /register opens the app like /login does.
 * @feature auth
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

vi.mock('@/api', () => ({
  apiClient: { get: vi.fn(), post: vi.fn() },
}));

import { useFeaturesStore } from '@/shared/hooks';
import { RegisterPage } from '../pages/RegisterPage';

const FLAGS = { multiTenancyEnabled: false, signInRequired: true, natsEnabled: false, rustfsEnabled: false };

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/register']}>
      <Routes>
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/dashboard" element={<h1>Dashboard</h1>} />
      </Routes>
    </MemoryRouter>
  );
}

describe('RegisterPage', () => {
  beforeEach(() => {
    useFeaturesStore.setState({ loaded: true, loading: false, error: null });
  });

  afterEach(() => {
    cleanup();
  });

  it('tells the visitor to ask an admin when the server closed sign-up', () => {
    useFeaturesStore.setState({ flags: { ...FLAGS, selfRegistrationEnabled: false } });

    renderPage();

    expect(screen.getByText('Sign-up is disabled')).toBeInTheDocument();
    expect(screen.getByText(/Ask your administrator/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Email')).not.toBeInTheDocument();
  });

  it('shows the form when the server allows sign-up', () => {
    useFeaturesStore.setState({ flags: { ...FLAGS, selfRegistrationEnabled: true } });

    renderPage();

    expect(screen.getByText('Create your account')).toBeInTheDocument();
    expect(screen.queryByText('Sign-up is disabled')).not.toBeInTheDocument();
  });

  it('opens the dashboard on a server without sign-in, even with sign-up open', () => {
    useFeaturesStore.setState({ flags: { ...FLAGS, signInRequired: false, selfRegistrationEnabled: true } });

    renderPage();

    expect(screen.getByRole('heading', { name: 'Dashboard' })).toBeInTheDocument();
    expect(screen.queryByText('Create your account')).not.toBeInTheDocument();
  });

  it('shows the form while the flags are still loading', () => {
    useFeaturesStore.setState({
      flags: { ...FLAGS, selfRegistrationEnabled: false },
      loaded: false,
      loading: true,
    });

    renderPage();

    expect(screen.getByText('Create your account')).toBeInTheDocument();
  });
});
