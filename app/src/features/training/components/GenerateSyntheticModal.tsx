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
import { AlertTriangle, Check, Database, Film, KeyRound, Loader2, Minus, Package, Plus, Sparkles } from 'lucide-react';
import {
  Button, FormField, KeyValueList, Modal, Panel, ProgressBar, StatusTag, Textarea, ToggleChip, confirm,
} from '@/shared/components/ui';
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

  // Cancelling stops GPU work that is already running, so it asks first.
  const askCancel = async () => {
    const ok = await confirm({
      title: 'Cancel generation?',
      description: 'The running job stops and the clips generated so far are discarded.',
      confirmLabel: 'Cancel generation',
      cancelLabel: 'Keep running',
      tone: 'danger',
    });
    if (ok) void cancel();
  };

  const handleClose = () => {
    if (!isGenerating) reset();
    onClose();
  };

  const blocked = !selected.available || (selected.requiresToken && !selected.hasToken);
  const showResult = job && !isGenerating;

  const footer = !job ? (
    <>
      <Button variant="ghost" onClick={handleClose}>Cancel</Button>
      <Button
        onClick={handleStart}
        isLoading={isStarting}
        loadingText="Starting…"
        disabled={blocked}
        leftIcon={<Sparkles className="h-4 w-4" strokeWidth={1.75} />}
        data-testid="start-generation"
      >
        Generate {episodes} episode{episodes > 1 ? 's' : ''}
      </Button>
    </>
  ) : isGenerating ? (
    <>
      <Button variant="ghost" onClick={onClose}>Run in background</Button>
      <Button variant="danger" onClick={() => void askCancel()}>Cancel generation</Button>
    </>
  ) : job.status === 'completed' && job.datasetId ? (
    <>
      <Button variant="ghost" onClick={reset}>Generate more</Button>
      <Button variant="secondary" onClick={() => onViewDataset?.(job.datasetId!)}>View episodes</Button>
      <Button onClick={handleClose}>Done</Button>
    </>
  ) : (
    <>
      <Button variant="ghost" onClick={handleClose}>Close</Button>
      <Button onClick={reset}>Try again</Button>
    </>
  );

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      size="lg"
      closeOnBackdrop={!isGenerating}
      title="Generate synthetic episodes"
      description="Generated episodes become a training-ready LeRobot dataset, tagged Synthetic."
      footer={footer}
    >
      <div className="flex flex-col gap-5">
        {/* Provenance: which model, which method */}
        <Panel variant="inset" padding="sm" className="flex items-start gap-3">
          <Sparkles className="mt-0.5 h-5 w-5 shrink-0 text-primary" strokeWidth={1.75} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="truncate text-sm font-medium text-ink-primary">{bannerUi.model}</p>
              <StatusTag tone="sim">{job?.embodiment ?? modeInfo(bannerMode).embodiment}</StatusTag>
            </div>
            <p className="mt-0.5 text-xs text-ink-tertiary">{bannerUi.method}</p>
          </div>
        </Panel>

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
        {job && isGenerating && <ProgressView job={job} />}
        {showResult && job.status === 'completed' && job.datasetId && (
          <ResultView
            datasetId={job.datasetId}
            datasetName={job.datasetName}
            episodes={job.episodes}
            camera={bannerMode === 'neural-trajectory' ? 'cam_right_high' : 'image_0'}
          />
        )}
        {showResult && (job.status === 'failed' || job.status === 'cancelled') && <FailureView job={job} />}
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
  mode, setMode, modeInfo, episodes, setEpisodes, maxEpisodes, prompt, setPrompt, selected, selectedUi, configLoading, error,
}: ConfigureViewProps) {
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium text-ink-primary">Generator mode</span>
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
                  'rounded-control border p-3 text-left transition-colors',
                  active ? 'border-primary/60 bg-primary/10' : 'border-line hover:border-line-strong',
                )}
              >
                <span className="flex items-center justify-between gap-2">
                  <span className={cn('text-sm font-medium', active ? 'text-ink-primary' : 'text-ink-secondary')}>{ui.title}</span>
                  <span className={cn('h-3.5 w-3.5 shrink-0 rounded-full border', active ? 'border-primary bg-primary' : 'border-line-strong')} />
                </span>
                <span className="mt-0.5 block text-xs text-ink-tertiary">{ui.subtitle}</span>
                <span className="mt-1 block truncate text-xs text-ink-tertiary">
                  {info.embodiment} · max {info.maxEpisodes} ep{info.requiresToken ? ' · HF token' : ''}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <FormField label="Episodes to generate" hint={`Est. ${selectedUi.estimate(episodes)} ${selectedUi.estimateNote} · max ${maxEpisodes} per run`}>
        <div className="flex items-center gap-3">
          <Button variant="secondary" size="sm" iconOnly aria-label="Fewer episodes" onClick={() => setEpisodes(episodes - 1)} disabled={episodes <= 1}>
            <Minus className="h-4 w-4" strokeWidth={1.75} />
          </Button>
          <input
            type="range"
            aria-label="Episodes to generate"
            min={1}
            max={maxEpisodes}
            value={episodes}
            onChange={(e) => setEpisodes(Number(e.target.value))}
            className="min-w-24 flex-1 cursor-pointer accent-primary"
          />
          <Button variant="secondary" size="sm" iconOnly aria-label="More episodes" onClick={() => setEpisodes(episodes + 1)} disabled={episodes >= maxEpisodes}>
            <Plus className="h-4 w-4" strokeWidth={1.75} />
          </Button>
          <span className="w-8 text-right text-base font-semibold tabular-nums text-ink-primary">{episodes}</span>
        </div>
      </FormField>

      <FormField label="Task description" aside="Optional" hint="Conditions the generated motion. Leave empty to cycle the default pick / place / reach prompts.">
        <Textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder={selectedUi.placeholder} rows={2} maxLength={2000} />
      </FormField>
      <div className="-mt-2 flex flex-wrap gap-1.5">
        {selectedUi.presets.map((preset) => {
          const active = prompt.trim() === preset;
          return (
            <ToggleChip key={preset} size="sm" active={active} onClick={() => setPrompt(active ? '' : preset)}>
              {preset}
            </ToggleChip>
          );
        })}
      </div>

      {!configLoading && !selected.available && (
        <Notice tone="error">
          Generator not found on the server. Check{' '}
          <code className="font-mono text-xs">{mode === 'forward-dynamics' ? 'server/curation/cosmos3_synth.py' : 'server/curation/neural_traj/'}</code>.
        </Notice>
      )}
      {!configLoading && selected.available && selected.requiresToken && !selected.hasToken && (
        <Notice tone="warning">
          No Hugging Face PRO token configured. Set <code className="font-mono text-xs">HF_TOKEN</code> on the server
          (or <code className="font-mono text-xs">scratch/cosmos3/.env</code>) to run generation.
        </Notice>
      )}
      {error && <Notice tone="error">{error}</Notice>}
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
    <ol className="flex items-center">
      {PIPELINE_STEPS.map((step, i) => {
        const done = current > step.rank;
        const active = current === step.rank;
        const Icon = done ? Check : step.icon;
        return (
          <li key={step.label} className="flex flex-1 items-center last:flex-none">
            <div className="flex flex-col items-center gap-1.5">
              <span
                className={cn(
                  'flex h-9 w-9 items-center justify-center rounded-full border transition-colors',
                  done && 'border-primary/40 bg-primary/10 text-primary',
                  active && 'border-primary bg-primary/15 text-primary',
                  !done && !active && 'border-line text-ink-tertiary',
                )}
              >
                <Icon className={cn('h-4 w-4', active && 'animate-pulse')} strokeWidth={1.75} />
              </span>
              <span className={cn('text-xs font-medium', active || done ? 'text-ink-primary' : 'text-ink-tertiary')}>{step.label}</span>
            </div>
            {i < PIPELINE_STEPS.length - 1 && (
              <div className="mx-2 -mt-5 h-0.5 flex-1 overflow-hidden rounded-full bg-line">
                <div className={cn('h-full rounded-full bg-primary transition-all duration-500', done ? 'w-full' : 'w-0')} />
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}

type Job = NonNullable<ReturnType<typeof useSyntheticGeneration>['job']>;

function ProgressView({ job }: { job: Job }) {
  return (
    <div className="flex flex-col gap-4">
      <PipelineStepper status={job.status} />
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-sm font-medium text-ink-primary">
          <Loader2 className="h-4 w-4 animate-spin text-primary" strokeWidth={1.75} />
          {job.phase}
        </span>
        <StatusTag status={job.status} dot pulse />
      </div>
      <ProgressBar value={job.progress} variant={job.status === 'completed' ? 'success' : 'default'} showValue />
      <KeyValueList
        items={[
          { label: 'Clips generated', value: `${job.generatedCount} / ${job.episodes}` },
          { label: 'Embodiment', value: job.embodiment },
        ]}
      />
      <LogBlock lines={job.log.slice(-14)} empty="Waiting for output…" />
      <p className="text-xs text-ink-tertiary">
        Closing this dialog keeps the job running — the dataset appears in the list when it finishes.
      </p>
    </div>
  );
}

function ResultView({ datasetId, datasetName, episodes, camera }: {
  datasetId: string;
  datasetName?: string;
  episodes: number;
  /** Video key suffix of the dataset's camera (mode-dependent). */
  camera: string;
}) {
  const videoUrl = trainingApi.getEpisodeVideoUrl(datasetId, 0, camera);
  const [videoFailed, setVideoFailed] = useState(false);
  return (
    <div className="flex flex-col gap-4">
      <Panel variant="inset" padding="sm" className="flex items-center gap-3">
        <Check className="h-5 w-5 shrink-0 text-signal-measured" strokeWidth={1.75} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-ink-primary">{episodes} synthetic episode{episodes > 1 ? 's' : ''} ready</p>
          <p className="truncate text-xs text-ink-tertiary">{datasetName}</p>
        </div>
        <StatusTag status="ready" dot />
      </Panel>
      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-ink-tertiary">Preview · episode 0</span>
        <div className="overflow-hidden rounded-panel border border-line bg-canvas">
          {videoFailed ? (
            <div className="flex aspect-video w-full items-center justify-center">
              <Sparkles className="h-7 w-7 text-ink-muted" strokeWidth={1.75} />
            </div>
          ) : (
            <video key={videoUrl} src={videoUrl} className="aspect-video w-full" controls autoPlay muted loop playsInline onError={() => setVideoFailed(true)} />
          )}
        </div>
      </div>
    </div>
  );
}

function FailureView({ job }: { job: Job }) {
  const failed = job.status === 'failed';
  return (
    <div className="flex flex-col gap-3">
      <Notice tone={failed ? 'error' : 'warning'}>{failed ? job.error || 'Generation failed.' : 'Generation was cancelled.'}</Notice>
      {job.log.length > 0 && <LogBlock lines={job.log.slice(-12)} />}
    </div>
  );
}

// ============================================================================
// Small UI helpers
// ============================================================================

function LogBlock({ lines, empty }: { lines: string[]; empty?: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-ink-tertiary">Generator log</span>
      <pre className="max-h-40 overflow-y-auto whitespace-pre-wrap break-words rounded-control border border-line bg-inset p-3 font-mono text-xs leading-relaxed text-ink-secondary">
        {lines.join('\n') || empty}
      </pre>
    </div>
  );
}

function Notice({ tone, children }: { tone: 'warning' | 'error'; children: React.ReactNode }) {
  const Icon = tone === 'error' ? AlertTriangle : KeyRound;
  return (
    <div
      role="alert"
      className={cn(
        'flex items-start gap-2 rounded-control border bg-inset p-3 text-sm text-ink-secondary',
        tone === 'error' ? 'border-signal-stopped/40' : 'border-signal-estimated/40',
      )}
    >
      <Icon className={cn('mt-0.5 h-4 w-4 shrink-0', tone === 'error' ? 'text-signal-stopped' : 'text-signal-estimated')} strokeWidth={1.75} />
      <div className="min-w-0">{children}</div>
    </div>
  );
}
