/**
 * @file CameraStreamView.tsx
 * @description MJPEG camera stream viewer with recording-aware state. Opens
 *              the stream with a camera ticket (TASK-214) and takes any camera
 *              name the robot serves (TASK-392), not only top/wrist.
 * @feature datacollection
 */

import { useState, useEffect, useRef } from 'react';
import { VideoOff } from 'lucide-react';
import { Button, StatusTag } from '@/shared/components/ui';
import { cn } from '@/shared/utils/cn';
import { useCameraStreamUrl } from '../../robots/hooks/useCameraStreamUrl';

interface CameraStreamViewProps {
  robotId: string;
  /** A camera the robot serves (`head_camera`, `top`, `wrist`, …). */
  cameraName: string;
  label?: string;
  className?: string;
  /** When true, shows "Recording" state instead of "offline" on error */
  isRecording?: boolean;
  /** The robot is offline or unknown: show the offline state without requesting the stream */
  offline?: boolean;
}

const FRAME =
  'relative flex flex-col items-center justify-center gap-1.5 overflow-hidden rounded-control border border-line-subtle bg-inset p-3 text-center';

export function CameraStreamView({ robotId, cameraName, label, className, isRecording, offline }: CameraStreamViewProps) {
  const [streamError, setHasError] = useState(false);
  // A fresh ticket per attempt: the last one may have expired.
  const [attempt, setAttempt] = useState(0);
  const { url: streamUrl, denied } = useCameraStreamUrl(offline ? null : robotId, offline ? null : cameraName, undefined, attempt);
  const hasError = streamError || denied || !!offline;
  const retryRef = useRef<ReturnType<typeof setInterval>>(undefined);
  const name = label ?? cameraName;
  const retry = () => { setHasError(false); setAttempt((n) => n + 1); };

  // Auto-retry every 3s when recording stops (camera becomes available again)
  useEffect(() => {
    if (hasError && !offline && !isRecording) {
      retryRef.current = setInterval(retry, 3000);
    }
    return () => { if (retryRef.current) clearInterval(retryRef.current); };
  }, [hasError, isRecording, offline]);

  // Recording state — camera is busy but that's expected
  if (hasError && isRecording) {
    return (
      <div className={cn(FRAME, className)}>
        <StatusTag status="recording" dot pulse>Recording</StatusTag>
        <span className="text-[13px] font-medium text-ink-secondary">{name}</span>
        <span className="text-xs text-ink-tertiary">Camera captured by the recorder</span>
      </div>
    );
  }

  // Offline — a normal state, not an error
  if (hasError) {
    return (
      <div className={cn(FRAME, className)}>
        <VideoOff className="h-4 w-4 text-ink-tertiary" strokeWidth={1.75} />
        <span className="text-[13px] font-medium text-ink-secondary">{name} offline</span>
        <span className="text-xs text-ink-tertiary">Start the robot agent to see this stream.</span>
        {!offline && <Button variant="ghost" size="sm" onClick={retry}>Retry</Button>}
      </div>
    );
  }

  if (!streamUrl) {
    return <div className={cn(FRAME, className)}><span className="text-xs text-ink-tertiary">Connecting to {name}…</span></div>;
  }

  return (
    <div className={cn('relative overflow-hidden rounded-control border border-line-subtle bg-inset', className)}>
      <img
        src={streamUrl}
        alt={`${name} camera`}
        onError={() => setHasError(true)}
        className="h-full w-full object-contain"
      />
      <div className="absolute left-2 top-2">
        <StatusTag tone="live" dot>{name}</StatusTag>
      </div>
    </div>
  );
}
