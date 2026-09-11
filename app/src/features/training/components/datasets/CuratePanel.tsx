/**
 * @file CuratePanel.tsx
 * @description Trim or delete the selected episode into a new dataset revision, and review AI suggestions
 * @feature training
 */

import { ArrowRight, Scissors, Sparkles, Trash2, X } from 'lucide-react';
import { Button, FormField, Input, Panel, StatusTag } from '@/shared/components/ui';
import type { CurationSuggestion } from '../../types';

export interface CuratePanelProps {
  episode: number;
  frameCount: number;
  trimStart: number;
  trimEnd: number | '';
  onTrimStart: (v: number) => void;
  onTrimEnd: (v: number | '') => void;
  curating: boolean;
  suggesting: boolean;
  onTrim: () => void;
  onDelete: () => void;
  onSuggest: () => void;
  message: string | null;
  newDataset: { id: string; name?: string } | null;
  onOpenNew: () => void;
  suggestMessage: string | null;
  suggestions: CurationSuggestion[];
  onApply: (s: CurationSuggestion) => void;
  onDismiss: (index: number) => void;
}

export function CuratePanel(p: CuratePanelProps) {
  return (
    <Panel data-testid="curate-panel">
      <Panel.Header
        title="Curate"
        titleAs="h2"
        description={`Episode ${p.episode} · every edit writes a new dataset revision; the original is kept.`}
      />
      <Panel.Body className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end gap-3">
          <FormField label="Start frame">
            <Input
              type="number"
              min={0}
              size="sm"
              className="w-28"
              value={p.trimStart}
              onChange={(e) => p.onTrimStart(Math.max(0, parseInt(e.target.value, 10) || 0))}
            />
          </FormField>
          <FormField label="End frame">
            <Input
              type="number"
              min={0}
              size="sm"
              className="w-28"
              placeholder={String(p.frameCount)}
              value={p.trimEnd}
              onChange={(e) => p.onTrimEnd(e.target.value === '' ? '' : Math.max(0, parseInt(e.target.value, 10) || 0))}
            />
          </FormField>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              size="sm"
              data-testid="curate-trim"
              disabled={p.curating}
              leftIcon={<Scissors className="h-4 w-4" strokeWidth={1.75} />}
              onClick={p.onTrim}
            >
              Trim range
            </Button>
            <Button
              variant="ghost"
              size="sm"
              data-testid="curate-delete"
              disabled={p.curating}
              className="text-signal-stopped"
              leftIcon={<Trash2 className="h-4 w-4" strokeWidth={1.75} />}
              onClick={p.onDelete}
            >
              Delete episode
            </Button>
            <Button
              variant="ghost"
              size="sm"
              data-testid="curate-suggest"
              disabled={p.suggesting}
              isLoading={p.suggesting}
              loadingText="Analyzing…"
              leftIcon={<Sparkles className="h-4 w-4" strokeWidth={1.75} />}
              onClick={p.onSuggest}
            >
              Suggest with AI
            </Button>
          </div>
        </div>

        {(p.message || p.newDataset) && (
          <div className="flex flex-wrap items-center gap-3">
            {p.message && (
              <p data-testid="curation-message" className="min-w-0 flex-1 text-sm text-ink-secondary">{p.message}</p>
            )}
            {p.newDataset && (
              <Button
                variant="secondary"
                size="sm"
                data-testid="curate-open-new"
                rightIcon={<ArrowRight className="h-4 w-4" strokeWidth={1.75} />}
                onClick={p.onOpenNew}
              >
                Open new dataset
              </Button>
            )}
          </div>
        )}

        {p.suggestMessage && (
          <p data-testid="suggest-message" className="text-xs text-ink-tertiary">{p.suggestMessage}</p>
        )}

        {p.suggestions.length > 0 && (
          <div data-testid="curate-suggestions" className="flex flex-col gap-1 border-t border-line pt-3">
            <p className="text-xs font-medium text-ink-tertiary">AI suggestions — review before applying</p>
            {p.suggestions.map((s, i) => (
              <div
                key={`${s.episode}-${s.kind}-${i}`}
                data-testid={`curate-suggestion-${i}`}
                className="flex flex-wrap items-center gap-2 rounded-control px-2 py-1.5 text-sm text-ink-secondary hover:bg-ink-primary/[0.035]"
              >
                <StatusTag tone={s.kind === 'delete' ? 'danger' : 'info'} size="sm">{s.kind}</StatusTag>
                <span className="shrink-0 tabular-nums text-ink-primary">
                  Ep {s.episode}
                  {s.kind === 'trim' && s.start !== undefined ? ` [${s.start}, ${s.end ?? 'end'})` : ''}
                </span>
                <span className="min-w-0 flex-1 truncate text-[13px] text-ink-tertiary" title={s.reason}>
                  {s.reason}{s.vlm ? ' · VLM' : ''} · {(s.confidence * 100).toFixed(0)}%
                </span>
                <Button variant="ghost" size="sm" data-testid={`suggest-apply-${i}`} disabled={p.curating} onClick={() => p.onApply(s)}>
                  Apply
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  iconOnly
                  data-testid={`suggest-dismiss-${i}`}
                  aria-label="Dismiss suggestion"
                  title="Dismiss suggestion"
                  onClick={() => p.onDismiss(i)}
                >
                  <X className="h-4 w-4" strokeWidth={1.75} />
                </Button>
              </div>
            ))}
          </div>
        )}
      </Panel.Body>
    </Panel>
  );
}
