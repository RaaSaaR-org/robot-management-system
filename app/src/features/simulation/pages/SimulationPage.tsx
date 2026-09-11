/**
 * @file SimulationPage.tsx
 * @description Simulation section of /training: sim runs, scenes and the sim-to-real gap (?view=)
 * @feature simulation
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { FlaskConical } from 'lucide-react';
import { DemoFeaturePlaceholder } from '@/components/demo/DemoFeaturePlaceholder';
import { Button, Panel, SearchInput, SegmentedControl, Select, Toolbar } from '@/shared/components/ui';
import { getErrorMessage } from '@/shared/utils';
import { simulationApi } from '../api/simulationApi';
import { useSimulationStore, selectScenes, selectScenesError, selectScenesLoading } from '../store';
import type { SimJob, SimScene } from '../types';
import { RunsView } from '../components/RunsView';
import { RunResults } from '../components/RunResults';
import { ScenesView } from '../components/ScenesView';
import { SimVsRealView } from '../components/SimVsRealView';
import { LaunchRunModal } from '../components/LaunchRunModal';
import { runName } from '../components/simFormat';

export interface SimulationPageProps {
  /** Controlled "New sim run" modal — the /training header owns the button. */
  launchOpen?: boolean;
  onLaunchOpenChange?: (open: boolean) => void;
}

const VIEWS = [
  { value: 'runs', label: 'Runs' },
  { value: 'scenes', label: 'Scenes' },
  { value: 'compare', label: 'Sim vs real' },
] as const;
type View = (typeof VIEWS)[number]['value'];

const RUN_LIMIT = 50;

const STATUS_OPTIONS =['queued', 'running', 'completed', 'failed'].map((s) => ({ value: s, label: s[0].toUpperCase() + s.slice(1) }));

export function SimulationPage(props: SimulationPageProps) {
  if (import.meta.env.VITE_DEMO_MODE === 'true') {
    return (
      <DemoFeaturePlaceholder
        featureName="Simulation Environment"
        icon={<FlaskConical className="w-12 h-12" />}
        description="Test robot behaviors and AI models in a physics-accurate simulation before deploying to real hardware."
        capabilities={[
          'Import real-world maps and environments',
          'Simulate H1, SO-101, G1 robot kinematics',
          'Run VLA model inference against simulated sensors',
          'A/B test model variants without hardware risk',
        ]}
        docsSlug="VLA-integration-guide"
      />
    );
  }
  return <SimulationSection {...props} />;
}

