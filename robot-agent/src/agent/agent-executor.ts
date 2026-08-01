/**
 * @file agent-executor.ts
 * @description A2A AgentExecutor implementation for processing natural language commands
 * @status live
 */

import { v4 as uuidv4 } from 'uuid';
import type { MessageData } from 'genkit';
import type { Task, TaskStatusUpdateEvent, TextPart, Message, TaskState } from '@a2a-js/sdk';
import type { AgentExecutor, RequestContext, ExecutionEventBus } from '@a2a-js/sdk/server';
import { ai, configuredModel } from './genkit.js';
import { RateLimiter } from './rate-limiter.js';
import { config, getActiveModelName } from '../config/config.js';
import { moveToLocation, stopMovement, goToCharge, returnHome } from '../tools/navigation.js';
import { pickupObject, dropObject } from '../tools/manipulation.js';
import { getRobotStatus, emergencyStop } from '../tools/status.js';
import type { RobotStateManager } from '../robot/state.js';
import { complianceLogClient } from '../compliance/ComplianceLogClient.js';
import { agentModeController } from '../agent-mode/agent-mode-controller.js';
import {
  awaitPlannedBlocks,
  describeCommandReplyAloud,
  describePlanAloud,
  narratePlanOutcome,
} from '../agent-mode/voice-narrator.js';
import {
  SpokenLanguages,
  type AgentBlock,
  type AgentModeEvent,
  type AgentPlan,
  type SpokenLanguage,
} from '../agent-mode/types.js';

// Load the Genkit prompt
const robotAgentPrompt = ai.prompt('robot_agent');

// LRU Cache with TTL for conversation contexts
const CONTEXT_MAX_ENTRIES = 100;
const CONTEXT_TTL_MS = 3600000; // 1 hour

interface ContextEntry {
  messages: Message[];
  timestamp: number;
}

class ContextCache {
  private cache = new Map<string, ContextEntry>();
  private readonly maxEntries: number;
  private readonly ttlMs: number;

  constructor(maxEntries: number = CONTEXT_MAX_ENTRIES, ttlMs: number = CONTEXT_TTL_MS) {
    this.maxEntries = maxEntries;
    this.ttlMs = ttlMs;
  }

  get(contextId: string): Message[] | undefined {
    const entry = this.cache.get(contextId);
    if (!entry) return undefined;

    // Check if expired
    if (Date.now() - entry.timestamp > this.ttlMs) {
      this.cache.delete(contextId);
      return undefined;
    }

    // Move to end for LRU (delete and re-add)
    this.cache.delete(contextId);
    this.cache.set(contextId, { ...entry, timestamp: Date.now() });
    return entry.messages;
  }

  set(contextId: string, messages: Message[]): void {
    // Delete first if exists (to maintain LRU order)
    this.cache.delete(contextId);

    // Evict oldest entries if at capacity
    while (this.cache.size >= this.maxEntries) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey) {
        this.cache.delete(oldestKey);
      }
    }

    this.cache.set(contextId, { messages, timestamp: Date.now() });
  }

  // Cleanup expired entries periodically
  cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache) {
      if (now - entry.timestamp > this.ttlMs) {
        this.cache.delete(key);
      }
    }
  }
}

// Store contexts for multi-turn conversations with LRU eviction and TTL
const contexts = new ContextCache();

/**
 * Compress an LLM/tool error into a clean one-line message suitable as an A2A
 * task result. Provider errors (e.g. a GoogleGenerativeAI 400 for an invalid
 * API key) carry multi-line, escaped JSON bodies — those must never surface
 * verbatim as a task result. The full error still goes to the console log.
 */
export function toCleanErrorMessage(error: unknown): string {
  let msg = (error instanceof Error ? error.message : String(error)).replace(/\s+/g, ' ').trim();
  const brace = msg.indexOf('{');
  if (brace === 0) {
    // The whole message is a JSON body — pull out its human-readable message.
    try {
      const parsed = JSON.parse(msg) as { error?: { message?: string }; message?: string };
      msg = (parsed.error?.message ?? parsed.message ?? '').replace(/\s+/g, ' ').trim();
    } catch {
      msg = '';
    }
  } else if (brace > 0) {
    // Message text followed by an embedded JSON payload — drop the payload.
    msg = msg.slice(0, brace).replace(/[\s:,-]+$/, '').trim();
  }
  if (msg.length > 200) msg = `${msg.slice(0, 197)}...`;
  return msg || 'LLM request failed';
}

