/**
 * @file agentmodeStore.ts
 * @description Zustand store for Agent Mode — plan, blocks, scene memory, E-Stop
 * @feature agentmode
 * @dependencies @/store, @/features/agentmode/api, @/features/agentmode/types
 * @stateAccess Creates: useAgentModeStore
 */

import { createStore } from '@/store';
import { getErrorMessage, isNotFoundError } from '@/shared/utils';
import { agentmodeApi } from '../api/agentmodeApi';
import { currentBlockOfPlan, upcomingBlocksOfPlan } from '../utils/planQuery';
import type {
  AgentBlock,
  AgentChatMessage,
  AgentEstopStatus,
  AgentModeEvent,
  AgentModeStore,
  AgentPendingCommand,
  AgentPlan,
  ControlOwner,
  SceneEntity,
  SceneMemory,
} from '../types/agentmode.types';
import type { WebSocketStatus } from '@/shared/types';

// ============================================================================
// INITIAL STATE
// ============================================================================

const initialState = {
  robotId: null as string | null,
  enabled: false,
  controlOwner: 'idle' as ControlOwner,
  estopActive: false,
  estopStatus: 'idle' as AgentEstopStatus,
  estopError: null as string | null,
  damped: false,
  fsmId: null as number | null,
  plan: null as AgentPlan | null,
  planHistory: [] as AgentPlan[],
  scene: null as SceneMemory | null,
  messages: [] as AgentChatMessage[],
  pendingCommand: null as AgentPendingCommand | null,
  connectionStatus: 'disconnected' as WebSocketStatus,
  isLoading: false,
  isSending: false,
  error: null as string | null,
};

/** Plans kept in `planHistory` so an old conversation still renders its blocks. */
const MAX_PLAN_HISTORY = 10;

/** Shared empty entity list so the selector never hands back a fresh array. */
const NO_ENTITIES: readonly SceneEntity[] = Object.freeze([]);

/** Monotonic id source for locally created chat messages. */
let messageSeq = 0;

function makeMessage(
  role: AgentChatMessage['role'],
  text: string,
  extra: Partial<AgentChatMessage> = {}
): AgentChatMessage {
  messageSeq += 1;
  return {
    id: `agent-msg-${messageSeq}`,
    role,
    text,
    timestamp: new Date().toISOString(),
    ...extra,
  };
}

/** Human summary appended when a plan reaches a terminal state. */
function planSummary(plan: AgentPlan): string {
  const done = plan.blocks.filter((b) => b.status === 'done').length;
  const total = plan.blocks.length;
  if (plan.status === 'aborted') {
    return `Plan aborted after ${done} of ${total} blocks.`;
  }
  if (plan.status === 'failed') {
    const failed = plan.blocks.find((b) => b.status === 'failed');
    return failed?.error
      ? `Plan failed on "${failed.kind}": ${failed.error}`
      : `Plan failed after ${done} of ${total} blocks.`;
  }
  const spoken = [...plan.blocks]
    .reverse()
    .find((b) => b.status === 'done' && b.result)?.result;
  return spoken
    ? `${spoken} (${done}/${total} blocks)`
    : `Plan completed — ${done}/${total} blocks.`;
}

/** Chat line for a stop the agent latched but the hardware did not confirm. */
function unconfirmedStopMessage(deliveryError?: string): string {
  return (
    `E-Stop NOT CONFIRMED by the robot${deliveryError ? `: ${deliveryError}` : ''}. ` +
    'The latch is set, but StopMove/Damp were not acknowledged — the robot may ' +
    'still be moving. Use the hardware E-Stop.'
  );
}

// ============================================================================
// STORE
// ============================================================================

