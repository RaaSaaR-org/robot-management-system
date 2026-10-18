/**
 * @file codeAge.ts
 * @description Is a robot-side process older than the code it runs? (TASK-419)
 *
 * D1: compare the process's start time (/proc/<pid>/stat) with the newest commit
 * time of the code it runs — `robot-agent/src` + `robot-agent/package-lock.json`
 * for the agent, the script file for the bridge and the sidecar. The files'
 * modification times count as well: an edit, a pull or a checkout rewrites them,
 * so "pulled but not restarted" is caught even when the pulled commit is older
 * than the process. (A literal "dirty = now" would make every process in a
 * development checkout stale 30 s after it started.)
 *
 * A process that runs from a different checkout (its cwd sits in another git
 * tree, e.g. an old worktree) is compared by that checkout's own commit time of
 * the same paths: it is stale when its code is older than ours, whenever it was
 * started.
 *
 * Git answers are cached for 30 s. Nothing in here signals a process.
 * @feature supervisor
 */

import { readdirSync, readFileSync, readlinkSync, statSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { processSince } from './procs.js';
import type { RunFn } from './steps.js';

/** The `checks.staleCode` / `foreign.staleCode` value: the process started before its code. */
export interface StaleCode {
  /** When the process started (ISO). */
  startedAt: string;
  /** The newest change of the code it should run (ISO). */
  codeAt: string;
}

export const CODE_AGE_CACHE_MS = 30_000;

interface Cached<T> {
  at: number;
  value: T;
}

export interface CodeAgeOptions {
  repoRoot: string;
  run: RunFn;
  now?: () => number;
  procRoot?: string;
}

export class CodeAge {
  private readonly repoRoot: string;
  private readonly run: RunFn;
  private readonly now: () => number;
  private readonly procRoot: string;
  private readonly codeCache = new Map<string, Cached<number | null>>();
  private readonly topCache = new Map<string, Cached<string | null>>();

  constructor(opts: CodeAgeOptions) {
    this.repoRoot = resolve(opts.repoRoot);
    this.run = opts.run;
    this.now = opts.now ?? Date.now;
    this.procRoot = opts.procRoot ?? '/proc';
  }

  /** Paths relative to the repo root; absolute paths outside it are dropped. */
  relPaths(paths: string[]): string[] {
    const out: string[] = [];
    for (const p of paths) {
      const rel = isAbsolute(p) ? relative(this.repoRoot, p) : p;
      if (!rel || rel.startsWith('..') || isAbsolute(rel)) continue;
      out.push(rel);
    }
    return out;
  }

  /**
   * The newest change (epoch ms) of `relPaths` in the git tree at `root`: the
   * last commit touching them and, with `files`, the newest modification time
   * of the files on disk (an edit, a pull or a checkout rewrites them). Null
   * when neither can be read (not a repo, no git, no files).
   */
  async codeAt(root: string, relPaths: string[], files = true): Promise<number | null> {
    if (relPaths.length === 0) return null;
    const key = `${root}\0${files ? 'f' : 'c'}\0${relPaths.join('\0')}`;
    const hit = this.codeCache.get(key);
    if (hit && this.now() - hit.at < CODE_AGE_CACHE_MS) return hit.value;
    const value = await this.readCodeAt(root, relPaths, files);
    this.codeCache.set(key, { at: this.now(), value });
    return value;
  }

  private async readCodeAt(root: string, relPaths: string[], files: boolean): Promise<number | null> {
    const log = await this.run('git', ['-C', root, 'log', '-1', '--format=%ct', '--', ...relPaths], { timeoutMs: 10_000 });
    const ct = log.code === 0 ? Number(log.stdout.trim()) : NaN;
    let newest = Number.isFinite(ct) && ct > 0 ? ct * 1000 : null;
    if (files) {
      for (const rel of relPaths) {
        const m = newestMtime(join(root, rel));
        if (m !== null) newest = newest === null ? m : Math.max(newest, m);
      }
    }
    return newest;
  }

  /** The git toplevel a directory belongs to, or null. Cached like the code times. */
  async toplevel(dir: string): Promise<string | null> {
    const hit = this.topCache.get(dir);
    if (hit && this.now() - hit.at < CODE_AGE_CACHE_MS) return hit.value;
    const r = await this.run('git', ['-C', dir, 'rev-parse', '--show-toplevel'], { timeoutMs: 10_000 });
    const value = r.code === 0 && r.stdout.trim() ? resolve(r.stdout.trim()) : null;
    this.topCache.set(dir, { at: this.now(), value });
    return value;
  }

  /**
   * Stale-code verdict for one running process: null when it is current or
   * cannot be judged (no start time, git cannot say).
   */
  async check(pid: number, codePaths: string[]): Promise<StaleCode | null> {
    const since = processSince(pid, this.procRoot);
    if (!since) return null;
    const rel = this.relPaths(codePaths);
    const ours = await this.codeAt(this.repoRoot, rel);
    if (ours === null) return null;
    const cwd = processCwd(pid, this.procRoot);
    if (cwd) {
      const top = await this.toplevel(cwd);
      if (top && top !== this.repoRoot) {
        // A fresh checkout of old code has new files on disk: compare commits only.
        const theirs = await this.codeAt(top, rel, false);
        const oursCommitted = await this.codeAt(this.repoRoot, rel, false);
        if (theirs !== null && oursCommitted !== null && theirs < oursCommitted) {
          return { startedAt: since, codeAt: new Date(oursCommitted).toISOString() };
        }
        // Another checkout with the same or newer code: judge it by its own files.
        const theirFiles = await this.codeAt(top, rel);
        return theirFiles !== null && Date.parse(since) < theirFiles
          ? { startedAt: since, codeAt: new Date(theirFiles).toISOString() }
          : null;
      }
    }
    return Date.parse(since) < ours ? { startedAt: since, codeAt: new Date(ours).toISOString() } : null;
  }
}

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', '__pycache__']);

/** The newest mtime under a file or directory (ms), or null when it does not exist. */
export function newestMtime(path: string, depth = 0): number | null {
  let st;
  try {
    st = statSync(path);
  } catch {
    return null;
  }
  if (!st.isDirectory()) return st.mtimeMs;
  if (depth > 12) return null;
  let newest: number | null = null;
  let names: string[] = [];
  try {
    names = readdirSync(path);
  } catch {
    return null;
  }
  for (const name of names) {
    if (SKIP_DIRS.has(name)) continue;
    const m = newestMtime(join(path, name), depth + 1);
    if (m !== null) newest = newest === null ? m : Math.max(newest, m);
  }
  return newest;
}

/** /proc/<pid>/cwd, or null when it cannot be read (another user's process). */
export function processCwd(pid: number, procRoot = '/proc'): string | null {
  try {
    return readlinkSync(join(procRoot, String(pid), 'cwd'));
  } catch {
    return null;
  }
}

/**
 * The robot id a process names: `ROBOT_ID` / `G1_ROBOT_ID` in its environment
 * (readable for the same user), else `--robot-id <id>` on its command line.
 */
export function processRobotId(pid: number, cmdline: string[] | null, procRoot = '/proc'): string | null {
  try {
    const env = readFileSync(join(procRoot, String(pid), 'environ'), 'utf8').split('\0');
    for (const key of ['ROBOT_ID=', 'G1_ROBOT_ID=']) {
      const hit = env.find((e) => e.startsWith(key));
      if (hit && hit.length > key.length) return hit.slice(key.length);
    }
  } catch {
    /* not readable */
  }
  if (cmdline) {
    for (let i = 0; i < cmdline.length; i++) {
      const a = cmdline[i];
      if (a === '--robot-id' && cmdline[i + 1]) return cmdline[i + 1];
      if (a.startsWith('--robot-id=')) return a.slice('--robot-id='.length);
    }
  }
  return null;
}

/** "2026-10-17 17:21" in local time, for the step details. */
export function shortDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
