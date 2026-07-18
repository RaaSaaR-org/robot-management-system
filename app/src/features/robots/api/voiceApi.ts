/**
 * @file voiceApi.ts
 * @description API calls for the robot voice mode (server-relayed voice service).
 * @feature robots
 * @dependencies @/api/client
 */

import { apiClient } from '@/api/client';
import type { VoiceHealth, VoiceLanguage, VoiceStatus } from '../types/voice.types';

// Note: apiClient already has /api prefix in baseURL
const ENDPOINTS = {
  health: (id: string) => `/robots/${id}/voice/health`,
  status: (id: string) => `/robots/${id}/voice/status`,
  say: (id: string) => `/robots/${id}/voice/say`,
  listenToggle: (id: string) => `/robots/${id}/voice/listen/toggle`,
  sessionReset: (id: string) => `/robots/${id}/voice/session/reset`,
  volume: (id: string) => `/robots/${id}/voice/volume`,
  events: (id: string) => `/robots/${id}/voice/events`,
} as const;

export const voiceApi = {
  /** Aggregated sidecar availability — never throws on a down service. */
  async getHealth(robotId: string): Promise<VoiceHealth> {
    const response = await apiClient.get<VoiceHealth>(ENDPOINTS.health(robotId));
    return response.data;
  },

  /** Pipeline state, session and latency metrics. */
  async getStatus(robotId: string): Promise<VoiceStatus> {
    const response = await apiClient.get<VoiceStatus>(ENDPOINTS.status(robotId));
    return response.data;
  },

  /** Speak typed text through the robot speaker (queued upstream, 202). */
  async say(
    robotId: string,
    text: string,
    language?: VoiceLanguage
  ): Promise<{ accepted: boolean; text: string }> {
    const response = await apiClient.post<{ accepted: boolean; text: string }>(
      ENDPOINTS.say(robotId),
      { text, language }
    );
    return response.data;
  },

  /** Pause/resume the mic pipeline. */
  async toggleListen(robotId: string): Promise<{ paused: boolean }> {
    const response = await apiClient.post<{ paused: boolean }>(ENDPOINTS.listenToggle(robotId));
    return response.data;
  },

  /** Start a fresh conversation context. */
  async resetSession(robotId: string): Promise<{ contextId: string }> {
    const response = await apiClient.post<{ contextId: string }>(ENDPOINTS.sessionReset(robotId));
    return response.data;
  },

  /** Robot speaker volume (G1 audio adapter). */
  async getVolume(robotId: string): Promise<{ volume: number }> {
    const response = await apiClient.get<{ volume: number }>(ENDPOINTS.volume(robotId));
    return response.data;
  },

  async setVolume(robotId: string, volume: number): Promise<{ volume: number }> {
    const response = await apiClient.post<{ volume: number }>(ENDPOINTS.volume(robotId), {
      volume,
    });
    return response.data;
  },
};

/**
 * Absolute URL for the SSE event stream (EventSource can't go through axios).
 * Resolves against the same base the apiClient uses.
 */
export function voiceEventsUrl(robotId: string): string {
  const base = apiClient.defaults.baseURL ?? '/api';
  return `${base.replace(/\/$/, '')}${ENDPOINTS.events(robotId)}`;
}
