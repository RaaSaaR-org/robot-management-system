/**
 * @file SimulationPage.tsx
 * @description Simulation page — MuJoCo/Isaac Lab policy testing with 4 tabs
 * @feature simulation
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import {
  FlaskConical,
  Play,
  Briefcase,
  BarChart3,
  GitCompareArrows,
  Beaker,
  Cpu,
  AlertTriangle,
  Target,
  Footprints,
  Clock,
  ChevronDown,
  ChevronRight,
  GraduationCap,
  Eye,
  Timer,
  CheckCircle2,
  XCircle,
  Hash,
  Rocket,
  Workflow,
  MapPin,
  Boxes,
  CalendarDays,
} from 'lucide-react';
import { DemoFeaturePlaceholder } from '@/components/demo/DemoFeaturePlaceholder';
import { Tabs } from '@/shared/components/ui/Tabs';
import { Card } from '@/shared/components/ui/Card';
import { Badge } from '@/shared/components/ui/Badge';
import { Button } from '@/shared/components/ui/Button';
import { ProgressBar } from '@/shared/components/ui/ProgressBar';
import { EmptyState } from '@/shared/components/ui/EmptyState';
import { Spinner } from '@/shared/components/ui/Spinner';
import { InfoIcon } from '@/shared/components/ui/Tooltip';
import { NextStepBanner } from '@/shared/components/ui/NextStepBanner';
import { PipelineBreadcrumb } from '@/shared/components/ui/PipelineBreadcrumb';
import { simulationApi } from '../api/simulationApi';
import {
  useSimulationStore,
  selectScenes,
  selectScenesLoading,
  selectScenesError,
} from '../store';
import { getSimBackendMode } from '../types';
import type { SimJob, SimToRealComparison, SimScene } from '../types';
import { UI_DATE_LOCALE } from '@/shared/utils/format';

// ============================================================================
// GLOSSARY — hover-tooltip explanations for domain terms
// ============================================================================

const GLOSSARY = {
  simulation:
    'Running a robot policy against a virtual physics scene to evaluate its performance safely — no real hardware involved.',
  vla: 'Vision-Language-Action model. An AI policy that takes camera images + a text instruction, and outputs robot joint targets. Example: SmolVLA, pi0.5, GR00T.',
  mujoco:
    'An open-source physics simulator used for robotics research. Simulates contact, friction, and rigid-body dynamics at up to 500 Hz.',
  isaac:
    'NVIDIA\'s Isaac Lab — a GPU-accelerated simulation framework with domain randomization, useful for sim-to-real transfer training.',
  modelId:
    'Any label you want — a local tag to track which model this run used. Does NOT control which model is loaded. The VLA model itself is selected on the inference server side via VLA_MODEL_PATH.',
  backend:
    'Which physics simulator executes the scene. MuJoCo runs locally (fast, CPU). Isaac Lab requires a separate GPU process.',
  environment:
    'A pre-built scene (robot + task + objects). Each environment defines the robot, the objects to manipulate, and the success criterion.',
  scene:
    'A registered simulation scene. Built-in scenes ship with the platform; "scanned room" scenes are generated from a digital twin you captured with a robot. Selecting a scene resolves the physics backend and embodiment automatically.',
  rolloutCount:
    'How many independent attempts (episodes) to run. Each attempt randomizes the object start position. More rollouts = more reliable success rate estimate.',
  episode:
    'One complete attempt at the task, from reset to success or timeout. Each episode is independent.',
  step: 'One control tick — the policy outputs an action, physics advances. Control runs at 5 Hz (200 ms per step) with 100 physics sub-steps.',
  successRate:
    'Fraction of episodes where the robot completed the task (success criterion met before timeout). 100% = solved every attempt.',
  avgSteps:
    'Average number of control ticks before success or timeout (max 200). Lower = faster task completion. At the cap, the policy didn\'t finish in time.',
  collisions:
    'Number of contact events between the gripper and the object across all episodes. Some contact is expected (grasping!); excessive contact suggests the policy is bumping rather than grasping.',
  avgDuration:
    'Average wall-clock time per episode, including inference calls to the VLA server. Lower is faster.',
  simToReal:
    'The performance drop when moving a policy from simulation to real hardware. A small gap means the sim is well-calibrated.',
  frames:
    'Camera images captured at regular intervals during episodes. Exactly the pixels the VLA server received at each step.',
  chunkSize:
    'How many future actions the VLA predicts per inference call. Larger chunks mean fewer server calls (faster) but less reactive.',
} as const;

// ============================================================================
// HELPERS
// ============================================================================

const STATUS_BADGE_VARIANT: Record<SimJob['status'], 'warning' | 'cobalt' | 'success' | 'error'> = {
  queued: 'warning',
  running: 'cobalt',
  completed: 'success',
  failed: 'error',
};

/**
 * Backend honesty badge (TASK-184): warns when a job's results come from a
 * mock backend rather than a real simulator run. Hidden on old servers that
 * don't report the flag.
 */
function BackendModeBadge({ job }: { job: SimJob }) {
  const mode = getSimBackendMode(job);
  if (!mode) return null;
  return mode === 'mock' ? (
    <Badge variant="warning" size="sm">mock backend</Badge>
  ) : (
    <Badge variant="success" size="sm">real</Badge>
  );
}

function successVariant(rate: number): 'success' | 'warning' | 'error' {
  if (rate >= 0.8) return 'success';
  if (rate >= 0.5) return 'warning';
  return 'error';
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const m = Math.floor(seconds / 60);
  const s = (seconds % 60).toFixed(0);
  return `${m}m ${s}s`;
}

function formatRelativeTime(isoDate: string | Date): string {
  const date = typeof isoDate === 'string' ? new Date(isoDate) : isoDate;
  const diff = Date.now() - date.getTime();
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  return date.toLocaleDateString(UI_DATE_LOCALE);
}

/** Rough per-episode wall-clock estimate in seconds. Assumes ~35s per episode
 * for MuJoCo + remote VLA inference (empirically observed baseline). */
function estimateJobDurationSec(rolloutCount: number): number {
  return rolloutCount * 35;
}

