/**
 * @file AgentVoiceBar.tsx
 * @description Speak-to-the-robot control for the Agent Mode cockpit: the
 *              microphone gate and the live pipeline state. Read-and-gate only —
 *              the words themselves become plans through the robot-agent's A2A
 *              path, and land in the timeline like any other command.
 * @feature agentmode
 */

import { memo, useCallback, useMemo, useState } from 'react';
import { cn } from '@/shared/utils';
import { Tooltip } from '@/shared/components/ui/Tooltip';
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
  /**
   * `'bar'` — the standalone full-width strip. Still the default so any other
   * caller keeps the rendering it was written against.
   *
   * `'inline'` — a single mic button for the chat composer. Voice is an INPUT
   * METHOD, not a status: as a composer control it sits where the operator is
   * already typing, and it costs the page no always-on row. The copy that used
   * to be printed across that row (deaf / service unreachable) moves into
   * tooltips on the button, so it is still one hover away but no longer
   * permanent furniture.
   */
  variant?: 'bar' | 'inline';
  className?: string;
}

/** Copy shown when the service runs but cannot hear. Same sentence in both variants. */
const DEAF_COPY =
  'The voice service has no audio input wired — start it with a microphone backend to talk to the robot.';

/**
 * Deliberately explicit about WHICH half is missing. "Voice unavailable" sends
 * people looking at the robot; the voice service is a separate sidecar and is
 * nearly always the thing that is not running.
 */
const UNREACHABLE_COPY =
  'Voice service not reachable — start it next to the robot agent (robot-agent/voice).';

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

/**
 * Shared button shell for the inline variant.
 *
 * `disabled:pointer-events-none` is not cosmetic: a disabled button is inert and
 * dispatches no mouse events, so without it the surrounding Tooltip never opens
 * and the explanation for the disabled state becomes unreachable. The same
 * sentence is repeated in `aria-label` because a disabled control is also not
 * focusable, which is the other way that explanation could be lost.
 *
 * The tooltip opens to the RIGHT, not upwards. `Tooltip` is CSS-positioned and
 * not portalled, and this button is the first item in the composer of a card
 * that is `overflow-hidden` — a `side="top"` panel is centred on a 36px trigger
 * sitting ~30px from the card's left edge, so ~110px of a 260px-wide
 * explanation was clipped away and both sentences here started mid-word. To the
 * right there is the whole width of the textarea, and the panel is
 * `pointer-events-none` so it cannot swallow a click meant for it.
 */
function InlineMicButton({
  testId,
  label,
  tooltip,
  disabled,
  active,
  muted,
  onClick,
  dot,
}: {
  testId: string;
  label: string;
  tooltip: string;
  disabled?: boolean;
  active?: boolean;
  muted?: boolean;
  onClick?: () => void;
  /** A true-right-now condition marker. Amber, and only when it is true. */
  dot?: boolean;
}) {
  return (
    <Tooltip content={tooltip} side="right">
      <button
        type="button"
        data-testid={testId}
        onClick={onClick}
        disabled={disabled}
        aria-label={label}
        aria-pressed={onClick ? Boolean(active) : undefined}
        className={cn(
          // 36px in the composer; 44px on coarse pointers (WCAG 2.5.5).
          'relative h-9 w-9 pointer-coarse:h-11 pointer-coarse:w-11',
          'rounded-brand flex items-center justify-center shrink-0 border transition-colors',
          'focus:outline-none focus:ring-2 focus:ring-cobalt-500/40',
          active
            ? 'bg-cobalt-500 text-white border-cobalt-500 hover:bg-cobalt-600'
            : 'glass-subtle text-theme-secondary border-glass-subtle hover:text-theme-primary',
          'disabled:opacity-50 disabled:cursor-not-allowed disabled:pointer-events-none'
        )}
      >
        <MicIcon className="w-4 h-4" muted={muted} />
        {dot && (
          <span className="absolute top-0.5 right-0.5 w-1.5 h-1.5 rounded-full bg-amber-500" />
        )}
      </button>
    </Tooltip>
  );
}

export const AgentVoiceBar = memo(function AgentVoiceBar({
  robotId,
  variant = 'bar',
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

  if (variant === 'inline') {
    const micOpen = available && canHear && !voice.paused;

    return (
      <div
        data-testid="agent-voice-bar"
        className={cn('flex items-center gap-1.5 shrink-0', className)}
      >
        {/* The pipeline pill is a transient: it says what the voice stack is
            doing THIS second. An 'Idle' pill parked next to the composer is the
            kind of always-on status this page is being cleared of, so it only
            appears once there is something to report. */}
        {available && voice.pipelineState !== 'idle' && (
          // Rendered at EVERY width. It used to be `hidden sm:inline-flex`, and
          // the operator most likely to need it is the one standing next to the
          // robot with a phone: below 640px the only remaining signal was that
          // the mic button is cobalt, which is also its colour when the mic is
          // merely open and idle. "Listening", "thinking" and "speaking" then
          // had nowhere left to be said — `agent-voice-last` is gone from this
          // variant by design. It is a small pill and the composer row wraps.
          <VoiceStateBadge state={voice.pipelineState} />
        )}

        {!available ? (
          <InlineMicButton
            testId="agent-voice-unavailable"
            label={robotId ? UNREACHABLE_COPY : 'No robot bound.'}
            tooltip={robotId ? UNREACHABLE_COPY : 'No robot bound.'}
            disabled
            muted
          />
        ) : !canHear ? (
          <InlineMicButton
            testId="agent-voice-deaf"
            label={DEAF_COPY}
            tooltip={DEAF_COPY}
            disabled
            muted
            dot
          />
        ) : (
          <InlineMicButton
            testId="agent-voice-mic-toggle"
            label={voice.paused ? 'Open the microphone' : 'Mute the microphone'}
            tooltip={
              voice.paused
                ? 'The microphone is muted. Open it to speak a command instead of typing it.'
                : 'The microphone is open — say a command out loud and it becomes a plan like a typed one.'
            }
            disabled={busy}
            active={micOpen}
            muted={voice.paused}
            onClick={() => void toggleMic()}
          />
        )}
      </div>
    );
  }

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

          {/* The heard/said readout is a lossier second copy of the transcript,
              which already renders heard commands as user messages carrying
              `agent-spoken-marker` — hence no testid of its own any more. */}
          <div className="card-meta flex-1 min-w-[12rem] truncate">
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
              DEAF_COPY
            )}
          </div>
        </>
      ) : (
        <span className="card-meta" data-testid="agent-voice-unavailable">
          {robotId ? UNREACHABLE_COPY : 'No robot bound.'}
        </span>
      )}
    </div>
  );
});
