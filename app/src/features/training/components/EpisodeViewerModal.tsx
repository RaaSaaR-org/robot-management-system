/**
 * @file EpisodeViewerModal.tsx
 * @description Modal for viewing dataset episodes with video playback and joint state charts
 * @feature training
 */

import { useState, useEffect, useRef, useCallback } from 'react';
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
import { Modal, Button, Spinner } from '@/shared/components/ui';
import { trainingApi } from '../api/trainingApi';
import type { EpisodeMeta, FrameData } from '../types';

export interface EpisodeViewerModalProps {
  datasetId: string;
  datasetName: string;
  isOpen: boolean;
  onClose: () => void;
}

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
 * Modal for viewing dataset episodes with synchronized video and joint state chart
 */
export function EpisodeViewerModal({
  datasetId,
  datasetName,
  isOpen,
  onClose,
}: EpisodeViewerModalProps) {
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

  // Load episodes when modal opens
  useEffect(() => {
    if (!isOpen) return;

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
  }, [isOpen, datasetId]);

  // Load frames when episode selected
  useEffect(() => {
    if (selectedEpisode === null) return;

    setFramesLoading(true);
    trainingApi.getEpisodeFrames(datasetId, selectedEpisode, 0, 500)
      .then((result) => setFrames(result.frames))
      .catch((err) => {
        console.error('Failed to load frames:', err);
        setFrames([]);
      })
      .finally(() => setFramesLoading(false));
  }, [datasetId, selectedEpisode]);

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
      // Sync side camera
      if (videoSideRef.current && Math.abs(videoSideRef.current.currentTime - video.currentTime) > 0.1) {
        videoSideRef.current.currentTime = video.currentTime;
      }
    }
  }, []);

  const handleLoadedMetadata = useCallback(() => {
    if (videoUpRef.current) {
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

  const videoUpUrl = selectedEpisode !== null
    ? trainingApi.getEpisodeVideoUrl(datasetId, selectedEpisode, 'up')
    : undefined;
  const videoSideUrl = selectedEpisode !== null
    ? trainingApi.getEpisodeVideoUrl(datasetId, selectedEpisode, 'side')
    : undefined;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`Episodes — ${datasetName}`}
      size="full"
    >
      <div className="flex flex-col lg:flex-row gap-4 h-[calc(100vh-12rem)] min-h-[400px]">
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

          <div className="hidden lg:block overflow-y-auto flex-1 border border-theme-secondary/20 rounded-lg">
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
                  <button
                    key={ep.index}
                    onClick={() => setSelectedEpisode(ep.index)}
                    className={`w-full text-left px-4 py-3 hover:bg-theme-secondary/10 transition-colors ${
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
                  </button>
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
    </Modal>
  );
}