/**
 * Metadata key a SPEECH client puts on its A2A message. The voice service sets
 * it; every other caller (the UI chat, tests, another agent) leaves it off and
 * gets exactly the behaviour it had before.
 */
export const VOICE_METADATA_KEY = 'neodem/voice';

export interface VoiceHint {
  /** The caller will SPEAK the reply, so it must be short and answer now. */
  speech: true;
  /** Language the operator was heard in, when the client could tell. */
  language?: SpokenLanguage;
}

/**
 * Read the speech hint off an inbound message. Anything malformed reads as
 * "not speech": a hint is an optimisation, and a garbled one must never make a
 * normal command fail.
 */
export function readVoiceHint(message: Message): VoiceHint | null {
  const raw = (message.metadata as Record<string, unknown> | undefined)?.[VOICE_METADATA_KEY];
  if (!raw || typeof raw !== 'object') return null;
  const hint = raw as { speech?: unknown; language?: unknown };
  if (hint.speech !== true) return null;
  const language = SpokenLanguages.find((l) => l === hint.language);
  return language ? { speech: true, language } : { speech: true };
}

export class RobotAgentExecutor implements AgentExecutor {
  private cancelledTasks = new Set<string>();
  private activeTasks = new Set<string>();
  private robotStateManager: RobotStateManager;
  private rateLimiter: RateLimiter | null;

  constructor(robotStateManager: RobotStateManager) {
    this.robotStateManager = robotStateManager;
    // Only enable rate limiting for free-tier providers
    this.rateLimiter = config.llmProvider === 'openrouter'
      ? new RateLimiter()
      : null;
  }

  public async cancelTask(taskId: string, eventBus: ExecutionEventBus): Promise<void> {
    this.cancelledTasks.add(taskId);
    // Also stop any ongoing robot movement
    await this.robotStateManager.stop();
  }