export const useAgentModeStore = createStore<AgentModeStore>(
  (set, get) => ({
    ...initialState,

    // --------------------------------------------------------------------------
    // Select Robot
    // --------------------------------------------------------------------------
    selectRobot: (robotId: string | null) => {
      if (get().robotId === robotId) return;
      set((state) => {
        // Transport state belongs to the socket, not the robot — a rebind
        // must not make a live connection report itself as offline.
        const connectionStatus = state.connectionStatus;
        Object.assign(state, initialState);
        state.connectionStatus = connectionStatus;
        state.robotId = robotId;
      });
    },

    // --------------------------------------------------------------------------
    // Fetch State (+ scene memory)
    // --------------------------------------------------------------------------
    fetchState: async (robotId: string) => {
      set((state) => {
        state.isLoading = true;
        state.error = null;
      });

      try {
        const [agentState, scene] = await Promise.all([
          // 404 is the documented empty case: the server has never seen an
          // `agent:state:changed` for this robot (fresh process, Agent Mode
          // never enabled). That is a normal cold start, not a failure — the
          // page must render its empty state, not an error banner.
          agentmodeApi.getState(robotId).catch((error: unknown) => {
            if (isNotFoundError(error)) return null;
            throw error;
          }),
          agentmodeApi.getScene(robotId).catch(() => null),
        ]);

        set((state) => {
          if (staleResponse(state, robotId)) return;
          state.enabled = agentState?.enabled ?? false;
          state.controlOwner = agentState?.controlOwner ?? 'idle';
          state.estopActive = agentState?.estopActive ?? false;
          // A latch the agent itself reports is already acknowledged by it.
          state.estopStatus = agentState?.estopActive ? 'acknowledged' : 'idle';
          state.estopError = null;
          applyBaseArming(state, agentState);
          state.plan = agentState?.plan ?? null;
          state.scene = scene ?? agentState?.scene ?? null;
          state.isLoading = false;
        });
      } catch (error) {
        const message = getErrorMessage(error);
        set((state) => {
          if (staleResponse(state, robotId)) return;
          state.isLoading = false;
          state.error = message;
        });
      }
    },

    // --------------------------------------------------------------------------
    // Send Command
    // --------------------------------------------------------------------------
    sendCommand: async (robotId: string, text: string) => {
      const command = text.trim();
      if (!command) return;

      if (get().estopActive) {
        set((state) => {
          state.error = 'E-Stop is latched — reset it before sending commands.';
        });
        return;
      }

      const userMessage = makeMessage('user', command);
      set((state) => {
        state.isSending = true;
        state.error = null;
        state.messages.push(userMessage);
      });

      try {
        const response = await agentmodeApi.sendCommand(robotId, command);

        set((state) => {
          if (staleResponse(state, robotId)) return;
          state.isSending = false;
          const mine = state.messages.find((m) => m.id === userMessage.id);
          if (mine && response.planId) {
            mine.planId = response.planId;
          }
          state.messages.push(
            makeMessage('agent', response.message, {
              planId: response.planId,
              showsPlan: response.accepted && Boolean(response.planId),
              isError: !response.accepted,
            })
          );
          state.pendingCommand =
            response.accepted && response.planId
              ? { planId: response.planId, text: command, robotId }
              : null;
        });
      } catch (error) {
        const message = getErrorMessage(error);
        set((state) => {
          if (staleResponse(state, robotId)) return;
          state.isSending = false;
          state.error = message;
          state.messages.push(makeMessage('agent', message, { isError: true }));
        });
      }
    },

    // --------------------------------------------------------------------------
    // Toggle Agent Mode
    // --------------------------------------------------------------------------
    toggle: async (robotId: string, enabled: boolean) => {
      // Optimistic — the switch must not lag behind the click.
      set((state) => {
        state.enabled = enabled;
        state.error = null;
      });

      try {
        const agentState = await agentmodeApi.toggle(robotId, enabled);
        set((state) => {
          // A stale confirmation would import this robot's latch into the
          // newly selected robot's view via `applyReportedLatch`.
          if (staleResponse(state, robotId)) return;
          state.enabled = agentState.enabled;
          state.controlOwner = agentState.controlOwner;
          applyReportedLatch(state, agentState.estopActive);
          applyBaseArming(state, agentState);
        });
      } catch (error) {
        const message = getErrorMessage(error);
        set((state) => {
          if (staleResponse(state, robotId)) return;
          state.enabled = !enabled;
          state.error = message;
        });
      }
    },

    // --------------------------------------------------------------------------
    // E-Stop — latch this console immediately, but only report what is known
    // --------------------------------------------------------------------------
    estop: async (robotId: string, reason?: string) => {
      set((state) => {
        // The latch is local and unconditional: from here this console refuses
        // to send commands. What it must NOT do is claim anything about the
        // robot — the request has not even left the browser yet. Rewriting the
        // plan to "aborted" here would present an unverified stop as a
        // completed one, which is exactly what the operator must not believe.
        state.estopActive = true;
        state.estopStatus = 'requesting';
        state.estopError = null;
        state.controlOwner = 'idle';
        state.pendingCommand = null;
        state.isSending = false;
        state.messages.push(
          makeMessage('agent', 'E-Stop requested — waiting for the robot to confirm.', {
            isError: true,
          })
        );
      });

      try {
        const response = await agentmodeApi.estop(robotId, reason);

        set((state) => {
          // A confirmation that raced a robot switch would latch the NEW
          // robot's console, rewrite its live plan to "aborted" and suppress
          // its progress events — a stop claim about a robot never asked to
          // stop. `selectRobot` already dropped this robot's view; switching
          // back re-fetches the agent's truth.
          if (staleResponse(state, robotId)) return;
          // The response arriving at all is the agent's acknowledgement that
          // it latched in software and discarded the plan. `delivered` is the
          // separate hardware claim: StopMove/Damp acked by the sidecar.
          // Without it "stopped and damped" would be a lie — the base may
          // physically still be moving. `stopped` is the narrower claim: a
          // live plan was aborted. Only that permits rewriting the plan.
          const delivered = response.delivered !== false;
          state.estopActive = true;
          state.estopStatus = delivered ? 'acknowledged' : 'unconfirmed';
          state.estopError = delivered ? null : response.deliveryError ?? null;

          const plan = state.plan;
          const planWasLive =
            plan !== null && (plan.status === 'planning' || plan.status === 'running');

          if (response.stopped && plan && planWasLive) {
            for (const block of plan.blocks) {
              if (block.status === 'running') {
                block.status = 'aborted';
                block.finishedAt = new Date().toISOString();
                block.error = reason ?? 'E-Stop';
              } else if (block.status === 'pending') {
                block.status = 'skipped';
              }
            }
            plan.status = 'aborted';
            plan.cursor = -1;
            plan.updatedAt = new Date().toISOString();
            state.messages.push(
              makeMessage(
                'agent',
                delivered
                  ? `E-Stop confirmed — ${planSummary(plan)}`
                  : unconfirmedStopMessage(response.deliveryError),
                { planId: plan.id, isError: true }
              )
            );
          } else {
            // Either nothing was running or the agent says it aborted nothing.
            // The plan is left exactly as it is; the agent's own events are
            // what correct a stale view, not a guess made here.
            state.messages.push(
              makeMessage(
                'agent',
                !delivered
                  ? unconfirmedStopMessage(response.deliveryError)
                  : response.stopped
                    ? 'E-Stop confirmed. The robot is stopped and damped.'
                    : 'E-Stop confirmed. The robot is stopped and damped — no plan was running.',
                { isError: true }
              )
            );
          }
        });
      } catch (error) {
        const message = getErrorMessage(error);
        set((state) => {
          // After a robot switch the failure would render as an alarm about
          // the wrong robot — the switch already wiped this robot's latch.
          if (staleResponse(state, robotId)) return;
          // The stop never reached the robot. Say so loudly and leave the plan
          // untouched: if the agent keeps reporting blocks, the operator has to
          // see them — that is the evidence the robot is still moving.
          state.estopStatus = 'failed';
          state.estopError = message;
          state.messages.push(
            makeMessage(
              'agent',
              `E-Stop request FAILED: ${message}. The robot is NOT confirmed stopped — ` +
                'use the hardware E-Stop.',
              { isError: true }
            )
          );
        });
      }
    },

    // --------------------------------------------------------------------------
    // Reset E-Stop
    // --------------------------------------------------------------------------
    resetEstop: async (robotId: string) => {
      try {
        const agentState = await agentmodeApi.resetEstop(robotId);
        set((state) => {
          // A stale reset confirmation must never clear a latch the newly
          // selected robot's console holds.
          if (staleResponse(state, robotId)) return;
          state.enabled = agentState.enabled;
          state.controlOwner = agentState.controlOwner;
          state.error = null;
          // Clearing the latch does NOT re-arm the base — the robot stays
          // damped until a `posture` stand. Keep that visible across the reset.
          applyBaseArming(state, agentState);
          if (agentState.estopActive) {
            // The agent still holds the latch — keep it and keep saying so.
            // A hardware-unconfirmed stop stays unconfirmed until it clears.
            state.estopActive = true;
            if (state.estopStatus !== 'unconfirmed') state.estopStatus = 'acknowledged';
          } else {
            state.estopActive = false;
            state.estopStatus = 'idle';
            state.estopError = null;
          }
        });
      } catch (error) {
        const message = getErrorMessage(error);
        set((state) => {
          if (staleResponse(state, robotId)) return;
          // The latch is a safety state — never clear it on a failed reset.
          state.error = message;
        });
      }
    },

    // --------------------------------------------------------------------------
    // Apply WebSocket Event
    // --------------------------------------------------------------------------
    applyEvent: (event: AgentModeEvent) => {
      set((state) => {
        // Fleet-wide socket: ignore chatter about other robots.
        if (state.robotId && event.robotId && event.robotId !== state.robotId) {
          return;
        }

        switch (event.type) {
          case 'agent:plan:started': {
            if (!event.plan) break;
            // A stop the agent confirmed makes later progress events stale.
            // An unconfirmed one does not — see `progressSuppressed`.
            if (progressSuppressed(state)) break;
            // A plan this tab did not send still has an author — someone spoke
            // to the robot, or drove it from another client. Without this the
            // conversation shows an answer to a question that was never
            // written down, and the operator watching the screen cannot tell
            // what the robot was actually asked to do.
            if (!startedHere(state, event.plan)) {
              state.messages.push(
                makeMessage('user', event.plan.command, {
                  planId: event.plan.id,
                  ...(event.plan.language ? { spokenLanguage: event.plan.language } : {}),
                })
              );
            }
            if (state.plan && state.plan.id !== event.plan.id) {
              state.planHistory.push(state.plan);
              if (state.planHistory.length > MAX_PLAN_HISTORY) {
                state.planHistory.shift();
              }
            }
            state.plan = event.plan;
            state.controlOwner = 'agent';
            // `pendingCommand` stays set for the whole run — it is what the
            // demo driver keys its timers off, and what tells the UI a plan
            // is live. It is cleared when the plan reaches a terminal state.
            break;
          }

          case 'agent:plan:updated': {
            if (!event.plan || progressSuppressed(state)) break;
            if (!state.plan || state.plan.id === event.plan.id) {
              recordFoldedInterrupt(state, event.plan);
              state.plan = event.plan;
            }
            break;
          }

          case 'agent:plan:finished': {
            if (!event.plan || progressSuppressed(state)) break;
            if (state.plan && state.plan.id !== event.plan.id) break;
            state.plan = event.plan;
            state.controlOwner = 'idle';
            if (state.pendingCommand?.planId === event.plan.id) {
              state.pendingCommand = null;
            }
            state.messages.push(
              makeMessage('agent', planSummary(event.plan), {
                planId: event.plan.id,
                isError: event.plan.status === 'failed' || event.plan.status === 'aborted',
              })
            );
            break;
          }

          case 'agent:block:started': {
            if (progressSuppressed(state)) break;
            if (!adoptEventPlan(state, event)) break;
            const index = findBlockIndex(state.plan, event.block);
            if (index === -1 || !state.plan) break;
            const block = state.plan.blocks[index];
            block.status = event.block?.status ?? 'running';
            block.startedAt = event.block?.startedAt ?? event.timestamp;
            if (event.block?.reasoning) block.reasoning = event.block.reasoning;
            state.plan.cursor = index;
            state.plan.status = 'running';
            state.plan.updatedAt = event.timestamp;
            break;
          }

          case 'agent:block:finished': {
            if (progressSuppressed(state)) break;
            if (!adoptEventPlan(state, event)) break;
            const index = findBlockIndex(state.plan, event.block);
            if (index === -1 || !state.plan) break;
            const block = state.plan.blocks[index];
            block.status = event.block?.status ?? 'done';
            block.finishedAt = event.block?.finishedAt ?? event.timestamp;
            block.result = event.block?.result;
            block.error = event.block?.error;
            state.plan.cursor = -1;
            state.plan.updatedAt = event.timestamp;
            break;
          }

          case 'agent:scene:updated': {
            if (!event.scene) break;
            state.scene = event.scene;
            break;
          }

          case 'agent:state:changed': {
            if (!event.state) break;
            state.enabled = event.state.enabled;
            state.controlOwner = event.state.controlOwner;
            applyReportedLatch(state, event.state.estopActive);
            applyBaseArming(state, event.state);
            if (event.state.scene) state.scene = event.state.scene;
            if (event.state.plan) state.plan = event.state.plan;
            break;
          }
        }
      });
    },

    // --------------------------------------------------------------------------
    // Connection Status
    // --------------------------------------------------------------------------
    setConnectionStatus: (status: WebSocketStatus) => {
      set((state) => {
        state.connectionStatus = status;
      });
    },

    // --------------------------------------------------------------------------
    // Clear Error
    // --------------------------------------------------------------------------
    clearError: () => {
      set((state) => {
        state.error = null;
      });
    },

    // --------------------------------------------------------------------------
    // Reset Store
    // --------------------------------------------------------------------------
    reset: () => {
      set((state) => {
        Object.assign(state, initialState);
      });
    },
  }),
  {
    name: 'AgentModeStore',
    // Plans are ephemeral by contract — nothing here survives a reload.
    persist: false,
  }
);

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/** Locate an event's block inside the current plan by id; -1 when unknown. */
function findBlockIndex(plan: AgentPlan | null, block: AgentBlock | undefined): number {
  if (!plan || !block) return -1;
  return plan.blocks.findIndex((b) => b.id === block.id);
}

