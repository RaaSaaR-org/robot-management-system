/**
 * @file DatasetEpisodesPage.tsx
 * @description Full page for viewing dataset episodes with video playback and joint state charts
 * @feature training
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
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
import { Button, Spinner } from '@/shared/components/ui';
import { trainingApi } from '../api/trainingApi';
import type { EpisodeMeta, FrameData } from '../types';

const JOINT_NAMES = [
  'shoulder_pan',
  'shoulder_lift',
  'elbow_flex',
  'wrist_flex',
  'wrist_roll',
  'gripper',
] as const;

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
 * Dataset episodes page with synchronized video playback and joint state chart.
 * Replaces the former EpisodeViewerModal with a dedicated route-based page.
 *
 * @example
 * ```tsx
 * <Route path="/datasets/:datasetId/episodes" element={<DatasetEpisodesPage />} />
 * ```
 */
export function DatasetEpisodesPage() {
  const { datasetId } = useParams<{ datasetId: string }>();
  const navigate = useNavigate();

  const [datasetName, setDatasetName] = useState<string>('');
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

  const videoUpRef = useRef<HTMLVideoElement>(null);
  const videoSideRef = useRef<HTMLVideoElement>(null);

  // Fetch dataset name
  useEffect(() => {
    if (!datasetId) return;
    trainingApi.getDataset(datasetId)
      .then((ds) => setDatasetName(ds.name))
      .catch(() => setDatasetName('Unknown Dataset'));
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
      })
      .catch((err) => {
        console.error('Failed to load episodes:', err);
        setEpisodes([]);
      })
      .finally(() => setEpisodesLoading(false));
  }, [datasetId]);

  // Load frames when episode selected + set duration from episode metadata
  useEffect(() => {
    if (!datasetId || selectedEpisode === null) return;

    const ep = episodes.find((e) => e.index === selectedEpisode);
    if (ep) setDuration(ep.durationSeconds);

    setFramesLoading(true);
    trainingApi.getEpisodeFrames(datasetId, selectedEpisode, 0, 500)
      .then((result) => setFrames(result.frames))
      .catch((err) => {
        console.error('Failed to load frames:', err);
        setFrames([]);
      })
      .finally(() => setFramesLoading(false));
  }, [datasetId, selectedEpisode, episodes]);

  // Sync video playback speed
  useEffect(() => {
    if (videoUpRef.current) videoUpRef.current.playbackRate = playbackSpeed;
    if (videoSideRef.current) videoSideRef.current.playbackRate = playbackSpeed;
  }, [playbackSpeed]);

  // Video time update handler — sync both videos
  const handleTimeUpdate = useCallback(() => {
    const video = videoUpRef.current;
    if (video) {
      setCurrentTime(video.currentTime);
      if (videoSideRef.current && Math.abs(videoSideRef.current.currentTime - video.currentTime) > 0.1) {
        videoSideRef.current.currentTime = video.currentTime;
      }
    }
  }, []);

  const handleLoadedMetadata = useCallback(() => {
    if (videoUpRef.current && isFinite(videoUpRef.current.duration)) {
      setDuration(videoUpRef.current.duration);
    }
  }, []);

  const handlePlayPause = useCallback(() => {
    const videoUp = videoUpRef.current;
    const videoSide = videoSideRef.current;
    if (!videoUp) return;

    if (videoUp.paused) {
      videoUp.play();
      videoSide?.play();
      setIsPlaying(true);
    } else {
      videoUp.pause();
      videoSide?.pause();
      setIsPlaying(false);
    }
  }, []);

  const handleVideoEnded = useCallback(() => {
    setIsPlaying(false);
  }, []);

  const handleFlagToggle = useCallback(async (episodeIndex: number) => {
    if (!datasetId) return;
    const newFlagged = !flaggedMap[episodeIndex];
    setFlaggedMap((prev) => ({ ...prev, [episodeIndex]: newFlagged }));
    try {
      await trainingApi.flagEpisode(datasetId, episodeIndex, newFlagged);
    } catch (err) {
      console.error('Failed to flag episode:', err);
      setFlaggedMap((prev) => ({ ...prev, [episodeIndex]: !newFlagged }));
    }
  }, [datasetId, flaggedMap]);

  // Prepare chart data from frames
  const chartData = frames.map((frame) => {
    const point: Record<string, number> = { timestamp: frame.timestamp };
    JOINT_NAMES.forEach((name, i) => {
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

  // Guard: invalid ID — placed after all hooks to satisfy rules-of-hooks
  if (!datasetId) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-center">
          <h1 className="text-xl font-semibold text-theme-primary">Invalid Dataset ID</h1>
          <p className="mt-2 text-theme-secondary">No dataset ID was provided.</p>
        </div>
      </div>
    );
  }

  const videoUpUrl = selectedEpisode !== null
    ? trainingApi.getEpisodeVideoUrl(datasetId, selectedEpisode, 'up')
    : undefined;
  const videoSideUrl = selectedEpisode !== null
    ? trainingApi.getEpisodeVideoUrl(datasetId, selectedEpisode, 'side')
    : undefined;

  return (
    <div className="space-y-4">
      {/* Header with back button */}
      <header className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate('/datasets')}
          className="flex items-center gap-1"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Datasets
        </Button>
        <div className="h-5 w-px bg-theme-secondary/30" />
        <h1 className="text-xl font-bold text-theme-primary">
          Episodes {datasetName ? `\u2014 ${datasetName}` : ''}
        </h1>
      </header>

      {/* Main content: sidebar + viewer */}
      <div className="flex flex-col lg:flex-row gap-4 min-h-[400px]">
        {/* Left: Episode List */}
        <div className="lg:w-[300px] shrink-0 flex flex-col">
          {/* Mobile: dropdown, Desktop: scrollable list */}
          <div className="block lg:hidden mb-3">
            <select
              value={selectedEpisode ?? ''}
              onChange={(e) => {
                const val = e.target.value;
                setSelectedEpisode(val === '' ? null : parseInt(val, 10));
              }}
              className="w-full px-3 py-2 rounded-lg border border-theme-secondary/30 bg-theme-primary text-theme-primary text-sm"
            >
              <option value="">Select an episode...</option>
              {episodes.map((ep) => (
                <option key={ep.index} value={ep.index}>
                  Episode {ep.index} — {ep.frameCount} frames, {formatTime(ep.durationSeconds)}
                  {flaggedMap[ep.index] ? ' (flagged)' : ''}
                </option>
              ))}
            </select>
          </div>

          <div className="hidden lg:block overflow-y-auto flex-1 border border-theme-secondary/20 rounded-lg" style={{ maxHeight: 'calc(100vh - 12rem)' }}>
            {episodesLoading ? (
              <div className="flex items-center justify-center py-8">
                <Spinner size="md" label="Loading episodes..." />
              </div>
            ) : episodes.length === 0 ? (
              <div className="text-center py-8 text-theme-secondary text-sm">
                No episodes available
              </div>
            ) : (
              <div className="divide-y divide-theme-secondary/10">
                {episodes.map((ep) => (
                  <div
                    key={ep.index}
                    role="button"
                    tabIndex={0}
                    onClick={() => setSelectedEpisode(ep.index)}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setSelectedEpisode(ep.index); }}
                    className={`w-full text-left px-4 py-3 hover:bg-theme-secondary/10 transition-colors cursor-pointer ${
                      selectedEpisode === ep.index ? 'bg-primary-500/10 border-l-2 border-primary-500' : ''
                    } ${flaggedMap[ep.index] ? 'bg-red-500/5' : ''}`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-sm text-theme-primary">
                        Episode {ep.index}
                      </span>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleFlagToggle(ep.index);
                        }}
                        className={`text-sm p-1 rounded hover:bg-theme-secondary/20 ${
                          flaggedMap[ep.index] ? 'text-red-500' : 'text-theme-tertiary'
                        }`}
                        title={flaggedMap[ep.index] ? 'Unflag episode' : 'Flag episode'}
                      >
                        {flaggedMap[ep.index] ? '\u{1F6A9}' : '\u{2691}'}
                      </button>
                    </div>
                    <div className="text-xs text-theme-tertiary mt-1">
                      {ep.frameCount} frames &bull; {formatTime(ep.durationSeconds)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right: Viewer */}
        <div className="flex-1 overflow-y-auto space-y-4">
          {selectedEpisode === null ? (
            <div className="flex items-center justify-center h-full text-theme-secondary">
              Select an episode to view
            </div>
          ) : (
            <>
              {/* Video Area */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                <div>
                  <p className="text-xs text-theme-tertiary mb-1">Camera: up</p>
                  <video
                    ref={videoUpRef}
                    src={videoUpUrl}
                    onTimeUpdate={handleTimeUpdate}
                    onLoadedMetadata={handleLoadedMetadata}
                    onEnded={handleVideoEnded}
                    className="w-full rounded-lg bg-black"
                    playsInline
                  />
                </div>
                <div>
                  <p className="text-xs text-theme-tertiary mb-1">Camera: side</p>
                  <video
                    ref={videoSideRef}
                    src={videoSideUrl}
                    className="w-full rounded-lg bg-black"
                    playsInline
                  />
                </div>
              </div>

              {/* Controls */}
              <div className="flex items-center gap-4 px-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handlePlayPause}
                >
                  {isPlaying ? 'Pause' : 'Play'}
                </Button>
                <span className="text-sm text-theme-secondary font-mono">
                  {formatTime(currentTime)} / {formatTime(duration)}
                </span>
                <select
                  value={playbackSpeed}
                  onChange={(e) => setPlaybackSpeed(parseFloat(e.target.value))}
                  className="px-2 py-1 rounded border border-theme-secondary/30 bg-theme-primary text-theme-primary text-sm"
                >
                  {SPEED_OPTIONS.map((speed) => (
                    <option key={speed} value={speed}>
                      {speed}x
                    </option>
                  ))}
                </select>
              </div>

              {/* Joint State Chart */}
              {framesLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Spinner size="md" label="Loading frame data..." />
                </div>
              ) : chartData.length > 0 ? (
                <div>
                  <h3 className="text-sm font-medium text-theme-primary mb-2">
                    Joint States
                  </h3>
                  <ResponsiveContainer width="100%" height={300}>
                    <LineChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border, #e5e7eb)" />
                      <XAxis
                        dataKey="timestamp"
                        type="number"
                        domain={['dataMin', 'dataMax']}
                        tickFormatter={(v: number) => v.toFixed(1)}
                        label={{ value: 'Time (s)', position: 'insideBottom', offset: -5 }}
                        fontSize={11}
                      />
                      <YAxis fontSize={11} />
                      <Tooltip
                        contentStyle={{ fontSize: 11, background: 'var(--color-bg-card, #fff)' }}
                        labelFormatter={(v: number) => `t=${v.toFixed(2)}s`}
                      />

                      {/* Observation state lines (solid) */}
                      {JOINT_NAMES.map((name) => (
                        <Line
                          key={`obs_${name}`}
                          type="monotone"
                          dataKey={`obs_${name}`}
                          stroke={JOINT_COLORS[name]}
                          dot={false}
                          strokeWidth={1.5}
                          name={`obs:${name}`}
                        />
                      ))}

                      {/* Action lines (dashed) */}
                      {JOINT_NAMES.map((name) => (
                        <Line
                          key={`action_${name}`}
                          type="monotone"
                          dataKey={`action_${name}`}
                          stroke={JOINT_COLORS[name]}
                          dot={false}
                          strokeWidth={1.5}
                          strokeDasharray="5 3"
                          name={`act:${name}`}
                        />
                      ))}

                      {/* Current time indicator */}
                      {currentTime > 0 && (
                        <ReferenceLine
                          x={currentTime}
                          stroke="#ef4444"
                          strokeWidth={2}
                          strokeDasharray="none"
                        />
                      )}
                    </LineChart>
                  </ResponsiveContainer>
                  <div className="flex flex-wrap gap-3 mt-2 text-xs text-theme-tertiary">
                    {JOINT_NAMES.map((name) => (
                      <span key={name} className="flex items-center gap-1">
                        <span
                          className="inline-block w-3 h-0.5 rounded"
                          style={{ backgroundColor: JOINT_COLORS[name] }}
                        />
                        {name}
                      </span>
                    ))}
                    <span className="text-theme-tertiary">
                      (solid = observation, dashed = action)
                    </span>
                  </div>
                </div>
              ) : (
                <div className="text-center py-6 text-theme-secondary text-sm">
                  No frame data available for this episode
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
