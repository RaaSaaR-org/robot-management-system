/**
 * @file ConversationManager.test.ts
 * @description Unit tests for ConversationManager — A2A conversation/message/task/agent
 *   lifecycle, in-memory caches, orchestration agent selection (keyword + named match),
 *   remote agent dispatch via JSON-RPC, and event recording. All repository, axios,
 *   uuid, and RobotManager boundaries are mocked; no real DB/network access.
 * @feature a2a
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type {
  A2AConversation,
  A2ATask,
  A2AAgentCard,
  A2AMessage,
} from '../../types/index.js';

// ---------------------------------------------------------------------------
// Mocks for external boundaries
// ---------------------------------------------------------------------------

vi.mock('../../repositories/index.js', () => ({
  conversationRepository: {
    count: vi.fn(),
    create: vi.fn(),
    findById: vi.fn(),
    findAll: vi.fn(),
    delete: vi.fn(),
    addMessage: vi.fn(),
    getMessages: vi.fn(),
  },
  taskRepository: {
    create: vi.fn(),
    updateStatus: vi.fn(),
    findById: vi.fn(),
    findAll: vi.fn(),
  },
  agentRepository: {
    findAll: vi.fn(),
    upsert: vi.fn(),
    delete: vi.fn(),
    findByName: vi.fn(),
  },
  eventRepository: {
    create: vi.fn(),
    findAll: vi.fn(),
    findSince: vi.fn(),
  },
}));

vi.mock('axios', () => ({
  default: {
    post: vi.fn(),
  },
}));

// Deterministic uuid so generated ids are assertable.
let uuidCounter = 0;
vi.mock('uuid', () => ({
  v4: vi.fn(() => `uuid-${++uuidCounter}`),
}));

// RobotManager is dynamically imported inside the service.
const listRobots = vi.fn();
const getConnectedAgents = vi.fn();
vi.mock('../RobotManager.js', () => ({
  robotManager: {
    listRobots,
    getConnectedAgents,
  },
}));

import { ConversationManager } from '../ConversationManager.js';
import {
  conversationRepository as _conversationRepository,
  taskRepository as _taskRepository,
  agentRepository as _agentRepository,
  eventRepository as _eventRepository,
} from '../../repositories/index.js';
import axiosDefault from 'axios';

const conversationRepository = vi.mocked(_conversationRepository, true);
const taskRepository = vi.mocked(_taskRepository, true);
const agentRepository = vi.mocked(_agentRepository, true);
const eventRepository = vi.mocked(_eventRepository, true);
const axios = vi.mocked(axiosDefault, true);

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeConversation(overrides: Partial<A2AConversation> = {}): A2AConversation {
  return {
    conversationId: 'conv-1',
    name: 'Conversation 1',
    isActive: true,
    taskIds: [],
    messages: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeTask(overrides: Partial<A2ATask> = {}): A2ATask {
  return {
    id: 'task-1',
    contextId: 'conv-1',
    status: { state: 'submitted', timestamp: new Date().toISOString() },
    history: [],
    ...overrides,
  };
}

function makeAgent(overrides: Partial<A2AAgentCard> = {}): A2AAgentCard {
  return {
    name: 'SimBot-01',
    description: 'A general purpose robot',
    url: 'http://localhost:9000',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ConversationManager', () => {
  let manager: ConversationManager;

  beforeEach(() => {
    vi.clearAllMocks();
    uuidCounter = 0;
    delete process.env.OPENROUTER_API_KEY;
    manager = new ConversationManager();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // -------------------------------------------------------------------------
  // initialize
  // -------------------------------------------------------------------------
  describe('initialize', () => {
    it('loads agents from the database into the cache', async () => {
      agentRepository.findAll.mockResolvedValue([
        makeAgent({ name: 'Alpha' }),
        makeAgent({ name: 'Beta' }),
      ]);

      await manager.initialize();

      expect(agentRepository.findAll).toHaveBeenCalledTimes(1);
      expect(manager.getAgent('Alpha')?.name).toBe('Alpha');
      expect(manager.getAgent('Beta')?.name).toBe('Beta');
      expect(manager.listAgents()).toHaveLength(2);
    });

    it('propagates repository errors', async () => {
      agentRepository.findAll.mockRejectedValue(new Error('db down'));
      await expect(manager.initialize()).rejects.toThrow('db down');
    });
  });

  // -------------------------------------------------------------------------
  // createConversation
  // -------------------------------------------------------------------------
  describe('createConversation', () => {
    it('creates a conversation with an auto-generated name and caches it', async () => {
      conversationRepository.count.mockResolvedValue(4);
      const created = makeConversation({ conversationId: 'conv-x', name: 'Conversation 5' });
      conversationRepository.create.mockResolvedValue(created);

      const result = await manager.createConversation('robot-7');

      expect(conversationRepository.create).toHaveBeenCalledWith({
        robotId: 'robot-7',
        name: 'Conversation 5',
      });
      expect(result).toBe(created);
      // Cached: subsequent getConversation must not hit the DB.
      const fetched = await manager.getConversation('conv-x');
      expect(fetched).toBe(created);
      expect(conversationRepository.findById).not.toHaveBeenCalled();
    });

    it('uses the provided name when given', async () => {
      conversationRepository.count.mockResolvedValue(0);
      conversationRepository.create.mockResolvedValue(makeConversation({ name: 'My Chat' }));

      await manager.createConversation(undefined, 'My Chat');

      expect(conversationRepository.create).toHaveBeenCalledWith({
        robotId: undefined,
        name: 'My Chat',
      });
    });
  });

  // -------------------------------------------------------------------------
  // getConversation
  // -------------------------------------------------------------------------
  describe('getConversation', () => {
    it('loads from the database on a cache miss and caches the result', async () => {
      const conv = makeConversation({ conversationId: 'conv-db' });
      conversationRepository.findById.mockResolvedValue(conv);

      const first = await manager.getConversation('conv-db');
      const second = await manager.getConversation('conv-db');

      expect(first).toBe(conv);
      expect(second).toBe(conv);
      // Only one DB hit because the second is served from cache.
      expect(conversationRepository.findById).toHaveBeenCalledTimes(1);
    });

    it('returns undefined when not found', async () => {
      conversationRepository.findById.mockResolvedValue(null);
      const result = await manager.getConversation('missing');
      expect(result).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // listConversations / deleteConversation
  // -------------------------------------------------------------------------
  describe('listConversations', () => {
    it('returns all conversations from the repository', async () => {
      const list = [makeConversation()];
      conversationRepository.findAll.mockResolvedValue(list);
      await expect(manager.listConversations()).resolves.toBe(list);
    });
  });

  describe('deleteConversation', () => {
    it('removes from cache and deletes from the repository', async () => {
      conversationRepository.count.mockResolvedValue(0);
      conversationRepository.create.mockResolvedValue(makeConversation({ conversationId: 'c1' }));
      conversationRepository.delete.mockResolvedValue(true);
      await manager.createConversation();

      const ok = await manager.deleteConversation('c1');

      expect(ok).toBe(true);
      expect(conversationRepository.delete).toHaveBeenCalledWith('c1');
      // After deletion the cache no longer holds it, so a get falls through to DB.
      conversationRepository.findById.mockResolvedValue(null);
      await manager.getConversation('c1');
      expect(conversationRepository.findById).toHaveBeenCalledWith('c1');
    });
  });

  // -------------------------------------------------------------------------
  // createTask / updateTaskStatus / getTask / listTasks
  // -------------------------------------------------------------------------
  describe('createTask', () => {
    it('creates a task, caches it, and notifies subscribers', async () => {
      const task = makeTask({ id: 'task-9' });
      taskRepository.create.mockResolvedValue(task);
      const events: unknown[] = [];
      manager.onTaskEvent((e) => events.push(e));

      const result = await manager.createTask('conv-1');

      expect(taskRepository.create).toHaveBeenCalledWith('conv-1');
      expect(result).toBe(task);
      expect(events).toHaveLength(1);
      // Cached: getTask should not hit the DB.
      const fetched = await manager.getTask('task-9');
      expect(fetched).toBe(task);
      expect(taskRepository.findById).not.toHaveBeenCalled();
    });
  });

  describe('updateTaskStatus', () => {
    it('updates status, caches, appends status message to history, and notifies', async () => {
      const statusMessage: A2AMessage = {
        messageId: 'm-1',
        role: 'agent',
        parts: [{ kind: 'text', text: 'done' }],
      };
      const updated = makeTask({ id: 'task-5', status: { state: 'working' }, history: [] });
      taskRepository.updateStatus.mockResolvedValue(updated);
      const events: unknown[] = [];
      manager.onTaskEvent((e) => events.push(e));

      await manager.updateTaskStatus('task-5', { state: 'working', message: statusMessage });

      expect(taskRepository.updateStatus).toHaveBeenCalledWith('task-5', {
        state: 'working',
        message: statusMessage,
      });
      expect(updated.history).toContainEqual(statusMessage);
      expect(events).toHaveLength(1);
    });

    it('does nothing when the task is not found', async () => {
      taskRepository.updateStatus.mockResolvedValue(null);
      const events: unknown[] = [];
      manager.onTaskEvent((e) => events.push(e));

      await manager.updateTaskStatus('missing', { state: 'completed' });

      expect(events).toHaveLength(0);
    });

    it('schedules cache eviction for terminal states', async () => {
      vi.useFakeTimers();
      const updated = makeTask({ id: 'task-term', status: { state: 'completed' } });
      taskRepository.updateStatus.mockResolvedValue(updated);

      await manager.updateTaskStatus('task-term', { state: 'completed' });

      // Still cached immediately after completion.
      expect(await manager.getTask('task-term')).toBe(updated);

      // After the eviction delay, the cache is cleared and the DB is queried.
      taskRepository.findById.mockResolvedValue(null);
      vi.advanceTimersByTime(60000);
      await manager.getTask('task-term');
      expect(taskRepository.findById).toHaveBeenCalledWith('task-term');
    });
  });

  describe('getTask', () => {
    it('loads from the database on cache miss', async () => {
      const task = makeTask({ id: 'task-db' });
      taskRepository.findById.mockResolvedValue(task);
      const result = await manager.getTask('task-db');
      expect(result).toBe(task);
    });

    it('returns undefined when not found', async () => {
      taskRepository.findById.mockResolvedValue(null);
      await expect(manager.getTask('nope')).resolves.toBeUndefined();
    });
  });

  describe('listTasks', () => {
    it('delegates to the repository', async () => {
      const list = [makeTask()];
      taskRepository.findAll.mockResolvedValue(list);
      await expect(manager.listTasks()).resolves.toBe(list);
    });
  });

  // -------------------------------------------------------------------------
  // onTaskEvent error isolation
  // -------------------------------------------------------------------------
  describe('onTaskEvent', () => {
    it('isolates subscriber errors and supports unsubscribe', async () => {
      const good = vi.fn();
      const bad = vi.fn(() => {
        throw new Error('boom');
      });
      const unsubscribe = manager.onTaskEvent(bad);
      manager.onTaskEvent(good);

      taskRepository.create.mockResolvedValue(makeTask());
      // The throwing callback must not break notification of others.
      await expect(manager.createTask('conv-1')).resolves.toBeDefined();
      expect(good).toHaveBeenCalledTimes(1);

      unsubscribe();
      good.mockClear();
      await manager.createTask('conv-1');
      // bad unsubscribed, good still registered.
      expect(good).toHaveBeenCalledTimes(1);
    });
  });

  // -------------------------------------------------------------------------
  // Agent registry
  // -------------------------------------------------------------------------
  describe('agent registry', () => {
    it('registerAgent upserts and caches', async () => {
      agentRepository.upsert.mockResolvedValue(makeAgent());
      const card = makeAgent({ name: 'Reg-1' });

      await manager.registerAgent(card);

      expect(agentRepository.upsert).toHaveBeenCalledWith(card);
      expect(manager.getAgent('Reg-1')).toBe(card);
    });

    it('unregisterAgent removes from cache and DB', async () => {
      agentRepository.upsert.mockResolvedValue(makeAgent());
      agentRepository.delete.mockResolvedValue(true);
      await manager.registerAgent(makeAgent({ name: 'Reg-2' }));

      const ok = await manager.unregisterAgent('Reg-2');

      expect(ok).toBe(true);
      expect(agentRepository.delete).toHaveBeenCalledWith('Reg-2');
      expect(manager.getAgent('Reg-2')).toBeUndefined();
    });

    it('getAgentAsync loads from DB on cache miss and caches', async () => {
      const agent = makeAgent({ name: 'Async-1' });
      agentRepository.findByName.mockResolvedValue(agent);

      const first = await manager.getAgentAsync('Async-1');
      const second = await manager.getAgentAsync('Async-1');

      expect(first).toBe(agent);
      expect(second).toBe(agent);
      expect(agentRepository.findByName).toHaveBeenCalledTimes(1);
    });

    it('getAgentAsync returns undefined when not found', async () => {
      agentRepository.findByName.mockResolvedValue(null);
      await expect(manager.getAgentAsync('missing')).resolves.toBeUndefined();
    });

    it('listAgentsAsync delegates to the repository', async () => {
      const list = [makeAgent()];
      agentRepository.findAll.mockResolvedValue(list);
      await expect(manager.listAgentsAsync()).resolves.toBe(list);
    });
  });

  // -------------------------------------------------------------------------
  // Events
  // -------------------------------------------------------------------------
  describe('events', () => {
    it('addEvent delegates to the repository', async () => {
      eventRepository.create.mockResolvedValue(undefined);
      const event = {
        id: 'e1',
        actor: 'user',
        content: { messageId: 'm', role: 'user' as const, parts: [] },
        timestamp: 1,
      };
      await manager.addEvent(event);
      expect(eventRepository.create).toHaveBeenCalledWith(event);
    });

    it('getEvents delegates to the repository', async () => {
      eventRepository.findAll.mockResolvedValue([]);
      await manager.getEvents();
      expect(eventRepository.findAll).toHaveBeenCalledTimes(1);
    });

    it('getEventsSince passes the timestamp through', async () => {
      eventRepository.findSince.mockResolvedValue([]);
      await manager.getEventsSince(1234);
      expect(eventRepository.findSince).toHaveBeenCalledWith(1234);
    });
  });

  // -------------------------------------------------------------------------
  // getMessages
  // -------------------------------------------------------------------------
  describe('getMessages', () => {
    it('returns cached messages without hitting the DB', async () => {
      conversationRepository.count.mockResolvedValue(0);
      const msg: A2AMessage = { messageId: 'm1', role: 'user', parts: [] };
      conversationRepository.create.mockResolvedValue(
        makeConversation({ conversationId: 'cm', messages: [msg] })
      );
      await manager.createConversation();

      const result = await manager.getMessages('cm');

      expect(result).toEqual([msg]);
      expect(conversationRepository.getMessages).not.toHaveBeenCalled();
    });

    it('loads from the DB when not cached', async () => {
      conversationRepository.getMessages.mockResolvedValue([]);
      await manager.getMessages('uncached');
      expect(conversationRepository.getMessages).toHaveBeenCalledWith('uncached');
    });
  });

  // -------------------------------------------------------------------------
  // processMessage
  // -------------------------------------------------------------------------
  describe('processMessage', () => {
    it('throws when the conversation does not exist', async () => {
      conversationRepository.findById.mockResolvedValue(null);
      await expect(manager.processMessage('missing', 'hi')).rejects.toThrow(
        'Conversation missing not found'
      );
    });

    it('persists the user message, creates a task, and records an event', async () => {
      const conv = makeConversation({ conversationId: 'pc', messages: [], taskIds: [] });
      conversationRepository.findById.mockResolvedValue(conv);
      conversationRepository.addMessage.mockResolvedValue({
        messageId: 'x',
        role: 'user',
        parts: [],
      });
      const task = makeTask({ id: 'pt', status: { state: 'submitted' } });
      taskRepository.create.mockResolvedValue(task);
      taskRepository.updateStatus.mockResolvedValue(task);
      eventRepository.create.mockResolvedValue(undefined);

      const result = await manager.processMessage('pc', 'hello');

      expect(result.messageId).toBeDefined();
      expect(result.task).toBe(task);
      expect(conversationRepository.addMessage).toHaveBeenCalledWith(
        'pc',
        expect.objectContaining({ role: 'user', parts: [{ kind: 'text', text: 'hello' }] })
      );
      expect(taskRepository.create).toHaveBeenCalledWith('pc');
      // New task id added to conversation.
      expect(conv.taskIds).toContain('pt');
      // The user event was recorded.
      expect(eventRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ actor: 'user' })
      );
    });
  });

  // -------------------------------------------------------------------------
  // getPendingMessages
  // -------------------------------------------------------------------------
  describe('getPendingMessages', () => {
    it('reports a default processing state when no task mapping exists', () => {
      // No messages processed yet -> empty list.
      expect(manager.getPendingMessages()).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // selectAgentForMessage (orchestration)
  // -------------------------------------------------------------------------
  describe('selectAgentForMessage', () => {
    it('returns null when no agents are available', async () => {
      const result = await manager.selectAgentForMessage('do something', []);
      expect(result).toBeNull();
    });

    it('returns the only agent when exactly one is connected', async () => {
      const agent = makeAgent({ name: 'Solo' });
      const result = await manager.selectAgentForMessage('anything', [agent]);
      expect(result).toBe(agent);
    });

    it('matches an agent referenced by name in the message', async () => {
      const atlas = makeAgent({ name: 'Simulated Robot: Atlas-G1' });
      const simbot = makeAgent({ name: 'SimBot-01' });
      const result = await manager.selectAgentForMessage('please ask atlas to move', [
        atlas,
        simbot,
      ]);
      expect(result).toBe(atlas);
    });

    it('falls back to keyword scoring for heavy-duty tasks', async () => {
      const heavy = makeAgent({
        name: 'Hauler',
        description: 'Heavy industrial robot, max payload: 50 kg',
      });
      const light = makeAgent({
        name: 'Picker',
        description: 'Light nimble robot for delicate work',
      });
      const result = await manager.selectAgentForMessage('move a heavy pallet', [light, heavy]);
      expect(result).toBe(heavy);
    });

    it('excludes agents whose payload is below the required weight', async () => {
      const small = makeAgent({
        name: 'Small',
        description: 'max payload: 5 kg light robot',
      });
      const big = makeAgent({
        name: 'Big',
        description: 'max payload: 100 kg robot',
      });
      const result = await manager.selectAgentForMessage('carry a 40 kg crate', [small, big]);
      expect(result).toBe(big);
    });

    it('uses the LLM path when OPENROUTER_API_KEY is set and falls back on failure', async () => {
      process.env.OPENROUTER_API_KEY = 'test-key';
      const fetchMock = vi
        .spyOn(globalThis, 'fetch')
        .mockRejectedValue(new Error('network'));
      const a = makeAgent({ name: 'A-bot', description: 'generic' });
      const b = makeAgent({ name: 'B-bot', description: 'generic' });

      const result = await manager.selectAgentForMessage('handle this generic task', [a, b]);

      expect(fetchMock).toHaveBeenCalled();
      // Falls back to keyword selection, which returns a valid agent.
      expect([a, b]).toContain(result);
      fetchMock.mockRestore();
    });

    it('treats an empty LLM answer as no answer, not as a match on every agent', async () => {
      // A reasoning model can spend its whole budget thinking and return ''.
      // Since '' is a substring of every name, the partial-match branch would
      // otherwise hand back the first agent and report it as a confident LLM
      // choice — so this must reach keyword scoring and report `keyword`.
      process.env.OPENROUTER_API_KEY = 'test-key';
      const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ choices: [{ message: { content: '<think>weighing' } }] }),
      } as unknown as Response);

      const picker = makeAgent({
        name: 'Picker',
        description: 'Light nimble robot for delicate work',
      });
      const hauler = makeAgent({
        name: 'Hauler',
        description: 'Heavy industrial robot, max payload: 50 kg',
      });

      const selection = await manager.selectAgentForMessageDetailed('move a heavy pallet', [
        picker,
        hauler,
      ]);

      expect(fetchMock).toHaveBeenCalled();
      expect(selection.method).toBe('keyword');
      expect(selection.modelId).toBeUndefined();
      // Keyword scoring, not "whichever agent was listed first".
      expect(selection.agent).toBe(hauler);
      fetchMock.mockRestore();
    });
  });

  // -------------------------------------------------------------------------
  // detectAgentFailure (private) — regression guards for the QA-sweep fixes
  // -------------------------------------------------------------------------
  describe('detectAgentFailure', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const detect = (state: string | undefined, text: string): string | null =>
      (manager as unknown as { detectAgentFailure: (s: string | undefined, t: string) => string | null })
        .detectAgentFailure(state, text);

    it('strips an existing "Task failed:" prefix so callers do not double it', () => {
      // The agent-executor already emits "Task failed: <msg>"; the message we
      // return must be the bare reason (callers re-add the prefix).
      expect(detect('failed', 'Task failed: gripper stalled')).toBe('gripper stalled');
    });

    it('returns a generic reason for an empty failed result', () => {
      expect(detect('failed', '')).toBe('Agent reported task failure.');
    });

    it('does NOT flag a completed task whose text merely mentions an error', () => {
      expect(detect('completed', 'Error: the door was already open, so I stopped')).toBeNull();
    });

    it('still sniffs a raw error payload when the remote gave no state (legacy)', () => {
      const raw = '{"error":{"message":"quota exceeded"}}';
      expect(detect(undefined, raw)).toBe('quota exceeded');
    });

    it('does not match a GoogleGenerativeAI mention mid-text', () => {
      expect(detect(undefined, 'The agent explained a GoogleGenerativeAIError to the user')).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // processOrchestratedMessage
  // -------------------------------------------------------------------------
  describe('processOrchestratedMessage', () => {
    beforeEach(() => {
      conversationRepository.addMessage.mockResolvedValue({
        messageId: 'x',
        role: 'user',
        parts: [],
      });
      eventRepository.create.mockResolvedValue(undefined);
    });

    it('throws when the conversation does not exist', async () => {
      conversationRepository.findById.mockResolvedValue(null);
      await expect(manager.processOrchestratedMessage('missing', 'hi')).rejects.toThrow(
        'Conversation missing not found'
      );
    });

    it('answers system questions directly without routing to a robot', async () => {
      const conv = makeConversation({ conversationId: 'oc', messages: [], taskIds: [] });
      conversationRepository.findById.mockResolvedValue(conv);
      listRobots.mockResolvedValue([
        {
          name: 'R1',
          model: 'so101',
          status: 'online',
          batteryLevel: 80,
        },
      ]);
      getConnectedAgents.mockReturnValue([makeAgent()]);

      const result = await manager.processOrchestratedMessage('oc', 'what robots are online?');

      // System question path returns only a messageId, no task.
      expect(result.task).toBeUndefined();
      expect(result.messageId).toBeDefined();
      // An orchestrator agent message was persisted.
      expect(conversationRepository.addMessage).toHaveBeenCalledWith(
        'oc',
        expect.objectContaining({ role: 'agent' })
      );
      // No remote dispatch happened.
      expect(axios.post).not.toHaveBeenCalled();
    });

    it('throws when no connected robots are available for a non-system message', async () => {
      const conv = makeConversation({ conversationId: 'oc2', messages: [], taskIds: [] });
      conversationRepository.findById.mockResolvedValue(conv);
      getConnectedAgents.mockReturnValue([]);
      taskRepository.create.mockResolvedValue(makeTask({ id: 'ot' }));
      taskRepository.updateStatus.mockResolvedValue(makeTask({ id: 'ot' }));

      await expect(
        manager.processOrchestratedMessage('oc2', 'pick up the box')
      ).rejects.toThrow('No connected robots available. Please ensure a robot agent is running.');
    });

    it('routes a task message to the selected connected agent', async () => {
      const conv = makeConversation({ conversationId: 'oc3', messages: [], taskIds: [] });
      conversationRepository.findById.mockResolvedValue(conv);
      const agent = makeAgent({ name: 'Router-Bot' });
      getConnectedAgents.mockReturnValue([agent]);
      const task = makeTask({ id: 'ot3', status: { state: 'submitted' } });
      taskRepository.create.mockResolvedValue(task);
      taskRepository.updateStatus.mockResolvedValue(task);
      // sendToRemoteAgentOrchestrated is fire-and-forget; stub axios so it resolves.
      axios.post.mockResolvedValue({ data: { result: { parts: [] } } } as never);

      const result = await manager.processOrchestratedMessage('oc3', 'do a task');

      expect(result.task).toBe(task);
      expect(result.messageId).toBeDefined();
      expect(conv.taskIds).toContain('ot3');
    });
  });
});
