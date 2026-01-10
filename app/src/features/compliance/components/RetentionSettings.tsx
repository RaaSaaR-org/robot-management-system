/**
 * @file RetentionSettings.tsx
 * @description Retention policy management component
 * @feature compliance
 */

import { useEffect, useState } from 'react';
import { Card } from '@/shared/components/ui/Card';
import { Button } from '@/shared/components/ui/Button';
import { useComplianceStore } from '../store';
import type { ComplianceEventType } from '../types';

// Human-readable labels for event types
const EVENT_TYPE_LABELS: Record<ComplianceEventType, string> = {
  ai_decision: 'AI Decisions',
  safety_action: 'Safety Actions',
  command_execution: 'Command Executions',
  system_event: 'System Events',
  access_audit: 'Access Audits',
};

// Descriptions for each event type
const EVENT_TYPE_DESCRIPTIONS: Record<ComplianceEventType, string> = {
  ai_decision: 'AI model decisions (EU AI Act requires 10 years)',
  safety_action: 'Emergency stops, safety triggers',
  command_execution: 'Robot commands and executions',
  system_event: 'System startup, shutdown, errors',
  access_audit: 'Log access and export records',
};

export interface RetentionSettingsProps {
  className?: string;
}

/**
 * Component for managing retention policies
 */
export function RetentionSettings({ className }: RetentionSettingsProps) {
  const {
    retentionPolicies,
    retentionStats,
    isLoadingRetention,
    isCleaningUp,
    error,
    fetchRetentionPolicies,
    fetchRetentionStats,
    setRetentionPolicy,
    triggerCleanup,
  } = useComplianceStore();

  const [editingType, setEditingType] = useState<ComplianceEventType | null>(null);
  const [editValue, setEditValue] = useState<number>(365);
  const [cleanupResult, setCleanupResult] = useState<{ logsDeleted: number; logsSkipped: number } | null>(null);

  // Fetch on mount
  useEffect(() => {
    fetchRetentionPolicies();
    fetchRetentionStats();
  }, [fetchRetentionPolicies, fetchRetentionStats]);

  const getPolicyDays = (eventType: ComplianceEventType): number => {
    const policy = retentionPolicies.find((p) => p.eventType === eventType);
    return policy?.retentionDays ?? 365;
  };

  const handleEdit = (eventType: ComplianceEventType) => {
    setEditingType(eventType);
    setEditValue(getPolicyDays(eventType));
  };

  const handleSave = async () => {
    if (!editingType) return;
    await setRetentionPolicy(editingType, editValue);
    setEditingType(null);
  };

  const handleCleanup = async () => {
    try {
      const result = await triggerCleanup();
      setCleanupResult(result);
      setTimeout(() => setCleanupResult(null), 5000);
    } catch {
      // Error is handled in store
    }
  };

  const formatDays = (days: number): string => {
    if (days >= 365) {
      const years = Math.floor(days / 365);
      return `${years} year${years > 1 ? 's' : ''}`;
    }
    return `${days} days`;
  };

  return (
    <div className={className}>
      <div className="mb-6">
        <h3 className="text-lg font-semibold text-theme-primary mb-2">Retention Policies</h3>
        <p className="text-theme-tertiary text-sm">
          Configure how long compliance logs are retained before automatic deletion.
          Logs under legal hold are never deleted.
        </p>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-900/30 border border-red-700/50 rounded-lg text-red-300 text-sm">
          {error}
        </div>
      )}

      {/* Retention Stats */}
      {retentionStats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <Card className="glass-card p-4 text-center">
            <div className="text-2xl font-bold text-theme-primary">{retentionStats.totalLogs}</div>
            <div className="text-xs text-theme-tertiary">Total Logs</div>
          </Card>
          <Card className="glass-card p-4 text-center">
            <div className="text-2xl font-bold text-yellow-400">{retentionStats.expiringWithin30Days}</div>
            <div className="text-xs text-theme-tertiary">Expiring in 30 Days</div>
          </Card>
          <Card className="glass-card p-4 text-center">
            <div className="text-2xl font-bold text-orange-400">{retentionStats.expiringWithin90Days}</div>
            <div className="text-xs text-theme-tertiary">Expiring in 90 Days</div>
          </Card>
          <Card className="glass-card p-4 text-center">
            <div className="text-2xl font-bold text-blue-400">{retentionStats.underLegalHold}</div>
            <div className="text-xs text-theme-tertiary">Under Legal Hold</div>
          </Card>
        </div>
      )}

      {/* Policy Table */}
      <Card className="glass-card overflow-hidden mb-6">
        <table className="w-full">
          <thead className="bg-gray-800/50">
            <tr>
              <th className="px-4 py-3 text-left text-sm font-medium text-theme-secondary">Event Type</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-theme-secondary">Description</th>
              <th className="px-4 py-3 text-center text-sm font-medium text-theme-secondary">Retention</th>
              <th className="px-4 py-3 text-right text-sm font-medium text-theme-secondary">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-700/50">
            {(['ai_decision', 'safety_action', 'command_execution', 'system_event', 'access_audit'] as const).map(
              (eventType) => (
                <tr key={eventType} className="hover:bg-gray-800/30">
                  <td className="px-4 py-3 text-sm text-theme-primary font-medium">
                    {EVENT_TYPE_LABELS[eventType]}
                  </td>
                  <td className="px-4 py-3 text-sm text-theme-tertiary">
                    {EVENT_TYPE_DESCRIPTIONS[eventType]}
                  </td>
                  <td className="px-4 py-3 text-center">
                    {editingType === eventType ? (
                      <input
                        type="number"
                        min={1}
                        max={36500}
                        value={editValue}
                        onChange={(e) => setEditValue(Number(e.target.value))}
                        className="w-24 px-2 py-1 text-sm bg-gray-800 border border-gray-600 rounded text-theme-primary text-center"
                      />
                    ) : (
                      <span className="text-sm text-theme-primary">{formatDays(getPolicyDays(eventType))}</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {editingType === eventType ? (
                      <div className="flex justify-end gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setEditingType(null)}
                        >
                          Cancel
                        </Button>
                        <Button
                          variant="primary"
                          size="sm"
                          onClick={handleSave}
                          disabled={isLoadingRetention}
                        >
                          Save
                        </Button>
                      </div>
                    ) : (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleEdit(eventType)}
                      >
                        Edit
                      </Button>
                    )}
                  </td>
                </tr>
              )
            )}
          </tbody>
        </table>
      </Card>

      {/* Manual Cleanup */}
      <Card className="glass-card p-4">
        <div className="flex items-center justify-between">
          <div>
            <h4 className="font-medium text-theme-primary">Manual Cleanup</h4>
            <p className="text-sm text-theme-tertiary mt-1">
              Trigger cleanup of expired logs immediately. Automatic cleanup runs daily.
            </p>
          </div>
          <Button
            variant="secondary"
            onClick={handleCleanup}
            disabled={isCleaningUp}
          >
            {isCleaningUp ? 'Cleaning...' : 'Run Cleanup'}
          </Button>
        </div>
        {cleanupResult && (
          <div className="mt-3 p-3 bg-green-900/30 border border-green-700/50 rounded-lg text-green-300 text-sm">
            Cleanup complete: {cleanupResult.logsDeleted} logs deleted, {cleanupResult.logsSkipped} skipped (under hold)
          </div>
        )}
      </Card>
    </div>
  );
}
