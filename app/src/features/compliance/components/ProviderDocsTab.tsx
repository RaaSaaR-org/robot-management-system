/**
 * @file ProviderDocsTab.tsx
 * @description Technical documentation management tab per regulatory requirements
 * @feature compliance
 *
 * Covers EU AI Act Annex IV, MR Annex IV, CRA Annex V, RED Annex V
 */

import { useEffect, useState } from 'react';
import { Card } from '@/shared/components/ui/Card';
import { Button } from '@/shared/components/ui/Button';
import { Modal } from '@/shared/components/ui/Modal';
import { Input } from '@/shared/components/ui/Input';
import { useComplianceStore } from '../store';
import type { ProviderDocumentation, ProviderDocInput, DocumentType } from '../types';
import { DocumentTypeLabels, DocumentTypeCategories } from '../types';
import { complianceApi } from '../api';

export interface ProviderDocsTabProps {
  className?: string;
}

type CategoryFilter = 'all' | 'general' | 'ai_act' | 'machinery' | 'cybersecurity' | 'conformity';

const CATEGORY_LABELS: Record<CategoryFilter, string> = {
  all: 'All',
  general: 'General',
  ai_act: 'AI Act',
  machinery: 'Machinery',
  cybersecurity: 'Cybersecurity',
  conformity: 'Conformity',
};

function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

const EMPTY_FORM: ProviderDocInput = {
  providerName: '',
  modelVersion: '',
  documentType: 'technical_doc',
  documentUrl: '',
  content: '',
  validFrom: new Date().toISOString().split('T')[0],
};

/**
 * Tab component for technical documentation management
 */
