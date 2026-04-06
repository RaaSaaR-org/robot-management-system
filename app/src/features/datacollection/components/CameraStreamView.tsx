/**
 * @file CameraStreamView.tsx
 * @description MJPEG camera stream viewer with recording-aware state
 * @feature datacollection
 */

import { useState, useEffect, useRef } from 'react';
import { VideoOff, Circle } from 'lucide-react';

interface CameraStreamViewProps {
  robotId: string;
  cameraName: 'wrist' | 'top';
  label?: string;
  className?: string;
  /** When true, shows "Recording" state instead of "offline" on error */
  isRecording?: boolean;
}

export function CameraStreamView({ robotId, cameraName, label, className, isRecording }: CameraStreamViewProps) {
  const [hasError, setHasError] = useState(false);
  const streamUrl = `/api/robots/${robotId}/camera/${cameraName}`;
  const retryRef = useRef<ReturnType<typeof setInterval>>(undefined);

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
      <div className={`flex flex-col items-center justify-center bg-gray-900 rounded-lg ${className ?? ''}`}>
        <div className="flex items-center gap-2 mb-2">
          <Circle className="w-3 h-3 text-red-500 fill-red-500 animate-pulse" />
          <span className="text-sm font-medium text-red-400">Recording</span>
        </div>
        <span className="text-xs text-gray-500 uppercase tracking-wide">{label ?? cameraName}</span>
        <span className="text-[10px] text-gray-600 mt-1">Camera captured by recorder</span>
      </div>
    );
  }

  // Offline / error state
  if (hasError) {
    return (
      <div className={`flex flex-col items-center justify-center bg-surface-800 rounded-lg ${className ?? ''}`}>
        <VideoOff className="w-8 h-8 text-gray-500 mb-2" />
        <span className="text-xs text-gray-500">{label ?? cameraName} offline</span>
        <button
          onClick={() => setHasError(false)}
          className="mt-2 text-xs text-primary-400 hover:text-primary-300"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className={`relative overflow-hidden rounded-lg bg-black ${className ?? ''}`}>
      <img
        src={streamUrl}
        alt={`${label ?? cameraName} camera`}
        onError={() => setHasError(true)}
        className="w-full h-full object-contain"
      />
      <div className="absolute top-2 left-2 px-2 py-0.5 bg-black/60 rounded text-[10px] text-white font-medium uppercase tracking-wide">
        {label ?? cameraName}
      </div>
      <div className="absolute top-2 right-2 w-2 h-2 rounded-full bg-green-500 animate-pulse" />
    </div>
  );
}
