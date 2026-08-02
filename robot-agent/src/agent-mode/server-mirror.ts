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
}

const PUSH_TIMEOUT_MS = 3000;

export class ServerMirror {
  private readonly serverUrl: string;
  private readonly robotId: string;
  private readonly fetchImpl: typeof fetch;
  private readonly logCommandExecution: (typeof complianceLogClient)['logCommandExecution'];
  private readonly journal: Journal | null;
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
