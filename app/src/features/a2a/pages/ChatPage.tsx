/**
 * @file ChatPage.tsx
 * @description Agent chat: talk to one robot agent directly, or let the orchestrator route
 * @feature a2a
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Bot, List, MessageSquare, Plus } from 'lucide-react';
import { DemoFeaturePlaceholder } from '@/components/demo/DemoFeaturePlaceholder';
import {
  Button,
  EmptyState,
  ErrorState,
  LinkButton,
  Modal,
  PageHeader,
  Panel,
  SegmentedControl,
  Select,
  Spinner,
  StatusTag,
  confirm,
  toast,
} from '@/shared/components/ui';
import { getErrorMessage } from '@/shared/utils/error';
import { A2ATabs } from '../components/A2ATabs';
import { ConversationList } from '../components/ConversationList';
import { ConversationPanel } from '../components/ConversationPanel';
import { useA2A } from '../hooks/useA2A';
import { useA2AStream } from '../hooks/useA2AStream';
import type { A2AChatMode, A2AConversation } from '../types';

const icon = 'h-4 w-4';

/**
 * Agent chat page — demo guard + inner component (Rules of Hooks).
 */
export function ChatPage() {
  if (import.meta.env.VITE_DEMO_MODE === 'true') {
    return (
      <DemoFeaturePlaceholder
        featureName="Agent chat"
        icon={<MessageSquare className="h-12 w-12" />}
        description="Talk to a robot agent directly over A2A, or let the orchestrator pick the right one."
        capabilities={[
          'Send natural-language commands to any registered robot agent',
          'Follow replies and task status as they stream in',
          'Let the orchestrator route a request to the best agent',
          'Answer forms an agent asks you to fill in',
        ]}
        docsSlug="architecture"
      />
    );
  }
  return <ChatWorkspace />;
}

