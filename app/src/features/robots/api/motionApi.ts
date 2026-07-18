/**
 * @file motionApi.ts
 * @description API calls for retargeted motion clips (list/get/create/delete)
 * @feature robots
 * @dependencies @/api/client
 */

import { apiClient } from '@/api/client';
import type { CreateMotionClipInput, MotionClip, MotionClipSummary } from '../types/motion.types';

// Note: apiClient already has /api prefix in baseURL
const ENDPOINTS = {
  list: '/motion-clips',
  detail: (id: string) => `/motion-clips/${id}`,
} as const;

/**
 * List clips without their frames — a single clip's frame array is 100 KB+.
 */
export async function listClips(): Promise<MotionClipSummary[]> {
  const response = await apiClient.get<{ clips: MotionClipSummary[] }>(ENDPOINTS.list);
  return response.data.clips;
}

/**
 * Fetch one clip including every frame. This is the payload the viewer plays back.
 */
export async function getClip(id: string): Promise<MotionClip> {
  const response = await apiClient.get<{ clip: MotionClip }>(ENDPOINTS.detail(id));
  return response.data.clip;
}

/**
 * Upload a clip. The server derives frameCount/durationSec, so the response is a summary
 * rather than an echo of the input.
 */
export async function createClip(input: CreateMotionClipInput): Promise<MotionClipSummary> {
  const response = await apiClient.post<{ clip: MotionClipSummary }>(ENDPOINTS.list, input);
  return response.data.clip;
}

export async function deleteClip(id: string): Promise<void> {
  await apiClient.delete(ENDPOINTS.detail(id));
}

/** Grouped form, matching the other API modules in this feature (sensorScansApi, voiceApi). */
export const motionApi = {
  listClips,
  getClip,
  createClip,
  deleteClip,
};
