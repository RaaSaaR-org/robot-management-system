/**
 * @file a2aStore.test.ts
 * @description Tests for the A2A Zustand store
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  useA2AStore,
  selectConversations,
  selectCurrentConversationId,
  selectCurrentConversation,
  selectTasks,
  selectRegisteredAgents,
  selectRobotAgentConfigs,
  selectIsLoading,
  selectError,
  selectWsConnected,
  selectConversationById,
  selectTaskById,
  selectRobotAgentConfig,
  selectActiveTasks,
  selectCompletedForms,
  selectFormResponses,
  selectPendingMessages,
  selectTasksAwaitingInput,
  selectChatMode,
} from '../a2aStore';
import type {
  A2AConversation,
  A2ATask,
  A2AAgentCard,
  A2AEvent,
  A2AMessage,
  A2ATaskEvent,
} from '../../types';

// Mock the api boundary the store imports
vi.mock('../../api', () => ({
  a2aApi: {
    createConversation: vi.fn(),
    listConversations: vi.fn(),
    deleteConversation: vi.fn(),
    sendMessage: vi.fn(),
    sendOrchestrated: vi.fn(),
    listMessages: vi.fn(),
    listTasks: vi.fn(),
    registerAgent: vi.fn(),
    unregisterAgent: vi.fn(),
    listAgents: vi.fn(),
    getRobotAgentCard: vi.fn(),
    getEvents: vi.fn(),
  },
}));

import { a2aApi } from '../../api';

const mockedApi = vi.mocked(a2aApi);

// -- Factories ---------------------------------------------------------------

const makeConversation = (
  overrides: Partial<A2AConversation> = {}
): A2AConversation => ({
  conversationId: 'conv-1',
  name: 'Conversation 1',
  isActive: true,
  taskIds: [],
  messages: [],
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
  ...overrides,
});

const makeTask = (overrides: Partial<A2ATask> = {}): A2ATask => ({
  id: 'task-1',
  status: { state: 'working' },
  ...overrides,
});

const makeAgentCard = (overrides: Partial<A2AAgentCard> = {}): A2AAgentCard => ({
  name: 'Agent A',
  description: 'desc',
  url: 'http://agent-a',
  ...overrides,
});

const makeMessage = (overrides: Partial<A2AMessage> = {}): A2AMessage => ({
  messageId: 'msg-1',
  role: 'agent',
  parts: [{ kind: 'text', text: 'hi' }],
  ...overrides,
});

const makeEvent = (overrides: Partial<A2AEvent> = {}): A2AEvent => ({
  id: 'evt-1',
  actor: 'user',
  content: makeMessage(),
  timestamp: 1,
  ...overrides,
});

const resetStore = () =>
  useA2AStore.setState({
    conversations: [],
    currentConversationId: null,
    tasks: [],
    events: [],
    registeredAgents: [],
    robotAgentConfigs: {},
    pendingMessages: {},
    completedForms: {},
    formResponses: {},
    isLoading: false,
    error: null,
    wsConnected: false,
    chatMode: 'direct',
  });

describe('a2aStore', () => {
  beforeEach(() => {
    resetStore();
    vi.clearAllMocks();
  });

  it('starts with initial state', () => {
    const s = useA2AStore.getState();
    expect(s.conversations).toEqual([]);
    expect(s.currentConversationId).toBeNull();
    expect(s.tasks).toEqual([]);
    expect(s.events).toEqual([]);
    expect(s.registeredAgents).toEqual([]);
    expect(s.robotAgentConfigs).toEqual({});
    expect(s.pendingMessages).toEqual({});
    expect(s.completedForms).toEqual({});
    expect(s.formResponses).toEqual({});
    expect(s.isLoading).toBe(false);
    expect(s.error).toBeNull();
    expect(s.wsConnected).toBe(false);
    expect(s.chatMode).toBe('direct');
  });

  // -- Conversations ---------------------------------------------------------

  describe('createConversation', () => {
    it('prepends conversation, selects it, returns it on success', async () => {
      const existing = makeConversation({ conversationId: 'old' });
      useA2AStore.setState({ conversations: [existing] });
      const created = makeConversation({ conversationId: 'new' });
      mockedApi.createConversation.mockResolvedValue(created);

      const result = await useA2AStore
        .getState()
        .createConversation('robot-1', 'My Convo');

      expect(result).toEqual(created);
      expect(mockedApi.createConversation).toHaveBeenCalledWith({
        robotId: 'robot-1',
        name: 'My Convo',
      });
      const s = useA2AStore.getState();
      expect(s.conversations[0].conversationId).toBe('new');
      expect(s.conversations[1].conversationId).toBe('old');
      expect(s.currentConversationId).toBe('new');
      expect(s.isLoading).toBe(false);
      expect(s.error).toBeNull();
    });

    it('sets error and rethrows on failure', async () => {
      mockedApi.createConversation.mockRejectedValue(new Error('create fail'));

      await expect(
        useA2AStore.getState().createConversation()
      ).rejects.toThrow('create fail');

      const s = useA2AStore.getState();
      expect(s.error).toBe('create fail');
      expect(s.isLoading).toBe(false);
      expect(s.conversations).toEqual([]);
    });
  });

  describe('fetchConversations', () => {
    it('replaces conversations on success', async () => {
      const list = [makeConversation({ conversationId: 'a' })];
      mockedApi.listConversations.mockResolvedValue(list);

      await useA2AStore.getState().fetchConversations();

      const s = useA2AStore.getState();
      expect(s.conversations).toEqual(list);
      expect(s.isLoading).toBe(false);
    });

    it('sets error on failure without throwing', async () => {
      mockedApi.listConversations.mockRejectedValue(new Error('list fail'));

      await expect(
        useA2AStore.getState().fetchConversations()
      ).resolves.toBeUndefined();

      const s = useA2AStore.getState();
      expect(s.error).toBe('list fail');
      expect(s.isLoading).toBe(false);
    });
  });

  describe('selectConversation', () => {
    it('sets the current conversation id', () => {
      useA2AStore.getState().selectConversation('conv-9');
      expect(useA2AStore.getState().currentConversationId).toBe('conv-9');
      useA2AStore.getState().selectConversation(null);
      expect(useA2AStore.getState().currentConversationId).toBeNull();
    });
  });

  describe('deleteConversation', () => {
    it('removes conversation and clears current if it matched', async () => {
      useA2AStore.setState({
        conversations: [
          makeConversation({ conversationId: 'c1' }),
          makeConversation({ conversationId: 'c2' }),
        ],
        currentConversationId: 'c1',
      });
      mockedApi.deleteConversation.mockResolvedValue(undefined);

      await useA2AStore.getState().deleteConversation('c1');

      const s = useA2AStore.getState();
      expect(s.conversations.map((c) => c.conversationId)).toEqual(['c2']);
      expect(s.currentConversationId).toBeNull();
    });

    it('keeps current id when deleting a different conversation', async () => {
      useA2AStore.setState({
        conversations: [
          makeConversation({ conversationId: 'c1' }),
          makeConversation({ conversationId: 'c2' }),
        ],
        currentConversationId: 'c2',
      });
      mockedApi.deleteConversation.mockResolvedValue(undefined);

      await useA2AStore.getState().deleteConversation('c1');

      expect(useA2AStore.getState().currentConversationId).toBe('c2');
    });

    it('sets error and rethrows on failure', async () => {
      useA2AStore.setState({
        conversations: [makeConversation({ conversationId: 'c1' })],
      });
      mockedApi.deleteConversation.mockRejectedValue(new Error('del fail'));

      await expect(
        useA2AStore.getState().deleteConversation('c1')
      ).rejects.toThrow('del fail');

      const s = useA2AStore.getState();
      expect(s.error).toBe('del fail');
      expect(s.conversations).toHaveLength(1);
    });
  });

  // -- Messages --------------------------------------------------------------

  describe('sendMessage', () => {
    it('direct mode sends via sendMessage and refreshes conversation', async () => {
      useA2AStore.setState({
        conversations: [makeConversation({ conversationId: 'c1' })],
        chatMode: 'direct',
      });
      mockedApi.sendMessage.mockResolvedValue({
        messageId: 'm1',
        contextId: 'ctx',
      });
      const messages = [makeMessage({ messageId: 'srv-1' })];
      mockedApi.listMessages.mockResolvedValue(messages);

      const resp = await useA2AStore
        .getState()
        .sendMessage({ conversationId: 'c1', message: 'hello' });

      expect(resp.messageId).toBe('m1');
      expect(mockedApi.sendMessage).toHaveBeenCalled();
      expect(mockedApi.sendOrchestrated).not.toHaveBeenCalled();

      const s = useA2AStore.getState();
      expect(s.pendingMessages['m1']).toBe('sent');
      expect(s.conversations[0].messages).toEqual(messages);
    });

    it('orchestration mode (no target) uses sendOrchestrated', async () => {
      useA2AStore.setState({
        conversations: [makeConversation({ conversationId: 'c1' })],
        chatMode: 'orchestration',
      });
      mockedApi.sendOrchestrated.mockResolvedValue({
        messageId: 'm2',
        contextId: 'ctx',
      });
      mockedApi.listMessages.mockResolvedValue([]);

      await useA2AStore
        .getState()
        .sendMessage({ conversationId: 'c1', message: 'route this' });

      expect(mockedApi.sendOrchestrated).toHaveBeenCalledWith({
        conversationId: 'c1',
        message: 'route this',
      });
      expect(mockedApi.sendMessage).not.toHaveBeenCalled();
    });

    it('orchestration mode with targetAgentUrl falls back to direct send', async () => {
      useA2AStore.setState({
        conversations: [makeConversation({ conversationId: 'c1' })],
        chatMode: 'orchestration',
      });
      mockedApi.sendMessage.mockResolvedValue({
        messageId: 'm3',
        contextId: 'ctx',
      });
      mockedApi.listMessages.mockResolvedValue([]);

      await useA2AStore.getState().sendMessage({
        conversationId: 'c1',
        message: 'direct',
        targetAgentUrl: 'http://agent',
      });

      expect(mockedApi.sendMessage).toHaveBeenCalled();
      expect(mockedApi.sendOrchestrated).not.toHaveBeenCalled();
    });

    it('sets error and rethrows on failure', async () => {
      mockedApi.sendMessage.mockRejectedValue(new Error('send fail'));

      await expect(
        useA2AStore
          .getState()
          .sendMessage({ conversationId: 'c1', message: 'x' })
      ).rejects.toThrow('send fail');

      expect(useA2AStore.getState().error).toBe('send fail');
    });
  });

  describe('fetchMessages', () => {
    it('updates messages of matching conversation', async () => {
      useA2AStore.setState({
        conversations: [makeConversation({ conversationId: 'c1' })],
      });
      const messages = [makeMessage()];
      mockedApi.listMessages.mockResolvedValue(messages);

      await useA2AStore.getState().fetchMessages('c1');

      expect(useA2AStore.getState().conversations[0].messages).toEqual(messages);
    });

    it('sets error on failure', async () => {
      mockedApi.listMessages.mockRejectedValue(new Error('msg fail'));
      await useA2AStore.getState().fetchMessages('c1');
      expect(useA2AStore.getState().error).toBe('msg fail');
    });
  });

  // -- Tasks -----------------------------------------------------------------

  describe('fetchTasks', () => {
    it('sets tasks on success', async () => {
      const tasks = [makeTask()];
      mockedApi.listTasks.mockResolvedValue(tasks);
      await useA2AStore.getState().fetchTasks();
      expect(useA2AStore.getState().tasks).toEqual(tasks);
    });

    it('sets error on failure', async () => {
      mockedApi.listTasks.mockRejectedValue(new Error('task fail'));
      await useA2AStore.getState().fetchTasks();
      expect(useA2AStore.getState().error).toBe('task fail');
    });
  });

  describe('updateTask', () => {
    it('replaces existing task by id', () => {
      useA2AStore.setState({ tasks: [makeTask({ id: 't1' })] });
      const updated = makeTask({ id: 't1', status: { state: 'completed' } });
      useA2AStore.getState().updateTask(updated);
      const s = useA2AStore.getState();
      expect(s.tasks).toHaveLength(1);
      expect(s.tasks[0].status.state).toBe('completed');
    });

    it('prepends a new task when id not found', () => {
      useA2AStore.setState({ tasks: [makeTask({ id: 't1' })] });
      useA2AStore.getState().updateTask(makeTask({ id: 't2' }));
      const ids = useA2AStore.getState().tasks.map((t) => t.id);
      expect(ids).toEqual(['t2', 't1']);
    });
  });

  describe('getTask', () => {
    it('returns matching task or undefined', () => {
      useA2AStore.setState({ tasks: [makeTask({ id: 't1' })] });
      expect(useA2AStore.getState().getTask('t1')?.id).toBe('t1');
      expect(useA2AStore.getState().getTask('nope')).toBeUndefined();
    });
  });

  // -- Agents ----------------------------------------------------------------

  describe('registerAgent', () => {
    it('adds a new agent on success', async () => {
      const card = makeAgentCard({ name: 'New Agent' });
      mockedApi.registerAgent.mockResolvedValue(card);

      const result = await useA2AStore.getState().registerAgent('http://x');

      expect(result).toEqual(card);
      const s = useA2AStore.getState();
      expect(s.registeredAgents).toHaveLength(1);
      expect(s.registeredAgents[0].name).toBe('New Agent');
      expect(s.isLoading).toBe(false);
    });

    it('replaces an existing agent with same name', async () => {
      useA2AStore.setState({
        registeredAgents: [makeAgentCard({ name: 'Dup', url: 'http://old' })],
      });
      const card = makeAgentCard({ name: 'Dup', url: 'http://new' });
      mockedApi.registerAgent.mockResolvedValue(card);

      await useA2AStore.getState().registerAgent('http://new');

      const s = useA2AStore.getState();
      expect(s.registeredAgents).toHaveLength(1);
      expect(s.registeredAgents[0].url).toBe('http://new');
    });

    it('sets error and rethrows on failure', async () => {
      mockedApi.registerAgent.mockRejectedValue(new Error('reg fail'));
      await expect(
        useA2AStore.getState().registerAgent('http://x')
      ).rejects.toThrow('reg fail');
      const s = useA2AStore.getState();
      expect(s.error).toBe('reg fail');
      expect(s.isLoading).toBe(false);
    });
  });

  describe('unregisterAgent', () => {
    it('removes the agent on success', async () => {
      useA2AStore.setState({
        registeredAgents: [
          makeAgentCard({ name: 'A' }),
          makeAgentCard({ name: 'B' }),
        ],
      });
      mockedApi.unregisterAgent.mockResolvedValue(undefined);

      await useA2AStore.getState().unregisterAgent('A');

      expect(useA2AStore.getState().registeredAgents.map((a) => a.name)).toEqual([
        'B',
      ]);
    });

    it('sets error and rethrows on failure', async () => {
      useA2AStore.setState({ registeredAgents: [makeAgentCard({ name: 'A' })] });
      mockedApi.unregisterAgent.mockRejectedValue(new Error('unreg fail'));
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      await expect(
        useA2AStore.getState().unregisterAgent('A')
      ).rejects.toThrow('unreg fail');

      expect(useA2AStore.getState().error).toBe('unreg fail');
      expect(useA2AStore.getState().registeredAgents).toHaveLength(1);
      errSpy.mockRestore();
    });
  });

  describe('fetchAgents', () => {
    it('sets agents on success', async () => {
      const agents = [makeAgentCard()];
      mockedApi.listAgents.mockResolvedValue(agents);
      await useA2AStore.getState().fetchAgents();
      expect(useA2AStore.getState().registeredAgents).toEqual(agents);
    });

    it('sets error on failure', async () => {
      mockedApi.listAgents.mockRejectedValue(new Error('agents fail'));
      await useA2AStore.getState().fetchAgents();
      expect(useA2AStore.getState().error).toBe('agents fail');
    });
  });

  // -- Robot Agent Config ----------------------------------------------------

  describe('enableRobotAgent', () => {
    it('stores an enabled config on success', async () => {
      const card = makeAgentCard();
      mockedApi.getRobotAgentCard.mockResolvedValue(card);

      await useA2AStore.getState().enableRobotAgent('robot-1');

      const cfg = useA2AStore.getState().robotAgentConfigs['robot-1'];
      expect(cfg.isEnabled).toBe(true);
      expect(cfg.agentCard).toEqual(card);
      expect(cfg.connectedAgents).toEqual([]);
    });

    it('sets error and rethrows on failure', async () => {
      mockedApi.getRobotAgentCard.mockRejectedValue(new Error('enable fail'));
      await expect(
        useA2AStore.getState().enableRobotAgent('robot-1')
      ).rejects.toThrow('enable fail');
      expect(useA2AStore.getState().error).toBe('enable fail');
    });
  });

  describe('disableRobotAgent', () => {
    it('sets isEnabled false when config exists', async () => {
      useA2AStore.setState({
        robotAgentConfigs: {
          'robot-1': {
            robotId: 'robot-1',
            agentCard: makeAgentCard(),
            isEnabled: true,
            connectedAgents: [],
          },
        },
      });

      await useA2AStore.getState().disableRobotAgent('robot-1');

      expect(useA2AStore.getState().robotAgentConfigs['robot-1'].isEnabled).toBe(
        false
      );
    });

    it('is a no-op when config does not exist', async () => {
      await useA2AStore.getState().disableRobotAgent('missing');
      expect(useA2AStore.getState().robotAgentConfigs['missing']).toBeUndefined();
    });
  });

  describe('updateRobotAgentConfig', () => {
    it('merges into an existing config', () => {
      useA2AStore.setState({
        robotAgentConfigs: {
          'robot-1': {
            robotId: 'robot-1',
            agentCard: makeAgentCard(),
            isEnabled: false,
            connectedAgents: [],
          },
        },
      });

      useA2AStore.getState().updateRobotAgentConfig({
        robotId: 'robot-1',
        connectedAgents: ['x'],
      });

      const cfg = useA2AStore.getState().robotAgentConfigs['robot-1'];
      expect(cfg.connectedAgents).toEqual(['x']);
      expect(cfg.isEnabled).toBe(false);
    });

    it('does nothing when config is absent', () => {
      useA2AStore.getState().updateRobotAgentConfig({ robotId: 'nope' });
      expect(useA2AStore.getState().robotAgentConfigs['nope']).toBeUndefined();
    });
  });

  describe('fetchRobotAgentConfig', () => {
    it('returns cached config without calling the api', async () => {
      const cfg = {
        robotId: 'robot-1',
        agentCard: makeAgentCard(),
        isEnabled: true,
        connectedAgents: [],
      };
      useA2AStore.setState({ robotAgentConfigs: { 'robot-1': cfg } });

      const result = await useA2AStore
        .getState()
        .fetchRobotAgentConfig('robot-1');

      expect(result).toEqual(cfg);
      expect(mockedApi.getRobotAgentCard).not.toHaveBeenCalled();
    });

    it('fetches, stores (disabled) and returns config on success', async () => {
      const card = makeAgentCard();
      mockedApi.getRobotAgentCard.mockResolvedValue(card);

      const result = await useA2AStore
        .getState()
        .fetchRobotAgentConfig('robot-2');

      expect(result?.isEnabled).toBe(false);
      expect(result?.agentCard).toEqual(card);
      expect(useA2AStore.getState().robotAgentConfigs['robot-2']).toEqual(result);
    });

    it('returns null on failure without setting error', async () => {
      mockedApi.getRobotAgentCard.mockRejectedValue(new Error('fail'));

      const result = await useA2AStore
        .getState()
        .fetchRobotAgentConfig('robot-3');

      expect(result).toBeNull();
      expect(useA2AStore.getState().error).toBeNull();
    });
  });

  // -- Events ----------------------------------------------------------------

  describe('addEvent', () => {
    it('prepends an event', () => {
      useA2AStore.setState({ events: [makeEvent({ id: 'old' })] });
      useA2AStore.getState().addEvent(makeEvent({ id: 'new' }));
      expect(useA2AStore.getState().events.map((e) => e.id)).toEqual([
        'new',
        'old',
      ]);
    });

    it('caps the events list at 100', () => {
      const existing = Array.from({ length: 100 }, (_, i) =>
        makeEvent({ id: `e${i}` })
      );
      useA2AStore.setState({ events: existing });

      useA2AStore.getState().addEvent(makeEvent({ id: 'newest' }));

      const events = useA2AStore.getState().events;
      expect(events).toHaveLength(100);
      expect(events[0].id).toBe('newest');
      expect(events[99].id).toBe('e98');
    });
  });

  describe('fetchEvents', () => {
    it('sets events on success', async () => {
      const events = [makeEvent()];
      mockedApi.getEvents.mockResolvedValue(events);
      await useA2AStore.getState().fetchEvents();
      expect(useA2AStore.getState().events).toEqual(events);
    });

    it('sets error on failure', async () => {
      mockedApi.getEvents.mockRejectedValue(new Error('events fail'));
      await useA2AStore.getState().fetchEvents();
      expect(useA2AStore.getState().error).toBe('events fail');
    });
  });

  // -- WebSocket -------------------------------------------------------------

  describe('setWsConnected', () => {
    it('toggles connection flag', () => {
      useA2AStore.getState().setWsConnected(true);
      expect(useA2AStore.getState().wsConnected).toBe(true);
      useA2AStore.getState().setWsConnected(false);
      expect(useA2AStore.getState().wsConnected).toBe(false);
    });
  });

  describe('handleTaskEvent', () => {
    it('applies status_update to a matching task', () => {
      useA2AStore.setState({ tasks: [makeTask({ id: 't1' })] });
      const event: A2ATaskEvent = {
        type: 'status_update',
        taskId: 't1',
        status: { state: 'completed' },
      };

      useA2AStore.getState().handleTaskEvent(event);

      const task = useA2AStore.getState().tasks[0];
      expect(task.status).toEqual({ state: 'completed' });
      expect(task.updatedAt).toBeDefined();
    });

    it('appends a new artifact on artifact_update', () => {
      useA2AStore.setState({ tasks: [makeTask({ id: 't1' })] });
      const event: A2ATaskEvent = {
        type: 'artifact_update',
        taskId: 't1',
        artifact: { artifactId: 'a1', parts: [] },
      };

      useA2AStore.getState().handleTaskEvent(event);

      expect(useA2AStore.getState().tasks[0].artifacts).toEqual([
        { artifactId: 'a1', parts: [] },
      ]);
    });

    it('replaces an existing artifact when append=true and id matches', () => {
      useA2AStore.setState({
        tasks: [
          makeTask({
            id: 't1',
            artifacts: [{ artifactId: 'a1', parts: [], name: 'old' }],
          }),
        ],
      });
      const event: A2ATaskEvent = {
        type: 'artifact_update',
        taskId: 't1',
        append: true,
        artifact: { artifactId: 'a1', parts: [], name: 'new' },
      };

      useA2AStore.getState().handleTaskEvent(event);

      const artifacts = useA2AStore.getState().tasks[0].artifacts!;
      expect(artifacts).toHaveLength(1);
      expect(artifacts[0].name).toBe('new');
    });

    it('does nothing when the task is not found', () => {
      useA2AStore.setState({ tasks: [makeTask({ id: 't1' })] });
      const event: A2ATaskEvent = {
        type: 'status_update',
        taskId: 'missing',
        status: { state: 'failed' },
      };

      useA2AStore.getState().handleTaskEvent(event);

      expect(useA2AStore.getState().tasks[0].status.state).toBe('working');
    });
  });

  // -- Forms -----------------------------------------------------------------

  describe('submitFormResponse', () => {
    it('throws when there is no active conversation', async () => {
      await expect(
        useA2AStore.getState().submitFormResponse('m1', 't1', { a: 'b' })
      ).rejects.toThrow('No active conversation');
    });

    it('stores form data, sends message and refreshes on success', async () => {
      useA2AStore.setState({
        conversations: [makeConversation({ conversationId: 'c1' })],
        currentConversationId: 'c1',
      });
      mockedApi.sendMessage.mockResolvedValue({
        messageId: 'srv',
        contextId: 'ctx',
      });
      const messages = [makeMessage()];
      mockedApi.listMessages.mockResolvedValue(messages);

      await useA2AStore
        .getState()
        .submitFormResponse('form-msg', 'task-1', { field: 'value' });

      const s = useA2AStore.getState();
      expect(s.completedForms['form-msg']).toEqual({ field: 'value' });
      expect(s.conversations[0].messages).toEqual(messages);
      expect(mockedApi.sendMessage).toHaveBeenCalledWith({
        conversationId: 'c1',
        message: JSON.stringify({
          type: 'form_response',
          taskId: 'task-1',
          data: { field: 'value' },
        }),
      });
    });

    it('sets error and rethrows on send failure', async () => {
      useA2AStore.setState({ currentConversationId: 'c1' });
      mockedApi.sendMessage.mockRejectedValue(new Error('form fail'));

      await expect(
        useA2AStore.getState().submitFormResponse('form-msg', 't1', { a: 'b' })
      ).rejects.toThrow('form fail');

      expect(useA2AStore.getState().error).toBe('form fail');
      // form data was still recorded before the send attempt
      expect(useA2AStore.getState().completedForms['form-msg']).toEqual({
        a: 'b',
      });
    });
  });

  describe('cancelForm', () => {
    it('throws when there is no active conversation', async () => {
      await expect(
        useA2AStore.getState().cancelForm('m1', 't1')
      ).rejects.toThrow('No active conversation');
    });

    it('marks form canceled (null) and sends rejection on success', async () => {
      useA2AStore.setState({
        conversations: [makeConversation({ conversationId: 'c1' })],
        currentConversationId: 'c1',
      });
      mockedApi.sendMessage.mockResolvedValue({
        messageId: 'srv',
        contextId: 'ctx',
      });
      mockedApi.listMessages.mockResolvedValue([]);

      await useA2AStore.getState().cancelForm('form-msg', 'task-1');

      expect(useA2AStore.getState().completedForms['form-msg']).toBeNull();
      expect(mockedApi.sendMessage).toHaveBeenCalledWith({
        conversationId: 'c1',
        message: 'rejected form entry',
      });
    });

    it('sets error and rethrows on failure', async () => {
      useA2AStore.setState({ currentConversationId: 'c1' });
      mockedApi.sendMessage.mockRejectedValue(new Error('cancel fail'));

      await expect(
        useA2AStore.getState().cancelForm('form-msg', 't1')
      ).rejects.toThrow('cancel fail');

      expect(useA2AStore.getState().error).toBe('cancel fail');
    });
  });

  describe('isFormCompleted / getFormData', () => {
    it('reports completion and returns stored data', () => {
      useA2AStore.setState({
        completedForms: { done: { a: 'b' }, canceled: null },
      });
      const s = useA2AStore.getState();
      expect(s.isFormCompleted('done')).toBe(true);
      expect(s.isFormCompleted('canceled')).toBe(true);
      expect(s.isFormCompleted('unknown')).toBe(false);
      expect(s.getFormData('done')).toEqual({ a: 'b' });
      expect(s.getFormData('canceled')).toBeNull();
      expect(s.getFormData('unknown')).toBeUndefined();
    });
  });

  // -- Chat mode & utility ---------------------------------------------------

  describe('setChatMode', () => {
    it('updates the chat mode', () => {
      useA2AStore.getState().setChatMode('orchestration');
      expect(useA2AStore.getState().chatMode).toBe('orchestration');
    });
  });

  describe('clearError / reset', () => {
    it('clearError nulls the error only', () => {
      useA2AStore.setState({ error: 'boom', wsConnected: true });
      useA2AStore.getState().clearError();
      expect(useA2AStore.getState().error).toBeNull();
      expect(useA2AStore.getState().wsConnected).toBe(true);
    });

    it('reset restores initial state', () => {
      useA2AStore.setState({
        conversations: [makeConversation()],
        currentConversationId: 'c1',
        tasks: [makeTask()],
        error: 'err',
        wsConnected: true,
        chatMode: 'orchestration',
      });

      useA2AStore.getState().reset();

      const s = useA2AStore.getState();
      expect(s.conversations).toEqual([]);
      expect(s.currentConversationId).toBeNull();
      expect(s.tasks).toEqual([]);
      expect(s.error).toBeNull();
      expect(s.wsConnected).toBe(false);
      expect(s.chatMode).toBe('direct');
    });
  });

  // -- Selectors -------------------------------------------------------------

  describe('selectors', () => {
    it('basic selectors return state slices', () => {
      const conv = makeConversation({ conversationId: 'c1' });
      const task = makeTask();
      const agent = makeAgentCard();
      useA2AStore.setState({
        conversations: [conv],
        currentConversationId: 'c1',
        tasks: [task],
        registeredAgents: [agent],
        robotAgentConfigs: { r: { robotId: 'r', agentCard: agent, isEnabled: true, connectedAgents: [] } },
        isLoading: true,
        error: 'e',
        wsConnected: true,
        chatMode: 'orchestration',
        completedForms: { f: { a: 'b' } },
        formResponses: { fr: 'f' },
        pendingMessages: { p: 'sent' },
      });
      const s = useA2AStore.getState();

      expect(selectConversations(s)).toEqual([conv]);
      expect(selectCurrentConversationId(s)).toBe('c1');
      expect(selectCurrentConversation(s)).toEqual(conv);
      expect(selectTasks(s)).toEqual([task]);
      expect(selectRegisteredAgents(s)).toEqual([agent]);
      expect(selectRobotAgentConfigs(s).r.isEnabled).toBe(true);
      expect(selectIsLoading(s)).toBe(true);
      expect(selectError(s)).toBe('e');
      expect(selectWsConnected(s)).toBe(true);
      expect(selectChatMode(s)).toBe('orchestration');
      expect(selectCompletedForms(s)).toEqual({ f: { a: 'b' } });
      expect(selectFormResponses(s)).toEqual({ fr: 'f' });
      expect(selectPendingMessages(s)).toEqual({ p: 'sent' });
    });

    it('parameterized selectors find by id', () => {
      const conv = makeConversation({ conversationId: 'c1' });
      const task = makeTask({ id: 't1' });
      const agent = makeAgentCard();
      useA2AStore.setState({
        conversations: [conv],
        tasks: [task],
        robotAgentConfigs: { r: { robotId: 'r', agentCard: agent, isEnabled: false, connectedAgents: [] } },
      });
      const s = useA2AStore.getState();

      expect(selectConversationById('c1')(s)).toEqual(conv);
      expect(selectConversationById('nope')(s)).toBeUndefined();
      expect(selectTaskById('t1')(s)).toEqual(task);
      expect(selectRobotAgentConfig('r')(s)?.robotId).toBe('r');
    });

    it('selectActiveTasks excludes terminal states', () => {
      useA2AStore.setState({
        tasks: [
          makeTask({ id: 'a', status: { state: 'working' } }),
          makeTask({ id: 'b', status: { state: 'completed' } }),
          makeTask({ id: 'c', status: { state: 'failed' } }),
          makeTask({ id: 'd', status: { state: 'input_required' } }),
        ],
      });
      const result = selectActiveTasks(useA2AStore.getState());
      expect(result.map((t) => t.id)).toEqual(['a', 'd']);
    });

    it('selectTasksAwaitingInput returns only input_required tasks', () => {
      useA2AStore.setState({
        tasks: [
          makeTask({ id: 'a', status: { state: 'working' } }),
          makeTask({ id: 'b', status: { state: 'input_required' } }),
        ],
      });
      const result = selectTasksAwaitingInput(useA2AStore.getState());
      expect(result.map((t) => t.id)).toEqual(['b']);
    });
  });
});