  async execute(requestContext: RequestContext, eventBus: ExecutionEventBus): Promise<void> {
    const userMessage = requestContext.userMessage;
    const existingTask = requestContext.task;

    // Determine IDs for the task and context
    const taskId = existingTask?.id || uuidv4();
    const contextId = userMessage.contextId || existingTask?.contextId || uuidv4();

    // Guard against re-entrant execution for the same task
    if (this.activeTasks.has(taskId)) {
      console.warn(`[RobotAgentExecutor] Rejecting duplicate execution for active task ${taskId}`);
      return;
    }
    this.activeTasks.add(taskId);

    // An A2A message reaching the executor is live server traffic — feed the
    // SafetyMonitor's liveness so a phantom communication-timeout stop cannot
    // persist while commands demonstrably arrive.
    this.robotStateManager.updateServerHeartbeat();

    try {
    console.log(
      `[RobotAgentExecutor] Processing message ${userMessage.messageId} for task ${taskId} (context: ${contextId})`
    );

    // 1. Publish initial Task event if it's a new task
    if (!existingTask) {
      const initialTask: Task = {
        kind: 'task',
        id: taskId,
        contextId: contextId,
        status: {
          state: 'submitted',
          timestamp: new Date().toISOString(),
        },
        history: [userMessage],
        metadata: userMessage.metadata,
      };
      eventBus.publish(initialTask);
    }

    // 1b. TASK-194 — Agent Mode. When the mode is ON the inbound message goes
    // to the block planner instead of the tool-calling prompt, and block
    // progress is streamed as non-final status updates. When it is OFF this
    // branch is not taken and everything below is unchanged.
    if (agentModeController.isEnabled()) {
      await this.executeAgentMode(taskId, contextId, userMessage, eventBus);
      return;
    }

    // 2. Publish "working" status update
    const workingStatusUpdate: TaskStatusUpdateEvent = {
      kind: 'status-update',
      taskId: taskId,
      contextId: contextId,
      status: {
        state: 'working',
        message: {
          kind: 'message',
          role: 'agent',
          messageId: uuidv4(),
          parts: [{ kind: 'text', text: 'Processing your command...' }],
          taskId: taskId,
          contextId: contextId,
        },
        timestamp: new Date().toISOString(),
      },
      final: false,
    };
    eventBus.publish(workingStatusUpdate);

    // 3. Prepare messages for Genkit prompt
    const historyForGenkit = contexts.get(contextId) || [];
    if (!historyForGenkit.find((m) => m.messageId === userMessage.messageId)) {
      historyForGenkit.push(userMessage);
    }
    contexts.set(contextId, historyForGenkit);

    const messages: MessageData[] = historyForGenkit
      .map((m) => ({
        role: (m.role === 'agent' ? 'model' : 'user') as 'user' | 'model',
        content: m.parts
          .filter((p): p is TextPart => p.kind === 'text' && !!(p as TextPart).text)
          .map((p) => ({
            text: (p as TextPart).text,
          })),
      }))
      .filter((m) => m.content.length > 0);

    if (messages.length === 0) {
      console.warn(`[RobotAgentExecutor] No valid text messages found for task ${taskId}.`);
      const failureUpdate: TaskStatusUpdateEvent = {
        kind: 'status-update',
        taskId: taskId,
        contextId: contextId,
        status: {
          state: 'failed',
          message: {
            kind: 'message',
            role: 'agent',
            messageId: uuidv4(),
            parts: [{ kind: 'text', text: 'No message found to process.' }],
            taskId: taskId,
            contextId: contextId,
          },
          timestamp: new Date().toISOString(),
        },
        final: true,
      };
      eventBus.publish(failureUpdate);
      return;
    }

    try {
      // 4. Get current robot state for context
      const robotState = this.robotStateManager.getState();

      // 5. Run the Genkit prompt with tools (rate-limited for free-tier providers)
      const callPrompt = () => robotAgentPrompt(
        {
          robotId: robotState.id,
          robotName: robotState.name,
          robotClass: robotState.robotClass,
          maxPayloadKg: robotState.maxPayloadKg,
          robotDescription: robotState.description,
          currentLocation: `(${robotState.location.x.toFixed(1)}, ${robotState.location.y.toFixed(1)}) in ${robotState.location.zone || 'Unknown Zone'}, Floor ${robotState.location.floor || '1'}`,
          batteryLevel: Math.round(robotState.batteryLevel),
          status: robotState.status,
          heldObject: robotState.heldObject || 'nothing',
          now: new Date().toISOString(),
        },
        {
          model: configuredModel,
          messages,
          tools: [
            moveToLocation,
            stopMovement,
            goToCharge,
            returnHome,
            pickupObject,
            dropObject,
            getRobotStatus,
            emergencyStop,
          ],
        }
      );

      const response = this.rateLimiter
        ? await this.rateLimiter.executeWithRetry(callPrompt)
        : await callPrompt();

      // Check if the request has been cancelled
      if (this.cancelledTasks.has(taskId)) {
        console.log(`[RobotAgentExecutor] Request cancelled for task: ${taskId}`);
        // Remove from set to prevent memory leak
        this.cancelledTasks.delete(taskId);
        const cancelledUpdate: TaskStatusUpdateEvent = {
          kind: 'status-update',
          taskId: taskId,
          contextId: contextId,
          status: {
            state: 'canceled',
            timestamp: new Date().toISOString(),
          },
          final: true,
        };
        eventBus.publish(cancelledUpdate);
        return;
      }

      // 6. Parse response and determine final state
      const responseText = response.text;
      console.info(`[RobotAgentExecutor] Prompt response: ${responseText}`);

      const lines = responseText.trim().split('\n');
      const finalStateLine = lines.at(-1)?.trim().toUpperCase();
      const agentReplyText = lines.slice(0, lines.length - 1).join('\n').trim();

      let finalA2AState: TaskState = 'unknown';

      // Validate response format - must end with a valid state marker
      if (!finalStateLine) {
        console.error('[RobotAgentExecutor] Empty response from AI');
        finalA2AState = 'failed';
      } else if (finalStateLine === 'COMPLETED') {
        finalA2AState = 'completed';
      } else if (finalStateLine === 'AWAITING_USER_INPUT') {
        finalA2AState = 'input-required';
      } else if (finalStateLine === 'FAILED') {
        finalA2AState = 'failed';
      } else {
        // Check if the state marker might be embedded in the response
        const lastLine = lines.at(-1)?.trim() || '';
        if (lastLine.includes('COMPLETED')) {
          console.warn('[RobotAgentExecutor] Found COMPLETED embedded in response, extracting...');
          finalA2AState = 'completed';
        } else if (lastLine.includes('AWAITING_USER_INPUT')) {
          console.warn('[RobotAgentExecutor] Found AWAITING_USER_INPUT embedded in response');
          finalA2AState = 'input-required';
        } else {
          console.error(
            `[RobotAgentExecutor] Invalid AI response format: expected COMPLETED, AWAITING_USER_INPUT, or FAILED. Got: "${finalStateLine}"`
          );
          // Mark as failed instead of silently completing - this is a bug that needs investigation
          finalA2AState = 'failed';
        }
      }

      // 7. Publish final task status update
      const agentMessage: Message = {
        kind: 'message',
        role: 'agent',
        messageId: uuidv4(),
        parts: [{ kind: 'text', text: agentReplyText || 'Command executed.' }],
        taskId: taskId,
        contextId: contextId,
      };
      historyForGenkit.push(agentMessage);
      contexts.set(contextId, historyForGenkit);

      const finalUpdate: TaskStatusUpdateEvent = {
        kind: 'status-update',
        taskId: taskId,
        contextId: contextId,
        status: {
          state: finalA2AState,
          message: agentMessage,
          timestamp: new Date().toISOString(),
        },
        final: true,
      };
      eventBus.publish(finalUpdate);

      console.log(`[RobotAgentExecutor] Task ${taskId} finished with state: ${finalA2AState}`);

      // Log AI decision to compliance system
      try {
        const userText = messages
          .filter((m) => m.role === 'user')
          .flatMap((m) => m.content.map((c) => c.text))
          .join(' ');

        await complianceLogClient.logAIDecision({
          payload: {
            description: `AI task execution: ${finalA2AState}`,
            inputText: userText,
            inputContext: {
              taskId,
              contextId,
              robotState: {
                location: robotState.location,
                batteryLevel: robotState.batteryLevel,
                status: robotState.status,
                heldObject: robotState.heldObject,
              },
            },
            outputText: agentReplyText,
            outputAction: finalA2AState,
            confidence: finalA2AState === 'completed' ? 0.9 : 0.5,
            reasoning: [
              `Processed user command: "${userText.substring(0, 100)}..."`,
              `Robot state: ${robotState.status} at (${robotState.location.x}, ${robotState.location.y})`,
              `Execution result: ${finalA2AState}`,
            ],
            safetyClassification: 'safe',
            metadata: { taskId, contextId },
          },
          modelVersion: getActiveModelName(),
          input: userText,
          output: agentReplyText,
          severity: finalA2AState === 'failed' ? 'warning' : 'info',
        });
      } catch (logError) {
        console.error('[RobotAgentExecutor] Failed to log AI decision:', logError);
      }
    } catch (error) {
      // LLM/tool failure → the task is FAILED, with a clean one-line reason.
      // Raw provider payloads (escaped JSON error bodies) go to the log only,
      // never into the task result.
      const errorMessage = toCleanErrorMessage(error);
      console.error(`[RobotAgentExecutor] Error processing task ${taskId}:`, error);
      const errorUpdate: TaskStatusUpdateEvent = {
        kind: 'status-update',
        taskId: taskId,
        contextId: contextId,
        status: {
          state: 'failed',
          message: {
            kind: 'message',
            role: 'agent',
            messageId: uuidv4(),
            parts: [{ kind: 'text', text: `Task failed: ${errorMessage}` }],
            taskId: taskId,
            contextId: contextId,
          },
          timestamp: new Date().toISOString(),
        },
        final: true,
      };
      eventBus.publish(errorUpdate);
    }
    } finally {
      this.activeTasks.delete(taskId);
    }
  }

