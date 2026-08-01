/**
 * @file useVoiceChannel.ts
 * @description Manages the live voice channel for one robot: the server-relayed
 *              SSE event stream (with reconnect), plus periodic health/status
 *              polling as the graceful-degradation signal. Events land in the
 *              voiceStore; this hook returns the store slices the tab needs.
 * @feature robots
 */

import { useCallback, useEffect, useRef } from 'react';
import { voiceApi, voiceEventsUrl } from '../api/voiceApi';
import { useVoiceStore, emptyVoiceRobotState } from '../store/voiceStore';
import type { VoiceEvent } from '../types/voice.types';

const RECONNECT_DELAY_MS = 4000;
const HEALTH_POLL_MS = 10000;

export function useVoiceChannel(robotId: string) {
  const applyEvent = useVoiceStore((s) => s.applyEvent);
  const setConnection = useVoiceStore((s) => s.setConnection);
  const setHealth = useVoiceStore((s) => s.setHealth);
  const setStatus = useVoiceStore((s) => s.setStatus);

  const robotState = useVoiceStore((s) => s.byRobot[robotId]);
  const connection = useVoiceStore((s) => s.connection[robotId] ?? 'connecting');
  const health = useVoiceStore((s) => s.health[robotId] ?? null);
  const status = useVoiceStore((s) => s.status[robotId] ?? null);

  const sourceRef = useRef<EventSource | null>(null);
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refreshHealth = useCallback(async () => {
    if (!robotId) return;
    try {
      const [nextHealth, nextStatus] = await Promise.all([
        voiceApi.getHealth(robotId),
        voiceApi.getStatus(robotId).catch(() => null),
      ]);
      setHealth(robotId, nextHealth);
      setStatus(robotId, nextStatus);
    } catch {
      setHealth(robotId, null);
      setStatus(robotId, null);
    }
  }, [robotId, setHealth, setStatus]);

  useEffect(() => {
    // A caller that renders before its robot is bound (the Agent Mode voice bar
    // does, for one frame) would otherwise open an SSE stream and poll
    // `/api/robots//voice/health` — a URL that addresses no robot and answers
    // 404 forever, with a managed reconnect keeping it up.
    if (!robotId) return;

    let disposed = false;

    const connect = () => {
      if (disposed) return;
      setConnection(robotId, 'connecting');
      const source = new EventSource(voiceEventsUrl(robotId));
      sourceRef.current = source;

      source.onopen = () => {
        if (!disposed) setConnection(robotId, 'open');
      };
      source.onmessage = (message) => {
        try {
          const event = JSON.parse(message.data) as VoiceEvent;
          applyEvent(robotId, event);
        } catch {
          // Malformed frame — skip; the stream itself stays healthy.
        }
      };
      // Managed reconnect instead of the browser's: when the voice service is
      // down the server answers 502 and EventSource would retry in a tight
      // loop. Back off and let the health poll reflect availability meanwhile.
      source.onerror = () => {
        source.close();
        if (disposed) return;
        setConnection(robotId, 'error');
        retryRef.current = setTimeout(connect, RECONNECT_DELAY_MS);
      };
    };

    connect();
    void refreshHealth();
    const healthTimer = setInterval(() => void refreshHealth(), HEALTH_POLL_MS);

    return () => {
      disposed = true;
      sourceRef.current?.close();
      if (retryRef.current) clearTimeout(retryRef.current);
      clearInterval(healthTimer);
    };
  }, [robotId, applyEvent, setConnection, refreshHealth]);

  return {
    /** Conversation + pipeline state for this robot (never undefined) */
    voice: robotState ?? emptyVoiceRobotState(),
    /** SSE relay connection state */
    connection,
    /** Aggregated sidecar health (null until first poll answers) */
    health,
    /** Pipeline status incl. latency metrics (null when service down) */
    status,
    /** Force a health/status refresh (retry button) */
    refreshHealth,
  };
}
