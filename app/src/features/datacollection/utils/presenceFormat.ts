/**
 * @file presenceFormat.ts
 * @description How the people watching a session are named (TASK-414): the
 *              desktop header's avatars ("Anna · headset") and the headset
 *              panel's title ("Ben (desktop)").
 * @feature datacollection
 */

import type { PresenceViewer } from '../types/datacollection.types';

/** Where a viewer is: the operator wears the headset, an assistant sits at a desktop. */
export const ROLE_PLACE: Record<PresenceViewer['role'], string> = {
  operator: 'headset',
  assistant: 'desktop',
};

/** "Anna · headset". */
export function viewerLabel(viewer: PresenceViewer): string {
  return `${viewer.displayName} · ${ROLE_PLACE[viewer.role]}`;
}

/** Up to two initials for an avatar: "Anna Berg" → "AB", "ben" → "B". */
export function viewerInitials(name: string): string {
  const parts = name.trim().split(/[\s._@-]+/).filter(Boolean);
  const letters = parts.length >= 2 ? [parts[0], parts[parts.length - 1]] : parts.slice(0, 1);
  return letters.map((p) => p.charAt(0).toUpperCase()).join('') || '?';
}

/**
 * Who watches from a desktop, for the headset: "Ben (desktop)",
 * "Ben (desktop) +1", or null when no desktop watches.
 */
export function watchingLabel(viewers: readonly PresenceViewer[]): string | null {
  const desks = viewers.filter((v) => v.role === 'assistant');
  if (desks.length === 0) return null;
  const first = `${desks[0].displayName} (desktop)`;
  return desks.length > 1 ? `${first} +${desks.length - 1}` : first;
}
