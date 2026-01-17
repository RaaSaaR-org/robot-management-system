/**
 * @file SkillsPage.tsx
 * @description Skills and skill chains management page
 * @feature deployment
 */

import { useState, useEffect } from 'react';
import { Card, Button, Badge } from '@/shared/components/ui';
import { useDeploymentStore } from '../store';
import { SkillBrowser, SkillEditor, SkillStatusBadge } from '../components';
import type { SkillDefinition, CreateSkillInput, UpdateSkillInput } from '../types';

type TabValue = 'skills' | 'chains';

export function SkillsPage() {
  const [activeTab, setActiveTab] = useState<TabValue>('skills');
  const [showSkillEditor, setShowSkillEditor] = useState(false);
  const [editingSkill, setEditingSkill] = useState<SkillDefinition | undefined>();
  const [selectedSkillId, setSelectedSkillId] = useState<string | undefined>();

  // Direct store access
  const skills = useDeploymentStore((s) => s.skills);
  const skillsLoading = useDeploymentStore((s) => s.skillsLoading);
  const skillsError = useDeploymentStore((s) => s.skillsError);
  const skillChains = useDeploymentStore((s) => s.skillChains);
  const chainsLoading = useDeploymentStore((s) => s.skillChainsLoading);
  const chainsError = useDeploymentStore((s) => s.skillChainsError);

  // Actions
  const fetchSkills = useDeploymentStore((s) => s.fetchSkills);
  const fetchSkillChains = useDeploymentStore((s) => s.fetchSkillChains);
  const createSkill = useDeploymentStore((s) => s.createSkill);
  const updateSkill = useDeploymentStore((s) => s.updateSkill);
  const publishSkill = useDeploymentStore((s) => s.publishSkill);
  const deprecateSkill = useDeploymentStore((s) => s.deprecateSkill);
  const archiveSkill = useDeploymentStore((s) => s.archiveSkill);
  const activateChain = useDeploymentStore((s) => s.activateChain);
  const archiveChain = useDeploymentStore((s) => s.archiveChain);
  const deleteChain = useDeploymentStore((s) => s.deleteSkillChain);

  // Fetch data on mount
  useEffect(() => {
    fetchSkills();
    fetchSkillChains();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleCreateSkill = () => {
    setEditingSkill(undefined);
    setShowSkillEditor(true);
  };

  const handleEditSkill = (skill: SkillDefinition) => {
    setEditingSkill(skill);
    setShowSkillEditor(true);
  };

  const handleSaveSkill = async (input: CreateSkillInput | UpdateSkillInput) => {
    if ('id' in input && typeof input.id === 'string' && input.id.length > 0) {
      await updateSkill(input.id, input);
    } else {
      await createSkill(input as CreateSkillInput);
    }
    setShowSkillEditor(false);
    setEditingSkill(undefined);
  };

  const selectedSkill = skills.find((s) => s.id === selectedSkillId);

  // Stats
  const skillStats = {
    total: skills.length,
    published: skills.filter((s) => s.status === 'published').length,
    draft: skills.filter((s) => s.status === 'draft').length,
    deprecated: skills.filter((s) => s.status === 'deprecated').length,
  };

  const chainStats = {
    total: skillChains.length,
    active: skillChains.filter((c: { status: string }) => c.status === 'active').length,
  };

  const isLoading = skillsLoading || chainsLoading;
  const error = skillsError || chainsError;

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-theme-primary">Skills</h1>
          <p className="text-sm text-theme-secondary mt-1">
            Define and manage robot skills and skill chains
          </p>
        </div>
        <Button variant="primary" onClick={handleCreateSkill}>
          <svg className="w-4 h-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          New Skill
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4">
        <Card className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-theme-secondary">Total Skills</p>
              <p className="text-2xl font-bold text-theme-primary">{skillStats.total}</p>
            </div>
            <div className="w-10 h-10 rounded-full bg-cobalt-100 dark:bg-cobalt-900/30 flex items-center justify-center">
              <svg className="w-5 h-5 text-cobalt-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z"
                />
              </svg>
            </div>
          </div>
        </Card>

        <Card className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-theme-secondary">Published</p>
              <p className="text-2xl font-bold text-theme-primary">{skillStats.published}</p>
            </div>
            <div className="w-10 h-10 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
              <svg className="w-5 h-5 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
          </div>
        </Card>

        <Card className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-theme-secondary">Draft</p>
              <p className="text-2xl font-bold text-theme-primary">{skillStats.draft}</p>
            </div>
            <div className="w-10 h-10 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center">
              <svg className="w-5 h-5 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
                />
              </svg>
            </div>
          </div>
        </Card>

        <Card className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-theme-secondary">Skill Chains</p>
              <p className="text-2xl font-bold text-theme-primary">{chainStats.total}</p>
            </div>
            <div className="w-10 h-10 rounded-full bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center">
              <svg className="w-5 h-5 text-purple-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"
                />
              </svg>
            </div>
          </div>
        </Card>
      </div>

      {/* Tab buttons */}
      <div className="flex gap-2 border-b border-theme pb-2">
        <button
          onClick={() => setActiveTab('skills')}
          className={`px-4 py-2 text-sm font-medium rounded-t transition-colors ${
            activeTab === 'skills'
              ? 'text-cobalt-500 border-b-2 border-cobalt-500'
              : 'text-theme-secondary hover:text-theme-primary'
          }`}
        >
          Skills ({skills.length})
        </button>
        <button
          onClick={() => setActiveTab('chains')}
          className={`px-4 py-2 text-sm font-medium rounded-t transition-colors ${
            activeTab === 'chains'
              ? 'text-cobalt-500 border-b-2 border-cobalt-500'
              : 'text-theme-secondary hover:text-theme-primary'
          }`}
        >
          Chains ({skillChains.length})
        </button>
      </div>

      {/* Error */}
      {error && (
        <Card className="p-4 bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800">
          <p className="text-red-600 dark:text-red-400">{error}</p>
        </Card>
      )}

      {/* Loading */}
      {isLoading && (
        <div className="flex justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-cobalt-500" />
        </div>
      )}

      {/* Skills tab */}
      {!isLoading && activeTab === 'skills' && (
        <div className="grid gap-6 lg:grid-cols-3">
          {/* Skills browser */}
          <div className="lg:col-span-2">
            <SkillBrowser
              skills={skills}
              selectedSkillId={selectedSkillId}
              onSelectSkill={(skill) => setSelectedSkillId(skill.id)}
              onCreateSkill={handleCreateSkill}
              onEditSkill={handleEditSkill}
            />
          </div>

          {/* Selected skill details */}
          <div>
            {selectedSkill ? (
              <Card className="p-6 space-y-4 sticky top-6">
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="font-semibold text-theme-primary">{selectedSkill.name}</h3>
                    <p className="text-sm text-theme-secondary">v{selectedSkill.version}</p>
                  </div>
                  <SkillStatusBadge status={selectedSkill.status} />
                </div>

                {selectedSkill.description && (
                  <p className="text-sm text-theme-secondary">{selectedSkill.description}</p>
                )}

                {/* Capabilities */}
                {selectedSkill.requiredCapabilities.length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-theme-secondary mb-2">
                      Required Capabilities
                    </p>
                    <div className="flex flex-wrap gap-1">
                      {selectedSkill.requiredCapabilities.map((cap) => (
                        <Badge key={cap} variant="default" size="sm">
                          {cap}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}

                {/* Parameters */}
                {selectedSkill.parameters && selectedSkill.parameters.length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-theme-secondary mb-2">Parameters</p>
                    <div className="space-y-1">
                      {selectedSkill.parameters.map((param: { name: string; type: string; required: boolean }) => (
                        <div
                          key={param.name}
                          className="flex items-center gap-2 text-sm"
                        >
                          <code className="text-theme-primary">{param.name}</code>
                          <Badge variant="default" size="sm">
                            {param.type}
                          </Badge>
                          {param.required && (
                            <span className="text-red-500 text-xs">required</span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Stats */}
                <div className="grid grid-cols-2 gap-4 text-sm pt-4 border-t border-theme">
                  <div>
                    <span className="text-theme-secondary">Timeout</span>
                    <p className="font-medium text-theme-primary">{selectedSkill.timeout}s</p>
                  </div>
                  <div>
                    <span className="text-theme-secondary">Max Retries</span>
                    <p className="font-medium text-theme-primary">{selectedSkill.maxRetries}</p>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex gap-2 pt-4 border-t border-theme">
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1"
                    onClick={() => handleEditSkill(selectedSkill)}
                  >
                    Edit
                  </Button>
                  {selectedSkill.status === 'draft' && (
                    <Button
                      variant="primary"
                      size="sm"
                      className="flex-1"
                      onClick={() => publishSkill(selectedSkill.id)}
                    >
                      Publish
                    </Button>
                  )}
                  {selectedSkill.status === 'published' && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => deprecateSkill(selectedSkill.id)}
                    >
                      Deprecate
                    </Button>
                  )}
                  {selectedSkill.status !== 'archived' && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => archiveSkill(selectedSkill.id)}
                    >
                      Archive
                    </Button>
                  )}
                </div>
              </Card>
            ) : (
              <Card className="p-6 text-center">
                <svg
                  className="w-12 h-12 mx-auto text-theme-tertiary mb-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.5}
                    d="M15 15l-2 5L9 9l11 4-5 2zm0 0l5 5M7.188 2.239l.777 2.897M5.136 7.965l-2.898-.777M13.95 4.05l-2.122 2.122m-5.657 5.656l-2.12 2.122"
                  />
                </svg>
                <p className="text-theme-secondary">Select a skill to view details</p>
              </Card>
            )}
          </div>
        </div>
      )}

      {/* Chains tab */}
      {!isLoading && activeTab === 'chains' && (
        <div className="space-y-4">
          {skillChains.length > 0 ? (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {skillChains.map((chain) => (
                <Card key={chain.id} className="p-4 space-y-3">
                  <div className="flex items-start justify-between">
                    <div>
                      <h4 className="font-semibold text-theme-primary">{chain.name}</h4>
                      <p className="text-xs text-theme-secondary">v{chain.version}</p>
                    </div>
                    <Badge
                      variant={chain.status === 'active' ? 'success' : 'default'}
                      size="sm"
                    >
                      {chain.status}
                    </Badge>
                  </div>

                  {chain.description && (
                    <p className="text-sm text-theme-secondary line-clamp-2">
                      {chain.description}
                    </p>
                  )}

                  <div className="flex items-center gap-2 text-xs text-theme-tertiary">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"
                      />
                    </svg>
                    <span>{chain.steps.length} steps</span>
                  </div>

                  <div className="flex gap-2 pt-2">
                    {chain.status === 'draft' && (
                      <Button
                        variant="primary"
                        size="sm"
                        className="flex-1"
                        onClick={() => activateChain(chain.id)}
                      >
                        Activate
                      </Button>
                    )}
                    {chain.status === 'active' && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="flex-1"
                        onClick={() => archiveChain(chain.id)}
                      >
                        Archive
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => deleteChain(chain.id)}
                    >
                      Delete
                    </Button>
                  </div>
                </Card>
              ))}
            </div>
          ) : (
            <Card className="text-center py-12">
              <svg
                className="w-12 h-12 mx-auto text-theme-tertiary mb-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"
                />
              </svg>
              <p className="text-theme-secondary mb-4">No skill chains defined yet</p>
              <Button variant="primary">Create Skill Chain</Button>
            </Card>
          )}
        </div>
      )}

      {/* Skill editor modal */}
      <SkillEditor
        skill={editingSkill}
        isOpen={showSkillEditor}
        onClose={() => {
          setShowSkillEditor(false);
          setEditingSkill(undefined);
        }}
        onSubmit={handleSaveSkill}
      />
    </div>
  );
}
