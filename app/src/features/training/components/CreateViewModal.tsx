/**
 * @file CreateViewModal.tsx
 * @description Name a selection of episodes and turn it into a view — a fork
 *   of a dataset that copies no bytes (TASK-240).
 * @feature training
 */

import { memo, useEffect, useMemo, useState } from 'react';
import { GitFork, Layers } from 'lucide-react';
import { Button, Input, Modal } from '@/shared/components/ui';
import { cn } from '@/shared/utils/cn';
import { getErrorMessage } from '@/shared/utils';
import {
  selectionFromEpisodeIndices,
  selectionFromFlags,
  selectionFromRewards,
} from '../types';
import type { CreateDatasetViewInput, DatasetSelection, DatasetViewSummary } from '../types';

/** One reward-model score, as the episode page already holds it. */
export interface ViewRewardScore {
  episodeIndex: number;
  score: number;
  rewardType: string;
}

export interface CreateViewModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** The dataset the view is cut out of — named, so the dialog says what it forks. */
  parentName: string;
  /** Episodes the parent has. The "of M" half of the count. */
  parentEpisodeCount: number;
  /** Episode indices ticked on the page. Empty hides the manual source. */
  selectedEpisodes?: readonly number[];
  /** Every episode index in the parent, for the flag and reward rules. */
  allEpisodes?: readonly number[];
  /** Indices an operator flagged as bad. */
  flaggedEpisodes?: ReadonlySet<number>;
  /** Reward-model scores, when a scoring job has run. */
  rewards?: readonly ViewRewardScore[];
  /**
   * Duplicating an existing view: its selection, offered verbatim. This is
   * what a frozen view is edited with — it cannot change, so the honest
   * alternative to a disabled control is a new view that starts where it did.
   */
  duplicateOf?: { name: string; selection: DatasetSelection } | null;
  onCreate: (input: CreateDatasetViewInput) => Promise<DatasetViewSummary>;
  onCreated?: (view: DatasetViewSummary) => void;
}

type SourceId = 'duplicate' | 'manual' | 'flags' | 'reward';

const DEFAULT_MIN_SCORE = 0.7;

/**
 * Dialog for creating a view.
 *
 * Every source resolves to an explicit episode list HERE, in front of the
 * person choosing it, and that list is what gets stored. A view built from
 * "reward ≥ 0.7" must not change meaning when a later reward job rewrites the
 * scores; the threshold is recorded as prose, the episodes are the truth.
 */
