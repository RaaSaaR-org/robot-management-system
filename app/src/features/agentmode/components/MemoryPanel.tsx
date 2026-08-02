/**
 * @file MemoryPanel.tsx
 * @description What the robot durably remembers (TASK-197), as counts: entries,
 *              the `MEMORY.md` byte budget, the per-place notes, the journal on
 *              disk and the retention rule governing it — including whether
 *              that rule came from the platform or from a hardcoded fallback.
 * @feature agentmode
 */

import { memo } from 'react';
import { Brain } from 'lucide-react';
import { cn } from '@/shared/utils';
import { EmptyState } from '@/shared/components/ui';
import { Tooltip } from '@/shared/components/ui/Tooltip';
import { useAgentModeStore, selectMemory, selectSelf } from '../store/agentmodeStore';
import type { AgentMemoryDigest, AgentSelfState } from '../types/agentmode.types';

export interface MemoryPanelProps {
  className?: string;
  /**
   * Drop the card chrome and the title row because a parent already renders
   * them — which is what {@link KnowledgePanel} does, since the tab strip IS
   * this panel's header there.
   *
   * The default keeps the standalone card: `MemoryPanel.test.tsx` renders this
   * component on its own and reads the entry count out of that title row,
   * including the `—` that stands for "we have not been told".
   */
  headerless?: boolean;
}

/** Bytes, in the units an 8 KB budget is actually read in. */
function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

/** Amber from 80% of the cap: past that, the next `remember` starts evicting. */
const BUDGET_WARN_RATIO = 0.8;

/** How full `MEMORY.md` is, 0..1. A missing or zero cap is not "full". */
function budgetRatio(digest: AgentMemoryDigest): number {
  const max = digest.memoryMaxBytes > 0 ? digest.memoryMaxBytes : 0;
  return max > 0 ? Math.min(1, digest.memoryBytes / max) : 0;
}

/**
 * How many entries this console can honestly claim, or `null` for "not told".
 *
 * The digest is the full answer; `self.memoryEntries` rides along on every
 * state snapshot and is all there is before one arrives. Exported because the
 * count is rendered by whoever owns the header — this panel when it is a card
 * of its own, {@link KnowledgePanel} when it is a tab — and two implementations
 * of the same fallback would eventually disagree about which source won.
 */
export function memoryEntryCount(
  digest: AgentMemoryDigest | null | undefined,
  self: AgentSelfState | null | undefined
): number | null {
  return digest?.memoryEntries ?? self?.memoryEntries ?? null;
}

/**
 * Does the durable memory need an operator's eye right now?
 *
 * This exists because the scene and the memory now share one card behind a tab,
 * and a tab HIDES things. Two of the things it can hide are compliance answers:
 * a retention rule nobody chose for this deployment (`fallback`) and a legal
 * hold. The third is the byte budget crossing the point where the next
 * `remember` silently drops the robot's oldest lines. Each of those has to be
 * able to reach through the closed tab, which is what the amber dot on the
 * Memory label does — it is the compensation for the tab, not decoration.
 *
 * Deliberately NOT included: `retention === null`. An unanswered retention
 * question is already rendered as "unknown" inside the panel, and firing the
 * dot on every robot whose platform has not answered yet would make it
 * permanent furniture — at which point it stops meaning anything and the two
 * conditions above lose the only signal they have.
 */
export function memoryNeedsAttention(digest: AgentMemoryDigest | null | undefined): boolean {
  if (!digest) return false;
  if (budgetRatio(digest) >= BUDGET_WARN_RATIO) return true;
  return digest.retention?.source === 'fallback' || digest.retention?.legalHold === true;
}

/**
 * The byte budget, as a bar rather than two numbers.
 *
 * `MEMORY.md` has a hard cap and the robot prunes its oldest lines to stay
 * under it, so "how full is it" is the difference between a robot that still
 * remembers what it was told last week and one that has already dropped it.
 */
function BudgetMeter({ digest }: { digest: AgentMemoryDigest }) {
  const max = digest.memoryMaxBytes > 0 ? digest.memoryMaxBytes : 0;
  const ratio = budgetRatio(digest);
  const tight = ratio >= BUDGET_WARN_RATIO;

  return (
    <div data-testid="agent-memory-budget" data-ratio={ratio.toFixed(2)}>
      <div className="flex items-center gap-2">
        <span className="card-meta">Budget</span>
        <span className="ml-auto card-meta tabular-nums">
          {formatBytes(digest.memoryBytes)}
          {max > 0 && ` / ${formatBytes(max)}`}
        </span>
      </div>
      {max > 0 && (
        <div className="mt-1 h-1.5 rounded-full bg-theme-elevated overflow-hidden">
          <div
            className={cn(
              'h-full rounded-full transition-all duration-300',
              tight ? 'bg-amber-500' : 'bg-cobalt-500'
            )}
            style={{ width: `${Math.max(2, ratio * 100)}%` }}
          />
        </div>
      )}
      {tight && (
        <p className="card-meta mt-1 text-amber-600 dark:text-amber-400">
          Near the cap — the robot drops its oldest lines to make room.
        </p>
      )}
    </div>
  );
}

/**
 * The retention rule, with where it came from spelled out.
 *
 * `source` is the point of this row. `'policy'` means the platform's retention
 * rule is being honoured; `'fallback'` means the robot could not reach it and
 * is pruning on a hardcoded default — the same journal, kept for a length of
 * time nobody chose. An operator answering a data-subject request needs to know
 * which of the two they are looking at, and `null` is neither: it means the
 * question has not been answered, never that nothing is retained.
 */
