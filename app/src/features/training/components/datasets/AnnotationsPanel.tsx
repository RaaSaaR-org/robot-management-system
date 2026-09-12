/**
 * @file AnnotationsPanel.tsx
 * @description VLM annotations (subtasks and VQA pairs) for the selected episode, and the job that fills them
 * @feature training
 */

import { MessageSquareText } from 'lucide-react';
import { Button, EmptyState, Panel } from '@/shared/components/ui';
import type { EpisodeAnnotation } from '../../types';

export interface AnnotationsPanelProps {
  annotation: EpisodeAnnotation | undefined;
  hasAny: boolean;
  annotating: boolean;
  onAnnotate: () => void;
}

export function AnnotationsPanel({ annotation, hasAny, annotating, onAnnotate }: AnnotationsPanelProps) {
  return (
    <Panel>
      <Panel.Header
        title="Annotations"
        titleAs="h2"
        actions={
          <Button variant="ghost" size="sm" data-testid="annotate-dataset" isLoading={annotating} loadingText="Queuing…" onClick={onAnnotate}>
            Annotate dataset
          </Button>
        }
      />
      <Panel.Body>
        {annotation ? (
          <div className="flex flex-col gap-4">
            <section className="flex flex-col gap-1.5">
              <h3 className="text-xs font-medium text-ink-tertiary">Subtasks</h3>
              {annotation.subtasks.length === 0 ? (
                <p className="text-sm text-ink-tertiary">No subtasks annotated.</p>
              ) : (
                annotation.subtasks.map((st, i) => (
                  <div key={i} className="flex items-baseline gap-3 text-sm">
                    <span className="w-24 shrink-0 tabular-nums text-ink-tertiary">
                      {st.startS.toFixed(1)}s – {st.endS.toFixed(1)}s
                    </span>
                    <span className="text-ink-secondary">{st.text}</span>
                  </div>
                ))
              )}
            </section>
            {annotation.vqa && annotation.vqa.length > 0 && (
              <section className="flex flex-col gap-2">
                <h3 className="text-xs font-medium text-ink-tertiary">VQA pairs</h3>
                {annotation.vqa.map((pair, i) => (
                  <div key={i} className="text-sm">
                    <p className="text-ink-secondary">Q: {pair.question}</p>
                    <p className="text-ink-tertiary">A: {pair.answer}</p>
                  </div>
                ))}
              </section>
            )}
          </div>
        ) : (
          <EmptyState
            size="sm"
            icon={<MessageSquareText />}
            title={hasAny ? 'No annotations for this episode' : 'No annotations yet'}
            description={
              hasAny
                ? 'Other episodes of this dataset are annotated.'
                : 'Annotate the dataset to fill timestamped subtasks and VQA pairs for every episode.'
            }
          />
        )}
      </Panel.Body>
    </Panel>
  );
}
