/**
 * @file MotionTab.tsx
 * @description Motion tab — a library of retargeted motion clips and a transport-driven
 *              3D preview. Clips are produced offline by the GVHMR→GMR pipeline and
 *              imported here as JSON; this tab plays them back on the robot's 3D model.
 * @feature robots
 */

import { Suspense, lazy, memo, useCallback, useEffect, useRef, useState } from 'react';
import { Badge, Button, Card, EmptyState, SegmentedControl, Spinner, ToggleChip } from '@/shared/components/ui';
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
    rootRotOrder: clip.rootRotOrder === 'wxyz' ? 'wxyz' : clip.rootRotOrder === 'xyzw' ? 'xyzw' : undefined,
    upAxis: clip.upAxis === 'y' ? 'y' : clip.upAxis === 'z' ? 'z' : undefined,
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
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

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
  useEffect(() => resetMotion, []);

  const handleSelect = useCallback(async (summary: MotionClipSummary) => {
    // Re-selecting the loaded clip is a no-op rather than a reload. A clip-list row is a real
    // button, so Space activates it natively while it holds focus — without this, pressing Space
    // right after picking a clip would refetch and jump the playhead back to 0 instead of
    // starting playback, which is what the tab's own keyboard hint promises.
    if (summary.id === selectedRef.current?.id) return;
    setConfirmDeleteId(null);
    setSelected(summary);
    setLoadingClipId(summary.id);
    setActionError(null);
    try {
      loadClip(await getClip(summary.id));
    } catch (error) {
      setSelected(null);
      // Beside the list, not instead of it — one bad clip must not cost the user
      // the library they were browsing.
      setActionError(apiErrorMessage(error, `Could not load "${summary.name}".`));
    } finally {
      setLoadingClipId(null);
    }
  }, []);

  const handleDelete = useCallback(
    async (summary: MotionClipSummary) => {
      setConfirmDeleteId(null);
      setActionError(null);
      try {
        await deleteClip(summary.id);
      } catch (error) {
        setActionError(apiErrorMessage(error, `Could not delete "${summary.name}".`));
        return;
      }
      if (selected?.id === summary.id) {
        setSelected(null);
        resetMotion();
      }
      await refresh();
    },
    [refresh, selected],
  );

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
    <div className="space-y-4" data-testid="motion-tab">
      {/* Quality notes from the exporter — informational, not a failure. */}
      {warnings.length > 0 && (
        <div
          className="flex gap-3 p-3 rounded-xl glass-subtle border border-amber-500/30 bg-amber-500/10"
          data-testid="motion-warnings"
        >
          <svg
            className="w-4 h-4 mt-0.5 shrink-0 text-amber-500 dark:text-amber-300"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1.8}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"
            />
          </svg>
          <div className="min-w-0">
            <p className="text-xs font-medium text-theme-primary">
              Retargeting notes for “{selected?.name}”
            </p>
            <ul className="mt-1 space-y-0.5 text-[11px] text-theme-tertiary list-disc list-inside">
              {/* Index key: warnings can repeat verbatim, and this list is never reordered. */}
              {warnings.map((warning, index) => (
                <li key={index}>{warning}</li>
              ))}
            </ul>
          </div>
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-[300px_minmax(0,1fr)]">
        {/* ── Clip library ── */}
        <Card className="min-w-0">
          <Card.Header>
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-lg font-semibold text-theme-primary">Motion clips</h2>
              {clips.length > 0 && (
                <span className="text-xs text-theme-tertiary tabular-nums">{clips.length}</span>
              )}
            </div>
          </Card.Header>
          <Card.Body className="space-y-3">
            {isLoading ? (
              <div className="flex justify-center py-10">
                <Spinner size="md" color="cobalt" />
              </div>
            ) : listError ? (
              <div className="py-6 text-center space-y-3">
                <p className="text-xs text-red-500">{listError}</p>
                <Button type="button" size="sm" variant="ghost" onClick={() => void refresh()}>
                  Retry
                </Button>
              </div>
            ) : clips.length === 0 ? (
              <EmptyState
                size="sm"
                title="No motion clips yet"
                description="Clips are retargeted offline by the GVHMR→GMR pipeline (run.py, then export_neodem.py) and imported here as JSON. This app does not run pose estimation — a video upload will not work."
              />
            ) : (
              <ul className="space-y-2 xl:max-h-[420px] xl:overflow-y-auto">
                {clips.map((clip) => {
                  const isSelected = selected?.id === clip.id;
                  const isConfirming = confirmDeleteId === clip.id;
                  return (
                    <li key={clip.id}>
                      <div
                        className={cn(
                          'group flex items-start gap-2 p-2.5 rounded-brand border transition-colors duration-150',
                          isSelected
                            ? 'border-cobalt-500/40 bg-cobalt-500/10'
                            : 'border-theme hover:bg-theme-elevated',
                        )}
                      >
                        <button
                          type="button"
                          onClick={() => void handleSelect(clip)}
                          aria-pressed={isSelected}
                          className="flex-1 min-w-0 text-left"
                        >
                          <div className="flex items-center gap-1.5">
                            <span
                              className={cn(
                                'truncate text-sm font-medium',
                                isSelected ? 'text-cobalt-500 dark:text-cobalt-300' : 'text-theme-primary',
                              )}
                            >
                              {clip.name}
                            </span>
                            {loadingClipId === clip.id && <Spinner size="xs" color="cobalt" />}
                          </div>
                          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-theme-tertiary tabular-nums">
                            <Badge variant={isSelected ? 'cobalt' : 'default'} size="sm">
                              {clip.source}
                            </Badge>
                            <span>{clip.durationSec.toFixed(1)} s</span>
                            <span>·</span>
                            <span>{clip.frameCount} frames</span>
                            <span>·</span>
                            {/* Rounding would render an NTSC 29.97 clip as "30 fps" — the exact
                                distinction the fps column was widened to a float to preserve. */}
                            <span>
                              {Number.isInteger(clip.fps) ? clip.fps : clip.fps.toFixed(2)} fps
                            </span>
                          </div>
                        </button>

                        {isConfirming ? (
                          <div className="flex shrink-0 items-center gap-1">
                            <Button
                              type="button"
                              size="sm"
                              variant="destructive"
                              onClick={() => void handleDelete(clip)}
                              className="px-2 py-1 text-[11px]"
                            >
                              Delete
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              onClick={() => setConfirmDeleteId(null)}
                              className="px-2 py-1 text-[11px]"
                            >
                              Cancel
                            </Button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteId(clip.id)}
                            aria-label={`Delete ${clip.name}`}
                            className="shrink-0 p-1 rounded-brand text-theme-tertiary hover:text-red-500 hover:bg-red-500/10"
                          >
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0"
                              />
                            </svg>
                          </button>
                        )}
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
              // The file input is visually hidden and out of the tab order, and this
              // dropzone is the tab's only import path — so it has to be operable
              // from the keyboard itself.
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
                'border-2 border-dashed rounded-brand p-4 text-center cursor-pointer transition-colors',
                'focus:outline-none focus:ring-2 focus:ring-cobalt-500 focus:ring-offset-2',
                isDragging ? 'border-cobalt-500 bg-cobalt-500/10' : 'border-theme-secondary/30 hover:border-cobalt-500/50',
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
                <div className="flex items-center justify-center gap-2 text-xs text-theme-secondary">
                  <Spinner size="xs" color="cobalt" /> Importing…
                </div>
              ) : (
                <>
                  <p className="text-xs font-medium text-theme-primary">Import a clip</p>
                  <p className="mt-0.5 text-[11px] text-theme-tertiary">
                    Drop an exported <code className="px-1 rounded bg-theme-elevated">.json</code> clip, or click to browse
                  </p>
                </>
              )}
            </div>

            {actionError && (
              <p className="text-[11px] text-red-500" role="alert" data-testid="motion-action-error">
                {actionError}
              </p>
            )}

            {importError && (
              <p className="text-[11px] text-red-500" role="alert" data-testid="motion-import-error">
                {importError}
              </p>
            )}
          </Card.Body>
        </Card>

        {/* ── Viewer + transport ── */}
        <Card className="min-w-0">
          <Card.Header>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <h2 className="text-lg font-semibold text-theme-primary truncate">
                  {transport.clipName ?? 'Playback'}
                </h2>
                {selected && (
                  <Badge variant="turquoise" size="sm">
                    {selected.robotType}
                  </Badge>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <SegmentedControl
                  label="Playback speed"
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
              </div>
            </div>
          </Card.Header>

          <Card.Body className="p-0">
            {/* `relative` is load-bearing: Robot3DViewer's "<type> Model" badge is positioned
                absolute, so without a positioned ancestor here it escapes the viewer and lands
                under the transport bar. */}
            <div className="relative h-[320px] sm:h-[400px]">
              {/* No robotId: it would enable the 10 Hz live telemetry channel, which would
                  fight playback for the same joints. Playback owns the pose here. */}
              <Suspense
                fallback={
                  <div className="flex items-center justify-center h-full">
                    <Spinner size="md" color="cobalt" />
                  </div>
                }
              >
                <Robot3DViewer robotType={robotType} isAnimating={false} />
              </Suspense>
            </div>

            {/* ── Transport bar ── */}
            <div className="p-3 space-y-2 border-t border-theme">
              <div className="flex items-center gap-2">
                <Button
                              type="button"
                  size="sm"
                  variant="primary"
                  onClick={toggleMotion}
                  disabled={!transport.clipId}
                  aria-label={transport.playing ? 'Pause' : 'Play'}
                >
                  {transport.playing ? 'Pause' : 'Play'}
                </Button>
                <Button
                              type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => stepMotion(-1)}
                  disabled={!transport.clipId}
                  aria-label="Previous frame"
                  title="Previous frame (←)"
                  className="px-2 text-xs"
                >
                  −1
                </Button>
                <Button
                              type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => stepMotion(1)}
                  disabled={!transport.clipId}
                  aria-label="Next frame"
                  title="Next frame (→)"
                  className="px-2 text-xs"
                >
                  +1
                </Button>
                <span className="ml-auto text-xs text-theme-tertiary tabular-nums" data-testid="motion-readout">
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
                className="w-full accent-cobalt-500 disabled:opacity-40"
              />

              <p className="text-[11px] text-theme-tertiary">
                {transport.clipId
                  ? 'Space play/pause · ← → step one frame'
                  : 'Select a clip to preview it on the robot model.'}
              </p>
            </div>
          </Card.Body>
        </Card>
      </div>
    </div>
  );
});
