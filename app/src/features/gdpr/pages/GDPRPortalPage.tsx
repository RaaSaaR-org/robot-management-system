/**
 * @file GDPRPortalPage.tsx
 * @description Main GDPR Rights Self-Service Portal page
 * @feature gdpr
 */

import { useState, useCallback } from 'react';
import { useGDPRStore } from '../store';
import { RequestList } from '../components/RequestList';
import { RequestTypeCard } from '../components/RequestTypeCard';
import { RequestDetail } from '../components/RequestDetail';
import { ConsentManager } from '../components/ConsentManager';
import type { GDPRRequest, GDPRRequestType, ConsentType } from '../types';
import { GDPRRequestTypes } from '../types';

type Tab = 'requests' | 'new' | 'consents';

export function GDPRPortalPage() {
  const [activeTab, setActiveTab] = useState<Tab>('requests');
  const [selectedRequest, setSelectedRequest] = useState<GDPRRequest | null>(null);
  const [showRequestModal, setShowRequestModal] = useState(false);

  const {
    requests,
    requestHistory,
    consents,
    isLoading,
    isLoadingRequest,
    isLoadingConsents,
    isSubmitting,
    error,
    fetchMyRequests,
    fetchRequest,
    fetchConsents,
    submitAccessRequest,
    submitPortabilityRequest,
    submitErasureRequest,
    cancelRequest,
    downloadExport,
    updateConsent,
    clearError,
  } = useGDPRStore();

  // Load requests on mount
  const handleLoadRequests = useCallback(() => {
    fetchMyRequests();
  }, [fetchMyRequests]);

  // Load consents
  const handleLoadConsents = useCallback(() => {
    fetchConsents();
  }, [fetchConsents]);

  // Handle request selection
  const handleSelectRequest = useCallback(async (request: GDPRRequest) => {
    await fetchRequest(request.id);
    setSelectedRequest(request);
    setShowRequestModal(true);
  }, [fetchRequest]);

  // Handle request type selection
  const handleSelectRequestType = useCallback(async (type: GDPRRequestType) => {
    try {
      switch (type) {
        case 'access':
          await submitAccessRequest({ format: 'json', includeMetadata: true });
          break;
        case 'portability':
          await submitPortabilityRequest({ format: 'json' });
          break;
        case 'erasure':
          await submitErasureRequest({});
          break;
        // Other types would open a form modal
        default:
          alert(`Request type "${type}" requires additional information. This feature is coming soon.`);
          return;
      }
      // Switch to requests tab to show the new request
      setActiveTab('requests');
      await fetchMyRequests();
    } catch (err) {
      // Error is handled by store
    }
  }, [submitAccessRequest, submitPortabilityRequest, submitErasureRequest, fetchMyRequests]);

  // Handle cancel request
  const handleCancelRequest = useCallback(async () => {
    if (selectedRequest) {
      try {
        await cancelRequest(selectedRequest.id);
        await fetchMyRequests();
        setShowRequestModal(false);
        setSelectedRequest(null);
      } catch (err) {
        // Error is handled by store
      }
    }
  }, [selectedRequest, cancelRequest, fetchMyRequests]);

  // Handle download
  const handleDownload = useCallback(async () => {
    if (selectedRequest) {
      try {
        const data = await downloadExport(selectedRequest.id);
        // Create download
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `gdpr-export-${selectedRequest.id}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      } catch (err) {
        // Error is handled by store
      }
    }
  }, [selectedRequest, downloadExport]);

  // Handle consent toggle
  const handleConsentToggle = useCallback(async (type: ConsentType, granted: boolean) => {
    await updateConsent(type, granted);
  }, [updateConsent]);

  const tabs = [
    { id: 'requests' as const, label: 'My Requests' },
    { id: 'new' as const, label: 'New Request' },
    { id: 'consents' as const, label: 'Consent Settings' },
  ];

  return (
    <div className="min-h-screen">
      {/* Header */}
      <div className="section-secondary border-b border-theme">
        <div className="max-w-5xl mx-auto px-4 py-6">
          <h1 className="text-2xl font-bold text-theme-primary">Data Privacy Portal</h1>
          <p className="text-theme-secondary mt-1">
            Manage your data rights under GDPR (Articles 15-22)
          </p>
        </div>
      </div>

      {/* Info Panel */}
      <div className="max-w-5xl mx-auto px-4 pt-4">
        <div className="bg-teal-900/30 border border-teal-700/50 rounded-lg p-4">
          <h3 className="font-semibold text-teal-300 mb-2">Your Data Rights Under GDPR</h3>
          <p className="text-teal-200/80 text-sm">
            The General Data Protection Regulation (GDPR) gives you control over your personal data.
            This portal allows you to exercise your rights directly:
          </p>
          <ul className="text-teal-200/80 text-sm mt-2 space-y-1 ml-4 list-disc">
            <li><strong className="text-teal-300">Access</strong> - Request a copy of all your personal data (Art. 15)</li>
            <li><strong className="text-teal-300">Rectification</strong> - Correct inaccurate personal data (Art. 16)</li>
            <li><strong className="text-teal-300">Erasure</strong> - Request deletion of your data (Art. 17)</li>
            <li><strong className="text-teal-300">Portability</strong> - Export your data in a portable format (Art. 20)</li>
            <li><strong className="text-teal-300">Object</strong> - Object to specific data processing (Art. 21)</li>
            <li><strong className="text-teal-300">ADM Review</strong> - Contest automated decisions (Art. 22)</li>
          </ul>
          <p className="text-teal-200/60 text-xs mt-3">
            Most requests are processed within 30 days. You can track the status of your requests in the "My Requests" tab.
          </p>
        </div>
      </div>

      {/* Error Banner */}
      {error && (
        <div className="max-w-5xl mx-auto px-4 mt-4">
          <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 flex items-start justify-between">
            <div className="flex items-start gap-3">
              <svg className="w-5 h-5 text-red-500 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                <path
                  fillRule="evenodd"
                  d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
                  clipRule="evenodd"
                />
              </svg>
              <p className="text-sm text-red-400">{error}</p>
            </div>
            <button onClick={clearError} className="text-red-500 hover:text-red-400">
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                <path
                  fillRule="evenodd"
                  d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                  clipRule="evenodd"
                />
              </svg>
            </button>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="max-w-5xl mx-auto px-4 mt-6">
        <div className="border-b border-theme">
          <nav className="-mb-px flex space-x-8">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => {
                  setActiveTab(tab.id);
                  if (tab.id === 'requests') handleLoadRequests();
                }}
                className={`
                  py-3 px-1 border-b-2 font-medium text-sm transition-colors
                  ${activeTab === tab.id
                    ? 'border-cobalt text-cobalt'
                    : 'border-transparent text-theme-secondary hover:text-theme-primary hover:border-theme'
                  }
                `}
              >
                {tab.label}
              </button>
            ))}
          </nav>
        </div>
      </div>

      {/* Tab Content */}
      <div className="max-w-5xl mx-auto px-4 py-6">
        {activeTab === 'requests' && (
          <RequestList
            requests={requests}
            onSelect={handleSelectRequest}
            isLoading={isLoading}
            emptyMessage="You have no data requests. Submit a new request to exercise your rights."
          />
        )}

        {activeTab === 'new' && (
          <div>
            <div className="mb-6">
              <h2 className="text-lg font-medium text-theme-primary">Submit a New Request</h2>
              <p className="text-sm text-theme-secondary mt-1">
                Select the type of request you'd like to submit. Most requests are processed within 30 days.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {GDPRRequestTypes.map((type) => (
                <RequestTypeCard
                  key={type}
                  type={type}
                  onClick={() => handleSelectRequestType(type)}
                  disabled={isSubmitting}
                />
              ))}
            </div>

            {isSubmitting && (
              <div className="mt-4 text-center text-sm text-theme-secondary">
                Submitting request...
              </div>
            )}
          </div>
        )}

        {activeTab === 'consents' && (
          <ConsentManager
            consents={consents}
            onToggle={handleConsentToggle}
            onLoad={handleLoadConsents}
            isLoading={isLoadingConsents}
            isUpdating={isSubmitting}
          />
        )}
      </div>

      {/* Request Detail Modal */}
      {showRequestModal && selectedRequest && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div className="flex items-center justify-center min-h-screen px-4 pt-4 pb-20 text-center sm:p-0">
            <div
              className="fixed inset-0 bg-black/60 transition-opacity"
              onClick={() => {
                setShowRequestModal(false);
                setSelectedRequest(null);
              }}
            />
            <div className="relative z-10 w-full max-w-2xl">
              <RequestDetail
                request={selectedRequest}
                history={requestHistory}
                onCancel={handleCancelRequest}
                onDownload={handleDownload}
                onClose={() => {
                  setShowRequestModal(false);
                  setSelectedRequest(null);
                }}
                isLoading={isLoadingRequest || isSubmitting}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
