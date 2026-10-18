/**
 * @file api.ts
 * @description The supervisor's HTTP API (JSON, loopback only). Every route but
 * GET /healthz needs `Authorization: Bearer <ROBOT_SUPERVISOR_TOKEN>`. POST /estop
 * is answered even while a start or stop is running: it is the last resort.
 *
 * The Meta Quest on this PC's USB (TASK-412): GET /quest, POST /quest/connect
 * {port?} and POST /quest/open {path, port?}. None of them touches the robot.
 * @feature supervisor
 */

import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { PROC_NAMES, STEP_IDS, SupervisorError } from './steps.js';
import type { StepId, Supervisor } from './steps.js';
import type { ProcName, SidecarMode } from './profile.js';
import { QuestControl, QuestError, validPort } from './quest.js';

const MAX_BODY = 64 * 1024;

function send(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(text);
}

function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolveBody, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new SupervisorError(413, 'too_large', 'request body too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8').trim();
      if (!raw) return resolveBody({});
      try {
        const v = JSON.parse(raw) as unknown;
        if (typeof v !== 'object' || v === null || Array.isArray(v)) {
          reject(new SupervisorError(400, 'bad_body', 'the body must be a JSON object'));
          return;
        }
        resolveBody(v as Record<string, unknown>);
      } catch {
        reject(new SupervisorError(400, 'bad_body', 'the body is not JSON'));
      }
    });
    req.on('error', reject);
  });
}

export function tokenMatches(header: string | undefined, token: string): boolean {
  if (!header || !header.startsWith('Bearer ')) return false;
  const given = Buffer.from(header.slice('Bearer '.length).trim());
  const want = Buffer.from(token);
  return given.length === want.length && timingSafeEqual(given, want);
}

export interface ApiOptions {
  token: string;
  /** The Quest on this PC's USB; default: adb from the profile's `quest.adb`, else searched. */
  quest?: QuestControl;
}

export function createApi(sup: Supervisor, opts: ApiOptions): Server {
  if (!opts.token || opts.token.length < 16) {
    throw new Error('ROBOT_SUPERVISOR_TOKEN must be set (at least 16 characters)');
  }
  const quest = opts.quest ?? new QuestControl({ adb: sup.profile.quest?.adb ?? null });
  return createServer((req, res) => {
    void handle(sup, { ...opts, quest }, req, res).catch((e: unknown) => {
      if (res.headersSent) {
        res.end();
        return;
      }
      if (e instanceof SupervisorError || e instanceof QuestError) {
        send(res, e.httpStatus, { ok: false, code: e.code, error: e.message });
      }
      else send(res, 500, { ok: false, code: 'internal', error: (e as Error).message });
    });
  });
}

async function handle(sup: Supervisor, opts: ApiOptions & { quest: QuestControl }, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const method = req.method ?? 'GET';

  if (method === 'GET' && path === '/healthz') {
    send(res, 200, { ok: true, robotId: sup.profile.robotId });
    return;
  }
  if (!tokenMatches(req.headers.authorization, opts.token)) {
    send(res, 401, { ok: false, code: 'unauthorized', error: 'missing or wrong bearer token' });
    return;
  }

  if (method === 'GET' && path === '/quest') {
    const port = url.searchParams.has('port') ? validPort(Number(url.searchParams.get('port'))) : undefined;
    send(res, 200, await opts.quest.status(port));
    return;
  }
  if (method === 'POST' && (path === '/quest/connect' || path === '/quest/open')) {
    const body = await readBody(req);
    const r = path === '/quest/connect' ? await opts.quest.connect(body.port) : await opts.quest.open(body.path, body.port);
    send(res, r.status, r);
    return;
  }
  if (method === 'GET' && path === '/status') {
    send(res, 200, sup.status());
    return;
  }
  if (method === 'POST' && path === '/start') {
    const body = await readBody(req);
    const mode = (body.mode ?? 'read_only') as SidecarMode;
    sup.start(mode);
    send(res, 202, sup.status());
    return;
  }
  if (method === 'POST' && path === '/stop') {
    sup.stop();
    send(res, 202, sup.status());
    return;
  }
  if (method === 'POST' && path === '/sidecar/mode') {
    const body = await readBody(req);
    await sup.switchSidecarMode(body.mode as SidecarMode, body.confirm === true);
    send(res, 202, sup.status());
    return;
  }
  const step = /^\/steps\/([a-z]+)\/(adopt|leave)$/.exec(path);
  if (method === 'POST' && step) {
    const id = step[1] as StepId;
    if (!STEP_IDS.includes(id)) throw new SupervisorError(404, 'no_step', `no step ${id}`);
    const result = step[2] === 'adopt' ? await sup.adopt(id) : sup.leave(id);
    send(res, 200, { ok: true, step: result, status: sup.status() });
    return;
  }
  if (method === 'POST' && path === '/lan/up') {
    const r = await sup.lanUp();
    send(res, r.ok ? 200 : 502, { ok: r.ok, code: r.code, output: (r.stdout + r.stderr).trim() });
    return;
  }
  if (method === 'POST' && path === '/estop') {
    const r = await sup.estop();
    send(res, r.status, r.body);
    return;
  }
  const logs = /^\/logs\/([a-z]+)(\/stream)?$/.exec(path);
  if (method === 'GET' && logs) {
    const proc = logs[1] as ProcName;
    if (!PROC_NAMES.includes(proc)) throw new SupervisorError(404, 'no_proc', `no process ${proc}`);
    if (logs[2]) {
      streamLogs(sup, proc, req, res);
      return;
    }
    const n = Math.min(2000, Math.max(1, Number(url.searchParams.get('tail') ?? 200) || 200));
    send(res, 200, { proc, lines: sup.logTail(proc, n) });
    return;
  }
  send(res, 404, { ok: false, code: 'not_found', error: `${method} ${path} is not a supervisor route` });
}

function streamLogs(sup: Supervisor, proc: ProcName, req: IncomingMessage, res: ServerResponse): void {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-store',
    Connection: 'keep-alive',
  });
  const write = (line: string) => res.write(`data: ${JSON.stringify(line)}\n\n`);
  for (const line of sup.logTail(proc, 50)) write(line);
  const unsubscribe = sup.subscribeLogs(proc, write);
  const keepAlive = setInterval(() => res.write(': keep-alive\n\n'), 15_000);
  keepAlive.unref();
  req.on('close', () => {
    clearInterval(keepAlive);
    unsubscribe();
  });
}
