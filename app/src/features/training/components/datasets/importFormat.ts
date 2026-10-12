/**
 * @file importFormat.ts
 * @description What the Hub import UI says about an import: the repo and
 *              revision a pasted link names, a commit as a short SHA, and a
 *              failure as its cause first (TASK-358)
 * @feature training
 */

// ============================================================================
// HUB REFERENCES
// ============================================================================

export interface HubReference {
  repoId: string;
  /** The branch, tag or commit the link points into — null when it names none. */
  revision: string | null;
}

/**
 * Read a repo id — and, from a `/tree/<rev>` or `/blob/<rev>/…` link, the
 * revision — out of whatever was pasted:
 *
 *   https://huggingface.co/datasets/lerobot/pusht/tree/v2.1  → lerobot/pusht @ v2.1
 *   huggingface.co/datasets/lerobot/pusht/blob/main/meta/info.json → @ main
 *   lerobot/pusht                                             → no revision
 *
 * A revision with a slash in it (`refs/pr/3`) is percent-encoded in Hub links,
 * so the segment is decoded. Null when it is neither a link nor `owner/name`.
 */
export function parseHubReference(input: string): HubReference | null {
  const text = input.trim();
  if (!text) return null;

  const link = text.match(
    /^(?:https?:\/\/)?(?:www\.)?(?:huggingface\.co\/)?datasets\/([^/\s?#]+\/[^/\s?#]+)(?:\/(?:tree|blob|resolve)\/([^/\s?#]+))?/,
  );
  if (link) {
    return { repoId: link[1], revision: link[2] ? decodeSegment(link[2]) : null };
  }

  const bare = text.match(/^([^/\s]+\/[^/\s]+)$/);
  return bare ? { repoId: bare[1], revision: null } : null;
}

function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/** A full commit SHA as its first 8 characters; a branch or tag unchanged. */
export function shortRevision(revision: string | null | undefined): string | null {
  if (!revision) return null;
  return /^[0-9a-f]{40}$/i.test(revision) ? revision.slice(0, 8) : revision;
}

/** `lerobot/pusht@89d5752c` — the repo with the commit it was pinned to. */
export function formatRepoAtRevision(repoId: string, revision: string | null | undefined): string {
  const rev = shortRevision(revision);
  return rev ? `${repoId}@${rev}` : repoId;
}

/** `v2.1` → `LeRobot v2.1`; null when the version is unknown. */
export function formatLerobotVersion(version: string | null | undefined): string | null {
  if (!version) return null;
  return `LeRobot ${version.startsWith('v') ? version : `v${version}`}`;
}

// ============================================================================
// FAILURES
// ============================================================================

export interface ImportFailureSummary {
  /** The cause, short enough to read at a glance: "Storage unreachable (ECONNREFUSED)" */
  headline: string;
  /** Everything the server said, file name included — for the tooltip. */
  detail: string;
  /** The file the transfer stopped on, when the server named one. */
  file: string | null;
}

/** Network error codes Node reports when the other end never answered. */
const UNREACHABLE_CODES = ['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'ETIMEDOUT', 'ECONNRESET', 'EHOSTUNREACH', 'ENETUNREACH', 'EPIPE'];

/**
 * The server words a transfer failure as
 * `File <path>: <fetch|write> to <sink> failed after <n> attempt(s): <detail>`
 * — accurate, and the cause comes last, past a long file path the panel
 * truncates. This puts the cause first and keeps the rest for the tooltip.
 */
export function describeImportFailure(
  message: string | null | undefined,
  /** Where it stopped, when known — names the side of an unnamed network failure. */
  phase?: string | null,
): ImportFailureSummary {
  const detail = (message ?? '').trim() || 'Import failed';
  const transfer = detail.match(/^File (.+?): (fetch|write) to (\S+) failed after \d+ attempt\(s\): ([\s\S]*)$/);
  const file = transfer ? transfer[1] : null;
  const stage = transfer ? (transfer[2] as 'fetch' | 'write') : null;
  const cause = transfer ? transfer[4] : detail;

  const code = UNREACHABLE_CODES.find((c) => cause.includes(c));
  const http = cause.match(/\bHTTP (\d{3})\b|\bstatus(?: code)? (\d{3})\b/i);
  const httpStatus = http ? Number(http[1] ?? http[2]) : null;

  let headline: string;
  if (code) {
    const side = stage ?? (phase === 'storing' ? 'write' : phase === 'metadata' ? 'fetch' : null);
    const where = side === 'fetch' ? 'Hugging Face' : side === 'write' ? 'Storage' : 'Connection';
    headline = `${where} unreachable (${code})`;
  } else if (stage === 'fetch' && httpStatus) {
    headline =
      httpStatus === 401 || httpStatus === 403 ? `Hugging Face refused access (HTTP ${httpStatus})`
        : httpStatus === 404 ? 'File not found on Hugging Face (HTTP 404)'
          : httpStatus === 429 ? 'Hugging Face rate limit (HTTP 429)'
            : `Download failed (HTTP ${httpStatus})`;
  } else if (stage === 'write') {
    headline = `Storage write failed${httpStatus ? ` (HTTP ${httpStatus})` : ''}`;
  } else if (stage === 'fetch') {
    headline = 'Download failed';
  } else {
    headline = firstSentence(detail);
  }

  return { headline, detail, file };
}

/** The first line of a long message, bounded, for a headline. */
function firstSentence(text: string): string {
  const line = text.split('\n')[0];
  return line.length > 140 ? `${line.slice(0, 137)}…` : line;
}