  // ==========================================================================
  // TASK-194 — Agent Mode branch
  // ==========================================================================

  /**
   * Hand the message to the Agent Mode controller, acknowledge immediately,
   * then stream one non-final A2A status-update per block transition and close
   * with a single final update.
   *
   * SPEECH CLIENTS TAKE A DIFFERENT EXIT (see {@link readVoiceHint}). A voice
   * client is half-duplex: it holds the microphone shut from the end of the
   * utterance until it has spoken the reply. Keeping the A2A response open
   * until the plan finished therefore did three bad things at once — the
   * operator could not say "stop" while the robot was walking, a plan longer
   * than the client's timeout was announced as a failure while the robot
   * happily carried on executing it, and the streamed `▶ walk`/`✓ goto` lines
   * are written for a screen, not an ear. So a speech client is answered as
   * soon as the plan is UNDERSTOOD, and the outcome is spoken later through
   * the voice service's own `/say`.
   */
  private async executeAgentMode(
    taskId: string,
    contextId: string,
    userMessage: Message,
    eventBus: ExecutionEventBus
  ): Promise<void> {
    const text = userMessage.parts
      .filter((p): p is TextPart => p.kind === 'text' && !!(p as TextPart).text)
      .map((p) => p.text)
      .join(' ')
      .trim();

    const publish = (state: TaskState, message: string, final: boolean): void => {
      const update: TaskStatusUpdateEvent = {
        kind: 'status-update',
        taskId,
        contextId,
        status: {
          state,
          message: {
            kind: 'message',
            role: 'agent',
            messageId: uuidv4(),
            parts: [{ kind: 'text', text: message }],
            taskId,
            contextId,
          },
          timestamp: new Date().toISOString(),
        },
        final,
      };
      eventBus.publish(update);
    };

    const voice = readVoiceHint(userMessage);

    if (!text) {
      publish('failed', 'No message found to process.', true);
      return;
    }

    // Immediate acknowledgement — planning runs on a local LLM and must not
    // hold the A2A response open.
    publish('working', 'Agent Mode: understanding the command…', false);

    const result = await agentModeController.submitCommand({
      text,
      contextId,
      ...(voice?.language ? { language: voice.language } : {}),
    });

    // A spoken client gets the same fact in the language it was spoken to in;
    // `message` is English prose for the timeline and would be read out by a
    // German TTS voice as-is. Null = no spoken form, so fall back to the prose.
    const spokenReply = voice
      ? describeCommandReplyAloud(result, voice.language ?? 'en')
      : null;

    if (!result.accepted) {
      publish('failed', spokenReply ?? result.message, true);
      return;
    }

    if (!result.planId) {
      // Stop word / no plan produced — the controller already acted. For a
      // spoken "stop" this IS the answer, and it is the one reply that must
      // never wait on anything.
      publish('completed', spokenReply ?? result.message, true);
      return;
    }

    const planId = result.planId;

    if (voice) {
      if (result.outcome === 'folded') {
        // An interrupt carries the RUNNING plan's id. Describing that plan back
        // would promise steps the robot has already taken, so the reply is the
        // short "after the current step" line instead. The narrator is still
        // armed (idempotent) so a spoken interrupt on a plan that was started
        // by typing gets its outcome spoken too.
        narratePlanOutcome(planId, voice.language ?? 'en', {
          subscribe: (listener) => agentModeController.subscribe(listener),
        });
        publish('completed', spokenReply ?? result.message, true);
        return;
      }
      await this.acknowledgeSpokenPlan(planId, voice, publish);
      return;
    }
    const unsubscribe = agentModeController.subscribe((event) => {
      if (event.plan && event.plan.id !== planId) return;
      const line = formatAgentEvent(event.type, event.plan, event.block);
      if (line) publish('working', line, false);
    });

    try {
      await agentModeController.whenIdle();
    } finally {
      unsubscribe();
    }

    const state = agentModeController.getState();
    const plan = state.plan && state.plan.id === planId ? state.plan : null;
    const summary = summarizePlan(plan);

    if (!plan) {
      publish('completed', summary, true);
    } else if (plan.status === 'done') {
      publish('completed', summary, true);
    } else if (plan.status === 'aborted') {
      publish('canceled', summary, true);
    } else {
      publish('failed', summary, true);
    }
  }

