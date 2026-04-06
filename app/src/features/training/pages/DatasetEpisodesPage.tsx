/**
 * @file DatasetEpisodesPage.tsx
 * @description Dataset episode viewer with synchronized video playback and joint trajectory charts
 * @feature training
 */

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Play, Pause, Flag, Film, Activity, Clock, Layers } from 'lucide-react';
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
import { trainingApi } from '../api/trainingApi';
import type { Dataset, EpisodeMeta, FrameData } from '../types';

const JOINT_COLORS: Record<string, string> = {
  shoulder_pan: '#3b82f6',
  shoulder_lift: '#22c55e',
  elbow_flex: '#f97316',
  wrist_flex: '#ef4444',
  wrist_roll: '#a855f7',
  gripper: '#6b7280',
};

const SPEED_OPTIONS = [0.5, 1, 2] as const;

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
    const actionFeature = (dataset.infoJson.features as Record<string, { names?: string[] }>)?.['action'];
    if (actionFeature?.names?.length) {
      return actionFeature.names.map((n: string) => n.replace('.pos', ''));
    }
    return Object.keys(JOINT_COLORS);
  }, [dataset]);

  const primaryCamera = cameraNames[0];

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
    setCurrentTime(primary.currentTime);
    for (const [name, ref] of Object.entries(videoRefs.current)) {
      if (ref && name !== primaryCamera && Math.abs(ref.currentTime - primary.currentTime) > 0.1) {
        ref.currentTime = primary.currentTime;
      }
    }
  }, [primaryCamera]);

  const handleLoadedMetadata = useCallback(() => {
    const primary = videoRefs.current[primaryCamera];
    if (primary && isFinite(primary.duration)) {
      setDuration(primary.duration);
    }
  }, [primaryCamera]);

  const handlePlayPause = useCallback(() => {
    const refs = Object.values(videoRefs.current).filter(Boolean) as HTMLVideoElement[];
    if (refs.length === 0) return;
    if (refs[0].paused) {
      refs.forEach((v) => v.play());
      setIsPlaying(true);
    } else {
      refs.forEach((v) => v.pause());
      setIsPlaying(false);
    }
  }, []);

  const handleSeek = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const time = parseFloat(e.target.value);
    setCurrentTime(time);
    for (const ref of Object.values(videoRefs.current)) {
      if (ref) ref.currentTime = time;
    }
  }, []);

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
                        <span className={`text-sm font-medium ${isActive ? 'text-cobalt-400' : 'text-theme-primary'}`}>
                          Episode {ep.index}
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
                        src={trainingApi.getEpisodeVideoUrl(datasetId, selectedEpisode, cam)}
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
            </>
          )}
        </div>
      </div>
    </div>
  );
}
