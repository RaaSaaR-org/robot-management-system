/**
 * @file A2APage.tsx
 * @description Main A2A dashboard page with full-screen chat experience
 * @feature a2a
 */

import { memo, useState, useCallback } from 'react';
import { cn } from '@/shared/utils';
import { Button } from '@/shared/components/ui/Button';
import { Spinner } from '@/shared/components/ui/Spinner';
import { ConversationList } from '../components/ConversationList';
import { ConversationPanel } from '../components/ConversationPanel';
import { AgentList } from '../components/AgentList';
import { RegisterAgentDialog } from '../components/RegisterAgentDialog';
import { SidebarDrawer } from '../components/SidebarDrawer';
import { TaskDrawer } from '../components/TaskDrawer';
import { AgentSelector } from '../components/AgentSelector';
import { ConversationSelector } from '../components/ConversationSelector';
import { ModeSwitcher } from '../components/ModeSwitcher';
import { ApiKeyDialog, useLoadApiKey } from '../components/ApiKeyDialog';
import { useA2A } from '../hooks/useA2A';
import { useA2AStream } from '../hooks/useA2AStream';
import type { A2AAgentCard } from '../types';

// Icons
function MenuIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
    </svg>
  );
}

function TaskIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"
      />
    </svg>
  );
}

function SettingsIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
      />
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  );
}

/**
 * Main A2A dashboard page - full-screen chat experience
 */
export const A2APage = memo(function A2APage() {
  const {
    conversations,
    currentConversation,
    tasks,
    activeTasks,
    registeredAgents,
    isLoading,
    error,
    chatMode,
    geminiApiKey,
    createConversation,
    selectConversation,
    deleteConversation,
    registerAgent,
    unregisterAgent,
    clearError,
    setChatMode,
    setGeminiApiKey,
  } = useA2A();

  // WebSocket connection
  const { isConnected } = useA2AStream();

  // Load API key from localStorage on mount
  useLoadApiKey(setGeminiApiKey);

  // UI state
  const [showRegisterDialog, setShowRegisterDialog] = useState(false);
  const [showSettingsDialog, setShowSettingsDialog] = useState(false);
  const [selectedAgent, setSelectedAgent] = useState<A2AAgentCard | undefined>();
  const [sidebarTab, setSidebarTab] = useState<'conversations' | 'agents'>('conversations');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [taskDrawerOpen, setTaskDrawerOpen] = useState(false);

  const handleNewConversation = useCallback(async () => {
    try {
      await createConversation(undefined, `Chat ${conversations.length + 1}`);
    } catch {
      // Error is handled by the store
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

  const handleRemoveAgent = useCallback(
    (agent: A2AAgentCard) => {
      unregisterAgent(agent.name);
      if (selectedAgent?.name === agent.name) {
        setSelectedAgent(undefined);
      }
    },
    [unregisterAgent, selectedAgent]
  );

  return (
    // Use calc for viewport height minus topbar (56px) and layout padding (48px)
    <div className="h-[calc(100vh-6.5rem)] flex flex-col overflow-hidden">
      {/* Compact Header Bar - fixed, never shrinks */}
      <header className="flex-shrink-0 flex items-center justify-between h-14 px-4 border-b border-glass-subtle glass-elevated relative z-20">
        {/* Left: Menu + Conversation selector */}
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setSidebarOpen(true)}
            aria-label="Open menu"
            className="p-2"
          >
            <MenuIcon className="w-5 h-5" />
          </Button>

          <ConversationSelector
            conversations={conversations}
            current={currentConversation}
            onSelect={selectConversation}
            onNew={handleNewConversation}
          />
        </div>

        {/* Center: Mode switcher + Agent selector (only in direct mode) */}
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

        {/* Right: Status + Settings + Tasks */}
        <div className="flex items-center gap-3">
          {/* Connection status */}
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

          {/* Settings button - shows indicator when API key is configured */}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowSettingsDialog(true)}
            className={cn(
              'p-2 relative',
              geminiApiKey && 'text-accent-600 dark:text-accent-400'
            )}
            aria-label="Orchestration settings"
          >
            <SettingsIcon className="w-5 h-5" />
            {geminiApiKey && (
              <span className="absolute top-1 right-1 w-2 h-2 bg-accent-500 rounded-full" />
            )}
          </Button>

          {/* Tasks button */}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setTaskDrawerOpen(true)}
            className={cn(
              'flex items-center gap-1.5 p-2',
              activeTasks.length > 0 && 'text-primary-600 dark:text-primary-400'
            )}
          >
            <TaskIcon className="w-5 h-5" />
            {tasks.length > 0 && (
              <span className="text-xs font-medium">
                {activeTasks.length > 0 ? activeTasks.length : tasks.length}
              </span>
            )}
          </Button>
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

      {/* Full-width Chat Area - relative container for sidebar overlay */}
      <div className="flex-1 overflow-hidden relative">
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

        {/* Sidebar Drawer - overlays only the chat area, not main nav */}
        <SidebarDrawer
          isOpen={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
          tab={sidebarTab}
          onTabChange={setSidebarTab}
          agentCount={registeredAgents.length}
        >
          {sidebarTab === 'conversations' ? (
            <ConversationList
              conversations={conversations}
              selectedId={currentConversation?.conversationId || null}
              onSelect={(id) => {
                selectConversation(id);
                setSidebarOpen(false);
              }}
              onDelete={deleteConversation}
              onNew={handleNewConversation}
            />
          ) : (
            <AgentList
              agents={registeredAgents}
              selectedAgent={selectedAgent}
              onSelect={(agent) => {
                handleSelectAgent(agent);
                setSidebarOpen(false);
              }}
              onRemove={handleRemoveAgent}
              onRegister={() => setShowRegisterDialog(true)}
            />
          )}
        </SidebarDrawer>
      </div>

      {/* Task Drawer */}
      <TaskDrawer
        isOpen={taskDrawerOpen}
        onClose={() => setTaskDrawerOpen(false)}
        tasks={tasks}
      />

      {/* Register agent dialog */}
      <RegisterAgentDialog
        isOpen={showRegisterDialog}
        onClose={() => setShowRegisterDialog(false)}
        onRegister={handleRegisterAgent}
      />

      {/* API Key settings dialog */}
      <ApiKeyDialog
        isOpen={showSettingsDialog}
        onClose={() => setShowSettingsDialog(false)}
        currentKey={geminiApiKey}
        onSave={setGeminiApiKey}
      />
    </div>
  );
});
