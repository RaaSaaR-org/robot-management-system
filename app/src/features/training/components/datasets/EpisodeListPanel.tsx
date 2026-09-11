/**
 * @file EpisodeListPanel.tsx
 * @description Episode list of the episode browser: pick one to watch, tick several for a view, flag bad takes
 * @feature training
 */

import { Flag, GitFork } from 'lucide-react';
import { Button, Checkbox, EmptyState, Panel, Select, SkeletonRows, StatusTag } from '@/shared/components/ui';
import { cn } from '@/shared/utils/cn';
import type { EpisodeMeta } from '../../types';
import { formatClock, scoreTone } from './episodeFormat';

export interface EpisodeListPanelProps {
  episodes: EpisodeMeta[];
  isLoading: boolean;
  /** The episodes request failed: say so instead of claiming the dataset is empty */
  hasError?: boolean;
  selected: number | null;
  onSelect: (index: number) => void;
  checked: number[];
  onToggleChecked: (index: number) => void;
  onSetChecked: (indices: number[]) => void;
  flagged: Record<number, boolean>;
  onToggleFlag: (index: number) => void;
  scores: Record<number, { score: number; rewardType: string }>;
  onCreateView: () => void;
}

export function EpisodeListPanel(props: EpisodeListPanelProps) {
  const { episodes, isLoading, hasError = false, selected, onSelect, checked, onToggleChecked, onSetChecked, flagged, onToggleFlag, scores, onCreateView } = props;
  const checkedSet = new Set(checked);
  const allChecked = episodes.length > 0 && checked.length === episodes.length;

  return (
    <div className="flex min-w-0 flex-col gap-3">
      {/* Phones: a select above the viewer instead of the list */}
      <Select
        className="lg:hidden"
        aria-label="Episode"
        placeholder="Select episode…"
        value={selected ?? ''}
        onChange={(e) => onSelect(Number(e.target.value))}
        options={episodes.map((ep) => ({
          value: String(ep.index),
          label: `Episode ${ep.index} — ${ep.frameCount} frames${scores[ep.index] ? ` · score ${scores[ep.index]!.score.toFixed(2)}` : ''}`,
        }))}
      />

      <Panel padding="none" className="hidden lg:flex lg:flex-col">
        <Panel.Header
          title="Episodes"
          titleAs="h2"
          actions={
            episodes.length > 0 && (
              <Checkbox
                data-testid="episode-select-all"
                aria-label="Select all episodes"
                label="All"
                checked={allChecked}
                onChange={(e) => onSetChecked(e.target.checked ? episodes.map((ep) => ep.index) : [])}
              />
            )
          }
        />
        <div className="max-h-[calc(100vh-16rem)] overflow-y-auto">
          {isLoading ? (
            <div className="p-4"><SkeletonRows rows={6} columns={1} dense /></div>
          ) : hasError ? (
            <EmptyState size="sm" title="Episodes unavailable" description="The list could not be loaded — retry from the viewer." />
          ) : episodes.length === 0 ? (
            <EmptyState size="sm" title="No episodes" description="This dataset holds no episodes yet." />
          ) : (
            <ul>
              {episodes.map((ep) => {
                const active = selected === ep.index;
                const score = scores[ep.index];
                return (
                  <li
                    key={ep.index}
                    role="button"
                    tabIndex={0}
                    aria-current={active || undefined}
                    onClick={() => onSelect(ep.index)}
                    onKeyDown={(e) => {
                      if (e.target !== e.currentTarget) return;
                      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(ep.index); }
                    }}
                    className={cn(
                      'flex cursor-pointer items-center gap-2 border-l-2 px-4 py-2 outline-none transition-colors focus-visible:bg-ink-primary/[0.05]',
                      active ? 'border-primary bg-primary/10' : 'border-transparent hover:bg-ink-primary/[0.035]',
                    )}
                  >
                    {/* Ticking is a selection, not a navigation */}
                    <span onClick={(e) => e.stopPropagation()} className="flex">
                      <Checkbox
                        data-testid={`episode-check-${ep.index}`}
                        aria-label={`Select episode ${ep.index} for a view`}
                        checked={checkedSet.has(ep.index)}
                        onChange={() => onToggleChecked(ep.index)}
                      />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className={cn('text-sm font-medium', active ? 'text-primary' : 'text-ink-primary')}>
                        Episode {ep.index}
                      </div>
                      <div className="text-xs text-ink-tertiary">
                        {ep.frameCount} frames · {formatClock(ep.durationSeconds)}
                      </div>
                    </div>
                    {score && (
                      <StatusTag tone={scoreTone(score.score)} size="sm" title={`${score.rewardType} score`}>
                        {score.score.toFixed(2)}
                      </StatusTag>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      iconOnly
                      aria-label={flagged[ep.index] ? `Unflag episode ${ep.index}` : `Flag episode ${ep.index}`}
                      title={flagged[ep.index] ? 'Unflag' : 'Flag'}
                      onClick={(e) => { e.stopPropagation(); onToggleFlag(ep.index); }}
                      className={flagged[ep.index] ? 'text-signal-stopped' : 'text-ink-muted'}
                    >
                      <Flag className="h-4 w-4" strokeWidth={1.75} fill={flagged[ep.index] ? 'currentColor' : 'none'} />
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        {checked.length > 0 && (
          <Panel.Footer>
            <div data-testid="episode-selection-bar" className="flex w-full flex-wrap items-center justify-between gap-2">
              <span className="text-[13px] text-ink-secondary">
                <span className="font-semibold text-ink-primary">{checked.length}</span> of {episodes.length} selected
              </span>
              <div className="flex gap-1">
                <Button variant="ghost" size="sm" onClick={() => onSetChecked([])}>Clear</Button>
                <Button
                  variant="secondary"
                  size="sm"
                  data-testid="create-view-from-selection"
                  leftIcon={<GitFork className="h-4 w-4" strokeWidth={1.75} />}
                  onClick={onCreateView}
                >
                  Create view
                </Button>
              </div>
            </div>
          </Panel.Footer>
        )}
      </Panel>
    </div>
  );
}
