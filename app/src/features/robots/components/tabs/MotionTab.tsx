/**
 * @file MotionTab.tsx
 * @description Motion tab — a library of retargeted motion clips and a transport-driven
 *              3D preview. Clips are produced offline by the GVHMR→GMR pipeline and
 *              imported here as JSON; this tab plays them back on the robot's 3D model.
 * @feature robots
 */

import { Suspense, lazy, memo, useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Download, Film, Pause, Play, Trash2, Upload } from 'lucide-react';
import {
  Button,
  EmptyState,
  ErrorState,
  Panel,
  RowActions,
  SegmentedControl,
  SkeletonRows,
  Spinner,
  StatusTag,
  ToggleChip,
  confirm,
  toast,
} from '@/shared/components/ui';
import type { SegmentedOption } from '@/shared/components/ui';
import { cn } from '@/shared/utils';
import { createClip, deleteClip, getClip, listClips } from '../../api/motionApi';
import {
  loadClip,
  resetMotion,
  seekMotion,
  setMotionFollowRoot,
  setMotionLoop,
  setMotionSpeed,
  stepMotion,
  toggleMotion,
  useMotionPlayback,
} from '../../motion';
import { normalizeRobotType } from '../../types/robots.types';
import { downloadBlob } from '../../utils/pointcloud';
import { Robot3DViewerFallback } from '../visualization';
import { MAX_CLIP_FRAMES } from '../../types/motion.types';
import type { CreateMotionClipInput, MotionClipSummary } from '../../types/motion.types';
import type { MotionTabProps } from './types';

const Robot3DViewer = lazy(() =>
  import('../visualization/Robot3DViewer').then((m) => ({ default: m.Robot3DViewer })),
);

/** Speeds are strings because SegmentedControl is keyed on string values. */
type SpeedValue = '0.25' | '0.5' | '1' | '2';

const SPEED_OPTIONS: Array<SegmentedOption<SpeedValue>> = [
  { value: '0.25', label: '0.25×' },
  { value: '0.5', label: '0.5×' },
  { value: '1', label: '1×' },
  { value: '2', label: '2×' },
];

// ============================================================================
// ERRORS
// ============================================================================

/**
 * Pull a human-readable message off whatever the API layer rejected with.
 *
 * `apiClient` rejects with a plain `ApiError` object ({ code, message, details,
 * statusCode }) — `ApiError` is an interface, not a class, so `instanceof Error`
 * is always false for it and would discard the server's message. The server's
 * clip validation names the exact defect ("frames[17].dofPos must be 29 finite
 * numbers …"), which is the whole point of showing it. Mirrors the shape checks
 * used by `getErrorMessage` in ../../store/robotsStore.ts.
 */
function apiErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string' && error) return error;
  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message: unknown }).message;
    if (typeof message === 'string' && message) return message;
  }
  return fallback;
}

// ============================================================================
// IMPORT VALIDATION
// ============================================================================

/**
 * Validate a parsed clip file against the exporter contract.
 *
 * Every rejection names the actual mismatch: a clip that fails here is almost always a
 * retarget for a *different* body (dofPos width != jointNames length), and "failed to
 * import" would send the user hunting through a 66 KB JSON file for it.
 *
 * @returns the validated POST body, or an error message fit to show a human.
 */
