/**
 * @file SkillDetailsModal.tsx
 * @description Read-only details of one skill, with Edit and Run on robot in the footer
 * @feature deployment
 */

import { Pencil, Play } from 'lucide-react';
import { Badge, Button, KeyValueList, Modal, StatusTag } from '@/shared/components/ui';
import { formatDateTime } from '@/shared/utils';
import type { SkillDefinition } from '../types';
import { deployToneFor, schemaToParameters } from './deploymentHelpers';

export interface SkillDetailsModalProps {
  skill: SkillDefinition | null;
  onClose: () => void;
  onEdit: (skill: SkillDefinition) => void;
  onRun: (skill: SkillDefinition) => void;
}

export function SkillDetailsModal({ skill, onClose, onEdit, onRun }: SkillDetailsModalProps) {
  if (!skill) return null;
  const params = schemaToParameters(skill.parametersSchema, skill.parameters);

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={skill.name}
      description={skill.description}
      size="md"
      footer={
        <>
          <Button variant="secondary" leftIcon={<Pencil className="h-4 w-4" strokeWidth={1.75} />} onClick={() => onEdit(skill)}>
            Edit
          </Button>
          <Button leftIcon={<Play className="h-4 w-4" strokeWidth={1.75} />} onClick={() => onRun(skill)}>
            Run on robot
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        <div>
          <StatusTag status={skill.status} tone={deployToneFor(skill.status)} dot />
        </div>
        <KeyValueList
          items={[
            { label: 'Version', value: `v${skill.version}` },
            { label: 'Timeout', value: skill.timeout ? `${skill.timeout} s` : undefined },
            { label: 'Max retries', value: skill.maxRetries },
            { label: 'Updated', value: formatDateTime(skill.updatedAt) },
            {
              label: 'Capabilities',
              value: skill.requiredCapabilities.length ? (
                <span className="flex flex-wrap gap-1">
                  {skill.requiredCapabilities.map((c) => <Badge key={c} size="sm">{c}</Badge>)}
                </span>
              ) : undefined,
            },
            { label: 'Skill ID', value: skill.id, mono: true },
          ]}
        />
        <div className="flex flex-col gap-2">
          <p className="text-[13px] font-medium text-ink-secondary">Parameters</p>
          {params.length === 0 ? (
            <p className="text-sm text-ink-tertiary">This skill takes no parameters.</p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {params.map((p) => (
                <li key={p.name} className="flex flex-wrap items-center gap-2 text-sm">
                  <code className="font-mono text-[13px] text-ink-primary">{p.name}</code>
                  <Badge size="sm">{p.type}</Badge>
                  {p.required && <span className="text-[13px] text-ink-tertiary">required</span>}
                  {p.description && <span className="text-[13px] text-ink-tertiary">— {p.description}</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Modal>
  );
}
