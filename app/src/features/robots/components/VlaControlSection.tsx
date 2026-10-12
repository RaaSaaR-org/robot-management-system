/**
 * @file VlaControlSection.tsx
 * @description "Skill" panel of the robot Overview: VLA status, the task prompt and
 *              server URL, and Start / Stop. Starting moves the robot, so it
 *              confirms first; the result is a toast.
 * @feature robots
 */

import { useState, useCallback } from 'react';
import { Play, Square } from 'lucide-react';
import {
  Button, FormField,
  Input, Panel,
  StatusTag, confirm,
  errorMessage, toast,
} from '@/shared/components/ui';
import { useVlaStatus } from '../hooks/useVlaStatus';

export interface VlaControlSectionProps {
  robotId: string;
  /** False while the robot is offline: nothing to start, nothing to poll. */
  online?: boolean;
}

/**
 * The VLA server a deployment points at, when it configures one. No address is
 * baked in: a lab machine's IP means nothing anywhere else (TASK-388).
 */
const CONFIGURED_SERVER_URL: string = import.meta.env.VITE_VLA_SERVER_URL ?? '';
const SERVER_URL_KEY = 'neodem-vla-server-url';
const ICON = 'h-4 w-4';

/** The URL this viewer used last, else the configured one. */
function initialServerUrl(): string {
  try {
    return localStorage.getItem(SERVER_URL_KEY) || CONFIGURED_SERVER_URL;
  } catch {
    return CONFIGURED_SERVER_URL;
  }
}

function rememberServerUrl(url: string): void {
  try {
    localStorage.setItem(SERVER_URL_KEY, url);
  } catch {
    // Storage blocked: the field just starts from the default next time.
  }
}

export function VlaControlSection({ robotId, online = true }: VlaControlSectionProps) {
  const {
    isActive,
    status,
    prompt: activePrompt,
    isLoading,
    isExecuting,
    error,
    startVla,
    stopVla,
  } = useVlaStatus(robotId, online);

  const [promptInput, setPromptInput] = useState('');
  const [serverUrl, setServerUrl] = useState(initialServerUrl);
  const [promptError, setPromptError] = useState<string>();
  const [urlError, setUrlError] = useState<string>();

  const handleStart = useCallback(async () => {
    const trimmed = promptInput.trim();
    if (!trimmed) {
      setPromptError('Tell the robot what to do.');
      return;
    }
    setPromptError(undefined);
    const url = serverUrl.trim();
    if (!url) {
      setUrlError('Enter the VLA server URL.');
      return;
    }
    setUrlError(undefined);
    const ok = await confirm({
      title: 'Start this skill?',
      description: `The robot starts acting on "${trimmed}" on its own until you stop it.`,
      confirmLabel: 'Start skill',
    });
    if (!ok) return;
    try {
      await startVla(trimmed, url);
      rememberServerUrl(url);
      setPromptInput('');
      toast.success('Skill started', { description: trimmed });
    } catch (err) {
      toast.error("Couldn't start skill", { description: errorMessage(err) });
    }
  }, [promptInput, serverUrl, startVla]);

  const handleStop = useCallback(async () => {
    try {
      await stopVla();
      toast.success('Skill stopped');
    } catch (err) {
      toast.error("Couldn't stop skill", { description: errorMessage(err) });
    }
  }, [stopVla]);

  const phase = status?.phase ?? status?.mode ?? (isActive ? 'running' : 'inactive');

  return (
    <Panel>
      <Panel.Header
        title="Skill"
        description="Vision-language-action inference on this robot."
        actions={
          <StatusTag tone={isActive ? 'live' : 'neutral'} dot pulse={isActive}>
            {!online ? 'Robot offline' : isLoading ? 'Checking…' : isActive ? 'Running' : 'Inactive'}
          </StatusTag>
        }
      />
      <Panel.Body className="flex flex-col gap-4">
        {isActive ? (
          <Panel variant="inset" padding="sm" className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs text-ink-tertiary">Active prompt</p>
              <p className="text-sm font-medium text-ink-primary">{activePrompt ?? '—'}</p>
            </div>
            <div className="shrink-0 text-right">
              <p className="text-xs text-ink-tertiary">Phase</p>
              <p className="text-sm font-medium capitalize text-ink-primary">{phase}</p>
            </div>
          </Panel>
        ) : (
          <>
            <FormField label="Task prompt" error={promptError}>
              <Input
                size="sm"
                placeholder="Pick up the red block"
                value={promptInput}
                onChange={(e) => setPromptInput(e.target.value)}
              />
            </FormField>
            <FormField label="VLA server URL" error={urlError}>
              <Input
                size="sm"
                placeholder="http://vla-server:8000"
                value={serverUrl}
                onChange={(e) => setServerUrl(e.target.value)}
              />
            </FormField>
          </>
        )}

        {error && (
          <p role="alert" className="text-xs text-signal-stopped">
            {error}
          </p>
        )}

        {isActive ? (
          <Button
            variant="secondary"
            size="sm"
            fullWidth
            onClick={() => void handleStop()}
            isLoading={isExecuting}
            leftIcon={<Square className={ICON} strokeWidth={1.75} />}
          >
            Stop skill
          </Button>
        ) : (
          <Button
            size="sm"
            fullWidth
            onClick={() => void handleStart()}
            disabled={!online}
            isLoading={isExecuting}
            leftIcon={<Play className={ICON} strokeWidth={1.75} />}
          >
            Start skill
          </Button>
        )}
        {!online && !isActive && (
          <p className="text-xs text-ink-tertiary" data-testid="vla-offline-hint">
            Robot must be online to start a skill.
          </p>
        )}
      </Panel.Body>
    </Panel>
  );
}
