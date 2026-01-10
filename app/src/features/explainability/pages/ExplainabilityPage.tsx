/**
 * @file ExplainabilityPage.tsx
 * @description Main page for AI explainability feature
 * @feature explainability
 */

import { useState, useEffect, useMemo } from 'react';
import { Tabs } from '@/shared/components/ui/Tabs';
import { DecisionList } from '../components/DecisionList';
import { DecisionViewer } from '../components/DecisionViewer';
import { PerformanceDashboard } from '../components/PerformanceDashboard';
import { DocumentationPortal } from '../components/DocumentationPortal';
import { useDecisions } from '../hooks/useDecisions';
import { useMetrics } from '../hooks/useMetrics';
import { useDocumentation } from '../hooks/useDocumentation';
import type { DecisionExplanation, MetricsPeriod } from '../types';

/**
 * Main page for AI Explainability (EU AI Act compliance)
 */
export function ExplainabilityPage() {
  const [activeTab, setActiveTab] = useState('decisions');
  const [selectedDecisionId, setSelectedDecisionId] = useState<string | null>(null);

  const {
    decisions,
    selectedDecision,
    formattedExplanation,
    pagination,
    isLoading: isLoadingDecisions,
    isLoadingExplanation,
    fetchDecisions,
    selectDecision,
    fetchExplanation,
    clearSelection,
  } = useDecisions({ autoFetch: true });

  const {
    metrics,
    isLoading: isLoadingMetrics,
    fetchMetrics,
  } = useMetrics({ autoFetch: true });

  const {
    documentation,
    isLoading: isLoadingDocumentation,
    fetchDocumentation,
  } = useDocumentation({ autoFetch: true });

  // Fetch documentation when switching to that tab
  useEffect(() => {
    if (activeTab === 'documentation' && !documentation) {
      fetchDocumentation();
    }
  }, [activeTab, documentation, fetchDocumentation]);

  const handleSelectDecision = async (decision: DecisionExplanation) => {
    setSelectedDecisionId(decision.id);
    await selectDecision(decision.id);
  };

  const handleLoadExplanation = async () => {
    if (selectedDecisionId) {
      await fetchExplanation(selectedDecisionId);
    }
  };

  const handlePeriodChange = async (period: MetricsPeriod) => {
    await fetchMetrics(period);
  };

  const handlePageChange = async (page: number) => {
    await fetchDecisions(page);
  };

  const handleBackToList = () => {
    setSelectedDecisionId(null);
    clearSelection();
  };

  // Decisions Tab Content
  const decisionsContent = (
    <div className="h-full flex flex-col">
      <p className="text-theme-tertiary text-sm mb-4">
        Every command you send to a robot generates an AI decision. Select one to see the full reasoning process.
      </p>
      <div className="flex-1 flex gap-6">
        {/* Decision List */}
        <div className="w-80 flex-shrink-0 overflow-y-auto">
          <DecisionList
          decisions={decisions}
          selectedId={selectedDecisionId ?? undefined}
          onSelect={handleSelectDecision}
          isLoading={isLoadingDecisions}
        />
        {/* Pagination */}
        {pagination.totalPages > 1 && (
          <div className="flex items-center justify-center gap-2 mt-4 pt-4 border-t border-gray-700/50">
            <button
              type="button"
              className="px-3 py-1 text-sm rounded bg-gray-800 text-theme-secondary hover:bg-gray-700 disabled:opacity-50"
              disabled={pagination.page <= 1}
              onClick={() => handlePageChange(pagination.page - 1)}
            >
              Previous
            </button>
            <span className="text-sm text-theme-tertiary">
              Page {pagination.page} of {pagination.totalPages}
            </span>
            <button
              type="button"
              className="px-3 py-1 text-sm rounded bg-gray-800 text-theme-secondary hover:bg-gray-700 disabled:opacity-50"
              disabled={pagination.page >= pagination.totalPages}
              onClick={() => handlePageChange(pagination.page + 1)}
            >
              Next
            </button>
          </div>
        )}
      </div>

      {/* Decision Viewer */}
      <div className="flex-1 overflow-y-auto">
        {selectedDecision ? (
          <div>
            <button
              type="button"
              className="text-sm text-primary-400 hover:text-primary-300 mb-4"
              onClick={handleBackToList}
            >
              &larr; Back to list
            </button>
            <DecisionViewer
              decision={selectedDecision}
              explanation={formattedExplanation}
              onLoadExplanation={handleLoadExplanation}
              isLoadingExplanation={isLoadingExplanation}
            />
          </div>
        ) : (
          <div className="h-full flex items-center justify-center">
            <p className="text-theme-tertiary">Select a decision to view details</p>
          </div>
        )}
      </div>
      </div>
    </div>
  );

  // Metrics Tab Content
  const metricsContent = (
    <div>
      <p className="text-theme-tertiary text-sm mb-4">
        Track how well the AI is performing. These metrics help identify if the system needs attention.
      </p>
      <PerformanceDashboard
        metrics={metrics}
        isLoading={isLoadingMetrics}
        onPeriodChange={handlePeriodChange}
      />
    </div>
  );

  // Documentation Tab Content
  const documentationContent = (
    <div>
      <p className="text-theme-tertiary text-sm mb-4">
        Technical documentation about the AI system's capabilities, limitations, and compliance information.
      </p>
      <DocumentationPortal
        documentation={documentation}
        isLoading={isLoadingDocumentation}
      />
    </div>
  );

  // Tab configuration
  const tabs = useMemo(
    () => [
      {
        id: 'decisions',
        label: 'Decisions',
        content: decisionsContent,
      },
      {
        id: 'metrics',
        label: 'Performance',
        content: metricsContent,
      },
      {
        id: 'documentation',
        label: 'Documentation',
        content: documentationContent,
      },
    ],
    [decisionsContent, metricsContent, documentationContent]
  );

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <header className="flex-shrink-0 px-6 py-4 border-b border-gray-700/50">
        <h1 className="text-2xl font-bold text-theme-primary">AI Explainability</h1>
        <p className="text-theme-secondary mt-1">
          Transparency and decision explanations per EU AI Act
        </p>
      </header>

      {/* Info Box */}
      <div className="flex-shrink-0 px-6 pt-4">
        <div className="bg-blue-900/30 border border-blue-700/50 rounded-lg p-4">
          <h3 className="font-semibold text-blue-300 mb-2">What is AI Explainability?</h3>
          <p className="text-blue-200/80 text-sm">
            When AI makes decisions about robot actions, this page shows you exactly what happened and why.
            Required by the EU AI Act for transparency, this helps you:
          </p>
          <ul className="text-blue-200/80 text-sm mt-2 space-y-1 ml-4 list-disc">
            <li><strong className="text-blue-300">Understand</strong> how the AI interprets your commands</li>
            <li><strong className="text-blue-300">Verify</strong> that decisions are safe and appropriate</li>
            <li><strong className="text-blue-300">Monitor</strong> AI performance over time</li>
            <li><strong className="text-blue-300">Audit</strong> past decisions for compliance</li>
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
    </div>
  );
}
