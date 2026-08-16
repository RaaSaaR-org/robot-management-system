/**
 * @file server-mirror.ts
 * @description Mirrors Agent Mode activity to the NeoDEM server: plan/block/
 *              scene/state events to `POST /api/robots/:id/agent-mode/events`
 *              (fire-and-forget, unauthenticated like the existing compliance
 *              and task-status pushes), and one compliance record per finished
 *              block.
 * @feature agentmode
 * @status live
 */

import { config } from '../config/config.js';
import { complianceLogClient } from '../compliance/ComplianceLogClient.js';
import { Journal, blockJournalRecord, getJournalBootId } from './journal.js';
import type { AgentBlock, AgentModeEvent } from './types.js';

/**
 * Where the robot was when a block finished. Supplied by the controller, which
 * is the only thing that knows both the plan and the place belief.
 */
export interface BlockJournalContext {
  planId?: string | null;
  /** Place id, or null for UNKNOWN — never the last known place. */
  place?: string | null;
  pose?: { x: number; y: number; yawDeg: number; source: string } | null;
}

export interface ServerMirrorDeps {
  serverUrl?: string;
  robotId?: string;
  fetchImpl?: typeof fetch;
  /** Injected in tests; defaults to the compliance singleton. */
  logCommandExecution?: (typeof complianceLogClient)['logCommandExecution'];
  /**
   * The local journal tee (TASK-197). Pass `null` to run without one — the
   * mirror then behaves exactly as it did before the journal existed.
   */
  journal?: Journal | null;
  /** Pause between photo-upload retries (tests set 0). */
  retryDelayMs?: number;
}

const PUSH_TIMEOUT_MS = 3000;
/** Photo uploads are bigger and rarer than events; 10 s, retried. */
export const PHOTO_UPLOAD_TIMEOUT_MS = 10_000;
export const PHOTO_UPLOAD_ATTEMPTS = 3;

/** One patrol photo bound for `PUT /api/robots/:id/patrol-runs/:runId/photos/:key` (TASK-212). */
export interface PatrolPhotoUpload {
  runId: string;
  /** `<checkpointId>.jpg` */
  key: string;
  jpeg: Buffer;
  kind: 'control' | 'baseline' | 'finding';
  checkpointId: string;
  routeId: string;
  capturedAt: string;
}

export class ServerMirror {
  private readonly serverUrl: string;
  private readonly robotId: string;
  private readonly fetchImpl: typeof fetch;
  private readonly logCommandExecution: (typeof complianceLogClient)['logCommandExecution'];
  private readonly journal: Journal | null;
  private readonly retryDelayMs: number;
  private lastFailureLoggedAt = 0;

  constructor(deps: ServerMirrorDeps = {}) {
    this.serverUrl = deps.serverUrl ?? config.serverUrl;
    this.robotId = deps.robotId ?? config.robotId;
    this.fetchImpl = deps.fetchImpl ?? ((...args) => fetch(...args));
    this.logCommandExecution =
      deps.logCommandExecution ?? complianceLogClient.logCommandExecution.bind(complianceLogClient);
    // `undefined` means "default to a real journal"; an explicit `null` means
    // "no journal", which is not the same thing and must stay expressible.
    this.journal = deps.journal === undefined ? new Journal() : deps.journal;
    this.retryDelayMs = deps.retryDelayMs ?? 2000;
  }

  /**
   * Upload one patrol photo (TASK-212) — JSON body with the JPEG base64, so it
   * rides the same unauthenticated robot→server path as the events. Fire-and-
   * forget for the caller; inside, three attempts with a pause between them.
   * The photo stays on the robot's disk either way, so a server that is down
   * costs the operator a picture in the UI, never the record.
   */
  uploadPatrolPhoto(input: PatrolPhotoUpload): void {
    void this.pushPatrolPhoto(input);
  }

