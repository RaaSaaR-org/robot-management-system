/**
 * @file procs.ts
 * @description Process plumbing for the supervisor: spawning children in their own
 * session (setsid), PID files that survive a supervisor restart, identity checks
 * through /proc (cmdline + start time, so a recycled PID is never mistaken for a
 * child), finding which process listens on a port, and scanning for conflicting
 * processes such as xr_teleoperate. Nothing in here sends a signal: that is
 * Supervisor.signal(), which enforces the never-kill rules.
 * @feature supervisor
 */

import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
  writeSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import type { ChildSpec, ProcName, SidecarMode } from './profile.js';

export interface ProcStat {
  state: string;
  ppid: number;
  pgrp: number;
  session: number;
  /** Clock ticks since boot (field 22). Stable for the life of the process, across exec. */
  startTime: number;
}

export function readStat(pid: number, procRoot = '/proc'): ProcStat | null {
  let raw: string;
  try {
    raw = readFileSync(join(procRoot, String(pid), 'stat'), 'utf8');
  } catch {
    return null;
  }
  // comm may contain spaces and parentheses: everything after the LAST ')' is fixed.
  const close = raw.lastIndexOf(')');
  if (close < 0) return null;
  const f = raw.slice(close + 2).trim().split(/\s+/);
  // f[0] = state (field 3), so field N is f[N - 3].
  const startTime = Number(f[22 - 3]);
  return {
    state: f[0],
    ppid: Number(f[4 - 3]),
    pgrp: Number(f[5 - 3]),
    session: Number(f[6 - 3]),
    startTime,
  };
}

export function readCmdline(pid: number, procRoot = '/proc'): string[] | null {
  try {
    const raw = readFileSync(join(procRoot, String(pid), 'cmdline'), 'utf8');
    const parts = raw.split('\0');
    if (parts.length && parts[parts.length - 1] === '') parts.pop();
    return parts;
  } catch {
    return null;
  }
}

/** Alive = has a /proc entry, is not a zombie, and (when given) still has that start time. */
export function isAlive(pid: number, startTime?: number, procRoot = '/proc'): boolean {
  const st = readStat(pid, procRoot);
  if (!st || st.state === 'Z' || st.state === 'X') return false;
  return startTime === undefined || st.startTime === startTime;
}

let cachedBootMs: number | null = null;
let cachedTicks: number | null = null;

function bootTimeMs(procRoot: string): number | null {
  if (cachedBootMs !== null) return cachedBootMs;
  try {
    const m = /^btime\s+(\d+)/m.exec(readFileSync(join(procRoot, 'stat'), 'utf8'));
    cachedBootMs = m ? Number(m[1]) * 1000 : null;
  } catch {
    cachedBootMs = null;
  }
  return cachedBootMs;
}

function clockTicks(): number {
  if (cachedTicks !== null) return cachedTicks;
  // getconf CLK_TCK is 100 on every Linux this runs on; there is no Node API for it.
  cachedTicks = Number(process.env.SUPERVISOR_CLK_TCK) || 100;
  return cachedTicks;
}

/** When the process started, as an ISO string, or null when it cannot be read. */
export function processSince(pid: number, procRoot = '/proc'): string | null {
  const st = readStat(pid, procRoot);
  const boot = bootTimeMs(procRoot);
  if (!st || boot === null) return null;
  return new Date(boot + (st.startTime / clockTicks()) * 1000).toISOString();
}

/** True when `pid` is `ancestor`, a descendant of it, or in the session it leads. */
export function belongsTo(pid: number, ancestor: number, procRoot = '/proc'): boolean {
  let cur = pid;
  for (let i = 0; i < 64 && cur > 1; i++) {
    if (cur === ancestor) return true;
    const st = readStat(cur, procRoot);
    if (!st) return false;
    if (i === 0 && st.session === ancestor) return true;
    cur = st.ppid;
  }
  return false;
}

