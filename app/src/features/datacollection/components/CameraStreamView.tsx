/**
 * @file CameraStreamView.tsx
 * @description MJPEG camera stream viewer with recording-aware state. Opens
 *              the stream with a camera ticket (TASK-214), takes any camera
 *              name the robot serves (TASK-392), and reconnects on its own with
 *              backoff — including while a recording runs (TASK-401).
 *              TASK-427: `fit` fills a live-view frame — no tile border, the
 *              picture covering the frame, the name left to the frame's own
 *              view switch.
 * @feature datacollection
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { VideoOff } from 'lucide-react';
import { Button, StatusTag } from '@/shared/components/ui';
import { cn } from '@/shared/utils/cn';
import { useCameraStreamUrl } from '../../robots/hooks/useCameraStreamUrl';
import { nextRetryDelayS } from '../../robots/components/tabs/vr/vrCamera';

interface CameraStreamViewProps {
  robotId: string;
  /** A camera the robot serves (`head_camera`, `top`, `wrist`, …). */
  cameraName: string;
  label?: string;
  className?: string;
  /**
   * A recording is running. Changes the wording only: the view keeps
   * reconnecting either way, and nothing here ever touches the recording.
   */
  isRecording?: boolean;
  /** The robot is offline or unknown: show the offline state without requesting the stream */
  offline?: boolean;
  /**
   * Fill a live-view frame (TASK-427): no border or tile ground, the picture
   * covers the frame, and no name tag (the frame's view switch names it).
   */
  fit?: boolean;
}

const FRAME =
  'relative flex flex-col items-center justify-center gap-1.5 overflow-hidden rounded-control border border-line-subtle bg-inset p-3 text-center';

/** How often the last good frame is copied aside while the stream is live, in ms. */
const SNAPSHOT_INTERVAL_MS = 1000;

/**
 * One camera tile on the session page.
 *
 * It used to auto-retry only while NOT recording, on the theory that a failing
 * stream during a recording was the recorder holding the camera. On a G1 the
 * recorder and this view read the same sidecar stream, so a stream that dropped
 * mid-episode never came back — the operator lost sight of the robot for the
 * rest of the take. It now retries on the VR panel's backoff (`nextRetryDelayS`:
 * 1, 2, 4, 8, then every 15 s, without limit) whatever the session is doing,
 * and shows "Reconnecting in Ns" over the last good frame instead of a blank
 * tile.
 *
 * A camera error never stops or pauses the recording. The recorder records
 * whatever the agent sees; this is only the operator's window onto it.
 */
