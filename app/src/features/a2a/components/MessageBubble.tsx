/**
 * @file MessageBubble.tsx
 * @description Individual message display component with form and pending support
 * @feature a2a
 */

import { memo, useCallback } from 'react';
import { cn } from '@/shared/utils';
import { Spinner } from '@/shared/components/ui/Spinner';
import type { A2AMessage, A2APart, FormSchema } from '../types';
import { isTextPart, isFilePart, isDataPart, isFileWithBytes, isFormData } from '../types';
import { FormRenderer, CompletedFormCard } from './FormRenderer';
import { useA2AStore } from '../store';

interface MessageBubbleProps {
  message: A2AMessage;
  /** Status of this message: 'pending' | 'sent' | 'failed' | undefined */
  pendingStatus?: 'pending' | 'sent' | 'failed';
  className?: string;
}

interface MessagePartProps {
  part: A2APart;
  messageId: string;
  taskId?: string;
}

/**
 * Render a single message part
 */
function MessagePart({ part, messageId, taskId }: MessagePartProps) {
  const { submitFormResponse, cancelForm, isFormCompleted, getFormData } = useA2AStore();

  // Handle form submission
  const handleFormSubmit = useCallback(
    (data: Record<string, string>) => {
      submitFormResponse(messageId, taskId || '', data);
    },
    [messageId, taskId, submitFormResponse]
  );

  // Handle form cancellation
  const handleFormCancel = useCallback(() => {
    cancelForm(messageId, taskId || '');
  }, [messageId, taskId, cancelForm]);

  if (isTextPart(part)) {
    return (
      <p className="whitespace-pre-wrap break-words">{part.text}</p>
    );
  }

  if (isFilePart(part)) {
    const file = part.file;
    const isImage = file.mimeType.startsWith('image/');

    if (isImage) {
      const src = isFileWithBytes(file)
        ? `data:${file.mimeType};base64,${file.bytes}`
        : file.uri;

      return (
        <img
          src={src}
          alt={file.name || 'Image'}
          className="max-w-full h-auto rounded-lg mt-2"
        />
      );
    }

    // Non-image file
    return (
      <div className="flex items-center gap-2 p-3 glass-subtle rounded-lg mt-2">
        <span className="text-sm text-gray-700 dark:text-gray-300">
          {file.name || 'File'} ({file.mimeType})
        </span>
        {!isFileWithBytes(file) && (
          <a
            href={file.uri}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary-500 hover:text-primary-600 hover:underline text-sm transition-colors"
          >
            Download
          </a>
        )}
      </div>
    );
  }

  if (isDataPart(part)) {
    // Check if this is a form schema
    if (isFormData(part.data)) {
      const formCompleted = isFormCompleted(messageId);
      const formData = getFormData(messageId);

      // Show completed form card if already submitted/canceled
      if (formCompleted) {
        return <CompletedFormCard data={formData ?? null} className="mt-2" />;
      }

      // Show interactive form
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

    // Regular data - show as JSON
    return (
      <pre className="glass-subtle p-3 rounded-lg text-sm overflow-x-auto mt-2 text-gray-700 dark:text-gray-300">
        {JSON.stringify(part.data, null, 2)}
      </pre>
    );
  }

  return null;
}

/**
 * Pending indicator component
 */
function PendingIndicator({ status }: { status: 'pending' | 'sent' | 'failed' }) {
  if (status === 'pending') {
    return (
      <div className="flex items-center gap-2 mt-2 text-xs text-primary-200">
        <Spinner size="xs" color="white" />
        <span>Sending...</span>
      </div>
    );
  }

  if (status === 'failed') {
    return (
      <div className="flex items-center gap-2 mt-2 text-xs text-red-300">
        <span className="w-3 h-3 rounded-full bg-red-400" />
        <span>Failed to send</span>
      </div>
    );
  }

  return null;
}

/**
 * Message bubble component
 */
export const MessageBubble = memo(function MessageBubble({
  message,
  pendingStatus,
  className,
}: MessageBubbleProps) {
  const isUser = message.role === 'user';

  // Get agent name from metadata if available (for orchestration mode)
  const agentName = message.metadata?.agentName as string | undefined;
  const isOrchestrated = message.metadata?.orchestrated as boolean | undefined;

  return (
    <div
      className={cn(
        'flex',
        isUser ? 'justify-end' : 'justify-start',
        className
      )}
    >
      <div
        className={cn(
          'max-w-[80%] rounded-2xl px-4 py-3',
          isUser
            ? 'bg-primary-500 text-white rounded-br-md shadow-md'
            : isOrchestrated
              ? 'glass-card border border-accent-200 dark:border-accent-800/50 text-gray-900 dark:text-gray-100 rounded-bl-md'
              : 'glass-card text-gray-900 dark:text-gray-100 rounded-bl-md',
          pendingStatus === 'pending' && 'opacity-70',
          'transition-all duration-300'
        )}
      >
        {/* Role label with agent name if available */}
        <div
          className={cn(
            'text-xs mb-1 flex items-center gap-1.5',
            isUser
              ? 'text-primary-100'
              : 'text-gray-500 dark:text-gray-400'
          )}
        >
          {isUser ? (
            'You'
          ) : (
            <>
              {agentName || 'Agent'}
              {isOrchestrated && (
                <span className="px-1.5 py-0.5 bg-accent-100 dark:bg-accent-900/30 text-accent-600 dark:text-accent-400 rounded text-[10px] font-medium">
                  Orchestrated
                </span>
              )}
            </>
          )}
        </div>

        {/* Message parts */}
        <div className="space-y-1">
          {message.parts.map((part, index) => (
            <MessagePart
              key={index}
              part={part}
              messageId={message.messageId}
              taskId={message.taskId}
            />
          ))}
        </div>

        {/* Pending indicator */}
        {pendingStatus && pendingStatus !== 'sent' && (
          <PendingIndicator status={pendingStatus} />
        )}

        {/* Timestamp */}
        {message.timestamp && !pendingStatus && (
          <div
            className={cn(
              'text-xs mt-1',
              isUser
                ? 'text-primary-200'
                : 'text-gray-400 dark:text-gray-500'
            )}
          >
            {new Date(message.timestamp).toLocaleTimeString()}
          </div>
        )}
      </div>
    </div>
  );
});
