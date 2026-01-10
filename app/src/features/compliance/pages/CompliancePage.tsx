/**
 * @file CompliancePage.tsx
 * @description Main page for compliance logging feature
 * @feature compliance
 */

import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Tabs } from '@/shared/components/ui/Tabs';
import { Button } from '@/shared/components/ui/Button';
import { ComplianceLogList } from '../components/ComplianceLogList';
import { ComplianceLogViewer } from '../components/ComplianceLogViewer';
import { IntegrityStatus } from '../components/IntegrityStatus';
import { RetentionSettings } from '../components/RetentionSettings';
import { LegalHoldManager } from '../components/LegalHoldManager';
import { ExportDialog } from '../components/ExportDialog';
import { RopaTab } from '../components/RopaTab';
import { ProviderDocsTab } from '../components/ProviderDocsTab';
import { useComplianceStore } from '../store';
import type { ComplianceLog, ComplianceEventType } from '../types';

/**
 * Main page for Compliance Logging (EU AI Act Art. 12, GDPR Art. 30)
 */
export function CompliancePage() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('logs');
  const [selectedLog, setSelectedLog] = useState<ComplianceLog | null>(null);
  const [showExportDialog, setShowExportDialog] = useState(false);

  const {
    logs,
    integrityResult,
    metrics,
    page,
    totalPages,
    filters,
    isLoading,
    isVerifying,
    isLoadingMetrics,
    fetchLogs,
    verifyIntegrity,
    fetchMetrics,
    setPage,
    setFilters,
    clearFilters,
  } = useComplianceStore();

  // Fetch logs on mount
  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  // Fetch metrics when switching to metrics tab
  useEffect(() => {
    if (activeTab === 'metrics' && !metrics) {
      fetchMetrics();
    }
  }, [activeTab, metrics, fetchMetrics]);

  const handleSelectLog = (log: ComplianceLog) => {
    setSelectedLog(log);
  };

  const handleBackToList = () => {
    setSelectedLog(null);
  };

  const handleViewDecision = (decisionId: string) => {
    navigate(`/explainability?decisionId=${decisionId}`);
  };

  const handlePageChange = (newPage: number) => {
    setPage(newPage);
  };

  const handleEventTypeFilter = (eventType: ComplianceEventType | undefined) => {
    if (eventType) {
      setFilters({ eventType });
    } else {
      clearFilters();
    }
  };

  // Logs Tab Content
  const logsContent = (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between mb-4">
        <p className="text-theme-tertiary text-sm">
          Every AI decision, safety action, and command execution is logged for regulatory compliance and audit trails.
        </p>
        <Button variant="secondary" onClick={() => setShowExportDialog(true)}>
          Export Logs
        </Button>
      </div>

      {/* Filter Buttons */}
      <div className="flex gap-2 mb-4 flex-wrap">
        <button
          type="button"
          className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
            !filters.eventType
              ? 'bg-primary-500 text-white'
              : 'bg-gray-800 text-theme-secondary hover:bg-gray-700'
          }`}
          onClick={() => handleEventTypeFilter(undefined)}
        >
          All Events
        </button>
        {(['ai_decision', 'safety_action', 'command_execution', 'system_event'] as const).map(
          (type) => (
            <button
              key={type}
              type="button"
              className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
                filters.eventType === type
                  ? 'bg-primary-500 text-white'
                  : 'bg-gray-800 text-theme-secondary hover:bg-gray-700'
              }`}
              onClick={() => handleEventTypeFilter(type)}
            >
              {type.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase())}
            </button>
          )
        )}
      </div>

      <div className="flex-1 flex gap-6 overflow-hidden">
        {/* Log List */}
        <div className="w-96 flex-shrink-0 flex flex-col overflow-hidden">
          <div className="flex-1 overflow-y-auto">
            <ComplianceLogList
              logs={logs}
              selectedId={selectedLog?.id}
              onSelect={handleSelectLog}
              isLoading={isLoading}
            />
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 mt-4 pt-4 border-t border-gray-700/50">
              <button
                type="button"
                className="px-3 py-1 text-sm rounded bg-gray-800 text-theme-secondary hover:bg-gray-700 disabled:opacity-50"
                disabled={page <= 1}
                onClick={() => handlePageChange(page - 1)}
              >
                Previous
              </button>
              <span className="text-sm text-theme-tertiary">
                Page {page} of {totalPages}
              </span>
              <button
                type="button"
                className="px-3 py-1 text-sm rounded bg-gray-800 text-theme-secondary hover:bg-gray-700 disabled:opacity-50"
                disabled={page >= totalPages}
                onClick={() => handlePageChange(page + 1)}
              >
                Next
              </button>
            </div>
          )}
        </div>

        {/* Log Viewer */}
        <div className="flex-1 overflow-y-auto">
          {selectedLog ? (
            <div>
              <button
                type="button"
                className="text-sm text-primary-400 hover:text-primary-300 mb-4"
                onClick={handleBackToList}
              >
                &larr; Back to list
              </button>
              <ComplianceLogViewer
                log={selectedLog}
                onViewDecision={handleViewDecision}
              />
            </div>
          ) : (
            <div className="h-full flex items-center justify-center">
              <p className="text-theme-tertiary">Select a log to view details</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );

  // Integrity Tab Content
  const integrityContent = (
    <div>
      <p className="text-theme-tertiary text-sm mb-4">
        Verify the cryptographic hash chain to ensure no logs have been tampered with.
        This is a key requirement for regulatory compliance.
      </p>
      <IntegrityStatus
        result={integrityResult}
        isVerifying={isVerifying}
        onVerify={verifyIntegrity}
      />
    </div>
  );

  // Metrics Tab Content
  const metricsContent = (
    <div>
      <p className="text-theme-tertiary text-sm mb-4">
        Overview of compliance logging activity and event distribution.
      </p>

      {isLoadingMetrics ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="glass-card p-4 animate-pulse">
              <div className="h-8 bg-gray-700 rounded mb-2" />
              <div className="h-4 bg-gray-700 rounded w-1/2" />
            </div>
          ))}
        </div>
      ) : metrics ? (
        <div className="space-y-6">
          {/* Summary Stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="glass-card p-4 text-center">
              <div className="text-3xl font-bold text-theme-primary">{metrics.totalLogs}</div>
              <div className="text-sm text-theme-tertiary">Total Logs</div>
            </div>
            <div className="glass-card p-4 text-center">
              <div className="text-3xl font-bold text-blue-400">{metrics.uniqueSessions}</div>
              <div className="text-sm text-theme-tertiary">Sessions</div>
            </div>
            <div className="glass-card p-4 text-center">
              <div className="text-3xl font-bold text-green-400">{metrics.uniqueRobots}</div>
              <div className="text-sm text-theme-tertiary">Robots</div>
            </div>
            <div className="glass-card p-4 text-center">
              <div className="text-3xl font-bold text-purple-400">
                {metrics.eventTypeCounts.length}
              </div>
              <div className="text-sm text-theme-tertiary">Event Types</div>
            </div>
          </div>

          {/* Event Type Breakdown */}
          <div className="glass-card p-4">
            <h4 className="font-medium text-theme-primary mb-4">Events by Type</h4>
            <div className="space-y-3">
              {metrics.eventTypeCounts.map((item) => (
                <div key={item.eventType} className="flex items-center gap-4">
                  <div className="w-32 text-sm text-theme-secondary">
                    {item.eventType.replace(/_/g, ' ')}
                  </div>
                  <div className="flex-1 bg-gray-800 rounded-full h-4 overflow-hidden">
                    <div
                      className="h-full bg-primary-500 rounded-full"
                      style={{
                        width: `${(item.count / metrics.totalLogs) * 100}%`,
                      }}
                    />
                  </div>
                  <div className="w-16 text-right text-sm text-theme-primary">{item.count}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Severity Breakdown */}
          <div className="glass-card p-4">
            <h4 className="font-medium text-theme-primary mb-4">Events by Severity</h4>
            <div className="grid grid-cols-5 gap-4">
              {(['debug', 'info', 'warning', 'error', 'critical'] as const).map((severity) => (
                <div key={severity} className="text-center p-3 bg-gray-800/50 rounded-lg">
                  <div className="text-xl font-bold text-theme-primary">
                    {metrics.severityCounts[severity] || 0}
                  </div>
                  <div className="text-xs text-theme-tertiary uppercase">{severity}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <div className="glass-card p-6 text-center">
          <p className="text-theme-tertiary">No metrics data available</p>
        </div>
      )}
    </div>
  );

  // RoPA Tab Content
  const ropaContent = <RopaTab />;

  // Technical Docs Tab Content
  const technicalDocsContent = <ProviderDocsTab />;

  // Settings Tab Content
  const settingsContent = (
    <div className="space-y-8">
      <RetentionSettings />
      <div className="border-t border-gray-700/50 pt-8">
        <LegalHoldManager />
      </div>
    </div>
  );

  // Tab configuration - no useMemo needed since content is JSX that changes each render
  const tabs = [
    {
      id: 'logs',
      label: 'Audit Logs',
      content: logsContent,
    },
    {
      id: 'integrity',
      label: 'Integrity',
      content: integrityContent,
    },
    {
      id: 'metrics',
      label: 'Metrics',
      content: metricsContent,
    },
    {
      id: 'ropa',
      label: 'RoPA',
      content: ropaContent,
    },
    {
      id: 'technical-docs',
      label: 'Technical Docs',
      content: technicalDocsContent,
    },
    {
      id: 'settings',
      label: 'Settings',
      content: settingsContent,
    },
  ];

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <header className="flex-shrink-0 px-6 py-4 border-b border-gray-700/50">
        <h1 className="text-2xl font-bold text-theme-primary">Compliance Logging</h1>
        <p className="text-theme-secondary mt-1">
          Tamper-evident audit trail per EU AI Act Art. 12 and GDPR Art. 30
        </p>
      </header>

      {/* Info Box */}
      <div className="flex-shrink-0 px-6 pt-4">
        <div className="bg-indigo-900/30 border border-indigo-700/50 rounded-lg p-4">
          <h3 className="font-semibold text-indigo-300 mb-2">What is Compliance Logging?</h3>
          <p className="text-indigo-200/80 text-sm">
            This system maintains a cryptographically secured, tamper-evident record of all AI decisions and robot actions.
            Required by EU regulations, this helps you:
          </p>
          <ul className="text-indigo-200/80 text-sm mt-2 space-y-1 ml-4 list-disc">
            <li><strong className="text-indigo-300">Audit</strong> every AI decision and command execution</li>
            <li><strong className="text-indigo-300">Verify</strong> log integrity using cryptographic hash chains</li>
            <li><strong className="text-indigo-300">Comply</strong> with EU AI Act record-keeping requirements</li>
            <li><strong className="text-indigo-300">Investigate</strong> incidents with complete audit trails</li>
          </ul>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden p-6">
        <Tabs
          tabs={tabs}
          activeTab={activeTab}
          onTabChange={setActiveTab}
          className="h-full"
        />
      </div>

      {/* Export Dialog */}
      <ExportDialog isOpen={showExportDialog} onClose={() => setShowExportDialog(false)} />
    </div>
  );
}
