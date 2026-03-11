/**
 * @file VlaControlSection.tsx
 * @description VLA status badge, prompt input, and start/stop controls for a robot
 * @feature robots
 */

import { useState, useCallback } from 'react';
import { Badge, Button, Input } from '@/shared/components/ui';
import { useVlaStatus } from '../hooks/useVlaStatus';

// ============================================================================
// TYPES
// ============================================================================

export interface VlaControlSectionProps {
  robotId: string;
}

// ============================================================================
// CONSTANTS
// ============================================================================

const DEFAULT_SERVER_URL = 'http://192.168.178.38:8000';

// ============================================================================
// COMPONENT
// ============================================================================

export function VlaControlSection({ robotId }: VlaControlSectionProps) {
  const {
    isActive,
    status,
    prompt: activePrompt,
    isLoading,
    isExecuting,
    error,
    startVla,
    stopVla,
  } = useVlaStatus(robotId);

  const [promptInput, setPromptInput] = useState('');
  const [serverUrl, setServerUrl] = useState(DEFAULT_SERVER_URL);
  const [localError, setLocalError] = useState<string | null>(null);

  const handleStart = useCallback(async () => {
    const trimmedPrompt = promptInput.trim();
    if (!trimmedPrompt) {
      setLocalError('Prompt is required');
      return;
    }
    setLocalError(null);
    try {
      await startVla(trimmedPrompt, serverUrl);
      setPromptInput('');
    } catch {
      // Error is already set in the hook
    }
  }, [promptInput, serverUrl, startVla]);

  const handleStop = useCallback(async () => {
    setLocalError(null);
    try {
      await stopVla();
    } catch {
      // Error is already set in the hook
    }
  }, [stopVla]);

  const displayError = localError ?? error;

  // Status badge variant
  const badgeVariant = isActive ? 'success' : status === null ? 'default' : 'default';
  const badgeLabel = isActive ? 'Running' : 'Inactive';
  const statusPhase = status?.phase ?? status?.mode ?? (isActive ? 'running' : 'inactive');

  return (
    <div className="p-4 rounded-xl bg-theme-elevated border border-theme-subtle">
      {/* Header row */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3">
          <svg
            className="w-5 h-5 text-cobalt-500"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19.8 15.3M14.25 3.104c.251.023.501.05.75.082M19.8 15.3l-1.57.393A9.065 9.065 0 0112 15a9.065 9.065 0 00-6.23.693L5 14.5m14.8.8l1.402 1.402c1.232 1.232.65 3.318-1.067 3.611A48.309 48.309 0 0112 21c-2.773 0-5.491-.235-8.135-.687-1.718-.293-2.3-2.379-1.067-3.61L5 14.5"
            />
          </svg>
          <div>
            <p className="text-sm font-medium text-theme-primary">VLA Control</p>
            <p className="text-xs text-theme-secondary">Vision-Language-Action inference</p>
          </div>
        </div>
        <Badge
          variant={badgeVariant}
          size="sm"
          dot
          dotPulse={isActive}
        >
          {isLoading ? 'Checking...' : badgeLabel}
        </Badge>
      </div>

      {/* Active session info */}
      {isActive && (
        <div className="mb-3 p-3 rounded-lg bg-green-500/5 border border-green-500/20">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-theme-secondary">Active Prompt</p>
              <p className="text-sm font-medium text-theme-primary">
                {activePrompt ?? 'N/A'}
              </p>
            </div>
            <div className="text-right">
              <p className="text-xs text-theme-secondary">Status</p>
              <p className="text-sm font-medium text-theme-primary capitalize">
                {statusPhase}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Start form (only when not running) */}
      {!isActive && (
        <div className="space-y-2 mb-3">
          <Input
            size="sm"
            placeholder="Pick up the red block"
            value={promptInput}
            onChange={(e) => setPromptInput(e.target.value)}
            label="Task Prompt"
          />
          <Input
            size="sm"
            placeholder={DEFAULT_SERVER_URL}
            value={serverUrl}
            onChange={(e) => setServerUrl(e.target.value)}
            label="VLA Server URL"
          />
        </div>
      )}

      {/* Error display */}
      {displayError && (
        <p className="text-xs text-red-500 mb-2">{displayError}</p>
      )}

      {/* Action buttons */}
      <div className="flex gap-2">
        {!isActive ? (
          <Button
            variant="primary"
            size="sm"
            onClick={handleStart}
            isLoading={isExecuting}
            disabled={isExecuting}
            fullWidth
          >
            Start VLA
          </Button>
        ) : (
          <Button
            variant="destructive"
            size="sm"
            onClick={handleStop}
            isLoading={isExecuting}
            disabled={isExecuting}
            fullWidth
          >
            Stop VLA
          </Button>
        )}
      </div>
    </div>
  );
}
