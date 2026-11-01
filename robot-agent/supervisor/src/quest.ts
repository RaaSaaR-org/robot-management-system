/**
 * @file quest.ts
 * @description The Meta Quest on this robot PC's USB (TASK-412): which headsets
 * adb sees and in what state, which ports are reversed, and the two things the
 * operator may ask for — `adb reverse tcp:<port> tcp:<port>` and opening the
 * session page in the Quest browser. adb runs here because the cable is on the
 * robot PC, not on whatever host runs the NeoDEM server (D1).
 *
 * Every adb call is `execFile` with an argument array — never a shell string —
 * and the only thing that reaches the headset's shell is a path matched by
 * OPEN_PATH (D4): the session page for a robot, or one session by id.
 * @feature supervisor
 */

import { execFile } from 'node:child_process';
import { accessSync, constants } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';

export type QuestDeviceState = 'device' | 'unauthorized' | 'offline';

export interface QuestDevice {
  serial: string;
  state: QuestDeviceState;
  /** `model:Quest_3` → `Quest 3`; null when adb does not say. */
  model: string | null;
}

export interface QuestReverse {
  remote: string;
  local: string;
}

export interface QuestStatus {
  /** The adb binary in use, or null when none was found. */
  adb: string | null;
  devices: QuestDevice[];
  /** Reverse rules of the headset Connect and Open would use. */
  reversed: QuestReverse[];
  /** What the operator has to do next, mirroring scripts/quest-connect.sh; null when nothing. */
  hint: string | null;
}

export interface QuestActionResult {
  ok: boolean;
  /** HTTP status the API answers with. */
  status: number;
  code: string | null;
  error: string | null;
  serial: string | null;
  quest: QuestStatus;
}

/** The dev server port `scripts/quest-connect.sh` reverses unless told otherwise. */
export const QUEST_DEFAULT_PORT = 1420;
export const QUEST_BROWSER = 'com.oculus.browser';
/**
 * The only paths the headset may be sent to: the robot's live session
 * (`/data-collection/live?robot=<id>`) or one session by uuid.
 */
export const OPEN_PATH = /^\/data-collection\/(live\?robot=[A-Za-z0-9_-]+|[0-9a-f-]{36})$/;

/** The script's messages for exit codes 3 (no device) and 4 (unauthorized / offline). */
export const QUEST_HINTS = {
  noAdb: 'adb not found. Install Android platform-tools into ~/platform-tools, or set quest.adb in the robot profile.',
  none: 'No headset on USB. Developer Mode on, a data cable into this robot PC, headset awake?',
  unauthorized: 'Put on the headset and allow USB debugging (tick "Always allow from this computer").',
  offline: 'The headset is offline to adb. Replug the cable.',
  notReversed: (port: number) => `Headset connected. Press Connect to forward port ${port}.`,
} as const;

export type ExecFn = (file: string, args: string[], timeoutMs: number) => Promise<{ code: number | null; stdout: string; stderr: string }>;

export const execAdb: ExecFn = (file, args, timeoutMs) =>
  new Promise((resolveExec) => {
    execFile(file, args, { timeout: timeoutMs, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
      const raw = err ? (err as { code?: unknown }).code : 0;
      resolveExec({
        code: typeof raw === 'number' ? raw : null,
        stdout: String(stdout ?? ''),
        stderr: String(stderr || (err ? err.message : '')),
      });
    });
  });

const ADB_TIMEOUT_MS = 5_000;

function isExecutable(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export interface FindAdbOptions {
  /** `quest.adb` from the robot profile. */
  configured?: string | null;
  home?: string;
  pathEnv?: string;
  isExecutable?: (path: string) => boolean;
}

/** The profile's `quest.adb`, else ~/platform-tools/adb, ~/.local/opt/platform-tools/adb, adb on PATH. */
export function findAdb(opts: FindAdbOptions = {}): string | null {
  const exec = opts.isExecutable ?? isExecutable;
  if (opts.configured) return exec(opts.configured) ? opts.configured : null;
  const home = opts.home ?? homedir();
  for (const candidate of [join(home, 'platform-tools', 'adb'), join(home, '.local', 'opt', 'platform-tools', 'adb')]) {
    if (exec(candidate)) return candidate;
  }
  for (const dir of (opts.pathEnv ?? process.env.PATH ?? '').split(delimiter)) {
    if (!dir) continue;
    const candidate = join(dir, 'adb');
    if (exec(candidate)) return candidate;
  }
  return null;
}

/** `adb devices -l` → devices. Lines in other states (recovery, sideload, …) are left out. */
export function parseDevices(stdout: string): QuestDevice[] {
  const out: QuestDevice[] = [];
  for (const line of stdout.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('List of devices') || trimmed.startsWith('*')) continue;
    const parts = trimmed.split(/\s+/);
    const [serial, state] = parts;
    if (!serial || (state !== 'device' && state !== 'unauthorized' && state !== 'offline')) continue;
    const modelTok = parts.find((p) => p.startsWith('model:'));
    out.push({ serial, state, model: modelTok ? modelTok.slice('model:'.length).replace(/_/g, ' ') : null });
  }
  return out;
}

/** `adb reverse --list` → rules (`<serial|UsbFfs> tcp:1420 tcp:1420`). */
export function parseReverse(stdout: string): QuestReverse[] {
  const out: QuestReverse[] = [];
  for (const line of stdout.split('\n')) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 2) continue;
    const local = parts[parts.length - 1];
    const remote = parts[parts.length - 2];
    if (/^tcp:\d+$/.test(remote) && /^tcp:\d+$/.test(local)) out.push({ remote, local });
  }
  return out;
}

