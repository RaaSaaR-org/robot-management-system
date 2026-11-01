/**
 * @file logs.ts
 * @description Per-process logs: each child writes to its own file under
 * ~/.local/state/neodem/logs/, and a LogTailer follows that file into a
 * 2000-line ring buffer for GET /logs/:proc and the SSE stream. Following the
 * file (rather than a pipe) is what lets a restarted supervisor show the log of
 * a child it re-adopted.
 * @feature supervisor
 */

import { closeSync, openSync, readSync, statSync } from 'node:fs';

export const RING_LINES = 2000;

export class RingBuffer {
  private lines: string[] = [];

  constructor(private readonly capacity = RING_LINES) {}

  push(line: string): void {
    this.lines.push(line);
    if (this.lines.length > this.capacity) this.lines.splice(0, this.lines.length - this.capacity);
  }

  tail(n: number): string[] {
    if (n <= 0) return [];
    return this.lines.slice(-n);
  }

  get size(): number {
    return this.lines.length;
  }
}

export type LineListener = (line: string) => void;

/** How much of an existing file to replay into the ring on start. */
const BACKFILL_BYTES = 256 * 1024;

export class LogTailer {
  readonly ring = new RingBuffer();
  private offset = 0;
  private partial = '';
  private timer: NodeJS.Timeout | null = null;
  private listeners = new Set<LineListener>();

  constructor(
    readonly path: string,
    private readonly pollMs = 200,
  ) {
    try {
      const size = statSync(path).size;
      // Starting mid-file usually cuts the first line; harmless for a log view.
      this.offset = Math.max(0, size - BACKFILL_BYTES);
      this.poll();
    } catch {
      this.offset = 0;
    }
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.poll(), this.pollMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.listeners.clear();
  }

  subscribe(fn: LineListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Read whatever was appended since the last poll. Public so tests and step code can flush. */
  poll(): void {
    let size: number;
    try {
      size = statSync(this.path).size;
    } catch {
      return;
    }
    if (size < this.offset) {
      // truncated or rotated: start over
      this.offset = 0;
      this.partial = '';
    }
    if (size === this.offset) return;
    const fd = openSync(this.path, 'r');
    try {
      const len = size - this.offset;
      const buf = Buffer.alloc(len);
      let read = 0;
      while (read < len) {
        const n = readSync(fd, buf, read, len - read, this.offset + read);
        if (n <= 0) break;
        read += n;
      }
      this.offset += read;
      const text = this.partial + buf.subarray(0, read).toString('utf8');
      const parts = text.split('\n');
      this.partial = parts.pop() ?? '';
      for (const line of parts) {
        this.ring.push(line);
        for (const fn of this.listeners) fn(line);
      }
    } finally {
      closeSync(fd);
    }
  }

  tail(n: number): string[] {
    this.poll();
    return this.ring.tail(n);
  }
}
