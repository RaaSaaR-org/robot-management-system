/**
 * @file tour-transcript-cleanup.ts
 * @description Retention sweep for host-mode visitor transcripts (TASK-213):
 *              after TOUR_TRANSCRIPT_RETENTION_DAYS (30 d) the questions and
 *              answers are cleared from every stored `TourRun`; the run itself
 *              is kept, because how far a visit got is the operational record
 *              and no longer personal data once the words are gone.
 * @feature tour
 *
 * The robot runs the same sweep over its own copy under
 * `workspace-<id>/tour/…` (`TourRunStore.sweep`). Both halves are needed: the
 * robot's copy is what a visitor's Art. 17 request erases with the workspace,
 * and THIS copy is the one the UI reads. Sweeping only one of them means the
 * words are still there.
 */

import { tourRepository } from '../repositories/TourRepository.js';

const DEFAULT_RETENTION_DAYS = 30;

/** `TOUR_TRANSCRIPT_RETENTION_DAYS`, the same variable the robot reads. */
export function transcriptRetentionDays(): number {
  const parsed = Number(process.env.TOUR_TRANSCRIPT_RETENTION_DAYS);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_RETENTION_DAYS;
}

export interface TourTranscriptCleanupResult {
  cutoff: Date;
  clearedCount: number;
  errors: string[];
}

export class TourTranscriptCleanupJob {
  private intervalId: NodeJS.Timeout | null = null;
  private initialTimeout: NodeJS.Timeout | null = null;
  private isRunning = false;

  async runCleanup(): Promise<TourTranscriptCleanupResult> {
    const days = transcriptRetentionDays();
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    if (this.isRunning) {
      return { cutoff, clearedCount: 0, errors: ['Cleanup already in progress'] };
    }
    this.isRunning = true;
    try {
      const clearedCount = await tourRepository.clearTranscriptsBefore(cutoff);
      if (clearedCount > 0) {
        console.log(
          `[TourTranscriptCleanupJob] cleared the transcript of ${clearedCount} visit(s) older than ${days}d`,
        );
      }
      return { cutoff, clearedCount, errors: [] };
    } catch (error) {
      console.error('[TourTranscriptCleanupJob] Cleanup failed:', error);
      return { cutoff, clearedCount: 0, errors: [error instanceof Error ? error.message : 'Unknown error'] };
    } finally {
      this.isRunning = false;
    }
  }

  /** Daily, first run five minutes after boot — a day-scale window needs no precision. */
  startSchedule(intervalHours = 24): void {
    if (this.intervalId || this.initialTimeout) return;
    this.initialTimeout = setTimeout(() => {
      this.initialTimeout = null;
      void this.runCleanup();
      this.intervalId = setInterval(() => void this.runCleanup(), intervalHours * 60 * 60 * 1000);
      this.intervalId.unref?.();
    }, 5 * 60_000);
    this.initialTimeout.unref?.();
    console.log(
      `[TourTranscriptCleanupJob] scheduled every ${intervalHours}h (retention ${transcriptRetentionDays()}d)`,
    );
  }

  stopSchedule(): void {
    if (this.initialTimeout) clearTimeout(this.initialTimeout);
    if (this.intervalId) clearInterval(this.intervalId);
    this.initialTimeout = null;
    this.intervalId = null;
  }
}

export const tourTranscriptCleanupJob = new TourTranscriptCleanupJob();
