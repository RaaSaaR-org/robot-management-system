/**
 * @file SessionCompleted.tsx
 * @description Wrap up (TASK-425/429): the completed or failed session as one
 *              highlighted summary band — the result, one sentence, five
 *              readouts and exactly ONE dataset action in the band's own
 *              right column (Open dataset when exported, else New session at
 *              0 frames, else Create dataset) — then the takes table with
 *              thumbnails and a details list. The action is never on the
 *              band's top row, which lies under the E-STOP; below 640 px it
 *              spans the band under the readouts. The Details "Dataset" row
 *              names the dataset and never holds a second button.
 *              Keeps the dataset-card / open-dataset / review-episodes /
 *              episode-input-N / session-frames / session-warning test ids.
 *              TASK-418: never FRAMES 0 for a session whose takes hold
 *              frames — it refetches the session until the count is final and
 *              shows "…" meanwhile.
 * @feature datacollection
 */

import { useEffect, useState, type ReactNode } from 'react';
import { AlertTriangle, ArrowRight, Check, Database, OctagonX, Pencil, Plus } from 'lucide-react';
import {
  Button, DataTable, LinkButton, Panel, StatusTag, type DataTableColumn,
} from '@/shared/components/ui';
import { cn } from '@/shared/utils/cn';
import { UI_DATE_LOCALE } from '@/shared/utils/format';
import type { EpisodeActor, EpisodeSummary, TeleoperationSession } from '../../types/datacollection.types';
import {
  TELEOPERATION_TYPE_LABELS, formatDuration, formatEpisodeStat, formatRetargetModes,
} from '../../types/datacollection.types';
import { groupLabel, takeLabel } from '../../utils/takeFormat';
import { TakeThumbnail } from './TakeThumbnail';

export interface SessionCompletedProps {
  session: TeleoperationSession;
  robotName: string;
  episodes: EpisodeSummary[];
  onEditTask: () => void;
  onCreateDataset: () => void;
  /**
   * Refetch the session (TASK-418). Called while the session reads 0 frames but
   * its kept takes hold some — the count is not final yet.
   */
  onRefetch?: () => Promise<unknown> | void;
}

/** How often, and how many times, an unfinished frame count is refetched. */
export const FRAME_REFETCH_MS = 1_500;
export const FRAME_REFETCH_TRIES = 8;

/** Frames in the kept takes: what the session's own count must at least not deny. */
export function keptEpisodeFrames(episodes: readonly EpisodeSummary[]): number {
  return episodes.reduce((n, e) => (e.discarded ? n : n + (e.frameCount || 0)), 0);
}

/**
 * Whether the session's frame count is still settling: it reads 0 while its
 * kept takes hold frames. Refetched until it is not, at most `FRAME_REFETCH_TRIES`
 * times — after that the server's 0 is the answer and is shown as such.
 */
export function useSettlingFrameCount(
  session: Pick<TeleoperationSession, 'id' | 'frameCount'>,
  episodes: readonly EpisodeSummary[],
  onRefetch?: () => Promise<unknown> | void,
): boolean {
  const [tries, setTries] = useState(0);
  const unsettled = session.frameCount === 0 && keptEpisodeFrames(episodes) > 0;
  const settling = unsettled && !!onRefetch && tries < FRAME_REFETCH_TRIES;
  useEffect(() => {
    if (!settling) return;
    const timer = setTimeout(() => {
      setTries((n) => n + 1);
      void Promise.resolve(onRefetch?.()).catch(() => { /* the next try, or the page's error state */ });
    }, tries === 0 ? 0 : FRAME_REFETCH_MS);
    return () => clearTimeout(timer);
  }, [settling, tries, onRefetch]);
  useEffect(() => setTries(0), [session.id]);
  return settling;
}

/** The band's one action, in the epic's order. */
export type WrapAction = 'open-dataset' | 'new-session' | 'create-dataset';

