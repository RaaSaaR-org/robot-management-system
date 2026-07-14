/**
 * @file GenerateSyntheticModal.tsx
 * @description Wizard to generate synthetic episodes and register them as a
 *   training-ready dataset. Two generator modes (TASK-178 / TASK-182):
 *   forward dynamics (NVIDIA Cosmos 3, WidowX bridge) and neural trajectory
 *   (GR00T-Dreams DreamGen recipe, Unitree G1 + Dex3). Three views:
 *   configure → live progress → result (with video preview).
 * @feature training
 */

import { useEffect, useRef, useState } from 'react';
import {
  Sparkles,
  Film,
  Check,
  AlertTriangle,
  Minus,
  Plus,
  Loader2,
  Cpu,
  KeyRound,
  Package,
  Database,
} from 'lucide-react';
import { Modal, Button, Badge, ProgressBar } from '@/shared/components/ui';
import { cn } from '@/shared/utils/cn';
import { trainingApi } from '../api/trainingApi';
import { useSyntheticGeneration } from '../hooks/useSyntheticGeneration';
import type { CosmosJobStatus, SyntheticGeneratorMode, SyntheticModeInfo } from '../types';

export interface GenerateSyntheticModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Called once a synthetic dataset has been registered (to refresh the list). */
  onSuccess?: (datasetId: string) => void;
  /** Navigate to the generated dataset's episodes page. */
  onViewDataset?: (datasetId: string) => void;
}

const STATUS_VARIANT: Record<CosmosJobStatus, 'info' | 'warning' | 'success' | 'error'> = {
  queued: 'info',
  generating: 'info',
  converting: 'info',
  registering: 'info',
  completed: 'success',
  failed: 'error',
  cancelled: 'warning',
};

const MODE_IDS: SyntheticGeneratorMode[] = ['forward-dynamics', 'neural-trajectory'];

/** Static per-mode UI copy + fallbacks for servers without `config.modes`. */
interface ModeUi {
  title: string;
  subtitle: string;
  /** Provenance banner: model + method line. */
  model: string;
  method: string;
  placeholder: string;
  presets: string[];
  /** Fallbacks when the server config has no modes array yet. */
  fallback: Pick<SyntheticModeInfo, 'embodiment' | 'maxEpisodes' | 'requiresToken' | 'available'>;
  estimate: (episodes: number) => string;
  estimateNote: string;
}

const fmtSeconds = (s: number) => (s >= 60 ? `${Math.round(s / 60)}m` : `${s}s`);

const MODE_UI: Record<SyntheticGeneratorMode, ModeUi> = {
  'forward-dynamics': {
    title: 'Forward dynamics',
    subtitle: 'Cosmos 3 · WidowX bridge',
    model: 'NVIDIA Cosmos 3',
    method: 'Forward dynamics · action-conditioned video exported as a LeRobot dataset.',
    placeholder: 'A WidowX robot arm picks up an object from the tabletop.',
    presets: [
      'Pick up the object and place it into the bowl',
      'Stack the blocks on top of each other',
      'Push the object to the left',
      'Open the drawer',
      'Wipe the table with the cloth',
    ],
    fallback: { embodiment: 'widowx_bridge', maxEpisodes: 8, requiresToken: true, available: true },
    estimate: (n) => `~${fmtSeconds(n * 10)}–${fmtSeconds(n * 35)}`,
    estimateNote: 'on ZeroGPU (daily PRO quota)',
  },
  'neural-trajectory': {
    title: 'Neural trajectory',
    subtitle: 'GR00T-Dreams · Unitree G1',
    model: 'GR00T-Dreams (Cosmos-Predict2-2B)',
    method:
      'Neural trajectories · language-prompted world-model rollouts with IDM pseudo-labels (28-dim G1 + Dex3).',
    placeholder: 'Pick up the red cube and place it in the box.',
    presets: [
      'Pick up the red cube and place it in the box',
      'Grasp the bottle and hand it over to the other hand',
      'Open the drawer and take out the tool',
      'Stack the green block on the blue block',
      'Press the button on the control panel',
    ],
    fallback: {
      embodiment: 'Unitree_G1_Dex3',
      maxEpisodes: 50,
      requiresToken: false,
      available: true,
    },
    estimate: (n) => `~${fmtSeconds(Math.max(2, n * 2))}–${fmtSeconds(n * 5)}`,
    estimateNote: 'locally (mock backend, no GPU)',
  },
};

