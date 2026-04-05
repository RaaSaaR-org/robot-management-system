/**
 * @file PipelineBreadcrumb.tsx
 * @description Small "Step N of 5" pill linking back to the training pipeline
 * overview. Placed at the top of feature pages that are part of the pipeline.
 * @feature shared
 */

import { Link } from 'react-router-dom';
import { cn } from '@/shared/utils/cn';

// ============================================================================
// TYPES
// ============================================================================

export type PipelineStage = 'collect' | 'dataset' | 'train' | 'evaluate' | 'deploy';

const STAGE_INFO: Record<PipelineStage, { number: number; label: string }> = {
  collect: { number: 1, label: 'Collect' },
  dataset: { number: 2, label: 'Dataset' },
  train: { number: 3, label: 'Train' },
  evaluate: { number: 4, label: 'Evaluate' },
  deploy: { number: 5, label: 'Deploy' },
};

// ============================================================================
// COMPONENT
// ============================================================================

export interface PipelineBreadcrumbProps {
  /** Which stage this page represents */
  stage: PipelineStage;
  /** Hide on small screens (default: true) */
  hideOnMobile?: boolean;
  className?: string;
}

export function PipelineBreadcrumb({
  stage,
  hideOnMobile = true,
  className,
}: PipelineBreadcrumbProps) {
  const info = STAGE_INFO[stage];
  return (
    <Link
      to="/pipeline"
      className={cn(
        'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-brand text-xs font-medium',
        'bg-glass-subtle text-theme-muted hover:text-theme-primary hover:bg-glass-bg',
        'border border-glass-subtle transition-all whitespace-nowrap',
        hideOnMobile && 'hidden sm:inline-flex',
        className
      )}
    >
      <span className="text-cobalt-400 font-mono">{info.number}/5</span>
      <span>·</span>
      <span>{info.label} stage</span>
      <span className="text-theme-muted/70">· Pipeline overview</span>
    </Link>
  );
}