/** The mutable slice `applyEvent`/`estop` write through immer. */
type MutableState = AgentModeStore;

/**
 * Whether an awaited response belongs to a robot the store no longer shows.
 *
 * Every action is per-robot but the store is a singleton that `selectRobot`
 * wipes: a slow response for robot A landing after the user switched to robot
 * B would rewrite B's view with A's data — and B's own WebSocket events would
 * from then on be dropped by the `applyEvent` robot filter. Late responses are
 * discarded instead; switching back re-fetches the server's truth. Only the
 * synchronous pre-await writes of each action skip this check — they run in
 * the same tick as the user's act, while the robot is still bound.
 */
/**
 * Whether the plan now starting is the one THIS tab just asked for.
 *
 * `isSending` covers the race the `pendingCommand` check alone cannot: the
 * `agent:plan:started` event routinely overtakes the HTTP response that sets
 * `pendingCommand`, so a locally typed command would otherwise be echoed back
 * into the conversation a second time as if someone else had said it.
 */
function startedHere(state: MutableState, plan: AgentPlan): boolean {
  return (
    state.isSending ||
    state.pendingCommand?.planId === plan.id ||
    state.messages.some((m) => m.planId === plan.id)
  );
}

function staleResponse(state: MutableState, robotId: string): boolean {
  return state.robotId !== robotId;
}

