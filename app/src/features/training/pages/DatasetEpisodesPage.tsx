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
import { useEpisodeFrames } from '../hooks/useEpisodeFrames';
import { useEpisodePlayback } from '../hooks/useEpisodePlayback';
import { useSettledValue } from '../hooks/useSettledValue';
import { probeVideoThrottle } from '../api/datasetVideoApi';
import { useViewportFill } from '../hooks/useViewportFill';
import { CuratePanel } from '../components/datasets/CuratePanel';
import { JointChartPanel, RewardCurvePanel } from '../components/datasets/TrajectoryPanels';
import { AnnotationsPanel } from '../components/datasets/AnnotationsPanel';
import { formatDuration } from '../components/datasets/datasetFormat';
import { formatLerobotVersion } from '../components/datasets/importFormat';
import { DatasetProvenance } from '../components/datasets/DatasetProvenance';
import { DatasetStatsPanel } from '../components/datasets/DatasetStatsPanel';
import { cameraKeys, channelLabels, channelNamesAgree, featureNames } from '../components/datasets/episodeFormat';
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
  SubmitSimRlJobInput,
  SubmitTrainingJobInput,
} from '../types';

/** Joint names used when a dataset carries no action names (SO-101 layout). */
const DEFAULT_JOINTS = ['shoulder_pan', 'shoulder_lift', 'elbow_flex', 'wrist_flex', 'wrist_roll', 'gripper'];

/** Cameras assumed for a dataset that carries no feature metadata at all. */
const LEGACY_CAMERAS = ['observation.images.wrist', 'observation.images.top'];

/**
 * How long the selection has to hold still, during a run of quick switches,
 * before the episode's videos and frames are asked for. Under a deliberate
 * double-click's spacing and above a held key's repeat (TASK-492).
 */
const EPISODE_SETTLE_MS = 250;

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
/**
 * The floor is what the side-by-side stage still reads at. It is well under
 * what a 1280×720 window has left (400 px), so a title that wraps or a view's
 * banner above the stage shrinks it instead of pushing the transport bar under
 * the fold.
 */
