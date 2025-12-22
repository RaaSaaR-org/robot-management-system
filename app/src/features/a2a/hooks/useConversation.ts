/**
 * @file useConversation.ts
 * @description Hook for managing a single conversation
 * @feature a2a
 */

import { useCallback, useEffect, useState, useMemo } from 'react';
import { useA2AStore } from '../store';
import type { A2AConversation, A2AMessage } from '../types';

interface UseConversationOptions {
  /** Auto-refresh messages interval in ms (0 to disable) */
  refreshInterval?: number;
}

interface UseConversationReturn {
  /** The conversation */
  conversation: A2AConversation | undefined;
  /** Messages in the conversation */
  messages: A2AMessage[];
  /** Whether the conversation is loading */
  isLoading: boolean;
  /** Whether a message is being sent */
  isSending: boolean;
  /** Error message */
  error: string | null;
  /** Send a message */
  sendMessage: (text: string, targetAgentUrl?: string) => Promise<void>;
  /** Refresh messages */
  refreshMessages: () => Promise<void>;
}

/**
 * Hook for managing a single conversation
 */
export function useConversation(
  conversationId: string | null,
  options: UseConversationOptions = {}
): UseConversationReturn {
  const { refreshInterval = 0 } = options;

  // Use primitive selector and compute derived value with useMemo
  const conversations = useA2AStore((state) => state.conversations);
  const conversation = useMemo(
    () => conversationId ? conversations.find((c) => c.conversationId === conversationId) : undefined,
    [conversations, conversationId]
  );

  // Get actions directly from store.getState() to avoid re-render issues
  const { storeSendMessage, fetchMessages } = useMemo(() => {
    const state = useA2AStore.getState();
    return {
      storeSendMessage: state.sendMessage,
      fetchMessages: state.fetchMessages,
    };
  }, []);

  const [isLoading, setIsLoading] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch messages on mount and when conversationId changes
  useEffect(() => {
    if (conversationId) {
      setIsLoading(true);
      fetchMessages(conversationId)
        .catch((err) => setError(err instanceof Error ? err.message : 'Failed to fetch messages'))
        .finally(() => setIsLoading(false));
    }
  }, [conversationId, fetchMessages]);

  // Auto-refresh messages
  useEffect(() => {
    if (!conversationId || refreshInterval <= 0) {
      return;
    }

    const interval = setInterval(() => {
      fetchMessages(conversationId).catch(console.error);
    }, refreshInterval);

    return () => clearInterval(interval);
  }, [conversationId, refreshInterval, fetchMessages]);

  const sendMessage = useCallback(
    async (text: string, targetAgentUrl?: string) => {
      if (!conversationId) {
        setError('No conversation selected');
        return;
      }

      setIsSending(true);
      setError(null);

      try {
        await storeSendMessage({
          conversationId,
          message: text,
          targetAgentUrl,
        });
        // Messages are refreshed automatically by the store
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to send message');
        throw err;
      } finally {
        setIsSending(false);
      }
    },
    [conversationId, storeSendMessage]
  );

  const refreshMessages = useCallback(async () => {
    if (!conversationId) {
      return;
    }

    setIsLoading(true);
    try {
      await fetchMessages(conversationId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to refresh messages');
    } finally {
      setIsLoading(false);
    }
  }, [conversationId, fetchMessages]);

  return {
    conversation,
    messages: conversation?.messages || [],
    isLoading,
    isSending,
    error,
    sendMessage,
    refreshMessages,
  };
}

/**
 * Hook for creating and managing a new conversation
 */
export function useNewConversation(robotId?: string) {
  // Get actions directly from store.getState() to avoid re-render issues
  const { createConversation, selectConversation } = useMemo(() => {
    const state = useA2AStore.getState();
    return {
      createConversation: state.createConversation,
      selectConversation: state.selectConversation,
    };
  }, []);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = useCallback(
    async (name?: string) => {
      setIsCreating(true);
      setError(null);

      try {
        const conversation = await createConversation(robotId, name);
        selectConversation(conversation.conversationId);
        return conversation;
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to create conversation');
        throw err;
      } finally {
        setIsCreating(false);
      }
    },
    [createConversation, selectConversation, robotId]
  );

  return {
    create,
    isCreating,
    error,
  };
}
