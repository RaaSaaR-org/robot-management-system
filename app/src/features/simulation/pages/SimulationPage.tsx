/**
 * @file SimulationPage.tsx
 * @description Simulation page — MuJoCo/Isaac Lab policy testing with 4 tabs
 * @feature simulation
 */

import { useState, useEffect, useCallback } from 'react';
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
} from 'lucide-react';
import { DemoFeaturePlaceholder } from '@/components/demo/DemoFeaturePlaceholder';
import { Tabs } from '@/shared/components/ui/Tabs';
import { Card } from '@/shared/components/ui/Card';
import { Badge } from '@/shared/components/ui/Badge';
import { Button } from '@/shared/components/ui/Button';
import { ProgressBar } from '@/shared/components/ui/ProgressBar';
import { Spinner } from '@/shared/components/ui/Spinner';
import { simulationApi } from '../api/simulationApi';
import type { SimJob, SimEnvironment, SimToRealComparison } from '../types';

// ============================================================================
// HELPERS
// ============================================================================

const STATUS_BADGE_VARIANT: Record<SimJob['status'], 'warning' | 'cobalt' | 'success' | 'error'> = {
  queued: 'warning',
  running: 'cobalt',
  completed: 'success',
  failed: 'error',
};

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

// ============================================================================
// LAUNCH TAB
// ============================================================================

