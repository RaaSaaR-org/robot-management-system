/**
 * @file RopaTab.tsx
 * @description Records of Processing Activities (RoPA) management tab
 * @feature compliance
 *
 * GDPR Article 30 requires maintaining records of data processing activities.
 */

import { useEffect, useState } from 'react';
import { Card } from '@/shared/components/ui/Card';
import { Button } from '@/shared/components/ui/Button';
import { Modal } from '@/shared/components/ui/Modal';
import { Input } from '@/shared/components/ui/Input';
import { useComplianceStore } from '../store';
import type { RopaEntry, RopaEntryInput, LegalBasis } from '../types';

// Legal basis options per GDPR Article 6
const LEGAL_BASIS_OPTIONS: { value: LegalBasis; label: string }[] = [
  { value: 'consent', label: 'Consent (Art. 6(1)(a))' },
  { value: 'contract', label: 'Contract Performance (Art. 6(1)(b))' },
  { value: 'legal_obligation', label: 'Legal Obligation (Art. 6(1)(c))' },
  { value: 'vital_interests', label: 'Vital Interests (Art. 6(1)(d))' },
  { value: 'public_task', label: 'Public Task (Art. 6(1)(e))' },
  { value: 'legitimate_interests', label: 'Legitimate Interests (Art. 6(1)(f))' },
];

export interface RopaTabProps {
  className?: string;
}

function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

const EMPTY_FORM: RopaEntryInput = {
  processingActivity: '',
  purpose: '',
  dataCategories: [],
  dataSubjects: [],
  recipients: [],
  thirdCountryTransfers: '',
  retentionPeriod: '',
  securityMeasures: [],
  legalBasis: 'legitimate_interests',
};

/**
 * Tab component for RoPA management (GDPR Article 30)
 */
