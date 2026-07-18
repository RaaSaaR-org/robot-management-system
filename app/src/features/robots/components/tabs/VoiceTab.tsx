/**
 * @file VoiceTab.tsx
 * @description Voice mode for the robot detail page: type a message and the
 *              robot says it through its speaker, see live transcripts of what
 *              the robot microphone hears plus the agent's spoken replies, and
 *              control the voice pipeline (mic pause, session, volume). Backed
 *              by the TASK-181 voice service, relayed through the server; the
 *              tab degrades to a clear offline notice when the service is down.
 * @feature robots
 */

import { memo, useCallback } from 'react';
import { cn } from '@/shared/utils';
import { voiceApi } from '../../api/voiceApi';
import { useVoiceChannel } from '../../hooks/useVoiceChannel';
import { useVoiceStore } from '../../store/voiceStore';
import { VoiceComposer } from '../voice/VoiceComposer';
import { VoiceConversation } from '../voice/VoiceConversation';
import { VoicePipelinePanel } from '../voice/VoicePipelinePanel';
import type { VoiceLanguage } from '../../types/voice.types';
import type { VoiceTabProps } from './types';

/** Voice tab — talk to and through the robot's speaker/microphone. */
export const VoiceTab = memo(function VoiceTab({ robot, robotId }: VoiceTabProps) {
  const { voice, health, status, refreshHealth } = useVoiceChannel(robotId);
  const addTypedEntry = useVoiceStore((s) => s.addTypedEntry);
  const setPaused = useVoiceStore((s) => s.setPaused);

  // null = first health poll still in flight (avoid an offline flash on mount)
  const available = health === null ? null : health.available;

  const handleSay = useCallback(
    async (text: string, language: VoiceLanguage) => {
      await voiceApi.say(robotId, text, language);
      addTypedEntry(robotId, text, language);
    },
    [robotId, addTypedEntry]
  );

  const handleToggleListen = useCallback(async () => {
    const { paused } = await voiceApi.toggleListen(robotId);
    setPaused(robotId, paused);
  }, [robotId, setPaused]);

  const handleResetSession = useCallback(async () => {
    await voiceApi.resetSession(robotId);
  }, [robotId]);

  const handleGetVolume = useCallback(async () => {
    const { volume } = await voiceApi.getVolume(robotId);
    return volume;
  }, [robotId]);

  const handleSetVolume = useCallback(
    async (volume: number) => {
      await voiceApi.setVolume(robotId, volume);
    },
    [robotId]
  );

  return (
    <div className="flex flex-col gap-4" data-testid="voice-tab">
      {/* Offline notice — in-flow, keeps history visible underneath */}
      {available === false && (
        <div
          role="alert"
          className={cn(
            'flex flex-wrap items-center gap-x-3 gap-y-1 p-3 rounded-xl',
            'glass-subtle border border-amber-500/30 bg-amber-500/10'
          )}
          data-testid="voice-offline-banner"
        >
          <svg
            className="w-4 h-4 text-amber-500 dark:text-amber-300 shrink-0"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1.8}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"
            />
          </svg>
          <div className="flex-1 min-w-[220px]">
            <p className="text-xs font-medium text-theme-primary">
              Voice service offline — {robot.name} cannot speak or listen right now.
            </p>
            <p className="text-[11px] text-theme-tertiary">
              Start it next to the robot agent:{' '}
              <code className="px-1 rounded bg-theme-elevated">python -m voice_service</code>{' '}
              (see robot-agent/voice/README.md)
            </p>
          </div>
          <button
            type="button"
            onClick={() => void refreshHealth()}
            className={cn(
              'px-3 py-1.5 rounded-lg text-xs font-medium border border-theme',
              'text-theme-secondary hover:text-theme-primary hover:bg-theme-elevated',
              'transition-colors duration-150'
            )}
          >
            Retry
          </button>
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
        {/* Conversation + composer */}
        <div className="flex flex-col gap-3 min-w-0">
          <VoiceConversation
            entries={voice.entries}
            className="h-[380px] xl:h-[440px] p-3 rounded-xl glass-subtle border border-theme"
          />
          <VoiceComposer onSay={handleSay} disabled={available === false} />
        </div>

        {/* Pipeline / status panel */}
        <VoicePipelinePanel
          pipelineState={voice.pipelineState}
          paused={voice.paused}
          micLoopDisabled={voice.micLoopDisabled}
          micActivity={voice.micActivity}
          health={health}
          status={status}
          available={available === true}
          onToggleListen={handleToggleListen}
          onResetSession={handleResetSession}
          onGetVolume={handleGetVolume}
          onSetVolume={handleSetVolume}
        />
      </div>
    </div>
  );
});
