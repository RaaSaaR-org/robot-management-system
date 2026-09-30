/**
 * @file ExperimentDetailPage.tsx
 * @description `/experiments/:id` — the hypothesis, the arm table, the
 *   comparison chart, the verdict and the discussion thread (TASK-242).
 * @feature experiments
 */

import { useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  Button,
  ErrorState,
  KeyValueList,
  PageHeader,
  Panel,
  Spinner,
  StatusTag,
  confirm,
  errorMessage,
  toast,
} from '@/shared/components/ui';
import { SocialPanel } from '@/features/social';
import { useExperiment } from '../hooks/useExperiments';
import { ArmTable } from '../components/ArmTable';
import { ArmComparisonChart } from '../components/ArmComparisonChart';
import { ApproveExperimentDialog } from '../components/ApproveExperimentDialog';

export function ExperimentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { experiment, loading, error, reload, approve, reject, cancel } = useExperiment(id);
  const [reviewing, setReviewing] = useState(false);

  if (loading && !experiment) return <Spinner />;
  if (error || !experiment) {
    return <ErrorState title="Couldn't load this experiment" message={error} onRetry={() => void reload()} />;
  }

  const guarded = (fn: () => Promise<unknown>, done: string) => async () => {
    try {
      await fn();
      toast.success(done);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  const onCancel = async () => {
    const ok = await confirm({
      title: 'Cancel this experiment?',
      description: 'Outstanding training runs and evaluations are cancelled. Arms already scored keep their results.',
      confirmLabel: 'Cancel experiment',
      cancelLabel: 'Keep it',
      tone: 'danger',
    });
    if (ok) await guarded(cancel, 'Experiment cancelled')();
  };
  const cancellable = ['proposed', 'approved', 'running'].includes(experiment.status);
  const { verdict } = experiment;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        back={{ to: '/experiments', label: 'Experiments' }}
        title={experiment.title}
        description={experiment.hypothesis}
        meta={<StatusTag status={experiment.status} dot />}
        actions={
          <>
            {cancellable && (
              <Button variant="secondary" onClick={() => void onCancel()}>
                Cancel
              </Button>
            )}
            {experiment.status === 'proposed' && <Button onClick={() => setReviewing(true)}>Review</Button>}
          </>
        }
      />
      <Panel>
        <KeyValueList
          items={[
            { label: 'Proposed by', value: `${experiment.displayName} (${experiment.actorType})` },
            { label: 'Approved by', value: experiment.approvedBy },
            { label: 'Model', value: `${experiment.baseModel} · ${experiment.fineTuneMethod}` },
            {
              label: 'Evaluation',
              value: `${experiment.evaluation.rolloutCount} sim rollouts per arm in ${experiment.evaluation.environment}`,
            },
            { label: 'Budget', value: `${experiment.budget.maxGpuHours} GPU hours, ${experiment.budget.maxArms} arms` },
            ...(experiment.rejectedReason ? [{ label: 'Rejected because', value: experiment.rejectedReason }] : []),
          ]}
        />
      </Panel>
      {verdict && (
        <Panel>
          <div className="flex flex-col gap-2" data-testid="verdict">
            <div className="text-sm font-semibold text-ink-primary">
              {verdict.winnerArmId
                ? `Winner: ${experiment.arms.find((a) => a.id === verdict.winnerArmId)?.name ?? verdict.winnerArmId}`
                : 'No winner'}
            </div>
            <p className="text-[13px] text-ink-secondary">{verdict.confidenceNote}</p>
            <p className="text-[12px] text-ink-tertiary">
              Each arm is compared to the baseline with a two-proportion z-test at |z| &gt; {verdict.criticalZ.toFixed(2)}
              {' '}(5% across all comparisons).
            </p>
          </div>
        </Panel>
      )}
      <Panel>
        <div className="flex flex-col gap-5">
          <ArmComparisonChart arms={experiment.arms} winnerArmId={verdict?.winnerArmId} />
          <ArmTable arms={experiment.arms} verdict={verdict} />
        </div>
      </Panel>
      <Panel>
        <SocialPanel subject={{ subjectType: 'experiment', subjectId: experiment.id }} />
      </Panel>
      <ApproveExperimentDialog
        experiment={reviewing ? experiment : null}
        onClose={() => setReviewing(false)}
        onApprove={guarded(approve, 'Experiment approved — training started')}
        onReject={guarded(() => reject(), 'Experiment rejected')}
      />
    </div>
  );
}
