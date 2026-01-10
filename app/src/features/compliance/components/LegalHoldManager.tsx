/**
 * @file LegalHoldManager.tsx
 * @description Legal hold management component
 * @feature compliance
 */

import { useEffect, useState } from 'react';
import { Card } from '@/shared/components/ui/Card';
import { Button } from '@/shared/components/ui/Button';
import { Modal } from '@/shared/components/ui/Modal';
import { Input } from '@/shared/components/ui/Input';
import { useComplianceStore } from '../store';
import type { LegalHold, LegalHoldInput } from '../types';

export interface LegalHoldManagerProps {
  className?: string;
}

function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/**
 * Component for managing legal holds
 */
export function LegalHoldManager({ className }: LegalHoldManagerProps) {
  const {
    legalHolds,
    isLoadingLegalHolds,
    error,
    fetchLegalHolds,
    createLegalHold,
    releaseLegalHold,
  } = useComplianceStore();

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [selectedHold, setSelectedHold] = useState<LegalHold | null>(null);
  const [formData, setFormData] = useState<LegalHoldInput>({
    name: '',
    reason: '',
    createdBy: '',
    logIds: [],
  });
  const [showActiveOnly, setShowActiveOnly] = useState(true);

  // Fetch on mount
  useEffect(() => {
    fetchLegalHolds(showActiveOnly);
  }, [fetchLegalHolds, showActiveOnly]);

  const handleCreate = async () => {
    try {
      await createLegalHold(formData);
      setShowCreateModal(false);
      setFormData({ name: '', reason: '', createdBy: '', logIds: [] });
    } catch {
      // Error handled in store
    }
  };

  const handleRelease = async (holdId: string) => {
    if (window.confirm('Are you sure you want to release this legal hold? Logs will become eligible for deletion.')) {
      try {
        await releaseLegalHold(holdId);
      } catch {
        // Error handled in store
      }
    }
  };

  const activeHolds = legalHolds.filter((h) => h.isActive);
  const inactiveHolds = legalHolds.filter((h) => !h.isActive);

  return (
    <div className={className}>
      <div className="mb-6">
        <h3 className="text-lg font-semibold text-theme-primary mb-2">Legal Holds</h3>
        <p className="text-theme-tertiary text-sm">
          Prevent deletion of compliance logs during investigations or legal proceedings.
          Logs under hold are preserved regardless of retention policy.
        </p>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-900/30 border border-red-700/50 rounded-lg text-red-300 text-sm">
          {error}
        </div>
      )}

      {/* Controls */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2 text-sm text-theme-secondary">
            <input
              type="checkbox"
              checked={showActiveOnly}
              onChange={(e) => setShowActiveOnly(e.target.checked)}
              className="rounded border-gray-600 bg-gray-800 text-primary-500"
            />
            Show active holds only
          </label>
        </div>
        <Button variant="primary" onClick={() => setShowCreateModal(true)}>
          Create Hold
        </Button>
      </div>

      {/* Active Holds */}
      {isLoadingLegalHolds ? (
        <div className="space-y-3">
          {[1, 2].map((i) => (
            <Card key={i} className="glass-card p-4 animate-pulse">
              <div className="h-5 bg-gray-700 rounded w-1/3 mb-2" />
              <div className="h-4 bg-gray-700 rounded w-2/3 mb-2" />
              <div className="h-3 bg-gray-700 rounded w-1/4" />
            </Card>
          ))}
        </div>
      ) : activeHolds.length === 0 && inactiveHolds.length === 0 ? (
        <Card className="glass-card p-6 text-center">
          <p className="text-theme-secondary">No legal holds</p>
          <p className="text-sm text-theme-tertiary mt-1">
            Create a legal hold to preserve logs during investigations
          </p>
        </Card>
      ) : (
        <div className="space-y-4">
          {/* Active holds */}
          {activeHolds.length > 0 && (
            <div>
              <h4 className="text-sm font-medium text-theme-secondary mb-2">Active Holds ({activeHolds.length})</h4>
              <div className="space-y-3">
                {activeHolds.map((hold) => (
                  <Card
                    key={hold.id}
                    className="glass-card p-4 border-l-4 border-l-amber-500 cursor-pointer hover:bg-gray-800/50"
                    onClick={() => setSelectedHold(hold)}
                  >
                    <div className="flex items-start justify-between">
                      <div>
                        <h5 className="font-medium text-theme-primary">{hold.name}</h5>
                        <p className="text-sm text-theme-tertiary mt-1">{hold.reason}</p>
                        <div className="flex items-center gap-4 mt-2 text-xs text-theme-tertiary">
                          <span>Created by: {hold.createdBy}</span>
                          <span>Started: {formatDate(hold.startDate)}</span>
                          <span className="text-amber-400">{hold.logIds.length} logs protected</span>
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleRelease(hold.id);
                        }}
                        className="text-red-400 hover:text-red-300"
                      >
                        Release
                      </Button>
                    </div>
                  </Card>
                ))}
              </div>
            </div>
          )}

          {/* Inactive holds */}
          {!showActiveOnly && inactiveHolds.length > 0 && (
            <div>
              <h4 className="text-sm font-medium text-theme-tertiary mb-2">Released Holds ({inactiveHolds.length})</h4>
              <div className="space-y-3">
                {inactiveHolds.map((hold) => (
                  <Card
                    key={hold.id}
                    className="glass-card p-4 opacity-60"
                  >
                    <div>
                      <h5 className="font-medium text-theme-secondary">{hold.name}</h5>
                      <p className="text-sm text-theme-tertiary mt-1">{hold.reason}</p>
                      <div className="flex items-center gap-4 mt-2 text-xs text-theme-tertiary">
                        <span>Created by: {hold.createdBy}</span>
                        <span>Released: {hold.endDate ? formatDate(hold.endDate) : 'N/A'}</span>
                        <span>{hold.logIds.length} logs were protected</span>
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Create Modal */}
      <Modal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        title="Create Legal Hold"
        size="md"
        footer={
          <>
            <Button variant="ghost" onClick={() => setShowCreateModal(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={handleCreate}
              disabled={!formData.name || !formData.reason || !formData.createdBy}
            >
              Create Hold
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Input
            label="Hold Name"
            placeholder="e.g., Incident Investigation #2024-001"
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
          />
          <div>
            <label className="block text-sm font-medium text-theme-secondary mb-1">Reason</label>
            <textarea
              placeholder="Describe the reason for this legal hold..."
              value={formData.reason}
              onChange={(e) => setFormData({ ...formData, reason: e.target.value })}
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-theme-primary placeholder:text-gray-500 focus:outline-none focus:border-primary-500 min-h-[80px]"
            />
          </div>
          <Input
            label="Created By"
            placeholder="Your name or ID"
            value={formData.createdBy}
            onChange={(e) => setFormData({ ...formData, createdBy: e.target.value })}
          />
          <p className="text-xs text-theme-tertiary">
            After creating the hold, you can add specific logs to it from the Audit Logs tab.
          </p>
        </div>
      </Modal>

      {/* Detail Modal */}
      <Modal
        isOpen={!!selectedHold}
        onClose={() => setSelectedHold(null)}
        title="Legal Hold Details"
        size="lg"
      >
        {selectedHold && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-xs text-theme-tertiary">Hold Name</label>
                <p className="text-theme-primary">{selectedHold.name}</p>
              </div>
              <div>
                <label className="text-xs text-theme-tertiary">Status</label>
                <p className={selectedHold.isActive ? 'text-amber-400' : 'text-gray-400'}>
                  {selectedHold.isActive ? 'Active' : 'Released'}
                </p>
              </div>
              <div>
                <label className="text-xs text-theme-tertiary">Created By</label>
                <p className="text-theme-primary">{selectedHold.createdBy}</p>
              </div>
              <div>
                <label className="text-xs text-theme-tertiary">Start Date</label>
                <p className="text-theme-primary">{formatDate(selectedHold.startDate)}</p>
              </div>
            </div>
            <div>
              <label className="text-xs text-theme-tertiary">Reason</label>
              <p className="text-theme-secondary mt-1">{selectedHold.reason}</p>
            </div>
            <div>
              <label className="text-xs text-theme-tertiary">Protected Log IDs ({selectedHold.logIds.length})</label>
              {selectedHold.logIds.length > 0 ? (
                <div className="mt-1 max-h-32 overflow-y-auto bg-gray-800/50 rounded p-2">
                  {selectedHold.logIds.map((id) => (
                    <code key={id} className="block text-xs text-theme-tertiary font-mono">
                      {id}
                    </code>
                  ))}
                </div>
              ) : (
                <p className="text-theme-tertiary text-sm mt-1">No specific logs added yet</p>
              )}
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
