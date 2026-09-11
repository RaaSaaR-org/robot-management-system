/**
 * @file EventDetailModal.tsx
 * @description Kit Modal with one A2A event: ids, content and the raw payload
 * @feature a2a
 */

import { Badge, Button, KeyValueList, Modal } from '@/shared/components/ui';
import { UI_DATE_LOCALE } from '@/shared/utils';
import type { A2AEvent, A2APart } from '../types';
import { isFilePart, isFileWithBytes, isTextPart } from '../types';

/** Short label for a non-text message part. */
function partLabel(part: A2APart): string {
  if (isFilePart(part)) {
    const name = part.file.name || (isFileWithBytes(part.file) ? 'embedded file' : part.file.uri);
    return `File: ${name} (${part.file.mimeType})`;
  }
  return `Data: ${Object.keys(part.kind === 'data' ? part.data : {}).join(', ') || 'structured payload'}`;
}

/**
 * Event detail modal. Open while `event` is set.
 */
export function EventDetailModal({ event, onClose }: { event: A2AEvent | null; onClose: () => void }) {
  const parts = event?.content.parts ?? [];
  const text = parts.filter(isTextPart).map((p) => p.text).join('\n');
  const others = parts.filter((p) => !isTextPart(p));

  return (
    <Modal
      isOpen={event !== null}
      onClose={onClose}
      size="lg"
      title="Event"
      description={event ? new Date(event.timestamp).toLocaleString(UI_DATE_LOCALE) : undefined}
      footer={<Button variant="secondary" onClick={onClose}>Close</Button>}
    >
      {event && (
        <div className="flex flex-col gap-5">
          <KeyValueList
            items={[
              { label: 'Actor', value: event.actor },
              { label: 'Role', value: event.content.role === 'user' ? 'User' : 'Agent' },
              { label: 'Event ID', value: event.id, mono: true },
              { label: 'Message ID', value: event.content.messageId, mono: true },
              { label: 'Context ID', value: event.content.contextId, mono: true },
              { label: 'Task ID', value: event.content.taskId, mono: true },
            ]}
          />
          <section className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold text-ink-primary">Content</h3>
            {text ? (
              <p className="rounded-control bg-inset px-3 py-2 text-sm text-ink-secondary whitespace-pre-wrap break-words">
                {text}
              </p>
            ) : (
              others.length === 0 && <p className="text-sm text-ink-muted">No content</p>
            )}
            {others.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {others.map((p, i) => (
                  <Badge key={i} variant="neutral" size="sm">
                    {partLabel(p)}
                  </Badge>
                ))}
              </div>
            )}
          </section>
          <section className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold text-ink-primary">Payload</h3>
            <pre className="max-h-[60vh] overflow-auto rounded-control bg-inset p-3 font-mono text-xs text-ink-secondary">
              {JSON.stringify(event.content.parts, null, 2)}
            </pre>
          </section>
        </div>
      )}
    </Modal>
  );
}
