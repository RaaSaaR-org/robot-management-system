/**
 * @file PipelineBreadcrumb.tsx
 * @description Small "Step N of 5" chip linking back to the training pipeline
 * overview. Placed at the top of feature pages that are part of the pipeline.
 * @feature shared
 */

import { Link } from 'react-router-dom';
import { cn } from '@/shared/utils/cn';
import { focusRing } from './styles';

export type PipelineStage = 'collect' | 'dataset' | 'train' | 'evaluate' | 'deploy';

const STAGE_INFO: Record<PipelineStage, { number: number; label: string }> = {
  collect: { number: 1, label: 'Collect' },
  dataset: { number: 2, label: 'Dataset' },
  train: { number: 3, label: 'Train' },
  evaluate: { number: 4, label: 'Evaluate' },
  deploy: { number: 5, label: 'Deploy' },
};

export interface PipelineBreadcrumbProps {
  /** Which stage this page represents */
  stage: PipelineStage;
  /** Hide on small screens (default: true) */
  hideOnMobile?: boolean;
  className?: string;
}

/**
 * @example
 * ```tsx
 * <PipelineBreadcrumb stage="train" />
 * ```
 */
export function PipelineBreadcrumb({ stage, hideOnMobile = true, className }: PipelineBreadcrumbProps) {
  const info = STAGE_INFO[stage];
  return (
    <Link
      to="/pipeline"
      className={cn(
        'inline-flex w-fit items-center gap-1.5 whitespace-nowrap rounded-control border border-line bg-inset px-2.5 py-1 text-xs font-medium text-ink-tertiary',
        'transition-colors duration-150 hover:border-line-strong hover:text-ink-primary',
        focusRing,
        hideOnMobile && 'hidden sm:inline-flex',
        className,
      )}
    >
      <span className="tabular-nums text-primary">{info.number}/5</span>
      <span aria-hidden="true">·</span>
      <span>{info.label} stage</span>
      <span className="text-ink-muted">· Pipeline overview</span>
    </Link>
  );
}
