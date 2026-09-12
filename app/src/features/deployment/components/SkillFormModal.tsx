/**
 * @file SkillFormModal.tsx
 * @description "New skill" / "Edit ‹name›" FormModal for skill definitions
 * @feature deployment
 */

import { useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import {
  Button,
  Checkbox,
  FormField,
  FormModal,
  Input,
  Select,
  Textarea,
  ToggleChip,
  toast,
} from '@/shared/components/ui';
import { useDeploymentStore } from '../store';
import type { SkillDefinition, SkillParameter } from '../types';
import { parametersToSchema, schemaToParameters } from './deploymentHelpers';
import { errorMessage } from '@/shared/components/ui';

export interface SkillFormModalProps {
  isOpen: boolean;
  /** null creates a new skill. */
  skill: SkillDefinition | null;
  onClose: () => void;
}

const CAPABILITIES = ['manipulation', 'navigation', 'locomotion', 'grasping', 'vision', 'object_detection', 'speech', 'path_planning'];
const PARAM_TYPES: { value: SkillParameter['type']; label: string }[] = [
  { value: 'string', label: 'Text' },
  { value: 'number', label: 'Number' },
  { value: 'boolean', label: 'Yes / no' },
  { value: 'array', label: 'List' },
  { value: 'object', label: 'Object' },
];

interface Errors { name?: string; version?: string; params?: string }

export function SkillFormModal({ isOpen, skill, onClose }: SkillFormModalProps) {
  const createSkill = useDeploymentStore((s) => s.createSkill);
  const updateSkill = useDeploymentStore((s) => s.updateSkill);
  const [name, setName] = useState('');
  const [version, setVersion] = useState('1.0.0');
  const [description, setDescription] = useState('');
  const [caps, setCaps] = useState<string[]>([]);
  const [timeout, setTimeoutS] = useState(30);
  const [maxRetries, setMaxRetries] = useState(3);
  const [params, setParams] = useState<SkillParameter[]>([]);
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string>();
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setName(skill?.name ?? '');
    setVersion(skill?.version ?? '1.0.0');
    setDescription(skill?.description ?? '');
    setCaps(skill ? [...skill.requiredCapabilities] : []);
    setTimeoutS(skill?.timeout ?? 30);
    setMaxRetries(skill?.maxRetries ?? 3);
    setParams(skill ? schemaToParameters(skill.parametersSchema, skill.parameters) : []);
    setErrors({});
    setFormError(undefined);
  }, [isOpen, skill]);

  const capOptions = Array.from(new Set([...CAPABILITIES, ...caps]));
  const toggleCap = (c: string) => setCaps((cur) => (cur.includes(c) ? cur.filter((x) => x !== c) : [...cur, c]));
  const updateParam = (i: number, patch: Partial<SkillParameter>) =>
    setParams((cur) => cur.map((p, j) => (j === i ? { ...p, ...patch } : p)));

  const handleSubmit = async () => {
    const names = params.map((p) => p.name.trim());
    const next: Errors = {
      name: name.trim() ? undefined : 'Give the skill a name.',
      version: /^\d+\.\d+\.\d+/.test(version.trim()) ? undefined : 'Use a version like 1.0.0.',
      params: names.some((n) => !n)
        ? 'Every parameter needs a name.'
        : new Set(names).size !== names.length
          ? 'Parameter names must be unique.'
          : undefined,
    };
    setErrors(next);
    if (next.name || next.version || next.params) return;

    const body = {
      name: name.trim(),
      version: version.trim(),
      description: description.trim() || undefined,
      requiredCapabilities: caps,
      timeout,
      maxRetries,
      parametersSchema: parametersToSchema(params.map((p) => ({ ...p, name: p.name.trim() }))),
    };
    setSaving(true);
    setFormError(undefined);
    try {
      if (skill) {
        await updateSkill(skill.id, body);
        toast.success('Skill updated', { description: body.name });
      } else {
        await createSkill(body);
        toast.success('Skill created', { description: body.name });
      }
      onClose();
    } catch (err) {
      setFormError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <FormModal
      isOpen={isOpen}
      onClose={onClose}
      title={skill ? `Edit ${skill.name}` : 'New skill'}
      description={skill ? undefined : 'A skill is a named behaviour a robot can execute, with typed parameters.'}
      submitLabel={skill ? 'Save changes' : 'Create skill'}
      submittingLabel={skill ? 'Saving…' : 'Creating…'}
      isSubmitting={saving}
      error={formError}
      onSubmit={handleSubmit}
      size="lg"
      noValidate
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-[1fr_10rem]">
        <FormField label="Name" required error={errors.name}>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Pick apple" />
        </FormField>
        <FormField label="Version" required error={errors.version}>
          <Input value={version} onChange={(e) => setVersion(e.target.value)} placeholder="1.0.0" />
        </FormField>
      </div>
      <FormField label="Description" aside="Optional">
        <Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)}
          placeholder="What the robot does when it runs this skill" />
      </FormField>
      <FormField label="Required capabilities" hint="Only robots with all of these can run the skill.">
        <div className="flex flex-wrap gap-2">
          {capOptions.map((c) => (
            <ToggleChip key={c} active={caps.includes(c)} onClick={() => toggleCap(c)}>{c.replace(/_/g, ' ')}</ToggleChip>
          ))}
        </div>
      </FormField>
      <div className="grid grid-cols-2 gap-4">
        <FormField label="Timeout (s)">
          <Input type="number" min={1} max={3600} value={timeout} onChange={(e) => setTimeoutS(Number(e.target.value) || 1)} />
        </FormField>
        <FormField label="Max retries">
          <Input type="number" min={0} max={10} value={maxRetries} onChange={(e) => setMaxRetries(Number(e.target.value) || 0)} />
        </FormField>
      </div>
      <FormField label="Parameters" aside="Optional" error={errors.params}>
        <div className="flex flex-col gap-2">
          {params.map((p, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2 rounded-control bg-inset px-3 py-2">
              <Input size="sm" aria-label={`Parameter ${i + 1} name`} placeholder="name" className="min-w-0 flex-1 basis-32"
                value={p.name} onChange={(e) => updateParam(i, { name: e.target.value })} />
              <Select size="sm" aria-label={`Parameter ${i + 1} type`} fullWidth={false} className="w-32"
                options={PARAM_TYPES} value={p.type}
                onChange={(e) => updateParam(i, { type: e.target.value as SkillParameter['type'] })} />
              <Checkbox label="Required" checked={p.required} onChange={(e) => updateParam(i, { required: e.target.checked })} />
              <Button variant="ghost" size="sm" iconOnly aria-label={`Remove parameter ${p.name || i + 1}`} className="ml-auto"
                onClick={() => setParams((cur) => cur.filter((_, j) => j !== i))}>
                <Trash2 className="h-4 w-4" strokeWidth={1.75} />
              </Button>
            </div>
          ))}
          <div>
            <Button variant="ghost" size="sm" leftIcon={<Plus className="h-4 w-4" strokeWidth={1.75} />}
              onClick={() => setParams((cur) => [...cur, { name: '', type: 'string', required: false }])}>
              Add parameter
            </Button>
          </div>
        </div>
      </FormField>
    </FormModal>
  );
}