export function GenerateSyntheticModal({
  isOpen,
  onClose,
  onSuccess,
  onViewDataset,
}: GenerateSyntheticModalProps) {
  const {
    config,
    configLoading,
    job,
    isGenerating,
    isStarting,
    error,
    start,
    cancel,
    reset,
    refreshConfig,
  } = useSyntheticGeneration();

  const [mode, setMode] = useState<SyntheticGeneratorMode>('forward-dynamics');
  const [episodes, setEpisodes] = useState(3);
  const [prompt, setPrompt] = useState('');
  // Track the last dataset we notified about by identity, so generating a second
  // batch in the same open modal still refreshes the list (a boolean keyed to
  // modal-open would suppress every success after the first).
  const lastNotifiedRef = useRef<string | null>(null);

  // Per-mode server capabilities, with static fallbacks for older servers
  // whose /config response has no `modes` array.
  const modeInfo = (id: SyntheticGeneratorMode): SyntheticModeInfo => {
    const fromServer = config?.modes?.find((m) => m.id === id);
    if (fromServer) return fromServer;
    const fb = MODE_UI[id].fallback;
    return {
      id,
      label: MODE_UI[id].title,
      embodiment: fb.embodiment,
      maxEpisodes: id === 'forward-dynamics' ? config?.maxEpisodes ?? fb.maxEpisodes : fb.maxEpisodes,
      // Only forward-dynamics has a legacy top-level `available`; neural-trajectory
      // is known-available *only* when the server explicitly reports it in `modes`
      // (handled by the fromServer early-return above). If we reach this fallback
      // for neural (config not loaded, or a pre-TASK-182 server), treat it as
      // unavailable so Generate stays disabled rather than POSTing to a 400.
      available: id === 'forward-dynamics' ? config?.available ?? fb.available : false,
      requiresToken: fb.requiresToken,
      hasToken: config?.hasToken ?? false,
    };
  };
  const selected = modeInfo(mode);
  const selectedUi = MODE_UI[mode];
  const maxEpisodes = selected.maxEpisodes;
  // Banner reflects the running/finished job's mode once one exists.
  const bannerMode: SyntheticGeneratorMode = job?.mode ?? mode;
  const bannerUi = MODE_UI[bannerMode];

  // Refresh config each time the modal opens (token may have been added).
  useEffect(() => {
    if (isOpen) void refreshConfig();
  }, [isOpen, refreshConfig]);

  // Notify the parent once per newly-registered dataset.
  useEffect(() => {
    if (job?.status === 'completed' && job.datasetId && lastNotifiedRef.current !== job.datasetId) {
      lastNotifiedRef.current = job.datasetId;
      onSuccess?.(job.datasetId);
    }
  }, [job?.status, job?.datasetId, onSuccess]);

  const clampEpisodes = (n: number) => Math.max(1, Math.min(maxEpisodes, n));

  // Re-clamp the episode count once the server-reported cap arrives (or the
  // mode changes) — the current value may exceed the new maxEpisodes.
  useEffect(() => {
    setEpisodes((n) => Math.max(1, Math.min(maxEpisodes, n)));
  }, [maxEpisodes]);

  const handleStart = async () => {
    await start({ episodes, prompt: prompt.trim() || undefined, mode });
  };

  const handleClose = () => {
    if (!isGenerating) reset();
    onClose();
  };

  const blocked = !selected.available || (selected.requiresToken && !selected.hasToken);
  const showResult = job && !isGenerating;

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      size="lg"
      closeOnBackdrop={!isGenerating}
      title="Generate Synthetic Episodes"
    >
      <div className="space-y-5">
        {/* Provenance banner */}
        <div className="flex items-start gap-3 rounded-lg border border-purple-500/20 bg-purple-500/5 p-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-purple-500/15">
            <Sparkles className="h-5 w-5 text-purple-400" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2">
              <p className="truncate text-sm font-medium text-theme-primary">
                {bannerUi.model}
              </p>
              <Badge variant="purple" className="shrink-0">
                {job?.embodiment ?? modeInfo(bannerMode).embodiment}
              </Badge>
            </div>
            <p className="mt-0.5 text-xs text-theme-tertiary">{bannerUi.method}</p>
          </div>
        </div>

        {/* ---------------- CONFIGURE ---------------- */}
        {!job && (
          <ConfigureView
            mode={mode}
            setMode={setMode}
            modeInfo={modeInfo}
            episodes={episodes}
            setEpisodes={(n) => setEpisodes(clampEpisodes(n))}
            maxEpisodes={maxEpisodes}
            prompt={prompt}
            setPrompt={setPrompt}
            selected={selected}
            selectedUi={selectedUi}
            configLoading={configLoading}
            error={error}
          />
        )}

        {/* ---------------- IN PROGRESS ---------------- */}
        {job && isGenerating && <ProgressView job={job} onCancel={cancel} />}

        {/* ---------------- RESULT ---------------- */}
        {showResult && job.status === 'completed' && job.datasetId && (
          <ResultView
            datasetId={job.datasetId}
            datasetName={job.datasetName}
            episodes={job.episodes}
            camera={bannerMode === 'neural-trajectory' ? 'cam_right_high' : 'image_0'}
          />
        )}
        {showResult && (job.status === 'failed' || job.status === 'cancelled') && (
          <FailureView job={job} />
        )}

        {/* ---------------- FOOTER ---------------- */}
        <div className="flex items-center justify-between gap-3 border-t border-theme-secondary/20 pt-4">
          {!job && (
            <>
              <Button variant="ghost" onClick={handleClose}>
                Cancel
              </Button>
              <Button
                onClick={handleStart}
                isLoading={isStarting}
                loadingText="Starting…"
                disabled={blocked}
                leftIcon={<Sparkles className="h-4 w-4" />}
                data-testid="start-generation"
              >
                Generate {episodes} episode{episodes > 1 ? 's' : ''}
              </Button>
            </>
          )}

          {job && isGenerating && (
            <>
              <Button variant="ghost" onClick={onClose}>
                Run in background
              </Button>
              <Button variant="destructive" onClick={cancel}>
                Cancel generation
              </Button>
            </>
          )}

          {showResult && job.status === 'completed' && job.datasetId && (
            <>
              <Button variant="ghost" onClick={reset}>
                Generate more
              </Button>
              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  onClick={() => onViewDataset?.(job.datasetId!)}
                >
                  View episodes
                </Button>
                <Button onClick={handleClose}>Done</Button>
              </div>
            </>
          )}

          {showResult && (job.status === 'failed' || job.status === 'cancelled') && (
            <>
              <Button variant="ghost" onClick={handleClose}>
                Close
              </Button>
              <Button onClick={reset}>Try again</Button>
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}

// ============================================================================
// Sub-views
// ============================================================================

interface ConfigureViewProps {
  mode: SyntheticGeneratorMode;
  setMode: (m: SyntheticGeneratorMode) => void;
  modeInfo: (id: SyntheticGeneratorMode) => SyntheticModeInfo;
  episodes: number;
  setEpisodes: (n: number) => void;
  maxEpisodes: number;
  prompt: string;
  setPrompt: (s: string) => void;
  selected: SyntheticModeInfo;
  selectedUi: ModeUi;
  configLoading: boolean;
  error: string | null;
}

function ConfigureView({
  mode,
  setMode,
  modeInfo,
  episodes,
  setEpisodes,
  maxEpisodes,
  prompt,
  setPrompt,
  selected,
  selectedUi,
  configLoading,
  error,
}: ConfigureViewProps) {
  return (
    <div className="space-y-5">
      {/* Generator mode */}
      <div>
        <label className="mb-2 block text-sm font-medium text-theme-primary">
          Generator mode
        </label>
        <div role="radiogroup" aria-label="Generator mode" className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {MODE_IDS.map((id) => {
            const ui = MODE_UI[id];
            const info = modeInfo(id);
            const active = mode === id;
            return (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={active}
                data-testid={`generator-mode-${id}`}
                onClick={() => setMode(id)}
                className={cn(
                  'rounded-lg border p-3 text-left transition-colors',
                  active
                    ? 'border-cobalt-500/60 bg-cobalt-500/10'
                    : 'border-theme-secondary/30 hover:border-cobalt-500/40',
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <span
                    className={cn(
                      'text-sm font-medium',
                      active ? 'text-theme-primary' : 'text-theme-secondary',
                    )}
                  >
                    {ui.title}
                  </span>
                  <span
                    className={cn(
                      'h-3.5 w-3.5 shrink-0 rounded-full border',
                      active
                        ? 'border-cobalt-400 bg-cobalt-500'
                        : 'border-theme-secondary/40',
                    )}
                  />
                </div>
                <p className="mt-0.5 text-xs text-theme-tertiary">{ui.subtitle}</p>
                <p className="mt-1 truncate text-[11px] text-theme-tertiary">
                  {info.embodiment} · max {info.maxEpisodes} ep
                  {info.requiresToken ? ' · HF token' : ''}
                </p>
              </button>
            );
          })}
        </div>
      </div>

      {/* Episode count */}
      <div>
        <label className="mb-2 block text-sm font-medium text-theme-primary">
          Episodes to generate
        </label>
        <div className="flex items-center gap-4">
          <button
            type="button"
            aria-label="Fewer episodes"
            onClick={() => setEpisodes(episodes - 1)}
            disabled={episodes <= 1}
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-theme-secondary/30 text-theme-secondary transition-colors hover:border-cobalt-500/50 hover:text-theme-primary disabled:opacity-40"
          >
            <Minus className="h-4 w-4" />
          </button>
          <input
            type="range"
            min={1}
            max={maxEpisodes}
            value={episodes}
            onChange={(e) => setEpisodes(Number(e.target.value))}
            className="h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-theme-secondary/20 accent-cobalt-500"
          />
          <button
            type="button"
            aria-label="More episodes"
            onClick={() => setEpisodes(episodes + 1)}
            disabled={episodes >= maxEpisodes}
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-theme-secondary/30 text-theme-secondary transition-colors hover:border-cobalt-500/50 hover:text-theme-primary disabled:opacity-40"
          >
            <Plus className="h-4 w-4" />
          </button>
          <span className="w-8 text-right text-lg font-semibold tabular-nums text-theme-primary">
            {episodes}
          </span>
        </div>
        <div className="mt-2 flex items-center gap-1.5 text-xs text-theme-tertiary">
          <Cpu className="h-3.5 w-3.5" />
          Est. {selectedUi.estimate(episodes)} {selectedUi.estimateNote} · max {maxEpisodes}/run
        </div>
      </div>

      {/* Prompt */}
      <div>
        <label className="mb-2 block text-sm font-medium text-theme-primary">
          Task description <span className="text-theme-tertiary">(optional)</span>
        </label>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder={selectedUi.placeholder}
          rows={2}
          maxLength={2000}
          className="w-full resize-none rounded-lg border border-theme-secondary/30 bg-theme-primary px-3 py-2 text-sm text-theme-primary placeholder:text-theme-tertiary focus:outline-none focus:ring-2 focus:ring-cobalt-500"
        />
        <div className="mt-2 flex flex-wrap gap-1.5">
          {selectedUi.presets.map((preset) => {
            const active = prompt.trim() === preset;
            return (
              <button
                key={preset}
                type="button"
                onClick={() => setPrompt(active ? '' : preset)}
                className={cn(
                  'rounded-full border px-2.5 py-1 text-xs transition-colors',
                  active
                    ? 'border-cobalt-500/60 bg-cobalt-500/15 text-cobalt-200'
                    : 'border-theme-secondary/30 text-theme-secondary hover:border-cobalt-500/40 hover:text-theme-primary',
                )}
              >
                {preset}
              </button>
            );
          })}
        </div>
        <p className="mt-2 text-xs text-theme-tertiary">
          Conditions the generated motion. Leave empty to cycle the default
          pick / place / reach prompts.
        </p>
      </div>

      {/* Config warnings (for the selected mode) */}
      {!configLoading && !selected.available && (
        <Notice tone="error" icon={<AlertTriangle className="h-4 w-4" />}>
          Generator not found on the server. Check
          <code className="mx-1 rounded bg-black/30 px-1">
            {mode === 'forward-dynamics'
              ? 'server/curation/cosmos3_synth.py'
              : 'server/curation/neural_traj/'}
          </code>
          .
        </Notice>
      )}
      {!configLoading && selected.available && selected.requiresToken && !selected.hasToken && (
        <Notice tone="warning" icon={<KeyRound className="h-4 w-4" />}>
          No Hugging Face PRO token configured. Set
          <code className="mx-1 rounded bg-black/30 px-1">HF_TOKEN</code> on the
          server (or <code className="mx-1 rounded bg-black/30 px-1">scratch/cosmos3/.env</code>)
          to run generation.
        </Notice>
      )}
      {error && (
        <Notice tone="error" icon={<AlertTriangle className="h-4 w-4" />}>
          {error}
        </Notice>
      )}
    </div>
  );
}

const STATUS_RANK: Record<CosmosJobStatus, number> = {
  queued: 0,
  generating: 1,
  converting: 2,
  registering: 3,
  completed: 4,
  failed: 99,
  cancelled: 99,
};

const PIPELINE_STEPS = [
  { rank: 1, label: 'Generate', icon: Film },
  { rank: 2, label: 'Convert', icon: Package },
  { rank: 3, label: 'Register', icon: Database },
] as const;

/** Three-step pipeline indicator: Generate → Convert → Register. */
function PipelineStepper({ status }: { status: CosmosJobStatus }) {
  const current = STATUS_RANK[status] ?? 0;
  return (
    <div className="flex items-center">
      {PIPELINE_STEPS.map((step, i) => {
        const done = current > step.rank;
        const active = current === step.rank;
        const Icon = step.icon;
        return (
          <div key={step.label} className="flex flex-1 items-center last:flex-none">
            <div className="flex flex-col items-center gap-1.5">
              <div
                className={cn(
                  'flex h-9 w-9 items-center justify-center rounded-full border transition-colors',
                  done && 'border-cobalt-500/40 bg-cobalt-500/15 text-cobalt-300',
                  active && 'border-cobalt-500 bg-cobalt-500/20 text-cobalt-200',
                  !done && !active && 'border-theme-secondary/30 text-theme-tertiary',
                )}
              >
                {done ? (
                  <Check className="h-4 w-4" />
                ) : active ? (
                  <Icon className="h-4 w-4 animate-pulse" />
                ) : (
                  <Icon className="h-4 w-4" />
                )}
              </div>
              <span
                className={cn(
                  'text-[11px] font-medium',
                  active || done ? 'text-theme-primary' : 'text-theme-tertiary',
                )}
              >
                {step.label}
              </span>
            </div>
            {i < PIPELINE_STEPS.length - 1 && (
              <div className="mx-2 -mt-5 h-0.5 flex-1 overflow-hidden rounded-full bg-theme-secondary/20">
                <div
                  className={cn(
                    'h-full rounded-full bg-cobalt-500 transition-all duration-500',
                    current > step.rank ? 'w-full' : 'w-0',
                  )}
                />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function ProgressView({
  job,
  onCancel,
}: {
  job: NonNullable<ReturnType<typeof useSyntheticGeneration>['job']>;
  onCancel: () => void;
}) {
  const variant = STATUS_VARIANT[job.status] === 'success' ? 'success' : 'default';
  return (
    <div className="space-y-4">
      <PipelineStepper status={job.status} />

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin text-cobalt-400" />
          <span className="text-sm font-medium text-theme-primary">{job.phase}</span>
        </div>
        <Badge variant={STATUS_VARIANT[job.status]} dot dotPulse>
          {job.status}
        </Badge>
      </div>

      <ProgressBar value={job.progress} variant={variant} showValue />

      <div className="grid grid-cols-2 gap-3 text-sm">
        <Stat label="Clips generated" value={`${job.generatedCount} / ${job.episodes}`} />
        <Stat label="Embodiment" value={job.embodiment} />
      </div>

      {/* Live console */}
      <div className="rounded-lg border border-theme-secondary/20 bg-black/40 p-3">
        <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-theme-tertiary">
          Generator log
        </p>
        <pre className="max-h-40 overflow-y-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-theme-secondary">
          {job.log.slice(-14).join('\n') || 'Waiting for output…'}
        </pre>
      </div>

      <p className="text-xs text-theme-tertiary">
        Closing this dialog keeps the job running — it will appear in your
        datasets when finished. Or{' '}
        <button onClick={onCancel} className="text-red-400 underline-offset-2 hover:underline">
          cancel it now
        </button>
        .
      </p>
    </div>
  );
}

function ResultView({
  datasetId,
  datasetName,
  episodes,
  camera,
}: {
  datasetId: string;
  datasetName?: string;
  episodes: number;
  /** Video key suffix of the dataset's camera (mode-dependent). */
  camera: string;
}) {
  const videoUrl = trainingApi.getEpisodeVideoUrl(datasetId, 0, camera);
  const [videoFailed, setVideoFailed] = useState(false);
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 rounded-lg border border-green-500/20 bg-green-500/5 p-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-green-500/15">
          <Check className="h-5 w-5 text-green-400" />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-medium text-theme-primary">
            {episodes} synthetic episode{episodes > 1 ? 's' : ''} ready
          </p>
          <p className="truncate text-xs text-theme-tertiary">{datasetName}</p>
        </div>
        <Badge variant="success" className="ml-auto shrink-0">
          Ready to train
        </Badge>
      </div>

      {/* Video preview */}
      <div>
        <p className="mb-1.5 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-theme-tertiary">
          <Film className="h-3.5 w-3.5" /> Preview · episode 0
        </p>
        <div className="overflow-hidden rounded-lg border border-theme-secondary/20 bg-black">
          {videoFailed ? (
            <div className="flex aspect-video w-full items-center justify-center bg-purple-500/5">
              <Sparkles className="h-7 w-7 text-purple-400/50" />
            </div>
          ) : (
            <video
              key={videoUrl}
              src={videoUrl}
              className="aspect-video w-full"
              controls
              autoPlay
              muted
              loop
              playsInline
              onError={() => setVideoFailed(true)}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function FailureView({
  job,
}: {
  job: NonNullable<ReturnType<typeof useSyntheticGeneration>['job']>;
}) {
  const failed = job.status === 'failed';
  return (
    <div className="space-y-3">
      <Notice
        tone={failed ? 'error' : 'warning'}
        icon={<AlertTriangle className="h-4 w-4" />}
      >
        {failed
          ? job.error || 'Generation failed.'
          : 'Generation was cancelled.'}
      </Notice>
      {job.log.length > 0 && (
        <pre className="max-h-32 overflow-y-auto whitespace-pre-wrap break-words rounded-lg border border-theme-secondary/20 bg-black/40 p-3 font-mono text-[11px] leading-relaxed text-theme-secondary">
          {job.log.slice(-12).join('\n')}
        </pre>
      )}
    </div>
  );
}

// ============================================================================
// Small UI helpers
// ============================================================================

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-theme-secondary/10 p-2.5">
      <p className="text-xs text-theme-tertiary">{label}</p>
      <p className="mt-0.5 font-medium text-theme-primary">{value}</p>
    </div>
  );
}

function Notice({
  tone,
  icon,
  children,
}: {
  tone: 'warning' | 'error';
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  const tones = {
    warning: 'border-yellow-500/30 bg-yellow-500/10 text-yellow-200',
    error: 'border-red-500/30 bg-red-500/10 text-red-200',
  };
  return (
    <div
      role="alert"
      className={cn('flex items-start gap-2 rounded-lg border p-3 text-sm', tones[tone])}
    >
      <span className="mt-0.5 shrink-0">{icon}</span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
