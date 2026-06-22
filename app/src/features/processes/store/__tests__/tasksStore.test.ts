/**
 * @file tasksStore.test.ts
 * @description Tests for the processes (tasks) Zustand store
 * @feature processes
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  useTasksStore,
  selectTasks,
  selectSelectedTaskId,
  selectTaskDetail,
  selectFilters,
  selectPagination,
  selectIsLoading,
  selectIsExecuting,
  selectError,
  selectTaskById,
  selectTasksByStatus,
  selectTasksByRobotId,
  selectActiveTasks,
  selectPendingTasks,
  selectInProgressTasks,
  selectSelectedTask,
} from '../tasksStore';
import type { Process as Task, ProcessStatus } from '../../types';

// Mock the feature api module the store imports
vi.mock('../../api/tasksApi', () => ({
  tasksApi: {
    listTasks: vi.fn(),
    getTask: vi.fn(),
    createTask: vi.fn(),
    pauseTask: vi.fn(),
    resumeTask: vi.fn(),
    cancelTask: vi.fn(),
    retryTask: vi.fn(),
  },
}));

import { tasksApi } from '../../api/tasksApi';

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 't1',
    name: 'Task 1',
    robotId: 'robot-1',
    status: 'pending',
    priority: 'normal',
    steps: [],
    progress: 0,
    currentStepIndex: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

const INITIAL_STATE = {
  tasks: [] as Task[],
  selectedTaskId: null as string | null,
  filters: {},
  pagination: { page: 1, pageSize: 12, total: 0, totalPages: 0 },
  isLoading: false,
  isExecuting: false,
  error: null as string | null,
  taskDetail: null as Task | null,
};

function resetStore() {
  useTasksStore.setState({ ...INITIAL_STATE, filters: {}, pagination: { ...INITIAL_STATE.pagination } });
}

describe('tasksStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStore();
  });

  it('starts with initial state', () => {
    const state = useTasksStore.getState();
    expect(state.tasks).toEqual([]);
    expect(state.selectedTaskId).toBeNull();
    expect(state.filters).toEqual({});
    expect(state.pagination).toEqual({ page: 1, pageSize: 12, total: 0, totalPages: 0 });
    expect(state.isLoading).toBe(false);
    expect(state.isExecuting).toBe(false);
    expect(state.error).toBeNull();
    expect(state.taskDetail).toBeNull();
  });

  // --- fetchTasks ---

  it('fetchTasks loads tasks and pagination, passing filters + paging', async () => {
    const tasks = [makeTask({ id: 'a' }), makeTask({ id: 'b' })];
    const pagination = { page: 2, pageSize: 12, total: 2, totalPages: 1 };
    vi.mocked(tasksApi.listTasks).mockResolvedValue({ tasks, pagination });

    useTasksStore.setState({ filters: { status: 'pending' }, pagination: { ...INITIAL_STATE.pagination, page: 2 } });

    await useTasksStore.getState().fetchTasks();

    const state = useTasksStore.getState();
    expect(state.tasks).toEqual(tasks);
    expect(state.pagination).toEqual(pagination);
    expect(state.isLoading).toBe(false);
    expect(tasksApi.listTasks).toHaveBeenCalledWith({
      status: 'pending',
      page: 2,
      pageSize: 12,
    });
  });

  it('fetchTasks maps API error code to friendly message', async () => {
    vi.mocked(tasksApi.listTasks).mockRejectedValue({ code: 'NETWORK_ERROR' });

    await useTasksStore.getState().fetchTasks();

    const state = useTasksStore.getState();
    expect(state.error).toBe('Unable to connect to the server');
    expect(state.isLoading).toBe(false);
  });

  it('fetchTasks falls back to unknown error for unrecognized error', async () => {
    vi.mocked(tasksApi.listTasks).mockRejectedValue(42);

    await useTasksStore.getState().fetchTasks();

    expect(useTasksStore.getState().error).toBe('An unexpected error occurred');
  });

  // --- fetchTask ---

  it('fetchTask sets detail and updates matching list entry', async () => {
    const stale = makeTask({ id: 'a', name: 'old' });
    useTasksStore.setState({ tasks: [stale] });
    const fresh = makeTask({ id: 'a', name: 'fresh' });
    vi.mocked(tasksApi.getTask).mockResolvedValue(fresh);

    await useTasksStore.getState().fetchTask('a');

    const state = useTasksStore.getState();
    expect(state.taskDetail).toEqual(fresh);
    expect(state.tasks[0]).toEqual(fresh);
    expect(state.isLoading).toBe(false);
  });

  it('fetchTask sets detail without touching list when not present', async () => {
    const fresh = makeTask({ id: 'z' });
    vi.mocked(tasksApi.getTask).mockResolvedValue(fresh);

    await useTasksStore.getState().fetchTask('z');

    expect(useTasksStore.getState().taskDetail).toEqual(fresh);
    expect(useTasksStore.getState().tasks).toEqual([]);
  });

  it('fetchTask handles error', async () => {
    vi.mocked(tasksApi.getTask).mockRejectedValue({ code: 'TASK_NOT_FOUND' });

    await useTasksStore.getState().fetchTask('missing');

    const state = useTasksStore.getState();
    expect(state.error).toBe('Task not found');
    expect(state.isLoading).toBe(false);
  });

  // --- createTask ---

  it('createTask prepends task and increments total', async () => {
    const existing = makeTask({ id: 'a' });
    useTasksStore.setState({ tasks: [existing], pagination: { ...INITIAL_STATE.pagination, total: 1 } });
    const created = makeTask({ id: 'new' });
    vi.mocked(tasksApi.createTask).mockResolvedValue(created);

    const result = await useTasksStore.getState().createTask({ name: 'New', robotId: 'r1' });

    expect(result).toEqual(created);
    const state = useTasksStore.getState();
    expect(state.tasks[0]).toEqual(created);
    expect(state.tasks).toHaveLength(2);
    expect(state.pagination.total).toBe(2);
    expect(state.isExecuting).toBe(false);
  });

  it('createTask sets error and throws on failure', async () => {
    vi.mocked(tasksApi.createTask).mockRejectedValue({ code: 'INVALID_TASK_DATA' });

    await expect(
      useTasksStore.getState().createTask({ name: 'X', robotId: 'r1' })
    ).rejects.toThrow('Invalid task data provided');

    const state = useTasksStore.getState();
    expect(state.error).toBe('Invalid task data provided');
    expect(state.isExecuting).toBe(false);
  });

  // --- selectTask ---

  it('selectTask sets selected id', () => {
    useTasksStore.getState().selectTask('xyz');
    expect(useTasksStore.getState().selectedTaskId).toBe('xyz');
  });

  it('selectTask(null) clears selection and detail', () => {
    useTasksStore.setState({ selectedTaskId: 'a', taskDetail: makeTask({ id: 'a' }) });
    useTasksStore.getState().selectTask(null);
    const state = useTasksStore.getState();
    expect(state.selectedTaskId).toBeNull();
    expect(state.taskDetail).toBeNull();
  });

  // --- setFilters / clearFilters / setPage (auto-fetch) ---

  it('setFilters merges filters, resets to page 1, and triggers fetch', async () => {
    vi.mocked(tasksApi.listTasks).mockResolvedValue({
      tasks: [],
      pagination: INITIAL_STATE.pagination,
    });
    useTasksStore.setState({
      filters: { robotId: 'r1' },
      pagination: { ...INITIAL_STATE.pagination, page: 5 },
    });

    useTasksStore.getState().setFilters({ status: 'failed' });

    const state = useTasksStore.getState();
    expect(state.filters).toEqual({ robotId: 'r1', status: 'failed' });
    expect(state.pagination.page).toBe(1);
    expect(tasksApi.listTasks).toHaveBeenCalledOnce();
  });

  it('clearFilters empties filters, resets page, and fetches', async () => {
    vi.mocked(tasksApi.listTasks).mockResolvedValue({
      tasks: [],
      pagination: INITIAL_STATE.pagination,
    });
    useTasksStore.setState({
      filters: { status: 'failed' },
      pagination: { ...INITIAL_STATE.pagination, page: 3 },
    });

    useTasksStore.getState().clearFilters();

    const state = useTasksStore.getState();
    expect(state.filters).toEqual({});
    expect(state.pagination.page).toBe(1);
    expect(tasksApi.listTasks).toHaveBeenCalledOnce();
  });

  it('setPage updates page and fetches', async () => {
    vi.mocked(tasksApi.listTasks).mockResolvedValue({
      tasks: [],
      pagination: INITIAL_STATE.pagination,
    });

    useTasksStore.getState().setPage(4);

    expect(useTasksStore.getState().pagination.page).toBe(4);
    expect(tasksApi.listTasks).toHaveBeenCalledOnce();
  });

  // --- action lifecycle (pause/resume/cancel/retry share updateTaskInState) ---

  it.each([
    ['pauseTask', 'pauseTask'],
    ['resumeTask', 'resumeTask'],
    ['cancelTask', 'cancelTask'],
    ['retryTask', 'retryTask'],
  ] as const)('%s updates list + detail and returns task on success', async (storeFn, apiFn) => {
    const before = makeTask({ id: 'a', status: 'in_progress' });
    useTasksStore.setState({ tasks: [before], taskDetail: before });
    const after = makeTask({ id: 'a', status: 'paused' });
    vi.mocked(tasksApi[apiFn]).mockResolvedValue(after);

    const result = await useTasksStore.getState()[storeFn]('a');

    expect(result).toEqual(after);
    const state = useTasksStore.getState();
    expect(state.tasks[0]).toEqual(after);
    expect(state.taskDetail).toEqual(after);
    expect(state.isExecuting).toBe(false);
    expect(tasksApi[apiFn]).toHaveBeenCalledWith('a');
  });

  it.each([
    ['pauseTask', 'pauseTask', 'TASK_NOT_PAUSEABLE', 'This task cannot be paused'],
    ['resumeTask', 'resumeTask', 'TASK_NOT_RESUMEABLE', 'This task cannot be resumed'],
    ['cancelTask', 'cancelTask', 'TASK_NOT_CANCELLABLE', 'This task cannot be cancelled'],
    ['retryTask', 'retryTask', 'TASK_NOT_RETRYABLE', 'This task cannot be retried'],
  ] as const)('%s sets error and throws on failure', async (storeFn, apiFn, code, msg) => {
    vi.mocked(tasksApi[apiFn]).mockRejectedValue({ code });

    await expect(useTasksStore.getState()[storeFn]('a')).rejects.toThrow(msg);

    const state = useTasksStore.getState();
    expect(state.error).toBe(msg);
    expect(state.isExecuting).toBe(false);
  });

  // --- updateTaskStatus (WebSocket) ---

  it('updateTaskStatus updates list and detail status + timestamp', () => {
    const t = makeTask({ id: 'a', status: 'pending', updatedAt: 'old' });
    useTasksStore.setState({ tasks: [t], taskDetail: t });

    useTasksStore.getState().updateTaskStatus('a', 'completed');

    const state = useTasksStore.getState();
    expect(state.tasks[0].status).toBe('completed');
    expect(state.tasks[0].updatedAt).not.toBe('old');
    expect(state.taskDetail?.status).toBe('completed');
  });

  it('updateTaskStatus is a no-op when task is absent', () => {
    useTasksStore.getState().updateTaskStatus('ghost', 'failed');
    expect(useTasksStore.getState().tasks).toEqual([]);
  });

  // --- updateTask (partial) ---

  it('updateTask merges partial fields into list and detail', () => {
    const t = makeTask({ id: 'a', name: 'old', progress: 0 });
    useTasksStore.setState({ tasks: [t], taskDetail: t });

    useTasksStore.getState().updateTask({ id: 'a', name: 'new', progress: 50 });

    const state = useTasksStore.getState();
    expect(state.tasks[0].name).toBe('new');
    expect(state.tasks[0].progress).toBe(50);
    expect(state.tasks[0].robotId).toBe('robot-1'); // untouched
    expect(state.taskDetail?.name).toBe('new');
  });

  // --- updateProcessFromWebSocket ---

  it('updateProcessFromWebSocket replaces existing process', () => {
    const t = makeTask({ id: 'a', name: 'old' });
    useTasksStore.setState({ tasks: [t], pagination: { ...INITIAL_STATE.pagination, total: 1 } });

    const fresh = makeTask({ id: 'a', name: 'new' });
    useTasksStore.getState().updateProcessFromWebSocket(fresh);

    const state = useTasksStore.getState();
    expect(state.tasks).toEqual([fresh]);
    expect(state.pagination.total).toBe(1); // not incremented for existing
  });

  it('updateProcessFromWebSocket prepends new process and bumps total', () => {
    const existing = makeTask({ id: 'a' });
    useTasksStore.setState({ tasks: [existing], pagination: { ...INITIAL_STATE.pagination, total: 1 } });

    const incoming = makeTask({ id: 'b' });
    useTasksStore.getState().updateProcessFromWebSocket(incoming);

    const state = useTasksStore.getState();
    expect(state.tasks[0]).toEqual(incoming);
    expect(state.tasks).toHaveLength(2);
    expect(state.pagination.total).toBe(2);
  });

  it('updateProcessFromWebSocket updates detail when viewing that process', () => {
    const t = makeTask({ id: 'a' });
    useTasksStore.setState({ tasks: [t], taskDetail: t });

    const fresh = makeTask({ id: 'a', status: 'completed' });
    useTasksStore.getState().updateProcessFromWebSocket(fresh);

    expect(useTasksStore.getState().taskDetail).toEqual(fresh);
  });

  // --- clearError / reset ---

  it('clearError clears error', () => {
    useTasksStore.setState({ error: 'boom' });
    useTasksStore.getState().clearError();
    expect(useTasksStore.getState().error).toBeNull();
  });

  it('reset restores initial state', () => {
    useTasksStore.setState({
      tasks: [makeTask()],
      selectedTaskId: 'a',
      error: 'x',
      isExecuting: true,
      taskDetail: makeTask(),
    });

    useTasksStore.getState().reset();

    const state = useTasksStore.getState();
    expect(state.tasks).toEqual([]);
    expect(state.selectedTaskId).toBeNull();
    expect(state.error).toBeNull();
    expect(state.isExecuting).toBe(false);
    expect(state.taskDetail).toBeNull();
  });
});

// ============================================================================
// SELECTORS
// ============================================================================

describe('tasksStore selectors', () => {
  const tasks: Task[] = [
    makeTask({ id: 'a', status: 'pending', robotId: 'r1' }),
    makeTask({ id: 'b', status: 'in_progress', robotId: 'r1' }),
    makeTask({ id: 'c', status: 'queued', robotId: 'r2' }),
    makeTask({ id: 'd', status: 'completed', robotId: 'r2' }),
    makeTask({ id: 'e', status: 'paused', robotId: 'r1' }),
  ];

  const baseState = {
    ...INITIAL_STATE,
    tasks,
    selectedTaskId: 'b' as string | null,
    filters: { robotId: 'r1' },
    pagination: { page: 2, pageSize: 12, total: 5, totalPages: 1 },
    isLoading: true,
    isExecuting: true,
    error: 'oops',
    taskDetail: makeTask({ id: 'detail' }),
  } as ReturnType<typeof useTasksStore.getState>;

  it('simple field selectors', () => {
    expect(selectTasks(baseState)).toBe(tasks);
    expect(selectSelectedTaskId(baseState)).toBe('b');
    expect(selectTaskDetail(baseState)?.id).toBe('detail');
    expect(selectFilters(baseState)).toEqual({ robotId: 'r1' });
    expect(selectPagination(baseState).page).toBe(2);
    expect(selectIsLoading(baseState)).toBe(true);
    expect(selectIsExecuting(baseState)).toBe(true);
    expect(selectError(baseState)).toBe('oops');
  });

  it('selectTaskById returns match or null', () => {
    expect(selectTaskById('c')(baseState)?.id).toBe('c');
    expect(selectTaskById('zzz')(baseState)).toBeNull();
  });

  it('selectTasksByStatus filters by status', () => {
    expect(selectTasksByStatus('in_progress')(baseState).map((t) => t.id)).toEqual(['b']);
  });

  it('selectTasksByRobotId filters by robot', () => {
    expect(selectTasksByRobotId('r1')(baseState).map((t) => t.id)).toEqual(['a', 'b', 'e']);
  });

  it('selectActiveTasks includes pending/queued/in_progress/paused', () => {
    expect(selectActiveTasks(baseState).map((t) => t.id)).toEqual(['a', 'b', 'c', 'e']);
  });

  it('selectPendingTasks includes pending + queued', () => {
    expect(selectPendingTasks(baseState).map((t) => t.id)).toEqual(['a', 'c']);
  });

  it('selectInProgressTasks includes only in_progress', () => {
    expect(selectInProgressTasks(baseState).map((t) => t.id)).toEqual(['b']);
  });

  it('selectSelectedTask returns the selected task from list', () => {
    expect(selectSelectedTask(baseState)?.id).toBe('b');
  });

  it('selectSelectedTask returns null when nothing selected', () => {
    expect(selectSelectedTask({ ...baseState, selectedTaskId: null })).toBeNull();
  });

  it('selectSelectedTask returns null when selected id not in list', () => {
    expect(selectSelectedTask({ ...baseState, selectedTaskId: 'gone' })).toBeNull();
  });
});

// avoid unused import lint for ProcessStatus
const _statusCheck: ProcessStatus = 'pending';
void _statusCheck;