  /**
   * Speech exit: answer with what the robot is ABOUT to do, and arrange for the
   * outcome to be spoken when it happens.
   *
   * Waiting here for the planner (a few seconds on the local model, capped by
   * `awaitPlannedBlocks`) buys a reply that names the actual steps — "Okay, I
   * will look around the room and walk to the door" — instead of a content-free
   * "working on it". That is worth the wait; waiting for the plan to RUN is
   * not, and is what this method exists to stop doing.
   */
  private async acknowledgeSpokenPlan(
    planId: string,
    voice: VoiceHint,
    publish: (state: TaskState, message: string, final: boolean) => void
  ): Promise<void> {
    const language: SpokenLanguage = voice.language ?? 'en';
    const subscribe = (listener: (event: AgentModeEvent) => void): (() => void) =>
      agentModeController.subscribe(listener);

    // Armed BEFORE the await: a one-block plan can finish while we are still
    // waiting for the planner, and the outcome listener must already be in
    // place or that plan would end in silence.
    narratePlanOutcome(planId, language, { subscribe });

    const plan = await awaitPlannedBlocks(planId, { subscribe });
    const spoken = plan ? describePlanAloud(plan, language) : null;

    // Fallbacks, in order of how much they can honestly claim: the planned
    // steps; a bare acknowledgement when the plan is only speech (the words
    // themselves are the answer, and the voice service speaks them from the
    // `speak` block); a "still thinking" when the planner has not answered yet.
    publish('completed', spoken ?? (plan ? ACK_NO_ACTION[language] : ACK_PLANNING[language]), true);
  }
}

