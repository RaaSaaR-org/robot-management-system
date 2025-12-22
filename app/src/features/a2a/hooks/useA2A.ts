/**
 * @file useA2A.ts
 * @description Main hook for A2A functionality
 * @feature a2a
 */

import { useCallback, useEffect, useMemo } from 'react';
import { useA2AStore } from '../store';

/**
 * Main A2A hook - provides access to conversations, tasks, and agents
 */
export function useA2A() {
  // Use primitive selectors that return stable references
  const conversations = useA2AStore((state) => state.conversations);
  const currentConversationId = useA2AStore((state) => state.currentConversationId);
  const tasks = useA2AStore((state) => state.tasks);
  const registeredAgents = useA2AStore((state) => state.registeredAgents);
  const isLoading = useA2AStore((state) => state.isLoading);
  const error = useA2AStore((state) => state.error);
  const chatMode = useA2AStore((state) => state.chatMode);
  const geminiApiKey = useA2AStore((state) => state.geminiApiKey);

  // Compute derived values with useMemo to avoid creating new references
  const currentConversation = useMemo(
    () => conversations.find((c) => c.conversationId === currentConversationId),
    [conversations, currentConversationId]
  );

  const activeTasks = useMemo(
    () => tasks.filter((t) => !['completed', 'failed', 'canceled'].includes(t.status.state)),
    [tasks]
  );

  // Get actions directly from store.getState() to avoid re-render issues
  const actions = useMemo(() => {
    const state = useA2AStore.getState();
    return {
      createConversation: state.createConversation,
      fetchConversations: state.fetchConversations,
      selectConversation: state.selectConversation,
      deleteConversation: state.deleteConversation,
      sendMessage: state.sendMessage,
      fetchTasks: state.fetchTasks,
      registerAgent: state.registerAgent,
      unregisterAgent: state.unregisterAgent,
      fetchAgents: state.fetchAgents,
      clearError: state.clearError,
      reset: state.reset,
      setChatMode: state.setChatMode,
      setGeminiApiKey: state.setGeminiApiKey,
    };
  }, []);

  const {
    createConversation,
    fetchConversations,
    selectConversation,
    deleteConversation,
    sendMessage,
    fetchTasks,
    registerAgent,
    unregisterAgent,
    fetchAgents,
    clearError,
    reset,
    setChatMode,
    setGeminiApiKey,
  } = actions;

  // Fetch initial data on mount
  useEffect(() => {
    fetchConversations();
    fetchAgents();
    fetchTasks();
  }, [fetchConversations, fetchAgents, fetchTasks]);

  const createNewConversation = useCallback(
    async (robotId?: string, name?: string) => {
      return createConversation(robotId, name);
    },
    [createConversation]
  );

  const selectExistingConversation = useCallback(
    (id: string | null) => {
      selectConversation(id);
    },
    [selectConversation]
  );

  const deleteExistingConversation = useCallback(
    async (id: string) => {
      await deleteConversation(id);
    },
    [deleteConversation]
  );

  const sendNewMessage = useCallback(
    async (conversationId: string, message: string, targetAgentUrl?: string) => {
      return sendMessage({ conversationId, message, targetAgentUrl });
    },
    [sendMessage]
  );

  const registerNewAgent = useCallback(
    async (url: string) => {
      return registerAgent(url);
    },
    [registerAgent]
  );

  const unregisterExistingAgent = useCallback(
    (name: string) => {
      unregisterAgent(name);
    },
    [unregisterAgent]
  );

  const refresh = useCallback(async () => {
    await Promise.all([fetchConversations(), fetchAgents(), fetchTasks()]);
  }, [fetchConversations, fetchAgents, fetchTasks]);

  return {
    // State
    conversations,
    currentConversation,
    tasks,
    activeTasks,
    registeredAgents,
    isLoading,
    error,
    chatMode,
    geminiApiKey,

    // Actions
    createConversation: createNewConversation,
    selectConversation: selectExistingConversation,
    deleteConversation: deleteExistingConversation,
    sendMessage: sendNewMessage,
    registerAgent: registerNewAgent,
    unregisterAgent: unregisterExistingAgent,
    refresh,
    clearError,
    reset,
    setChatMode,
    setGeminiApiKey,
  };
}
