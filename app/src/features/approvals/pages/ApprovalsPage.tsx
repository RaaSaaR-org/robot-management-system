/**
 * @file ApprovalsPage.tsx
 * @description Main page for human approval workflows
 * @feature approvals
 */

import { useState, useEffect } from 'react';
import { FileCheck, BarChart3, AlertTriangle, Users } from 'lucide-react';
import { cn } from '@/shared/utils/cn';
import { ApprovalQueue, ApprovalDetailPanel } from '../components';
import { useApprovalsStore } from '../store';

type TabType = 'queue' | 'metrics' | 'contests' | 'worker-portal';

const tabs: { id: TabType; label: string; icon: typeof FileCheck }[] = [
  { id: 'queue', label: 'Approval Queue', icon: FileCheck },
  { id: 'metrics', label: 'Metrics & SLA', icon: BarChart3 },
  { id: 'contests', label: 'Contests', icon: AlertTriangle },
  { id: 'worker-portal', label: 'Worker Portal', icon: Users },
];

export function ApprovalsPage() {
  const [activeTab, setActiveTab] = useState<TabType>('queue');
  const [selectedApprovalId, setSelectedApprovalId] = useState<string | null>(null);

  // Get selected approval from store
  const selectedRequest = useApprovalsStore((state) => state.selectedRequest);
  const selectRequest = useApprovalsStore((state) => state.selectRequest);

  // Load selected approval when ID changes
  useEffect(() => {
    if (selectedApprovalId) {
      selectRequest(selectedApprovalId);
    } else {
      selectRequest(null);
    }
  }, [selectedApprovalId, selectRequest]);

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="px-6 py-4 border-b border-theme-subtle bg-theme-surface">
        <h1 className="text-2xl font-semibold text-theme-primary">Human Approval Workflows</h1>
        <p className="text-sm text-theme-muted mt-1">
          GDPR Art. 22 & AI Act Art. 14 compliance - Review automated decisions with meaningful oversight
        </p>
      </div>

      {/* Tabs */}
      <div className="px-6 border-b border-theme-subtle bg-theme-surface">
        <nav className="flex gap-6">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  'flex items-center gap-2 py-3 border-b-2 text-sm font-medium transition-colors',
                  activeTab === tab.id
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-theme-secondary hover:text-theme-primary'
                )}
              >
                <Icon className="h-4 w-4" />
                {tab.label}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden flex">
        {activeTab === 'queue' && (
          <div className="flex-1 flex">
            <div className={cn('flex-1 p-6 overflow-hidden', selectedRequest && 'w-1/2')}>
              <ApprovalQueue
                onSelectApproval={setSelectedApprovalId}
                className="h-full"
              />
            </div>
            {selectedRequest && (
              <div className="w-1/2 border-l border-theme-subtle">
                <ApprovalDetailPanel
                  approval={selectedRequest}
                  onClose={() => setSelectedApprovalId(null)}
                />
              </div>
            )}
          </div>
        )}

        {activeTab === 'metrics' && (
          <div className="flex-1 flex items-center justify-center p-6 text-theme-secondary">
            <div className="text-center">
              <BarChart3 className="h-12 w-12 mx-auto mb-4 text-theme-muted" />
              <p className="text-lg font-medium text-theme-primary">Metrics & SLA Dashboard</p>
              <p className="text-sm">Coming soon - SLA compliance, oversight metrics</p>
            </div>
          </div>
        )}

        {activeTab === 'contests' && (
          <div className="flex-1 flex items-center justify-center p-6 text-theme-secondary">
            <div className="text-center">
              <AlertTriangle className="h-12 w-12 mx-auto mb-4 text-theme-muted" />
              <p className="text-lg font-medium text-theme-primary">Decision Contests</p>
              <p className="text-sm">Coming soon - Worker right to contest automated decisions</p>
            </div>
          </div>
        )}

        {activeTab === 'worker-portal' && (
          <div className="flex-1 flex items-center justify-center p-6 text-theme-secondary">
            <div className="text-center">
              <Users className="h-12 w-12 mx-auto mb-4 text-theme-muted" />
              <p className="text-lg font-medium text-theme-primary">Worker Self-Service Portal</p>
              <p className="text-sm">Coming soon - Submit viewpoints, request human intervention</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