function parseClipFile(raw: unknown, fallbackName: string): CreateMotionClipInput | string {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return 'This file is not a motion clip — the top level should be a JSON object.';
  }
  const clip = raw as Record<string, unknown>;

  const jointNames = clip.jointNames;
  if (!Array.isArray(jointNames) || jointNames.length === 0) {
    return 'Missing "jointNames" — a clip must name the joints its angles belong to.';
  }
  if (jointNames.some((n) => typeof n !== 'string')) {
    return '"jointNames" must be a list of joint-name strings.';
  }

  const frames = clip.frames;
  if (!Array.isArray(frames) || frames.length === 0) {
    return 'Missing "frames" — this file contains no poses.';
  }
  // Mirrors the server's MAX_CLIP_FRAMES cap (which itself fits under the 10 MB request
  // limit) — naming the real constraint here beats a wire-level "request too large".
  if (frames.length > MAX_CLIP_FRAMES) {
    return `This clip has ${frames.length} frames — more than the ${MAX_CLIP_FRAMES} maximum. Trim or split it before importing.`;
  }

  // Present-but-unrecognised orientation metadata must fail loudly, not fall back to the
  // server defaults: a wxyz clip persisted as xyzw plays back as a valid-looking but wrong
  // orientation that nothing downstream can detect (see motion.types.ts). These fields
  // exist precisely so the renderer never guesses.
  const rootRotOrder = clip.rootRotOrder === 'wxyz' ? 'wxyz' : clip.rootRotOrder === 'xyzw' ? 'xyzw' : undefined;
  if (rootRotOrder === undefined && clip.rootRotOrder !== undefined) {
    return `"rootRotOrder" must be "xyzw" or "wxyz" (got ${JSON.stringify(clip.rootRotOrder)}).`;
  }
  const upAxis = clip.upAxis === 'y' ? 'y' : clip.upAxis === 'z' ? 'z' : undefined;
  if (upAxis === undefined && clip.upAxis !== undefined) {
    return `"upAxis" must be "y" or "z" (got ${JSON.stringify(clip.upAxis)}).`;
  }

  const fps = typeof clip.fps === 'number' ? clip.fps : NaN;
  if (!Number.isFinite(fps) || fps <= 0) {
    return `Missing or invalid "fps" (got ${JSON.stringify(clip.fps ?? null)}) — needed to know how fast to play the clip.`;
  }

  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i] as Record<string, unknown> | null;
    if (typeof frame !== 'object' || frame === null) {
      return `Frame ${i} is not an object.`;
    }
    const dofPos = frame.dofPos;
    if (!Array.isArray(dofPos)) {
      return `Frame ${i} has no "dofPos" array.`;
    }
    if (dofPos.length !== jointNames.length) {
      return `Frame ${i} has ${dofPos.length} joint angles but "jointNames" lists ${jointNames.length} — this clip was retargeted onto a different body.`;
    }
    if (!Array.isArray(frame.rootPos) || frame.rootPos.length !== 3) {
      return `Frame ${i} has no valid "rootPos" (expected 3 numbers).`;
    }
    if (!Array.isArray(frame.rootRot) || frame.rootRot.length !== 4) {
      return `Frame ${i} has no valid "rootRot" quaternion (expected 4 numbers).`;
    }
  }

  const name = typeof clip.name === 'string' && clip.name.trim() ? clip.name.trim() : fallbackName;

  return {
    name,
    source: typeof clip.source === 'string' ? clip.source : undefined,
    robotType: typeof clip.robotType === 'string' ? clip.robotType : undefined,
    fps,
    jointNames: jointNames as string[],
    rootRotOrder,
    upAxis,
    warnings: Array.isArray(clip.warnings) ? clip.warnings.filter((w): w is string => typeof w === 'string') : undefined,
    metadata: typeof clip.metadata === 'object' && clip.metadata !== null ? (clip.metadata as Record<string, unknown>) : undefined,
    frames: frames as CreateMotionClipInput['frames'],
  };
}

// ============================================================================
// COMPONENT
// ============================================================================