/** How the agent records an interrupt folded into a running plan's command. */
const INTERRUPT_SEPARATOR = ' → ';

/**
 * Write a command that was folded into the RUNNING plan into the conversation.
 *
 * An interrupt never starts a plan of its own, so it emits no
 * `agent:plan:started` and the `plan:started` echo above never sees it. All that
 * arrives is an `agent:plan:updated` whose `command` has grown a
 * `" → dreh dich nach links"` tail and whose blocks have been rewritten. Without
 * this the operator watches the timeline change into something nobody in the
 * room appears to have asked for — which is precisely what happens when the
 * second command was SPOKEN and there is no typed record of it anywhere.
 */
function recordFoldedInterrupt(state: MutableState, incoming: AgentPlan): void {
  const previous = state.plan?.id === incoming.id ? state.plan.command : null;
  if (previous === null || previous === incoming.command) return;
  if (!incoming.command.startsWith(previous + INTERRUPT_SEPARATOR)) return;
  const folded = incoming.command.slice(previous.length + INTERRUPT_SEPARATOR.length);
  if (!folded) return;

  // An interrupt typed in THIS tab is already the newest thing in the
  // conversation — `sendCommand` pushes it before the request even leaves the
  // browser, so it cannot have a `planId` yet to match on. Comparing against the
  // last user line is what keeps it from being echoed back a second time.
  const lastUser = [...state.messages].reverse().find((m) => m.role === 'user');
  if (lastUser?.text === folded) return;

  state.messages.push(
    makeMessage('user', folded, {
      planId: incoming.id,
      ...(incoming.language ? { spokenLanguage: incoming.language } : {}),
    })
  );
}