function LaunchTab({
  environments,
  onSubmit,
}: {
  environments: SimEnvironment[];
  onSubmit: () => void;
}) {
  const [modelId, setModelId] = useState('');
  const [environment, setEnvironment] = useState('');
  const [rolloutCount, setRolloutCount] = useState(10);
  const [backend, setBackend] = useState<'mujoco' | 'isaac'>('mujoco');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await simulationApi.submitJob({ modelId, environment, rolloutCount, backend });
      setModelId('');
      setEnvironment('');
      onSubmit();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit job');
    } finally {
      setSubmitting(false);
    }
  };

  const filteredEnvs = environments.filter((env) =>
    backend === 'mujoco' ? env.backend === 'mujoco' : env.backend === 'isaac'
  );

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
        <label className="block text-sm font-medium text-theme-secondary mb-2">Model ID</label>
        <input
          type="text"
          value={modelId}
          onChange={(e) => setModelId(e.target.value)}
          placeholder="e.g. smolvla-so101-v2"
          className="w-full px-4 py-3 rounded-brand border border-glass-subtle bg-glass-bg text-theme-primary placeholder:text-theme-muted focus:outline-none focus:ring-2 focus:ring-cobalt-500/50 focus:border-cobalt-500/50 transition-all"
          required
        />
      </div>

      {/* Backend toggle */}
      <div>
        <label className="block text-sm font-medium text-theme-secondary mb-2">Backend</label>
        <div className="flex gap-2">
          {(['mujoco', 'isaac'] as const).map((b) => (
            <button
              key={b}
              type="button"
              onClick={() => { setBackend(b); setEnvironment(''); }}
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

      {/* Environment selection as cards */}
      <div>
        <label className="block text-sm font-medium text-theme-secondary mb-2">Environment</label>
        {filteredEnvs.length === 0 ? (
          <div className="text-theme-muted text-sm py-4">No environments available for {backend}.</div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {filteredEnvs.map((env) => (
              <button
                key={env.id}
                type="button"
                onClick={() => setEnvironment(env.id)}
                className={`text-left p-4 rounded-brand-lg transition-all border ${
                  environment === env.id
                    ? 'bg-cobalt-500/10 border-cobalt-500/30 ring-1 ring-cobalt-500/20'
                    : 'glass-subtle border-glass-subtle hover:border-glass-highlight'
                }`}
              >
                <div className="flex items-center gap-2 mb-1">
                  <Beaker className="w-4 h-4 text-cobalt-400" />
                  <span className="text-sm font-medium text-theme-primary">{env.name}</span>
                </div>
                <p className="text-xs text-theme-muted leading-relaxed">{env.description}</p>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Rollout count */}
      <div>
        <div className="flex justify-between mb-2">
          <label className="text-sm font-medium text-theme-secondary">Rollout Count</label>
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
      </div>

      {/* Submit */}
      <Button
        type="submit"
        variant="primary"
        size="lg"
        fullWidth
        isLoading={submitting}
        loadingText="Submitting..."
        disabled={!modelId || !environment}
        leftIcon={<Play className="w-5 h-5" />}
      >
        Launch Simulation
      </Button>
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
            <Badge variant="default" size="sm">{job.backend}</Badge>
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

      {/* Footer */}
      <div className="flex items-center justify-between mt-3 pt-3 border-t border-glass-subtle">
        <span className="text-xs text-theme-muted font-mono">{job.jobId.slice(0, 8)}</span>
        <span className="text-xs text-theme-muted">{job.rolloutCount} rollouts</span>
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
      <div className="flex flex-col items-center justify-center py-16 text-theme-muted">
        <Briefcase className="w-12 h-12 mb-4 opacity-30" />
        <p className="text-sm">No simulation jobs yet.</p>
        <p className="text-xs mt-1">Launch one from the Launch tab to get started.</p>
      </div>
    );
  }

  return (
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
  );
}

// ============================================================================
// RESULTS TAB
// ============================================================================

function ResultsTab({ job }: { job: SimJob | null }) {
  if (!job) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-theme-muted">
        <BarChart3 className="w-12 h-12 mb-4 opacity-30" />
        <p className="text-sm">Select a completed job to view results.</p>
      </div>
    );
  }

  if (!job.metrics) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-theme-muted">
        <Spinner size="lg" color="cobalt" />
        <p className="mt-4 text-sm">
          Job <span className="font-mono text-theme-secondary">{job.jobId.slice(0, 8)}</span> is still {job.status}...
        </p>
      </div>
    );
  }

  const { metrics } = job;
  const rate = metrics.successRate;

  return (
    <div className="space-y-6">
      {/* Hero success rate */}
      <Card className="text-center py-8">
        <div className="text-sm text-theme-muted mb-2">Success Rate</div>
        <div className={`text-6xl font-bold tracking-tight ${
          rate >= 0.8 ? 'text-green-400' : rate >= 0.5 ? 'text-yellow-400' : 'text-red-400'
        }`}>
          {(rate * 100).toFixed(1)}%
        </div>
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

      {/* Metric cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-brand bg-cobalt-500/10">
              <Footprints className="w-5 h-5 text-cobalt-400" />
            </div>
            <div>
              <div className="text-xs text-theme-muted">Avg Steps</div>
              <div className="text-2xl font-bold text-theme-primary">
                {metrics.avgStepsToCompletion.toFixed(0)}
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
            <div>
              <div className="text-xs text-theme-muted">Collisions</div>
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
            <div>
              <div className="text-xs text-theme-muted">Avg Duration</div>
              <div className="text-2xl font-bold text-theme-primary">
                {formatDuration(metrics.avgEpisodeDuration)}
              </div>
            </div>
          </div>
        </Card>
      </div>

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
            <Badge variant="default" size="sm">{job.backend}</Badge>
          </div>
          <div>
            <span className="block text-xs text-theme-muted">Rollouts</span>
            <span className="text-theme-secondary">{job.rolloutCount}</span>
          </div>
        </div>
      </Card>
    </div>
  );
}

// ============================================================================
// SIM VS REAL TAB
// ============================================================================

function SimVsRealTab() {
  const [modelId, setModelId] = useState('');
  const [comparisons, setComparisons] = useState<SimToRealComparison[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchComparison = async () => {
    if (!modelId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await simulationApi.getComparison(modelId);
      setComparisons(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch comparison');
    } finally {
      setLoading(false);
    }
  };

  const chartData = comparisons.map((c, i) => ({
    name: `Env ${i + 1}`,
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

      {comparisons.length === 0 && !loading && (
        <div className="flex flex-col items-center justify-center py-16 text-theme-muted">
          <GitCompareArrows className="w-12 h-12 mb-4 opacity-30" />
          <p className="text-sm">Enter a Model ID and compare to see sim-to-real gap analysis.</p>
        </div>
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
              <h3 className="text-base font-semibold text-theme-primary">Sim vs Real Success Rate</h3>
              {comparisons.length > 0 && (
                <Badge variant="warning" size="sm">
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
  const [activeTab, setActiveTab] = useState('launch');
  const [jobs, setJobs] = useState<SimJob[]>([]);
  const [environments, setEnvironments] = useState<SimEnvironment[]>([]);
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

  const fetchEnvironments = useCallback(async () => {
    try {
      const data = await simulationApi.getEnvironments();
      setEnvironments(data);
    } catch (err) {
      console.error('[SimulationPage] Failed to fetch environments:', err);
    }
  }, []);

  useEffect(() => {
    fetchJobs();
    fetchEnvironments();
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
        <div className="flex items-center gap-3 mb-1">
          <div className="p-2 rounded-brand bg-cobalt-500/10">
            <FlaskConical className="w-6 h-6 text-cobalt-400" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-theme-primary">Simulation</h1>
            <p className="text-sm text-theme-muted">
              MuJoCo / Isaac Lab policy testing and sim-to-real analysis
            </p>
          </div>
        </div>
      </header>

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
                  environments={environments}
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
