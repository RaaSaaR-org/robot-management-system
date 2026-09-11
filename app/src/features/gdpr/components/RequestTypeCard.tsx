/**
 * @file RequestTypeCard.tsx
 * @description Selectable tiles for the 7 GDPR rights (replaces the old rights explainer panel)
 * @feature gdpr
 */

import { Ban, Download, Eye, Hand, Pencil, Scale, Trash2 } from 'lucide-react';
import { Panel } from '@/shared/components/ui';
import { cn } from '@/shared/utils/cn';
import { GDPRRequestTypes, type GDPRRequestType } from '../types';

/** Sentence-case label and one-line explanation per right. */
export const RIGHTS: Record<GDPRRequestType, { label: string; hint: string; icon: typeof Eye }> = {
  access: { label: 'Access', hint: 'Get a copy of your personal data (Art. 15)', icon: Eye },
  rectification: { label: 'Rectification', hint: 'Correct data that is wrong (Art. 16)', icon: Pencil },
  erasure: { label: 'Erasure', hint: 'Have your data deleted (Art. 17)', icon: Trash2 },
  restriction: { label: 'Restriction', hint: 'Limit how your data is processed (Art. 18)', icon: Ban },
  portability: { label: 'Portability', hint: 'Export your data in a portable format (Art. 20)', icon: Download },
  objection: { label: 'Objection', hint: 'Object to a processing activity (Art. 21)', icon: Hand },
  adm_review: { label: 'Automated decision review', hint: 'Contest a decision made by AI (Art. 22)', icon: Scale },
};

export interface RequestTypeCardProps {
  type: GDPRRequestType;
  selected: boolean;
  onSelect: (type: GDPRRequestType) => void;
}

export function RequestTypeCard({ type, selected, onSelect }: RequestTypeCardProps) {
  const { label, hint, icon: Icon } = RIGHTS[type];
  return (
    <Panel
      interactive
      padding="sm"
      role="button"
      aria-pressed={selected}
      onClick={() => onSelect(type)}
      className={cn('flex items-start gap-3', selected && 'border-primary bg-primary/10')}
    >
      <Icon className={cn('mt-0.5 h-4 w-4 shrink-0', selected ? 'text-primary' : 'text-ink-tertiary')} strokeWidth={1.75} />
      <div className="min-w-0">
        <div className="text-sm font-medium text-ink-primary">{label}</div>
        <div className="text-[13px] text-ink-secondary">{hint}</div>
      </div>
    </Panel>
  );
}

export interface RequestTypePickerProps {
  value: GDPRRequestType | null;
  onChange: (type: GDPRRequestType) => void;
}

export function RequestTypePicker({ value, onChange }: RequestTypePickerProps) {
  return (
    <div role="group" aria-label="Right to exercise" className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      {GDPRRequestTypes.map((t) => (
        <RequestTypeCard key={t} type={t} selected={value === t} onSelect={onChange} />
      ))}
    </div>
  );
}