/** Spoken when the plan turned out to be pure speech — the block says the rest. */
const ACK_NO_ACTION: Record<SpokenLanguage, string> = { de: 'Moment.', en: 'One moment.' };

/** Spoken when the planner has not produced blocks inside the ack window. */
const ACK_PLANNING: Record<SpokenLanguage, string> = {
  de: 'Ich denke noch darüber nach.',
  en: 'I am still working out how to do that.',
};

/** One short human line per streamed Agent Mode event; null = not worth a message. */
function formatAgentEvent(
  type: string,
  plan: AgentPlan | undefined,
  block: AgentBlock | undefined
): string | null {
  switch (type) {
    case 'agent:plan:updated':
      return plan ? `Plan: ${plan.blocks.map((b) => b.kind).join(' → ')}` : null;
    case 'agent:block:started':
      return block
        ? `▶ ${block.kind}${block.reasoning ? ` — ${block.reasoning}` : ''}`
        : null;
    case 'agent:block:finished':
      if (!block) return null;
      return block.status === 'done'
        ? `✓ ${block.kind}: ${block.result ?? 'done'}`
        : `✗ ${block.kind}: ${block.error ?? block.status}`;
    default:
      return null;
  }
}

/** Final message: what actually ran, honestly. */
function summarizePlan(plan: AgentPlan | null): string {
  if (!plan) return 'Agent Mode: nothing to report.';
  const done = plan.blocks.filter((b) => b.status === 'done').length;
  const failed = plan.blocks.filter((b) => b.status === 'failed');
  const skipped = plan.blocks.filter((b) => b.status === 'skipped' || b.status === 'aborted').length;
  const parts = [`${done}/${plan.blocks.length} blocks completed`];
  if (failed.length > 0) parts.push(`failed: ${failed.map((b) => `${b.kind} (${b.error ?? '?'})`).join('; ')}`);
  if (skipped > 0) parts.push(`${skipped} not executed`);
  return `Agent Mode plan ${plan.status} — ${parts.join(', ')}.`;
}
