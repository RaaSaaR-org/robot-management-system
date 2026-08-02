/**
 * @file memory.ts
 * @description Genkit tool for cross-place recall over the robot's durable
 *              memory (TASK-197). Deterministic substring/keyword scan — no
 *              embeddings on the robot.
 * @feature agentmode
 * @status live
 *
 * This is a tool for the GEMINI conversational agent, deliberately NOT a block
 * for the local planner. Place-keyed retrieval is INJECTED into the planner
 * prompt (`plannerSceneSummary`), because a 4B model cannot be trusted to plan
 * a retrieval step and a missed recall must never become a failed plan. Asking
 * "did I ever see a pallet in the dock?" is a different act: it is a question,
 * the answer to it is the whole point of the turn, and the model asking is not
 * the 4B one.
 */

import { ai, z } from '../agent/genkit.js';
import { Journal } from '../agent-mode/journal.js';
import { getWorkspace, listEntries, type TrustLevel } from '../agent-mode/workspace.js';

/** Journal days scanned by a recall. One working week of context. */
export const RECALL_JOURNAL_DAYS = 7;

/** Most hits returned, newest first. Keeps a tool answer readable. */
export const RECALL_MAX_HITS = 12;

/** One thing the robot remembers, with where it came from. */
export interface RecallHit {
  /** `memory` | `place:<id>` | `journal` — the reader has to be able to tell. */
  source: string;
  /** ISO date (memory/place notes) or timestamp (journal), when known. */
  at: string | null;
  /** Place the line belongs to, or null. */
  place: string | null;
  /** See {@link TrustLevel}. Journal hits may be `untrusted`; notes never are. */
  trust: TrustLevel | null;
  text: string;
}

/**
 * Split a query into lower-cased terms. Deliberately dumb: this is a substring
 * scan over at most a few hundred short lines, and a stemmer here would be a
 * second retrieval behaviour to explain when a recall surprises someone.
 */
export function recallTerms(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length >= 3);
}

/** True when every term appears somewhere in the line. */
export function matchesRecall(text: string, terms: string[]): boolean {
  if (terms.length === 0) return false;
  const haystack = text.toLowerCase();
  return terms.every((t) => haystack.includes(t));
}

/**
 * Scan `MEMORY.md`, every place note and the last {@link RECALL_JOURNAL_DAYS}
 * journal days for a query. Newest first.
 *
 * Journal hits keep their `trust` — including `untrusted`. That is the point of
 * having the tier: the robot may TELL you a VLM once claimed something, it just
 * may never have promoted it into memory as fact.
 */
export function recallAcrossPlaces(query: string, maxHits: number = RECALL_MAX_HITS): RecallHit[] {
  const terms = recallTerms(query);
  if (terms.length === 0) return [];

  const workspace = getWorkspace();
  const hits: RecallHit[] = [];

  const entryDate = (line: string): string | null => {
    const match = /^-\s+(\d{4}-\d{2}-\d{2})\s/.exec(line);
    return match ? match[1] : null;
  };
  const entryTrust = (line: string): TrustLevel | null => {
    const match = /\((self|operator|untrusted)\)/.exec(line);
    return match ? (match[1] as TrustLevel) : null;
  };

  for (const line of listEntries(workspace.readMemory())) {
    if (matchesRecall(line, terms)) {
      hits.push({
        source: 'memory',
        at: entryDate(line),
        place: null,
        trust: entryTrust(line),
        text: line.replace(/^-\s+/, ''),
      });
    }
  }

  for (const placeId of workspace.listPlaceNotes()) {
    for (const line of listEntries(workspace.readPlaceNote(placeId))) {
      if (matchesRecall(line, terms)) {
        hits.push({
          source: `place:${placeId}`,
          at: entryDate(line),
          place: placeId,
          trust: entryTrust(line),
          text: line.replace(/^-\s+/, ''),
        });
      }
    }
  }

  for (const record of new Journal({ workspace }).readLastDays(RECALL_JOURNAL_DAYS)) {
    if (matchesRecall(record.msg, terms)) {
      hits.push({
        source: 'journal',
        at: record.t,
        place: record.place,
        trust: record.trust,
        text: record.msg,
      });
    }
  }

  // Newest first, and undated entries last: an entry with no date is older than
  // anything that carries one, not newer.
  hits.sort((a, b) => (b.at ?? '').localeCompare(a.at ?? ''));
  return hits.slice(0, Math.max(1, maxHits));
}

export const recallMemory = ai.defineTool(
  {
    name: 'recallMemory',
    description:
      "Search everything the robot durably remembers — its curated memory, its per-place notes " +
      'and the last 7 days of its own activity journal — for a word or phrase. Use this when ' +
      'asked what the robot knows, remembers or has seen before, especially about a place it ' +
      'is not standing in right now. Returns matching lines with where each came from and how ' +
      'much it is trusted.',
    inputSchema: z.object({
      query: z.string().describe('Words to look for, e.g. "pallet aisle 3"'),
    }),
  },
  async (input: { query: string }) => {
    console.log(`[Tool:recallMemory] "${input.query}"`);
    try {
      const hits = recallAcrossPlaces(input.query);
      return {
        success: true,
        query: input.query,
        // Stated rather than implied: "nothing found" and "the robot has no
        // memory" read the same to a model unless one of them says so.
        message:
          hits.length > 0
            ? `${hits.length} matching entr${hits.length === 1 ? 'y' : 'ies'}.`
            : 'Nothing in memory or in the last 7 days of journal matches that.',
        hits,
      };
    } catch (error) {
      return {
        success: false,
        message: `Could not read the memory workspace: ${error instanceof Error ? error.message : String(error)}`,
        hits: [] as RecallHit[],
      };
    }
  },
);