/**
 * Whether `agent:plan:*` / `agent:block:*` progress must be dropped.
 *
 * Only a stop the agent acknowledged as delivered makes later events stale.
 * While a stop is merely requested, failed, or latched without hardware
 * confirmation, the robot may still be executing, and its events are the
 * operator's only evidence of that. Hiding them would freeze the UI on a stop
 * that never happened.
 */
function progressSuppressed(state: MutableState): boolean {
  return (
    state.estopActive &&
    state.estopStatus !== 'requesting' &&
    state.estopStatus !== 'unconfirmed' &&
    state.estopStatus !== 'failed'
  );
}

/**
 * Fold a latch the *agent* reports into the local state.
 *
 * A reported latch is by definition acknowledged. A reported *absence* while we
 * are still waiting for — or missing — an acknowledgement says our stop never
 * landed: it must not silently clear the local latch, because that would hand
 * the console back to an operator who believes the robot is stopped.
 */
function applyReportedLatch(state: MutableState, reported: boolean): void {
  if (reported) {
    state.estopActive = true;
    // The reported latch is the software claim we already hold — it says
    // nothing about hardware delivery and must not upgrade an unconfirmed
    // stop to "stopped and damped".
    if (state.estopStatus !== 'unconfirmed') {
      state.estopStatus = 'acknowledged';
      state.estopError = null;
    }
    return;
  }
  if (state.estopStatus === 'requesting' || state.estopStatus === 'failed') return;
  state.estopActive = false;
  state.estopStatus = 'idle';
  state.estopError = null;
}