function RetentionRow({ retention }: { retention: AgentMemoryDigest['retention'] }) {
  if (!retention) {
    return (
      <div
        data-testid="agent-memory-retention"
        data-retention-source="unknown"
        className="flex items-center gap-2"
      >
        <span className="card-meta">Retention</span>
        <Tooltip
          className="ml-auto"
          side="left"
          content="The robot has not been told what governs its journal. Unknown is not 'kept forever' and not 'kept for nothing' — it is unanswered."
        >
          <span className="card-meta">unknown</span>
        </Tooltip>
      </div>
    );
  }

  const fallback = retention.source === 'fallback';

  return (
    <div
      data-testid="agent-memory-retention"
      data-retention-source={retention.source}
      data-legal-hold={String(retention.legalHold)}
      className="flex flex-wrap items-center gap-x-2 gap-y-1"
    >
      <span className="card-meta">Retention</span>
      <span className="ml-auto card-meta tabular-nums">{retention.retentionDays} d</span>
      <Tooltip
        side="left"
        content={
          fallback
            ? "No retention policy reached this robot, so it is pruning on a hardcoded default — nobody chose this number for this deployment."
            : "The platform's retention policy, honoured by the robot."
        }
      >
        <span
          className={cn(
            'px-1.5 py-0.5 rounded-full text-[10px] font-medium',
            fallback
              ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
              : 'bg-cobalt-500/15 text-cobalt-600 dark:text-cobalt-400'
          )}
        >
          {retention.source}
        </span>
      </Tooltip>
      {retention.legalHold && (
        <span
          data-testid="agent-memory-legal-hold"
          className="px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-red-500/15 text-red-600 dark:text-red-400"
        >
          legal hold
        </span>
      )}
    </div>
  );
}

/**
 * The robot's durable memory, in counts only.
 *
 * Content is deliberately absent: `MEMORY.md` is operator-authored text, the
 * robot serves it only behind its personal-data gate, and a fleet console is
 * not where it belongs. What this panel exists to answer is the set of
 * questions the counts CAN answer — does this robot remember anything, is it
 * about to start forgetting, which places carry notes, and under what rule the
 * journal is being pruned.
 */
export const MemoryPanel = memo(function MemoryPanel({
  className,
  headerless = false,
}: MemoryPanelProps) {
  const digest = useAgentModeStore(selectMemory);
  const self = useAgentModeStore(selectSelf);

  // Showing the count from the self report beats showing nothing — but the
  // panel says which of the two it is rather than implying it knows the rest.
  const entries = memoryEntryCount(digest, self);

  return (
    <div
      data-testid="agent-memory-panel"
      className={cn(
        'flex flex-col overflow-hidden',
        headerless ? 'flex-1 min-h-0' : 'glass-card',
        className
      )}
    >
      {!headerless && (
        <div className="shrink-0 flex items-center gap-2 px-3 py-2.5 border-b border-glass-subtle">
          <span className="card-title">Durable memory</span>
          <span className="ml-auto card-meta tabular-nums">
            {entries === null ? '—' : `${entries} ${entries === 1 ? 'entry' : 'entries'}`}
          </span>
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-3">
        {entries === 0 && (
          <EmptyState
            size="sm"
            icon={<Brain className="w-8 h-8" />}
            title="Nothing remembered yet"
            description="A remember block, or telling the robot to remember something, writes the first line into MEMORY.md."
          />
        )}

        {entries !== null && entries > 0 && !digest && (
          <p data-testid="agent-memory-digest-missing" className="card-meta">
            {entries} {entries === 1 ? 'entry' : 'entries'} — from the robot&apos;s own state
            report. The byte budget, the place notes and the retention rule need the memory
            digest, which has not reached this console.
          </p>
        )}

        {digest && (
          <>
            <BudgetMeter digest={digest} />

            <RetentionRow retention={digest.retention} />

            <div className="flex items-center gap-2">
              <Tooltip
                side="top"
                content="Day files on the robot's disk, pruned by the retention rule above."
              >
                <span className="card-meta">Journal</span>
              </Tooltip>
              <span data-testid="agent-memory-journal" className="ml-auto card-meta tabular-nums">
                {digest.journalDays.length}{' '}
                {digest.journalDays.length === 1 ? 'day' : 'days'}
                {digest.journalDays.length > 0 && ` · since ${digest.journalDays[0]}`}
              </span>
            </div>

            {digest.places.length > 0 && (
              <div className="space-y-1.5">
                <span className="card-meta">Place notes</span>
                <ul className="space-y-1">
                  {digest.places.map((place) => (
                    <li
                      key={place.id}
                      data-testid="agent-memory-place"
                      className="glass-subtle px-2.5 py-1.5 flex items-center gap-2"
                    >
                      <span className="card-value truncate">{place.id}</span>
                      <span className="ml-auto card-meta tabular-nums shrink-0">
                        {place.entries} · {formatBytes(place.bytes)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* The "taken in <place>, <n> ago" footer is gone on purpose: it was
                the third place readout and the third age readout on one page.
                Both guarantees are carried in full elsewhere — `PlaceChip` is
                the single renderer of the place belief, and the snapshot age
                lives in `agent-self-freshness`, above every number it
                qualifies. Nothing was suppressed, it was de-duplicated. */}
          </>
        )}

        {entries === null && !digest && (
          <EmptyState
            size="sm"
            icon={<Brain className="w-8 h-8" />}
            title="No memory digest yet"
            description="This robot has not reported a memory workspace. That is not the same as remembering nothing."
          />
        )}
      </div>
    </div>
  );
});