function SimulationSection({ launchOpen, onLaunchOpenChange }: SimulationPageProps) {
  const [params, setParams] = useSearchParams();
  const raw = params.get('view');
  const view: View = VIEWS.some((v) => v.value === raw) ? (raw as View) : 'runs';
  const setParam = useCallback(
    (key: string, value: string | null) =>
      setParams((p) => { if (value) p.set(key, value); else p.delete(key); return p; }, { replace: key === 'view' }),
    [setParams]
  );

  // Controlled by the page header when embedded; local otherwise.
  const [localOpen, setLocalOpen] = useState(false);
  const open = launchOpen ?? localOpen;
  const setOpen = onLaunchOpenChange ?? setLocalOpen;
  const [pickedScene, setPickedScene] = useState<string | null>(null);

  const scenes = useSimulationStore(selectScenes);
  const scenesLoading = useSimulationStore(selectScenesLoading);
  const scenesError = useSimulationStore(selectScenesError);
  const fetchScenes = useSimulationStore((s) => s.fetchScenes);

  const [jobs, setJobs] = useState<SimJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const fetchJobs = useCallback(async () => {
    try {
      setJobs(await simulationApi.listJobs());
      setError(null);
    } catch (err) {
      setError(getErrorMessage(err, 'The simulation service did not answer'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchScenes();
    void fetchJobs();
  }, [fetchScenes, fetchJobs]);

  // Poll while something is still running or queued.
  const busy = jobs.some((j) => j.status === 'running' || j.status === 'queued');
  useEffect(() => {
    if (!busy) return;
    const id = setInterval(() => void fetchJobs(), 3000);
    return () => clearInterval(id);
  }, [busy, fetchJobs]);

  // Deep links: ?sceneId= or ?twinId= open New sim run on that scene.
  const deepScene = params.get('sceneId');
  const deepTwin = params.get('twinId');
  useEffect(() => {
    if (scenes.length === 0 || (!deepScene && !deepTwin)) return;
    const match = scenes.find((s) => (deepScene ? s.id === deepScene : s.twinId === deepTwin));
    if (match) {
      setPickedScene(match.id);
      setOpen(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scenes, deepScene, deepTwin]);

  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');
  const q = query.trim().toLowerCase();
  const filteredJobs = useMemo(
    () => jobs.filter((j) => (!status || j.status === status) && (!q || runName(j, scenes).toLowerCase().includes(q))),
    [jobs, status, q, scenes]
  );
  const filteredScenes = useMemo(
    () => scenes.filter((s) => !q || `${s.name} ${s.embodimentTag}`.toLowerCase().includes(q)),
    [scenes, q]
  );

  // Hundreds of old runs pile up; show the newest ones unless asked for all.
  const [showAll, setShowAll] = useState(false);
  const visibleJobs = useMemo(
    () => (showAll ? filteredJobs : [...filteredJobs].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, RUN_LIMIT)),
    [filteredJobs, showAll]
  );

  const openRun = jobs.find((j) => j.jobId === params.get('run')) ?? null;
  const pickScene = (scene: SimScene) => { setPickedScene(scene.id); setOpen(true); };

  return (
    <div className="flex flex-col gap-6">
      <Toolbar
        search={view !== 'compare' ? <SearchInput value={query} onChange={setQuery} placeholder={view === 'scenes' ? 'Search scenes' : 'Search by model or scene'} /> : undefined}
        filters={
          view === 'runs' ? (
            <Select aria-label="Status" fullWidth={false} className="w-40" placeholder="All statuses" options={STATUS_OPTIONS} value={status} onChange={(e) => setStatus(e.target.value)} />
          ) : undefined
        }
        actions={
          <SegmentedControl label="View" options={VIEWS.map((v) => ({ ...v }))} value={view} onChange={(v) => setParam('view', v === 'runs' ? null : v)} />
        }
      />

      {view === 'runs' && (
        <Panel padding="none">
          <RunsView
            jobs={visibleJobs}
            scenes={scenes}
            loading={loading}
            error={jobs.length === 0 ? error : null}
            onRetry={() => { setLoading(true); void fetchJobs(); }}
            onOpen={(j) => setParam('run', j.jobId)}
            onNew={() => { setPickedScene(null); setOpen(true); }}
            filtered={Boolean(q || status)}
            onClearFilters={() => { setQuery(''); setStatus(''); }}
          />
          {filteredJobs.length > RUN_LIMIT && (
            <div className="flex items-center justify-between gap-3 border-t border-line-subtle px-4 py-3 text-[13px] text-ink-tertiary">
              <span>{showAll ? `All ${filteredJobs.length} runs` : `Newest ${RUN_LIMIT} of ${filteredJobs.length} runs`}</span>
              <Button variant="ghost" size="sm" onClick={() => setShowAll((v) => !v)}>
                {showAll ? 'Show newest only' : 'Show all runs'}
              </Button>
            </div>
          )}
        </Panel>
      )}
      {view === 'scenes' && (
        <ScenesView scenes={filteredScenes} loading={scenesLoading} error={scenesError} onRetry={() => void fetchScenes()} onPick={pickScene} query={q} onClearQuery={() => setQuery('')} />
      )}
      {view === 'compare' && <SimVsRealView />}

      <LaunchRunModal
        isOpen={open}
        onClose={() => setOpen(false)}
        scenes={scenes}
        initialSceneId={pickedScene}
        onStarted={(job) => {
          setJobs((prev) => [job, ...prev.filter((j) => j.jobId !== job.jobId)]);
          setParams((p) => { p.delete('view'); p.delete('sceneId'); p.delete('twinId'); return p; }, { replace: true });
        }}
      />
      <RunResults job={openRun} scenes={scenes} onClose={() => setParam('run', null)} />
    </div>
  );
}
