/**
 * @file CameraStreamView.tsx
 * @description MJPEG camera stream viewer with recording-aware state
 * @feature datacollection
 */

import { useState, useEffect, useRef } from 'react';
import { VideoOff } from 'lucide-react';
import { Button, StatusTag } from '@/shared/components/ui';
import { cn } from '@/shared/utils/cn';

interface CameraStreamViewProps {
  robotId: string;
  cameraName: 'wrist' | 'top';
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
  const hasError = streamError || !!offline;
  const streamUrl = `/api/robots/${robotId}/camera/${cameraName}`;
  const retryRef = useRef<ReturnType<typeof setInterval>>(undefined);
  const name = label ?? cameraName;

  // Auto-retry every 3s when recording stops (camera becomes available again)
  useEffect(() => {
    if (hasError && !isRecording) {
      retryRef.current = setInterval(() => setHasError(false), 3000);
    }
    return () => { if (retryRef.current) clearInterval(retryRef.current); };
  }, [hasError, isRecording]);

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
        {!offline && <Button variant="ghost" size="sm" onClick={() => setHasError(false)}>Retry</Button>}
      </div>
    );
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
