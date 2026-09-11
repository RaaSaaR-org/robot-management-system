/**
 * @file VoiceTab.tsx
 * @description Voice mode for the robot detail page: type a message and the
 *              robot says it through its speaker, see live transcripts of what
 *              the robot microphone hears plus the agent's spoken replies, and
 *              control the voice pipeline (mic pause, session, volume). Backed
 *              by the TASK-181 voice service, relayed through the server; the
 *              tab degrades to a calm offline hint when the service is down.
 * @feature robots
 */

import { memo, useCallback } from 'react';
import { MicOff } from 'lucide-react';
import { Button, Panel } from '@/shared/components/ui';
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
    <div className="flex flex-col gap-6" data-testid="voice-tab">
      {available === false && (
        <Panel
          variant="inset"
          padding="sm"
          role="status"
          className="flex flex-wrap items-start gap-3"
          data-testid="voice-offline-banner"
        >
          <MicOff className="mt-0.5 h-4 w-4 shrink-0 text-ink-tertiary" strokeWidth={1.75} aria-hidden="true" />
          <div className="min-w-[220px] flex-1 text-sm">
            <p className="text-ink-secondary">
              Voice service offline — {robot.name} cannot speak or listen right now.
            </p>
            <p className="mt-0.5 text-xs text-ink-tertiary">
              Start it next to the robot agent: <code className="font-mono">python -m voice_service</code>{' '}
              (see robot-agent/voice/README.md)
            </p>
          </div>
          <Button variant="secondary" size="sm" onClick={() => void refreshHealth()}>
            Retry
          </Button>
        </Panel>
      )}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <Panel className="min-w-0 xl:col-span-2">
          <Panel.Header title="Conversation" description="What the robot says, hears and replies." />
          <Panel.Body className="flex flex-col gap-4">
            <VoiceConversation entries={voice.entries} className="h-[320px] xl:h-[400px]" />
            <VoiceComposer onSay={handleSay} disabled={available === false} />
          </Panel.Body>
        </Panel>

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
