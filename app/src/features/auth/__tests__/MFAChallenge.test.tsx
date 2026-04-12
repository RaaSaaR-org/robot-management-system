/**
 * @file MFAChallenge.test.tsx
 * @description Tests for MFAChallenge component
 * @feature auth
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MFAChallenge } from '../components/MFAChallenge';

// Mock the authApi
vi.mock('../api/authApi', () => ({
  authApi: {
    mfaTotpValidate: vi.fn(),
    mfaUseRecoveryCode: vi.fn(),
  },
}));

import { authApi } from '../api/authApi';

const defaultProps = {
  userId: 'user-123',
  mfaToken: 'mfa-token-abc',
  onSuccess: vi.fn(),
};

describe('MFAChallenge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders 6-digit input in TOTP mode', () => {
    render(<MFAChallenge {...defaultProps} />);
    expect(screen.getByText('Two-Factor Authentication')).toBeInTheDocument();
    expect(screen.getByLabelText(/authentication code/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/authentication code/i)).toHaveAttribute('inputmode', 'numeric');
  });

  it('submits TOTP code on form submit', async () => {
    const user = userEvent.setup();
    const onSuccess = vi.fn();
    const mockResponse = {
      user: { id: 'user-123', email: 'test@example.com', name: 'Test', role: 'owner' as const, createdAt: '', updatedAt: '' },
      accessToken: 'new-token',
      refreshToken: 'refresh-token',
      expiresIn: 900000,
    };
    vi.mocked(authApi.mfaTotpValidate).mockResolvedValue(mockResponse);

    render(<MFAChallenge {...defaultProps} onSuccess={onSuccess} />);

    await user.type(screen.getByLabelText(/authentication code/i), '123456');
    await user.click(screen.getByRole('button', { name: /verify/i }));

    await waitFor(() => {
      expect(authApi.mfaTotpValidate).toHaveBeenCalledWith('user-123', '123456', 'mfa-token-abc');
    });
    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalledWith(mockResponse);
    });
  });

  it('shows error on invalid TOTP code', async () => {
    const user = userEvent.setup();
    vi.mocked(authApi.mfaTotpValidate).mockRejectedValue(new Error('Invalid code'));

    render(<MFAChallenge {...defaultProps} />);

    await user.type(screen.getByLabelText(/authentication code/i), '000000');
    await user.click(screen.getByRole('button', { name: /verify/i }));

    await waitFor(() => {
      expect(screen.getByText('Invalid code')).toBeInTheDocument();
    });
  });

  it('shows recovery code option', () => {
    render(<MFAChallenge {...defaultProps} />);
    expect(screen.getByText(/use a recovery code instead/i)).toBeInTheDocument();
  });

  it('switches to recovery code mode', async () => {
    const user = userEvent.setup();
    render(<MFAChallenge {...defaultProps} />);

    await user.click(screen.getByText(/use a recovery code instead/i));

    expect(screen.getByRole('heading', { name: /recovery code/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/recovery code/i)).toBeInTheDocument();
    expect(screen.getByText(/use authenticator app instead/i)).toBeInTheDocument();
  });

  it('submits recovery code', async () => {
    const user = userEvent.setup();
    const onSuccess = vi.fn();
    const mockResponse = {
      user: { id: 'user-123', email: 'test@example.com', name: 'Test', role: 'owner' as const, createdAt: '', updatedAt: '' },
      accessToken: 'new-token',
      refreshToken: 'refresh-token',
      expiresIn: 900000,
    };
    vi.mocked(authApi.mfaUseRecoveryCode).mockResolvedValue(mockResponse);

    render(<MFAChallenge {...defaultProps} onSuccess={onSuccess} />);

    // Switch to recovery mode
    await user.click(screen.getByText(/use a recovery code instead/i));

    await user.type(screen.getByLabelText(/recovery code/i), 'ABCDEF1234');
    await user.click(screen.getByRole('button', { name: /verify/i }));

    await waitFor(() => {
      expect(authApi.mfaUseRecoveryCode).toHaveBeenCalledWith('user-123', 'ABCDEF1234', 'mfa-token-abc');
    });
  });

  it('shows cancel button when onCancel provided', () => {
    const onCancel = vi.fn();
    render(<MFAChallenge {...defaultProps} onCancel={onCancel} />);
    expect(screen.getByText(/cancel/i)).toBeInTheDocument();
  });

  it('does not show cancel button when onCancel not provided', () => {
    render(<MFAChallenge {...defaultProps} />);
    expect(screen.queryByText(/^Cancel$/)).not.toBeInTheDocument();
  });
});
