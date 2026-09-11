/**
 * @file humanize.ts
 * @description Turns machine-written incident/alert text ("route: X · run: Y ·
 *              type: unexpected_object [finding:… run:…]") into one readable
 *              sentence, keeping the original for a "Raw event" disclosure.
 * @feature incidents
 */

import { stripFindingLink } from '@/features/patrol/utils/patrolFormat';

export interface HumanizedText {
  /** One readable line for people. */
  summary: string;
  /** The original machine string, or null when the text was already prose. */
  raw: string | null;
}

const PAIR = /^([a-z][a-z_ ]{0,24}):\s*(.+)$/i;
const TAG = /\[(finding|run|tour):[^\]]*\]/i;

function words(value: string): string {
  return value.replace(/[_]+/g, ' ').trim();
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/** "HALLWAY" → "Hallway"; mixed-case names stay as written. */
function placeName(value: string): string {
  const w = words(value);
  return w === w.toUpperCase() ? capitalize(w.toLowerCase()) : w;
}

/**
 * Humanize a machine string. Prose passes through unchanged (raw = null).
 *
 * @example
 * humanizeMachineText('route: House round · place: HALLWAY · type: unexpected_object [finding:f run:r]')
 * // { summary: 'Unexpected object in Hallway, on route House round', raw: '…' }
 */
export function humanizeMachineText(text: string | null | undefined): HumanizedText {
  const original = (text ?? '').trim();
  if (!original) return { summary: '', raw: null };

  // Server-written descriptions carry markdown emphasis ("**Reason:** …"); a table cell shows it raw.
  const stripped = stripFindingLink(original)
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*\*/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const segments = stripped.split(/\s+·\s+/).map((s) => s.trim()).filter(Boolean);
  const pairs = new Map<string, string>();
  const prose: string[] = [];
  for (const segment of segments) {
    const match = PAIR.exec(segment);
    if (match) pairs.set(match[1].trim().toLowerCase(), match[2].trim());
    else prose.push(segment);
  }

  const isMachine = pairs.size >= 2 || TAG.test(original);
  if (!isMachine) return { summary: stripped || original, raw: null };

  const parts: string[] = [];
  const type = pairs.get('type');
  const place = pairs.get('place');
  const route = pairs.get('route');
  let head = prose[0] ?? (type ? capitalize(words(type)) : '');
  if (!prose[0] && place) head = head ? `${head} in ${placeName(place)}` : placeName(place);
  if (head) parts.push(head);
  if (route) parts.push(`on route ${route}`);
  if (parts.length === 0) {
    for (const [key, value] of pairs) {
      if (key === 'at' || key === 'run') continue;
      parts.push(`${words(key)} ${words(value)}`);
    }
  }

  return { summary: capitalize(parts.join(', ')) || stripped, raw: original };
}