/** Open dataset when exported → New session at 0 frames (once the count is final) → Create dataset. */
export function wrapAction(
  session: Pick<TeleoperationSession, 'exportedDatasetId' | 'frameCount'> & Partial<Pick<TeleoperationSession, 'status'>>,
  framesSettling: boolean,
): WrapAction {
  if (session.exportedDatasetId) return 'open-dataset';
  // The server packages only completed sessions (exportToLeRobot refuses the rest).
  if (session.status === 'failed') return 'new-session';
  if (session.frameCount === 0 && !framesSettling) return 'new-session';
  return 'create-dataset';
}

/** "Anna", "Headset", "Robot": who started a take, short enough for a table cell. */
function actorName(by: EpisodeActor | null | undefined): string | null {
  if (!by) return null;
  if (by.source === 'vr') return 'Headset';
  if (by.source === 'auto') return 'Robot';
  return by.displayName || null;
}

const clock = (iso: string) =>
  new Date(iso).toLocaleTimeString(UI_DATE_LOCALE, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const day = (iso: string) => new Date(iso).toLocaleDateString(UI_DATE_LOCALE, { month: 'short', day: 'numeric' });

/** "Oct 29, 17:36 to 17:42"; the end's date only when it is another day. */
function startedAndEnded(startedAt: string | null, endedAt: string | null): string {
  if (!startedAt && !endedAt) return 'Not started';
  if (!startedAt) return `Ended ${day(endedAt!)}, ${clock(endedAt!)}`;
  const start = `${day(startedAt)}, ${clock(startedAt)}`;
  if (!endedAt) return start;
  const end = day(endedAt) === day(startedAt) ? clock(endedAt) : `${day(endedAt)}, ${clock(endedAt)}`;
  return `${start} to ${end}`;
}

/** Mean of the kept takes' measured fps, or null when none was measured. */
function measuredFps(kept: readonly EpisodeSummary[]): number | null {
  const measured = kept.map((e) => e.fpsActual).filter((v): v is number => typeof v === 'number' && v > 0);
  return measured.length ? measured.reduce((a, b) => a + b, 0) / measured.length : null;
}

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;

/** The one sentence under the result: when it ended, what was kept, and the next step. */
export function wrapSentence(
  session: Pick<TeleoperationSession, 'endedAt'> & Partial<Pick<TeleoperationSession, 'status'>>,
  kept: number,
  discarded: number,
  action: WrapAction,
): string {
  const counts = kept + discarded > 0
    ? `${plural(kept, 'take')} kept${discarded > 0 ? `, ${discarded} discarded` : ''}.`
    : '';
  const next = action === 'open-dataset'
    ? 'Open the dataset to curate and train on it.'
    : action === 'new-session' && session.status === 'failed'
      ? 'A failed session cannot be packaged as a dataset. Start a new session to record again.'
    : action === 'new-session'
      ? 'It recorded no frames, so there is nothing to package. Start a new session with the robot online.'
      : `Create a dataset to curate and train on ${kept === 1 ? 'it' : 'them'}.`;
  return [session.endedAt ? `Ended at ${clock(session.endedAt)}.` : '', counts, next].filter(Boolean).join(' ');
}

const columns = (sessionId: string): DataTableColumn<EpisodeSummary>[] => [
  // "Take N", 1-based, the same number the session page showed while recording (TASK-410 D2).
  {
    key: 'episodeIndex', header: 'Take',
    cell: (e) => (
      <span className="flex items-center gap-3 font-semibold text-ink-primary">
        <TakeThumbnail sessionId={sessionId} take={e.episodeIndex} className="h-9 w-12" />
        <span className="whitespace-nowrap">{takeLabel(e.episodeIndex)}</span>
      </span>
    ),
  },
  {
    key: 'durationS', header: 'Length', align: 'right',
    cell: (e) => <span className="whitespace-nowrap tabular-nums">{e.durationS.toFixed(1)} s</span>,
  },
  {
    key: 'frameCount', header: 'Frames', align: 'right',
    cell: (e) => <span className="tabular-nums">{e.frameCount.toLocaleString(UI_DATE_LOCALE)}</span>,
  },
  {
    key: 'droppedFrames', header: 'Dropped', align: 'right', hideBelow: 'sm',
    // Amber only when frames were lost; an em-dash means "never counted", not zero.
    cell: (e) => (
      <span className={cn('tabular-nums', (e.droppedFrames ?? 0) > 0 && 'text-signal-unknown')}>
        {formatEpisodeStat(e.droppedFrames)}
      </span>
    ),
  },
  {
    key: 'fpsActual', header: 'FPS', align: 'right', hideBelow: 'sm',
    cell: (e) => <span className="tabular-nums">{formatEpisodeStat(e.fpsActual, 1)}</span>,
  },
  {
    key: 'moved', header: 'Moved', hideBelow: 'sm',
    cell: (e) => {
      const groups = e.quickCheck?.groupsMoved ?? [];
      if (!groups.length) return <span className="text-ink-muted">—</span>;
      return (
        <span className="flex flex-wrap gap-1">
          {groups.map((g) => (
            <span
              key={g}
              className="inline-flex h-5 items-center whitespace-nowrap rounded-tag border border-line-subtle bg-inset px-[7px] text-[11.5px] text-ink-secondary"
            >
              {groupLabel(g)}
            </span>
          ))}
        </span>
      );
    },
  },
  {
    key: 'by', header: 'By', hideBelow: 'sm',
    cell: (e) => <span className="whitespace-nowrap text-ink-tertiary">{actorName(e.startedBy) ?? '—'}</span>,
  },
  {
    // How the take was driven: a fact about the take the frames cannot recover.
    key: 'input', header: 'Input', hideBelow: 'sm',
    cell: (e) => (
      <span className="whitespace-nowrap text-[13px] text-ink-tertiary" data-testid={`episode-input-${e.episodeIndex}`}>
        {formatRetargetModes(e.retargetModes)}
      </span>
    ),
  },
];

/**
 * One readout of the band: a label over a big tabular value with an optional
 * unit. Hairline dividers between the cells of a row: 2 per row on a phone,
 * 3 up to 1280 px (the band's left column is too narrow for 5 there), 5 above.
 */
function Readout({ index, label, value, unit, testId, title }: {
  index: number; label: string; value: ReactNode; unit?: string; testId?: string; title?: string;
}) {
  return (
    <div
      className={cn(
        'min-w-0 border-line py-0.5',
        index % 2 === 0 ? 'border-l-0 pl-0 pr-3' : 'border-l px-3',
        index % 3 === 0 ? 'sm:border-l-0 sm:pl-0 sm:pr-5' : 'sm:border-l sm:px-5',
        index === 0 ? 'xl:border-l-0 xl:pl-0 xl:pr-5' : 'xl:border-l xl:px-5',
      )}
    >
      <dt className="whitespace-nowrap text-xs text-ink-tertiary">{label}</dt>
      <dd
        className="mt-0.5 whitespace-nowrap font-display text-[26px] font-semibold leading-[1.15] tracking-[-0.01em] tabular-nums [font-variation-settings:'wdth'_110]"
        title={title}
      >
        <span data-testid={testId}>{value}</span>
        {unit && <small className="ml-[3px] font-sans text-[12.5px] font-normal tracking-normal text-ink-tertiary">{unit}</small>}
      </dd>
    </div>
  );
}

/** A Details row: a sentence-case label over its value. */
function DetailRow({ label, children, testId }: { label: string; children: ReactNode; testId?: string }) {
  return (
    <div className="min-w-0" data-testid={testId}>
      <dt className="text-xs text-ink-tertiary">{label}</dt>
      <dd className="mt-px flex min-w-0 items-center justify-between gap-2 text-sm text-ink-primary">{children}</dd>
    </div>
  );
}

const panelTitle = "font-display text-base font-semibold [font-variation-settings:'wdth'_106]";

export function SessionCompleted({ session, robotName, episodes, onEditTask, onCreateDataset, onRefetch }: SessionCompletedProps) {
  const framesSettling = useSettlingFrameCount(session, episodes, onRefetch);
  const datasetId = session.exportedDatasetId;
  const sidecarPath = (session as unknown as Record<string, unknown>).sidecarDatasetPath;
  const failed = session.status === 'failed';
  const kept = episodes.filter((e) => !e.discarded).sort((a, b) => a.episodeIndex - b.episodeIndex);
  const action = wrapAction(session, framesSettling);
  const fps = measuredFps(kept) ?? session.fps;
  const sentence = wrapSentence(session, kept.length, episodes.length - kept.length, action);

  const icon = <Database className="h-[18px] w-[18px]" strokeWidth={1.75} />;
  const cta = action === 'open-dataset' ? (
    <LinkButton
      to={`/datasets/${datasetId}/episodes`}
      size="lg"
      fullWidth
      data-testid="open-dataset"
      leftIcon={icon}
      rightIcon={<ArrowRight className="h-4 w-4" strokeWidth={1.75} />}
    >
      Open dataset
    </LinkButton>
  ) : action === 'new-session' ? (
    <LinkButton
      to="/data-collection/new"
      size="lg"
      fullWidth
      data-testid="wrap-new-session"
      leftIcon={<Plus className="h-[18px] w-[18px]" strokeWidth={1.75} />}
    >
      New session
    </LinkButton>
  ) : (
    <Button size="lg" fullWidth onClick={onCreateDataset} data-testid="create-dataset" leftIcon={icon}>
      Create dataset
    </Button>
  );

  return (
    <div className="flex flex-col gap-3" data-testid="session-wrap">
      {/* The summary band: the page's one highlighted panel. */}
      <Panel
        as="section"
        variant="highlight"
        padding="none"
        aria-labelledby="session-summary-title"
        className="grid grid-cols-1 items-center gap-y-[18px] px-6 pb-5 pt-[22px] max-sm:p-[18px] sm:grid-cols-[minmax(0,1fr)_auto] sm:gap-x-8"
        data-testid="session-summary"
        data-result={failed ? 'failed' : 'completed'}
      >
        <div className="flex min-w-0 flex-col gap-[18px]">
          <div className="min-w-0">
            <h2
              id="session-summary-title"
              className="flex items-center gap-3 font-display text-2xl font-semibold leading-tight tracking-[-0.01em] [word-spacing:.06em] [font-variation-settings:'wdth'_108]"
            >
              <span
                className={cn(
                  'grid h-[30px] w-[30px] shrink-0 place-items-center rounded-full border',
                  failed
                    ? 'border-signal-stopped/40 bg-signal-stopped/[0.14] text-signal-stopped'
                    : 'border-signal-measured/40 bg-signal-measured/[0.14] text-signal-measured',
                )}
                aria-hidden="true"
              >
                {failed ? <OctagonX className="h-4 w-4" strokeWidth={1.75} /> : <Check className="h-4 w-4" strokeWidth={1.75} />}
              </span>
              {failed ? 'Session failed' : 'Session complete'}
            </h2>
            {failed && session.errorMessage ? (
              // A failed session leads with its reason: stated once, in the sentence.
              <p className="mt-1 text-[13.5px] text-ink-secondary sm:ml-[42px]" data-testid="session-warning">
                <span className="text-signal-stopped">{session.errorMessage}</span> {sentence}
              </p>
            ) : (
              <p className="mt-1 text-[13.5px] text-ink-secondary sm:ml-[42px]">{sentence}</p>
            )}
            {!failed && session.errorMessage && (
              <p className="mt-2 flex items-start gap-2 text-[13px] text-ink-secondary sm:ml-[42px]" data-testid="session-warning">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-signal-unknown" strokeWidth={1.75} aria-hidden="true" />
                {session.errorMessage}
              </p>
            )}
          </div>
          <dl className="m-0 grid grid-cols-2 gap-y-3.5 sm:grid-cols-3 sm:pl-[42px] xl:grid-cols-5 xl:gap-y-0">
            <Readout index={0} label="Takes kept" value={kept.length} testId="session-kept" />
            <Readout index={1} label="Recorded" value={formatDuration(session.duration)} />
            <Readout
              index={2}
              label="Frames"
              testId="session-frames"
              value={framesSettling ? '…' : session.frameCount.toLocaleString(UI_DATE_LOCALE)}
              title={framesSettling ? 'Counting the frames the robot packed' : undefined}
            />
            <Readout index={3} label="Frame rate" value={fps.toFixed(1)} unit="fps" />
            <Readout
              index={4}
              label="Motion"
              value={session.qualityScore ? Math.round(session.qualityScore) : '—'}
              unit={session.qualityScore ? '% smooth' : undefined}
              title={session.qualityScore ? undefined : 'Not computed'}
            />
          </dl>
        </div>
        {/* The one action: its own column, vertically centred, never on the band's top row under the E-STOP. */}
        <div className="self-center">{cta}</div>
      </Panel>

      {/* Side by side from 1440 px: below that the takes table needs the full width to show all its columns. */}
      <div className="grid grid-cols-1 items-start gap-3 min-[1440px]:grid-cols-[minmax(0,8fr)_minmax(0,4fr)]">
        {episodes.length > 0 && (
          <Panel padding="none" data-testid="review-episodes">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-[18px] pb-3 pt-4">
              <h2 className={panelTitle}>Takes</h2>
              <span className="text-[12.5px] text-ink-tertiary">Trim or delete weak takes in the dataset viewer before you train.</span>
            </div>
            <DataTable
              caption="Recorded takes"
              columns={columns(session.id)}
              rows={kept}
              getRowId={(e) => String(e.episodeIndex)}
              dense
            />
          </Panel>
        )}

        <Panel padding="none" className={cn(episodes.length === 0 && 'min-[1440px]:col-start-2')}>
          <div className="px-[18px] pb-3 pt-4">
            <h2 className={panelTitle}>Details</h2>
          </div>
          <dl className="m-0 grid gap-3 px-[18px] pb-4 sm:max-[1439px]:grid-cols-2 sm:max-[1439px]:gap-x-8 lg:max-[1439px]:grid-cols-3">
            <DetailRow label="Task">
              <span className="min-w-0 break-words">{session.languageInstr || 'No description'}</span>
              <Button
                variant="ghost"
                size="sm"
                className="shrink-0"
                onClick={onEditTask}
                aria-label="Edit task"
                leftIcon={<Pencil className="h-4 w-4" strokeWidth={1.75} />}
              >
                Edit
              </Button>
            </DetailRow>
            <DetailRow label="Robot and input">
              <span>{robotName}, {TELEOPERATION_TYPE_LABELS[session.type] ?? session.type}</span>
            </DetailRow>
            <DetailRow label="Started and ended">
              <span className="tabular-nums">{startedAndEnded(session.startedAt, session.endedAt)}</span>
            </DetailRow>
            <DetailRow label="Session">
              <span className="font-mono text-[13px]" title={session.id}>{session.id.slice(0, 8)}</span>
            </DetailRow>
            <DetailRow label="Dataset" testId={datasetId ? 'dataset-card' : undefined}>
              {datasetId ? (
                <span className="flex min-w-0 items-center gap-2">
                  <StatusTag status="ready" dot>Exported</StatusTag>
                  <span className="font-mono text-[13px] text-ink-secondary" title={datasetId}>{datasetId.slice(0, 8)}</span>
                </span>
              ) : (
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="text-ink-tertiary">Not created yet</span>
                  {!!sidecarPath && <span className="break-all font-mono text-xs text-ink-tertiary">{String(sidecarPath)}</span>}
                </span>
              )}
            </DetailRow>
          </dl>
        </Panel>
      </div>
    </div>
  );
}
