/**
 * @file index.ts
 * @description Entry point of the robot supervisor (TASK-403): one process per
 * robot, bound to 127.0.0.1, guarded by a lock file. Stopping the supervisor
 * never touches its children — they keep running and are re-adopted from their
 * PID files on the next start (the systemd unit uses KillMode=process for that).
 *
 *   ROBOT_SUPERVISOR_TOKEN=... node --import tsx src/index.ts <profile.yaml>
 *
 * Env: ROBOT_SUPERVISOR_PROFILE (instead of the argument), ROBOT_SUPERVISOR_PORT
 * (default 8766), NEODEM_STATE_DIR (default ~/.local/state/neodem).
 * @feature supervisor
 */

import { closeSync, mkdirSync, openSync, readFileSync, readlinkSync, rmSync, writeSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApi } from './api.js';
import { readCmdline } from './procs.js';
import { ProfileError } from './profile.js';
import { Supervisor } from './steps.js';

export const DEFAULT_PORT = 8766;

export function defaultStateDir(): string {
  return process.env.NEODEM_STATE_DIR || join(homedir(), '.local', 'state', 'neodem');
}

/** Repository root: this file is robot-agent/supervisor/src/index.ts. */
export function repoRootFromHere(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
}

/** A live process that is a supervisor: its command line or working directory says so. */
function looksLikeSupervisor(pid: number): boolean {
  const cmd = readCmdline(pid);
  if (!cmd) return false;
  let cwd = '';
  try {
    cwd = readlinkSync(`/proc/${pid}/cwd`);
  } catch {
    /* another user's process: judge by the command line alone */
  }
  return cmd.join(' ').includes('supervisor') || cwd.includes('supervisor');
}

/**
 * Take ~/.local/state/neodem/<robotId>/supervisor.lock. A lock whose PID is
 * still a running supervisor refuses the start; a stale one is replaced.
 */
export function acquireLock(path: string): () => void {
  mkdirSync(dirname(path), { recursive: true });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = openSync(path, 'wx');
      writeSync(fd, `${process.pid}\n`);
      closeSync(fd);
      return () => {
        try {
          if (readFileSync(path, 'utf8').trim() === String(process.pid)) rmSync(path, { force: true });
        } catch {
          /* already gone */
        }
      };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
      const pid = Number(readFileSync(path, 'utf8').trim());
      if (Number.isInteger(pid) && pid > 0 && looksLikeSupervisor(pid)) {
        throw new Error(`another supervisor (pid ${pid}) holds ${path} — one supervisor per robot`);
      }
      rmSync(path, { force: true }); // stale: that process is gone or is something else now
    }
  }
  throw new Error(`could not take the lock ${path}`);
}

async function main(): Promise<void> {
  const profilePath = process.argv[2] || process.env.ROBOT_SUPERVISOR_PROFILE;
  if (!profilePath) {
    console.error('usage: robot-supervisor <profile.yaml>   (or set ROBOT_SUPERVISOR_PROFILE)');
    process.exit(2);
  }
  const token = process.env.ROBOT_SUPERVISOR_TOKEN ?? '';
  if (token.length < 16) {
    console.error('[supervisor] ROBOT_SUPERVISOR_TOKEN must be set (at least 16 characters) — refusing to start');
    process.exit(2);
  }
  const port = Number(process.env.ROBOT_SUPERVISOR_PORT || DEFAULT_PORT);
  const stateDir = defaultStateDir();

  let sup: Supervisor;
  try {
    sup = new Supervisor({ profilePath: resolve(profilePath), repoRoot: repoRootFromHere(), stateDir });
  } catch (e) {
    console.error(`[supervisor] ${e instanceof ProfileError ? e.message : String(e)}`);
    process.exit(2);
  }
  const release = acquireLock(join(stateDir, sup.profile.robotId, 'supervisor.lock'));
  await sup.init();
  const server = createApi(sup, { token });
  server.on('error', (e) => {
    console.error(`[supervisor] cannot listen on 127.0.0.1:${port}: ${e.message}`);
    release();
    process.exit(1);
  });
  server.listen(port, '127.0.0.1', () => {
    console.log(`[supervisor] ${sup.profile.robotId} (${sup.profile.robot}) on http://127.0.0.1:${port} — profile ${sup.profilePath}`);
  });

  const shutdown = (sig: string) => {
    // Children are deliberately left running: the next supervisor re-adopts them.
    console.log(`[supervisor] ${sig} — exiting; children keep running and are re-adopted on the next start`);
    sup.detach();
    release();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

const invokedDirectly = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main().catch((e: unknown) => {
    console.error(`[supervisor] ${(e as Error).message}`);
    process.exit(1);
  });
}
