/**
 * @file MessageBubble.tsx
 * @description One chat message: text (markdown), files, data and agent forms
 * @feature a2a
 */

import { memo, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import { Spinner, StatusTag } from '@/shared/components/ui';
import { UI_DATE_LOCALE } from '@/shared/utils';
import { cn } from '@/shared/utils/cn';
import { OrchestrationChainSummary } from './OrchestrationChainSummary';
import { FormRenderer, CompletedFormCard } from './FormRenderer';
import { useA2AStore } from '../store';
import type { A2AMessage, A2APart, FormSchema } from '../types';
import { isTextPart, isFilePart, isDataPart, isFileWithBytes, isFormData, formatErrorText, getMessageText } from '../types';

interface MessageBubbleProps {
  message: A2AMessage;
  /** Status of this message: 'pending' | 'sent' | 'failed' | undefined */
  pendingStatus?: 'pending' | 'sent' | 'failed';
  /** Name for an agent message whose metadata carries none (direct chat). */
  defaultAgentName?: string;
  className?: string;
}

interface MessagePartProps {
  part: A2APart;
  messageId: string;
  taskId?: string;
}

function MessagePart({ part, messageId, taskId }: MessagePartProps) {
  const { submitFormResponse, cancelForm, isFormCompleted, getFormData } = useA2AStore();

  const handleFormSubmit = useCallback(
    (data: Record<string, string>) => {
      submitFormResponse(messageId, taskId || '', data);
    },
    [messageId, taskId, submitFormResponse],
  );
  const handleFormCancel = useCallback(() => {
    cancelForm(messageId, taskId || '');
  }, [messageId, taskId, cancelForm]);

  if (isTextPart(part)) {
    return (
      <div className="prose prose-sm prose-inherit max-w-none break-words prose-p:my-1 prose-ul:my-1 prose-ol:my-1 prose-li:my-0">
        <ReactMarkdown>{part.text}</ReactMarkdown>
      </div>
    );
  }

  if (isFilePart(part)) {
    const file = part.file;
    if (file.mimeType.startsWith('image/')) {
      const src = isFileWithBytes(file) ? `data:${file.mimeType};base64,${file.bytes}` : file.uri;
      return <img src={src} alt={file.name || 'Image'} className="mt-2 h-auto max-w-full rounded-control" />;
    }
    return (
      <div className="mt-2 flex items-center gap-2 rounded-control bg-inset px-3 py-2 text-sm text-ink-secondary">
        <span className="truncate">
          {file.name || 'File'} ({file.mimeType})
        </span>
        {!isFileWithBytes(file) && (
          <a href={file.uri} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
            Download
          </a>
        )}
      </div>
    );
  }

  if (isDataPart(part)) {
    if (isFormData(part.data)) {
      if (isFormCompleted(messageId)) {
        return <CompletedFormCard data={getFormData(messageId) ?? null} className="mt-2" />;
      }
      return (
        <FormRenderer
          schema={part.data as unknown as FormSchema}
          messageId={messageId}
          taskId={taskId}
          onSubmit={handleFormSubmit}
          onCancel={handleFormCancel}
          className="mt-2"
        />
      );
    }
    return (
      <pre className="mt-2 overflow-x-auto rounded-control bg-inset p-3 font-mono text-xs text-ink-secondary">
        {JSON.stringify(part.data, null, 2)}
      </pre>
    );
  }

  return null;
}

/**
 * Message bubble: yours on the right (mint tint), the agent's on the left (inset).
 */
export const MessageBubble = memo(function MessageBubble({ message, pendingStatus, defaultAgentName, className }: MessageBubbleProps) {
  const isUser = message.role === 'user';
  const meta = (message.metadata ?? {}) as Record<string, unknown>;
  const agentName = (meta.agentName as string | undefined) ?? defaultAgentName;
  const isOrchestrated = Boolean(meta.orchestrated);
  const chain = meta.orchestrationChain as
    | {
        selectionMethod: 'llm' | 'keyword';
        consideredAgents: Array<{ name: string; selected: boolean }>;
        timings: { selectionMs: number; forwardingMs: number; totalMs: number };
      }
    | undefined;

  // A failed turn is not an answer: the raw provider text is detail, not the
  // reply. Trust only the server's `metadata.error` flag — every failure path in
  // ConversationManager sets it. Sniffing the wording instead would repaint real
  // answers as outages, since a fleet assistant legitimately says things like
  // "Error rate is 2%" or "the arm reached [180 deg]".
  const text = getMessageText(message);
  const isFailure = !isUser && meta.error === true;
  const failureDetail = isFailure ? formatErrorText(text).replace(/^Task failed:\s*/i, '') : '';

  return (
    <div className={cn('flex flex-col', isUser ? 'items-end' : 'items-start', className)}>
      {!isUser && isOrchestrated && chain && agentName && (
        <OrchestrationChainSummary agentName={agentName} chain={chain} className="w-full max-w-[85%]" />
      )}

      <div
        className={cn(
          'max-w-[85%] rounded-panel px-4 py-2.5 text-sm text-ink-primary sm:max-w-[75%]',
          isUser
            ? 'rounded-br-tag border border-primary/30 bg-primary/10'
            : isFailure
              ? 'rounded-bl-tag border border-signal-stopped/30 bg-signal-stopped/10'
              : 'rounded-bl-tag border border-line-subtle bg-inset',
          pendingStatus === 'pending' && 'opacity-70',
        )}
      >
        <div className="mb-1 flex items-center gap-1.5 text-xs text-ink-tertiary">
          <span className="font-medium">{isUser ? 'You' : agentName || 'Agent'}</span>
          {message.timestamp && !pendingStatus && (
            <span>· {new Date(message.timestamp).toLocaleTimeString(UI_DATE_LOCALE, { hour: '2-digit', minute: '2-digit' })}</span>
          )}
        </div>

        {isFailure ? (
          <div className="flex flex-col gap-1">
            <p className="font-medium text-signal-stopped">
              {agentName ? `${agentName}'s assistant is unavailable` : 'The assistant is unavailable'}
            </p>
            {failureDetail && (
              <p className="text-xs break-words text-ink-tertiary" title={failureDetail}>
                {failureDetail}
              </p>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-1">
            {message.parts.map((part, index) => (
              <MessagePart key={index} part={part} messageId={message.messageId} taskId={message.taskId} />
            ))}
          </div>
        )}

        {pendingStatus === 'pending' && (
          <div className="mt-2 flex items-center gap-2 text-xs text-ink-tertiary">
            <Spinner size="xs" color="current" />
            Sending…
          </div>
        )}
        {pendingStatus === 'failed' && (
          <div className="mt-2">
            <StatusTag tone="danger">Not sent</StatusTag>
          </div>
        )}
      </div>
    </div>
  );
});