/** Human-friendly interpretation of a success rate. */
function successInterpretation(rate: number): { label: string; detail: string; variant: 'success' | 'warning' | 'error' } {
  if (rate >= 0.8) {
    return {
      label: 'Strong performance',
      detail: 'The policy reliably solves this task. Ready to consider sim-to-real deployment.',
      variant: 'success',
    };
  }
  if (rate >= 0.5) {
    return {
      label: 'Partial performance',
      detail: 'The policy solves the task more often than not, but reliability is insufficient for deployment. Consider more training or fine-tuning.',
      variant: 'warning',
    };
  }
  if (rate > 0) {
    return {
      label: 'Weak performance',
      detail: 'The policy can occasionally solve the task. Likely needs more in-domain data or task-specific fine-tuning.',
      variant: 'error',
    };
  }
  return {
    label: 'No successes yet',
    detail:
      'The policy did not complete the task in any episode. Common causes: (1) model not trained on this exact scene, (2) sim-to-real gap in camera views or gripper dynamics, (3) action normalization mismatch. See the frame replay to inspect behavior.',
    variant: 'error',
  };
}

// ============================================================================
// EDUCATIONAL BANNER
// ============================================================================

function EducationBanner() {
  const [expanded, setExpanded] = useState(false);
  return (
    <Card variant="subtle" className="border border-cobalt-500/20">
      <button
        type="button"
        onClick={() => setExpanded((x) => !x)}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left"
      >
        <div className="flex items-center gap-3">
          <div className="p-1.5 rounded-brand bg-cobalt-500/10">
            <GraduationCap className="w-4 h-4 text-cobalt-400" />
          </div>
          <div>
            <div className="text-sm font-semibold text-theme-primary">
              How simulation evaluation works
            </div>
            <div className="text-xs text-theme-muted">
              {expanded ? 'Click to collapse' : 'New here? Click to learn the basics'}
            </div>
          </div>
        </div>
        {expanded ? (
          <ChevronDown className="w-4 h-4 text-theme-muted" />
        ) : (
          <ChevronRight className="w-4 h-4 text-theme-muted" />
        )}
      </button>
      {expanded && (
        <div className="px-4 pb-4 pt-1 space-y-3 text-sm text-theme-secondary leading-relaxed border-t border-glass-subtle">
          <p className="pt-3">
            <strong className="text-theme-primary">What this page does:</strong>{' '}
            Runs a <strong>VLA (Vision-Language-Action) model</strong> against a virtual robot scene and reports
            how often it completes the task. No real hardware is touched.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
            <div className="p-3 rounded-brand bg-glass-bg border border-glass-subtle">
              <div className="font-semibold text-theme-primary mb-1 flex items-center gap-1.5">
                <Eye className="w-3.5 h-3.5 text-cobalt-400" /> 1. Camera → VLA
              </div>
              <p className="text-theme-muted">
                The physics simulator renders the scene from a virtual camera. That image
                plus a task instruction ("pick up the red cube…") is sent to the VLA
                inference server.
              </p>
            </div>
            <div className="p-3 rounded-brand bg-glass-bg border border-glass-subtle">
              <div className="font-semibold text-theme-primary mb-1 flex items-center gap-1.5">
                <Cpu className="w-3.5 h-3.5 text-turquoise-400" /> 2. VLA → actions
              </div>
              <p className="text-theme-muted">
                The VLA outputs 6-DoF joint targets for the robot arm. Actions are
                clipped to safe joint ranges before being applied.
              </p>
            </div>
            <div className="p-3 rounded-brand bg-glass-bg border border-glass-subtle">
              <div className="font-semibold text-theme-primary mb-1 flex items-center gap-1.5">
                <Target className="w-3.5 h-3.5 text-cobalt-400" /> 3. Physics step
              </div>
              <p className="text-theme-muted">
                MuJoCo advances the simulation 200&nbsp;ms per action (100 sub-steps at
                500&nbsp;Hz). The new camera view feeds the next inference call — a
                closed loop.
              </p>
            </div>
            <div className="p-3 rounded-brand bg-glass-bg border border-glass-subtle">
              <div className="font-semibold text-theme-primary mb-1 flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5 text-turquoise-400" /> 4. Success?
              </div>
              <p className="text-theme-muted">
                An episode ends when the task is solved (e.g. cube within 5&nbsp;cm of
                target) or after 200 steps. Success rate = successes / rollouts.
              </p>
            </div>
          </div>
          <div className="text-xs text-theme-muted pt-1">
            <strong className="text-theme-secondary">Hover over any ⓘ icon</strong> on
            this page to learn what a specific field or metric means.
          </div>
        </div>
      )}
    </Card>
  );
}

// ============================================================================
// LAUNCH TAB
// ============================================================================

function SceneCard({
  scene,
  selected,
  onSelect,
}: {
  scene: SimScene;
  selected: boolean;
  onSelect: () => void;
}) {
  const isTwin = scene.source === 'twin';
  const previewUrl = scene.builtinEnvId ? simulationApi.getPreviewUrl(scene.builtinEnvId) : null;

  return (
    <button
      type="button"
      onClick={onSelect}
      className={`text-left rounded-brand-lg transition-all border overflow-hidden ${
        selected
          ? 'bg-cobalt-500/10 border-cobalt-500/30 ring-1 ring-cobalt-500/20'
          : 'glass-subtle border-glass-subtle hover:border-glass-highlight'
      }`}
    >
      {/* Preview: built-ins get a rendered preview image; twin rooms get a placeholder */}
      {previewUrl ? (
        <img
          src={previewUrl}
          alt={scene.name}
          className="w-full h-32 object-cover bg-glass-bg"
          loading="lazy"
          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
        />
      ) : (
        <div className="w-full h-32 flex items-center justify-center bg-cobalt-500/5 border-b border-glass-subtle">
          <Boxes className="w-10 h-10 text-cobalt-400/50" />
        </div>
      )}
      <div className="p-3">
        <div className="flex items-center justify-between gap-2 mb-1">
          <div className="flex items-center gap-2 min-w-0">
            {isTwin ? (
              <MapPin className="w-4 h-4 text-cobalt-400 shrink-0" />
            ) : (
              <Beaker className="w-4 h-4 text-cobalt-400 shrink-0" />
            )}
            <span className="text-sm font-medium text-theme-primary truncate">{scene.name}</span>
          </div>
          {isTwin && (
            <span className="shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-cobalt-500/15 text-cobalt-400 border border-cobalt-500/30">
              <MapPin className="w-3 h-3" />
              Scanned room
            </span>
          )}
        </div>
        {scene.description && (
          <p className="text-xs text-theme-muted leading-relaxed">{scene.description}</p>
        )}
        <div className="flex items-center gap-2 mt-2">
          <Badge variant="default" size="sm">{scene.backend === 'isaac' ? 'Isaac Lab' : 'MuJoCo'}</Badge>
          {isTwin && (
            <Badge variant="cobalt" size="sm">{scene.embodimentTag.toUpperCase()}</Badge>
          )}
        </div>
      </div>
    </button>
  );
}

