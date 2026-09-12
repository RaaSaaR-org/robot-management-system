/**
 * @file DatasetEpisodesPage.tsx
 * @description Episode browser of one dataset: synced video, joint charts, annotations, curation and views
 * @feature training
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { CloudUpload, GitFork, Layers } from 'lucide-react';
import {
  Button,
  ErrorState,
  PageHeader,
  Panel,
  PipelineBreadcrumb,
  RowActions,
  SkeletonText,
  StatusTag,
  confirm,
  toast,
} from '@/shared/components/ui';
import { evaluationApi } from '@/features/evaluation/api/evaluationApi';
import type { EpisodeReward } from '@/features/evaluation/types/evaluation.types';
import { trainingApi } from '../api/trainingApi';
import { datasetViewsApi } from '../api/datasetViewsApi';
import { CreateViewModal } from '../components/CreateViewModal';
import { DatasetViewsSection } from '../components/DatasetViewsSection';
import { HFPushModal } from '../components/HFPushModal';
import { TrainingJobWizard } from '../components/TrainingJobWizard';
import { ViewBanner } from '../components/datasets/ViewBanner';
import { EpisodeListPanel } from '../components/datasets/EpisodeListPanel';
import { EpisodeViewer, type PlaybackSpeed } from '../components/datasets/EpisodeViewer';
import { CuratePanel } from '../components/datasets/CuratePanel';
import { JointChartPanel, RewardCurvePanel } from '../components/datasets/TrajectoryPanels';
import { AnnotationsPanel } from '../components/datasets/AnnotationsPanel';
import { errText } from '../components/datasets/episodeFormat';
import { formatDuration } from '../components/datasets/datasetFormat';
import { useDatasetViews } from '../hooks/useDatasetViews';
import { useTrainingJobs } from '../hooks/useTrainingJobs';
import { isDatasetView } from '../types';
import type {
  CreateDatasetViewInput,
  CurationResult,
  CurationSuggestion,
  Dataset,
  DatasetSelection,
  EpisodeAnnotation,
  EpisodeMeta,
  FrameData,
  SubmitSimRlJobInput,
  SubmitTrainingJobInput,
} from '../types';

/** Joint names used when a dataset carries no action names (SO-101 layout). */
const DEFAULT_JOINTS = ['shoulder_pan', 'shoulder_lift', 'elbow_flex', 'wrist_flex', 'wrist_roll', 'gripper'];

