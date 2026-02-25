/**
 * @file mfa.test.tsx
 * @description Tests for MFA components — MFAEnrollment, MFAChallenge, MFASettings
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MFAEnrollment } from '../MFAEnrollment';
import { MFAChallenge } from '../MFAChallenge';
import { MFASettings } from '../MFASettings';

// ============================================================================
// MOCKS
// ============================================================================

const mockSetupTOTP = vi.fn();
const mockVerifySetupTOTP = vi.fn();
const mockVerifyTOTP = vi.fn();
const mockVerifyRecoveryCode = vi.fn();
const mockGetStatus = vi.fn();
const mockGetRecoveryCodes = vi.fn();
const mockRemoveCredential = vi.fn();
const mockGenerateRecoveryCodes = vi.fn();

vi.mock('../../api/mfaApi', () => ({
  mfaApi: {
    setupTOTP: (...args: unknown[]) => mockSetupTOTP(...args),
    verifySetupTOTP: (...args: unknown[]) => mockVerifySetupTOTP(...args),
    verifyTOTP: (...args: unknown[]) => mockVerifyTOTP(...args),
    verifyRecoveryCode: (...args: unknown[]) => mockVerifyRecoveryCode(...args),
    getStatus: (...args: unknown[]) => mockGetStatus(...args),
    getRecoveryCodes: (...args: unknown[]) => mockGetRecoveryCodes(...args),
    removeCredential: (...args: unknown[]) => mockRemoveCredential(...args),
    generateRecoveryCodes: (...args: unknown[]) => mockGenerateRecoveryCodes(...args),
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
});

// ============================================================================
// MFAEnrollment Tests
// ============================================================================

describe('MFAEnrollment', () => {
  it('renders the initial setup screen', () => {
    render(<MFAEnrollment />);
    expect(screen.getByText('Enable Two-Factor Authentication')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /set up totp/i })).toBeInTheDocument();
  });

  it('shows cancel button when onCancel provided', () => {
    const onCancel = vi.fn();
    render(<MFAEnrollment onCancel={onCancel} />);
    expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument();
  });

  it('shows QR code step after setup request', async () => {
    const user = userEvent.setup();
    mockSetupTOTP.mockResolvedValue({
      secret: 'TESTSECRET123',
      otpauthUrl: 'otpauth://totp/RoboMindOS:user@test.com?secret=TESTSECRET123',
      qrCodeUrl: 'https://chart.googleapis.com/chart?cht=qr&chl=otpauth%3A%2F%2Ftotp',
    });

    render(<MFAEnrollment />);
    await user.click(screen.getByRole('button', { name: /set up totp/i }));

    expect(screen.getByText('Scan QR Code')).toBeInTheDocument();
    expect(screen.getByText('TESTSECRET123')).toBeInTheDocument();
    expect(screen.getByAltText('TOTP QR Code')).toBeInTheDocument();
  });

  it('shows error when setup fails', async () => {
    const user = userEvent.setup();
    mockSetupTOTP.mockRejectedValue(new Error('Network error'));

    render(<MFAEnrollment />);
    await user.click(screen.getByRole('button', { name: /set up totp/i }));

    expect(screen.getByRole('alert')).toHaveTextContent('Network error');
  });
});

// ============================================================================
// MFAChallenge Tests
// ============================================================================

describe('MFAChallenge', () => {
  const defaultProps = {
    userId: 'user-123',
    onSuccess: vi.fn(),
  };

  it('renders TOTP code input by default', () => {
    render(<MFAChallenge {...defaultProps} />);
    expect(screen.getByText('Two-Factor Authentication')).toBeInTheDocument();
    expect(screen.getByLabelText(/authentication code/i)).toBeInTheDocument();
  });

  it('switches to recovery code mode', async () => {
    const user = userEvent.setup();
    render(<MFAChallenge {...defaultProps} />);

    await user.click(screen.getByText(/use a recovery code/i));
    expect(screen.getByLabelText(/recovery code/i)).toBeInTheDocument();
  });

  it('switches back to TOTP mode', async () => {
    const user = userEvent.setup();
    render(<MFAChallenge {...defaultProps} />);

    await user.click(screen.getByText(/use a recovery code/i));
    await user.click(screen.getByText(/use authenticator app/i));
    expect(screen.getByLabelText(/authentication code/i)).toBeInTheDocument();
  });

  it('calls verifyTOTP on submit with TOTP code', async () => {
    const user = userEvent.setup();
    const onSuccess = vi.fn();
    mockVerifyTOTP.mockResolvedValue({ verified: true });

    render(<MFAChallenge userId="user-123" onSuccess={onSuccess} />);

    await user.type(screen.getByLabelText(/authentication code/i), '123456');
    await user.click(screen.getByRole('button', { name: /verify/i }));

    expect(mockVerifyTOTP).toHaveBeenCalledWith('user-123', '123456');
    expect(onSuccess).toHaveBeenCalled();
  });

  it('shows error on verification failure', async () => {
    const user = userEvent.setup();
    mockVerifyTOTP.mockRejectedValue(new Error('Invalid TOTP code'));

    render(<MFAChallenge {...defaultProps} />);

    await user.type(screen.getByLabelText(/authentication code/i), '000000');
    await user.click(screen.getByRole('button', { name: /verify/i }));

    expect(screen.getByRole('alert')).toHaveTextContent('Invalid TOTP code');
  });

  it('shows back to login button when onCancel provided', () => {
    render(<MFAChallenge {...defaultProps} onCancel={vi.fn()} />);
    expect(screen.getByText(/back to login/i)).toBeInTheDocument();
  });

  it('verify button is disabled when code is empty', () => {
    render(<MFAChallenge {...defaultProps} />);
    expect(screen.getByRole('button', { name: /verify/i })).toBeDisabled();
  });
});

// ============================================================================
// MFASettings Tests
// ============================================================================

describe('MFASettings', () => {
  it('shows loading spinner initially', () => {
    mockGetStatus.mockReturnValue(new Promise(() => {})); // never resolves
    mockGetRecoveryCodes.mockReturnValue(new Promise(() => {}));

    const { container } = render(<MFASettings />);
    expect(container.querySelector('.animate-spin')).toBeInTheDocument();
  });

  it('shows disabled state when no MFA is active', async () => {
    mockGetStatus.mockResolvedValue({
      enabled: false,
      methods: [],
      hasRecoveryCodes: false,
    });
    mockGetRecoveryCodes.mockResolvedValue({ total: 0, remaining: 0 });

    render(<MFASettings />);

    expect(await screen.findByText('Disabled')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /enable two-factor/i })).toBeInTheDocument();
  });

  it('shows enabled state with active methods', async () => {
    mockGetStatus.mockResolvedValue({
      enabled: true,
      methods: [
        {
          id: 'cred-1',
          type: 'totp',
          name: 'Authenticator App',
          isActive: true,
          createdAt: '2026-01-01T00:00:00.000Z',
          lastUsed: null,
        },
      ],
      hasRecoveryCodes: true,
    });
    mockGetRecoveryCodes.mockResolvedValue({ total: 8, remaining: 6 });

    render(<MFASettings />);

    expect(await screen.findByText('Enabled')).toBeInTheDocument();
    expect(screen.getByText('Authenticator App')).toBeInTheDocument();
    expect(screen.getByText(/6 of 8 recovery codes remaining/i)).toBeInTheDocument();
  });

  it('shows error on status load failure', async () => {
    mockGetStatus.mockRejectedValue(new Error('Server error'));
    mockGetRecoveryCodes.mockRejectedValue(new Error('Server error'));

    render(<MFASettings />);

    expect(await screen.findByRole('alert')).toHaveTextContent('Server error');
  });
});