function LaunchTab({
  onSubmit,
}: {
  onSubmit: () => void;
}) {
  const [searchParams] = useSearchParams();
  const scenes = useSimulationStore(selectScenes);
  const scenesLoading = useSimulationStore(selectScenesLoading);
  const scenesError = useSimulationStore(selectScenesError);
  const fetchScenes = useSimulationStore((s) => s.fetchScenes);
  const selectedSceneId = useSimulationStore((s) => s.selectedSceneId);
  const selectScene = useSimulationStore((s) => s.selectScene);

  const [modelId, setModelId] = useState('');
  const [rolloutCount, setRolloutCount] = useState(10);
  const [backend, setBackend] = useState<'mujoco' | 'isaac'>('mujoco');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch the scene registry on mount.
  useEffect(() => {
    void fetchScenes();
  }, [fetchScenes]);

  // Deep-link preselection: ?sceneId=... selects directly; ?twinId=... selects
  // the scene whose twinId matches (resolved once scenes have loaded).
  const deepLinkSceneId = searchParams.get('sceneId');
  const deepLinkTwinId = searchParams.get('twinId');
  useEffect(() => {
    if (scenes.length === 0) return;
    if (deepLinkSceneId) {
      const match = scenes.find((s) => s.id === deepLinkSceneId);
      if (match) {
        selectScene(match.id);
        setBackend(match.backend);
      }
      return;
    }
    if (deepLinkTwinId) {
      const match = scenes.find((s) => s.twinId === deepLinkTwinId);
      if (match) {
        selectScene(match.id);
        setBackend(match.backend);
      }
    }
    // Re-run only when the registry or deep-link changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scenes, deepLinkSceneId, deepLinkTwinId]);

  const selectedScene = useMemo(
    () => scenes.find((s) => s.id === selectedSceneId) ?? null,
    [scenes, selectedSceneId],
  );

  const filteredScenes = useMemo(
    () => scenes.filter((s) => s.backend === backend),
    [scenes, backend],
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedScene) return;
    setError(null);
    setSubmitting(true);
    try {
      // Scene-based submit: backend + embodiment resolved server-side.
      await simulationApi.submitJob({ modelId, sceneId: selectedScene.id, rolloutCount });
      setModelId('');
      selectScene(null);
      onSubmit();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit job');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {error && (
        <Card variant="subtle" className="!bg-red-500/10 border border-red-500/20">
          <div className="flex items-center gap-2 text-red-400 text-sm px-3 py-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            {error}
          </div>
        </Card>
      )}

      {/* Model ID */}
      <div>
        <label className="flex items-center gap-1.5 text-sm font-medium text-theme-secondary mb-2">
          Model ID
          <InfoIcon content={GLOSSARY.modelId} />
        </label>
        <input
          type="text"
          value={modelId}
          onChange={(e) => setModelId(e.target.value)}
          placeholder="e.g. smolvla-so101-v2"
          className="w-full px-4 py-3 rounded-brand border border-glass-subtle bg-glass-bg text-theme-primary placeholder:text-theme-muted focus:outline-none focus:ring-2 focus:ring-cobalt-500/50 focus:border-cobalt-500/50 transition-all"
          required
        />
        <p className="text-xs text-theme-muted mt-1.5">
          A label to help you find this run later. The actual model loaded by the VLA server
          is configured separately (via <code className="font-mono text-theme-secondary">VLA_MODEL_PATH</code>).
        </p>
      </div>

      {/* Backend toggle — filters the scene grid */}
      <div>
        <label className="flex items-center gap-1.5 text-sm font-medium text-theme-secondary mb-2">
          Backend
          <InfoIcon content={GLOSSARY.backend} />
        </label>
        <div className="flex gap-2">
          {(['mujoco', 'isaac'] as const).map((b) => (
            <button
              key={b}
              type="button"
              onClick={() => { setBackend(b); selectScene(null); }}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-brand text-sm font-medium transition-all ${
                backend === b
                  ? 'bg-cobalt-500/20 text-cobalt-400 border border-cobalt-500/30'
                  : 'glass-subtle text-theme-secondary hover:text-theme-primary border border-transparent'
              }`}
            >
              <Cpu className="w-4 h-4" />
              {b === 'isaac' ? 'Isaac Lab' : 'MuJoCo'}
            </button>
          ))}
        </div>
      </div>

      {/* Scene picker — built-in environments AND scanned-room twins */}
      <div>
        <label className="flex items-center gap-1.5 text-sm font-medium text-theme-secondary mb-2">
          Scene
          <InfoIcon content={GLOSSARY.scene} />
        </label>
        {scenesError && (
          <div className="text-red-400 text-sm py-2 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            {scenesError}
          </div>
        )}
        {scenesLoading && scenes.length === 0 ? (
          <div className="flex items-center gap-2 text-theme-muted text-sm py-4">
            <Spinner size="sm" color="cobalt" /> Loading scenes…
          </div>
        ) : filteredScenes.length === 0 ? (
          <div className="text-theme-muted text-sm py-4">
            No {backend === 'isaac' ? 'Isaac Lab' : 'MuJoCo'} scenes available. Scan a room in
            the Digital Twin to add one, or switch backends.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {filteredScenes.map((scene) => (
              <SceneCard
                key={scene.id}
                scene={scene}
                selected={selectedSceneId === scene.id}
                onSelect={() => selectScene(scene.id)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Rollout count */}
      <div>
        <div className="flex justify-between mb-2">
          <label className="flex items-center gap-1.5 text-sm font-medium text-theme-secondary">
            Rollout Count
            <InfoIcon content={GLOSSARY.rolloutCount} />
          </label>
          <span className="text-sm font-mono text-cobalt-400">{rolloutCount}</span>
        </div>
        <input
          type="range"
          min={1}
          max={100}
          step={1}
          value={rolloutCount}
          onChange={(e) => setRolloutCount(Number(e.target.value))}
          className="w-full accent-cobalt-500 h-2"
        />
        <div className="flex justify-between text-xs text-theme-muted mt-1">
          <span>1</span>
          <span>100</span>
        </div>
        <div className="mt-2 flex items-center gap-2 text-xs text-theme-muted">
          <Timer className="w-3.5 h-3.5" />
          <span>
            Estimated runtime:{' '}
            <span className="text-theme-secondary font-medium">
              ~{formatDuration(estimateJobDurationSec(rolloutCount))}
            </span>{' '}
            ({Math.round(estimateJobDurationSec(rolloutCount) / rolloutCount)}s per episode
            at max 200 steps)
          </span>
        </div>
      </div>

      {/* Submit */}
      <Button
        type="submit"
        variant="primary"
        size="lg"
        fullWidth
        isLoading={submitting}
        loadingText="Submitting..."
        disabled={!modelId || !selectedScene}
        leftIcon={<Play className="w-5 h-5" />}
      >
        Launch Simulation
      </Button>
      <p className="text-xs text-theme-muted text-center">
        The job runs asynchronously. You can close this tab — progress persists server-side.
      </p>
    </form>
  );
}

// ============================================================================
// JOB CARD
// ============================================================================

function JobCard({
  job,
  selected,
  onSelect,
}: {
  job: SimJob;
  selected: boolean;
  onSelect: () => void;
}) {
  const isRunning = job.status === 'running';
  const isCompleted = job.status === 'completed';

  return (
    <Card
      interactive
      onClick={onSelect}
      className={`transition-all ${selected ? 'ring-1 ring-cobalt-500/40' : ''}`}
    >
      <div className="flex items-start justify-between mb-3">
        <div>
          <h4 className="text-sm font-semibold text-theme-primary">{job.modelId}</h4>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-xs text-theme-muted">{job.environment}</span>
            {(job.backend === 'mujoco' || job.backend === 'isaac') && (
              <Badge variant="default" size="sm">{job.backend}</Badge>
            )}
            <BackendModeBadge job={job} />
          </div>
        </div>
        <Badge
          variant={STATUS_BADGE_VARIANT[job.status]}
          size="sm"
          dot
          dotPulse={isRunning}
        >
          {job.status}
        </Badge>
      </div>

      {/* Progress for running jobs */}
      {isRunning && (
        <ProgressBar
          value={job.progress}
          variant="default"
          showValue
          className="mb-3"
        />
      )}

      {/* Metrics for completed jobs */}
      {isCompleted && job.metrics && (
        <div className="grid grid-cols-3 gap-3 mt-2">
          <div>
            <div className="text-xs text-theme-muted">Success</div>
            <div className={`text-lg font-bold ${
              job.metrics.successRate >= 0.8 ? 'text-green-400' :
              job.metrics.successRate >= 0.5 ? 'text-yellow-400' : 'text-red-400'
            }`}>
              {(job.metrics.successRate * 100).toFixed(0)}%
            </div>
          </div>
          <div>
            <div className="text-xs text-theme-muted">Steps</div>
            <div className="text-lg font-bold text-theme-primary">
              {job.metrics.avgStepsToCompletion.toFixed(0)}
            </div>
          </div>
          <div>
            <div className="text-xs text-theme-muted">Collisions</div>
            <div className={`text-lg font-bold ${
              job.metrics.collisionCount > 3 ? 'text-red-400' : 'text-theme-primary'
            }`}>
              {job.metrics.collisionCount}
            </div>
          </div>
        </div>
      )}

      {/* Failure reason for failed jobs */}
      {job.status === 'failed' && job.failureReason && (
        <div className="flex items-start gap-2 mt-2 px-2.5 py-2 rounded-brand bg-red-500/10 border border-red-500/20">
          <AlertTriangle className="w-3.5 h-3.5 text-red-400 mt-0.5 shrink-0" />
          <span className="text-xs text-red-300 break-words">{job.failureReason}</span>
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between mt-3 pt-3 border-t border-glass-subtle">
        <span className="text-xs text-theme-muted font-mono" title={job.jobId}>
          {job.jobId.slice(0, 8)}
        </span>
        <div className="flex items-center gap-3 text-xs text-theme-muted">
          <span>{job.rolloutCount} {job.rolloutCount === 1 ? 'rollout' : 'rollouts'}</span>
          <span>•</span>
          <span title={new Date(job.createdAt).toLocaleString(UI_DATE_LOCALE)}>
            {formatRelativeTime(job.createdAt)}
          </span>
        </div>
      </div>
    </Card>
  );
}

// ============================================================================
// JOBS TAB
// ============================================================================

function JobsTab({
  jobs,
  loading,
  onSelect,
  selectedJobId,
}: {
  jobs: SimJob[];
  loading: boolean;
  onSelect: (job: SimJob) => void;
  selectedJobId: string | null;
}) {
  if (loading && jobs.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-theme-muted">
        <Spinner size="lg" color="cobalt" label="Loading jobs..." />
        <p className="mt-4 text-sm">Loading simulation jobs...</p>
      </div>
    );
  }

  if (jobs.length === 0) {
    return (
      <Card variant="subtle">
        <EmptyState
          icon={<Briefcase className="w-10 h-10" />}
          title="No simulation jobs yet"
          description={
            <>
              Go to the <strong>Launch</strong> tab, pick an environment, and hit{' '}
              <em>Launch Simulation</em> to run your first evaluation.
            </>
          }
        />
      </Card>
    );
  }

  const counts = {
    running: jobs.filter((j) => j.status === 'running').length,
    completed: jobs.filter((j) => j.status === 'completed').length,
    failed: jobs.filter((j) => j.status === 'failed').length,
    queued: jobs.filter((j) => j.status === 'queued').length,
  };

  return (
    <div className="space-y-4">
      {/* Summary bar */}
      <Card variant="subtle">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 text-sm">
          <div className="flex items-center gap-2">
            <Hash className="w-4 h-4 text-theme-muted" />
            <span className="text-theme-muted">Total:</span>
            <span className="font-semibold text-theme-primary">{jobs.length}</span>
          </div>
          {counts.running > 0 && (
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-cobalt-400 animate-pulse" />
              <span className="text-theme-secondary">{counts.running} running</span>
            </div>
          )}
          {counts.completed > 0 && (
            <div className="flex items-center gap-1.5 text-turquoise-400">
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>{counts.completed} completed</span>
            </div>
          )}
          {counts.failed > 0 && (
            <div className="flex items-center gap-1.5 text-red-400">
              <XCircle className="w-3.5 h-3.5" />
              <span>{counts.failed} failed</span>
            </div>
          )}
          {counts.queued > 0 && (
            <div className="flex items-center gap-1.5 text-yellow-400">
              <Clock className="w-3.5 h-3.5" />
              <span>{counts.queued} queued</span>
            </div>
          )}
          <div className="ml-auto text-xs text-theme-muted">
            Auto-refreshing every 3s
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {jobs.map((job) => (
          <JobCard
            key={job.jobId}
            job={job}
            selected={selectedJobId === job.jobId}
            onSelect={() => onSelect(job)}
          />
        ))}
      </div>
    </div>
  );
}

// ============================================================================
// FRAME VIEWER
// ============================================================================

function FrameViewer({ job }: { job: SimJob }) {
  const [selectedFrame, setSelectedFrame] = useState(0);
  const [selectedEpisode, setSelectedEpisode] = useState(1);

  const frames = job.frames ?? [];
  const episodes = useMemo(() => {
    const eps = [...new Set(frames.map((f) => f.episode))];
    return eps.sort((a, b) => a - b);
  }, [frames]);

  const episodeFrames = useMemo(
    () => frames.filter((f) => f.episode === selectedEpisode),
    [frames, selectedEpisode]
  );

  useEffect(() => {
    setSelectedFrame(0);
  }, [selectedEpisode]);

  if (frames.length === 0) return null;

  const currentFrame = episodeFrames[selectedFrame];

  return (
    <Card>
      <Card.Header>
        <div className="flex items-center justify-between gap-4">
          <div>
            <h3 className="text-base font-semibold text-theme-primary flex items-center gap-1.5">
              Episode Replay
              <InfoIcon content={GLOSSARY.frames} />
            </h3>
            <p className="text-xs text-theme-muted mt-0.5">
              These are the exact frames sent to the VLA server — click a timestamp to jump.
            </p>
          </div>
          {episodes.length > 1 && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-theme-muted">Episode:</span>
              <div className="flex gap-1">
                {episodes.map((ep) => (
                  <button
                    key={ep}
                    onClick={() => setSelectedEpisode(ep)}
                    className={`px-2.5 py-1 text-xs rounded-brand font-medium transition-all ${
                      selectedEpisode === ep
                        ? 'bg-cobalt-500/20 text-cobalt-400 border border-cobalt-500/30'
                        : 'glass-subtle text-theme-muted hover:text-theme-primary'
                    }`}
                  >
                    {ep}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </Card.Header>
      <Card.Body>
        {/* Main frame display */}
        {currentFrame && (
          <div className="mb-4">
            <img
              src={simulationApi.getFrameUrl(job.jobId, currentFrame.file)}
              alt={`Episode ${currentFrame.episode}, Step ${currentFrame.step}`}
              className="w-full max-w-2xl mx-auto rounded-brand-lg border border-glass-subtle"
              loading="lazy"
            />
            <div className="text-center mt-2 text-xs text-theme-muted">
              Step {currentFrame.step}
            </div>
          </div>
        )}

        {/* Thumbnail strip */}
        {episodeFrames.length > 1 && (
          <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
            {episodeFrames.map((frame, idx) => (
              <button
                key={frame.file}
                onClick={() => setSelectedFrame(idx)}
                className={`shrink-0 rounded-brand overflow-hidden border-2 transition-all ${
                  selectedFrame === idx
                    ? 'border-cobalt-500 ring-1 ring-cobalt-500/30'
                    : 'border-transparent opacity-60 hover:opacity-100'
                }`}
              >
                <img
                  src={simulationApi.getFrameUrl(job.jobId, frame.file)}
                  alt={`Step ${frame.step}`}
                  className="w-24 h-18 object-cover"
                  loading="lazy"
                />
                <div className="text-center text-[10px] text-theme-muted py-0.5 glass-subtle">
                  t={frame.step}
                </div>
              </button>
            ))}
          </div>
        )}
      </Card.Body>
    </Card>
  );
}

// ============================================================================
// RESULTS TAB
// ============================================================================

function ResultsTab({ job }: { job: SimJob | null }) {
  if (!job) {
    return (
      <Card variant="subtle" className="py-12">
        <div className="flex flex-col items-center justify-center text-theme-muted">
          <BarChart3 className="w-12 h-12 mb-4 opacity-30" />
          <p className="text-sm font-medium text-theme-secondary">No job selected</p>
          <p className="text-xs mt-1 max-w-sm text-center">
            Open the <strong>Jobs</strong> tab and click a completed job to view its success
            rate, metrics, and frame-by-frame replay here.
          </p>
        </div>
      </Card>
    );
  }

  if (!job.metrics) {
    return (
      <Card variant="subtle" className="py-12">
        <div className="flex flex-col items-center justify-center text-theme-muted">
          <Spinner size="lg" color="cobalt" />
          <p className="mt-4 text-sm text-theme-secondary">
            Job <span className="font-mono text-theme-primary">{job.jobId.slice(0, 8)}</span> is{' '}
            {job.status}…
          </p>
          <p className="text-xs mt-1">
            Results appear automatically once the evaluation finishes.
          </p>
        </div>
      </Card>
    );
  }

  const { metrics } = job;
  const rate = metrics.successRate;
  const interp = successInterpretation(rate);
  const extended = metrics as typeof metrics & {
    totalEpisodes?: number;
    successfulEpisodes?: number;
  };
  const successfulCount = extended.successfulEpisodes;
  const totalCount = extended.totalEpisodes ?? job.rolloutCount;
  const atTimeoutCap = metrics.avgStepsToCompletion >= 200;

  return (
    <div className="space-y-6">
      {/* Hero success rate */}
      <Card className="text-center py-8">
        <div className="text-sm text-theme-muted mb-2 flex items-center justify-center gap-1.5">
          Success Rate
          <InfoIcon content={GLOSSARY.successRate} />
        </div>
        <div className={`text-6xl font-bold tracking-tight ${
          rate >= 0.8 ? 'text-green-400' : rate >= 0.5 ? 'text-yellow-400' : 'text-red-400'
        }`}>
          {(rate * 100).toFixed(1)}%
        </div>
        {successfulCount !== undefined && (
          <div className="mt-1 text-sm text-theme-muted">
            {successfulCount} of {totalCount} episodes solved
          </div>
        )}
        <ProgressBar
          value={rate * 100}
          variant={successVariant(rate)}
          showValue={false}
          className="max-w-xs mx-auto mt-4"
        />
        <div className="mt-3 text-xs text-theme-muted">
          {job.modelId} on {job.environment}
        </div>
      </Card>

      {/* Interpretation panel */}
      <Card
        variant="subtle"
        className={`border ${
          interp.variant === 'success'
            ? 'border-green-500/20 !bg-green-500/5'
            : interp.variant === 'warning'
            ? 'border-yellow-500/20 !bg-yellow-500/5'
            : 'border-red-500/20 !bg-red-500/5'
        }`}
      >
        <div className="px-4 py-3">
          <div className="flex items-start gap-3">
            <div
              className={`p-1.5 rounded-brand shrink-0 ${
                interp.variant === 'success'
                  ? 'bg-green-500/10'
                  : interp.variant === 'warning'
                  ? 'bg-yellow-500/10'
                  : 'bg-red-500/10'
              }`}
            >
              {interp.variant === 'success' ? (
                <CheckCircle2 className="w-4 h-4 text-green-400" />
              ) : (
                <AlertTriangle
                  className={`w-4 h-4 ${
                    interp.variant === 'warning' ? 'text-yellow-400' : 'text-red-400'
                  }`}
                />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold text-theme-primary">{interp.label}</div>
              <p className="text-xs text-theme-secondary mt-1 leading-relaxed">{interp.detail}</p>
              {atTimeoutCap && rate < 1 && (
                <p className="text-xs text-theme-muted mt-2 leading-relaxed">
                  ⚠ Average steps is at the 200-step cap — most episodes timed out rather
                  than finishing. Watch the frame replay below to see where the policy got stuck.
                </p>
              )}
            </div>
          </div>
        </div>
      </Card>

      {/* Metric cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-brand bg-cobalt-500/10">
              <Footprints className="w-5 h-5 text-cobalt-400" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-xs text-theme-muted flex items-center gap-1.5">
                Avg Steps
                <InfoIcon content={GLOSSARY.avgSteps} />
              </div>
              <div className="text-2xl font-bold text-theme-primary">
                {metrics.avgStepsToCompletion.toFixed(0)}
                <span className="text-xs text-theme-muted font-normal ml-1">/ 200</span>
              </div>
            </div>
          </div>
        </Card>

        <Card>
          <div className="flex items-center gap-3">
            <div className={`p-2.5 rounded-brand ${
              metrics.collisionCount > 3 ? 'bg-red-500/10' : 'bg-turquoise-500/10'
            }`}>
              {metrics.collisionCount > 3
                ? <AlertTriangle className="w-5 h-5 text-red-400" />
                : <Target className="w-5 h-5 text-turquoise-400" />
              }
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-xs text-theme-muted flex items-center gap-1.5">
                Collisions
                <InfoIcon content={GLOSSARY.collisions} />
              </div>
              <div className={`text-2xl font-bold ${
                metrics.collisionCount > 3 ? 'text-red-400' : 'text-theme-primary'
              }`}>
                {metrics.collisionCount}
              </div>
            </div>
          </div>
        </Card>

        <Card>
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-brand bg-turquoise-500/10">
              <Clock className="w-5 h-5 text-turquoise-400" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-xs text-theme-muted flex items-center gap-1.5">
                Avg Duration
                <InfoIcon content={GLOSSARY.avgDuration} />
              </div>
              <div className="text-2xl font-bold text-theme-primary">
                {formatDuration(metrics.avgEpisodeDuration)}
              </div>
            </div>
          </div>
        </Card>
      </div>

      {/* Frame viewer */}
      {job.frames && job.frames.length > 0 && (
        <FrameViewer job={job} />
      )}

      {/* Job metadata */}
      <Card variant="subtle">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 px-4 py-3 text-sm">
          <div>
            <span className="block text-xs text-theme-muted">Model</span>
            <span className="text-theme-secondary font-mono text-xs">{job.modelId}</span>
          </div>
          <div>
            <span className="block text-xs text-theme-muted">Environment</span>
            <span className="text-theme-secondary">{job.environment}</span>
          </div>
          <div>
            <span className="block text-xs text-theme-muted">Backend</span>
            <span className="inline-flex items-center gap-1.5">
              {(job.backend === 'mujoco' || job.backend === 'isaac') && (
                <Badge variant="default" size="sm">{job.backend}</Badge>
              )}
              <BackendModeBadge job={job} />
            </span>
          </div>
          <div>
            <span className="block text-xs text-theme-muted">Rollouts</span>
            <span className="text-theme-secondary">{job.rolloutCount}</span>
          </div>
        </div>
      </Card>

      {/* Next-step CTA: only suggest deploy when sim shows real success */}
      {rate >= 0.5 ? (
        <NextStepBanner
          title="Happy with this result? Ship it."
          description={`Success rate is ${(rate * 100).toFixed(0)}% — ready to canary-deploy to the fleet.`}
          ctaLabel="Deploy model"
          ctaHref="/deployments"
          icon={<Rocket className="w-4 h-4" />}
        />
      ) : (
        <NextStepBanner
          title="Not ready for deployment yet"
          description="Low success rate — collect more demos or fine-tune before shipping to real robots."
          ctaLabel="Back to pipeline"
          ctaHref="/pipeline"
          icon={<Workflow className="w-4 h-4" />}
          variant="subtle"
        />
      )}
    </div>
  );
}

// ============================================================================
// SIM VS REAL TAB
// ============================================================================

/** Variant for a gap badge: small gap (<=10pp) is good, large is concerning. */
function gapBadgeVariant(gap: number): 'success' | 'warning' | 'error' {
  const pp = Math.abs(gap) * 100;
  if (pp <= 10) return 'success';
  if (pp <= 25) return 'warning';
  return 'error';
}

function SimVsRealTab() {
  const [modelId, setModelId] = useState('');
  const [comparisons, setComparisons] = useState<SimToRealComparison[]>([]);
  const [hasFetched, setHasFetched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchComparison = async () => {
    if (!modelId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await simulationApi.getComparison(modelId);
      setComparisons(data);
      setHasFetched(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch comparison');
    } finally {
      setLoading(false);
    }
  };

  const chartData = comparisons.map((c, i) => ({
    name: c.twinId ? 'Scanned room' : c.simSceneId ? `Scene ${i + 1}` : `Env ${i + 1}`,
    Simulation: Math.round(c.simSuccessRate * 100),
    'Real World': Math.round(c.realSuccessRate * 100),
    gap: Math.round(c.gap * 100),
  }));

  return (
    <div className="space-y-6">
      {/* Search bar */}
      <div className="flex gap-3 items-end">
        <div className="flex-1 max-w-sm">
          <label className="block text-sm font-medium text-theme-secondary mb-2">Model ID</label>
          <input
            type="text"
            value={modelId}
            onChange={(e) => setModelId(e.target.value)}
            placeholder="e.g. smolvla-so101-v2"
            className="w-full px-4 py-3 rounded-brand border border-glass-subtle bg-glass-bg text-theme-primary placeholder:text-theme-muted focus:outline-none focus:ring-2 focus:ring-cobalt-500/50 focus:border-cobalt-500/50 transition-all"
            onKeyDown={(e) => e.key === 'Enter' && fetchComparison()}
          />
        </div>
        <Button
          onClick={fetchComparison}
          variant="primary"
          size="md"
          isLoading={loading}
          loadingText="Comparing..."
          disabled={!modelId}
          leftIcon={<GitCompareArrows className="w-4 h-4" />}
        >
          Compare
        </Button>
      </div>

      {error && (
        <Card variant="subtle" className="!bg-red-500/10 border border-red-500/20">
          <div className="flex items-center gap-2 text-red-400 text-sm px-3 py-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            {error}
          </div>
        </Card>
      )}

      {/* Initial prompt — before any fetch */}
      {!hasFetched && !loading && comparisons.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-theme-muted">
          <GitCompareArrows className="w-12 h-12 mb-4 opacity-30" />
          <p className="text-sm">Enter a Model ID and compare to see sim-to-real gap analysis.</p>
        </div>
      )}

      {/* Not-yet-validated empty state — fetched, but no real-robot measurements */}
      {hasFetched && !loading && comparisons.length === 0 && (
        <Card variant="subtle" className="border border-cobalt-500/20 !bg-cobalt-500/5">
          <div className="flex flex-col items-center justify-center py-12 px-6 text-center">
            <div className="p-3 rounded-brand bg-cobalt-500/10 mb-4">
              <GitCompareArrows className="w-8 h-8 text-cobalt-400" />
            </div>
            <p className="text-sm font-semibold text-theme-primary">
              Not validated against a real robot yet
            </p>
            <p className="text-xs text-theme-muted mt-1.5 max-w-md leading-relaxed">
              No sim-to-real validation has been recorded for{' '}
              <span className="font-mono text-theme-secondary">{modelId}</span>. The gap is only
              shown once a real-robot test run is logged against a sim scene — there is no
              estimated or synthetic gap here.
            </p>
          </div>
        </Card>
      )}

      {loading && comparisons.length === 0 && (
        <div className="flex justify-center py-16">
          <Spinner size="lg" color="cobalt" label="Fetching comparison..." />
        </div>
      )}

      {chartData.length > 0 && (
        <Card>
          <Card.Header>
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-base font-semibold text-theme-primary">Sim vs Real Success Rate</h3>
                <p className="text-xs text-theme-muted mt-0.5">
                  Measured from logged real-robot test runs — not an estimate.
                </p>
              </div>
              {comparisons.length > 0 && (
                <Badge variant={gapBadgeVariant(comparisons[0].gap)} size="sm">
                  Gap: {comparisons[0].gap > 0 ? '+' : ''}{(comparisons[0].gap * 100).toFixed(0)}%
                </Badge>
              )}
            </div>
          </Card.Header>
          <Card.Body>
            <ResponsiveContainer width="100%" height={320}>
              <BarChart data={chartData} barGap={8}>
                <defs>
                  <linearGradient id="simGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#2A5FFF" stopOpacity={0.9} />
                    <stop offset="100%" stopColor="#2A5FFF" stopOpacity={0.5} />
                  </linearGradient>
                  <linearGradient id="realGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#18E4C3" stopOpacity={0.9} />
                    <stop offset="100%" stopColor="#18E4C3" stopOpacity={0.5} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis
                  dataKey="name"
                  tick={{ fill: 'var(--text-muted)', fontSize: 12 }}
                  axisLine={{ stroke: 'rgba(255,255,255,0.08)' }}
                />
                <YAxis
                  domain={[0, 100]}
                  tickFormatter={(v: number) => `${v}%`}
                  tick={{ fill: 'var(--text-muted)', fontSize: 12 }}
                  axisLine={{ stroke: 'rgba(255,255,255,0.08)' }}
                />
                <Tooltip
                  formatter={(value: number | undefined) => value != null ? `${value}%` : '—'}
                  contentStyle={{
                    backgroundColor: 'var(--glass-bg)',
                    border: '1px solid var(--glass-border)',
                    borderRadius: '8px',
                    backdropFilter: 'blur(12px)',
                  }}
                  labelStyle={{ color: 'var(--text-secondary)' }}
                />
                <Legend
                  wrapperStyle={{ fontSize: 12, color: 'var(--text-muted)' }}
                />
                <Bar dataKey="Simulation" fill="url(#simGradient)" radius={[6, 6, 0, 0]} />
                <Bar dataKey="Real World" fill="url(#realGradient)" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </Card.Body>
        </Card>
      )}

      {/* Per-validation context — the measured rows behind the chart */}
      {comparisons.length > 0 && (
        <Card variant="subtle">
          <Card.Body>
            <ul className="divide-y divide-glass-subtle">
              {comparisons.map((c, i) => (
                <li
                  key={c.simSceneId ?? c.twinId ?? `row-${i}`}
                  className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3 first:pt-0 last:pb-0"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    {c.twinId ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-cobalt-500/15 text-cobalt-400 border border-cobalt-500/30">
                        <MapPin className="w-3 h-3" />
                        Scanned room
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium glass-subtle text-theme-secondary border border-glass-subtle">
                        <Beaker className="w-3 h-3" />
                        Built-in scene
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-4 text-xs">
                    <span className="text-theme-muted">
                      Sim{' '}
                      <span className="font-mono text-theme-secondary">
                        {(c.simSuccessRate * 100).toFixed(0)}%
                      </span>
                    </span>
                    <span className="text-theme-muted">
                      Real{' '}
                      <span className="font-mono text-theme-secondary">
                        {(c.realSuccessRate * 100).toFixed(0)}%
                      </span>
                    </span>
                    <Badge variant={gapBadgeVariant(c.gap)} size="sm">
                      gap {c.gap > 0 ? '+' : ''}{(c.gap * 100).toFixed(0)}%
                    </Badge>
                  </div>

                  <div className="flex items-center gap-4 text-xs text-theme-muted ml-auto">
                    {c.realTestCount != null && (
                      <span className="flex items-center gap-1">
                        <Hash className="w-3 h-3" />
                        n={c.realTestCount} real {c.realTestCount === 1 ? 'episode' : 'episodes'}
                      </span>
                    )}
                    {c.validationDate && (
                      <span
                        className="flex items-center gap-1"
                        title={new Date(c.validationDate).toLocaleString(UI_DATE_LOCALE)}
                      >
                        <CalendarDays className="w-3 h-3" />
                        {formatRelativeTime(c.validationDate)}
                      </span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </Card.Body>
        </Card>
      )}
    </div>
  );
}

// ============================================================================
// MAIN PAGE
// ============================================================================

export function SimulationPage() {
  if (import.meta.env.VITE_DEMO_MODE === 'true') {
    return (
      <DemoFeaturePlaceholder
        featureName="Simulation Environment"
        icon={<FlaskConical className="w-12 h-12" />}
        description="Test robot behaviors and AI models in a physics-accurate simulation before deploying to real hardware."
        capabilities={[
          "Import real-world maps and environments",
          "Simulate H1, SO-101, G1 robot kinematics",
          "Run VLA model inference against simulated sensors",
          "A/B test model variants without hardware risk",
        ]}
        docsSlug="VLA-integration-guide"
      />
    );
  }

  return <SimulationPageInner />;
}

function SimulationPageInner() {
  // The Launch tab is the default landing tab; deep-links (?sceneId / ?twinId)
  // are read inside LaunchTab to preselect a scene.
  const [activeTab, setActiveTab] = useState('launch');
  const [jobs, setJobs] = useState<SimJob[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedJob, setSelectedJob] = useState<SimJob | null>(null);

  const fetchJobs = useCallback(async () => {
    setLoading(true);
    try {
      const data = await simulationApi.listJobs();
      setJobs(data);
    } catch (err) {
      console.error('[SimulationPage] Failed to fetch jobs:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchJobs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-refresh jobs every 3s when on jobs tab
  useEffect(() => {
    if (activeTab !== 'jobs') return;
    const interval = setInterval(fetchJobs, 3000);
    return () => clearInterval(interval);
  }, [activeTab, fetchJobs]);

  const handleJobSelect = (job: SimJob) => {
    setSelectedJob(job);
    if (job.metrics) {
      setActiveTab('results');
    }
  };

  const runningCount = jobs.filter((j) => j.status === 'running').length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <header>
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3 mb-1">
            <div className="p-2 rounded-brand bg-cobalt-500/10">
              <FlaskConical className="w-6 h-6 text-cobalt-400" />
            </div>
            <div>
              {/* Embedded as a tab inside TrainingPage — that page owns the h1 */}
              <h2 className="text-lg font-semibold text-theme-primary">Simulation</h2>
              <p className="text-sm text-theme-muted">
                MuJoCo / Isaac Lab policy testing and sim-to-real analysis
              </p>
            </div>
          </div>
          <PipelineBreadcrumb stage="evaluate" />
        </div>
      </header>

      {/* Educational banner (collapsed by default) */}
      <EducationBanner />

      {/* Tabs */}
      <Tabs
        activeTab={activeTab}
        onTabChange={setActiveTab}
        tabs={[
          {
            id: 'launch',
            label: 'Launch',
            icon: <Play className="w-4 h-4" />,
            content: (
              <Card>
                <LaunchTab
                  onSubmit={() => {
                    fetchJobs();
                    setActiveTab('jobs');
                  }}
                />
              </Card>
            ),
          },
          {
            id: 'jobs',
            label: runningCount > 0 ? `Jobs (${runningCount})` : 'Jobs',
            icon: <Briefcase className="w-4 h-4" />,
            content: (
              <JobsTab
                jobs={jobs}
                loading={loading}
                onSelect={handleJobSelect}
                selectedJobId={selectedJob?.jobId ?? null}
              />
            ),
          },
          {
            id: 'results',
            label: 'Results',
            icon: <BarChart3 className="w-4 h-4" />,
            content: <ResultsTab job={selectedJob} />,
          },
          {
            id: 'sim-vs-real',
            label: 'Sim vs Real',
            icon: <GitCompareArrows className="w-4 h-4" />,
            content: <SimVsRealTab />,
          },
        ]}
      />
    </div>
  );
}
