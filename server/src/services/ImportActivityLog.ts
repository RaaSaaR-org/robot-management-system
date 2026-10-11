/**
 * @file ImportActivityLog.ts
 * @description Bounded, in-memory log of what a running dataset import is
 *              doing — the lines a browser shows while it waits, and the last
 *              progress frame, so a page that attaches late can backfill.
 * @feature datasets
 *
 * Memory, not the database, on purpose. The row already persists what has to
 * survive a restart — `status` and `importError` — and a line per downloaded
 * file is chatter that would cost a write each. After a restart `get` returns
 * nothing, and the route reports `retained: false` so the UI can say so.
 */

import type { HuggingFaceImportProgress, ImportLogLevel, ImportLogLine } from '../types/dataset.types.js';

/** Lines kept per import. A G1 repo has ~1,500 files; the tail is what matters. */
export const IMPORT_LOG_MAX_LINES = 300;

/** Imports remembered at once; the oldest is forgotten first. */
export const IMPORT_LOG_MAX_IMPORTS = 50;

export interface ImportActivity {
  lines: ImportLogLine[];
  progress: HuggingFaceImportProgress | null;
  /** Lines dropped off the front of the ring, so the UI can say "… N earlier". */
  dropped: number;
}

export class ImportActivityLog {
  // A Map iterates in insertion order, which is what eviction needs: a
  // re-started import is deleted and re-inserted, so it becomes the newest.
  private readonly entries = new Map<string, ImportActivity>();

  constructor(
    private readonly maxLines = IMPORT_LOG_MAX_LINES,
    private readonly maxImports = IMPORT_LOG_MAX_IMPORTS,
  ) {}

  /** Forget anything earlier for this dataset and start an empty log. */
  start(datasetId: string): void {
    this.entries.delete(datasetId);
    this.entries.set(datasetId, { lines: [], progress: null, dropped: 0 });
    while (this.entries.size > this.maxImports) {
      const oldest = this.entries.keys().next().value as string;
      this.entries.delete(oldest);
    }
  }

  append(datasetId: string, level: ImportLogLevel, message: string, at = new Date()): ImportLogLine {
    if (!this.entries.has(datasetId)) this.start(datasetId);
    const entry = this.entries.get(datasetId)!;
    const line: ImportLogLine = { at: at.toISOString(), level, message };
    entry.lines.push(line);
    if (entry.lines.length > this.maxLines) {
      entry.dropped += entry.lines.splice(0, entry.lines.length - this.maxLines).length;
    }
    return line;
  }

  setProgress(datasetId: string, progress: HuggingFaceImportProgress): void {
    if (!this.entries.has(datasetId)) this.start(datasetId);
    this.entries.get(datasetId)!.progress = progress;
  }

  get(datasetId: string): ImportActivity | null {
    const entry = this.entries.get(datasetId);
    if (!entry) return null;
    return { lines: [...entry.lines], progress: entry.progress, dropped: entry.dropped };
  }

  forget(datasetId: string): void {
    this.entries.delete(datasetId);
  }
}

export const importActivityLog = new ImportActivityLog();