function listeningInodes(port: number, procRoot: string): Set<string> {
  const inodes = new Set<string>();
  for (const file of ['tcp', 'tcp6']) {
    let text: string;
    try {
      text = readFileSync(join(procRoot, 'net', file), 'utf8');
    } catch {
      continue;
    }
    for (const line of text.split('\n').slice(1)) {
      const f = line.trim().split(/\s+/);
      if (f.length < 10) continue;
      const local = f[1];
      const st = f[3];
      if (st !== '0A') continue; // TCP_LISTEN
      const portHex = local.slice(local.lastIndexOf(':') + 1);
      if (parseInt(portHex, 16) === port) inodes.add(f[9]);
    }
  }
  return inodes;
}

/**
 * PIDs holding a listening TCP socket on `port` (any address). Only processes
 * whose /proc/<pid>/fd we may read are found — the same user's, which is every
 * process the supervisor could have started. A listener we cannot attribute is
 * returned as pid -1 so the port still reads as held.
 */
export function findListeners(port: number, procRoot = '/proc'): number[] {
  const inodes = listeningInodes(port, procRoot);
  if (inodes.size === 0) return [];
  const found = new Set<number>();
  let entries: string[] = [];
  try {
    entries = readdirSync(procRoot);
  } catch {
    return [-1];
  }
  for (const name of entries) {
    if (!/^\d+$/.test(name)) continue;
    let fds: string[];
    try {
      fds = readdirSync(join(procRoot, name, 'fd'));
    } catch {
      continue;
    }
    for (const fd of fds) {
      let link: string;
      try {
        link = readlinkSync(join(procRoot, name, 'fd', fd));
      } catch {
        continue;
      }
      const m = /^socket:\[(\d+)\]$/.exec(link);
      if (m && inodes.has(m[1])) {
        found.add(Number(name));
        break;
      }
    }
  }
  return found.size ? [...found] : [-1];
}

export interface FoundProcess {
  pid: number;
  cmdline: string[];
}

/** Like `pgrep -f`: processes whose full command line contains any of `patterns`. */
export function findProcesses(patterns: string[], procRoot = '/proc', exclude: number[] = [process.pid]): FoundProcess[] {
  const out: FoundProcess[] = [];
  let entries: string[] = [];
  try {
    entries = readdirSync(procRoot);
  } catch {
    return out;
  }
  for (const name of entries) {
    if (!/^\d+$/.test(name)) continue;
    const pid = Number(name);
    if (exclude.includes(pid)) continue;
    const cmd = readCmdline(pid, procRoot);
    if (!cmd || cmd.length === 0) continue;
    const joined = cmd.join(' ');
    if (patterns.some((p) => joined.includes(p))) out.push({ pid, cmdline: cmd });
  }
  return out;
}

// ------------------------------------------------------------------ children

export interface ChildRecord {
  proc: ProcName;
  pid: number;
  startTime: number;
  cmdline: string[];
  /** What was asked for: [command, ...args]. Empty for an adopted foreign process. */
  argv: string[];
  /** Started by this supervisor (or re-adopted from its PID file). Only owned children are ever signalled. */
  owned: boolean;
  mode: SidecarMode | null;
  startedAt: string;
  logPath: string;
  /** Present only for a child spawned by this supervisor instance. */
  child?: ChildProcess;
  exited: boolean;
  exitCode: number | null;
  exitSignal: string | null;
}

export interface PidFile {
  proc: ProcName;
  pid: number;
  startTime: number;
  cmdline: string[];
  argv: string[];
  owned: boolean;
  mode: SidecarMode | null;
  startedAt: string;
  logPath: string;
}

export function pidFilePath(stateDir: string, robotId: string, proc: ProcName): string {
  return join(stateDir, robotId, `${proc}.pid`);
}

export function logFilePath(stateDir: string, robotId: string, proc: string): string {
  return join(stateDir, 'logs', `${robotId}-${proc}.log`);
}

export function writePidFile(path: string, rec: ChildRecord): void {
  mkdirSync(dirname(path), { recursive: true });
  const data: PidFile = {
    proc: rec.proc,
    pid: rec.pid,
    startTime: rec.startTime,
    cmdline: rec.cmdline,
    argv: rec.argv,
    owned: rec.owned,
    mode: rec.mode,
    startedAt: rec.startedAt,
    logPath: rec.logPath,
  };
  writeFileSync(path, JSON.stringify(data, null, 2) + '\n');
}

export function removePidFile(path: string): void {
  rmSync(path, { force: true });
}