export const CreateViewModal = memo(function CreateViewModal({
  isOpen,
  onClose,
  parentName,
  parentEpisodeCount,
  selectedEpisodes = [],
  allEpisodes = [],
  flaggedEpisodes,
  rewards = [],
  duplicateOf,
  onCreate,
  onCreated,
}: CreateViewModalProps) {
  const flagged = useMemo(() => flaggedEpisodes ?? new Set<number>(), [flaggedEpisodes]);

  const sources = useMemo(() => {
    const available: Array<{ id: SourceId; label: string; detail: string; selection: DatasetSelection }> = [];
    if (duplicateOf) {
      available.push({
        id: 'duplicate',
        label: `Same episodes as "${duplicateOf.name}"`,
        detail: 'A fresh, editable copy of a frozen selection.',
        selection: duplicateOf.selection,
      });
    }
    if (selectedEpisodes.length > 0) {
      available.push({
        id: 'manual',
        label: 'The episodes ticked here',
        detail: 'Exactly what is selected in the episode list.',
        selection: selectionFromEpisodeIndices(selectedEpisodes),
      });
    }
    if (allEpisodes.length > 0 && flagged.size > 0) {
      available.push({
        id: 'flags',
        label: 'Everything not flagged',
        detail: `${flagged.size} flagged episode${flagged.size === 1 ? '' : 's'} left out.`,
        selection: selectionFromFlags(allEpisodes, flagged),
      });
    }
    return available;
  }, [duplicateOf, selectedEpisodes, allEpisodes, flagged]);

  const [sourceId, setSourceId] = useState<SourceId>('manual');
  const [minScore, setMinScore] = useState(DEFAULT_MIN_SCORE);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const rewardSelection = useMemo(
    () => (rewards.length > 0 ? selectionFromRewards(rewards, minScore) : null),
    [rewards, minScore],
  );

  // Reset on open: a dialog that remembers the last fork's name is a dialog
  // that quietly creates "Top rewards" twice.
  useEffect(() => {
    if (!isOpen) return;
    const first = sources[0]?.id ?? (rewardSelection ? 'reward' : 'manual');
    setSourceId(first);
    setMinScore(DEFAULT_MIN_SCORE);
    setName(duplicateOf ? `${duplicateOf.name} (copy)` : '');
    setDescription('');
    setError(null);
    setIsSaving(false);
    // Only when the dialog opens — re-running this on every source change
    // would overwrite what the person is typing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const selection = useMemo(() => {
    if (sourceId === 'reward') return rewardSelection;
    return sources.find((source) => source.id === sourceId)?.selection ?? null;
  }, [sourceId, sources, rewardSelection]);

  const episodeCount = selection?.episodes.length ?? 0;
  const canSubmit = !!selection && episodeCount > 0 && name.trim().length > 0 && !isSaving;

  const handleSubmit = async () => {
    if (!selection || episodeCount === 0) return;
    setIsSaving(true);
    setError(null);
    try {
      const created = await onCreate({
        name: name.trim(),
        description: description.trim() || undefined,
        selection,
      });
      onCreated?.(created);
      onClose();
    } catch (err) {
      setError(getErrorMessage(err, 'Could not create this view'));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Create view" size="md">
      <div className="space-y-4" data-testid="create-view-modal">
        <p className="text-sm text-theme-secondary">
          A view is a named selection of{' '}
          <span className="font-medium text-theme-primary">{parentName}</span> — no files are
          copied, and it can be trained on like any other dataset.
        </p>

        <fieldset className="space-y-2">
          <legend className="text-xs font-medium uppercase tracking-wider text-theme-tertiary">
            Which episodes
          </legend>
          {sources.length === 0 && !rewardSelection && (
            <p data-testid="create-view-no-source" className="text-sm text-theme-tertiary">
              Nothing to select yet — tick episodes in the list, flag the bad ones, or score
              them with a reward model first.
            </p>
          )}
          {sources.map((source) => (
            <SourceOption
              key={source.id}
              checked={sourceId === source.id}
              onChange={() => setSourceId(source.id)}
              label={source.label}
              detail={source.detail}
              count={source.selection.episodes.length}
              testId={`view-source-${source.id}`}
            />
          ))}
          {rewardSelection && (
            <SourceOption
              checked={sourceId === 'reward'}
              onChange={() => setSourceId('reward')}
              label="Episodes above a reward score"
              detail="The scores as they stand right now — the list is frozen, not the rule."
              count={rewardSelection.episodes.length}
              testId="view-source-reward"
            >
              <label className="mt-2 flex items-center gap-2 text-xs text-theme-tertiary">
                Minimum score
                <input
                  type="number"
                  min={0}
                  max={1}
                  step={0.05}
                  value={minScore}
                  aria-label="Minimum reward score"
                  onChange={(e) => setMinScore(Number(e.target.value))}
                  className="w-20 rounded border border-theme-secondary/30 bg-theme-primary px-1.5 py-0.5 text-xs text-theme-primary"
                />
              </label>
            </SourceOption>
          )}
        </fieldset>

        <div
          data-testid="create-view-count"
          className="flex items-center gap-2 rounded-md bg-theme-secondary/10 px-3 py-2 text-sm text-theme-secondary"
        >
          <Layers className="h-4 w-4 shrink-0 text-cobalt-400" />
          <span>
            <span className="font-semibold text-theme-primary">{episodeCount}</span> of{' '}
            {parentEpisodeCount} episodes
          </span>
        </div>

        <Input
          label="Name"
          placeholder="e.g. Clean takes only"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <Input
          label="Description (optional)"
          placeholder="Why this arm exists"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />

        {error && (
          <p data-testid="create-view-error" role="alert" className="text-sm text-red-500">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-3 pt-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            data-testid="create-view-submit"
            disabled={!canSubmit}
            isLoading={isSaving}
            onClick={handleSubmit}
            leftIcon={<GitFork className="h-4 w-4" />}
          >
            Create view
          </Button>
        </div>
      </div>
    </Modal>
  );
});

/** One radio row: the rule, what it means, and how many episodes it picks. */
function SourceOption({
  checked,
  onChange,
  label,
  detail,
  count,
  testId,
  children,
}: {
  checked: boolean;
  onChange: () => void;
  label: string;
  detail: string;
  count: number;
  testId: string;
  children?: React.ReactNode;
}) {
  return (
    <label
      data-testid={testId}
      className={cn(
        'block cursor-pointer rounded-md border px-3 py-2 transition-colors',
        checked
          ? 'border-cobalt-500/50 bg-cobalt-500/10'
          : 'border-theme-secondary/20 hover:border-cobalt-500/30',
      )}
    >
      <span className="flex items-center gap-2">
        <input type="radio" checked={checked} onChange={onChange} className="h-3.5 w-3.5" />
        <span className="text-sm font-medium text-theme-primary">{label}</span>
        <span className="ml-auto text-xs text-theme-tertiary">{count} episodes</span>
      </span>
      <span className="mt-0.5 block pl-[22px] text-xs text-theme-tertiary">{detail}</span>
      {children && <span className="block pl-[22px]">{children}</span>}
    </label>
  );
}
