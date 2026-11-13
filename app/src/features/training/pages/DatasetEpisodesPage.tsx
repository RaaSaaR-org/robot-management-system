/**
 * @file DatasetEpisodesPage.tsx
 * @description Episode browser of one dataset. The episode list, the video with its controls and the
 *              joint chart share the first screen; curation, annotations, statistics, views and the
 *              discussions sit in tabs under it.
 * @feature training
 */

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { SocialPanel } from '@/features/social';
import { cn } from '@/shared/utils/cn';
import { CloudUpload, GitFork, Layers } from 'lucide-react';
import {
  Button,
  ErrorState,
  PageHeader,
  Panel,
  RowActions,
  SkeletonText,
  StatusTag,
  Tabs,
  confirm,
  errorMessage,
  toast,
} from '@/shared/components/ui';
import { evaluationApi } from '@/features/evaluation/api/evaluationApi';
import type { EpisodeReward } from '@/features/evaluation/types/evaluation.types';
import { trainingApi } from '../api/trainingApi';
import { datasetViewsApi } from '../api/datasetViewsApi';
import { CreateViewModal } from '../components/CreateViewModal';
import { DatasetViewsSection } from '../components/DatasetViewsSection';
import { PublishDatasetDialog } from '../components/PublishDatasetDialog';
import { TrainingJobWizard } from '../components/TrainingJobWizard';
import { ViewBanner } from '../components/datasets/ViewBanner';
import { DatasetExpectationsPanel } from '../components/datasets/DatasetExpectationsPanel';
import { EpisodeListPanel } from '../components/datasets/EpisodeListPanel';
import { EpisodeViewer } from '../components/datasets/EpisodeViewer';
import { featureVideoCodec } from '../components/datasets/videoCodec';
import { useDatasetVideoTicket } from '../hooks/useDatasetVideoTicket';
import { useEpisodePlayback } from '../hooks/useEpisodePlayback';
import { useViewportFill } from '../hooks/useViewportFill';
import { CuratePanel } from '../components/datasets/CuratePanel';
import { JointChartPanel, RewardCurvePanel } from '../components/datasets/TrajectoryPanels';
import { AnnotationsPanel } from '../components/datasets/AnnotationsPanel';
import { formatDuration } from '../components/datasets/datasetFormat';
import { formatLerobotVersion, formatRepoAtRevision } from '../components/datasets/importFormat';
import { DatasetStatsPanel } from '../components/datasets/DatasetStatsPanel';
import { cameraKeys, channelLabels, featureNames } from '../components/datasets/episodeFormat';
import { useDatasetViews } from '../hooks/useDatasetViews';
import { useTrainingJobs } from '../hooks/useTrainingJobs';
import { isDatasetView } from '../types';
import type {
  CreateDatasetViewInput,
  CurationResult,
  CurationSuggestion,
  Dataset,
  DatasetModality,
  DatasetSelection,
  EpisodeAnnotation,
  EpisodeMeta,
  FeatureStats,
  FrameData,
  SubmitSimRlJobInput,
  SubmitTrainingJobInput,
} from '../types';

/** Joint names used when a dataset carries no action names (SO-101 layout). */
const DEFAULT_JOINTS = ['shoulder_pan', 'shoulder_lift', 'elbow_flex', 'wrist_flex', 'wrist_roll', 'gripper'];

/** Cameras assumed for a dataset that carries no feature metadata at all. */
const LEGACY_CAMERAS = ['observation.images.wrist', 'observation.images.top'];

const NO_FRAMES: FrameData[] = [];

/**
 * The stage (list, video, chart) ends at the bottom of the window. From this
 * height on there is room to put the chart under the video instead of beside
 * it; below it they share the row, or the video would be a stamp. Sharing the
 * row takes width: under `SIDE_FROM_PX` the chart goes under the video anyway
 * and the stage is given the height that needs, at the price of a short scroll.
 */
const STACKED_FROM_PX = 540;
const SIDE_FROM_PX = 1280;
/** Stacked in a narrow window: the group switch and the legend wrap, so the chart needs more. */
const STACKED_NARROW_PX = 620;
const STAGE_FILL = { min: 380, max: 900, gap: 16 } as const;