/**
 * Fold the base's arming state (`damped` / `fsmId`) into the store.
 *
 * Both fields are optional on the wire so an older robot-agent stays
 * structurally compatible. An absent field is *unknown*, not `false` — the
 * previous value is kept rather than replaced with a claim we cannot back.
 */
function applyBaseArming(
  state: MutableState,
  reported: { damped?: boolean; fsmId?: number | null } | null | undefined
): void {
  if (!reported) return;
  if (reported.damped !== undefined) state.damped = reported.damped;
  if (reported.fsmId !== undefined) state.fsmId = reported.fsmId ?? null;
}

/**
 * Make sure the plan the block event refers to is the one in the store.
 *
 * `runGeneratedBlock` splices navigator-generated blocks (look/turn/walk/…)
 * into a live plan and the agent does NOT emit `agent:plan:updated` for it —
 * the spliced plan only ever reaches the client on the `plan` field of the
 * block events themselves. Resolving the block against the store's stale copy
 * therefore drops every generated block: the timeline pulses the original
 * `goto` chip for the whole navigation and shows nothing else.
 *
 * @returns false when the event belongs to a different plan and must be ignored
 */
function adoptEventPlan(state: MutableState, event: AgentModeEvent): boolean {
  const incoming = event.plan;
  if (!incoming) return true; // Block-only envelope: resolve against the store.
  if (state.plan && state.plan.id !== incoming.id) return false;
  // The agent clones the plan at emit time, so it is at least as fresh as ours.
  // Adopt it only when it actually adds something — replacing an identical plan
  // on every event would churn the immer draft for no reason.
  if (!state.plan || findBlockIndex(state.plan, event.block) === -1) {
    state.plan = incoming;
  }
  return true;
}

