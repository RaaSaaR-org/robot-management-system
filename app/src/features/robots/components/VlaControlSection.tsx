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
}

const DEFAULT_SERVER_URL = 'http://192.168.178.38:8000';
const ICON = 'h-4 w-4';

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
  const [promptError, setPromptError] = useState<string>();

  const handleStart = useCallback(async () => {
    const trimmed = promptInput.trim();
    if (!trimmed) {
      setPromptError('Tell the robot what to do.');
      return;
    }
    setPromptError(undefined);
    const ok = await confirm({
      title: 'Start this skill?',
      description: `The robot starts acting on "${trimmed}" on its own until you stop it.`,
      confirmLabel: 'Start skill',
    });
    if (!ok) return;
    try {
      await startVla(trimmed, serverUrl);
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
            {isLoading ? 'Checking…' : isActive ? 'Running' : 'Inactive'}
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
            <FormField label="VLA server URL">
              <Input
                size="sm"
                placeholder={DEFAULT_SERVER_URL}
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
            isLoading={isExecuting}
            leftIcon={<Play className={ICON} strokeWidth={1.75} />}
          >
            Start skill
          </Button>
        )}
      </Panel.Body>
    </Panel>
  );
}