export function DatasetEpisodesPage() {
  const { datasetId } = useParams<{ datasetId: string }>();
  const navigate = useNavigate();

  const [dataset, setDataset] = useState<Dataset | null>(null);
  const [datasetError, setDatasetError] = useState<string | null>(null);
  const [episodes, setEpisodes] = useState<EpisodeMeta[]>([]);
  const [episodesLoading, setEpisodesLoading] = useState(false);
  const [episodesError, setEpisodesError] = useState<string | null>(null);
  const [selectedEpisode, setSelectedEpisode] = useState<number | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedEpisodeRef = useRef(searchParams.get('episode'));
  // The frames and the request they answer: until the two agree the chart is
  // loading, so it never shows the previous episode's samples (TASK-484).
  const [framesAnswer, setFramesAnswer] =
    useState<{ key: string; frames: FrameData[]; error: string | null } | null>(null);
  const [framesReloadKey, setFramesReloadKey] = useState(0);
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
  const [modality, setModality] = useState<DatasetModality | null>(null);
  // The answer and which dataset it is for: until the two agree the panel is
  // loading, so it never flashes "no statistics" before the request has left.
  const [statsAnswer, setStatsAnswer] =
    useState<{ datasetId: string; stats: Record<string, FeatureStats> | null } | null>(null);

  // A <video> cannot send the bearer token, so the URL carries a short-lived
  // ticket for this dataset's videos. Re-checked per episode: that is when the
  // video changes anyway, so a renewed ticket never interrupts playback.
  const videoTicket = useDatasetVideoTicket(datasetId, selectedEpisode);
  const { submitJob } = useTrainingJobs();

  // Camera feature keys (dtype video/image). State-only datasets have none; the
  // legacy wrist/top guess applies only to a dataset that has been read and
  // carries no feature metadata at all. Null until this dataset's row is here:
  // guessing before then asked for a `wrist` video the dataset does not have.
  const cameraNames = useMemo(() => {
    if (!dataset || dataset.id !== datasetId) return null;
    const features = dataset.infoJson?.features as Record<string, unknown> | undefined;
    return features ? cameraKeys(features) : LEGACY_CAMERAS;
  }, [dataset, datasetId]);

  // Channel names out of info.json, per vector.
  const infoNames = useMemo(() => {
    const features = dataset?.infoJson?.features as Record<string, { names?: unknown }> | undefined;
    // names is a flat array, a nested array (Unitree) or an object of arrays (pusht, xarm)
    const of = (key: string) => featureNames(features?.[key]?.names).map((n) => n.replace('.pos', ''));
    return { state: of('observation.state'), action: of('action') };
  }, [dataset]);

  // GR00T-style datasets put one placeholder name on a 43-wide vector and keep
  // the real layout in meta/modality.json (TASK-476): label by group and index.
  const jointGroups = useMemo(
    () => (modality?.action.length ? modality.action : modality?.state) ?? [],
    [modality],
  );
  const jointNames = useMemo(() => {
    if (jointGroups.length > 0) {
      const shape = (dataset?.infoJson?.features as Record<string, { shape?: unknown }> | undefined)?.['action']?.shape;
      const declared = Array.isArray(shape) && typeof shape[0] === 'number' ? shape[0] : 0;
      return channelLabels(jointGroups, Math.max(declared, ...jointGroups.map((g) => g.end)));
    }
    return infoNames.action.length ? infoNames.action : DEFAULT_JOINTS;
  }, [dataset, jointGroups, infoNames]);

  // The codec each camera's video is stored in, so the player can say when
  // this browser cannot play it instead of showing a blank box (TASK-478).
  const codecFor = useCallback(
    (cam: string) =>
      featureVideoCodec((dataset?.infoJson?.features as Record<string, unknown> | undefined)?.[cam]),
    [dataset]
  );

  const primaryCamera = cameraNames?.[0];
  const selectedMeta = useMemo(() => episodes.find((e) => e.index === selectedEpisode) ?? null, [episodes, selectedEpisode]);
  // v3.0 chunked datasets: the episode's window inside the chunk video, per camera.
  const videoWindows = selectedMeta?.videoWindows;
  const windowFor = useCallback((cam: string) => videoWindows?.[cam], [videoWindows]);

  const playback = useEpisodePlayback({
    episodeKey: datasetId && selectedEpisode !== null ? `${datasetId}:${selectedEpisode}` : null,
    datasetKey: datasetId,
    primaryCamera,
    windowFor,
    fallbackDuration: selectedMeta?.durationSeconds ?? 0,
  });
  const { currentTime } = playback;

  const framesKey = datasetId && selectedEpisode !== null ? `${datasetId}:${selectedEpisode}:${framesReloadKey}` : null;
  const framesCurrent = framesAnswer && framesAnswer.key === framesKey ? framesAnswer : null;
  const frames = framesCurrent?.frames ?? NO_FRAMES;
  const framesLoading = framesKey !== null && !framesCurrent;
  const framesError = framesCurrent?.error ?? null;

  const stage = useViewportFill<HTMLDivElement>(STAGE_FILL);
  const stageLayout =
    stage.height !== null && stage.height < STACKED_FROM_PX && stage.viewportWidth >= SIDE_FROM_PX ? 'side' : 'stacked';
  const stageHeight =
    stage.height === null
      ? null
      : stageLayout === 'side'
        ? stage.height
        : Math.max(stage.height, stage.viewportWidth < SIDE_FROM_PX ? STACKED_NARROW_PX : STACKED_FROM_PX);

  useEffect(() => {
    if (!datasetId) return;
    setDatasetError(null);
    trainingApi.getDataset(datasetId)
      .then(setDataset)
      .catch((err) => { setDataset(null); setDatasetError(errorMessage(err, 'unknown error')); });
  }, [datasetId, reloadKey]);

  // Joint groups and dataset-wide statistics (TASK-476). Both are optional
  // extras of the page: a dataset without them, or a store that will not
  // answer, leaves the chart on its info.json names and the panel empty.
  const loadedId = dataset?.id;
  const loadedIsView = !!dataset && isDatasetView(dataset);
  useEffect(() => {
    setModality(null);
    setStatsAnswer(null);
    if (!loadedId) return;
    let cancelled = false;
    trainingApi.getDatasetModality(loadedId)
      .then((m) => { if (!cancelled) setModality(m); })
      .catch(() => undefined);
    // A view is a selection of its parent's episodes; the parent's statistics
    // are not the view's, so none are shown for it.
    if (!loadedIsView) {
      trainingApi.getDatasetStats(loadedId)
        .then((s) => (s.hasStats && s.stats ? s.stats : null))
        .catch(() => null)
        .then((stats) => { if (!cancelled) setStatsAnswer({ datasetId: loadedId, stats }); });
    }
    return () => { cancelled = true; };
  }, [loadedId, loadedIsView]);

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
    setCheckedEpisodes([]);
    setEpisodesError(null);
    trainingApi.getEpisodes(datasetId)
      .then((eps) => {
        setEpisodes(eps);
        const flags: Record<number, boolean> = {};
        for (const ep of eps) if (ep.flagged) flags[ep.index] = true;
        setFlaggedMap(flags);
        // `?episode=N` (an activity-feed link, TASK-241) opens that episode.
        const requested = eps.find((e) => String(e.index) === requestedEpisodeRef.current);
        if (eps.length > 0) setSelectedEpisode((requested ?? eps[0]).index);
      })
      .catch((err) => {
        setEpisodes([]);
        const e = err as { detail?: unknown; details?: unknown } | null;
        const detail = e?.details ?? e?.detail;
        setEpisodesError(typeof detail === 'string' ? `${errorMessage(err, 'unknown error')} — ${detail}` : errorMessage(err, 'unknown error'));
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
    const key = `${datasetId}:${selectedEpisode}:${framesReloadKey}`;
    let cancelled = false;
    trainingApi.getEpisodeFrames(datasetId, selectedEpisode, 0, 2000)
      .then((r) => { if (!cancelled) setFramesAnswer({ key, frames: r.frames, error: null }); })
      .catch((err) => {
        // An empty chart here used to hide a read failure (TASK-354).
        if (!cancelled) setFramesAnswer({ key, frames: [], error: errorMessage(err, 'unknown error') });
      });
    return () => { cancelled = true; };
  }, [datasetId, selectedEpisode, framesReloadKey]);

  /** Open another episode from the list. A typed trim range was the previous episode's. */
  const selectEpisode = useCallback((index: number) => {
    setSelectedEpisode((prev) => {
      if (prev !== index) {
        setTrimStart(0);
        setTrimEnd('');
      }
      return index;
    });
  }, []);

  const handleFlagToggle = useCallback(async (index: number) => {
    if (!datasetId) return;
    const next = !flaggedMap[index];
    setFlaggedMap((prev) => ({ ...prev, [index]: next }));
    try {
      await trainingApi.flagEpisode(datasetId, index, next);
    } catch (err) {
      setFlaggedMap((prev) => ({ ...prev, [index]: !next }));
      toast.error(`Couldn't ${next ? 'flag' : 'unflag'} episode ${index}`, { description: errorMessage(err, 'unknown error') });
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
      setCurationMsg(`Delete failed: ${errorMessage(err, 'unknown error')}`);
      toast.error("Couldn't delete episode", { description: errorMessage(err, 'unknown error') });
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
      setCurationMsg(`Trim failed: ${errorMessage(err, 'unknown error')}`);
      toast.error("Couldn't trim episode", { description: errorMessage(err, 'unknown error') });
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
      setSuggestMsg(`Suggest failed: ${errorMessage(err, 'unknown error')}`);
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
      toast.error("Couldn't start annotation", { description: errorMessage(err, 'unknown error') });
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
    ? `${episodes.length || dataset.demonstrationCount} episodes · ${formatDuration(dataset.totalDuration)} · ${dataset.fps} fps${cameraNames ? ` · ${cameraNames.length} camera${cameraNames.length === 1 ? '' : 's'}` : ''}`
    : undefined;
  const ready = dataset?.status === 'ready';

  // Secondary panels, one at a time, state in ?tab= (TASK-484). The ones about
  // the selected episode come first and exist only while there is one.
  const showEpisode = selectedEpisode !== null && !episodesError;
  const tabs = [
    ...(showEpisode
      ? [
          { id: 'curate', label: 'Curate' },
          { id: 'annotations', label: 'Annotations' },
          ...(selectedReward ? [{ id: 'progress', label: 'Task progress' }] : []),
          { id: 'episode-discussion', label: 'Episode discussion' },
        ]
      : []),
    ...(dataset && !isView ? [{ id: 'statistics', label: 'Statistics' }] : []),
    { id: 'views', label: 'Views', count: views.length || undefined },
    ...(dataset ? [{ id: 'discussion', label: isView ? 'View discussion' : 'Dataset discussion' }] : []),
  ];
  const requestedTab = searchParams.get('tab');
  const activeTab = tabs.find((t) => t.id === requestedTab)?.id ?? tabs[0]!.id;
  const openTab = (id: string) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('tab', id);
      return next;
    }, { replace: true });
  };

  return (
    <div className="flex flex-col gap-4">
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
              {/* Which format and which commit this is (TASK-358) */}
              {formatLerobotVersion(dataset.lerobotVersion) && (
                <StatusTag tone="neutral" data-testid="dataset-lerobot-version">{formatLerobotVersion(dataset.lerobotVersion)}</StatusTag>
              )}
              {dataset.huggingFaceRepoId && (
                <span
                  className="break-all font-mono text-xs text-ink-tertiary"
                  title={dataset.sourceRevision ? `${dataset.huggingFaceRepoId}@${dataset.sourceRevision}` : dataset.huggingFaceRepoId}
                  data-testid="dataset-source"
                >
                  {formatRepoAtRevision(dataset.huggingFaceRepoId, dataset.sourceRevision)}
                </span>
              )}
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
                  { label: 'Publish to Hugging Face', icon: <CloudUpload />, disabled: !ready, onSelect: () => setIsPushOpen(true) },
                ]}
              />
            </>
          )
        }
      />

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

      {/* The stage: everything a viewer watches at once. From `lg` up it is as
          tall as the window has left, so the transport bar and the chart's
          cursor are on screen with the video (TASK-484). */}
      <div
        ref={stage.ref}
        data-testid="episode-stage"
        data-layout={stageLayout}
        style={stageHeight !== null ? ({ '--stage-height': `${stageHeight}px` } as CSSProperties) : undefined}
        className="grid grid-cols-1 gap-4 lg:h-[var(--stage-height)] lg:grid-cols-[240px_minmax(0,1fr)] lg:grid-rows-[minmax(0,1fr)]"
      >
        <EpisodeListPanel
          episodes={episodes}
          isLoading={episodesLoading}
          hasError={Boolean(episodesError)}
          selected={selectedEpisode}
          onSelect={selectEpisode}
          checked={checkedEpisodes}
          onToggleChecked={toggleChecked}
          onSetChecked={setCheckedEpisodes}
          flagged={flaggedMap}
          onToggleFlag={(i) => void handleFlagToggle(i)}
          scores={scores}
          onCreateView={() => setIsCreateViewOpen(true)}
        />

        {episodesError ? (
          <Panel>
            <ErrorState
              title="Couldn't load the episodes"
              message={episodesError}
              onRetry={() => setReloadKey((k) => k + 1)}
            />
          </Panel>
        ) : selectedEpisode === null || !cameraNames ? (
          <Panel>
            {episodesLoading || !cameraNames
              ? <SkeletonText lines={6} />
              : <p className="text-sm text-ink-tertiary">Select an episode to watch it.</p>}
          </Panel>
        ) : (
          <div
            className={cn(
              'grid min-w-0 grid-cols-1 gap-4 lg:min-h-0',
              stageLayout === 'side'
                ? 'lg:grid-cols-[minmax(0,6fr)_minmax(0,5fr)] lg:grid-rows-[minmax(0,1fr)]'
                : 'lg:grid-rows-[minmax(0,3fr)_minmax(270px,2fr)]',
            )}
          >
            <EpisodeViewer
              cameras={cameraNames}
              srcFor={(cam) => trainingApi.getEpisodeVideoUrl(datasetId, selectedEpisode, cam, windowFor(cam), videoTicket.ticket)}
              codecFor={codecFor}
              ready={videoTicket.ready}
              onReload={videoTicket.refresh}
              primaryCamera={primaryCamera}
              videoRefs={playback.videoRefs}
              onTimeUpdate={playback.onTimeUpdate}
              onLoadedMetadata={playback.onLoadedMetadata}
              onEnded={playback.onEnded}
              onPause={playback.onPause}
              onFailure={playback.onFailure}
              layout={stageLayout}
              isPlaying={playback.isPlaying}
              onPlayPause={playback.togglePlay}
              currentTime={currentTime}
              duration={playback.duration}
              onSeek={playback.seek}
              speed={playback.speed}
              onSpeedChange={playback.setSpeed}
            />
            <JointChartPanel
              frames={frames}
              jointNames={jointNames}
              groups={jointGroups}
              isLoading={framesLoading}
              currentTime={currentTime}
              isPlaying={playback.isPlaying}
              error={framesError}
              onRetry={() => setFramesReloadKey((k) => k + 1)}
            />
          </div>
        )}
      </div>

      {/* A view has no files of its own; its expectations are its parent's (TASK-353). */}
      {dataset && !isView && <DatasetExpectationsPanel dataset={dataset} onDatasetChange={setDataset} />}

      <Tabs tabs={tabs} activeTab={activeTab} onTabChange={openTab} label="Episode and dataset details" />

      {activeTab === 'curate' && selectedEpisode !== null && (
        <CuratePanel
          episode={selectedEpisode}
          frameCount={selectedMeta?.frameCount ?? frames.length}
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
      )}

      {activeTab === 'annotations' && (
        <AnnotationsPanel
          annotation={selectedAnnotation}
          hasAny={annotations.length > 0}
          annotating={annotating}
          onAnnotate={() => void handleAnnotate()}
        />
      )}

      {activeTab === 'progress' && selectedReward && (
        <RewardCurvePanel reward={selectedReward} fallbackFps={dataset?.fps ?? 30} currentTime={currentTime} />
      )}

      {activeTab === 'episode-discussion' && selectedEpisode !== null && (
        <Panel>
          <SocialPanel
            subject={{ subjectType: 'episode', subjectId: datasetId, episodeIndex: selectedEpisode }}
            title={`Episode ${selectedEpisode} discussion`}
          />
        </Panel>
      )}

      {activeTab === 'statistics' && dataset && !isView && (
        <DatasetStatsPanel
          stats={statsAnswer?.datasetId === dataset.id ? statsAnswer.stats : null}
          isLoading={statsAnswer?.datasetId !== dataset.id}
          modality={modality}
          names={infoNames}
        />
      )}

      {activeTab === 'views' && (
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
      )}

      {activeTab === 'discussion' && dataset && (
        <Panel>
          <SocialPanel
            subject={{ subjectType: isView ? 'dataset_view' : 'dataset', subjectId: dataset.id }}
            title={isView ? 'View discussion' : 'Dataset discussion'}
          />
        </Panel>
      )}

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
        <PublishDatasetDialog isOpen onClose={() => setIsPushOpen(false)} datasetId={dataset.id} datasetName={dataset.name} />
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
