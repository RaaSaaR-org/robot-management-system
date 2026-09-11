/**
 * @file SessionCompleted.tsx
 * @description Completed-session view: recording summary, the dataset it was
 *              packed into (or the way to create one), and the episode review
 *              table. Keeps the dataset-card / open-dataset / review-episodes /
 *              episode-input-N / session-warning test ids.
 * @feature datacollection
 */

import { AlertTriangle, ArrowRight, Pencil } from 'lucide-react';
import {
  Button, DataTable, KeyValueList, LinkButton, Panel, StatusTag, type DataTableColumn,
} from '@/shared/components/ui';
import { UI_DATE_LOCALE, formatDateTime } from '@/shared/utils/format';
import type { EpisodeSummary, TeleoperationSession } from '../../types/datacollection.types';
import { formatDuration, formatEpisodeStat, formatRetargetModes } from '../../types/datacollection.types';

export interface SessionCompletedProps {
  session: TeleoperationSession;
  robotName: string;
  episodes: EpisodeSummary[];
  onEditTask: () => void;
  onCreateDataset: () => void;
}

const COLUMNS: DataTableColumn<EpisodeSummary>[] = [
  { key: 'episodeIndex', header: 'Episode', sortable: true, cell: (e) => <span className="font-medium text-ink-primary">Episode {e.episodeIndex}</span> },
  { key: 'frameCount', header: 'Frames', align: 'right', sortable: true, cell: (e) => e.frameCount.toLocaleString(UI_DATE_LOCALE) },
  {
    key: 'droppedFrames', header: 'Dropped', align: 'right', hideBelow: 'sm',
    // Amber only when frames were lost; an em-dash means "never counted", not zero.
    cell: (e) => (
      <span className={(e.droppedFrames ?? 0) > 0 ? 'text-signal-estimated' : undefined}>{formatEpisodeStat(e.droppedFrames)}</span>
    ),
  },
  { key: 'fpsActual', header: 'fps', align: 'right', hideBelow: 'md', cell: (e) => formatEpisodeStat(e.fpsActual, 1) },
  { key: 'durationS', header: 'Duration', align: 'right', hideBelow: 'sm', sortable: true, cell: (e) => `${e.durationS.toFixed(1)}s` },
  { key: 'startTime', header: 'Start', align: 'right', hideBelow: 'lg', cell: (e) => `${e.startTime.toFixed(1)}s` },
  {
    // How the take was driven: a fact about the take the frames cannot recover.
    key: 'input', header: 'Input', hideBelow: 'md',
    cell: (e) => (
      <span className="text-[13px] text-ink-tertiary" data-testid={`episode-input-${e.episodeIndex}`}>
        {formatRetargetModes(e.retargetModes)}
      </span>
    ),
  },
];

export function SessionCompleted({ session, robotName, episodes, onEditTask, onCreateDataset }: SessionCompletedProps) {
  const sidecarPath = (session as unknown as Record<string, unknown>).sidecarDatasetPath;
  const datasetId = session.exportedDatasetId;

  return (
    <div className="flex flex-col gap-6">
      {session.errorMessage && (
        <Panel variant="inset" padding="sm" className="flex items-start gap-3" data-testid="session-warning">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-signal-estimated" strokeWidth={1.75} />
          <p className="text-[13px] text-ink-secondary">{session.errorMessage}</p>
        </Panel>
      )}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <Panel className="xl:col-span-2">
          <Panel.Header
            title="Recording summary"
            actions={
              <Button variant="ghost" size="sm" leftIcon={<Pencil className="h-4 w-4" strokeWidth={1.75} />} onClick={onEditTask}>
                Edit task
              </Button>
            }
          />
          <Panel.Body>
            <KeyValueList
              items={[
                { label: 'Task', value: session.languageInstr || 'No description' },
                { label: 'Robot', value: robotName },
                { label: 'Duration', value: formatDuration(session.duration) },
                { label: 'Frames', value: session.frameCount.toLocaleString(UI_DATE_LOCALE) },
                { label: 'Episodes', value: episodes.length },
                { label: 'Frame rate', value: `${session.fps} fps` },
                { label: 'Quality', value: session.qualityScore ? `${session.qualityScore}%` : 'Not computed' },
                { label: 'Started', value: session.startedAt ? formatDateTime(session.startedAt) : '—' },
                { label: 'Ended', value: session.endedAt ? formatDateTime(session.endedAt) : '—' },
                { label: 'Session ID', value: <span title={session.id}>{session.id.slice(0, 8)}</span>, mono: true },
              ]}
            />
          </Panel.Body>
        </Panel>

        <Panel data-testid={datasetId ? 'dataset-card' : undefined}>
          <Panel.Header title="Dataset" />
          <Panel.Body className="flex flex-col gap-3">
            {datasetId ? (
              <>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-ink-primary">Packed into a dataset</span>
                  <StatusTag status="ready" dot>Exported</StatusTag>
                </div>
                <p className="font-mono text-xs text-ink-tertiary" title={datasetId}>{datasetId.slice(0, 8)}</p>
                <p className="text-[13px] text-ink-tertiary">
                  Trim or delete weak episodes in the episode viewer before you train.
                </p>
                <LinkButton
                  to={`/datasets/${datasetId}/episodes`}
                  data-testid="open-dataset"
                  rightIcon={<ArrowRight className="h-4 w-4" strokeWidth={1.75} />}
                >
                  Open dataset
                </LinkButton>
              </>
            ) : session.frameCount === 0 ? (
              <>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-ink-primary">Nothing to package</span>
                  <StatusTag tone="neutral">No frames</StatusTag>
                </div>
                <p className="text-[13px] text-ink-tertiary">
                  This session recorded no frames, so there is no dataset to create. Start a new session with the robot online.
                </p>
              </>
            ) : (
              <>
                <p className="text-[13px] text-ink-secondary">This recording is ready to be packed into a dataset.</p>
                {!!sidecarPath && <p className="break-all font-mono text-xs text-ink-tertiary">{String(sidecarPath)}</p>}
                <Button onClick={onCreateDataset}>Create dataset</Button>
              </>
            )}
          </Panel.Body>
        </Panel>
      </div>

      {episodes.length > 0 && (
        <Panel padding="none" data-testid="review-episodes">
          <Panel.Header title="Episodes" description="Per-take frame counts, drops and how each take was driven." />
          <DataTable
            caption="Recorded episodes"
            columns={COLUMNS}
            rows={episodes}
            getRowId={(e) => String(e.episodeIndex)}
            defaultSort={{ key: 'episodeIndex', direction: 'asc' }}
            dense
          />
        </Panel>
      )}
    </div>
  );
}
