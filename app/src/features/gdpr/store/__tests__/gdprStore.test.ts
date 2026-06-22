/**
 * @file gdprStore.test.ts
 * @description Tests for the GDPR Zustand store
 * @feature gdpr
 */

import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import {
  useGDPRStore,
  selectRequests,
  selectSelectedRequest,
  selectConsents,
  selectMetrics,
  selectPagination,
  selectError,
  selectIsSubmitting,
} from '../gdprStore';

vi.mock('../../api', () => ({
  gdprApi: {
    getMyRequests: vi.fn(),
    getRequest: vi.fn(),
    submitAccessRequest: vi.fn(),
    submitRectificationRequest: vi.fn(),
    submitErasureRequest: vi.fn(),
    submitRestrictionRequest: vi.fn(),
    submitPortabilityRequest: vi.fn(),
    submitObjectionRequest: vi.fn(),
    submitADMReviewRequest: vi.fn(),
    cancelRequest: vi.fn(),
    downloadExport: vi.fn(),
    getConsents: vi.fn(),
    updateConsent: vi.fn(),
    getAdminRequests: vi.fn(),
    acknowledgeRequest: vi.fn(),
    completeRequest: vi.fn(),
    rejectRequest: vi.fn(),
    getMetrics: vi.fn(),
    getSLAReport: vi.fn(),
  },
}));

import { gdprApi } from '../../api';

const api = gdprApi as unknown as Record<string, Mock>;

const req = (id: string, extra: Record<string, unknown> = {}) => ({ id, ...extra }) as any;