/**
 * Re-adopt a child from its PID file: the PID must still exist with the same
 * start time AND the same command line. Anything else is a stale file (the
 * child died, or the PID was recycled by an unrelated process) and is removed.
 */
export function readAdoptable(path: string, procRoot = '/proc'): ChildRecord | null {
  if (!existsSync(path)) return null;
  let data: PidFile;
  try {
    data = JSON.parse(readFileSync(path, 'utf8')) as PidFile;
  } catch {
    removePidFile(path);
    return null;
  }
  const cmd = readCmdline(data.pid, procRoot);
  const same = isAlive(data.pid, data.startTime, procRoot) && cmd !== null && cmdlineMatches(cmd, data);
  if (!same || cmd === null) {
    removePidFile(path);
    return null;
  }
  return { ...data, argv: data.argv ?? [], cmdline: cmd, exited: false, exitCode: null, exitSignal: null };
}

/**
 * Whether a live command line is the child a PID file describes. Exact match, or
 * — because a `#!/usr/bin/env node` script (tsx) re-execs after the PID file was
 * written — the command line still carries the requested command and ends with
 * the requested arguments. The start time, checked separately, is what rules out
 * a recycled PID; this rules out a different program under the same PID.
 */
export function cmdlineMatches(cmd: string[], data: Pick<PidFile, 'cmdline' | 'argv'>): boolean {
  if (cmd.length === data.cmdline.length && cmd.every((c, i) => c === data.cmdline[i])) return true;
  const argv = data.argv ?? [];
  if (argv.length === 0) return false;
  const [command, ...args] = argv;
  if (!cmd.includes(command)) return false;
  if (args.length > cmd.length) return false;
  const tail = cmd.slice(cmd.length - args.length);
  return args.every((a, i) => a === tail[i]);
}

const MAX_LOG_BYTES = 20 * 1024 * 1024;

/**
 * Spawn a child in its own session. Its stdout and stderr go straight to its log
 * file, never through a pipe to the supervisor: a supervisor restart must not
 * hand a running sidecar a broken pipe (a Python print would then raise).
 */
export async function spawnChild(spec: ChildSpec, logPath: string, procRoot = '/proc'): Promise<ChildRecord> {
  mkdirSync(dirname(logPath), { recursive: true });
  try {
    if (statSync(logPath).size > MAX_LOG_BYTES) renameSync(logPath, `${logPath}.1`);
  } catch {
    /* no log yet */
  }
  const fd = openSync(logPath, 'a');
  const startedAt = new Date().toISOString();
  writeSync(fd, `\n=== ${startedAt} supervisor starts ${spec.proc}: ${spec.command} ${spec.args.join(' ')}\n`);
  let child: ChildProcess;
  try {
    child = spawn(spec.command, spec.args, {
      cwd: spec.cwd,
      env: spec.env,
      detached: true, // setsid(): own session and process group, survives the supervisor
      stdio: ['ignore', fd, fd],
    });
  } finally {
    closeSync(fd);
  }
  await new Promise<void>((resolveSpawn, reject) => {
    child.once('spawn', () => resolveSpawn());
    child.once('error', (err) => reject(new Error(`${spec.proc} could not start ${spec.command}: ${err.message}`)));
  });
  const pid = child.pid as number;
  const st = readStat(pid, procRoot);
  const rec: ChildRecord = {
    proc: spec.proc,
    pid,
    startTime: st?.startTime ?? -1,
    cmdline: readCmdline(pid, procRoot) ?? [spec.command, ...spec.args],
    argv: [spec.command, ...spec.args],
    owned: true,
    mode: spec.mode,
    startedAt,
    logPath,
    child,
    exited: false,
    exitCode: null,
    exitSignal: null,
  };
  child.on('exit', (code, signal) => {
    rec.exited = true;
    rec.exitCode = code;
    rec.exitSignal = signal;
  });
  return rec;
}

/** Whether a record's process is still running (identity-checked through /proc). */
export function recAlive(rec: ChildRecord, procRoot = '/proc'): boolean {
  if (rec.exited) return false;
  return isAlive(rec.pid, rec.startTime >= 0 ? rec.startTime : undefined, procRoot);
}