/**
 * The headset Connect and Open act on: the one in state `device`, preferring
 * one that calls itself a Quest when several are attached (as the script does).
 */
export function pickDevice(devices: QuestDevice[]): QuestDevice | null {
  const ready = devices.filter((d) => d.state === 'device');
  if (ready.length <= 1) return ready[0] ?? null;
  return ready.find((d) => /quest/i.test(d.model ?? '')) ?? ready[0];
}

export function hintFor(adb: string | null, devices: QuestDevice[], reversed: QuestReverse[], port: number): string | null {
  if (!adb) return QUEST_HINTS.noAdb;
  if (devices.length === 0) return QUEST_HINTS.none;
  if (pickDevice(devices)) {
    return reversed.some((r) => r.remote === `tcp:${port}`) ? null : QUEST_HINTS.notReversed(port);
  }
  if (devices.some((d) => d.state === 'unauthorized')) return QUEST_HINTS.unauthorized;
  return QUEST_HINTS.offline;
}

export interface QuestControlOptions {
  /** `quest.adb` from the robot profile. */
  adb?: string | null;
  exec?: ExecFn;
  /** Resolve the adb binary (tests); default `findAdb`. */
  findAdb?: (configured: string | null) => string | null;
  port?: number;
}

export class QuestError extends Error {
  constructor(
    readonly httpStatus: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export function validPort(v: unknown): number {
  if (v === undefined || v === null) return QUEST_DEFAULT_PORT;
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 1024 || v > 65535) {
    throw new QuestError(400, 'bad_port', 'port must be an integer 1024-65535');
  }
  return v;
}

export function validOpenPath(v: unknown): string {
  if (typeof v !== 'string' || !OPEN_PATH.test(v)) {
    throw new QuestError(
      400,
      'bad_path',
      'path must be /data-collection/live?robot=<id> or /data-collection/<session uuid>',
    );
  }
  return v;
}

export class QuestControl {
  private readonly configured: string | null;
  private readonly exec: ExecFn;
  private readonly resolveAdb: (configured: string | null) => string | null;
  readonly port: number;

  constructor(opts: QuestControlOptions = {}) {
    this.configured = opts.adb ?? null;
    this.exec = opts.exec ?? execAdb;
    this.resolveAdb = opts.findAdb ?? ((configured) => findAdb({ configured }));
    this.port = opts.port ?? QUEST_DEFAULT_PORT;
  }

  /** `GET /quest`. Never throws: a broken adb is a hint, not a 500. */
  async status(port: number = this.port): Promise<QuestStatus> {
    const adb = this.resolveAdb(this.configured);
    if (!adb) return { adb: null, devices: [], reversed: [], hint: QUEST_HINTS.noAdb };
    const list = await this.exec(adb, ['devices', '-l'], ADB_TIMEOUT_MS);
    const devices = list.code === 0 ? parseDevices(list.stdout) : [];
    const chosen = pickDevice(devices);
    let reversed: QuestReverse[] = [];
    if (chosen) {
      const rev = await this.exec(adb, ['-s', chosen.serial, 'reverse', '--list'], ADB_TIMEOUT_MS);
      reversed = rev.code === 0 ? parseReverse(rev.stdout) : [];
    }
    const hint = list.code === 0 ? hintFor(adb, devices, reversed, port) : `adb devices failed: ${(list.stderr || list.stdout).trim().slice(0, 160)}`;
    return { adb, devices, reversed, hint };
  }

  /** `POST /quest/connect {port?}` → `adb -s <serial> reverse tcp:<port> tcp:<port>`. */
  async connect(rawPort: unknown): Promise<QuestActionResult> {
    const port = validPort(rawPort);
    return this.onDevice(port, (serial) => ['-s', serial, 'reverse', `tcp:${port}`, `tcp:${port}`], 'reverse_failed');
  }

  /** `POST /quest/open {path, port?}` → `am start … -d http://localhost:<port><path> com.oculus.browser`. */
  async open(rawPath: unknown, rawPort: unknown): Promise<QuestActionResult> {
    const path = validOpenPath(rawPath);
    const port = validPort(rawPort);
    const url = `http://localhost:${port}${path}`;
    return this.onDevice(
      port,
      (serial) => ['-s', serial, 'shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d', url, QUEST_BROWSER],
      'open_failed',
    );
  }

  private async onDevice(port: number, args: (serial: string) => string[], failCode: string): Promise<QuestActionResult> {
    const before = await this.status(port);
    const device = pickDevice(before.devices);
    if (!before.adb || !device) {
      return {
        ok: false,
        status: 409,
        code: before.adb ? 'no_device' : 'no_adb',
        error: before.hint ?? QUEST_HINTS.none,
        serial: null,
        quest: before,
      };
    }
    const r = await this.exec(before.adb, args(device.serial), ADB_TIMEOUT_MS);
    // `am start` exits 0 even when it prints "Error:"; treat that as a failure too.
    const failed = r.code !== 0 || /^Error/m.test(r.stdout) || /^Error/m.test(r.stderr);
    const after = await this.status(port);
    if (failed) {
      return {
        ok: false,
        status: 502,
        code: failCode,
        error: (r.stderr || r.stdout).trim().slice(0, 300) || `adb exited ${r.code}`,
        serial: device.serial,
        quest: after,
      };
    }
    return { ok: true, status: 200, code: null, error: null, serial: device.serial, quest: after };
  }
}