export function RopaTab({ className }: RopaTabProps) {
  const {
    ropaEntries,
    ropaReport,
    isLoadingRopa,
    error,
    fetchRopaEntries,
    createRopaEntry,
    updateRopaEntry,
    deleteRopaEntry,
    generateRopaReport,
  } = useComplianceStore();

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingEntry, setEditingEntry] = useState<RopaEntry | null>(null);
  const [showReportModal, setShowReportModal] = useState(false);
  const [formData, setFormData] = useState<RopaEntryInput>(EMPTY_FORM);
  const [orgName, setOrgName] = useState('');

  // Array field helpers for comma-separated input
  const [categoryInput, setCategoryInput] = useState('');
  const [subjectInput, setSubjectInput] = useState('');
  const [recipientInput, setRecipientInput] = useState('');
  const [securityInput, setSecurityInput] = useState('');

  // Fetch on mount
  useEffect(() => {
    fetchRopaEntries();
  }, [fetchRopaEntries]);

  const handleOpenCreate = () => {
    setFormData(EMPTY_FORM);
    setCategoryInput('');
    setSubjectInput('');
    setRecipientInput('');
    setSecurityInput('');
    setShowCreateModal(true);
  };

  const handleOpenEdit = (entry: RopaEntry) => {
    setEditingEntry(entry);
    setFormData({
      processingActivity: entry.processingActivity,
      purpose: entry.purpose,
      dataCategories: entry.dataCategories,
      dataSubjects: entry.dataSubjects,
      recipients: entry.recipients,
      thirdCountryTransfers: entry.thirdCountryTransfers || '',
      retentionPeriod: entry.retentionPeriod,
      securityMeasures: entry.securityMeasures,
      legalBasis: entry.legalBasis,
    });
    setCategoryInput(entry.dataCategories.join(', '));
    setSubjectInput(entry.dataSubjects.join(', '));
    setRecipientInput(entry.recipients.join(', '));
    setSecurityInput(entry.securityMeasures.join(', '));
    setShowCreateModal(true);
  };

  const handleCloseModal = () => {
    setShowCreateModal(false);
    setEditingEntry(null);
    setFormData(EMPTY_FORM);
  };

  const parseCommaSeparated = (value: string): string[] => {
    return value.split(',').map((s) => s.trim()).filter(Boolean);
  };

  const handleSave = async () => {
    const data: RopaEntryInput = {
      ...formData,
      dataCategories: parseCommaSeparated(categoryInput),
      dataSubjects: parseCommaSeparated(subjectInput),
      recipients: parseCommaSeparated(recipientInput),
      securityMeasures: parseCommaSeparated(securityInput),
    };

    try {
      if (editingEntry) {
        await updateRopaEntry(editingEntry.id, data);
      } else {
        await createRopaEntry(data);
      }
      handleCloseModal();
    } catch {
      // Error handled in store
    }
  };

  const handleDelete = async (id: string) => {
    if (window.confirm('Are you sure you want to delete this RoPA entry?')) {
      try {
        await deleteRopaEntry(id);
      } catch {
        // Error handled in store
      }
    }
  };

  const handleGenerateReport = async () => {
    await generateRopaReport(orgName || undefined);
    setShowReportModal(true);
  };

  return (
    <div className={className}>
      {/* Header */}
      <div className="mb-6">
        <h3 className="text-lg font-semibold text-theme-primary mb-2">
          Records of Processing Activities (RoPA)
        </h3>
        <p className="text-theme-tertiary text-sm">
          GDPR Article 30 requires maintaining records of all data processing activities.
          Document what data you process, why, and how it's protected.
        </p>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-900/30 border border-red-700/50 rounded-lg text-red-300 text-sm">
          {error}
        </div>
      )}

      {/* Controls */}
      <div className="flex items-center justify-between mb-4">
        <div className="text-sm text-theme-tertiary">
          {ropaEntries.length} processing {ropaEntries.length === 1 ? 'activity' : 'activities'} documented
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={handleGenerateReport}>
            Generate Report
          </Button>
          <Button variant="primary" onClick={handleOpenCreate}>
            Add Activity
          </Button>
        </div>
      </div>

      {/* Entries Table */}
      {isLoadingRopa ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <Card key={i} className="glass-card p-4 animate-pulse">
              <div className="h-5 bg-gray-700 rounded w-1/3 mb-2" />
              <div className="h-4 bg-gray-700 rounded w-2/3 mb-2" />
              <div className="h-3 bg-gray-700 rounded w-1/4" />
            </Card>
          ))}
        </div>
      ) : ropaEntries.length === 0 ? (
        <Card className="glass-card p-6 text-center">
          <p className="text-theme-secondary">No processing activities documented</p>
          <p className="text-sm text-theme-tertiary mt-1">
            Add your first data processing activity record
          </p>
        </Card>
      ) : (
        <div className="space-y-3">
          {ropaEntries.map((entry) => (
            <Card key={entry.id} className="glass-card p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <h4 className="font-medium text-theme-primary truncate">
                    {entry.processingActivity}
                  </h4>
                  <p className="text-sm text-theme-tertiary mt-1 line-clamp-2">
                    {entry.purpose}
                  </p>
                  <div className="flex items-center gap-4 mt-2 text-xs">
                    <span className="text-blue-400">
                      {LEGAL_BASIS_OPTIONS.find((o) => o.value === entry.legalBasis)?.label || entry.legalBasis}
                    </span>
                    <span className="text-theme-tertiary">
                      Retention: {entry.retentionPeriod}
                    </span>
                    <span className="text-theme-tertiary">
                      Updated: {formatDate(entry.updatedAt)}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-1 mt-2">
                    {entry.dataCategories.slice(0, 3).map((cat) => (
                      <span
                        key={cat}
                        className="text-xs px-2 py-0.5 bg-gray-700 rounded-full text-theme-secondary"
                      >
                        {cat}
                      </span>
                    ))}
                    {entry.dataCategories.length > 3 && (
                      <span className="text-xs text-theme-tertiary">
                        +{entry.dataCategories.length - 3} more
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button variant="ghost" size="sm" onClick={() => handleOpenEdit(entry)}>
                    Edit
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleDelete(entry.id)}
                    className="text-red-400 hover:text-red-300"
                  >
                    Delete
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Create/Edit Modal */}
      <Modal
        isOpen={showCreateModal}
        onClose={handleCloseModal}
        title={editingEntry ? 'Edit Processing Activity' : 'Add Processing Activity'}
        size="xl"
        footer={
          <>
            <Button variant="ghost" onClick={handleCloseModal}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={handleSave}
              disabled={!formData.processingActivity || !formData.purpose || !formData.retentionPeriod}
            >
              {editingEntry ? 'Save Changes' : 'Add Activity'}
            </Button>
          </>
        }
      >
        <div className="space-y-4 max-h-[60vh] overflow-y-auto">
          <Input
            label="Processing Activity *"
            placeholder="e.g., Robot telemetry collection"
            value={formData.processingActivity}
            onChange={(e) => setFormData({ ...formData, processingActivity: e.target.value })}
          />

          <div>
            <label className="block text-sm font-medium text-theme-secondary mb-1">Purpose *</label>
            <textarea
              placeholder="Describe the purpose of this data processing..."
              value={formData.purpose}
              onChange={(e) => setFormData({ ...formData, purpose: e.target.value })}
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-theme-primary placeholder:text-gray-500 focus:outline-none focus:border-primary-500 min-h-[80px]"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-theme-secondary mb-1">Legal Basis *</label>
            <select
              value={formData.legalBasis}
              onChange={(e) => setFormData({ ...formData, legalBasis: e.target.value })}
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-theme-primary focus:outline-none focus:border-primary-500"
            >
              {LEGAL_BASIS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <Input
            label="Data Categories (comma-separated)"
            placeholder="e.g., Location data, Sensor readings, Operational logs"
            value={categoryInput}
            onChange={(e) => setCategoryInput(e.target.value)}
          />

          <Input
            label="Data Subjects (comma-separated)"
            placeholder="e.g., Robot operators, Facility staff"
            value={subjectInput}
            onChange={(e) => setSubjectInput(e.target.value)}
          />

          <Input
            label="Recipients (comma-separated)"
            placeholder="e.g., Internal analytics team, Cloud storage provider"
            value={recipientInput}
            onChange={(e) => setRecipientInput(e.target.value)}
          />

          <Input
            label="Third Country Transfers"
            placeholder="e.g., US (AWS), None"
            value={formData.thirdCountryTransfers || ''}
            onChange={(e) => setFormData({ ...formData, thirdCountryTransfers: e.target.value })}
          />

          <Input
            label="Retention Period *"
            placeholder="e.g., 10 years (EU AI Act requirement)"
            value={formData.retentionPeriod}
            onChange={(e) => setFormData({ ...formData, retentionPeriod: e.target.value })}
          />

          <Input
            label="Security Measures (comma-separated)"
            placeholder="e.g., AES-256 encryption, Access controls, Hash chain integrity"
            value={securityInput}
            onChange={(e) => setSecurityInput(e.target.value)}
          />
        </div>
      </Modal>

      {/* Report Modal */}
      <Modal
        isOpen={showReportModal}
        onClose={() => setShowReportModal(false)}
        title="RoPA Report"
        size="xl"
        footer={
          <>
            <Button variant="ghost" onClick={() => setShowReportModal(false)}>
              Close
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                if (ropaReport) {
                  const blob = new Blob([JSON.stringify(ropaReport, null, 2)], { type: 'application/json' });
                  const url = URL.createObjectURL(blob);
                  const link = document.createElement('a');
                  link.href = url;
                  link.download = `ropa-report-${new Date().toISOString().split('T')[0]}.json`;
                  document.body.appendChild(link);
                  link.click();
                  document.body.removeChild(link);
                  URL.revokeObjectURL(url);
                }
              }}
            >
              Download JSON
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="mb-4">
            <Input
              label="Organization Name"
              placeholder="Enter organization name for the report"
              value={orgName}
              onChange={(e) => setOrgName(e.target.value)}
            />
          </div>

          {ropaReport && (
            <div className="bg-gray-800/50 rounded-lg p-4 max-h-[50vh] overflow-y-auto">
              <div className="text-sm space-y-2">
                <p className="text-theme-secondary">
                  <strong>Organization:</strong> {ropaReport.organizationName}
                </p>
                <p className="text-theme-secondary">
                  <strong>Generated:</strong> {formatDate(ropaReport.generatedAt)}
                </p>
                <p className="text-theme-secondary">
                  <strong>Total Activities:</strong> {ropaReport.totalProcessingActivities}
                </p>
                <hr className="border-gray-700 my-4" />
                {ropaReport.entries.map((entry, idx) => (
                  <div key={entry.id} className="p-3 bg-gray-900/50 rounded mb-2">
                    <h5 className="font-medium text-theme-primary">
                      {idx + 1}. {entry.processingActivity}
                    </h5>
                    <p className="text-xs text-theme-tertiary mt-1">{entry.purpose}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
}