describe('gdprStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useGDPRStore.getState().reset();
  });

  it('starts with the initial state', () => {
    const s = useGDPRStore.getState();
    expect(s.requests).toEqual([]);
    expect(s.selectedRequest).toBeNull();
    expect(s.requestHistory).toEqual([]);
    expect(s.consents).toEqual([]);
    expect(s.metrics).toBeNull();
    expect(s.pagination).toEqual({ page: 1, limit: 20, total: 0 });
    expect(s.isLoading).toBe(false);
    expect(s.isSubmitting).toBe(false);
    expect(s.error).toBeNull();
  });

  // --- fetchMyRequests ---
  it('fetchMyRequests stores requests on success', async () => {
    api.getMyRequests.mockResolvedValue({ requests: [req('r1')] });
    await useGDPRStore.getState().fetchMyRequests();
    expect(useGDPRStore.getState().requests).toEqual([req('r1')]);
    expect(useGDPRStore.getState().isLoading).toBe(false);
  });

  it('fetchMyRequests sets error on failure', async () => {
    api.getMyRequests.mockRejectedValue(new Error('list-fail'));
    await useGDPRStore.getState().fetchMyRequests();
    expect(useGDPRStore.getState().error).toBe('list-fail');
    expect(useGDPRStore.getState().isLoading).toBe(false);
  });

  it('fetchMyRequests uses default message for non-Error throws', async () => {
    api.getMyRequests.mockRejectedValue('boom');
    await useGDPRStore.getState().fetchMyRequests();
    expect(useGDPRStore.getState().error).toBe('Failed to fetch requests');
  });

  // --- fetchRequest ---
  it('fetchRequest stores selected request and history', async () => {
    api.getRequest.mockResolvedValue({ request: req('r1'), history: [{ at: 't' }] });
    await useGDPRStore.getState().fetchRequest('r1');
    const s = useGDPRStore.getState();
    expect(s.selectedRequest).toEqual(req('r1'));
    expect(s.requestHistory).toEqual([{ at: 't' }]);
    expect(s.isLoadingRequest).toBe(false);
  });

  it('fetchRequest sets error on failure', async () => {
    api.getRequest.mockRejectedValue(new Error('one-fail'));
    await useGDPRStore.getState().fetchRequest('r1');
    expect(useGDPRStore.getState().error).toBe('one-fail');
    expect(useGDPRStore.getState().isLoadingRequest).toBe(false);
  });

  // --- submit* (representative coverage of the shared pattern) ---
  it('submitAccessRequest prepends new request and returns it', async () => {
    api.submitAccessRequest.mockResolvedValue(req('new'));
    useGDPRStore.setState({ requests: [req('old')] });
    const result = await useGDPRStore.getState().submitAccessRequest();
    expect(result).toEqual(req('new'));
    expect(useGDPRStore.getState().requests).toEqual([req('new'), req('old')]);
    expect(useGDPRStore.getState().isSubmitting).toBe(false);
  });

  it('submitAccessRequest sets error and rethrows on failure', async () => {
    api.submitAccessRequest.mockRejectedValue(new Error('acc-fail'));
    await expect(useGDPRStore.getState().submitAccessRequest()).rejects.toThrow('acc-fail');
    expect(useGDPRStore.getState().error).toBe('acc-fail');
    expect(useGDPRStore.getState().isSubmitting).toBe(false);
  });

  it('submitRectificationRequest prepends and passes input', async () => {
    api.submitRectificationRequest.mockResolvedValue(req('rect'));
    const input = { corrections: {} } as any;
    await useGDPRStore.getState().submitRectificationRequest(input);
    expect(api.submitRectificationRequest).toHaveBeenCalledWith(input);
    expect(useGDPRStore.getState().requests[0]).toEqual(req('rect'));
  });

  it('submitErasureRequest prepends new request', async () => {
    api.submitErasureRequest.mockResolvedValue(req('era'));
    await useGDPRStore.getState().submitErasureRequest();
    expect(useGDPRStore.getState().requests[0]).toEqual(req('era'));
  });

  it('submitRestrictionRequest rethrows on failure', async () => {
    api.submitRestrictionRequest.mockRejectedValue(new Error('res-fail'));
    await expect(
      useGDPRStore.getState().submitRestrictionRequest({} as any)
    ).rejects.toThrow('res-fail');
    expect(useGDPRStore.getState().error).toBe('res-fail');
  });

  it('submitPortabilityRequest prepends new request', async () => {
    api.submitPortabilityRequest.mockResolvedValue(req('port'));
    await useGDPRStore.getState().submitPortabilityRequest({} as any);
    expect(useGDPRStore.getState().requests[0]).toEqual(req('port'));
  });

  it('submitObjectionRequest prepends new request', async () => {
    api.submitObjectionRequest.mockResolvedValue(req('obj'));
    await useGDPRStore.getState().submitObjectionRequest({} as any);
    expect(useGDPRStore.getState().requests[0]).toEqual(req('obj'));
  });

  it('submitADMReviewRequest prepends new request', async () => {
    api.submitADMReviewRequest.mockResolvedValue(req('adm'));
    await useGDPRStore.getState().submitADMReviewRequest({} as any);
    expect(useGDPRStore.getState().requests[0]).toEqual(req('adm'));
  });

  // --- cancelRequest (in-place update + selectedRequest sync) ---
  it('cancelRequest replaces matching request and updates selected', async () => {
    api.cancelRequest.mockResolvedValue(req('r1', { status: 'cancelled' }));
    useGDPRStore.setState({
      requests: [req('r1', { status: 'pending' }), req('r2')],
      selectedRequest: req('r1', { status: 'pending' }),
    });
    await useGDPRStore.getState().cancelRequest('r1');
    const s = useGDPRStore.getState();
    expect(s.requests[0]).toEqual(req('r1', { status: 'cancelled' }));
    expect(s.requests[1]).toEqual(req('r2'));
    expect(s.selectedRequest).toEqual(req('r1', { status: 'cancelled' }));
  });

  it('cancelRequest leaves selected untouched when id differs', async () => {
    api.cancelRequest.mockResolvedValue(req('r1', { status: 'cancelled' }));
    useGDPRStore.setState({
      requests: [req('r1')],
      selectedRequest: req('r9'),
    });
    await useGDPRStore.getState().cancelRequest('r1');
    expect(useGDPRStore.getState().selectedRequest).toEqual(req('r9'));
  });

  it('cancelRequest sets error and rethrows on failure', async () => {
    api.cancelRequest.mockRejectedValue(new Error('cancel-fail'));
    await expect(useGDPRStore.getState().cancelRequest('r1')).rejects.toThrow('cancel-fail');
    expect(useGDPRStore.getState().error).toBe('cancel-fail');
    expect(useGDPRStore.getState().isSubmitting).toBe(false);
  });

  // --- downloadExport ---
  it('downloadExport returns data without mutating state', async () => {
    api.downloadExport.mockResolvedValue({ data: 1 });
    const result = await useGDPRStore.getState().downloadExport('r1');
    expect(result).toEqual({ data: 1 });
    expect(useGDPRStore.getState().error).toBeNull();
  });

  it('downloadExport sets error and rethrows on failure', async () => {
    api.downloadExport.mockRejectedValue(new Error('dl-fail'));
    await expect(useGDPRStore.getState().downloadExport('r1')).rejects.toThrow('dl-fail');
    expect(useGDPRStore.getState().error).toBe('dl-fail');
  });

  // --- consents ---
  it('fetchConsents stores consents', async () => {
    api.getConsents.mockResolvedValue({ consents: [{ consentType: 'analytics' }] });
    await useGDPRStore.getState().fetchConsents();
    expect(useGDPRStore.getState().consents).toEqual([{ consentType: 'analytics' }]);
    expect(useGDPRStore.getState().isLoadingConsents).toBe(false);
  });

  it('fetchConsents sets error on failure', async () => {
    api.getConsents.mockRejectedValue(new Error('con-fail'));
    await useGDPRStore.getState().fetchConsents();
    expect(useGDPRStore.getState().error).toBe('con-fail');
    expect(useGDPRStore.getState().isLoadingConsents).toBe(false);
  });

  it('updateConsent replaces existing consent of same type', async () => {
    api.updateConsent.mockResolvedValue({ consentType: 'analytics', granted: false });
    useGDPRStore.setState({
      consents: [{ consentType: 'analytics', granted: true } as any, { consentType: 'marketing' } as any],
    });
    await useGDPRStore.getState().updateConsent('analytics' as any, false);
    expect(api.updateConsent).toHaveBeenCalledWith('analytics', false);
    expect(useGDPRStore.getState().consents).toEqual([
      { consentType: 'analytics', granted: false },
      { consentType: 'marketing' },
    ]);
  });

  it('updateConsent pushes a new consent when type not present', async () => {
    api.updateConsent.mockResolvedValue({ consentType: 'newType', granted: true });
    useGDPRStore.setState({ consents: [{ consentType: 'analytics' } as any] });
    await useGDPRStore.getState().updateConsent('newType' as any, true);
    expect(useGDPRStore.getState().consents).toEqual([
      { consentType: 'analytics' },
      { consentType: 'newType', granted: true },
    ]);
  });

  it('updateConsent sets error and rethrows on failure', async () => {
    api.updateConsent.mockRejectedValue(new Error('uc-fail'));
    await expect(
      useGDPRStore.getState().updateConsent('analytics' as any, true)
    ).rejects.toThrow('uc-fail');
    expect(useGDPRStore.getState().error).toBe('uc-fail');
  });

  // --- admin ---
  it('fetchAdminRequests stores requests and pagination', async () => {
    api.getAdminRequests.mockResolvedValue({
      requests: [req('a1')],
      page: 2,
      limit: 10,
      total: 25,
    });
    await useGDPRStore.getState().fetchAdminRequests({ status: 'pending' } as any);
    expect(api.getAdminRequests).toHaveBeenCalledWith({ status: 'pending' });
    const s = useGDPRStore.getState();
    expect(s.requests).toEqual([req('a1')]);
    expect(s.pagination).toEqual({ page: 2, limit: 10, total: 25 });
  });

  it('fetchAdminRequests sets error on failure', async () => {
    api.getAdminRequests.mockRejectedValue(new Error('admin-fail'));
    await useGDPRStore.getState().fetchAdminRequests();
    expect(useGDPRStore.getState().error).toBe('admin-fail');
    expect(useGDPRStore.getState().isLoading).toBe(false);
  });

  it('acknowledgeRequest updates matching request and selected', async () => {
    api.acknowledgeRequest.mockResolvedValue(req('a1', { status: 'acknowledged' }));
    useGDPRStore.setState({
      requests: [req('a1', { status: 'pending' })],
      selectedRequest: req('a1', { status: 'pending' }),
    });
    await useGDPRStore.getState().acknowledgeRequest('a1');
    expect(useGDPRStore.getState().requests[0]).toEqual(req('a1', { status: 'acknowledged' }));
    expect(useGDPRStore.getState().selectedRequest).toEqual(req('a1', { status: 'acknowledged' }));
  });

  it('completeRequest passes responseData and updates request', async () => {
    api.completeRequest.mockResolvedValue(req('a1', { status: 'completed' }));
    useGDPRStore.setState({ requests: [req('a1')] });
    await useGDPRStore.getState().completeRequest('a1', { foo: 'bar' });
    expect(api.completeRequest).toHaveBeenCalledWith('a1', { foo: 'bar' });
    expect(useGDPRStore.getState().requests[0]).toEqual(req('a1', { status: 'completed' }));
  });

  it('completeRequest sets error and rethrows on failure', async () => {
    api.completeRequest.mockRejectedValue(new Error('comp-fail'));
    await expect(useGDPRStore.getState().completeRequest('a1')).rejects.toThrow('comp-fail');
    expect(useGDPRStore.getState().error).toBe('comp-fail');
  });

  it('rejectRequest passes reason and updates request', async () => {
    api.rejectRequest.mockResolvedValue(req('a1', { status: 'rejected' }));
    useGDPRStore.setState({ requests: [req('a1')] });
    await useGDPRStore.getState().rejectRequest('a1', 'not valid');
    expect(api.rejectRequest).toHaveBeenCalledWith('a1', 'not valid');
    expect(useGDPRStore.getState().requests[0]).toEqual(req('a1', { status: 'rejected' }));
  });

  // --- metrics / SLA ---
  it('fetchMetrics stores metrics', async () => {
    api.getMetrics.mockResolvedValue({ totalRequests: 5 });
    await useGDPRStore.getState().fetchMetrics();
    expect(useGDPRStore.getState().metrics).toEqual({ totalRequests: 5 });
    expect(useGDPRStore.getState().isLoadingMetrics).toBe(false);
  });

  it('fetchMetrics sets error on failure', async () => {
    api.getMetrics.mockRejectedValue(new Error('met-fail'));
    await useGDPRStore.getState().fetchMetrics();
    expect(useGDPRStore.getState().error).toBe('met-fail');
    expect(useGDPRStore.getState().isLoadingMetrics).toBe(false);
  });

  it('fetchSLAReport stores SLA report', async () => {
    api.getSLAReport.mockResolvedValue({ onTime: 90 });
    await useGDPRStore.getState().fetchSLAReport();
    expect(useGDPRStore.getState().slaReport).toEqual({ onTime: 90 });
  });

  it('fetchSLAReport sets error on failure', async () => {
    api.getSLAReport.mockRejectedValue(new Error('sla-fail'));
    await useGDPRStore.getState().fetchSLAReport();
    expect(useGDPRStore.getState().error).toBe('sla-fail');
  });

  // --- state management ---
  it('clearSelectedRequest resets selected request and history', () => {
    useGDPRStore.setState({ selectedRequest: req('r1'), requestHistory: [{ at: 't' }] as any });
    useGDPRStore.getState().clearSelectedRequest();
    expect(useGDPRStore.getState().selectedRequest).toBeNull();
    expect(useGDPRStore.getState().requestHistory).toEqual([]);
  });

  it('clearError resets error', () => {
    useGDPRStore.setState({ error: 'boom' });
    useGDPRStore.getState().clearError();
    expect(useGDPRStore.getState().error).toBeNull();
  });

  it('reset restores the full initial state', () => {
    useGDPRStore.setState({
      requests: [req('r1')],
      error: 'boom',
      isLoading: true,
      pagination: { page: 9, limit: 99, total: 999 },
    });
    useGDPRStore.getState().reset();
    const s = useGDPRStore.getState();
    expect(s.requests).toEqual([]);
    expect(s.error).toBeNull();
    expect(s.isLoading).toBe(false);
    expect(s.pagination).toEqual({ page: 1, limit: 20, total: 0 });
  });

  // --- selectors ---
  it('selectors return the corresponding slices', () => {
    useGDPRStore.setState({
      requests: [req('r1')],
      selectedRequest: req('sel'),
      consents: [{ consentType: 'analytics' } as any],
      metrics: { totalRequests: 2 } as any,
      pagination: { page: 3, limit: 5, total: 7 },
      error: 'oops',
      isSubmitting: true,
    });
    const s = useGDPRStore.getState();
    expect(selectRequests(s)).toEqual([req('r1')]);
    expect(selectSelectedRequest(s)).toEqual(req('sel'));
    expect(selectConsents(s)).toEqual([{ consentType: 'analytics' }]);
    expect(selectMetrics(s)).toEqual({ totalRequests: 2 });
    expect(selectPagination(s)).toEqual({ page: 3, limit: 5, total: 7 });
    expect(selectError(s)).toBe('oops');
    expect(selectIsSubmitting(s)).toBe(true);
  });
});
