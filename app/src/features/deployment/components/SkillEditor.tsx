/**
 * @file SkillEditor.tsx
 * @description Form for creating and editing skill definitions
 * @feature deployment
 */

import { useState, useEffect } from 'react';
import { Modal, Button, Card, Input, Badge } from '@/shared/components/ui';
import type { SkillDefinition, CreateSkillInput, UpdateSkillInput, SkillParameter } from '../types';

export interface SkillEditorProps {
  skill?: SkillDefinition;
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (input: CreateSkillInput | UpdateSkillInput) => Promise<void>;
  isLoading?: boolean;
}

interface FormState {
  name: string;
  description: string;
  version: string;
  requiredCapabilities: string[];
  parameters: SkillParameter[];
  timeout: number;
  maxRetries: number;
}

const initialFormState: FormState = {
  name: '',
  description: '',
  version: '1.0.0',
  requiredCapabilities: [],
  parameters: [],
  timeout: 30,
  maxRetries: 3,
};

const commonCapabilities = [
  'manipulation',
  'navigation',
  'vision',
  'speech',
  'locomotion',
  'grasping',
  'object_detection',
  'path_planning',
];

export function SkillEditor({
  skill,
  isOpen,
  onClose,
  onSubmit,
  isLoading = false,
}: SkillEditorProps) {
  const [formState, setFormState] = useState<FormState>(initialFormState);
  const [capabilityInput, setCapabilityInput] = useState('');
  const [showParameterForm, setShowParameterForm] = useState(false);
  const [newParameter, setNewParameter] = useState<Partial<SkillParameter>>({
    name: '',
    type: 'string',
    required: false,
    description: '',
  });

  const isEditing = !!skill;

  useEffect(() => {
    if (skill) {
      setFormState({
        name: skill.name,
        description: skill.description || '',
        version: skill.version,
        requiredCapabilities: [...skill.requiredCapabilities],
        parameters: skill.parameters ? [...skill.parameters] : [],
        timeout: skill.timeout || 30,
        maxRetries: skill.maxRetries,
      });
    } else {
      setFormState(initialFormState);
    }
  }, [skill, isOpen]);

  const handleSubmit = async () => {
    if (!formState.name.trim()) return;

    const input = isEditing
      ? ({
          id: skill.id,
          name: formState.name,
          description: formState.description,
          version: formState.version,
          requiredCapabilities: formState.requiredCapabilities,
          parameters: formState.parameters,
          timeout: formState.timeout,
          maxRetries: formState.maxRetries,
        } as UpdateSkillInput)
      : ({
          name: formState.name,
          description: formState.description,
          version: formState.version,
          requiredCapabilities: formState.requiredCapabilities,
          parameters: formState.parameters,
          timeout: formState.timeout,
          maxRetries: formState.maxRetries,
        } as CreateSkillInput);

    await onSubmit(input);
    handleClose();
  };

  const handleClose = () => {
    setFormState(initialFormState);
    setCapabilityInput('');
    setShowParameterForm(false);
    onClose();
  };

  const addCapability = (cap: string) => {
    const trimmed = cap.trim().toLowerCase();
    if (trimmed && !formState.requiredCapabilities.includes(trimmed)) {
      setFormState((prev) => ({
        ...prev,
        requiredCapabilities: [...prev.requiredCapabilities, trimmed],
      }));
    }
    setCapabilityInput('');
  };

  const removeCapability = (cap: string) => {
    setFormState((prev) => ({
      ...prev,
      requiredCapabilities: prev.requiredCapabilities.filter((c) => c !== cap),
    }));
  };

  const addParameter = () => {
    if (!newParameter.name?.trim()) return;

    const param: SkillParameter = {
      name: newParameter.name.trim(),
      type: newParameter.type || 'string',
      required: newParameter.required || false,
      description: newParameter.description,
      default: newParameter.default,
    };

    setFormState((prev) => ({
      ...prev,
      parameters: [...prev.parameters, param],
    }));

    setNewParameter({
      name: '',
      type: 'string',
      required: false,
      description: '',
    });
    setShowParameterForm(false);
  };

  const removeParameter = (name: string) => {
    setFormState((prev) => ({
      ...prev,
      parameters: prev.parameters.filter((p) => p.name !== name),
    }));
  };

  const canSubmit = formState.name.trim().length > 0;

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title={isEditing ? 'Edit Skill' : 'Create Skill'}
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={handleClose} disabled={isLoading}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={handleSubmit}
            isLoading={isLoading}
            disabled={!canSubmit}
          >
            {isEditing ? 'Save Changes' : 'Create Skill'}
          </Button>
        </>
      }
    >
      <div className="space-y-6">
        {/* Basic info */}
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-theme-primary mb-1">
              Name <span className="text-red-500">*</span>
            </label>
            <Input
              value={formState.name}
              onChange={(e) => setFormState((prev) => ({ ...prev, name: e.target.value }))}
              placeholder="e.g., pick-and-place"
              disabled={isLoading}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-theme-primary mb-1">Description</label>
            <textarea
              value={formState.description}
              onChange={(e) => setFormState((prev) => ({ ...prev, description: e.target.value }))}
              placeholder="Describe what this skill does..."
              className="w-full px-3 py-2 rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-theme-primary placeholder-gray-400 focus:ring-2 focus:ring-cobalt-500 focus:border-transparent resize-none"
              rows={3}
              disabled={isLoading}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-theme-primary mb-1">Version</label>
              <Input
                value={formState.version}
                onChange={(e) => setFormState((prev) => ({ ...prev, version: e.target.value }))}
                placeholder="1.0.0"
                disabled={isLoading}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-theme-primary mb-1">
                Timeout (seconds)
              </label>
              <Input
                type="number"
                min={1}
                max={3600}
                value={formState.timeout}
                onChange={(e) =>
                  setFormState((prev) => ({ ...prev, timeout: parseInt(e.target.value) || 30 }))
                }
                disabled={isLoading}
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-theme-primary mb-1">Max Retries</label>
            <Input
              type="number"
              min={0}
              max={10}
              value={formState.maxRetries}
              onChange={(e) =>
                setFormState((prev) => ({ ...prev, maxRetries: parseInt(e.target.value) || 0 }))
              }
              disabled={isLoading}
            />
          </div>
        </div>

        {/* Required Capabilities */}
        <div className="space-y-3">
          <label className="block text-sm font-medium text-theme-primary">Required Capabilities</label>

          <div className="flex gap-2">
            <Input
              value={capabilityInput}
              onChange={(e) => setCapabilityInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addCapability(capabilityInput)}
              placeholder="Add capability..."
              className="flex-1"
              disabled={isLoading}
            />
            <Button
              variant="outline"
              onClick={() => addCapability(capabilityInput)}
              disabled={!capabilityInput.trim() || isLoading}
            >
              Add
            </Button>
          </div>

          {/* Quick add suggestions */}
          <div className="flex flex-wrap gap-1">
            {commonCapabilities
              .filter((cap) => !formState.requiredCapabilities.includes(cap))
              .slice(0, 5)
              .map((cap) => (
                <button
                  key={cap}
                  onClick={() => addCapability(cap)}
                  className="text-xs px-2 py-1 rounded bg-gray-100 dark:bg-gray-800 text-theme-secondary hover:bg-gray-200 dark:hover:bg-gray-700"
                  disabled={isLoading}
                >
                  + {cap}
                </button>
              ))}
          </div>

          {/* Selected capabilities */}
          {formState.requiredCapabilities.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {formState.requiredCapabilities.map((cap) => (
                <Badge
                  key={cap}
                  variant="info"
                  size="sm"
                  className="cursor-pointer"
                  onClick={() => !isLoading && removeCapability(cap)}
                >
                  {cap}
                  <svg className="w-3 h-3 ml-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M6 18L18 6M6 6l12 12"
                    />
                  </svg>
                </Badge>
              ))}
            </div>
          )}
        </div>

        {/* Parameters */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <label className="block text-sm font-medium text-theme-primary">Parameters</label>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowParameterForm(true)}
              disabled={isLoading}
            >
              <svg className="w-4 h-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Add Parameter
            </Button>
          </div>

          {/* Parameter form */}
          {showParameterForm && (
            <Card className="p-4 space-y-3 bg-gray-50 dark:bg-gray-800/50">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-theme-secondary mb-1">Name</label>
                  <Input
                    value={newParameter.name || ''}
                    onChange={(e) => setNewParameter((p: Partial<SkillParameter>) => ({ ...p, name: e.target.value }))}
                    placeholder="parameter_name"
                    disabled={isLoading}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-theme-secondary mb-1">Type</label>
                  <select
                    value={newParameter.type || 'string'}
                    onChange={(e) =>
                      setNewParameter((p: Partial<SkillParameter>) => ({
                        ...p,
                        type: e.target.value as SkillParameter['type'],
                      }))
                    }
                    className="w-full px-3 py-2 text-sm rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-theme-primary"
                    disabled={isLoading}
                  >
                    <option value="string">String</option>
                    <option value="number">Number</option>
                    <option value="boolean">Boolean</option>
                    <option value="array">Array</option>
                    <option value="object">Object</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-theme-secondary mb-1">
                  Description
                </label>
                <Input
                  value={newParameter.description || ''}
                  onChange={(e) => setNewParameter((p: Partial<SkillParameter>) => ({ ...p, description: e.target.value }))}
                  placeholder="What does this parameter do?"
                  disabled={isLoading}
                />
              </div>
              <div className="flex items-center justify-between">
                <label className="flex items-center gap-2 text-sm text-theme-primary">
                  <input
                    type="checkbox"
                    checked={newParameter.required || false}
                    onChange={(e) => setNewParameter((p: Partial<SkillParameter>) => ({ ...p, required: e.target.checked }))}
                    className="rounded border-gray-300 text-cobalt-600 focus:ring-cobalt-500"
                    disabled={isLoading}
                  />
                  Required
                </label>
                <div className="flex gap-2">
                  <Button variant="ghost" size="sm" onClick={() => setShowParameterForm(false)}>
                    Cancel
                  </Button>
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={addParameter}
                    disabled={!newParameter.name?.trim()}
                  >
                    Add
                  </Button>
                </div>
              </div>
            </Card>
          )}

          {/* Parameter list */}
          {formState.parameters.length > 0 && (
            <div className="space-y-2">
              {formState.parameters.map((param) => (
                <div
                  key={param.name}
                  className="flex items-center justify-between p-2 bg-gray-50 dark:bg-gray-800/50 rounded"
                >
                  <div className="flex items-center gap-2">
                    <code className="text-sm font-mono text-theme-primary">{param.name}</code>
                    <Badge variant="default" size="sm">
                      {param.type}
                    </Badge>
                    {param.required && (
                      <Badge variant="warning" size="sm">
                        required
                      </Badge>
                    )}
                  </div>
                  <button
                    onClick={() => removeParameter(param.name)}
                    className="text-theme-tertiary hover:text-red-500"
                    disabled={isLoading}
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                      />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          )}

          {formState.parameters.length === 0 && !showParameterForm && (
            <p className="text-sm text-theme-secondary text-center py-4">
              No parameters defined. Click "Add Parameter" to define skill inputs.
            </p>
          )}
        </div>
      </div>
    </Modal>
  );
}
