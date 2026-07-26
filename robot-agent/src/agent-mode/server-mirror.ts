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
import type { AgentBlock, AgentModeEvent } from './types.js';

export interface ServerMirrorDeps {
  serverUrl?: string;
  robotId?: string;
  fetchImpl?: typeof fetch;
  /** Injected in tests; defaults to the compliance singleton. */
  logCommandExecution?: (typeof complianceLogClient)['logCommandExecution'];
}

const PUSH_TIMEOUT_MS = 3000;

export class ServerMirror {
  private readonly serverUrl: string;
  private readonly robotId: string;
  private readonly fetchImpl: typeof fetch;
  private readonly logCommandExecution: (typeof complianceLogClient)['logCommandExecution'];
  private lastFailureLoggedAt = 0;

  constructor(deps: ServerMirrorDeps = {}) {
    this.serverUrl = deps.serverUrl ?? config.serverUrl;
    this.robotId = deps.robotId ?? config.robotId;
    this.fetchImpl = deps.fetchImpl ?? ((...args) => fetch(...args));
    this.logCommandExecution =
      deps.logCommandExecution ?? complianceLogClient.logCommandExecution.bind(complianceLogClient);
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
   * One compliance record per finished block (EU AI Act Art. 12 record-keeping).
   * Best-effort — a compliance backend outage must not abort a plan.
   */
  async logBlock(command: string, block: AgentBlock): Promise<void> {
    const durationMs =
      block.startedAt && block.finishedAt
        ? Math.max(0, Date.parse(block.finishedAt) - Date.parse(block.startedAt))
        : undefined;

    const executionStatus =
      block.status === 'done' ? 'success' : block.status === 'failed' ? 'failure' : 'partial';

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
