/**
 * @file ModelsPage.tsx
 * @description Page for model registry and version management
 * @feature training
 */

import { useState, useCallback } from 'react';
import { Tabs, Spinner } from '@/shared/components/ui';
import { ModelRegistryList } from '../components/ModelRegistryList';
import { ModelVersionList } from '../components/ModelVersionList';
import { ModelComparisonDashboard } from '../components/ModelComparisonDashboard';
import { useModels } from '../hooks';
import type { RegisteredModel, ModelVersion } from '../types';

type TabValue = 'registry' | 'compare';

/**
 * Main page for model registry management
 */
export function ModelsPage() {
  const [activeTab, setActiveTab] = useState<TabValue>('registry');
  const [selectedModel, setSelectedModel] = useState<RegisteredModel | null>(null);
  const [selectedVersions, setSelectedVersions] = useState<ModelVersion[]>([]);
  const [versionSelection, setVersionSelection] = useState<string[]>([]);

  const {
    models,
    modelVersions,
    comparison,
    isLoading,
    error,
    fetchModels,
    fetchModelVersions,
    compareRuns,
    promoteVersion,
  } = useModels();

  const handleSelectModel = useCallback(
    async (model: RegisteredModel) => {
      setSelectedModel(model);
      setVersionSelection([]);
      await fetchModelVersions(model.name);
    },
    [fetchModelVersions]
  );

  const handleSelectVersion = useCallback((version: ModelVersion, selected: boolean) => {
    setVersionSelection((prev) => {
      if (selected) {
        return [...prev, version.version];
      }
      return prev.filter((v) => v !== version.version);
    });
  }, []);

  const handleCompare = useCallback(
    async (versions: ModelVersion[]) => {
      setSelectedVersions(versions);
      const runIds = versions.map((v) => v.run_id).filter(Boolean) as string[];
      if (runIds.length >= 2) {
        await compareRuns(runIds);
      }
      setActiveTab('compare');
    },
    [compareRuns]
  );

  const handlePromote = useCallback(
    async (version: ModelVersion, stage: string) => {
      if (selectedModel) {
        await promoteVersion(selectedModel.name, version.version, stage);
        await fetchModelVersions(selectedModel.name);
      }
    },
    [selectedModel, promoteVersion, fetchModelVersions]
  );

  const handleCloseComparison = useCallback(() => {
    setSelectedVersions([]);
    setActiveTab('registry');
  }, []);

  return (
    <div className="space-y-6">
      {/* Header */}
      <header>
        <h1 className="text-2xl font-bold text-theme-primary">Model Registry</h1>
        <p className="text-theme-secondary mt-1">
          Manage trained VLA model versions and deployments
        </p>
      </header>

      {/* Error state */}
      {error && (
        <div className="p-4 bg-red-100 text-red-700 rounded-lg">
          <p>{error}</p>
          <button
            onClick={() => fetchModels()}
            className="mt-2 text-sm font-medium hover:underline"
          >
            Retry
          </button>
        </div>
      )}

      {/* Tabs */}
      <Tabs
        activeTab={activeTab}
        onTabChange={(id) => setActiveTab(id as TabValue)}
        tabs={[
          {
            id: 'registry',
            label: 'Registry',
            content: (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Model list */}
                <div>
                  <h2 className="text-lg font-semibold text-theme-primary mb-4">Registered Models</h2>
                  <ModelRegistryList
                    models={models}
                    isLoading={isLoading}
                    selectedName={selectedModel?.name}
                    onSelect={handleSelectModel}
                  />
                </div>

                {/* Version list */}
                <div>
                  {selectedModel ? (
                    <>
                      <div className="flex items-center justify-between mb-4">
                        <h2 className="text-lg font-semibold text-theme-primary">
                          {selectedModel.name} Versions
                        </h2>
                        <button
                          onClick={() => setSelectedModel(null)}
                          className="text-sm text-primary-500 hover:text-primary-600"
                        >
                          Clear selection
                        </button>
                      </div>
                      <ModelVersionList
                        versions={modelVersions}
                        modelName={selectedModel.name}
                        isLoading={isLoading}
                        onPromote={handlePromote}
                        onCompare={handleCompare}
                        selectedVersions={versionSelection}
                        onSelectVersion={handleSelectVersion}
                      />
                    </>
                  ) : (
                    <div className="flex flex-col items-center justify-center py-12 bg-theme-secondary/10 rounded-lg">
                      <svg
                        className="w-12 h-12 text-theme-tertiary"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={1.5}
                          d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"
                        />
                      </svg>
                      <h3 className="mt-4 text-theme-primary font-medium">Select a Model</h3>
                      <p className="mt-2 text-sm text-theme-secondary text-center">
                        Select a model from the list to view and manage its versions.
                      </p>
                    </div>
                  )}
                </div>
              </div>
            ),
          },
          {
            id: 'compare',
            label: `Compare${selectedVersions.length > 0 ? ` (${selectedVersions.length})` : ''}`,
            disabled: selectedVersions.length < 2,
            content: (
              <div>
                {selectedVersions.length >= 2 ? (
                  <ModelComparisonDashboard
                    versions={selectedVersions}
                    comparison={comparison ?? undefined}
                    onClose={handleCloseComparison}
                  />
                ) : (
                  <div className="text-center py-12 bg-theme-secondary/10 rounded-lg">
                    <svg
                      className="w-12 h-12 mx-auto text-theme-tertiary"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={1.5}
                        d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
                      />
                    </svg>
                    <h3 className="mt-4 text-lg font-medium text-theme-primary">
                      Select Models to Compare
                    </h3>
                    <p className="mt-2 text-theme-secondary max-w-md mx-auto">
                      Select at least 2 model versions from the registry tab to compare their
                      metrics and hyperparameters side-by-side.
                    </p>
                  </div>
                )}
              </div>
            ),
          },
        ]}
      />

      {/* Loading overlay */}
      {isLoading && models.length === 0 && (
        <div className="flex items-center justify-center py-12">
          <Spinner size="lg" label="Loading model registry..." />
        </div>
      )}

      {/* Empty state */}
      {!isLoading && models.length === 0 && !error && (
        <div className="text-center py-12 bg-theme-secondary/10 rounded-lg">
          <svg
            className="w-16 h-16 mx-auto text-theme-tertiary"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"
            />
          </svg>
          <h3 className="mt-4 text-xl font-medium text-theme-primary">No Models Yet</h3>
          <p className="mt-2 text-theme-secondary max-w-md mx-auto">
            Models are automatically registered when training jobs complete successfully.
            Start a training job to create your first model.
          </p>
        </div>
      )}
    </div>
  );
}