// ============================================================================
// SELECTORS
// ============================================================================

/** Select the bound robot id */
export const selectRobotId = (state: AgentModeStore) => state.robotId;

/** Select whether Agent Mode is on for the bound robot */
export const selectEnabled = (state: AgentModeStore) => state.enabled;

/** Select the exclusive control owner */
export const selectControlOwner = (state: AgentModeStore) => state.controlOwner;

/** Select whether an E-Stop is latched */
export const selectEstopActive = (state: AgentModeStore) => state.estopActive;

/** Select how far the E-Stop request got: requested, acknowledged or failed */
export const selectEstopStatus = (state: AgentModeStore) => state.estopStatus;

/** Select why the E-Stop request failed (null unless it did) */
export const selectEstopError = (state: AgentModeStore) => state.estopError;

/** Select whether the base is damped — it cannot walk, turn or goto while true */
export const selectDamped = (state: AgentModeStore) => state.damped;

/** Select the last FSM id the base was commanded into */
export const selectFsmId = (state: AgentModeStore) => state.fsmId;

/** Select the current plan */
export const selectPlan = (state: AgentModeStore) => state.plan;

/** Select superseded plans (oldest first) */
export const selectPlanHistory = (state: AgentModeStore) => state.planHistory;

/** Select the scene memory */
export const selectScene = (state: AgentModeStore) => state.scene;

/** Select the scene entity list (a shared empty array when nothing was seen yet) */
export const selectSceneEntities = (state: AgentModeStore): SceneEntity[] =>
  state.scene?.entities ?? (NO_ENTITIES as SceneEntity[]);

/** Select the conversation */
export const selectMessages = (state: AgentModeStore) => state.messages;

/** Select the command awaiting a plan */
export const selectPendingCommand = (state: AgentModeStore) => state.pendingCommand;

/** Select the WebSocket connection status */
export const selectConnectionStatus = (state: AgentModeStore) => state.connectionStatus;

/** Select loading state */
export const selectIsLoading = (state: AgentModeStore) => state.isLoading;

/** Select whether a command is in flight */
export const selectIsSending = (state: AgentModeStore) => state.isSending;

/** Select the error */
export const selectError = (state: AgentModeStore) => state.error;

/**
 * Select the block the robot is executing right now. Prefers a block that
 * actually reports `running`; between blocks the plan cursor is -1, so this
 * falls back to the cursor only when it points somewhere.
 */
export const selectCurrentBlock = (state: AgentModeStore): AgentBlock | null =>
  currentBlockOfPlan(state.plan);

/**
 * Select the blocks queued after the current one.
 *
 * Note: this allocates, so components must NOT subscribe to it directly
 * (zustand v5 caches snapshots by identity). Subscribe to `plan` and memoize
 * `upcomingBlocksOfPlan` instead — this selector exists for imperative reads.
 */
export const selectUpcomingBlocks = (state: AgentModeStore): AgentBlock[] =>
  upcomingBlocksOfPlan(state.plan);

/** Select a plan by id across the current plan and the history. */
export const selectPlanById =
  (planId: string | undefined) =>
  (state: AgentModeStore): AgentPlan | null => {
    if (!planId) return null;
    if (state.plan?.id === planId) return state.plan;
    return state.planHistory.find((p) => p.id === planId) ?? null;
  };
