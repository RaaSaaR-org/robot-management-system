/**
 * @file DatasetEpisodesPage.tsx
 * @description Dataset episode viewer with synchronized video playback and joint trajectory charts
 * @feature training
 */

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Play, Pause, Flag, Film, Activity, Clock, Layers, Gauge, MessageSquareText, Sparkles, ArrowRight, X } from 'lucide-react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
} from 'recharts';
import { Spinner } from '@/shared/components/ui';
import { evaluationApi } from '@/features/evaluation/api/evaluationApi';
import type { EpisodeReward } from '@/features/evaluation/types/evaluation.types';
import { trainingApi } from '../api/trainingApi';
import type { Dataset, EpisodeMeta, FrameData, EpisodeAnnotation, CurationResult, CurationSuggestion } from '../types';

const JOINT_COLORS: Record<string, string> = {
  shoulder_pan: '#3b82f6',
  shoulder_lift: '#22c55e',
  elbow_flex: '#f97316',
  wrist_flex: '#ef4444',
  wrist_roll: '#a855f7',
  gripper: '#6b7280',
};

const SPEED_OPTIONS = [0.5, 1, 2] as const;

/**
 * Extract a displayable message from a failed API call. The axios client
 * rejects with a plain ApiError object ({ code, message, ... }), NOT an Error
 * instance — an instanceof check alone would swallow the server's structured
 * curation errors (e.g. V3_TRIM_UNSUPPORTED, FFMPEG_MISSING).
 */
function errText(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === 'object' && typeof (err as { message?: unknown }).message === 'string') {
    return (err as { message: string }).message;
  }
  return 'unknown error';
}

/** Chip styling for a reward-model episode score (green > 0.7, orange > 0.4, red below). */
function scoreChipCls(score: number): string {
  if (score > 0.7) return 'text-green-400 bg-green-500/10';
  if (score > 0.4) return 'text-orange-400 bg-orange-500/10';
  return 'text-red-400 bg-red-500/10';
}