export function ProviderDocsTab({ className }: ProviderDocsTabProps) {
  const {
    providers,
    providerDocs,
    isLoadingProviders,
    error,
    fetchProviders,
    fetchAllDocumentation,
  } = useComplianceStore();

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showViewModal, setShowViewModal] = useState(false);
  const [selectedDoc, setSelectedDoc] = useState<ProviderDocumentation | null>(null);
  const [formData, setFormData] = useState<ProviderDocInput>(EMPTY_FORM);
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>('all');
  const [selectedProvider, setSelectedProvider] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Fetch on mount
  useEffect(() => {
    fetchProviders();
    fetchAllDocumentation();
  }, [fetchProviders, fetchAllDocumentation]);

  // Filter documents by category
  const filteredDocs = providerDocs.filter((doc) => {
    // Filter by provider
    if (selectedProvider && doc.providerName !== selectedProvider) {
      return false;
    }

    // Filter by category
    if (categoryFilter === 'all') return true;

    const categoryTypes = DocumentTypeCategories[categoryFilter] || [];
    return (categoryTypes as readonly string[]).includes(doc.documentType);
  });

  const handleOpenCreate = () => {
    setFormData(EMPTY_FORM);
    setShowCreateModal(true);
  };

  const handleOpenView = (doc: ProviderDocumentation) => {
    setSelectedDoc(doc);
    setShowViewModal(true);
  };

  const handleSubmit = async () => {
    setIsSubmitting(true);
    try {
      await complianceApi.addDocumentation(formData);
      setShowCreateModal(false);
      fetchAllDocumentation();
      fetchProviders();
    } catch (err) {
      console.error('Failed to add documentation:', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this document?')) return;

    try {
      await complianceApi.deleteDocumentation(id);
      fetchAllDocumentation();
      fetchProviders();
    } catch (err) {
      console.error('Failed to delete documentation:', err);
    }
  };

  const handleInputChange = (field: keyof ProviderDocInput, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  return (
    <div className={className}>
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
              Technical Documentation
            </h3>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Manage technical documentation per EU AI Act Annex IV, Machinery Regulation Annex IV,
              and Cyber Resilience Act Annex V.
            </p>
          </div>
          <Button onClick={handleOpenCreate}>Add Document</Button>
        </div>

        {/* Provider summary */}
        <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400 mb-4">
          <span>{providers.length} providers</span>
          <span>•</span>
          <span>{providerDocs.length} documents</span>
        </div>

        {/* Provider filter */}
        <div className="flex flex-wrap gap-2 mb-4">
          <Button
            variant={selectedProvider === null ? 'primary' : 'ghost'}
            size="sm"
            onClick={() => setSelectedProvider(null)}
          >
            All Providers
          </Button>
          {providers.map((provider) => (
            <Button
              key={provider.providerName}
              variant={selectedProvider === provider.providerName ? 'primary' : 'ghost'}
              size="sm"
              onClick={() => setSelectedProvider(provider.providerName)}
            >
              {provider.providerName} ({provider.documentCount})
            </Button>
          ))}
        </div>

        {/* Category filter */}
        <div className="flex flex-wrap gap-2">
          {(Object.keys(CATEGORY_LABELS) as CategoryFilter[]).map((category) => (
            <Button
              key={category}
              variant={categoryFilter === category ? 'primary' : 'ghost'}
              size="sm"
              onClick={() => setCategoryFilter(category)}
            >
              {CATEGORY_LABELS[category]}
            </Button>
          ))}
        </div>
      </div>

      {/* Error state */}
      {error && (
        <div className="mb-4 p-4 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 rounded-lg">
          {error}
        </div>
      )}

      {/* Loading state */}
      {isLoadingProviders && (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-cobalt"></div>
        </div>
      )}

      {/* Documents list */}
      {!isLoadingProviders && filteredDocs.length === 0 && (
        <Card className="p-8 text-center">
          <p className="text-gray-500 dark:text-gray-400">
            {providerDocs.length === 0
              ? 'No documentation found. Add your first document.'
              : 'No documents match the selected filters.'}
          </p>
        </Card>
      )}

      {!isLoadingProviders && filteredDocs.length > 0 && (
        <div className="space-y-3">
          {filteredDocs.map((doc) => (
            <Card key={doc.id} className="p-4">
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0 cursor-pointer" onClick={() => handleOpenView(doc)}>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="px-2 py-0.5 text-xs font-medium rounded bg-cobalt/10 text-cobalt dark:bg-cobalt/20">
                      {DocumentTypeLabels[doc.documentType as DocumentType] || doc.documentType}
                    </span>
                    <span className="text-xs text-gray-500 dark:text-gray-400">
                      {doc.providerName} v{doc.modelVersion}
                    </span>
                  </div>
                  <p className="text-sm text-gray-700 dark:text-gray-300 line-clamp-2">
                    {doc.content.substring(0, 200)}
                    {doc.content.length > 200 ? '...' : ''}
                  </p>
                  <div className="mt-2 flex items-center gap-4 text-xs text-gray-500 dark:text-gray-400">
                    <span>Valid from: {formatDate(doc.validFrom)}</span>
                    {doc.validTo && <span>Valid to: {formatDate(doc.validTo)}</span>}
                    <span>Updated: {formatDate(doc.updatedAt)}</span>
                  </div>
                </div>
                <div className="flex items-center gap-2 ml-4">
                  {doc.documentUrl && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => window.open(doc.documentUrl!, '_blank')}
                    >
                      Open URL
                    </Button>
                  )}
                  <Button variant="ghost" size="sm" onClick={() => handleDelete(doc.id)}>
                    Delete
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* View Document Modal */}
      <Modal
        isOpen={showViewModal}
        onClose={() => setShowViewModal(false)}
        title={selectedDoc ? DocumentTypeLabels[selectedDoc.documentType as DocumentType] || selectedDoc.documentType : 'Document'}
        size="xl"
      >
        {selectedDoc && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="font-medium text-gray-700 dark:text-gray-300">Provider:</span>
                <p className="text-gray-600 dark:text-gray-400">{selectedDoc.providerName}</p>
              </div>
              <div>
                <span className="font-medium text-gray-700 dark:text-gray-300">Version:</span>
                <p className="text-gray-600 dark:text-gray-400">{selectedDoc.modelVersion}</p>
              </div>
              <div>
                <span className="font-medium text-gray-700 dark:text-gray-300">Valid From:</span>
                <p className="text-gray-600 dark:text-gray-400">{formatDate(selectedDoc.validFrom)}</p>
              </div>
              <div>
                <span className="font-medium text-gray-700 dark:text-gray-300">Valid To:</span>
                <p className="text-gray-600 dark:text-gray-400">
                  {selectedDoc.validTo ? formatDate(selectedDoc.validTo) : 'No expiry'}
                </p>
              </div>
            </div>

            {selectedDoc.documentUrl && (
              <div>
                <span className="font-medium text-gray-700 dark:text-gray-300">URL:</span>
                <a
                  href={selectedDoc.documentUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-cobalt hover:underline block"
                >
                  {selectedDoc.documentUrl}
                </a>
              </div>
            )}

            <div>
              <span className="font-medium text-gray-700 dark:text-gray-300">Content:</span>
              <div className="mt-2 p-4 bg-gray-50 dark:bg-gray-800 rounded-lg whitespace-pre-wrap text-sm font-mono overflow-auto max-h-96">
                {selectedDoc.content}
              </div>
            </div>
          </div>
        )}
        <div className="flex justify-end gap-3 mt-6">
          <Button variant="ghost" onClick={() => setShowViewModal(false)}>
            Close
          </Button>
        </div>
      </Modal>

      {/* Create Document Modal */}
      <Modal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        title="Add Technical Document"
        size="lg"
      >
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Input
              label="Provider Name"
              value={formData.providerName}
              onChange={(e) => handleInputChange('providerName', e.target.value)}
              placeholder="e.g., RoboMindOS"
              required
            />
            <Input
              label="Version"
              value={formData.modelVersion}
              onChange={(e) => handleInputChange('modelVersion', e.target.value)}
              placeholder="e.g., 1.0.0"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Document Type
            </label>
            <select
              value={formData.documentType}
              onChange={(e) => handleInputChange('documentType', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-cobalt"
            >
              {Object.entries(DocumentTypeLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>

          <Input
            label="Document URL (optional)"
            value={formData.documentUrl || ''}
            onChange={(e) => handleInputChange('documentUrl', e.target.value)}
            placeholder="https://..."
          />

          <div className="grid grid-cols-2 gap-4">
            <Input
              label="Valid From"
              type="date"
              value={formData.validFrom}
              onChange={(e) => handleInputChange('validFrom', e.target.value)}
              required
            />
            <Input
              label="Valid To (optional)"
              type="date"
              value={formData.validTo || ''}
              onChange={(e) => handleInputChange('validTo', e.target.value)}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Content
            </label>
            <textarea
              value={formData.content}
              onChange={(e) => handleInputChange('content', e.target.value)}
              placeholder="Enter document content..."
              rows={8}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-cobalt font-mono text-sm"
              required
            />
          </div>
        </div>

        <div className="flex justify-end gap-3 mt-6">
          <Button variant="ghost" onClick={() => setShowCreateModal(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={isSubmitting || !formData.providerName || !formData.modelVersion || !formData.content}
          >
            {isSubmitting ? 'Adding...' : 'Add Document'}
          </Button>
        </div>
      </Modal>
    </div>
  );
}
