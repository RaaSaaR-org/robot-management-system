/**
 * @file agentmodeStore.ts
 * @description Zustand store for Agent Mode — plan, blocks, scene memory, E-Stop
 * @feature agentmode
 * @dependencies @/store, @/features/agentmode/api, @/features/agentmode/types
 * @stateAccess Creates: useAgentModeStore
 */

import { createStore } from '@/store';
import { getErrorMessage, getErrorStatus, isNotFoundError } from '@/shared/utils';
import { agentmodeApi } from '../api/agentmodeApi';
import { currentBlockOfPlan, upcomingBlocksOfPlan } from '../utils/planQuery';
import type {
  AgentBlock,
  AgentChatMessage,
  AgentEstopStatus,
  AgentIdentityPatch,
  AgentMemoryDigest,
  AgentModeEvent,
  AgentModeStore,
  AgentPendingCommand,
  AgentPlan,
  AgentPlanStatus,
  AgentRecoveryState,
  AgentSelfState,
  AgentMapSummary,
  AgentStateReachability,
  RobotMapPayload,
  RobotCloudPayload,
  RobotMapStatus,
  ControlOwner,
  MirroredAgentModeState,
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
  // A cold start knows nothing either, but "this server has no state for that
  // robot" is the documented empty case and renders as an empty page, not as a
  // claim. Only a robot the server HAS and could not ask is UNKNOWN.
  stateReachability: 'known' as AgentStateReachability,
  stateUnavailableReason: null as string | null,
  damped: false,
  fsmId: null as number | null,
  recovered: null as AgentRecoveryState | null,
  self: null as AgentSelfState | null,
  /**
   * The robot's own map, in summary. `undefined` = the agent does not report
   * one (older agent), `null` = map building disabled, else the counts.
   */
  map: undefined as AgentMapSummary | null | undefined,
  robotMap: null as RobotMapPayload | null,
  robotMapStatus: 'idle' as RobotMapStatus,
  robotMapError: null as string | null,
  robotMapFetchedAt: null as string | null,
  robotCloud: null as RobotCloudPayload | null,
  robotCloudStatus: 'idle' as RobotMapStatus,
  robotCloudError: null as string | null,
  selfUpdatedAt: null as string | null,
  selfLive: false,
  selfAgeUnknown: false,
  selfLiveBootId: null as string | null,
  selfSuperseded: false,
  memory: null as AgentMemoryDigest | null,
  plan: null as AgentPlan | null,
  planHistory: [] as AgentPlan[],
  scene: null as SceneMemory | null,
  messages: [] as AgentChatMessage[],
  pendingCommand: null as AgentPendingCommand | null,
  connectionStatus: 'disconnected' as WebSocketStatus,
  isLoading: false,
  isSending: false,
  isSavingIdentity: false,
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

/**
 * The three answers `GET /robots/:id/agent-mode` can give, kept apart.
 *
 * `empty` (404) and `unreachable` (502) are both "no state came back", and
 * collapsing them into one `null` is the bug this type exists to prevent: one
 * of them means there is nothing to show, the other means we cannot see.
 */
type FetchStateOutcome =
  | { kind: 'state'; agentState: MirroredAgentModeState }
  | { kind: 'empty' }
  | { kind: 'unreachable'; reason: string };

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
        const [outcome, scene] = await Promise.all([
          // 404 is the documented empty case: this server has no such robot
          // (fresh process, Agent Mode never enabled). That is a normal cold
          // start, not a failure — the page renders its empty state.
          // 502 AGENT_STATE_UNAVAILABLE is the opposite: the robot EXISTS and
          // could not be asked, so nothing about it is known. Folding that into
          // the same `null` would print "Agent Mode off, E-Stop clear".
          agentmodeApi.getState(robotId).then(
            (agentState): FetchStateOutcome => ({ kind: 'state', agentState }),
            (error: unknown): FetchStateOutcome => {
              if (isNotFoundError(error)) return { kind: 'empty' };
              if (isStateUnavailableError(error)) {
                return { kind: 'unreachable', reason: getErrorMessage(error) };
              }
              throw error;
            }
          ),
          agentmodeApi.getScene(robotId).catch(() => null),
        ]);

        set((state) => {
          if (staleResponse(state, robotId)) return;
          state.isLoading = false;

          if (outcome.kind === 'unreachable') {
            // Deliberately writes NOTHING else. Overwriting `enabled`,
            // `estopActive` or `plan` here would replace "unknown" with a
            // confident default — and clearing them would be a claim of its
            // own ("Agent Mode off", "no plan running"). What we hold is the
            // last thing we heard; the banner says so, and every control that
            // renders a latch position reads `stateReachability` first.
            state.stateReachability = 'unreachable';
            state.stateUnavailableReason = outcome.reason;
            // The scene read is a separate route; if it answered, that part is
            // real. An absent one leaves the last known scene alone.
            if (scene) state.scene = scene;
            return;
          }

          const agentState = outcome.kind === 'state' ? outcome.agentState : null;
          state.stateReachability = 'known';
          state.stateUnavailableReason = null;
          state.enabled = agentState?.enabled ?? false;
          state.controlOwner = agentState?.controlOwner ?? 'idle';
          state.estopActive = agentState?.estopActive ?? false;
          // A latch the agent itself reports is already acknowledged by it.
          state.estopStatus = agentState?.estopActive ? 'acknowledged' : 'idle';
          state.estopError = null;
          applyBaseArming(state, agentState);
          applyRecovery(state, agentState);
          // Read out of the SERVER's mirror. The age that matters is when the
          // SERVER last ingested this snapshot, never when this tab fetched —
          // the fetch time is always now, which would make a snapshot from a
          // process that died an hour ago read as live. A server that cannot
          // date it leaves the age unknown, and unknown is what gets rendered.
          applySelf(state, agentState, mirrorObservedAt(agentState), false);
          applyMap(state, agentState);
          state.plan = agentState?.plan ?? null;
          state.scene = scene ?? agentState?.scene ?? null;
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
    // Fetch the durable-memory digest
    // --------------------------------------------------------------------------
    fetchMemory: async (robotId: string) => {
      // Counts, never content: `MEMORY.md` is operator-authored personal data
      // and stays behind the robot's `personalDataGate`. Every failure mode
      // here — no route on this server, no workspace on this robot, robot
      // unreachable — is "we do not know", never "this robot remembers
      // nothing", so nothing is written and no error banner is raised. The
      // panel keeps whatever the `agent:memory:updated` digest last gave it.
      const digest = await agentmodeApi.getMemory(robotId).catch(() => null);
      if (!digest) return;
      set((state) => {
        if (staleResponse(state, robotId)) return;
        state.memory = digest;
      });
    },

    // --------------------------------------------------------------------------
    // Fetch the robot's own map (TASK-206/207)
    // --------------------------------------------------------------------------
    fetchRobotMap: async (robotId: string) => {
      try {
        const map = await agentmodeApi.getMap(robotId);
        set((state) => {
          if (staleResponse(state, robotId)) return;
          state.robotMap = map;
          state.robotMapStatus = 'ok';
          state.robotMapError = null;
          state.robotMapFetchedAt = new Date().toISOString();
        });
      } catch (err) {
        // 404 is the ROBOT's answer ("map disabled", "older agent without the
        // route", "nothing integrated yet"); anything else means we could not
        // ask, which leaves the last map on screen and says so in the footer.
        const why = getErrorMessage(err, 'map unavailable');
        set((state) => {
          if (staleResponse(state, robotId)) return;
          if (isNotFoundError(err)) {
            state.robotMap = null;
            state.robotMapStatus = 'disabled';
          } else {
            state.robotMapStatus = 'unavailable';
          }
          state.robotMapError = why;
        });
      }
    },

    // --------------------------------------------------------------------------
    // Fetch the robot's own world cloud (TASK-211) — same contract as the map
    // --------------------------------------------------------------------------
    fetchRobotCloud: async (robotId: string, maxPoints?: number) => {
      try {
        const cloud = await agentmodeApi.getCloud(robotId, maxPoints);
        set((state) => {
          if (staleResponse(state, robotId)) return;
          state.robotCloud = cloud;
          state.robotCloudStatus = 'ok';
          state.robotCloudError = null;
        });
      } catch (err) {
        const why = getErrorMessage(err, 'cloud unavailable');
        set((state) => {
          if (staleResponse(state, robotId)) return;
          if (isNotFoundError(err)) {
            state.robotCloud = null;
            state.robotCloudStatus = 'disabled';
          } else {
            state.robotCloudStatus = 'unavailable';
          }
          state.robotCloudError = why;
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
    // Name the robot (the bootstrap ritual's non-conversational door)
    // --------------------------------------------------------------------------
    submitIdentity: async (robotId: string, patch: AgentIdentityPatch) => {
      set((state) => {
        state.isSavingIdentity = true;
        state.error = null;
      });

      try {
        const response = await agentmodeApi.writeIdentity(robotId, patch);
        set((state) => {
          if (staleResponse(state, robotId)) {
            state.isSavingIdentity = false;
            return;
          }
          state.isSavingIdentity = false;
          // The robot writes `IDENTITY.md` and answers with the self it now
          // reports — adopt that rather than echoing back what was typed, so
          // the header shows what actually landed on the robot's disk.
          applySelf(state, response, new Date().toISOString(), true);
        });
        return true;
      } catch (error) {
        const message = getErrorMessage(error);
        set((state) => {
          if (staleResponse(state, robotId)) return;
          state.isSavingIdentity = false;
          state.error = message;
        });
        return false;
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
          markReachable(state);
          state.enabled = agentState.enabled;
          state.controlOwner = agentState.controlOwner;
          applyReportedLatch(state, agentState.estopActive);
          applyBaseArming(state, agentState);
          applyRecovery(state, agentState);
          // The toggle is proxied straight through to the robot, so this
          // snapshot is the robot's own answer, taken just now.
          applySelf(state, agentState, new Date().toISOString(), true);
          applyMap(state, agentState);
        });
      } catch (error) {
        const message = getErrorMessage(error);
        set((state) => {
          if (staleResponse(state, robotId)) return;
          // The rollback restores the value we had, which — when the robot is
          // what could not be reached — is itself unknown. Saying so is what
          // stops the switch from settling back into a confident "off".
          state.enabled = !enabled;
          state.error = message;
          markUnreachableOnError(state, error);
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
          // The agent answered: whatever else is unknown, contact exists and
          // the latch below is its own word, not a guess.
          markReachable(state);
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
          markUnreachableOnError(state, error);
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
          markReachable(state);
          state.enabled = agentState.enabled;
          state.controlOwner = agentState.controlOwner;
          state.error = null;
          // Clearing the latch does NOT re-arm the base — the robot stays
          // damped until a `posture` stand. Keep that visible across the reset.
          applyBaseArming(state, agentState);
          applyRecovery(state, agentState);
          // Proxied to the robot as well — a fresh answer, not the mirror.
          applySelf(state, agentState, new Date().toISOString(), true);
          applyMap(state, agentState);
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
          markUnreachableOnError(state, error);
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
            // A full state the robot pushed — the one event that ends UNKNOWN.
            // Progress events prove the robot is alive but say nothing about
            // its mode or its latch, so they deliberately do not clear it.
            markReachable(state);
            state.enabled = event.state.enabled;
            state.controlOwner = event.state.controlOwner;
            applyReportedLatch(state, event.state.estopActive);
            applyBaseArming(state, event.state);
            applyRecovery(state, event.state);
            // A pushed snapshot: the robot said this at `event.timestamp`, and
            // the server relayed it. That is as live as this console gets.
            applySelf(state, event.state, event.timestamp, true);
            applyMap(state, event.state);
            if (event.state.scene) state.scene = event.state.scene;
            // A snapshot may only move the plan FORWARD — see `snapshotPlanIsStale`.
            if (event.state.plan && !snapshotPlanIsStale(state.plan, event.state.plan)) {
              state.plan = event.state.plan;
            }
            break;
          }

          case 'agent:memory:updated': {
            if (!event.memory) break;
            state.memory = event.memory;
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

/** The server's code for "this robot exists, but I could not ask it". */
const STATE_UNAVAILABLE_CODE = 'AGENT_STATE_UNAVAILABLE';

/**
 * Whether an error is the server saying the robot could not be reached.
 *
 * Matches on either half of the contract: the `502` status, or the
 * `AGENT_STATE_UNAVAILABLE` code. A 502 from any of the robot-facing routes
 * means the same thing — the server is the gateway, the robot is what it could
 * not reach — so the status alone is enough, and the code keeps working if a
 * deployment ever puts a different status in front of it.
 */
function isStateUnavailableError(error: unknown): boolean {
  if (getErrorStatus(error) === 502) return true;
  return (error as { code?: unknown } | null | undefined)?.code === STATE_UNAVAILABLE_CODE;
}

/**
 * Record that the robot answered — whatever it answered.
 *
 * Every call that lands here came back through the server FROM the robot
 * (`toggle` and `estop/reset` are proxied straight through; `estop` is the
 * agent's own acknowledgement), so contact exists again. Leaving the UNKNOWN
 * banner up next to a latch the agent just confirmed would contradict itself.
 */
function markReachable(state: MutableState): void {
  state.stateReachability = 'known';
  state.stateUnavailableReason = null;
}

/**
 * Record that a robot-facing call failed *because the robot could not be
 * reached* — as opposed to being refused by it, which is an answer.
 *
 * Only the unreachable case is folded in: a 400 the agent sent back is the
 * robot talking, and must not blank out what we know about it.
 */
function markUnreachableOnError(state: MutableState, error: unknown): void {
  if (!isStateUnavailableError(error)) return;
  state.stateReachability = 'unreachable';
  state.stateUnavailableReason = getErrorMessage(error);
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
    // A stop whose REQUEST never completed is in exactly the same position as
    // one the hardware declined to confirm: something is latched in software
    // and nothing has confirmed the robot. The agent reporting the latch is new
    // information — it exists — so the status moves, but only as far as the
    // truth goes. Upgrading it to `acknowledged` here (and clearing the reason
    // with it) made the console LESS alarmed than reality about the one control
    // that exists for when things go wrong: a 502 from the server proxy, whose
    // timeout is shorter than the robot's own stop path, rendered as "The robot
    // confirmed the stop: it is stopped and damped" ~15 s later.
    if (state.estopStatus === 'failed') {
      state.estopStatus = 'unconfirmed';
      return;
    }
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
 * Fold what the robot's boot inherited (`recovered`) into the store.
 *
 * Same rule as `applyBaseArming`: absent is *unknown*, not "nothing happened".
 * An older agent omits the field entirely, and clearing the badge because of
 * that would hide exactly the thing the operator needs to see. An explicit
 * `null` is the agent saying it has been acknowledged.
 */
function applyRecovery(
  state: MutableState,
  reported: { recovered?: AgentRecoveryState | null } | null | undefined
): void {
  if (!reported) return;
  if (reported.recovered !== undefined) state.recovered = reported.recovered;
}

/**
 * Below this, a mirrored snapshot is the CURRENT process's push rather than a
 * leftover, whatever bootId our last direct answer carried.
 *
 * The agent re-asserts its state on a 15 s clock, so a mirror entry younger
 * than this was written by a process that was alive moments ago. Matches the
 * header's own staleness threshold, so the "different process" badge can only
 * ever appear beside "cached" — never beside "just now", which is a
 * self-contradicting pair of claims.
 */
const SELF_SUPERSEDED_MIN_AGE_MS = 60_000;

/**
 * When a mirrored snapshot was taken, expressed in THIS browser's clock.
 *
 * The server sends its own instants (`stateMirroredAt`) plus the frame they
 * live in (`serverNow`), so the age is taken inside the server's clock and only
 * the RESULT is carried over here. Subtracting the server's stamp from
 * `Date.now()` directly would fold the skew between two machines into the age:
 * a server two minutes ahead hides a stale snapshot as "just now" again, one 90
 * seconds behind paints every fresh read as "cached" until nobody reads the
 * badge at all.
 *
 * `stateMirroredAt`, never `mirroredAt`: the latter moves on any event, so a
 * block event would re-date a `self` it did not touch — and only ever in the
 * direction of looking younger. A server that sends no snapshot stamp gets
 * `null` (unknown age) rather than a fallback to `mirroredAt`, because that
 * fallback is exactly the wrong-direction guess.
 */
function mirrorObservedAt(agentState: MirroredAgentModeState | null): string | null {
  const taken = agentState?.stateMirroredAt;
  if (!taken) return null;
  const takenMs = Date.parse(taken);
  if (Number.isNaN(takenMs)) return null;

  const serverNowMs = agentState?.serverNow ? Date.parse(agentState.serverNow) : NaN;
  // A server that does not report its frame is the pre-`serverNow` build: its
  // instant is all there is, and using it raw is still far better than the
  // fetch time. Skew is then back, bounded and documented, instead of the age
  // being unknowable.
  if (Number.isNaN(serverNowMs)) return taken;

  const ageMs = Math.max(0, serverNowMs - takenMs);
  return new Date(Date.now() - ageMs).toISOString();
}

/**
 * Fold who the robot says it is (`self`) into the store, together with how old
 * that answer is and where it came from.
 *
 * Same rule again: absent is *unknown* and keeps whatever we had. An agent that
 * does not report a self is not a robot without an identity — a robot that
 * genuinely has none reports one with `bootstrapRequired: true`.
 *
 * The provenance is not decoration. `GET /agent-mode` reads the SERVER's
 * in-memory mirror, which only moves when the robot pushes an event; it can be
 * minutes — or a whole incarnation — behind the robot, and it has been observed
 * to be. A pushed `agent:state:changed` and the responses to toggle/estop-reset
 * (which the server proxies straight through to the robot) are the robot's own
 * answer at a known instant. The header line renders the difference so nobody
 * reads a cached battery percentage as a live one.
 *
 * @param observedAt - When the snapshot was taken, ISO, in THIS browser's clock.
 *                     For a pushed event that is the event's own timestamp; for
 *                     a mirror read it is {@link mirrorObservedAt}, and `null`
 *                     when the server did not report one — see below.
 * @param live - False for the server mirror, true for the robot's own answer.
 */
/**
 * Fold the robot's map summary (TASK-206) into the store. An agent that sends
 * no `map` field is left as it was — "does not report" is not "disabled".
 */
function applyMap(
  state: MutableState,
  reported: { map?: AgentMapSummary | null } | null | undefined
): void {
  if (!reported || reported.map === undefined) return;
  state.map = reported.map;
}

function applySelf(
  state: MutableState,
  reported: { self?: AgentSelfState | null } | null | undefined,
  observedAt: string | null,
  live: boolean
): void {
  if (!reported) return;
  if (reported.self === undefined) return;
  // Decided BEFORE `selfLiveBootId` is refreshed below, and against the
  // snapshot that is arriving — this is a claim about that snapshot, not about
  // whatever the store happened to hold a moment ago.
  state.selfSuperseded = isSupersededSnapshot(state, reported.self, observedAt, live);
  state.self = reported.self;
  state.selfUpdatedAt = observedAt;
  state.selfLive = live;
  // A mirror read the server could not date is an UNKNOWN age, and it is
  // recorded as one. The alternative — falling back to `Date.now()` — is what
  // the defect was: the age reset to zero on every poll, so a snapshot left
  // behind by a process that died an hour ago rendered as "just now" forever,
  // and the staleness warning built to catch exactly that could never fire.
  state.selfAgeUnknown = !live && observedAt === null;
  // Remember which process last answered us DIRECTLY. A later mirror read
  // carrying a different bootId is then knowably a different process, not just
  // an older reading of this one.
  if (live && reported.self) state.selfLiveBootId = reported.self.bootId;
}

/**
 * Whether an arriving snapshot is a dead process's LEFTOVER.
 *
 * Two bootIds is the evidence, and it is only evidence once the robot itself
 * has answered us at least once. But it is not evidence on its own: this store
 * is module-level and `selectRobot` no-ops when the bound robot id is unchanged,
 * so `selfLiveBootId` survives leaving the page and coming back. If the agent
 * restarted in between — which a watch-mode dev box does on every saved file —
 * a perfectly FRESH mirror read carrying the new boot would otherwise be
 * flagged, pointing the warning at the live process and calling the dead one
 * the reference. The snapshot's own age is what tells the two apart: a mirror
 * younger than {@link SELF_SUPERSEDED_MIN_AGE_MS} was written by something that
 * was alive moments ago.
 *
 * An UNKNOWN age counts as old. A snapshot nobody can date is precisely the
 * case where the bootId is the only evidence left.
 */
function isSupersededSnapshot(
  state: MutableState,
  self: AgentSelfState | null,
  observedAt: string | null,
  live: boolean
): boolean {
  // The robot's own answer is, by definition, the process that is running.
  if (live) return false;
  if (!self?.bootId) return false;
  if (state.selfLiveBootId === null) return false;
  if (self.bootId === state.selfLiveBootId) return false;
  if (observedAt === null) return true;
  const takenMs = Date.parse(observedAt);
  if (Number.isNaN(takenMs)) return true;
  // Same clock on both sides: `observedAt` was carried into this browser's
  // frame by `mirrorObservedAt` before it got here.
  return Date.now() - takenMs >= SELF_SUPERSEDED_MIN_AGE_MS;
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

/** Plan lifecycles that are over — nothing will ever emit for them again. */
const TERMINAL_PLAN_STATUSES: readonly AgentPlanStatus[] = ['done', 'failed', 'aborted'];

const isTerminalPlan = (status: AgentPlanStatus): boolean =>
  TERMINAL_PLAN_STATUSES.includes(status);

/** ISO → ms, or null when the string is missing or unparsable. */
function isoMs(iso: string | undefined): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
}

/**
 * Would this plan, carried on an `agent:state:changed`, move the timeline
 * BACKWARDS?
 *
 * The robot re-asserts its state to the server mirror on a clock, and every one
 * of those pushes is fanned out to every app client. The push is
 * fire-and-forget, so a snapshot taken at T can arrive after an event emitted
 * at T+ε — the classic loss being a heartbeat that still says `running`
 * overtaking `agent:plan:finished`, after which the timeline shows a plan that
 * finished minutes ago as still executing, because a finished plan emits
 * nothing further. The nastier variant carries a whole PREVIOUS plan into a
 * store that has already moved on to the next one, and the operator watches the
 * old plan's blocks for the entire run of the new one.
 *
 * Newer agents leave the plan off the heartbeat entirely, which is the real
 * fix; this guard is what makes an OLDER agent — or any other out-of-order
 * delivery — survivable, so it is deliberately kept.
 *
 * Rejected when: the same plan would be resurrected out of a terminal status or
 * rewound to an older `updatedAt`, or a DIFFERENT plan that was created before
 * the one on screen would take it over. Anything unprovable (missing or
 * unparsable stamps, no plan on screen) is accepted — this guard exists to
 * catch a demonstrable rewind, not to second-guess the robot.
 */
function snapshotPlanIsStale(current: AgentPlan | null, incoming: AgentPlan): boolean {
  if (!current) return false;

  if (current.id !== incoming.id) {
    // A different plan may take the timeline over only if it is the newer one.
    const currentStart = isoMs(current.createdAt);
    const incomingStart = isoMs(incoming.createdAt);
    if (currentStart === null || incomingStart === null) return false;
    return incomingStart < currentStart;
  }

  // Same plan: an ending is final. Only another terminal status (a `done` that
  // the abort path re-reports as `aborted`) may follow one.
  if (isTerminalPlan(current.status) && !isTerminalPlan(incoming.status)) return true;

  const currentAt = isoMs(current.updatedAt);
  const incomingAt = isoMs(incoming.updatedAt);
  if (currentAt === null || incomingAt === null) return false;
  return incomingAt < currentAt;
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

/** Select whether the robot's state is known at all, or it could not be asked */
export const selectStateReachability = (state: AgentModeStore) => state.stateReachability;

/**
 * Select whether this console has NO idea what the robot is doing.
 *
 * Every control and every badge that would otherwise render `enabled` or
 * `estopActive` has to consult this first: while it is true those two are the
 * initial defaults or a stale memory, and showing them says "Agent Mode off,
 * E-Stop clear" about a robot nobody can reach.
 */
export const selectStateUnknown = (state: AgentModeStore): boolean =>
  state.stateReachability === 'unreachable';

/** Select what the server said when it could not reach the robot; null otherwise */
export const selectStateUnavailableReason = (state: AgentModeStore) =>
  state.stateUnavailableReason;

/** Select whether the base is damped — it cannot walk, turn or goto while true */
export const selectDamped = (state: AgentModeStore) => state.damped;

/** Select the last FSM id the base was commanded into */
export const selectFsmId = (state: AgentModeStore) => state.fsmId;

/**
 * Select who the bound robot is and what it has been through — null until the
 * agent reports it.
 */
export const selectSelf = (state: AgentModeStore) => state.self;

/** Select the robot's own map summary (undefined = not reported, null = disabled) */
export const selectMapSummary = (state: AgentModeStore) => state.map;

/**
 * Select when this console last received a self snapshot (ISO), or null before
 * the first one. Not "when the robot last changed" — when we last heard.
 */
export const selectSelfUpdatedAt = (state: AgentModeStore) => state.selfUpdatedAt;

/**
 * Select whether that snapshot was the robot's own answer (a pushed event or a
 * proxied call) rather than a read of the server's in-memory mirror.
 */
export const selectSelfLive = (state: AgentModeStore) => state.selfLive;

/**
 * Select whether we hold a mirrored self whose AGE nobody could tell us.
 *
 * Distinct from `selfUpdatedAt === null` on its own, which is simply "nothing
 * has arrived yet". This one means a snapshot did arrive and cannot be dated —
 * which must be shown, not silently dressed up as fresh.
 */
export const selectSelfAgeUnknown = (state: AgentModeStore) => state.selfAgeUnknown;

/**
 * Select whether the self on screen came from a DIFFERENT process than the one
 * that last answered us directly.
 *
 * Not a refinement of staleness — a different answer. The observed defect was a
 * duplicate robot-agent that booted, pushed one state event, died on
 * EADDRINUSE and left its identity in the server's mirror; the console then
 * rendered that dead process's incarnation, uptime and battery as the running
 * robot's. Two bootIds is the evidence, and it is only evidence once the robot
 * itself has answered us at least once AND the snapshot is old enough that a
 * live process cannot be the one that wrote it — see
 * {@link isSupersededSnapshot}, which decides it as the snapshot arrives.
 */
export const selectSelfSuperseded = (state: AgentModeStore): boolean => state.selfSuperseded;

/**
 * Select what the robot durably remembers, as counts — null until a digest
 * arrives. Never the memory's content: that stays on the robot.
 */
export const selectMemory = (state: AgentModeStore) => state.memory;

/** Select whether an identity write is in flight. */
export const selectIsSavingIdentity = (state: AgentModeStore) => state.isSavingIdentity;

/**
 * Select what the robot's boot inherited — a latch that survived a restart, an
 * unclean shutdown — or null once an operator has cleared it.
 */
export const selectRecovered = (state: AgentModeStore) => state.recovered;

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
