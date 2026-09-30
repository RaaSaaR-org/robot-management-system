/**
 * @file CommentThread.tsx
 * @description Comments on one subject: top-level comments with one level of
 *   replies, a composer, and edit/delete on the viewer's own comments. A
 *   deleted comment with replies stays as a placeholder so the thread reads.
 * @feature social
 */

import { useState } from 'react';
import { Button, Textarea, toast, errorMessage } from '@/shared/components/ui';
import { ActorBadge } from './ActorBadge';
import { EvidenceChips } from './EvidenceChips';
import type { Actor, CommentDTO, CommentThreadDTO } from '../types/social.types';

export interface CommentThreadProps {
  threads: CommentThreadDTO[];
  me: Actor | null;
  onAdd: (body: string, parentId?: string | null) => Promise<void>;
  onEdit: (id: string, body: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

function isMine(c: CommentDTO, me: Actor | null): boolean {
  return !!me && c.actorType === me.actorType && c.actorId === me.actorId;
}

function Composer({ placeholder, submitLabel, initial = '', onSubmit, onCancel }: {
  placeholder: string;
  submitLabel: string;
  initial?: string;
  onSubmit: (body: string) => Promise<void>;
  onCancel?: () => void;
}) {
  const [body, setBody] = useState(initial);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!body.trim()) return;
    setBusy(true);
    try {
      await onSubmit(body.trim());
      setBody('');
    } catch (err) {
      toast.error("Couldn't save the comment", { description: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-col gap-2">
      <Textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder={placeholder} rows={2} aria-label={placeholder} />
      <div className="flex gap-2">
        <Button size="sm" onClick={() => void submit()} disabled={busy || !body.trim()}>
          {submitLabel}
        </Button>
        {onCancel && (
          <Button size="sm" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
    </div>
  );
}

function CommentItem({ c, me, onEdit, onDelete, onReply }: {
  c: CommentDTO;
  me: Actor | null;
  onEdit: CommentThreadProps['onEdit'];
  onDelete: CommentThreadProps['onDelete'];
  onReply?: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const when = new Date(c.createdAt).toLocaleString();
  if (c.deletedAt) {
    return <p className="text-sm italic text-ink-muted" data-testid="comment-deleted">This comment was deleted.</p>;
  }
  const remove = async () => {
    try {
      await onDelete(c.id);
    } catch (err) {
      toast.error("Couldn't delete the comment", { description: errorMessage(err) });
    }
  };
  return (
    <div className="flex flex-col gap-1.5" data-testid="comment">
      <ActorBadge actor={c} meta={`${when}${c.editedAt ? ' · edited' : ''}`} />
      {editing ? (
        <Composer
          placeholder="Edit comment"
          submitLabel="Save"
          initial={c.body}
          onSubmit={async (body) => {
            await onEdit(c.id, body);
            setEditing(false);
          }}
          onCancel={() => setEditing(false)}
        />
      ) : (
        <p className="whitespace-pre-wrap text-sm text-ink-secondary">{c.body}</p>
      )}
      <EvidenceChips evidence={c.evidence} />
      {!editing && (
        <div className="flex gap-3 text-xs">
          {onReply && (
            <button type="button" className="text-ink-muted hover:text-ink-primary" onClick={onReply}>
              Reply
            </button>
          )}
          {isMine(c, me) && (
            <>
              <button type="button" className="text-ink-muted hover:text-ink-primary" onClick={() => setEditing(true)}>
                Edit
              </button>
              <button type="button" className="text-ink-muted hover:text-ink-primary" onClick={() => void remove()}>
                Delete
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export function CommentThread({ threads, me, onAdd, onEdit, onDelete }: CommentThreadProps) {
  const [replyTo, setReplyTo] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-4" data-testid="comment-thread">
      {threads.length === 0 && <p className="text-sm text-ink-tertiary">No comments yet.</p>}
      {threads.map((t) => (
        <div key={t.id} className="flex flex-col gap-3">
          <CommentItem c={t} me={me} onEdit={onEdit} onDelete={onDelete} onReply={t.deletedAt ? undefined : () => setReplyTo(t.id)} />
          {(t.replies.length > 0 || replyTo === t.id) && (
            <div className="ml-4 flex flex-col gap-3 border-l border-line-subtle pl-4">
              {t.replies.map((r) => (
                <CommentItem key={r.id} c={r} me={me} onEdit={onEdit} onDelete={onDelete} />
              ))}
              {replyTo === t.id && (
                <Composer
                  placeholder="Write a reply"
                  submitLabel="Reply"
                  onSubmit={async (body) => {
                    await onAdd(body, t.id);
                    setReplyTo(null);
                  }}
                  onCancel={() => setReplyTo(null)}
                />
              )}
            </div>
          )}
        </div>
      ))}
      <Composer placeholder="Add a comment" submitLabel="Comment" onSubmit={(body) => onAdd(body)} />
    </div>
  );
}
