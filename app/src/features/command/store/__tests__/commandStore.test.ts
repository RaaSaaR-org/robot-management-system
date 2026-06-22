/**
 * @file commandStore.test.ts
 * @description Tests for the command Zustand store
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useCommandStore } from '../commandStore';
import {
  selectCurrentText,
  selectInterpretation,
  selectIsInterpreting,
  selectIsExecuting,
  selectHistory,
  selectIsLoadingHistory,
  selectError,
  selectCanExecute,
  selectHistoryByRobotId,
} from '../commandStore';
import type {
  CommandInterpretation,
  CommandHistoryEntry,
} from '../../types/command.types';
import type { RobotCommand } from '@/features/robots/types';

// Mock the api module the store imports
vi.mock('../../api/commandApi', () => ({
  commandApi: {
    interpretCommand: vi.fn(),
    executeCommand: vi.fn(),
    getHistory: vi.fn(),
  },
}));

import { commandApi } from '../../api/commandApi';

const mockedApi = vi.mocked(commandApi);

const makeInterpretation = (
  overrides: Partial<CommandInterpretation> = {}
): CommandInterpretation => ({
  id: 'interp-1',
  originalText: 'move to warehouse A',
  commandType: 'move',
  parameters: { target: 'warehouse a' },
  confidence: 0.95,
  safetyClassification: 'safe',
  timestamp: '2024-01-01T00:00:00.000Z',
  ...overrides,
});

const makeCommand = (overrides: Partial<RobotCommand> = {}): RobotCommand =>
  ({
    id: 'cmd-1',
    type: 'move',
    ...overrides,
  }) as RobotCommand;

const makeHistoryEntry = (
  overrides: Partial<CommandHistoryEntry> = {}
): CommandHistoryEntry => ({
  id: 'hist-1',
  robotId: 'robot-1',
  robotName: 'Robot One',
  originalText: 'go home',
  interpretation: makeInterpretation(),
  status: 'interpreted',
  createdAt: '2024-01-01T00:00:00.000Z',
  ...overrides,
});

const resetStore = () =>
  useCommandStore.setState({
    currentText: '',
    interpretation: null,
    isInterpreting: false,
    isExecuting: false,
    history: [],
    isLoadingHistory: false,
    error: null,
  });

describe('commandStore', () => {
  beforeEach(() => {
    resetStore();
    vi.clearAllMocks();
  });

  it('starts with initial state', () => {
    const state = useCommandStore.getState();
    expect(state.currentText).toBe('');
    expect(state.interpretation).toBeNull();
    expect(state.isInterpreting).toBe(false);
    expect(state.isExecuting).toBe(false);
    expect(state.history).toEqual([]);
    expect(state.isLoadingHistory).toBe(false);
    expect(state.error).toBeNull();
  });

  describe('setCurrentText', () => {
    it('updates the current text', () => {
      useCommandStore.getState().setCurrentText('hello');
      expect(useCommandStore.getState().currentText).toBe('hello');
    });

    it('clears interpretation when text diverges from originalText', () => {
      const interp = makeInterpretation({ originalText: 'go home' });
      useCommandStore.setState({ interpretation: interp });

      useCommandStore.getState().setCurrentText('something else');

      expect(useCommandStore.getState().interpretation).toBeNull();
    });

    it('keeps interpretation when text equals originalText', () => {
      const interp = makeInterpretation({ originalText: 'go home' });
      useCommandStore.setState({ interpretation: interp });

      useCommandStore.getState().setCurrentText('go home');

      expect(useCommandStore.getState().interpretation).toEqual(interp);
    });
  });

  describe('interpretCommand', () => {
    it('sets interpretation and clears loading on success', async () => {
      const interp = makeInterpretation();
      mockedApi.interpretCommand.mockResolvedValue(interp);

      await useCommandStore
        .getState()
        .interpretCommand({ text: 'move', robotId: 'robot-1' });

      const state = useCommandStore.getState();
      expect(state.interpretation).toEqual(interp);
      expect(state.isInterpreting).toBe(false);
      expect(state.error).toBeNull();
      expect(mockedApi.interpretCommand).toHaveBeenCalledWith({
        text: 'move',
        robotId: 'robot-1',
      });
    });

    it('sets error and rethrows on failure', async () => {
      mockedApi.interpretCommand.mockRejectedValue(new Error('boom'));

      await expect(
        useCommandStore
          .getState()
          .interpretCommand({ text: 'move', robotId: 'robot-1' })
      ).rejects.toThrow('boom');

      const state = useCommandStore.getState();
      expect(state.error).toBe('boom');
      expect(state.isInterpreting).toBe(false);
      expect(state.interpretation).toBeNull();
    });

    it('uses fallback message for non-Error rejection', async () => {
      mockedApi.interpretCommand.mockRejectedValue('weird');

      await expect(
        useCommandStore
          .getState()
          .interpretCommand({ text: 'move', robotId: 'robot-1' })
      ).rejects.toBe('weird');

      expect(useCommandStore.getState().error).toBe('Failed to interpret command');
    });
  });

  describe('clearInterpretation', () => {
    it('clears interpretation and error', () => {
      useCommandStore.setState({
        interpretation: makeInterpretation(),
        error: 'oops',
      });

      useCommandStore.getState().clearInterpretation();

      const state = useCommandStore.getState();
      expect(state.interpretation).toBeNull();
      expect(state.error).toBeNull();
    });
  });

  describe('executeCommand', () => {
    it('throws when there is no interpretation', async () => {
      await expect(
        useCommandStore.getState().executeCommand('robot-1')
      ).rejects.toThrow('No interpretation to execute');
      expect(mockedApi.executeCommand).not.toHaveBeenCalled();
    });

    it('executes, returns command, and clears state on success', async () => {
      const interp = makeInterpretation();
      const command = makeCommand();
      useCommandStore.setState({ interpretation: interp, currentText: 'move' });
      mockedApi.executeCommand.mockResolvedValue(command);

      const result = await useCommandStore.getState().executeCommand('robot-1');

      expect(result).toEqual(command);
      expect(mockedApi.executeCommand).toHaveBeenCalledWith('robot-1', interp);

      const state = useCommandStore.getState();
      expect(state.currentText).toBe('');
      expect(state.interpretation).toBeNull();
      expect(state.isExecuting).toBe(false);
      expect(state.error).toBeNull();
    });

    it('sets error and rethrows on failure, keeping interpretation', async () => {
      const interp = makeInterpretation();
      useCommandStore.setState({ interpretation: interp });
      mockedApi.executeCommand.mockRejectedValue(new Error('exec fail'));

      await expect(
        useCommandStore.getState().executeCommand('robot-1')
      ).rejects.toThrow('exec fail');

      const state = useCommandStore.getState();
      expect(state.error).toBe('exec fail');
      expect(state.isExecuting).toBe(false);
      expect(state.interpretation).toEqual(interp);
    });
  });

  describe('fetchHistory', () => {
    it('loads history on success', async () => {
      const entries = [makeHistoryEntry({ id: 'h1' }), makeHistoryEntry({ id: 'h2' })];
      mockedApi.getHistory.mockResolvedValue({
        entries,
        pagination: { page: 1, pageSize: 20, total: 2, totalPages: 1 },
      });

      await useCommandStore.getState().fetchHistory({ page: 1 });

      const state = useCommandStore.getState();
      expect(state.history).toEqual(entries);
      expect(state.isLoadingHistory).toBe(false);
      expect(mockedApi.getHistory).toHaveBeenCalledWith({ page: 1 });
    });

    it('sets error and rethrows on failure', async () => {
      mockedApi.getHistory.mockRejectedValue(new Error('no history'));

      await expect(
        useCommandStore.getState().fetchHistory()
      ).rejects.toThrow('no history');

      const state = useCommandStore.getState();
      expect(state.error).toBe('no history');
      expect(state.isLoadingHistory).toBe(false);
    });
  });

  describe('addToHistory', () => {
    it('prepends an entry to history', () => {
      const existing = makeHistoryEntry({ id: 'old' });
      useCommandStore.setState({ history: [existing] });

      const fresh = makeHistoryEntry({ id: 'new' });
      useCommandStore.getState().addToHistory(fresh);

      const history = useCommandStore.getState().history;
      expect(history).toHaveLength(2);
      expect(history[0].id).toBe('new');
      expect(history[1].id).toBe('old');
    });
  });

  describe('clearError and reset', () => {
    it('clearError resets error only', () => {
      useCommandStore.setState({ error: 'bad', currentText: 'keep' });
      useCommandStore.getState().clearError();
      expect(useCommandStore.getState().error).toBeNull();
      expect(useCommandStore.getState().currentText).toBe('keep');
    });

    it('reset restores initial state', () => {
      useCommandStore.setState({
        currentText: 'x',
        interpretation: makeInterpretation(),
        isInterpreting: true,
        history: [makeHistoryEntry()],
        error: 'err',
      });

      useCommandStore.getState().reset();

      const state = useCommandStore.getState();
      expect(state.currentText).toBe('');
      expect(state.interpretation).toBeNull();
      expect(state.isInterpreting).toBe(false);
      expect(state.history).toEqual([]);
      expect(state.error).toBeNull();
    });
  });

  describe('selectors', () => {
    it('basic selectors read state', () => {
      const interp = makeInterpretation();
      useCommandStore.setState({
        currentText: 'txt',
        interpretation: interp,
        isInterpreting: true,
        isExecuting: true,
        history: [makeHistoryEntry()],
        isLoadingHistory: true,
        error: 'e',
      });
      const s = useCommandStore.getState();

      expect(selectCurrentText(s)).toBe('txt');
      expect(selectInterpretation(s)).toEqual(interp);
      expect(selectIsInterpreting(s)).toBe(true);
      expect(selectIsExecuting(s)).toBe(true);
      expect(selectHistory(s)).toHaveLength(1);
      expect(selectIsLoadingHistory(s)).toBe(true);
      expect(selectError(s)).toBe('e');
    });

    it('selectCanExecute true only with interpretation and idle flags', () => {
      useCommandStore.setState({
        interpretation: makeInterpretation(),
        isInterpreting: false,
        isExecuting: false,
      });
      expect(selectCanExecute(useCommandStore.getState())).toBe(true);

      useCommandStore.setState({ interpretation: null });
      expect(selectCanExecute(useCommandStore.getState())).toBe(false);

      useCommandStore.setState({
        interpretation: makeInterpretation(),
        isInterpreting: true,
      });
      expect(selectCanExecute(useCommandStore.getState())).toBe(false);

      useCommandStore.setState({ isInterpreting: false, isExecuting: true });
      expect(selectCanExecute(useCommandStore.getState())).toBe(false);
    });

    it('selectHistoryByRobotId filters by robotId', () => {
      useCommandStore.setState({
        history: [
          makeHistoryEntry({ id: 'a', robotId: 'r1' }),
          makeHistoryEntry({ id: 'b', robotId: 'r2' }),
          makeHistoryEntry({ id: 'c', robotId: 'r1' }),
        ],
      });

      const result = selectHistoryByRobotId('r1')(useCommandStore.getState());
      expect(result.map((e) => e.id)).toEqual(['a', 'c']);
    });
  });
});
