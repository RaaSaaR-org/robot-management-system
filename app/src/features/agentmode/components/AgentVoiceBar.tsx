/**
 * @file AgentVoiceBar.tsx
 * @description Speak-to-the-robot strip for the Agent Mode cockpit: live
 *              pipeline state, the microphone gate, and the last thing heard
 *              and said. Read-and-gate only — the words themselves become
 *              plans through the robot-agent's A2A path, and land in the
 *              timeline like any other command.
 * @feature agentmode
 */

import { memo, useCallback, useMemo, useState } from 'react';
import { cn } from '@/shared/utils';
// The voice channel belongs to the robots feature (it is per-robot hardware and
// has its own tab there). Agent Mode consumes it rather than owning a second
// copy: one SSE relay, one store, so the mic state shown here can never
// disagree with the mic state shown on the robot page.
import { voiceApi } from '@/features/robots/api/voiceApi';
import { useVoiceChannel } from '@/features/robots/hooks/useVoiceChannel';
import { VoiceStateBadge } from '@/features/robots/components/voice/VoiceStateBadge';
import { useVoiceStore } from '@/features/robots/store/voiceStore';

export interface AgentVoiceBarProps {
  robotId: string | null;
  className?: string;
}

function MicIcon({ className, muted }: { className?: string; muted?: boolean }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 15a3 3 0 003-3V6a3 3 0 10-6 0v6a3 3 0 003 3zm7-3a7 7 0 01-14 0m7 7v3"
      />
      {muted && <path strokeLinecap="round" d="M4 4l16 16" />}
    </svg>
  );
}

/** Last entry of a kind, for the one-line "heard / said" readout. */
function lastOf(
  entries: ReadonlyArray<{ kind: string; text: string }>,
  kinds: readonly string[]
): string | null {
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    if (kinds.includes(entry.kind)) return entry.text;
  }
  return null;
}

export const AgentVoiceBar = memo(function AgentVoiceBar({
  robotId,
  className,
}: AgentVoiceBarProps) {
  // The hook opens an SSE relay, so it must not run without a robot to open it
  // for — with an empty id it no-ops rather than polling a robot-less URL, and
  // the bar renders its unavailable state below.
  const { voice, health } = useVoiceChannel(robotId ?? '');
  const setPaused = useVoiceStore((s) => s.setPaused);
  const [busy, setBusy] = useState(false);

  const available = Boolean(robotId) && (health?.available ?? false);
  // A running service is not the same as a service that can HEAR. It starts
  // degraded when the mic backend could not be opened — no device, or a Remote
  // Desktop session, where the host's microphone belongs to the console
  // session and every input device fails to open. Offering "mute the
  // microphone" there invites the operator to talk to something deaf.
  const canHear = health?.service?.components?.audio_in ?? true;
  const heard = useMemo(() => lastOf(voice.entries, ['heard', 'typed']), [voice.entries]);
  const said = useMemo(() => lastOf(voice.entries, ['reply']), [voice.entries]);

  const toggleMic = useCallback(async () => {
    if (!robotId) return;
    setBusy(true);
    try {
      const { paused } = await voiceApi.toggleListen(robotId);
      // Trust the service's answer, not the click: the pipeline is the owner
      // of this state and may already have been paused from somewhere else.
      setPaused(robotId, paused);
    } catch {
      // The health poll is the truth about availability; a failed toggle needs
      // no banner of its own, and the badge keeps showing the real state.
    } finally {
      setBusy(false);
    }
  }, [robotId, setPaused]);

  return (
    <div
      data-testid="agent-voice-bar"
      className={cn('glass-card px-4 py-2.5 flex items-center gap-3 flex-wrap', className)}
    >
      <span className="text-sm font-medium text-theme-primary flex items-center gap-2">
        <MicIcon className="w-4 h-4 text-theme-secondary" muted={!available || voice.paused} />
        Talk to the robot
      </span>

      {available ? (
        <>
          <VoiceStateBadge state={voice.pipelineState} />
          {canHear ? (
            <button
              type="button"
              onClick={() => void toggleMic()}
              disabled={busy}
              data-testid="agent-voice-mic-toggle"
              className={cn(
                'px-3 py-1.5 rounded-brand text-xs font-medium border transition-colors',
                'disabled:opacity-50 disabled:cursor-not-allowed',
                voice.paused
                  ? 'bg-cobalt-500 text-white border-cobalt-500 hover:bg-cobalt-600'
                  : 'glass-subtle text-theme-secondary border-glass-subtle hover:text-theme-primary'
              )}
            >
              {voice.paused ? 'Open the microphone' : 'Mute the microphone'}
            </button>
          ) : (
            <span
              data-testid="agent-voice-deaf"
              className="px-2.5 py-1 rounded-full border border-amber-500/30 bg-amber-500/10 text-xs font-medium text-amber-600 dark:text-amber-300"
            >
              No microphone — it can speak, not listen
            </span>
          )}

          <div className="card-meta flex-1 min-w-[12rem] truncate" data-testid="agent-voice-last">
            {heard ? (
              <>
                <span className="text-theme-secondary">heard:</span> “{heard}”
                {said && (
                  <>
                    {' · '}
                    <span className="text-theme-secondary">said:</span> “{said}”
                  </>
                )}
              </>
            ) : canHear ? (
              'Say a command out loud — it becomes a plan like a typed one.'
            ) : (
              'The voice service has no audio input wired — start it with a microphone backend to talk to the robot.'
            )}
          </div>
        </>
      ) : (
        // Deliberately explicit about WHICH half is missing. "Voice unavailable"
        // sends people looking at the robot; the voice service is a separate
        // sidecar and is nearly always the thing that is not running.
        <span className="card-meta" data-testid="agent-voice-unavailable">
          {robotId
            ? 'Voice service not reachable — start it next to the robot agent (robot-agent/voice).'
            : 'No robot bound.'}
        </span>
      )}
    </div>
  );
});