export function DatasetEpisodesPage() {
  const { datasetId } = useParams<{ datasetId: string }>();
  const navigate = useNavigate();

  const [dataset, setDataset] = useState<Dataset | null>(null);
  const [datasetError, setDatasetError] = useState<string | null>(null);
  const [episodes, setEpisodes] = useState<EpisodeMeta[]>([]);
  const [episodesLoading, setEpisodesLoading] = useState(false);
  const [episodesError, setEpisodesError] = useState<string | null>(null);
  const [selectedEpisode, setSelectedEpisode] = useState<number | null>(null);
  const [frames, setFrames] = useState<FrameData[]>([]);
  const [framesLoading, setFramesLoading] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState<PlaybackSpeed>('1');
  const [flaggedMap, setFlaggedMap] = useState<Record<number, boolean>>({});
  const [trimStart, setTrimStart] = useState(0);
  const [trimEnd, setTrimEnd] = useState<number | ''>('');
  const [curating, setCurating] = useState(false);
  const [curationMsg, setCurationMsg] = useState<string | null>(null);
  const [newDataset, setNewDataset] = useState<{ id: string; name?: string } | null>(null);
  const [suggestions, setSuggestions] = useState<CurationSuggestion[]>([]);
  const [suggesting, setSuggesting] = useState(false);
  const [suggestMsg, setSuggestMsg] = useState<string | null>(null);
  const [rewardsByEpisode, setRewardsByEpisode] = useState<Record<number, EpisodeReward>>({});
  const [annotations, setAnnotations] = useState<EpisodeAnnotation[]>([]);
  const [annotating, setAnnotating] = useState(false);
  // Views (TASK-240): the selection is made HERE, where flags and scores are.
  const [checkedEpisodes, setCheckedEpisodes] = useState<number[]>([]);
  const [isCreateViewOpen, setIsCreateViewOpen] = useState(false);
  const [duplicateTarget, setDuplicateTarget] =
    useState<{ id: string; name: string; selection: DatasetSelection } | null>(null);
  const [parentDataset, setParentDataset] = useState<Dataset | null>(null);
  const [isPushOpen, setIsPushOpen] = useState(false);
  const [isWizardOpen, setIsWizardOpen] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const videoRefs = useRef<Record<string, HTMLVideoElement | null>>({});
  const { submitJob } = useTrainingJobs();

  // Camera names from the features. State-only datasets have none; the legacy
  // wrist/top guess applies only when there is no feature metadata at all.
  const cameraNames = useMemo(() => {
    if (!dataset?.infoJson?.features) return ['wrist', 'top'];
    return Object.keys(dataset.infoJson.features as Record<string, unknown>)
      .filter((k) => k.startsWith('observation.images.'))
      .map((k) => k.replace('observation.images.', ''));
  }, [dataset]);

  const jointNames = useMemo(() => {
    const action = (dataset?.infoJson?.features as Record<string, { names?: unknown[] }> | undefined)?.['action'];
    // Unitree-style datasets nest names as [["kLeftShoulderPitch", ...]] — flatten first
    const flat = action?.names?.flat(2).filter((n): n is string => typeof n === 'string') ?? [];
    return flat.length ? flat.map((n) => n.replace('.pos', '')) : DEFAULT_JOINTS;
  }, [dataset]);

  const primaryCamera = cameraNames[0];
  const selectedMeta = useMemo(() => episodes.find((e) => e.index === selectedEpisode) ?? null, [episodes, selectedEpisode]);
  // v3.0 chunked datasets: the episode's window inside the chunk video, per camera.
  const videoWindows = selectedMeta?.videoWindows;
  const windowFor = useCallback((cam: string) => videoWindows?.[cam], [videoWindows]);
  const primaryWindow = primaryCamera ? videoWindows?.[primaryCamera] : undefined;

  useEffect(() => {
    if (!datasetId) return;
    setDatasetError(null);
    trainingApi.getDataset(datasetId)
      .then(setDataset)
      .catch((err) => { setDataset(null); setDatasetError(errText(err)); });
  }, [datasetId, reloadKey]);

  const { views, isLoading: viewsLoading, error: viewsError, createView, deleteView, materializeView } =
    useDatasetViews(datasetId);

  // The dataset THIS one was forked from — one hop only.
  useEffect(() => {
    const parentId = dataset?.parentDatasetId;
    if (!parentId) { setParentDataset(null); return; }
    let cancelled = false;
    trainingApi.getDataset(parentId)
      .then((p) => { if (!cancelled) setParentDataset(p); })
      .catch(() => { if (!cancelled) setParentDataset(null); });
    return () => { cancelled = true; };
  }, [dataset?.parentDatasetId]);

  useEffect(() => {
    if (!datasetId) return;
    setEpisodesLoading(true);
    setSelectedEpisode(null);
    setFrames([]);
    setCurrentTime(0);
    setCheckedEpisodes([]);
    setEpisodesError(null);
    trainingApi.getEpisodes(datasetId)
      .then((eps) => {
        setEpisodes(eps);
        const flags: Record<number, boolean> = {};
        for (const ep of eps) if (ep.flagged) flags[ep.index] = true;
        setFlaggedMap(flags);
        if (eps.length > 0) setSelectedEpisode(eps[0].index);
      })
      .catch((err) => {
        setEpisodes([]);
        const e = err as { detail?: unknown; details?: unknown } | null;
        const detail = e?.details ?? e?.detail;
        setEpisodesError(typeof detail === 'string' ? `${errText(err)} — ${detail}` : errText(err));
      })
      .finally(() => setEpisodesLoading(false));
  }, [datasetId, reloadKey]);

  // Reward-model scores, newest per episode. Absence is fine (TASK-179).
  useEffect(() => {
    if (!datasetId) return;
    let cancelled = false;
    setRewardsByEpisode({});
    evaluationApi.listRewards(datasetId)
      .then((rewards) => {
        if (cancelled) return;
        const byEpisode: Record<number, EpisodeReward> = {};
        for (const r of rewards) {
          const prev = byEpisode[r.episodeIndex];
          if (!prev || new Date(r.createdAt) > new Date(prev.createdAt)) byEpisode[r.episodeIndex] = r;
        }
        setRewardsByEpisode(byEpisode);
      })
      .catch(() => { if (!cancelled) setRewardsByEpisode({}); });
    return () => { cancelled = true; };
  }, [datasetId]);

  useEffect(() => {
    if (!datasetId) return;
    let cancelled = false;
    setAnnotations([]);
    trainingApi.getAnnotations(datasetId)
      .then((a) => { if (!cancelled) setAnnotations(a); })
      .catch(() => { if (!cancelled) setAnnotations([]); });
    return () => { cancelled = true; };
  }, [datasetId]);

  useEffect(() => {
    if (!datasetId || selectedEpisode === null) return;
    const ep = episodes.find((e) => e.index === selectedEpisode);
    if (ep) setDuration(ep.durationSeconds);
    setFramesLoading(true);
    trainingApi.getEpisodeFrames(datasetId, selectedEpisode, 0, 2000)
      .then((r) => setFrames(r.frames))
      .catch(() => setFrames([]))
      .finally(() => setFramesLoading(false));
  }, [datasetId, selectedEpisode, episodes]);

  useEffect(() => {
    for (const ref of Object.values(videoRefs.current)) if (ref) ref.playbackRate = Number(speed);
  }, [speed]);

  const handleTimeUpdate = useCallback(() => {
    if (!primaryCamera) return;
    const primary = videoRefs.current[primaryCamera];
    if (!primary) return;
    const win = windowFor(primaryCamera);
    const rel = primary.currentTime - (win?.from ?? 0);
    setCurrentTime(rel);
    // Clamp so a chunked episode never bleeds into the next one.
    if (win && primary.currentTime >= win.to - 0.05) {
      for (const ref of Object.values(videoRefs.current)) ref?.pause();
      setIsPlaying(false);
      return;
    }
    for (const [name, ref] of Object.entries(videoRefs.current)) {
      if (!ref || name === primaryCamera) continue;
      const target = (windowFor(name)?.from ?? 0) + rel;
      if (Math.abs(ref.currentTime - target) > 0.1) ref.currentTime = target;
    }
  }, [primaryCamera, windowFor]);

  const handleLoadedMetadata = useCallback(() => {
    // Chunked (v3.0): duration is the episode's window, not the chunk video's.
    if (primaryWindow) { setDuration(primaryWindow.to - primaryWindow.from); return; }
    const primary = primaryCamera ? videoRefs.current[primaryCamera] : null;
    if (primary && isFinite(primary.duration)) setDuration(primary.duration);
  }, [primaryCamera, primaryWindow]);

  const handlePlayPause = useCallback(() => {
    const entries = Object.entries(videoRefs.current).filter(([, v]) => Boolean(v)) as [string, HTMLVideoElement][];
    if (entries.length === 0) return;
    const primary = (primaryCamera && videoRefs.current[primaryCamera]) || entries[0][1];
    if (primary.paused) {
      const win = primaryCamera ? windowFor(primaryCamera) : undefined;
      if (win && primary.currentTime >= win.to - 0.1) {
        for (const [name, ref] of entries) ref.currentTime = windowFor(name)?.from ?? 0;
      }
      entries.forEach(([, v]) => { void v.play(); });
      setIsPlaying(true);
    } else {
      entries.forEach(([, v]) => v.pause());
      setIsPlaying(false);
    }
  }, [primaryCamera, windowFor]);

  const handleSeek = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    const time = parseFloat(e.target.value);
    setCurrentTime(time);
    for (const [name, ref] of Object.entries(videoRefs.current)) {
      if (ref) ref.currentTime = (windowFor(name)?.from ?? 0) + time;
    }
  }, [windowFor]);

  const handleFlagToggle = useCallback(async (index: number) => {
    if (!datasetId) return;
    const next = !flaggedMap[index];
    setFlaggedMap((prev) => ({ ...prev, [index]: next }));
    try {
      await trainingApi.flagEpisode(datasetId, index, next);
    } catch (err) {
      setFlaggedMap((prev) => ({ ...prev, [index]: !next }));
      toast.error(`Couldn't ${next ? 'flag' : 'unflag'} episode ${index}`, { description: errText(err) });
    }
  }, [datasetId, flaggedMap]);

  /** Record a curation edit's outcome: the panel line the e2e spec reads, and a toast. */
  const recordOutcome = useCallback((verb: 'Trimmed' | 'Deleted', result: CurationResult) => {
    const revision = result.newDatasetName ? `new dataset "${result.newDatasetName}"` : 'new revision';
    setCurationMsg(`${verb} → ${revision}: ${result.total_episodes} episodes, ${result.total_frames} frames.`);
    setNewDataset(result.newDatasetId ? { id: result.newDatasetId, name: result.newDatasetName } : null);
    toast.success(verb === 'Trimmed' ? 'Episode trimmed' : 'Episode deleted', { description: result.newDatasetName });
  }, []);

  const handleDeleteEpisode = useCallback(async (episodeIndex?: number): Promise<boolean> => {
    const target = episodeIndex ?? selectedEpisode;
    if (!datasetId || target === null) return false;
    const ok = await confirm({
      title: `Delete episode ${target}?`,
      description: 'A new dataset revision is written without it; the original is kept.',
      confirmLabel: 'Delete',
      tone: 'danger',
    });
    if (!ok) return false;
    setCurating(true);
    setCurationMsg(null);
    try {
      recordOutcome('Deleted', await trainingApi.deleteEpisodes(datasetId, [target]));
      return true;
    } catch (err) {
      setCurationMsg(`Delete failed: ${errText(err)}`);
      toast.error("Couldn't delete episode", { description: errText(err) });
      return false;
    } finally {
      setCurating(false);
    }
  }, [datasetId, selectedEpisode, recordOutcome]);

  const handleTrim = useCallback(async () => {
    if (!datasetId || selectedEpisode === null) return;
    setCurating(true);
    setCurationMsg(null);
    try {
      recordOutcome('Trimmed', await trainingApi.trimEpisode(datasetId, selectedEpisode, trimStart, trimEnd === '' ? null : Number(trimEnd)));
    } catch (err) {
      setCurationMsg(`Trim failed: ${errText(err)}`);
      toast.error("Couldn't trim episode", { description: errText(err) });
    } finally {
      setCurating(false);
    }
  }, [datasetId, selectedEpisode, trimStart, trimEnd, recordOutcome]);

  // AI suggestions — never auto-applied
  const handleSuggest = useCallback(async () => {
    if (!datasetId) return;
    setSuggesting(true);
    setSuggestMsg(null);
    try {
      const result = await trainingApi.suggestCuration(datasetId);
      setSuggestions(result.suggestions);
      if (result.suggestions.length === 0) setSuggestMsg('No curation suggestions — episodes look clean.');
    } catch (err) {
      setSuggestions([]);
      setSuggestMsg(`Suggest failed: ${errText(err)}`);
    } finally {
      setSuggesting(false);
    }
  }, [datasetId]);

  const applySuggestion = useCallback((s: CurationSuggestion) => {
    setSelectedEpisode(s.episode);
    if (s.kind === 'trim') {
      setTrimStart(s.start ?? 0);
      setTrimEnd(s.end ?? '');
      setSuggestMsg(`Trim range [${s.start ?? 0}, ${s.end ?? 'end'}) prefilled for episode ${s.episode} — review and press "Trim range".`);
    } else {
      // Remove by identity — the list may shift while the dialog is open.
      void handleDeleteEpisode(s.episode).then((ok) => {
        if (ok) setSuggestions((prev) => prev.filter((x) => x !== s));
      });
    }
  }, [handleDeleteEpisode]);

  const handleAnnotate = useCallback(async () => {
    if (!datasetId) return;
    setAnnotating(true);
    try {
      const { jobId } = await trainingApi.startAnnotation(datasetId);
      toast.success('Annotation job queued', { description: `Job ${jobId.slice(0, 8)} — subtasks and VQA pairs appear here when it finishes.` });
    } catch (err) {
      toast.error("Couldn't start annotation", { description: errText(err) });
    } finally {
      setAnnotating(false);
    }
  }, [datasetId]);

  const toggleChecked = useCallback((index: number) => {
    setCheckedEpisodes((prev) => (prev.includes(index) ? prev.filter((i) => i !== index) : [...prev, index]));
  }, []);
  const allEpisodeIndices = useMemo(() => episodes.map((ep) => ep.index), [episodes]);
  const flaggedIndices = useMemo(
    () => new Set(Object.entries(flaggedMap).filter(([, on]) => on).map(([i]) => Number(i))),
    [flaggedMap],
  );
  const rewardScores = useMemo(
    () => Object.values(rewardsByEpisode).map((r) => ({ episodeIndex: r.episodeIndex, score: r.score, rewardType: r.rewardType })),
    [rewardsByEpisode],
  );

  const isView = !!dataset && isDatasetView(dataset);
  const isFrozen = isView && !!dataset?.frozenAt;

  const handleCreateView = useCallback(async (input: CreateDatasetViewInput) => {
    const created = await createView(input);
    setCheckedEpisodes([]);
    toast.success('View created', { description: input.name });
    return created;
  }, [createView]);

  /** Fork a FROZEN view again, as a sibling under the same parent. */
  const handleDuplicateView = useCallback(async (input: CreateDatasetViewInput) => {
    if (!duplicateTarget) throw new Error('Nothing to duplicate');
    let created;
    if (duplicateTarget.id === datasetId) {
      const parentId = dataset?.parentDatasetId;
      if (!parentId) throw new Error('This view has no parent to fork');
      created = await datasetViewsApi.createView(parentId, input);
    } else {
      created = await createView(input);
    }
    toast.success('View created', { description: input.name });
    return created;
  }, [duplicateTarget, datasetId, dataset?.parentDatasetId, createView]);

  // The views panel confirms and reports; this only performs the delete.
  const deleteViewRow = useCallback(async (view: { id: string }) => { await deleteView(view.id); }, [deleteView]);

  const submitWizard = useCallback(async (input: SubmitTrainingJobInput | SubmitSimRlJobInput) => {
    await submitJob(input);
    setIsWizardOpen(false);
    toast.success('Training job created');
    navigate('/training');
  }, [submitJob, navigate]);

  const back = { to: '/datasets', label: 'Datasets' };

  if (!datasetId || (datasetError && !dataset)) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader eyebrow="Build" back={back} title="Dataset" />
        <Panel>
          <ErrorState
            title="Couldn't load this dataset"
            message={datasetError ?? 'No dataset id in the address.'}
            onRetry={datasetId ? () => setReloadKey((k) => k + 1) : undefined}
          />
        </Panel>
      </div>
    );
  }

  const selectedReward = selectedEpisode !== null ? rewardsByEpisode[selectedEpisode] : undefined;
  const selectedAnnotation = selectedEpisode !== null ? annotations.find((a) => a.episodeIndex === selectedEpisode) : undefined;
  const scores = Object.fromEntries(
    Object.values(rewardsByEpisode).map((r) => [r.episodeIndex, { score: r.score, rewardType: r.rewardType }]),
  );
  const description = dataset
    ? `${episodes.length || dataset.demonstrationCount} episodes · ${formatDuration(dataset.totalDuration)} · ${dataset.fps} fps · ${cameraNames.length} camera${cameraNames.length === 1 ? '' : 's'}`
    : undefined;
  const ready = dataset?.status === 'ready';

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Build"
        back={back}
        title={dataset?.name ?? 'Loading…'}
        description={description}
        meta={
          dataset && (
            <>
              <StatusTag status={dataset.status} dot />
              {isView && <StatusTag tone="accent">View</StatusTag>}
              {dataset.infoJson?._synthetic && <StatusTag tone="sim">Synthetic</StatusTag>}
            </>
          )
        }
        actions={
          dataset && (
            <>
              <Button
                variant="secondary"
                leftIcon={<GitFork className="h-4 w-4" strokeWidth={1.75} />}
                onClick={() => setIsCreateViewOpen(true)}
              >
                Create view
              </Button>
              <Button
                leftIcon={<Layers className="h-4 w-4" strokeWidth={1.75} />}
                disabled={!ready}
                onClick={() => setIsWizardOpen(true)}
              >
                Train on this dataset
              </Button>
              <RowActions
                label="More actions"
                items={[
                  { label: 'Push to Hugging Face', icon: <CloudUpload />, disabled: !ready, onSelect: () => setIsPushOpen(true) },
                ]}
              />
            </>
          )
        }
      >
        <PipelineBreadcrumb stage="dataset" />
      </PageHeader>

      {isView && dataset && (
        <ViewBanner
          dataset={dataset}
          parent={parentDataset}
          onDuplicate={
            isFrozen && dataset.parentDatasetId && dataset.selection
              ? () => setDuplicateTarget({ id: dataset.id, name: dataset.name, selection: dataset.selection! })
              : undefined
          }
        />
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
        <EpisodeListPanel
          episodes={episodes}
          isLoading={episodesLoading}
          hasError={Boolean(episodesError)}
          selected={selectedEpisode}
          onSelect={setSelectedEpisode}
          checked={checkedEpisodes}
          onToggleChecked={toggleChecked}
          onSetChecked={setCheckedEpisodes}
          flagged={flaggedMap}
          onToggleFlag={(i) => void handleFlagToggle(i)}
          scores={scores}
          onCreateView={() => setIsCreateViewOpen(true)}
        />

        <div className="flex min-w-0 flex-col gap-6">
          {episodesError ? (
            <Panel>
              <ErrorState
                title="Couldn't load the episodes"
                message={episodesError}
                onRetry={() => setReloadKey((k) => k + 1)}
              />
            </Panel>
          ) : selectedEpisode === null ? (
            <Panel>{episodesLoading || !dataset ? <SkeletonText lines={6} /> : <p className="text-sm text-ink-tertiary">Select an episode to watch it.</p>}</Panel>
          ) : (
            <>
              <EpisodeViewer
                cameras={cameraNames}
                srcFor={(cam) => trainingApi.getEpisodeVideoUrl(datasetId, selectedEpisode, cam, windowFor(cam))}
                primaryCamera={primaryCamera}
                videoRefs={videoRefs}
                onTimeUpdate={handleTimeUpdate}
                onLoadedMetadata={handleLoadedMetadata}
                onEnded={() => setIsPlaying(false)}
                isPlaying={isPlaying}
                onPlayPause={handlePlayPause}
                currentTime={currentTime}
                duration={duration}
                onSeek={handleSeek}
                speed={speed}
                onSpeedChange={setSpeed}
              />
              <CuratePanel
                episode={selectedEpisode}
                frameCount={frames.length}
                trimStart={trimStart}
                trimEnd={trimEnd}
                onTrimStart={setTrimStart}
                onTrimEnd={setTrimEnd}
                curating={curating}
                suggesting={suggesting}
                onTrim={() => void handleTrim()}
                onDelete={() => void handleDeleteEpisode()}
                onSuggest={() => void handleSuggest()}
                message={curationMsg}
                newDataset={newDataset}
                onOpenNew={() => {
                  if (!newDataset) return;
                  setNewDataset(null);
                  setCurationMsg(null);
                  setSuggestions([]);
                  navigate(`/datasets/${newDataset.id}/episodes`);
                }}
                suggestMessage={suggestMsg}
                suggestions={suggestions}
                onApply={applySuggestion}
                onDismiss={(i) => setSuggestions((prev) => prev.filter((_, j) => j !== i))}
              />
              <JointChartPanel frames={frames} jointNames={jointNames} isLoading={framesLoading} currentTime={currentTime} />
              {selectedReward && (
                <RewardCurvePanel reward={selectedReward} fallbackFps={dataset?.fps ?? 30} currentTime={currentTime} />
              )}
              <AnnotationsPanel
                annotation={selectedAnnotation}
                hasAny={annotations.length > 0}
                annotating={annotating}
                onAnnotate={() => void handleAnnotate()}
              />
            </>
          )}
        </div>
      </div>

      <DatasetViewsSection
        parentEpisodeCount={episodes.length || dataset?.demonstrationCount || 0}
        views={views}
        isLoading={viewsLoading}
        error={viewsError}
        onCreate={() => setIsCreateViewOpen(true)}
        onOpen={(view) => navigate(`/datasets/${view.id}/episodes`)}
        onDelete={deleteViewRow}
        onDuplicate={(view) => setDuplicateTarget(view)}
        onMaterialize={async (view) => {
          await materializeView(view.id);
          toast.success('View materialized', { description: view.name });
        }}
      />

      <CreateViewModal
        isOpen={isCreateViewOpen}
        onClose={() => setIsCreateViewOpen(false)}
        parentName={dataset?.name ?? 'this dataset'}
        parentEpisodeCount={episodes.length || dataset?.demonstrationCount || 0}
        selectedEpisodes={checkedEpisodes}
        allEpisodes={allEpisodeIndices}
        flaggedEpisodes={flaggedIndices}
        rewards={rewardScores}
        onCreate={handleCreateView}
      />
      {duplicateTarget?.selection && (
        <CreateViewModal
          isOpen
          onClose={() => setDuplicateTarget(null)}
          parentName={duplicateTarget.id === datasetId ? (parentDataset?.name ?? 'its parent dataset') : (dataset?.name ?? 'this dataset')}
          parentEpisodeCount={
            duplicateTarget.id === datasetId
              ? (parentDataset?.demonstrationCount ?? duplicateTarget.selection.episodes.length)
              : (episodes.length || dataset?.demonstrationCount || 0)
          }
          duplicateOf={{ name: duplicateTarget.name, selection: duplicateTarget.selection }}
          onCreate={handleDuplicateView}
          onCreated={(created) => navigate(`/datasets/${created.id}/episodes`)}
        />
      )}
      {dataset && isPushOpen && (
        <HFPushModal isOpen onClose={() => setIsPushOpen(false)} datasetId={dataset.id} datasetName={dataset.name} />
      )}
      {dataset && (
        <TrainingJobWizard
          isOpen={isWizardOpen}
          onClose={() => setIsWizardOpen(false)}
          onSubmit={submitWizard}
          datasets={[dataset]}
          initialMixture={[{ datasetId: dataset.id, weight: 1 }]}
        />
      )}
    </div>
  );
}
