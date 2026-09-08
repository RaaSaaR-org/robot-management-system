/**
 * @file platform-registration.ts
 * @description Re-report the robot's identity to its configured NeoDEM platform.
 * @feature core
 * @status live
 */
import { platformAuthHeaders } from './platform-auth.js';

export async function reportRobotIdentity(
  serverUrl: string,
  robotUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const response = await fetchImpl(`${serverUrl.replace(/\/+$/, '')}/api/robots/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...platformAuthHeaders() },
    body: JSON.stringify({ robotUrl }),
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error(`Identity re-report rejected: HTTP ${response.status}`);
}
