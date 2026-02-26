/**
 * @file SimulationPage.tsx
 * @description Simulation integration page with 4 tabs: Launch, Jobs, Results, Sim vs Real
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
import { simulationApi } from '../api/simulationApi';
import type { SimJob, SimEnvironment, SimToRealComparison } from '../types';

// ============================================================================
// TAB TYPE
// ============================================================================

type TabId = 'launch' | 'jobs' | 'results' | 'sim-vs-real';

const TABS: { id: TabId; label: string }[] = [
  { id: 'launch', label: 'Launch' },
  { id: 'jobs', label: 'Jobs' },
  { id: 'results', label: 'Results' },
  { id: 'sim-vs-real', label: 'Sim vs Real' },
];

// ============================================================================
// STATUS BADGE
// ============================================================================

function StatusBadge({ status }: { status: SimJob['status'] }) {
  const colors: Record<SimJob['status'], string> = {
    queued: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300',
    running: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
    completed: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
    failed: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
  };

  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${colors[status]}`}>
      {status}
    </span>
  );
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
  const [rolloutCount, setRolloutCount] = useState(100);
  const [backend, setBackend] = useState<'mujoco' | 'isaac'>('mujoco');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setSubmitting(true);

    try {
      const job = await simulationApi.submitJob({
        modelId,
        environment,
        rolloutCount,
        backend,
      });
      setSuccess(`Job ${job.jobId} submitted successfully`);
      setModelId('');
      onSubmit();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit job');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6 max-w-lg">
      {error && (
        <div className="p-3 rounded-lg bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300 text-sm">
          {error}
        </div>
      )}
      {success && (
        <div className="p-3 rounded-lg bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300 text-sm">
          {success}
        </div>
      )}

      <div>
        <label className="block text-sm font-medium text-theme-secondary mb-1">Model ID</label>
        <input
          type="text"
          value={modelId}
          onChange={(e) => setModelId(e.target.value)}
          placeholder="e.g. smolvla-so101-v2"
          className="w-full px-3 py-2 rounded-lg border border-theme bg-theme-primary text-theme-primary placeholder:text-theme-tertiary focus:outline-none focus:ring-2 focus:ring-cobalt"
          required
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-theme-secondary mb-1">Environment</label>
        <select
          value={environment}
          onChange={(e) => setEnvironment(e.target.value)}
          className="w-full px-3 py-2 rounded-lg border border-theme bg-theme-primary text-theme-primary focus:outline-none focus:ring-2 focus:ring-cobalt"
          required
        >
          <option value="">Select environment...</option>
          {environments.map((env) => (
            <option key={env.id} value={env.id}>
              {env.name} ({env.backend})
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-sm font-medium text-theme-secondary mb-1">
          Rollout Count: {rolloutCount}
        </label>
        <input
          type="range"
          min={10}
          max={1000}
          step={10}
          value={rolloutCount}
          onChange={(e) => setRolloutCount(Number(e.target.value))}
          className="w-full accent-cobalt"
        />
        <div className="flex justify-between text-xs text-theme-tertiary mt-1">
          <span>10</span>
          <span>1000</span>
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-theme-secondary mb-2">Backend</label>
        <div className="flex gap-4">
          {(['mujoco', 'isaac'] as const).map((b) => (
            <label key={b} className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="backend"
                value={b}
                checked={backend === b}
                onChange={() => setBackend(b)}
                className="accent-cobalt"
              />
              <span className="text-sm text-theme-primary capitalize">{b === 'isaac' ? 'Isaac Lab' : 'MuJoCo'}</span>
            </label>
          ))}
        </div>
      </div>

      <button
        type="submit"
        disabled={submitting || !modelId || !environment}
        className="w-full py-2.5 px-4 rounded-lg bg-cobalt text-white font-medium hover:bg-cobalt/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {submitting ? 'Submitting...' : 'Submit Simulation Job'}
      </button>
    </form>
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
  if (loading) {
    return <div className="text-theme-tertiary">Loading jobs...</div>;
  }

  if (jobs.length === 0) {
    return <div className="text-theme-tertiary">No simulation jobs found. Launch one from the Launch tab.</div>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-theme text-left text-theme-tertiary">
            <th className="pb-2 pr-4">Job ID</th>
            <th className="pb-2 pr-4">Model</th>
            <th className="pb-2 pr-4">Environment</th>
            <th className="pb-2 pr-4">Backend</th>
            <th className="pb-2 pr-4">Status</th>
            <th className="pb-2 pr-4">Progress</th>
            <th className="pb-2 pr-4">Success Rate</th>
            <th className="pb-2">Collisions</th>
          </tr>
        </thead>
        <tbody>
          {jobs.map((job) => (
            <tr
              key={job.jobId}
              onClick={() => onSelect(job)}
              className={`border-b border-theme/50 cursor-pointer hover:bg-theme-hover transition-colors ${
                selectedJobId === job.jobId ? 'bg-cobalt/10' : ''
              }`}
            >
              <td className="py-2 pr-4 font-mono text-xs">{job.jobId.slice(0, 8)}...</td>
              <td className="py-2 pr-4">{job.modelId}</td>
              <td className="py-2 pr-4">{job.environment}</td>
              <td className="py-2 pr-4 capitalize">{job.backend}</td>
              <td className="py-2 pr-4">
                <StatusBadge status={job.status} />
              </td>
              <td className="py-2 pr-4">
                {job.status === 'running' ? (
                  <div className="w-24 bg-theme-tertiary/20 rounded-full h-2">
                    <div
                      className="bg-cobalt h-2 rounded-full transition-all"
                      style={{ width: `${job.progress}%` }}
                    />
                  </div>
                ) : (
                  <span>{job.progress}%</span>
                )}
              </td>
              <td className="py-2 pr-4">
                {job.metrics ? `${(job.metrics.successRate * 100).toFixed(1)}%` : '-'}
              </td>
              <td className="py-2">
                {job.metrics !== undefined ? (
                  <span
                    className={
                      job.metrics.collisionCount > 3
                        ? 'text-red-500 font-medium'
                        : 'text-theme-primary'
                    }
                  >
                    {job.metrics.collisionCount}
                  </span>
                ) : (
                  '-'
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ============================================================================
// RESULTS TAB
// ============================================================================

function ResultsTab({ job }: { job: SimJob | null }) {
  if (!job) {
    return (
      <div className="text-theme-tertiary">
        Select a completed job from the Jobs tab to view detailed results.
      </div>
    );
  }

  if (!job.metrics) {
    return (
      <div className="text-theme-tertiary">
        Job <span className="font-mono">{job.jobId.slice(0, 8)}</span> has no metrics yet (status: {job.status}).
      </div>
    );
  }

  const { metrics } = job;

  return (
    <div className="space-y-6">
      <h3 className="text-lg font-semibold text-theme-primary">
        Results for Job {job.jobId.slice(0, 8)}...
      </h3>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Success Rate Gauge */}
        <div className="card p-4">
          <div className="text-sm text-theme-tertiary mb-1">Success Rate</div>
          <div className="text-3xl font-bold text-theme-primary">
            {(metrics.successRate * 100).toFixed(1)}%
          </div>
          <div className="mt-2 w-full bg-theme-tertiary/20 rounded-full h-3">
            <div
              className="bg-green-500 h-3 rounded-full transition-all"
              style={{ width: `${metrics.successRate * 100}%` }}
            />
          </div>
        </div>

        {/* Avg Steps */}
        <div className="card p-4">
          <div className="text-sm text-theme-tertiary mb-1">Avg Steps to Completion</div>
          <div className="text-3xl font-bold text-theme-primary">
            {metrics.avgStepsToCompletion}
          </div>
        </div>

        {/* Collisions */}
        <div className="card p-4">
          <div className="text-sm text-theme-tertiary mb-1">Collisions</div>
          <div className="flex items-center gap-2">
            <span className="text-3xl font-bold text-theme-primary">
              {metrics.collisionCount}
            </span>
            {metrics.collisionCount > 3 && (
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300">
                High
              </span>
            )}
          </div>
        </div>

        {/* Avg Episode Duration */}
        <div className="card p-4">
          <div className="text-sm text-theme-tertiary mb-1">Avg Episode Duration</div>
          <div className="text-3xl font-bold text-theme-primary">
            {metrics.avgEpisodeDuration.toFixed(1)}s
          </div>
        </div>
      </div>

      <div className="card p-4 text-sm text-theme-secondary">
        <div className="grid grid-cols-2 gap-2">
          <span className="text-theme-tertiary">Model:</span>
          <span>{job.modelId}</span>
          <span className="text-theme-tertiary">Environment:</span>
          <span>{job.environment}</span>
          <span className="text-theme-tertiary">Backend:</span>
          <span className="capitalize">{job.backend}</span>
          <span className="text-theme-tertiary">Rollouts:</span>
          <span>{job.rolloutCount}</span>
        </div>
      </div>
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
    'Sim Success Rate': Math.round(c.simSuccessRate * 100),
    'Real Success Rate': Math.round(c.realSuccessRate * 100),
    gap: Math.round(c.gap * 100),
  }));

  return (
    <div className="space-y-6">
      <div className="flex gap-3 items-end">
        <div className="flex-1 max-w-xs">
          <label className="block text-sm font-medium text-theme-secondary mb-1">Model ID</label>
          <input
            type="text"
            value={modelId}
            onChange={(e) => setModelId(e.target.value)}
            placeholder="e.g. smolvla-so101-v2"
            className="w-full px-3 py-2 rounded-lg border border-theme bg-theme-primary text-theme-primary placeholder:text-theme-tertiary focus:outline-none focus:ring-2 focus:ring-cobalt"
          />
        </div>
        <button
          onClick={fetchComparison}
          disabled={loading || !modelId}
          className="py-2 px-4 rounded-lg bg-cobalt text-white font-medium hover:bg-cobalt/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {loading ? 'Loading...' : 'Compare'}
        </button>
      </div>

      {error && (
        <div className="p-3 rounded-lg bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300 text-sm">
          {error}
        </div>
      )}

      {comparisons.length === 0 && !loading && (
        <div className="text-theme-tertiary text-sm">
          Enter a Model ID and click Compare to see sim-to-real gap analysis.
        </div>
      )}

      {chartData.length > 0 && (
        <div className="card p-4">
          <h3 className="text-lg font-semibold text-theme-primary mb-4">
            Sim vs Real Success Rate
          </h3>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" />
              <YAxis domain={[0, 100]} tickFormatter={(v: number) => `${v}%`} />
              <Tooltip formatter={(value: number | undefined) => value != null ? `${value}%` : '—'} />
              <Legend />
              <Bar dataKey="Sim Success Rate" fill="#3B82F6" />
              <Bar dataKey="Real Success Rate" fill="#10B981" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// MAIN PAGE
// ============================================================================

export function SimulationPage() {
  const [activeTab, setActiveTab] = useState<TabId>('launch');
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

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-theme-primary">Simulation</h1>
        <p className="text-theme-tertiary mt-1">
          MuJoCo / Isaac Lab policy testing and sim-to-real analysis
        </p>
      </header>

      {/* Tab Bar */}
      <div className="flex gap-1 border-b border-theme">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px ${
              activeTab === tab.id
                ? 'border-cobalt text-cobalt'
                : 'border-transparent text-theme-tertiary hover:text-theme-secondary'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div className="card p-6">
        {activeTab === 'launch' && (
          <LaunchTab
            environments={environments}
            onSubmit={() => {
              fetchJobs();
              setActiveTab('jobs');
            }}
          />
        )}
        {activeTab === 'jobs' && (
          <JobsTab
            jobs={jobs}
            loading={loading}
            onSelect={handleJobSelect}
            selectedJobId={selectedJob?.jobId ?? null}
          />
        )}
        {activeTab === 'results' && <ResultsTab job={selectedJob} />}
        {activeTab === 'sim-vs-real' && <SimVsRealTab />}
      </div>
    </div>
  );
}