function ChatWorkspace() {
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
    clearError,
    refresh,
    setChatMode,
  } = useA2A();
  const { isConnected } = useA2AStream();
  const [params, setParams] = useSearchParams();
  const [agentName, setAgentName] = useState<string>(() => params.get('agent') ?? '');
  const [listOpen, setListOpen] = useState(false);
  const [creating, setCreating] = useState(false);

  // "Start chat" from an agent lands here with ?agent=; switch to direct mode once.
  useEffect(() => {
    const fromUrl = params.get('agent');
    if (!fromUrl) return;
    setAgentName(fromUrl);
    setChatMode('direct');
    setParams((p) => { p.delete('agent'); return p; }, { replace: true });
  }, [params, setParams, setChatMode]);

  // Default to the first agent when none is chosen yet.
  useEffect(() => {
    if (!agentName && registeredAgents.length > 0) setAgentName(registeredAgents[0].name);
  }, [agentName, registeredAgents]);

  const selectedAgent = useMemo(() => registeredAgents.find((a) => a.name === agentName), [registeredAgents, agentName]);

  const newConversation = useCallback(async () => {
    setCreating(true);
    try {
      const c = await createConversation(undefined, `Chat ${conversations.length + 1}`);
      toast.success('Conversation created', { description: c.name });
      setListOpen(false);
    } catch (err) {
      toast.error("Couldn't create conversation", { description: getErrorMessage(err) });
    } finally {
      setCreating(false);
    }
  }, [createConversation, conversations.length]);

  const askDelete = useCallback(
    async (c: A2AConversation) => {
      const ok = await confirm({
        title: `Delete ${c.name || 'this conversation'}?`,
        description: 'Its messages are removed. Tasks the agents already ran are kept.',
        tone: 'danger',
      });
      if (!ok) return;
      try {
        await deleteConversation(c.conversationId);
        toast.success('Conversation deleted', { description: c.name });
      } catch (err) {
        clearError();
        toast.error("Couldn't delete conversation", { description: getErrorMessage(err) });
      }
    },
    [deleteConversation, clearError],
  );

  const list = (
    <ConversationList
      className="h-full"
      conversations={conversations}
      selectedId={currentConversation?.conversationId ?? null}
      onSelect={(id) => {
        selectConversation(id);
        setListOpen(false);
      }}
      onDelete={(c) => void askDelete(c)}
      onNew={() => void newConversation()}
    />
  );

  const newButton = (
    <Button leftIcon={<Plus className={icon} strokeWidth={1.75} />} onClick={() => void newConversation()} isLoading={creating}>
      New conversation
    </Button>
  );

  let chatBody;
  if (isLoading && !currentConversation && conversations.length === 0) {
    chatBody = (
      <div className="flex h-full items-center justify-center gap-2 text-sm text-ink-tertiary">
        <Spinner size="sm" color="current" /> Loading conversations…
      </div>
    );
  } else if (error && conversations.length === 0) {
    chatBody = (
      <div className="flex h-full items-center justify-center p-6">
        <ErrorState size="sm" title="Couldn't load the chat" message={error} onRetry={() => { clearError(); void refresh(); }} />
      </div>
    );
  } else if (chatMode === 'direct' && registeredAgents.length === 0) {
    chatBody = (
      <div className="flex h-full items-center justify-center p-6">
        <EmptyState
          icon={<Bot />}
          title="No agents registered"
          description="Register a robot agent first, or switch to Orchestrate."
          action={<LinkButton to="/a2a/agents" variant="secondary">Go to agents</LinkButton>}
        />
      </div>
    );
  } else {
    chatBody = (
      <ConversationPanel
        conversationId={currentConversation?.conversationId ?? null}
        targetAgent={chatMode === 'direct' ? selectedAgent : undefined}
        chatMode={chatMode}
        onNewConversation={() => void newConversation()}
        activeTasks={activeTasks}
      />
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Operate"
        title="Agent chat"
        description="Talk to a robot agent directly, or let the orchestrator pick one."
        meta={isConnected ? <StatusTag status="connected" dot /> : <StatusTag status="offline" dot />}
        actions={newButton}
      />
      <A2ATabs />

      <div className="grid min-h-[520px] grid-cols-1 gap-4 lg:h-[calc(100vh-18rem)] lg:grid-cols-[280px_1fr]">
        <Panel padding="none" className="hidden min-h-0 flex-col lg:flex">
          <div className="border-b border-line-subtle px-4 py-3 text-sm font-semibold text-ink-primary">Conversations</div>
          <div className="min-h-0 flex-1">{list}</div>
        </Panel>

        <Panel padding="none" className="flex h-[70vh] min-h-[520px] flex-col lg:h-auto">
          <div className="flex flex-wrap items-center gap-2 border-b border-line-subtle px-3 py-2.5">
            <Button
              variant="secondary"
              size="sm"
              className="lg:hidden"
              leftIcon={<List className={icon} strokeWidth={1.75} />}
              onClick={() => setListOpen(true)}
            >
              Conversations
            </Button>
            <div className="min-w-0 truncate text-sm font-medium text-ink-primary max-lg:hidden">
              {currentConversation?.name ?? 'No conversation open'}
            </div>
            <div className="ml-auto flex flex-wrap items-center gap-2">
              <SegmentedControl<A2AChatMode>
                label="Mode"
                size="sm"
                options={[
                  { value: 'direct', label: 'Direct', title: 'Talk to one agent' },
                  { value: 'orchestration', label: 'Orchestrate', title: 'The orchestrator picks the agent' },
                ]}
                value={chatMode}
                onChange={setChatMode}
              />
              {chatMode === 'direct' && registeredAgents.length > 0 && (
                <Select
                  aria-label="Agent"
                  size="sm"
                  fullWidth={false}
                  className="w-48 sm:w-56"
                  options={registeredAgents.map((a) => ({ value: a.name, label: a.name }))}
                  value={agentName}
                  onChange={(e) => setAgentName(e.target.value)}
                />
              )}
            </div>
          </div>
          <div className="min-h-0 flex-1">{chatBody}</div>
        </Panel>
      </div>

      <Modal isOpen={listOpen} onClose={() => setListOpen(false)} title="Conversations" size="md" bodyClassName="p-0">
        <div className="h-[60vh]">{list}</div>
      </Modal>
    </div>
  );
}
