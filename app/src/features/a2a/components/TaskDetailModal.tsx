/**
 * @file TaskDetailModal.tsx
 * @description Kit Modal with one A2A task: state, ids, status message, history and artifacts
 * @feature a2a
 */

import { Button, KeyValueList, Modal } from '@/shared/components/ui';
import { UI_DATE_LOCALE } from '@/shared/utils';
import { TaskStatusBadge } from './TaskStatusBadge';
import type { A2ATask } from '../types';
import { formatErrorText, getEffectiveTaskState, getMessageText, isErrorText } from '../types';

interface TaskDetailModalProps {
  task: A2ATask | null;
  onClose: () => void;
}

function formatTime(value?: string): string {
  return value ? new Date(value).toLocaleString(UI_DATE_LOCALE) : '';
}

/**
 * Task detail modal. Open while `task` is set.
 */
export function TaskDetailModal({ task, onClose }: TaskDetailModalProps) {
  const state = task ? getEffectiveTaskState(task) : 'unknown';
  const message = task?.status.message ? getMessageText(task.status.message) : '';
  const isError = state === 'failed' && isErrorText(message);
  const history = task?.history ?? [];
  const artifacts = task?.artifacts ?? [];

  return (
    <Modal
      isOpen={task !== null}
      onClose={onClose}
      size="lg"
      title={task ? `Task ${task.id.slice(0, 8)}` : 'Task'}
      footer={<Button variant="secondary" onClick={onClose}>Close</Button>}
    >
      {task && (
        <div className="flex flex-col gap-5">
          <div>
            <TaskStatusBadge state={state} />
          </div>
          <KeyValueList
            items={[
              { label: 'Task ID', value: task.id, mono: true },
              { label: 'Context ID', value: task.contextId, mono: true },
              { label: 'Created', value: formatTime(task.createdAt) },
              { label: 'Updated', value: formatTime(task.status.timestamp ?? task.updatedAt) },
            ]}
          />
          {message && (
            <section className="flex flex-col gap-2">
              <h3 className="text-sm font-semibold text-ink-primary">
                {isError ? 'Error' : 'Status message'}
              </h3>
              <p
                className={
                  isError
                    ? 'rounded-control border border-signal-stopped/30 bg-signal-stopped/10 px-3 py-2 text-sm text-signal-stopped break-words'
                    : 'rounded-control bg-inset px-3 py-2 text-sm text-ink-secondary whitespace-pre-wrap break-words'
                }
              >
                {isError ? formatErrorText(message) : message}
              </p>
            </section>
          )}
          {history.length > 0 && (
            <section className="flex flex-col gap-2">
              <h3 className="text-sm font-semibold text-ink-primary">History</h3>
              <ol className="flex flex-col gap-2">
                {history.map((m) => (
                  <li key={m.messageId} className="rounded-control bg-inset px-3 py-2">
                    <div className="text-xs text-ink-tertiary">
                      {m.role === 'user' ? 'You' : 'Agent'}
                      {m.timestamp ? ` · ${new Date(m.timestamp).toLocaleTimeString(UI_DATE_LOCALE)}` : ''}
                    </div>
                    <p className="text-sm text-ink-secondary whitespace-pre-wrap break-words">
                      {getMessageText(m) || 'No text content'}
                    </p>
                  </li>
                ))}
              </ol>
            </section>
          )}
          {artifacts.length > 0 && (
            <section className="flex flex-col gap-2">
              <h3 className="text-sm font-semibold text-ink-primary">Artifacts</h3>
              <pre className="max-h-[40vh] overflow-auto rounded-control bg-inset p-3 font-mono text-xs text-ink-secondary">
                {JSON.stringify(artifacts, null, 2)}
              </pre>
            </section>
          )}
        </div>
      )}
    </Modal>
  );
}