/** Motion clip library + playback preview. */
export const MotionTab = memo(function MotionTab({ robot, telemetry }: MotionTabProps) {
  const transport = useMotionPlayback();

  const [clips, setClips] = useState<MotionClipSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  /** Only a failure of the list fetch itself — this one replaces the list. */
  const [listError, setListError] = useState<string | null>(null);
  /** Per-clip failures (load/delete). Shown beside the list so browsing survives. */
  const [actionError, setActionError] = useState<string | null>(null);
  const [selected, setSelected] = useState<MotionClipSummary | null>(null);
  // Mirrored into a ref so handleSelect can read it without taking `selected` as a dependency,
  // which would rebuild the callback (and the keydown binding) on every clip change.
  const selectedRef = useRef<MotionClipSummary | null>(null);
  selectedRef.current = selected;
  const [loadingClipId, setLoadingClipId] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Guards the async clip fetch. A response that lands after this tab unmounted (or after
  // a newer selection) must not reach loadClip: the playback module is a singleton that
  // every mounted 3D viewer reads, so a late loadClip with no MotionTab mounted would pin
  // the Overview/cockpit viewers at the clip's frame-0 pose — outranking live telemetry —
  // with no UI left to clear it.
  const loadSeqRef = useRef(0);

  const robotType = normalizeRobotType(
    (telemetry?.robotType as string | undefined) ?? (robot.metadata?.robotType as string | undefined) ?? robot.model,
  );

  const refresh = useCallback(async () => {
    setListError(null);
    // Also clear the per-clip error: a stale "could not load X" left over from before a
    // successful refresh reads as a fresh failure of the list the user is now looking at.
    setActionError(null);
    try {
      setClips(await listClips());
    } catch (error) {
      setListError(apiErrorMessage(error, 'Could not load motion clips.'));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Leaving the tab must stop the clock — the playback module outlives this component.
  // Bumping the sequence first invalidates any clip fetch still in flight, so it cannot
  // re-arm the clock after this cleanup has run.
  useEffect(
    () => () => {
      loadSeqRef.current += 1;
      resetMotion();
    },
    [],
  );

  const handleSelect = useCallback(async (summary: MotionClipSummary) => {
    // Re-selecting the loaded clip is a no-op rather than a reload. A clip-list row is a real
    // button, so Space activates it natively while it holds focus — without this, pressing Space
    // right after picking a clip would refetch and jump the playhead back to 0 instead of
    // starting playback, which is what the tab's own keyboard hint promises.
    if (summary.id === selectedRef.current?.id) return;
    const seq = ++loadSeqRef.current;
    setSelected(summary);
    setLoadingClipId(summary.id);
    setActionError(null);
    try {
      const clip = await getClip(summary.id);
      // Stale response: the tab unmounted, or the user picked another clip while this
      // one was downloading. The newer request (if any) owns all state from here.
      if (seq !== loadSeqRef.current) return;
      loadClip(clip);
    } catch (error) {
      if (seq !== loadSeqRef.current) return;
      setSelected(null);
      // Beside the list, not instead of it — one bad clip must not cost the user
      // the library they were browsing.
      setActionError(apiErrorMessage(error, `Could not load "${summary.name}".`));
    } finally {
      if (seq === loadSeqRef.current) setLoadingClipId(null);
    }
  }, []);

  const handleDelete = useCallback(
    async (summary: MotionClipSummary) => {
      const ok = await confirm({
        title: `Delete ${summary.name}?`,
        description: 'The clip file is removed from this robot. Import the JSON again to bring it back.',
        tone: 'danger',
      });
      if (!ok) return;
      setActionError(null);
      try {
        await deleteClip(summary.id);
      } catch (error) {
        const message = apiErrorMessage(error, `Could not delete "${summary.name}".`);
        setActionError(message);
        toast.error("Couldn't delete motion clip", { description: message });
        return;
      }
      if (selectedRef.current?.id === summary.id) {
        loadSeqRef.current += 1; // a fetch for this clip may still be in flight
        setSelected(null);
        resetMotion();
      }
      toast.success('Motion clip deleted', { description: summary.name });
      await refresh();
    },
    [refresh],
  );

  const handleDownload = useCallback(async (summary: MotionClipSummary) => {
    try {
      const clip = await getClip(summary.id);
      const blob = new Blob([JSON.stringify(clip, null, 2)], { type: 'application/json' });
      downloadBlob(blob, `${summary.name.replace(/[^\w.-]+/g, '_')}.json`);
    } catch (error) {
      toast.error("Couldn't download motion clip", { description: apiErrorMessage(error, summary.name) });
    }
  }, []);

  const handleFile = useCallback(
    async (file: File) => {
      setImportError(null);
      setIsImporting(true);
      try {
        let parsed: unknown;
        try {
          parsed = JSON.parse(await file.text());
        } catch {
          setImportError(`${file.name} is not valid JSON.`);
          return;
        }
        const result = parseClipFile(parsed, file.name.replace(/\.json$/i, ''));
        if (typeof result === 'string') {
          setImportError(result);
          return;
        }
        const created = await createClip(result);
        toast.success('Motion clip imported', { description: created.name });
        await refresh();
        await handleSelect(created);
      } catch (error) {
        setImportError(apiErrorMessage(error, 'The server rejected this clip.'));
      } finally {
        setIsImporting(false);
      }
    },
    [refresh, handleSelect],
  );

  // Transport shortcuts. Scoped to the window rather than the viewer because the scrub
  // slider and the clip list both take focus, and the keys should keep working from there.
  useEffect(() => {
    if (!transport.clipId) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      // Text entry and the scrub slider own their keys outright — a focused range
      // input handles ←/→ natively, and that is the behaviour we want there.
      if (target?.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target?.tagName ?? '')) return;
      if (event.key === ' ') {
        // Native buttons activate on keyup, which a defaulted keydown suppresses.
        // Without this, Space on a focused "+1 frame" / Loop / Delete toggles
        // playback instead of doing what the button says. Arrow keys stay global:
        // buttons have no native ←/→ behaviour to trample.
        if (target?.closest('button, [role="button"]')) return;
        event.preventDefault();
        toggleMotion();
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault();
        stepMotion(-1);
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        stepMotion(1);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [transport.clipId]);

  const warnings = selected?.warnings ?? [];

  return (
    <div className="flex flex-col gap-6" data-testid="motion-tab">
      {/* Quality notes from the exporter — informational, not a failure. */}
      {warnings.length > 0 && (
        <Panel variant="inset" padding="sm" data-testid="motion-warnings">
          <p className="text-[13px] font-medium text-ink-primary">
            Retargeting notes for {selected?.name}
          </p>
          <ul className="mt-1 list-inside list-disc space-y-0.5 text-xs text-ink-tertiary">
            {/* Index key: warnings can repeat verbatim, and this list is never reordered. */}
            {warnings.map((warning, index) => (
              <li key={index}>{warning}</li>
            ))}
          </ul>
        </Panel>
      )}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[340px_minmax(0,1fr)]">
        {/* ── Clip library ── */}
        <Panel className="min-w-0">
          <Panel.Header
            title="Motion clips"
            description={clips.length > 0 ? `${clips.length} imported` : undefined}
          />
          <Panel.Body className="flex flex-col gap-4">
            {isLoading ? (
              <SkeletonRows rows={3} columns={1} dense />
            ) : listError ? (
              <ErrorState size="sm" title="Couldn't load motion clips" message={listError} onRetry={() => void refresh()} />
            ) : clips.length === 0 ? (
              <EmptyState
                size="sm"
                icon={<Film />}
                title="No motion clips yet"
                description="Clips are retargeted offline by the GVHMR→GMR pipeline (run.py, then export_neodem.py) and imported here as JSON. This app does not run pose estimation — a video upload will not work."
              />
            ) : (
              <ul className="-mx-2 flex flex-col gap-1 xl:max-h-[420px] xl:overflow-y-auto">
                {clips.map((clip) => {
                  const isSelected = selected?.id === clip.id;
                  return (
                    <li key={clip.id}>
                      <div
                        className={cn(
                          'flex items-start gap-2 rounded-control border px-2 py-2 transition-colors duration-150',
                          isSelected ? 'border-primary/50 bg-primary/10' : 'border-transparent hover:bg-ink-primary/[0.035]',
                        )}
                      >
                        <button
                          type="button"
                          onClick={() => void handleSelect(clip)}
                          aria-pressed={isSelected}
                          className="min-w-0 flex-1 rounded-tag text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                        >
                          <span className="flex items-center gap-1.5">
                            <span className="truncate text-sm font-medium text-ink-primary">{clip.name}</span>
                            {loadingClipId === clip.id && <Spinner size="xs" color="primary" />}
                          </span>
                          <span className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs tabular-nums text-ink-tertiary">
                            <StatusTag tone={isSelected ? 'live' : 'neutral'}>{clip.source}</StatusTag>
                            <span>{clip.durationSec.toFixed(1)} s</span>
                            <span aria-hidden="true">·</span>
                            <span>{clip.frameCount} frames</span>
                            <span aria-hidden="true">·</span>
                            {/* Rounding would render an NTSC 29.97 clip as "30 fps". */}
                            <span>{Number.isInteger(clip.fps) ? clip.fps : clip.fps.toFixed(2)} fps</span>
                          </span>
                        </button>
                        <RowActions
                          label={`Actions for ${clip.name}`}
                          items={[
                            { label: 'Preview', icon: <Play />, onSelect: () => void handleSelect(clip) },
                            { label: 'Download', icon: <Download />, onSelect: () => void handleDownload(clip) },
                            {
                              label: 'Delete',
                              icon: <Trash2 />,
                              tone: 'danger',
                              separatorBefore: true,
                              onSelect: () => void handleDelete(clip),
                            },
                          ]}
                        />
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}

            {/* ── Import ── the only upload path: the JSON is parsed here and POSTed as a body */}
            <div
              role="button"
              tabIndex={0}
              aria-label="Import a motion clip — opens a file picker for an exported .json clip"
              onClick={() => fileInputRef.current?.click()}
              // The file input is hidden and out of the tab order, and this dropzone is the
              // tab's only import path — so it has to be operable from the keyboard itself.
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  fileInputRef.current?.click();
                }
              }}
              onDragOver={(e) => {
                e.preventDefault();
                setIsDragging(true);
              }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setIsDragging(false);
                const file = e.dataTransfer.files[0];
                if (file) void handleFile(file);
              }}
              className={cn(
                'flex cursor-pointer flex-col items-center gap-1 rounded-control border border-dashed bg-inset p-4 text-center transition-colors',
                'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary',
                isDragging ? 'border-primary bg-primary/10' : 'border-line-strong hover:border-primary/60',
              )}
              data-testid="motion-import-dropzone"
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".json,application/json"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  // Reset so re-picking the same file after a validation error still fires onChange.
                  e.target.value = '';
                  if (file) void handleFile(file);
                }}
              />
              {isImporting ? (
                <span className="flex items-center gap-2 text-[13px] text-ink-secondary">
                  <Spinner size="xs" color="primary" /> Importing…
                </span>
              ) : (
                <>
                  <Upload className="h-4 w-4 text-ink-tertiary" strokeWidth={1.75} aria-hidden="true" />
                  <span className="text-[13px] font-medium text-ink-primary">Import a clip</span>
                  <span className="text-xs text-ink-tertiary">
                    Drop an exported <code className="font-mono">.json</code> clip, or click to browse
                  </span>
                </>
              )}
            </div>

            {actionError && (
              <p className="text-xs text-signal-stopped" role="alert" data-testid="motion-action-error">
                {actionError}
              </p>
            )}

            {importError && (
              <p className="text-xs text-signal-stopped" role="alert" data-testid="motion-import-error">
                {importError}
              </p>
            )}
          </Panel.Body>
        </Panel>

        {/* ── Viewer + transport ── */}
        <Panel className="min-w-0">
          <Panel.Header
            title={transport.clipName ?? 'Preview'}
            description={
              selected
                ? `Preview on the ${selected.robotType} model — the robot itself does not move.`
                : 'Select a clip to preview it on the robot model.'
            }
            actions={
              <>
                <SegmentedControl
                  label="Playback speed"
                  size="sm"
                  options={SPEED_OPTIONS}
                  value={String(transport.speed) as SpeedValue}
                  onChange={(v) => setMotionSpeed(Number(v))}
                />
                <ToggleChip active={transport.loop} onClick={() => setMotionLoop(!transport.loop)}>
                  Loop
                </ToggleChip>
                <ToggleChip
                  active={transport.followRoot}
                  onClick={() => setMotionFollowRoot(!transport.followRoot)}
                  title="Move the robot through space, or replay the pose in place over a fixed origin"
                >
                  Follow root
                </ToggleChip>
              </>
            }
          />
          <Panel.Body className="flex flex-col gap-3">
            <div className="relative h-[300px] sm:h-[400px]">
              {/* No robotId: it would enable the 10 Hz live telemetry channel, which would
                  fight playback for the same joints. Playback owns the pose here. */}
              <Suspense fallback={<Robot3DViewerFallback className="h-full min-h-0" />}>
                <Robot3DViewer robotType={robotType} isAnimating={false} className="min-h-0" />
              </Suspense>
            </div>

            {/* ── Transport bar ── */}
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant="secondary"
                onClick={toggleMotion}
                disabled={!transport.clipId}
                aria-label={transport.playing ? 'Pause' : 'Play'}
                leftIcon={
                  transport.playing
                    ? <Pause className="h-4 w-4" strokeWidth={1.75} />
                    : <Play className="h-4 w-4" strokeWidth={1.75} />
                }
              >
                {transport.playing ? 'Pause' : 'Play'}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                iconOnly
                onClick={() => stepMotion(-1)}
                disabled={!transport.clipId}
                aria-label="Previous frame"
                title="Previous frame (←)"
              >
                <ChevronLeft className="h-4 w-4" strokeWidth={1.75} />
              </Button>
              <Button
                size="sm"
                variant="ghost"
                iconOnly
                onClick={() => stepMotion(1)}
                disabled={!transport.clipId}
                aria-label="Next frame"
                title="Next frame (→)"
              >
                <ChevronRight className="h-4 w-4" strokeWidth={1.75} />
              </Button>
              <span className="ml-auto text-xs tabular-nums text-ink-tertiary" data-testid="motion-readout">
                {transport.time.toFixed(2)} s · frame{' '}
                {transport.frameCount > 0 ? transport.frameIndex + 1 : 0}/{transport.frameCount}
              </span>
            </div>

            <input
              type="range"
              min={0}
              max={transport.duration || 1}
              step={0.01}
              value={transport.time}
              disabled={!transport.clipId}
              onChange={(e) => seekMotion(parseFloat(e.target.value))}
              aria-label="Playhead"
              className="w-full accent-[var(--color-primary)] disabled:opacity-40"
            />

            <p className="text-xs text-ink-tertiary">
              {transport.clipId
                ? 'Space play/pause · ← → step one frame'
                : 'Select a clip to preview it on the robot model.'}
            </p>
          </Panel.Body>
        </Panel>
      </div>
    </div>
  );
});
