/**
 * @file RunSkillModal.tsx
 * @description FormModal that runs a skill on a robot. Calls POST /api/skills/:id/execute via
 * deploymentApi, navigates to the robot's live execution view first (TASK-146) and broadcasts
 * the result as a `skill:execution:result` window event. Export and props are stable —
 * features/robots imports it.
 * @feature deployment
 */

import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FormField, FormModal, Input, Select, Textarea, toast } from '@/shared/components/ui';
import { useRobots } from '@/features/robots/hooks/useRobots';
import { deploymentApi } from '../api/deploymentApi';
import type { RolloutStrategy, SkillDefinition } from '../types';
import { schemaToParameters } from './deploymentHelpers';
import { errorMessage } from '@/shared/components/ui';

/** Rollout strategy options (lerobot-rollout, TASK-179). */
const ROLLOUT_STRATEGIES: { value: RolloutStrategy; label: string }[] = [
  { value: 'default', label: 'Default — run the policy directly' },
  { value: 'sentry', label: 'Sentry — record the rollout' },
  { value: 'highlight', label: 'Highlight — capture a clip on failure' },
  { value: 'dagger', label: 'DAgger — tag human corrections' },
];

export interface RunSkillModalProps {
  isOpen: boolean;
  onClose: () => void;
  skill: SkillDefinition | null;
}

export function RunSkillModal({ isOpen, onClose, skill }: RunSkillModalProps) {
  const navigate = useNavigate();
  const { robots, fetchRobots } = useRobots();
  const [robotId, setRobotId] = useState('');
  const [strategy, setStrategy] = useState<RolloutStrategy>('default');
  const [values, setValues] = useState<Record<string, string>>({});
  const [json, setJson] = useState('{}');
  const [errors, setErrors] = useState<{ robot?: string; params?: string }>({});

  const params = useMemo(() => (skill ? schemaToParameters(skill.parametersSchema, skill.parameters) : []), [skill]);

  useEffect(() => {
    if (!isOpen) return;
    void fetchRobots();
    setRobotId('');
    setStrategy('default');
    setValues({});
    setJson('{}');
    setErrors({});
  }, [isOpen, fetchRobots]);

  // Every robot is listed; offline or incapable ones are disabled with the reason in the label.
  const robotOptions = useMemo(() => {
    const reqs = skill?.requiredCapabilities ?? [];
    return robots.map((r) => {
      const missing = reqs.filter((c) => !r.capabilities?.includes(c));
      const offline = r.status === 'offline' || r.status === 'error';
      const reason = offline ? ' (offline)' : missing.length ? ` (needs ${missing.join(', ')})` : '';
      return { value: r.id, label: `${r.name}${reason}`, disabled: Boolean(reason) };
    });
  }, [robots, skill]);

  const available = robotOptions.filter((o) => !o.disabled);

  useEffect(() => {
    if (isOpen && !robotId && available.length > 0) setRobotId(available[0].value);
  }, [isOpen, robotId, available]);

  if (!skill) return null;

  const collectParameters = (): Record<string, unknown> | string => {
    if (params.length === 0) {
      if (!json.trim()) return {};
      try {
        return JSON.parse(json) as Record<string, unknown>;
      } catch {
        return 'Parameters must be valid JSON.';
      }
    }
    const out: Record<string, unknown> = {};
    for (const p of params) {
      const raw = values[p.name]?.trim() ?? '';
      if (!raw) {
        if (p.required) return `${p.name} is required.`;
        continue;
      }
      if (p.type === 'number') out[p.name] = Number(raw);
      else if (p.type === 'boolean') out[p.name] = raw === 'true';
      else if (p.type === 'array' || p.type === 'object') {
        try { out[p.name] = JSON.parse(raw); } catch { return `${p.name} must be valid JSON.`; }
      } else out[p.name] = raw;
    }
    return out;
  };

  const handleSubmit = () => {
    const parameters = collectParameters();
    const next = { robot: robotId ? undefined : 'Choose an online robot.', params: typeof parameters === 'string' ? parameters : undefined };
    setErrors(next);
    if (next.robot || typeof parameters === 'string') return;

    const robotName = robots.find((r) => r.id === robotId)?.name ?? robotId;
    // TASK-146: go to the robot's live execution panel before dispatching — the call can take 30+ s.
    navigate(`/robots/${robotId}?executing=${encodeURIComponent(skill.id)}`);
    onClose();
    toast.success('Skill started', { description: `${skill.name} on ${robotName}` });

    void deploymentApi
      .executeSkill(skill.id, { robotId, parameters, rolloutStrategy: strategy })
      .then((result) => {
        window.dispatchEvent(new CustomEvent('skill:execution:result', { detail: { skillId: skill.id, robotId, result } }));
        if (result.status !== 'completed') {
          toast.error("Couldn't finish the skill", { description: result.error ?? `Execution ${result.status}` });
        }
      })
      .catch((err: unknown) => {
        const message = errorMessage(err);
        window.dispatchEvent(new CustomEvent('skill:execution:result', { detail: { skillId: skill.id, robotId, error: message } }));
        toast.error("Couldn't run the skill", { description: message });
      });
  };

  return (
    <FormModal
      isOpen={isOpen}
      onClose={onClose}
      title={`Run ${skill.name}`}
      description={`v${skill.version}${skill.requiredCapabilities.length ? ` · needs ${skill.requiredCapabilities.join(', ')}` : ''}`}
      submitLabel="Run skill"
      submitDisabled={available.length === 0}
      onSubmit={handleSubmit}
      noValidate
    >
      <FormField
        label="Robot"
        required
        error={errors.robot}
        hint={available.length === 0 ? 'No robot can run this now. Start the robot agent to run skills on it.' : undefined}
      >
        <Select placeholder="Choose a robot…" options={robotOptions} value={robotId} onChange={(e) => setRobotId(e.target.value)} />
      </FormField>
      <FormField label="Rollout strategy">
        <Select options={ROLLOUT_STRATEGIES} value={strategy} onChange={(e) => setStrategy(e.target.value as RolloutStrategy)} />
      </FormField>
      {params.length > 0 ? (
        params.map((p) => (
          <FormField key={p.name} label={p.name} required={p.required} hint={p.description}
            error={errors.params?.startsWith(p.name) ? errors.params : undefined}>
            {p.type === 'boolean' ? (
              <Select placeholder="—" options={[{ value: 'true', label: 'Yes' }, { value: 'false', label: 'No' }]}
                value={values[p.name] ?? ''} onChange={(e) => setValues((v) => ({ ...v, [p.name]: e.target.value }))} />
            ) : (
              <Input type={p.type === 'number' ? 'number' : 'text'} value={values[p.name] ?? ''}
                placeholder={p.type === 'array' ? '["a", "b"]' : p.type === 'object' ? '{"key": "value"}' : undefined}
                onChange={(e) => setValues((v) => ({ ...v, [p.name]: e.target.value }))} />
            )}
          </FormField>
        ))
      ) : (
        <FormField label="Parameters (JSON)" aside="Optional" error={errors.params}>
          <Textarea rows={3} className="font-mono text-[13px]" value={json} onChange={(e) => setJson(e.target.value)}
            placeholder='{"target": "apple"}' />
        </FormField>
      )}
    </FormModal>
  );
}
