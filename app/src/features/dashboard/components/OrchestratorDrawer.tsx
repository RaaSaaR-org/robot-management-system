/**
 * @file OrchestratorDrawer.tsx
 * @description Right-side sheet with the orchestrator chat, opened from the
 *   dashboard (?drawer=chat). Solid panel, its own h2, focus trap, Esc and
 *   overlay click close, focus returns to the opener. Full screen below sm.
 * @feature dashboard
 * @dependencies @/shared/components/ui, @/features/a2a
 */

import { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { Button, Spinner, StatusTag } from '@/shared/components/ui';
import { ConversationPanel } from '@/features/a2a/components/ConversationPanel';
import { useA2A, useA2AStream } from '@/features/a2a';

export interface OrchestratorDrawerProps {
  isOpen: boolean;
  onClose: () => void;
}

const FOCUSABLE = 'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';

/** Chat body: wires the orchestrator conversation like the old /orchestrator page. */
function OrchestratorChat() {
  const {
    conversations,
    currentConversation,
    activeTasks,
    isLoading,
    error,
    createConversation,
    selectConversation,
    clearError,
    setChatMode,
  } = useA2A();

  useEffect(() => {
    setChatMode('orchestration');
  }, [setChatMode]);

  // Select the orchestrator conversation, or create one.
  useEffect(() => {
    const orchestrator = conversations.find((c) => c.name?.startsWith('Orchestrator'));
    if (orchestrator) {
      if (currentConversation?.conversationId !== orchestrator.conversationId) {
        selectConversation(orchestrator.conversationId);
      }
    } else if (conversations.length === 0 && !isLoading && !error) {
      createConversation(undefined, 'Orchestrator').catch(() => {
        // The store keeps the error; it is shown above the chat.
      });
    } else if (!currentConversation && conversations.length > 0) {
      selectConversation(conversations[0].conversationId);
    }
  }, [conversations, currentConversation, isLoading, error, createConversation, selectConversation]);

  return (
    <>
      {error && (
        <div role="alert" className="flex items-center justify-between gap-3 border-b border-line-subtle bg-signal-stopped/10 px-4 py-2 text-[13px] text-signal-stopped">
          <span className="min-w-0">{error}</span>
          <Button variant="ghost" size="sm" onClick={clearError}>
            Dismiss
          </Button>
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-hidden">
        {isLoading && !currentConversation ? (
          <div className="flex h-full items-center justify-center">
            <Spinner size="md" label="Loading conversation" />
          </div>
        ) : (
          <ConversationPanel
            conversationId={currentConversation?.conversationId || null}
            chatMode="orchestration"
            onNewConversation={async () => {
              await createConversation(undefined, 'Orchestrator');
            }}
            activeTasks={activeTasks}
          />
        )}
      </div>
    </>
  );
}

/** Orchestrator side sheet. */
export function OrchestratorDrawer({ isOpen, onClose }: OrchestratorDrawerProps) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const { isConnected } = useA2AStream();

  useEffect(() => {
    if (!isOpen) return;
    const opener = document.activeElement as HTMLElement | null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== 'Tab' || !panelRef.current) return;
      const nodes = Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((n) => n.offsetParent !== null);
      if (nodes.length === 0) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
      opener?.focus?.();
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return createPortal(
    <div className="fixed inset-0 z-[60] flex justify-end">
      <div className="absolute inset-0 bg-canvas/60" onClick={onClose} aria-hidden="true" />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative flex h-full w-full flex-col border-l border-line bg-panel shadow-[var(--shadow-raised)] sm:w-[480px]"
      >
        <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <h2 id={titleId} className="font-display text-base font-semibold tracking-[-0.01em] text-ink-primary">
              Orchestrator
            </h2>
            {isConnected ? (
              <StatusTag tone="live" dot size="sm">Connected</StatusTag>
            ) : (
              <StatusTag tone="neutral" dot size="sm">Offline</StatusTag>
            )}
          </div>
          <Button ref={closeRef} variant="ghost" size="sm" iconOnly aria-label="Close orchestrator" onClick={onClose}>
            <X className="h-4 w-4" strokeWidth={1.75} />
          </Button>
        </div>
        <OrchestratorChat />
      </div>
    </div>,
    document.body,
  );
}