  /** Awaitable variant — resolves true when one attempt was accepted. */
  async pushPatrolPhoto(input: PatrolPhotoUpload, attempts: number = PHOTO_UPLOAD_ATTEMPTS): Promise<boolean> {
    const url =
      `${this.serverUrl}/api/robots/${encodeURIComponent(this.robotId)}/patrol-runs/` +
      `${encodeURIComponent(input.runId)}/photos/${encodeURIComponent(input.key)}`;
    const body = JSON.stringify({
      imageB64: input.jpeg.toString('base64'),
      contentType: 'image/jpeg',
      kind: input.kind,
      checkpointId: input.checkpointId,
      routeId: input.routeId,
      capturedAt: input.capturedAt,
    });
    let lastError = '';
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        const res = await this.fetchImpl(url, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body,
          signal: AbortSignal.timeout(PHOTO_UPLOAD_TIMEOUT_MS),
        });
        if (res.ok) return true;
        lastError = `HTTP ${res.status}`;
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
      }
      if (attempt < attempts && this.retryDelayMs > 0) {
        await new Promise((r) => setTimeout(r, this.retryDelayMs));
      }
    }
    console.warn(`[AgentMode/ServerMirror] patrol photo upload failed (${input.runId}/${input.key}): ${lastError}`);
    return false;
  }

  /**
   * Push one event. Fire-and-forget by construction: it returns void and
   * swallows every transport error, because a server that is down must never
   * stall or fail a block.
   */
  emit(event: AgentModeEvent): void {
    void this.push(event);
  }

  /** Awaitable variant — used by the tests and by `emit` internally. */
  async push(event: AgentModeEvent): Promise<void> {
    try {
      await this.fetchImpl(
        `${this.serverUrl}/api/robots/${encodeURIComponent(this.robotId)}/agent-mode/events`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(event),
          signal: AbortSignal.timeout(PUSH_TIMEOUT_MS),
        }
      );
    } catch (err) {
      // Throttled: a disconnected server would otherwise log per block.
      const now = Date.now();
      if (now - this.lastFailureLoggedAt > 30_000) {
        this.lastFailureLoggedAt = now;
        console.warn(
          `[AgentMode/ServerMirror] event push failed (${event.type}): ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }
  }

  /**
   * One compliance record per finished block (EU AI Act Art. 12 record-keeping),
   * and — since TASK-197 — one local journal line first.
   *
   * The journal write happens BEFORE the network call and is synchronous: it is
   * the copy that has to survive the process dying, and the network call is
   * fire-and-forget by contract. Best-effort in both directions — a compliance
   * backend outage and an unwritable disk must both leave the plan running.
   */
  async logBlock(command: string, block: AgentBlock, context: BlockJournalContext = {}): Promise<void> {
    const durationMs =
      block.startedAt && block.finishedAt
        ? Math.max(0, Date.parse(block.finishedAt) - Date.parse(block.startedAt))
        : undefined;

    const executionStatus =
      block.status === 'done' ? 'success' : block.status === 'failed' ? 'failure' : 'partial';

    // A tee of the record below, not a second instrumentation pass. `trust` is
    // `self`: this is the robot's own measured experience. The OPERATOR's words
    // ride along as `command` context and are never promoted from here.
    this.journal?.append(
      blockJournalRecord({
        at: block.finishedAt ?? new Date().toISOString(),
        bootId: getJournalBootId(),
        planId: context.planId ?? null,
        blockKind: block.kind,
        ok: executionStatus === 'success',
        message: block.result ?? block.error ?? `${block.kind} ${block.status}`,
        ...(block.measured ? { measured: block.measured } : {}),
        place: context.place ?? null,
        ...(context.pose ? { pose: context.pose } : {}),
      }),
    );

    try {
      await this.logCommandExecution({
        payload: {
          description: `Agent Mode block "${block.kind}" ${block.status}`,
          commandType: `agent_mode.${block.kind}`,
          parameters: { command, ...block.params },
          executionStatus,
          ...(block.error ? { errorMessage: block.error } : {}),
          ...(durationMs === undefined ? {} : { durationMs }),
          metadata: {
            blockId: block.id,
            status: block.status,
            result: block.result,
            reasoning: block.reasoning,
          },
        },
      });
    } catch (err) {
      console.warn(
        `[AgentMode/ServerMirror] compliance log failed for block ${block.id}: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }
}