const STAGE_FILL = { min: 320, max: 900, gap: 16 } as const;

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
  // The episode the address asks for, per dataset: read when a dataset opens,
  // and kept in step with the selection, so a reload of the list keeps it.
  const requestedEpisodeRef = useRef({ datasetId, episode: searchParams.get('episode') });
  if (requestedEpisodeRef.current.datasetId !== datasetId) {
    requestedEpisodeRef.current = { datasetId, episode: searchParams.get('episode') };
  }
  // `setSearchParams` changes identity with the address; the callbacks that
  // write `?episode=` stay stable by reaching it through this.
  const setSearchParamsRef = useRef(setSearchParams);
  setSearchParamsRef.current = setSearchParams;
  /**
   * The selected episode goes into the address (`?episode=N`), replacing the
   * entry, so a reload or coming back to the page opens the same episode.
   */
  const writeEpisodeParam = useCallback((index: number) => {
    requestedEpisodeRef.current = { ...requestedEpisodeRef.current, episode: String(index) };
    setSearchParamsRef.current((prev) => {
      const next = new URLSearchParams(prev);
      next.set('episode', String(index));
      return next;
    }, { replace: true });
  }, []);
  // The episode whose videos and frames are loaded. A single click moves it
  // at once; through a run of quick clicks or a held arrow key it waits for
  // the selection to stop, so the episodes passed on the way cost no requests
  // (TASK-492). The list highlight and the Curate panel follow
  // `selectedEpisode` itself.
  const stageEpisode = useSettledValue(selectedEpisode, EPISODE_SETTLE_MS);
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
  // The parent id whose request has come back, found or not: a view waits for
  // it before it says which cameras it has.
  const [parentSettledId, setParentSettledId] = useState<string | null>(null);
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
  const videoTicket = useDatasetVideoTicket(datasetId, stageEpisode);
  const { submitJob } = useTrainingJobs();

  // The feature table of info.json. A view owns no files and no info.json: its
  // features are its parent's. `undefined` while that is not known yet (this
  // dataset's row, or a view's parent, has not arrived), `null` when the
  // dataset really carries none.
  const features = useMemo((): Record<string, unknown> | null | undefined => {
    if (!dataset || dataset.id !== datasetId) return undefined;
    const own = dataset.infoJson?.features as Record<string, unknown> | undefined;
    if (own) return own;
    if (isDatasetView(dataset) && dataset.parentDatasetId) {
      if (parentSettledId !== dataset.parentDatasetId) return undefined;
      return (parentDataset?.infoJson?.features as Record<string, unknown> | undefined) ?? null;
    }
    return null;
  }, [dataset, datasetId, parentDataset, parentSettledId]);

  // Camera feature keys (dtype video/image). State-only datasets have none; the
  // legacy wrist/top guess applies only to a dataset that has been read and
  // carries no feature metadata at all. Null until the features are known:
  // guessing before then asked for a `wrist` video the dataset does not have.
  const cameraNames = useMemo(() => {
    if (features === undefined) return null;
    return features ? cameraKeys(features) : LEGACY_CAMERAS;
  }, [features]);

  // Channel names out of info.json, per vector.
  const infoNames = useMemo(() => {
    const named = features as Record<string, { names?: unknown }> | null | undefined;
    // names is a flat array, a nested array (Unitree) or an object of arrays (pusht, xarm)
    const of = (key: string) => featureNames(named?.[key]?.names).map((n) => n.replace('.pos', ''));
    return { state: of('observation.state'), action: of('action') };
  }, [features]);

  // GR00T-style datasets put one placeholder name on a 43-wide vector and keep
  // the real layout in meta/modality.json (TASK-476): label by group and index.
  // A dataset that has both groups and a real name per channel keeps the names.
  const groupedVector = modality?.action.length ? 'action' : 'state';
  const jointGroups = useMemo(() => modality?.[groupedVector] ?? [], [modality, groupedVector]);
  const jointNames = useMemo(() => {
    if (jointGroups.length > 0) {
      const key = groupedVector === 'action' ? 'action' : 'observation.state';
      const shape = (features as Record<string, { shape?: unknown }> | null | undefined)?.[key]?.shape;
      const declared = Array.isArray(shape) && typeof shape[0] === 'number' ? shape[0] : 0;
      // One list labels the state line and the action line of a channel: where
      // the two vectors name a channel differently, the index is the honest label.
      const names = infoNames[groupedVector];
      const agreed = channelNamesAgree(names, infoNames[groupedVector === 'action' ? 'state' : 'action']) ? names : undefined;
      return channelLabels(jointGroups, Math.max(declared, ...jointGroups.map((g) => g.end)), agreed);
    }
    return infoNames.action.length ? infoNames.action : DEFAULT_JOINTS;
  }, [features, jointGroups, groupedVector, infoNames]);

  // The codec each camera's video is stored in, so the player can say when
  // this browser cannot play it instead of showing a blank box (TASK-478).
  const codecFor = useCallback(
    (cam: string) => featureVideoCodec(features?.[cam]),
    [features]
  );

  const primaryCamera = cameraNames?.[0];
  const selectedMeta = useMemo(() => episodes.find((e) => e.index === selectedEpisode) ?? null, [episodes, selectedEpisode]);
  const stageMeta = useMemo(() => episodes.find((e) => e.index === stageEpisode) ?? null, [episodes, stageEpisode]);
  const stagePosition = useMemo(() => episodes.findIndex((e) => e.index === stageEpisode), [episodes, stageEpisode]);
  // v3.0 chunked datasets: the episode's window inside the chunk video, per camera.
  const videoWindows = stageMeta?.videoWindows;
  const windowFor = useCallback((cam: string) => videoWindows?.[cam], [videoWindows]);

  const playback = useEpisodePlayback({
    episodeKey: datasetId && stageEpisode !== null ? `${datasetId}:${stageEpisode}` : null,
    datasetKey: datasetId,
    primaryCamera,
    windowFor,
    fallbackDuration: stageMeta?.durationSeconds ?? 0,
  });
  const { currentTime } = playback;

  // Aborted when another episode is opened, retried by itself after a passing
  // failure. While the selection has moved on and the stage has not caught up,
  // what is in hand is the previous episode's: the chart reads as loading.
  const episodeFrames = useEpisodeFrames(datasetId, stageEpisode);
  const stageCurrent = stageEpisode === selectedEpisode;
  const frames = episodeFrames.frames;
  const framesLoading = episodeFrames.isLoading || !stageCurrent;
  const framesError = stageCurrent ? episodeFrames.error : null;

  const stage = useViewportFill<HTMLDivElement>(STAGE_FILL);
  // One camera in a wide window always sits beside the chart: across the
  // width a single 4:3 picture would be a stamp in a wide black box (TASK-501).
  const singleCamera = cameraNames?.length === 1;
  const stageLayout =
    stage.height !== null && stage.viewportWidth >= SIDE_FROM_PX && (stage.height < STACKED_FROM_PX || singleCamera)
      ? 'side'
      : 'stacked';
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
      .then((p) => { if (!cancelled) { setParentDataset(p); setParentSettledId(parentId); } })
      .catch(() => { if (!cancelled) { setParentDataset(null); setParentSettledId(parentId); } });
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
        const asked = requestedEpisodeRef.current.episode;
        const requested = eps.find((e) => String(e.index) === asked);
        if (eps.length === 0) return;
        const opened = (requested ?? eps[0]!).index;
        setSelectedEpisode(opened);
        // An episode the dataset does not have: open the first one and say so,
        // in the address too, instead of quietly showing another episode.
        if (asked !== null && !requested) {
          writeEpisodeParam(opened);
          toast.info(`Episode ${asked} is not in this dataset`, { description: `Showing episode ${opened} instead.` });
        }
      })
      .catch((err) => {
        setEpisodes([]);
        const e = err as { detail?: unknown; details?: unknown } | null;
        const detail = e?.details ?? e?.detail;
        setEpisodesError(typeof detail === 'string' ? `${errorMessage(err, 'unknown error')} — ${detail}` : errorMessage(err, 'unknown error'));
      })
      .finally(() => setEpisodesLoading(false));
  }, [datasetId, reloadKey, writeEpisodeParam]);

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

  /** Open another episode from the list. A typed trim range was the previous episode's. */
  const selectEpisode = useCallback((index: number) => {
    setSelectedEpisode((prev) => {
      if (prev !== index) {
        setTrimStart(0);
        setTrimEnd('');
      }
      return index;
    });
    writeEpisodeParam(index);
  }, [writeEpisodeParam]);

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
    // One click writes a whole new dataset: asked first, like the delete (TASK-501).
    const ok = await confirm({
      title: `Trim episode ${selectedEpisode}?`,
      description: `Frames ${trimStart} to ${trimEnd === '' ? 'the end' : trimEnd} are kept. A new dataset revision is written with the shortened episode; the original is kept.`,
      confirmLabel: 'Trim',
    });
    if (!ok) return;
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
    writeEpisodeParam(s.episode);
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
  }, [handleDeleteEpisode, writeEpisodeParam]);

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
              {/* Said as provenance, the repo linked at its commit (TASK-494) */}
              <DatasetProvenance dataset={dataset} />
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
        ) : selectedEpisode === null || stageEpisode === null || !cameraNames ? (
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
              srcFor={(cam) => trainingApi.getEpisodeVideoUrl(datasetId, stageEpisode, cam, windowFor(cam), videoTicket.ticket)}
              codecFor={codecFor}
              ready={videoTicket.ready}
              onReload={videoTicket.refresh}
              primaryCamera={primaryCamera}
              videoRefs={playback.videoRefs}
              onTimeUpdate={playback.onTimeUpdate}
              onLoadedMetadata={playback.onLoadedMetadata}
              onEnded={playback.onEnded}
              probeThrottle={probeVideoThrottle}
              onPlayingChange={playback.onPlayingChange}
              onFailure={playback.onFailure}
              layout={stageLayout}
              episode={stagePosition >= 0 ? { index: stageEpisode, position: stagePosition + 1, count: episodes.length } : undefined}
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
              sampleCount={episodeFrames.total}
              jointNames={jointNames}
              groups={jointGroups}
              isLoading={framesLoading}
              currentTime={currentTime}
              isPlaying={playback.isPlaying}
              error={framesError}
              onRetry={episodeFrames.retry}
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
          // The episode list knows the length at once; failing that, the frames
          // answer carries the episode's real count — the frames themselves are
          // capped and thinned for the chart, so their number says nothing.
          frameCount={selectedMeta?.frameCount ?? (stageCurrent ? episodeFrames.total : null)}
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

      {/* Its comments are a request per episode: asked for the settled one. */}
      {activeTab === 'episode-discussion' && stageEpisode !== null && (
        <Panel>
          <SocialPanel
            subject={{ subjectType: 'episode', subjectId: datasetId, episodeIndex: stageEpisode }}
            title={`Episode ${stageEpisode} discussion`}
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
