/**
 * @file ExportDialog.tsx
 * @description Dialog for exporting compliance logs to JSON
 * @feature compliance
 */

import { useState } from 'react';
import { Modal } from '@/shared/components/ui/Modal';
import { Button } from '@/shared/components/ui/Button';
import { useComplianceStore } from '../store';
import type { ComplianceEventType, ExportOptions } from '../types';

// Event type labels
const EVENT_TYPE_LABELS: Record<ComplianceEventType, string> = {
  ai_decision: 'AI Decisions',
  safety_action: 'Safety Actions',
  command_execution: 'Command Executions',
  system_event: 'System Events',
  access_audit: 'Access Audits',
};

export interface ExportDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

/**
 * Dialog for exporting compliance logs
 */
export function ExportDialog({ isOpen, onClose }: ExportDialogProps) {
  const { isExporting, exportLogs, error } = useComplianceStore();

  const [options, setOptions] = useState<ExportOptions>({
    startDate: '',
    endDate: '',
    eventTypes: [],
    robotIds: [],
    sessionIds: [],
    includeDecrypted: false,
  });

  const [exportSuccess, setExportSuccess] = useState<{ filename: string; count: number } | null>(null);

  const handleEventTypeToggle = (eventType: ComplianceEventType) => {
    setOptions((prev) => ({
      ...prev,
      eventTypes: prev.eventTypes?.includes(eventType)
        ? prev.eventTypes.filter((t) => t !== eventType)
        : [...(prev.eventTypes || []), eventType],
    }));
  };

  const handleExport = async () => {
    try {
      const result = await exportLogs(options);

      // Create and download the JSON file
      const blob = new Blob([JSON.stringify(result.data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = result.filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      setExportSuccess({ filename: result.filename, count: result.recordCount });

      // Clear success message after 5 seconds
      setTimeout(() => {
        setExportSuccess(null);
      }, 5000);
    } catch {
      // Error handled in store
    }
  };

  const handleClose = () => {
    setExportSuccess(null);
    setOptions({
      startDate: '',
      endDate: '',
      eventTypes: [],
      robotIds: [],
      sessionIds: [],
      includeDecrypted: false,
    });
    onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title="Export Compliance Logs"
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={handleClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={handleExport}
            disabled={isExporting}
          >
            {isExporting ? 'Exporting...' : 'Export to JSON'}
          </Button>
        </>
      }
    >
      <div className="space-y-6">
        {error && (
          <div className="p-3 bg-red-900/30 border border-red-700/50 rounded-lg text-red-300 text-sm">
            {error}
          </div>
        )}

        {exportSuccess && (
          <div className="p-3 bg-green-900/30 border border-green-700/50 rounded-lg text-green-300 text-sm">
            Successfully exported {exportSuccess.count} logs to {exportSuccess.filename}
          </div>
        )}

        {/* Date Range */}
        <div>
          <h4 className="font-medium text-theme-primary mb-3">Date Range</h4>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-theme-secondary mb-1">Start Date</label>
              <input
                type="date"
                value={options.startDate || ''}
                onChange={(e) => setOptions({ ...options, startDate: e.target.value })}
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-theme-primary focus:outline-none focus:border-primary-500"
              />
            </div>
            <div>
              <label className="block text-sm text-theme-secondary mb-1">End Date</label>
              <input
                type="date"
                value={options.endDate || ''}
                onChange={(e) => setOptions({ ...options, endDate: e.target.value })}
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-theme-primary focus:outline-none focus:border-primary-500"
              />
            </div>
          </div>
          <p className="text-xs text-theme-tertiary mt-1">Leave empty to export all dates</p>
        </div>

        {/* Event Types */}
        <div>
          <h4 className="font-medium text-theme-primary mb-3">Event Types</h4>
          <div className="flex flex-wrap gap-2">
            {(['ai_decision', 'safety_action', 'command_execution', 'system_event', 'access_audit'] as const).map(
              (eventType) => (
                <button
                  key={eventType}
                  type="button"
                  className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
                    options.eventTypes?.includes(eventType)
                      ? 'bg-primary-500 text-white'
                      : 'bg-gray-800 text-theme-secondary hover:bg-gray-700'
                  }`}
                  onClick={() => handleEventTypeToggle(eventType)}
                >
                  {EVENT_TYPE_LABELS[eventType]}
                </button>
              )
            )}
          </div>
          <p className="text-xs text-theme-tertiary mt-1">Select specific types or leave empty for all</p>
        </div>

        {/* Include Decrypted Payloads */}
        <div>
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={options.includeDecrypted}
              onChange={(e) => setOptions({ ...options, includeDecrypted: e.target.checked })}
              className="w-4 h-4 rounded border-gray-600 bg-gray-800 text-primary-500 focus:ring-primary-500"
            />
            <div>
              <span className="text-theme-primary">Include decrypted payloads</span>
              <p className="text-xs text-theme-tertiary mt-0.5">
                Decrypt and include full payload content. Use with caution for sensitive data.
              </p>
            </div>
          </label>
        </div>

        {/* Info box */}
        <div className="bg-blue-900/30 border border-blue-700/50 rounded-lg p-4">
          <h5 className="font-medium text-blue-300 mb-2">Export Information</h5>
          <ul className="text-blue-200/80 text-sm space-y-1">
            <li>Exports include log metadata, timestamps, and hash chain data</li>
            <li>Export activity is recorded in the compliance access log</li>
            <li>JSON format is suitable for regulatory submission</li>
          </ul>
        </div>
      </div>
    </Modal>
  );
}
