/**
 * @file MFASetup.test.tsx
 * @description Tests for MFASetup component
 * @feature auth
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MFASetup } from '../components/MFASetup';

// Mock the authApi
vi.mock('../api/authApi', () => ({
  authApi: {
    mfaTotpSetup: vi.fn(),
    mfaTotpVerify: vi.fn(),
  },
}));

import { authApi } from '../api/authApi';

describe('MFASetup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders init step with "Start Setup" button', () => {
    render(<MFASetup />);
    expect(screen.getByText('Set up Two-Factor Authentication')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /start setup/i })).toBeInTheDocument();
  });

  it('shows error on failed setup API call', async () => {
    const user = userEvent.setup();
    vi.mocked(authApi.mfaTotpSetup).mockRejectedValue(new Error('Network error'));

    render(<MFASetup />);
    await user.click(screen.getByRole('button', { name: /start setup/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Network error');
    });
  });

  it('shows secret and otpauth URL after successful setup', async () => {
    const user = userEvent.setup();
    vi.mocked(authApi.mfaTotpSetup).mockResolvedValue({
      secret: 'JBSWY3DPEHPK3PXP',
      otpauthUrl: 'otpauth://totp/RoboMindOS:test@example.com?secret=JBSWY3DPEHPK3PXP&issuer=RoboMindOS',
    });

    render(<MFASetup />);
    await user.click(screen.getByRole('button', { name: /start setup/i }));

    await waitFor(() => {
      expect(screen.getByText('Configure Your Authenticator App')).toBeInTheDocument();
    });
    expect(screen.getByText('JBSWY3DPEHPK3PXP')).toBeInTheDocument();
    expect(screen.getByText(/otpauth:\/\/totp\//)).toBeInTheDocument();
  });

  it('calls mfaTotpVerify with correct args on code submit', async () => {
    const user = userEvent.setup();
    vi.mocked(authApi.mfaTotpSetup).mockResolvedValue({
      secret: 'TESTSECRET',
      otpauthUrl: 'otpauth://totp/Test',
    });
    vi.mocked(authApi.mfaTotpVerify).mockResolvedValue({
      message: 'TOTP enabled successfully',
      recoveryCodes: ['CODE1', 'CODE2'],
    });

    render(<MFASetup />);
    await user.click(screen.getByRole('button', { name: /start setup/i }));

    await waitFor(() => {
      expect(screen.getByLabelText(/verification code/i)).toBeInTheDocument();
    });

    const input = screen.getByLabelText(/verification code/i);
    await user.type(input, '123456');
    await user.click(screen.getByRole('button', { name: /verify/i }));

    await waitFor(() => {
      expect(authApi.mfaTotpVerify).toHaveBeenCalledWith('TESTSECRET', '123456');
    });
  });

  it('shows recovery codes after successful verification', async () => {
    const user = userEvent.setup();
    vi.mocked(authApi.mfaTotpSetup).mockResolvedValue({
      secret: 'TESTSECRET',
      otpauthUrl: 'otpauth://totp/Test',
    });
    vi.mocked(authApi.mfaTotpVerify).mockResolvedValue({
      message: 'TOTP enabled',
      recoveryCodes: ['ABCDEF1234', 'GHIJKL5678'],
    });

    render(<MFASetup />);
    await user.click(screen.getByRole('button', { name: /start setup/i }));

    await waitFor(() => {
      expect(screen.getByLabelText(/verification code/i)).toBeInTheDocument();
    });

    await user.type(screen.getByLabelText(/verification code/i), '123456');
    await user.click(screen.getByRole('button', { name: /verify/i }));

    await waitFor(() => {
      expect(screen.getByText('Save Your Recovery Codes')).toBeInTheDocument();
    });
    expect(screen.getByText('ABCDEF1234')).toBeInTheDocument();
    expect(screen.getByText('GHIJKL5678')).toBeInTheDocument();
  });

  it('calls onCancel when cancel button is clicked', async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();

    render(<MFASetup onCancel={onCancel} />);
    await user.click(screen.getByRole('button', { name: /cancel/i }));

    expect(onCancel).toHaveBeenCalledOnce();
  });
});