export function DatasetEpisodesPage() {
  const { datasetId } = useParams<{ datasetId: string }>();
  const navigate = useNavigate();

  const [dataset, setDataset] = useState<Dataset | null>(null);
  const [episodes, setEpisodes] = useState<EpisodeMeta[]>([]);
  const [episodesLoading, setEpisodesLoading] = useState(false);
  const [selectedEpisode, setSelectedEpisode] = useState<number | null>(null);
  const [frames, setFrames] = useState<FrameData[]>([]);
  const [framesLoading, setFramesLoading] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(1);
  const [flaggedMap, setFlaggedMap] = useState<Record<number, boolean>>({});
  const [trimStart, setTrimStart] = useState(0);
  const [trimEnd, setTrimEnd] = useState<number | ''>('');
  const [curating, setCurating] = useState(false);
  const [curationMsg, setCurationMsg] = useState<string | null>(null);
  // Outcome of the last successful curation edit: the new dataset revision
  const [newDataset, setNewDataset] = useState<{ id: string; name?: string } | null>(null);
  // AI curation suggestions (Phase-2 "video-use") — human reviews & applies
  const [suggestions, setSuggestions] = useState<CurationSuggestion[]>([]);
  const [suggesting, setSuggesting] = useState(false);
  const [suggestMsg, setSuggestMsg] = useState<string | null>(null);
  // Reward-model scores + VLM annotations (LeRobot 0.6.0, TASK-179)
  const [rewardsByEpisode, setRewardsByEpisode] = useState<Record<number, EpisodeReward>>({});
  const [annotations, setAnnotations] = useState<EpisodeAnnotation[]>([]);
  const [annotating, setAnnotating] = useState(false);
  const [annotationMsg, setAnnotationMsg] = useState<string | null>(null);

  const videoRefs = useRef<Record<string, HTMLVideoElement | null>>({});

  // Derive camera names from dataset features
  const cameraNames = useMemo(() => {
    if (!dataset?.infoJson?.features) return ['wrist', 'top'];
    const names = Object.keys(dataset.infoJson.features as Record<string, unknown>)
      .filter((k) => k.startsWith('observation.images.'))
      .map((k) => k.replace('observation.images.', ''));
    return names.length > 0 ? names : ['wrist', 'top'];
  }, [dataset]);

  // Derive joint names from dataset features
  const jointNames = useMemo(() => {
    if (!dataset?.infoJson?.features) return Object.keys(JOINT_COLORS);
    const actionFeature = (dataset.infoJson.features as Record<string, { names?: unknown[] }>)?.['action'];
    if (actionFeature?.names?.length) {
      // Unitree-style datasets nest names as [["kLeftShoulderPitch", ...]] — flatten first
      const flat = actionFeature.names.flat(2).filter((n): n is string => typeof n === 'string');
      if (flat.length) return flat.map((n) => n.replace('.pos', ''));
    }
    return Object.keys(JOINT_COLORS);
  }, [dataset]);

  const primaryCamera = cameraNames[0];

  // v3.0 chunked datasets: playback window of the selected episode inside the
  // concatenated chunk video, per camera (absent for v2.x per-episode files —
  // there the whole file IS the episode and no offsetting is needed).
  const selectedEpisodeMeta = useMemo(
    () => episodes.find((e) => e.index === selectedEpisode) ?? null,
    [episodes, selectedEpisode]
  );
  const videoWindows = selectedEpisodeMeta?.videoWindows;
  const windowFor = useCallback(
    (cam: string) => videoWindows?.[cam],
    [videoWindows]
  );
  const primaryWindow = videoWindows?.[primaryCamera];

  // Fetch dataset
  useEffect(() => {
    if (!datasetId) return;
    trainingApi.getDataset(datasetId)
      .then(setDataset)
      .catch(() => setDataset(null));
  }, [datasetId]);

  // Load episodes
  useEffect(() => {
    if (!datasetId) return;
    setEpisodesLoading(true);
    setSelectedEpisode(null);
    setFrames([]);
    setCurrentTime(0);

    trainingApi.getEpisodes(datasetId)
      .then((eps) => {
        setEpisodes(eps);
        const flagMap: Record<number, boolean> = {};
        for (const ep of eps) {
          if (ep.flagged) flagMap[ep.index] = true;
        }
        setFlaggedMap(flagMap);
        // Auto-select first episode
        if (eps.length > 0) setSelectedEpisode(eps[0].index);
      })
      .catch(() => setEpisodes([]))
      .finally(() => setEpisodesLoading(false));
  }, [datasetId]);

  // Load reward-model episode scores once per dataset (absence is fine —
  // chips/panels simply don't render). Cancellation guard: a slow response
  // for a previous dataset must not clobber the current one. (TASK-179)
  useEffect(() => {
    if (!datasetId) return;
    let cancelled = false;
    setRewardsByEpisode({});
    evaluationApi.listRewards(datasetId)
      .then((rewards) => {
        if (cancelled) return;
        const byEpisode: Record<number, EpisodeReward> = {};
        for (const r of rewards) {
          const existing = byEpisode[r.episodeIndex];
          if (!existing || new Date(r.createdAt) > new Date(existing.createdAt)) {
            byEpisode[r.episodeIndex] = r;
          }
        }
        setRewardsByEpisode(byEpisode);
      })
      .catch(() => {
        if (!cancelled) setRewardsByEpisode({});
      });
    return () => {
      cancelled = true;
    };
  }, [datasetId]);

  // Load VLM annotations once per dataset (TASK-179)
  useEffect(() => {
    if (!datasetId) return;
    let cancelled = false;
    setAnnotations([]);
    setAnnotationMsg(null);
    trainingApi.getAnnotations(datasetId)
      .then((a) => {
        if (!cancelled) setAnnotations(a);
      })
      .catch(() => {
        if (!cancelled) setAnnotations([]);
      });
    return () => {
      cancelled = true;
    };
  }, [datasetId]);

  // Load frames when episode selected
  useEffect(() => {
    if (!datasetId || selectedEpisode === null) return;
    const ep = episodes.find((e) => e.index === selectedEpisode);
    if (ep) setDuration(ep.durationSeconds);

    setFramesLoading(true);
    trainingApi.getEpisodeFrames(datasetId, selectedEpisode, 0, 2000)
      .then((result) => setFrames(result.frames))
      .catch(() => setFrames([]))
      .finally(() => setFramesLoading(false));
  }, [datasetId, selectedEpisode, episodes]);

  // Sync playback speed
  useEffect(() => {
    for (const ref of Object.values(videoRefs.current)) {
      if (ref) ref.playbackRate = playbackSpeed;
    }
  }, [playbackSpeed]);

  const handleTimeUpdate = useCallback(() => {
    const primary = videoRefs.current[primaryCamera];
    if (!primary) return;
    const primaryWin = windowFor(primaryCamera);
    const rel = primary.currentTime - (primaryWin?.from ?? 0);
    setCurrentTime(rel);
    // Media fragments (#t=from,to) pause at `to` in most browsers, but clamp
    // manually too so a chunked episode never bleeds into the next episode.
    if (primaryWin && primary.currentTime >= primaryWin.to - 0.05) {
      for (const ref of Object.values(videoRefs.current)) ref?.pause();
      setIsPlaying(false);
      return;
    }
    for (const [name, ref] of Object.entries(videoRefs.current)) {
      if (!ref || name === primaryCamera) continue;
      const target = (windowFor(name)?.from ?? 0) + rel;
      if (Math.abs(ref.currentTime - target) > 0.1) {
        ref.currentTime = target;
      }
    }
  }, [primaryCamera, windowFor]);

  const handleLoadedMetadata = useCallback(() => {
    // Chunked (v3.0) episode: duration is the episode's window, NOT the
    // full chunk video's metadata duration (that one spans ~all episodes).
    if (primaryWindow) {
      setDuration(primaryWindow.to - primaryWindow.from);
      return;
    }
    const primary = videoRefs.current[primaryCamera];
    if (primary && isFinite(primary.duration)) {
      setDuration(primary.duration);
    }
  }, [primaryCamera, primaryWindow]);

  const handlePlayPause = useCallback(() => {
    const entries = Object.entries(videoRefs.current).filter(([, v]) => Boolean(v)) as [string, HTMLVideoElement][];
    if (entries.length === 0) return;
    const primary = videoRefs.current[primaryCamera] ?? entries[0][1];
    if (primary.paused) {
      // Replay from the episode's window start if we stopped at its end.
      const primaryWin = windowFor(primaryCamera);
      if (primaryWin && primary.currentTime >= primaryWin.to - 0.1) {
        for (const [name, ref] of entries) {
          ref.currentTime = windowFor(name)?.from ?? 0;
        }
      }
      entries.forEach(([, v]) => v.play());
      setIsPlaying(true);
    } else {
      entries.forEach(([, v]) => v.pause());
      setIsPlaying(false);
    }
  }, [primaryCamera, windowFor]);

  const handleSeek = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const time = parseFloat(e.target.value);
    setCurrentTime(time);
    for (const [name, ref] of Object.entries(videoRefs.current)) {
      if (ref) ref.currentTime = (windowFor(name)?.from ?? 0) + time;
    }
  }, [windowFor]);

  const handleFlagToggle = useCallback(async (episodeIndex: number) => {
    if (!datasetId) return;
    const newFlagged = !flaggedMap[episodeIndex];
    setFlaggedMap((prev) => ({ ...prev, [episodeIndex]: newFlagged }));
    try {
      await trainingApi.flagEpisode(datasetId, episodeIndex, newFlagged);
    } catch {
      setFlaggedMap((prev) => ({ ...prev, [episodeIndex]: !newFlagged }));
    }
  }, [datasetId, flaggedMap]);

  /** Record the outcome of a successful curation edit (new dataset revision). */
  const recordCurationOutcome = useCallback((verb: string, result: CurationResult) => {
    const revision = result.newDatasetName ? `new dataset "${result.newDatasetName}"` : 'new revision';
    setCurationMsg(`${verb} → ${revision}: ${result.total_episodes} episodes, ${result.total_frames} frames.`);
    setNewDataset(result.newDatasetId ? { id: result.newDatasetId, name: result.newDatasetName } : null);
  }, []);

  const handleDeleteEpisode = useCallback(async (episodeIndex?: number): Promise<boolean> => {
    const target = episodeIndex ?? selectedEpisode;
    if (!datasetId || target === null) return false;
    if (!window.confirm(`Delete episode ${target}? A new dataset revision is written (the original is kept).`)) {
      return false;
    }
    setCurating(true);
    setCurationMsg(null);
    try {
      const result = await trainingApi.deleteEpisodes(datasetId, [target]);
      recordCurationOutcome('Deleted', result);
      return true;
    } catch (err) {
      setCurationMsg(`Delete failed: ${errText(err)}`);
      return false;
    } finally {
      setCurating(false);
    }
  }, [datasetId, selectedEpisode, recordCurationOutcome]);

  const handleTrimEpisode = useCallback(async () => {
    if (!datasetId || selectedEpisode === null) return;
    const end = trimEnd === '' ? null : Number(trimEnd);
    setCurating(true);
    setCurationMsg(null);
    try {
      const result = await trainingApi.trimEpisode(datasetId, selectedEpisode, trimStart, end);
      recordCurationOutcome('Trimmed', result);
    } catch (err) {
      setCurationMsg(`Trim failed: ${errText(err)}`);
    } finally {
      setCurating(false);
    }
  }, [datasetId, selectedEpisode, trimStart, trimEnd, recordCurationOutcome]);

  // AI suggestions ("video-use" Phase 2) — never auto-applied
  const handleSuggest = useCallback(async () => {
    if (!datasetId) return;
    setSuggesting(true);
    setSuggestMsg(null);
    try {
      const result = await trainingApi.suggestCuration(datasetId);
      setSuggestions(result.suggestions);
      if (result.suggestions.length === 0) {
        setSuggestMsg('No curation suggestions — episodes look clean.');
      }
    } catch (err) {
      setSuggestions([]);
      setSuggestMsg(`Suggest failed: ${errText(err)}`);
    } finally {
      setSuggesting(false);
    }
  }, [datasetId]);

  const dismissSuggestion = useCallback((index: number) => {
    setSuggestions((prev) => prev.filter((_, i) => i !== index));
  }, []);

  /** Apply a suggestion: trims prefill the trim inputs, deletes run the (confirmed) delete flow. */
  const applySuggestion = useCallback((suggestion: CurationSuggestion) => {
    setSelectedEpisode(suggestion.episode);
    if (suggestion.kind === 'trim') {
      setTrimStart(suggestion.start ?? 0);
      setTrimEnd(suggestion.end ?? '');
      setSuggestMsg(`Trim range [${suggestion.start ?? 0}, ${suggestion.end ?? 'end'}) prefilled for episode ${suggestion.episode} — review and press "Trim range".`);
    } else {
      void handleDeleteEpisode(suggestion.episode).then((ok) => {
        // Remove by identity, not by index — the list may have shifted while
        // the confirm dialog / API call was pending.
        if (ok) setSuggestions((prev) => prev.filter((s) => s !== suggestion));
      });
    }
  }, [handleDeleteEpisode]);

  const handleStartAnnotation = useCallback(async () => {
    if (!datasetId) return;
    setAnnotating(true);
    setAnnotationMsg(null);
    try {
      const { jobId } = await trainingApi.startAnnotation(datasetId);
      setAnnotationMsg(`Annotation job queued (${jobId}). Subtasks + VQA pairs appear here once the worker completes.`);
    } catch (err) {
      setAnnotationMsg(`Annotation failed to start: ${err instanceof Error ? err.message : 'unknown error'}`);
    } finally {
      setAnnotating(false);
    }
  }, [datasetId]);

  // Reward curve + annotation for the selected episode (TASK-179)
  const selectedReward = selectedEpisode !== null ? rewardsByEpisode[selectedEpisode] : undefined;
  const rewardCurveData = useMemo(() => {
    if (!selectedReward || selectedReward.curve.length < 2) return [];
    // `fps` is the CURVE's sampling rate (curve points per second of episode
    // time), not the video fps: the worker defines t(curve[j]) ≈ (j + 1) / fps.
    const fps = selectedReward.fps ?? dataset?.fps ?? 30;
    return selectedReward.curve.map((value, i) => ({
      timestamp: +((i + 1) / fps).toFixed(3),
      progress: value,
    }));
  }, [selectedReward, dataset]);
  const selectedAnnotation = useMemo(
    () => (selectedEpisode !== null ? annotations.find((a) => a.episodeIndex === selectedEpisode) : undefined),
    [annotations, selectedEpisode]
  );

  // Chart data
  const chartData = frames.map((frame) => {
    const point: Record<string, number> = { timestamp: frame.timestamp };
    jointNames.forEach((name, i) => {
      point[`action_${name}`] = frame.action[i] ?? 0;
      point[`obs_${name}`] = frame.observationState[i] ?? 0;
    });
    return point;
  });

  const formatTime = (seconds: number): string => {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  if (!datasetId) {
    return (
      <div className="flex items-center justify-center py-12">
        <p className="text-theme-secondary">Invalid Dataset ID</p>
      </div>
    );
  }

  const totalDatasetFrames = dataset?.totalFrames ?? 0;
  const totalDuration = dataset ? formatTime(dataset.totalDuration) : '0:00';

  return (
    <div className="space-y-4">
      {/* ── Header ── */}
      <header className="flex items-center gap-4 px-4 py-3 rounded-xl bg-[#1E1F24]/60 backdrop-blur-sm border border-white/[0.04]">
        <button
          onClick={() => navigate('/datasets')}
          className="p-2 rounded-lg hover:bg-white/[0.06] transition-colors"
          title="Back to Datasets"
        >
          <ArrowLeft className="w-5 h-5 text-theme-tertiary" />
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="text-lg font-semibold text-theme-primary truncate">
            {dataset?.name ?? 'Loading...'}
          </h1>
          <div className="flex items-center gap-4 mt-0.5 text-xs text-theme-tertiary">
            <span className="inline-flex items-center gap-1">
              <Layers className="w-3 h-3" />
              {episodes.length} episodes
            </span>
            <span className="inline-flex items-center gap-1">
              <Film className="w-3 h-3" />
              {totalDatasetFrames.toLocaleString()} frames
            </span>
            <span className="inline-flex items-center gap-1">
              <Activity className="w-3 h-3" />
              {dataset?.fps ?? 0} fps
            </span>
            <span className="inline-flex items-center gap-1">
              <Clock className="w-3 h-3" />
              {totalDuration}
            </span>
            <span className="inline-flex items-center gap-1">
              <Film className="w-3 h-3" />
              {cameraNames.length} cam{cameraNames.length !== 1 ? 's' : ''}
            </span>
          </div>
        </div>
      </header>

      {/* ── Main layout ── */}
      <div className="flex flex-col lg:flex-row gap-3 min-h-[500px]">
        {/* ── Episode Sidebar ── */}
        <div className="lg:w-[220px] shrink-0 flex flex-col">
          {/* Mobile dropdown */}
          <div className="block lg:hidden mb-3">
            <select
              value={selectedEpisode ?? ''}
              onChange={(e) => setSelectedEpisode(e.target.value === '' ? null : parseInt(e.target.value, 10))}
              className="w-full px-3 py-2 rounded-lg border border-white/[0.06] bg-[#1E1F24] text-theme-primary text-sm"
            >
              <option value="">Select episode...</option>
              {episodes.map((ep) => (
                <option key={ep.index} value={ep.index}>
                  Ep {ep.index} — {ep.frameCount} frames
                  {rewardsByEpisode[ep.index] ? ` · score ${rewardsByEpisode[ep.index].score.toFixed(2)}` : ''}
                </option>
              ))}
            </select>
          </div>

          {/* Desktop list */}
          <div
            className="hidden lg:flex flex-col overflow-y-auto rounded-xl border border-white/[0.04] bg-[#1E1F24]/40"
            style={{ maxHeight: 'calc(100vh - 10rem)' }}
          >
            <div className="px-3 py-2 border-b border-white/[0.04]">
              <span className="text-[11px] font-medium uppercase tracking-wider text-theme-tertiary">
                Episodes
              </span>
            </div>
            {episodesLoading ? (
              <div className="flex items-center justify-center py-8">
                <Spinner size="sm" label="Loading..." />
              </div>
            ) : episodes.length === 0 ? (
              <div className="text-center py-8 text-theme-tertiary text-xs">No episodes</div>
            ) : (
              <div>
                {episodes.map((ep) => {
                  const isActive = selectedEpisode === ep.index;
                  const isFlagged = flaggedMap[ep.index];
                  const reward = rewardsByEpisode[ep.index];
                  return (
                    <div
                      key={ep.index}
                      role="button"
                      tabIndex={0}
                      onClick={() => setSelectedEpisode(ep.index)}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setSelectedEpisode(ep.index); }}
                      className={`w-full text-left px-3 py-2 transition-all duration-150 border-l-2 cursor-pointer ${
                        isActive
                          ? 'border-cobalt-500 bg-cobalt-500/10'
                          : 'border-transparent hover:bg-white/[0.03]'
                      } ${isFlagged ? 'bg-red-500/5' : ''}`}
                    >
                      <div className="flex items-center justify-between">
                        <span className={`inline-flex items-center gap-1.5 text-sm font-medium ${isActive ? 'text-cobalt-400' : 'text-theme-primary'}`}>
                          Episode {ep.index}
                          {reward && (
                            <span
                              className={`px-1 py-px rounded text-[10px] font-mono font-medium ${scoreChipCls(reward.score)}`}
                              title={`${reward.rewardType} score`}
                            >
                              {reward.score.toFixed(2)}
                            </span>
                          )}
                        </span>
                        <button
                          onClick={(e) => { e.stopPropagation(); handleFlagToggle(ep.index); }}
                          className={`p-0.5 rounded transition-colors ${
                            isFlagged ? 'text-red-400' : 'text-theme-tertiary/40 hover:text-theme-tertiary'
                          }`}
                          title={isFlagged ? 'Unflag' : 'Flag'}
                        >
                          <Flag className="w-3 h-3" />
                        </button>
                      </div>
                      <div className="text-[11px] text-theme-tertiary mt-0.5">
                        {ep.frameCount} frames &middot; {formatTime(ep.durationSeconds)}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* ── Viewer Panel ── */}
        <div className="flex-1 space-y-3 overflow-y-auto">
          {selectedEpisode === null ? (
            <div className="flex items-center justify-center h-full text-theme-tertiary text-sm">
              Select an episode
            </div>
          ) : (
            <>
              {/* ── Video Player ── */}
              <div className="rounded-xl overflow-hidden border border-white/[0.04] bg-[#0A0A0A]">
                <div className={`grid gap-px bg-white/[0.02] ${cameraNames.length === 1 ? 'grid-cols-1' : 'grid-cols-1 lg:grid-cols-2'}`}>
                  {cameraNames.map((cam) => (
                    <div key={cam} className="relative bg-black">
                      <span className="absolute top-2 left-2 z-10 px-1.5 py-0.5 rounded text-[10px] font-medium tracking-wide uppercase text-white/70 bg-black/60 backdrop-blur-sm">
                        {cam}
                      </span>
                      <video
                        ref={(el) => { videoRefs.current[cam] = el; }}
                        src={trainingApi.getEpisodeVideoUrl(datasetId, selectedEpisode, cam, windowFor(cam))}
                        onTimeUpdate={cam === primaryCamera ? handleTimeUpdate : undefined}
                        onLoadedMetadata={cam === primaryCamera ? handleLoadedMetadata : undefined}
                        onEnded={cam === primaryCamera ? () => setIsPlaying(false) : undefined}
                        className="w-full aspect-video"
                        playsInline
                      />
                    </div>
                  ))}
                </div>

                {/* Playback Controls */}
                <div className="flex items-center gap-3 px-3 py-2 bg-[#1E1F24]/80 border-t border-white/[0.04]">
                  <button
                    onClick={handlePlayPause}
                    className="w-8 h-8 flex items-center justify-center rounded-full bg-cobalt-500/15 hover:bg-cobalt-500/25 text-cobalt-400 transition-colors"
                  >
                    {isPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5 ml-0.5" />}
                  </button>

                  <span className="text-[11px] text-theme-tertiary font-mono tabular-nums w-[72px]">
                    {formatTime(currentTime)} / {formatTime(duration)}
                  </span>

                  <input
                    type="range"
                    min={0}
                    max={duration || 1}
                    step={0.05}
                    value={currentTime}
                    onChange={handleSeek}
                    className="flex-1 h-1 rounded-full appearance-none cursor-pointer bg-white/10 accent-cobalt-500 [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-cobalt-500 [&::-webkit-slider-thumb]:appearance-none"
                  />

                  {/* Speed pills */}
                  <div className="flex gap-0.5 rounded-full bg-white/[0.04] p-0.5">
                    {SPEED_OPTIONS.map((speed) => (
                      <button
                        key={speed}
                        onClick={() => setPlaybackSpeed(speed)}
                        className={`px-2 py-0.5 rounded-full text-[10px] font-medium transition-colors ${
                          playbackSpeed === speed
                            ? 'bg-cobalt-500/20 text-cobalt-400'
                            : 'text-theme-tertiary hover:text-theme-secondary'
                        }`}
                      >
                        {speed}x
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* ── Curate: trim / delete (non-destructive — writes a new revision) ── */}
              <div
                data-testid="curate-panel"
                className="flex flex-wrap items-center gap-2 px-3 py-2 rounded-lg border border-white/[0.06] bg-[#1E1F24]/60"
              >
                <span className="text-[11px] font-medium text-theme-secondary">Curate</span>
                <label className="text-[11px] text-theme-tertiary flex items-center gap-1">
                  start
                  <input
                    type="number"
                    min={0}
                    value={trimStart}
                    onChange={(e) => setTrimStart(Math.max(0, parseInt(e.target.value, 10) || 0))}
                    className="w-16 px-1.5 py-0.5 rounded border border-white/10 bg-[#141414] text-theme-primary text-[11px]"
                  />
                </label>
                <label className="text-[11px] text-theme-tertiary flex items-center gap-1">
                  end
                  <input
                    type="number"
                    min={0}
                    placeholder={String(frames.length)}
                    value={trimEnd}
                    onChange={(e) => setTrimEnd(e.target.value === '' ? '' : Math.max(0, parseInt(e.target.value, 10) || 0))}
                    className="w-16 px-1.5 py-0.5 rounded border border-white/10 bg-[#141414] text-theme-primary text-[11px]"
                  />
                </label>
                <button
                  data-testid="curate-trim"
                  disabled={curating}
                  onClick={handleTrimEpisode}
                  className="px-2.5 py-1 rounded text-[11px] font-medium bg-cobalt-500/15 hover:bg-cobalt-500/25 text-cobalt-400 disabled:opacity-50 transition-colors"
                >
                  Trim range
                </button>
                <button
                  data-testid="curate-delete"
                  disabled={curating}
                  onClick={() => handleDeleteEpisode()}
                  className="px-2.5 py-1 rounded text-[11px] font-medium bg-red-500/15 hover:bg-red-500/25 text-red-400 disabled:opacity-50 transition-colors"
                >
                  Delete episode
                </button>
                <button
                  data-testid="curate-suggest"
                  disabled={suggesting}
                  onClick={handleSuggest}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded text-[11px] font-medium bg-purple-500/15 hover:bg-purple-500/25 text-purple-400 disabled:opacity-50 transition-colors"
                >
                  <Sparkles className="w-3 h-3" />
                  {suggesting ? 'Analyzing…' : 'AI suggest'}
                </button>
                {curationMsg && (
                  <span data-testid="curation-message" className="text-[11px] text-theme-tertiary basis-full">
                    {curationMsg}
                  </span>
                )}
                {newDataset && (
                  <button
                    data-testid="curate-open-new"
                    onClick={() => {
                      setNewDataset(null);
                      setCurationMsg(null);
                      setSuggestions([]);
                      navigate(`/datasets/${newDataset.id}/episodes`);
                    }}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded text-[11px] font-medium bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-400 transition-colors"
                  >
                    Open curated dataset
                    <ArrowRight className="w-3 h-3" />
                  </button>
                )}
                {suggestMsg && (
                  <span data-testid="suggest-message" className="text-[11px] text-theme-tertiary basis-full">
                    {suggestMsg}
                  </span>
                )}
                {suggestions.length > 0 && (
                  <div data-testid="curate-suggestions" className="basis-full space-y-1 pt-1 border-t border-white/[0.04]">
                    <p className="text-[10px] font-medium uppercase tracking-wider text-theme-tertiary">
                      AI suggestions — review before applying
                    </p>
                    {suggestions.map((s, i) => (
                      <div
                        key={`${s.episode}-${s.kind}-${i}`}
                        data-testid={`curate-suggestion-${i}`}
                        className="flex items-center gap-2 text-[11px] text-theme-secondary"
                      >
                        <span className={`px-1 py-px rounded text-[10px] font-medium ${
                          s.kind === 'delete' ? 'text-red-400 bg-red-500/10' : 'text-cobalt-400 bg-cobalt-500/10'
                        }`}>
                          {s.kind}
                        </span>
                        <span className="font-mono tabular-nums shrink-0">
                          Ep {s.episode}
                          {s.kind === 'trim' && s.start !== undefined ? ` [${s.start}, ${s.end ?? 'end'})` : ''}
                        </span>
                        <span className="flex-1 min-w-0 truncate text-theme-tertiary" title={s.reason}>
                          {s.reason}{s.vlm ? ' · VLM' : ''} · {(s.confidence * 100).toFixed(0)}%
                        </span>
                        <button
                          data-testid={`suggest-apply-${i}`}
                          disabled={curating}
                          onClick={() => applySuggestion(s)}
                          className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-cobalt-500/15 hover:bg-cobalt-500/25 text-cobalt-400 disabled:opacity-50 transition-colors"
                        >
                          Apply
                        </button>
                        <button
                          data-testid={`suggest-dismiss-${i}`}
                          onClick={() => dismissSuggestion(i)}
                          className="p-0.5 rounded text-theme-tertiary/60 hover:text-theme-tertiary transition-colors"
                          title="Dismiss suggestion"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* ── Joint Trajectories ── */}
              {framesLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Spinner size="md" label="Loading trajectory data..." />
                </div>
              ) : chartData.length > 0 ? (
                <div className="rounded-xl border border-white/[0.04] bg-[#1E1F24]/40 p-4">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-medium text-theme-primary flex items-center gap-2">
                      <Activity className="w-4 h-4 text-cobalt-400" />
                      Joint Trajectories
                    </h3>
                    <span className="text-[10px] text-theme-tertiary">
                      {frames.length} samples &middot; solid = state, dashed = action
                    </span>
                  </div>
                  <ResponsiveContainer width="100%" height={280}>
                    <LineChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                      <XAxis
                        dataKey="timestamp"
                        type="number"
                        domain={['dataMin', 'dataMax']}
                        tickFormatter={(v: number) => v.toFixed(1)}
                        label={{ value: 'Time (s)', position: 'insideBottom', offset: -5, style: { fill: '#888', fontSize: 10 } }}
                        fontSize={10}
                        stroke="#555"
                        tick={{ fill: '#888' }}
                      />
                      <YAxis
                        fontSize={10}
                        stroke="#555"
                        tick={{ fill: '#888' }}
                        label={{ value: 'degrees', angle: -90, position: 'insideLeft', offset: 10, style: { fill: '#888', fontSize: 10 } }}
                      />
                      <Tooltip
                        contentStyle={{
                          fontSize: 11,
                          background: '#1E1F24',
                          border: '1px solid rgba(255,255,255,0.08)',
                          borderRadius: 8,
                          color: '#ccc',
                        }}
                        labelFormatter={(v: number) => `t = ${v.toFixed(2)}s`}
                      />

                      {jointNames.map((name) => (
                        <Line
                          key={`obs_${name}`}
                          type="monotone"
                          dataKey={`obs_${name}`}
                          stroke={JOINT_COLORS[name] ?? '#888'}
                          dot={false}
                          strokeWidth={1.5}
                          name={`state:${name}`}
                        />
                      ))}

                      {jointNames.map((name) => (
                        <Line
                          key={`action_${name}`}
                          type="monotone"
                          dataKey={`action_${name}`}
                          stroke={JOINT_COLORS[name] ?? '#888'}
                          dot={false}
                          strokeWidth={1}
                          strokeDasharray="4 2"
                          name={`action:${name}`}
                        />
                      ))}

                      {currentTime > 0 && (
                        <ReferenceLine
                          x={currentTime}
                          stroke="#2A5FFF"
                          strokeWidth={1.5}
                        />
                      )}
                    </LineChart>
                  </ResponsiveContainer>

                  {/* Legend */}
                  <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2">
                    {jointNames.map((name) => (
                      <span key={name} className="flex items-center gap-1.5 text-[10px] text-theme-tertiary">
                        <span
                          className="inline-block w-3 h-[2px] rounded-full"
                          style={{ backgroundColor: JOINT_COLORS[name] ?? '#888' }}
                        />
                        {name}
                      </span>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="text-center py-8 text-theme-tertiary text-sm rounded-xl border border-white/[0.04] bg-[#1E1F24]/20">
                  No trajectory data for this episode
                </div>
              )}

              {/* ── Reward-model progress curve (LeRobot 0.6.0, TASK-179) ── */}
              {selectedReward && rewardCurveData.length > 0 && (
                <div className="rounded-xl border border-white/[0.04] bg-[#1E1F24]/40 p-4">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-medium text-theme-primary flex items-center gap-2">
                      <Gauge className="w-4 h-4 text-cobalt-400" />
                      Task Progress ({selectedReward.rewardType})
                    </h3>
                    <span className={`px-1.5 py-0.5 rounded text-xs font-mono font-medium ${scoreChipCls(selectedReward.score)}`}>
                      score {selectedReward.score.toFixed(2)}
                      {selectedReward.success !== null ? (selectedReward.success ? ' · success' : ' · failure') : ''}
                    </span>
                  </div>
                  <ResponsiveContainer width="100%" height={140}>
                    <LineChart data={rewardCurveData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                      <XAxis
                        dataKey="timestamp"
                        type="number"
                        domain={['dataMin', 'dataMax']}
                        tickFormatter={(v: number) => v.toFixed(1)}
                        fontSize={10}
                        stroke="#555"
                        tick={{ fill: '#888' }}
                      />
                      <YAxis
                        domain={[0, 1]}
                        fontSize={10}
                        stroke="#555"
                        tick={{ fill: '#888' }}
                      />
                      <Tooltip
                        contentStyle={{
                          fontSize: 11,
                          background: '#1E1F24',
                          border: '1px solid rgba(255,255,255,0.08)',
                          borderRadius: 8,
                          color: '#ccc',
                        }}
                        labelFormatter={(v: number) => `t = ${v.toFixed(2)}s`}
                        formatter={(value) => [Number(value).toFixed(3), 'progress']}
                      />
                      <Line
                        type="monotone"
                        dataKey="progress"
                        stroke="#18E4C3"
                        dot={false}
                        strokeWidth={1.5}
                        name="progress"
                      />
                      {currentTime > 0 && (
                        <ReferenceLine x={currentTime} stroke="#2A5FFF" strokeWidth={1.5} />
                      )}
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}

              {/* ── VLM Annotations (lerobot-annotate, TASK-179) ── */}
              <div className="rounded-xl border border-white/[0.04] bg-[#1E1F24]/40 p-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-medium text-theme-primary flex items-center gap-2">
                    <MessageSquareText className="w-4 h-4 text-cobalt-400" />
                    Annotations
                  </h3>
                  <button
                    data-testid="annotate-dataset"
                    disabled={annotating}
                    onClick={handleStartAnnotation}
                    className="px-2.5 py-1 rounded text-[11px] font-medium bg-cobalt-500/15 hover:bg-cobalt-500/25 text-cobalt-400 disabled:opacity-50 transition-colors"
                  >
                    {annotating ? 'Queuing…' : 'Annotate dataset'}
                  </button>
                </div>

                {selectedAnnotation ? (
                  <div className="space-y-4">
                    {/* Subtasks timeline */}
                    <div>
                      <p className="text-[11px] font-medium uppercase tracking-wider text-theme-tertiary mb-1.5">
                        Subtasks
                      </p>
                      {selectedAnnotation.subtasks.length === 0 ? (
                        <p className="text-xs text-theme-tertiary">No subtasks annotated.</p>
                      ) : (
                        <div className="space-y-1">
                          {selectedAnnotation.subtasks.map((st, i) => (
                            <div key={i} className="flex items-baseline gap-2 text-xs">
                              <span className="font-mono tabular-nums text-theme-tertiary shrink-0 w-[92px]">
                                {st.startS.toFixed(1)}s – {st.endS.toFixed(1)}s
                              </span>
                              <span className="text-theme-secondary">{st.text}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* VQA pairs */}
                    {selectedAnnotation.vqa && selectedAnnotation.vqa.length > 0 && (
                      <div>
                        <p className="text-[11px] font-medium uppercase tracking-wider text-theme-tertiary mb-1.5">
                          VQA pairs
                        </p>
                        <div className="space-y-1.5">
                          {selectedAnnotation.vqa.map((pair, i) => (
                            <div key={i} className="text-xs">
                              <p className="text-theme-secondary">Q: {pair.question}</p>
                              <p className="text-theme-tertiary">A: {pair.answer}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-xs text-theme-tertiary">
                    {annotations.length > 0
                      ? 'No annotations for this episode yet.'
                      : 'No annotations yet — run lerobot-annotate to auto-fill timestamped subtasks and VQA pairs for every episode.'}
                  </p>
                )}

                {annotationMsg && (
                  <p className="text-[11px] text-theme-tertiary mt-2">{annotationMsg}</p>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