export function CameraStreamView({ robotId, cameraName, label, className, isRecording, offline, fit = false }: CameraStreamViewProps) {
  /**
   * The stream URL whose `<img>` errored. Keyed on the URL rather than a flag so
   * a retry cannot remount the `<img>` on the dead URL for the one render before
   * the new ticket lands — that opened a second doomed request per retry and
   * counted its error as another failure.
   */
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  // A fresh ticket per attempt: the last one may have expired.
  const [attempt, setAttempt] = useState(0);
  /** Retries since the last decoded frame — what the backoff is indexed by. */
  const [failures, setFailures] = useState(0);
  const [retryAt, setRetryAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [hasSnapshot, setHasSnapshot] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const { url: streamUrl, denied } = useCameraStreamUrl(offline ? null : robotId, offline ? null : cameraName, undefined, attempt);
  const streamError = !!streamUrl && streamUrl === failedUrl;
  const hasError = streamError || denied;
  const name = label ?? cameraName;

  const retry = useCallback(() => {
    setRetryAt(null);
    setFailures((n) => n + 1);
    setAttempt((n) => n + 1);
  }, []);

  // A different camera is a different picture and a fresh backoff.
  useEffect(() => {
    setFailedUrl(null);
    setFailures(0);
    setRetryAt(null);
    setHasSnapshot(false);
  }, [robotId, cameraName]);

  // The backoff — scheduled on every failure, recording or not.
  useEffect(() => {
    if (!hasError || offline) {
      setRetryAt(null);
      return;
    }
    const delayMs = nextRetryDelayS(failures) * 1000;
    const start = Date.now();
    setNow(start);
    setRetryAt(start + delayMs);
    const timer = setTimeout(retry, delayMs);
    return () => clearTimeout(timer);
  }, [hasError, offline, failures, retry]);

  // Countdown, once a second while a retry is pending.
  useEffect(() => {
    if (retryAt === null) return;
    setNow(Date.now());
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, [retryAt]);

  // Keep the last good frame. An `<img>` that errors loses its picture, so it is
  // copied aside once a second while live — one drawImage, and the canvas is
  // only ever displayed, never read back, so even a tainting draw is harmless.
  const live = !!streamUrl && !hasError && !offline;
  useEffect(() => {
    if (!live) return;
    const snap = () => {
      const img = imgRef.current;
      const canvas = canvasRef.current;
      if (!img || !canvas || img.naturalWidth === 0) return;
      // A decoded frame is what resets the backoff — also here, for browsers
      // that fire no `load` for a multipart stream's parts.
      setFailures(0);
      if (canvas.width !== img.naturalWidth) canvas.width = img.naturalWidth;
      if (canvas.height !== img.naturalHeight) canvas.height = img.naturalHeight;
      try {
        canvas.getContext('2d')?.drawImage(img, 0, 0);
        setHasSnapshot(true);
      } catch {
        // A frame mid-decode or a torn-down image: keep the previous snapshot.
      }
    };
    const timer = setInterval(snap, SNAPSHOT_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [live]);

  // Offline robot — a normal state, not an error, and nothing to retry against.
  if (offline) {
    return (
      <div className={cn(FRAME, fit && 'h-full w-full rounded-none border-0 bg-media', className)}>
        <VideoOff className="h-4 w-4 text-ink-tertiary" strokeWidth={1.75} />
        <span className="text-[13px] font-medium text-ink-secondary">{name} offline</span>
        <span className="text-xs text-ink-tertiary">Start the robot agent to see this stream.</span>
      </div>
    );
  }

  const retryInS = retryAt === null ? null : Math.max(0, Math.ceil((retryAt - now) / 1000));
  const reconnectText = retryInS === null ? 'Reconnecting…' : `Reconnecting in ${retryInS}s`;
  const reconnecting = hasError || (!streamUrl && failures > 0);
  // On the black media well the light-on-dark texts read in either theme.
  const onPicture = hasSnapshot || fit;

  return (
    <div
      className={cn(
        'relative overflow-hidden',
        fit ? 'h-full w-full bg-media' : 'rounded-control border border-line-subtle bg-inset',
        className,
      )}
      data-testid="camera-stream-view"
    >
      {/* The last good frame, under everything; visible only while the live
          `<img>` is not. */}
      <canvas
        ref={canvasRef}
        aria-hidden
        className={cn('absolute inset-0 h-full w-full', fit ? 'object-cover' : 'object-contain', (live || !hasSnapshot) && 'invisible')}
      />
      {live && (
        <>
          <img
            ref={imgRef}
            src={streamUrl}
            alt={`${name} camera`}
            onLoad={() => setFailures(0)}
            onError={() => setFailedUrl(streamUrl)}
            className={cn('relative h-full w-full', fit ? 'object-cover' : 'object-contain')}
          />
          {!fit && (
            <div className="absolute left-2 top-2">
              <StatusTag tone="live" dot>{name}</StatusTag>
            </div>
          )}
        </>
      )}
      {!live && (
        <div
          className={cn(
            'absolute inset-0 flex flex-col items-center justify-center gap-1.5 p-3 text-center',
            onPicture && 'bg-black/50',
          )}
        >
          {reconnecting ? (
            <>
              {isRecording ? (
                <StatusTag status="recording" dot pulse>Recording</StatusTag>
              ) : (
                <VideoOff className={cn('h-4 w-4', onPicture ? 'text-white/80' : 'text-ink-tertiary')} strokeWidth={1.75} />
              )}
              <span className={cn('text-[13px] font-medium', onPicture ? 'text-white' : 'text-ink-secondary')}>
                {name}
              </span>
              <span role="status" className={cn('text-xs', onPicture ? 'text-white/85' : 'text-ink-tertiary')}>
                {reconnectText}
              </span>
              {isRecording && (
                <span className={cn('text-xs', onPicture ? 'text-white/70' : 'text-ink-tertiary')}>
                  The recording continues.
                </span>
              )}
              <Button variant="ghost" size="sm" onClick={retry}>Retry now</Button>
            </>
          ) : (
            <span className={cn('text-xs', fit ? 'text-white/70' : 'text-ink-tertiary')}>Connecting to {name}…</span>
          )}
        </div>
      )}
    </div>
  );
}
