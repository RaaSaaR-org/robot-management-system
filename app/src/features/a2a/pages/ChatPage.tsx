/**
 * @file ChatPage.tsx
 * @description Main A2A chat interface with conversation management
 * @feature a2a
 */

import { memo, useState, useCallback } from 'react';
import { cn } from '@/shared/utils';
import { Button } from '@/shared/components/ui/Button';
import { Spinner } from '@/shared/components/ui/Spinner';
import { ConversationPanel } from '../components/ConversationPanel';
import { ConversationSelector } from '../components/ConversationSelector';
import { ConversationList } from '../components/ConversationList';
import { AgentSelector } from '../components/AgentSelector';
import { ModeSwitcher } from '../components/ModeSwitcher';
import { RegisterAgentDialog } from '../components/RegisterAgentDialog';
import { A2ALayout } from '../components/A2ALayout';
import { useA2A } from '../hooks/useA2A';
import { useA2AStream } from '../hooks/useA2AStream';
import { useIsMobile } from '@/shared/hooks/useMediaQuery';
import type { A2AAgentCard } from '../types';

// ============================================================================
// ICONS
// ============================================================================

function MenuIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
    </svg>
  );
}

function CloseIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
    </svg>
  );
}

// ============================================================================
// MOBILE CONVERSATION DRAWER
// ============================================================================

interface ConversationDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  conversations: ReturnType<typeof useA2A>['conversations'];
  currentId: string | null;
  onSelect: (id: string | null) => void;
  onDelete: (id: string) => Promise<void>;
  onNew: () => void;
}

const ConversationDrawer = memo(function ConversationDrawer({
  isOpen,
  onClose,
  conversations,
  currentId,
  onSelect,
  onDelete,
  onNew,
}: ConversationDrawerProps) {
  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/30 z-40 animate-in fade-in duration-200"
        onClick={onClose}
      />
      {/* Drawer */}
      <div className="fixed inset-y-0 left-0 w-[85vw] max-w-xs z-50 glass-elevated animate-in slide-in-from-left duration-200">
        <div className="flex items-center justify-between p-4 border-b border-glass-subtle">
          <h2 className="font-semibold text-gray-900 dark:text-gray-100">Conversations</h2>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          >
            <CloseIcon className="w-5 h-5 text-gray-500" />
          </button>
        </div>
        <div className="overflow-y-auto h-[calc(100%-65px)]">
          <ConversationList
            conversations={conversations}
            selectedId={currentId}
            onSelect={(id) => {
              onSelect(id);
              onClose();
            }}
            onDelete={onDelete}
            onNew={onNew}
          />
        </div>
      </div>
    </>
  );
});

// ============================================================================
// CHAT PAGE
// ============================================================================

/**
 * Main A2A chat page - focused chat experience
 */
export const ChatPage = memo(function ChatPage() {
  const {
    conversations,
    currentConversation,
    activeTasks,
    registeredAgents,
    isLoading,
    error,
    chatMode,
    createConversation,
    selectConversation,
    deleteConversation,
    registerAgent,
    clearError,
    setChatMode,
  } = useA2A();

  // WebSocket connection
  const { isConnected } = useA2AStream();

  const isMobile = useIsMobile();

  // UI state
  const [showRegisterDialog, setShowRegisterDialog] = useState(false);
  const [selectedAgent, setSelectedAgent] = useState<A2AAgentCard | undefined>();
  const [conversationDrawerOpen, setConversationDrawerOpen] = useState(false);

  const handleNewConversation = useCallback(async () => {
    try {
      await createConversation(undefined, `Chat ${conversations.length + 1}`);
    } catch {
      // Error handled by store
    }
  }, [createConversation, conversations.length]);

  const handleRegisterAgent = useCallback(
    async (url: string) => {
      await registerAgent(url);
    },
    [registerAgent]
  );

  const handleSelectAgent = useCallback((agent: A2AAgentCard) => {
    setSelectedAgent(agent);
  }, []);

  return (
    <A2ALayout>
      <div className="flex flex-col h-full overflow-hidden">
        {/* Header */}
        <header className="flex-shrink-0 flex items-center justify-between h-14 px-4 border-b border-glass-subtle glass-elevated">
          {/* Left: Menu (mobile) + Conversation selector */}
          <div className="flex items-center gap-2">
            {isMobile && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setConversationDrawerOpen(true)}
                aria-label="Open conversations"
                className="p-2"
              >
                <MenuIcon className="w-5 h-5" />
              </Button>
            )}

            <ConversationSelector
              conversations={conversations}
              current={currentConversation}
              onSelect={selectConversation}
              onNew={handleNewConversation}
            />
          </div>

          {/* Center: Mode switcher + Agent selector (direct mode) */}
          <div className="flex items-center gap-3">
            <ModeSwitcher mode={chatMode} onChange={setChatMode} />
            {chatMode === 'direct' && (
              <AgentSelector
                agents={registeredAgents}
                selected={selectedAgent}
                onSelect={handleSelectAgent}
                onRegister={() => setShowRegisterDialog(true)}
              />
            )}
          </div>

          {/* Right: Connection status */}
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5 glass-subtle px-2.5 py-1 rounded-full">
              <span
                className={cn(
                  'w-2 h-2 rounded-full transition-colors',
                  isConnected ? 'bg-accent-500' : 'bg-gray-400'
                )}
              />
              <span className="text-xs text-gray-600 dark:text-gray-400 hidden sm:inline">
                {isConnected ? 'Connected' : 'Disconnected'}
              </span>
            </div>
          </div>
        </header>

        {/* Error banner */}
        {error && (
          <div className="px-4 py-2 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 flex items-center justify-between text-sm">
            <span>{error}</span>
            <Button variant="ghost" size="sm" onClick={clearError}>
              Dismiss
            </Button>
          </div>
        )}

        {/* Chat Area */}
        <div className="flex-1 overflow-hidden">
          {isLoading && !currentConversation ? (
            <div className="flex items-center justify-center h-full">
              <Spinner size="lg" />
            </div>
          ) : (
            <ConversationPanel
              conversationId={currentConversation?.conversationId || null}
              targetAgent={chatMode === 'direct' ? selectedAgent : undefined}
              chatMode={chatMode}
              onNewConversation={handleNewConversation}
              activeTasks={activeTasks}
            />
          )}
        </div>

        {/* Mobile Conversation Drawer */}
        <ConversationDrawer
          isOpen={conversationDrawerOpen}
          onClose={() => setConversationDrawerOpen(false)}
          conversations={conversations}
          currentId={currentConversation?.conversationId || null}
          onSelect={selectConversation}
          onDelete={deleteConversation}
          onNew={handleNewConversation}
        />

        {/* Register agent dialog */}
        <RegisterAgentDialog
          isOpen={showRegisterDialog}
          onClose={() => setShowRegisterDialog(false)}
          onRegister={handleRegisterAgent}
        />
      </div>
    </A2ALayout>
  );
});
