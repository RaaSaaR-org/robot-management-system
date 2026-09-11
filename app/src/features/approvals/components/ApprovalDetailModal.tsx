/**
 * @file ApprovalDetailModal.tsx
 * @description Detail of one approval request with the approve / reject decision
 * @feature approvals
 */

import { useEffect, useRef, useState } from 'react';
import { Check, X } from 'lucide-react';
import { Button, KeyValueList, Modal, SkeletonText, StatusTag, confirm, toast } from '@/shared/components/ui';
import { useAuthStore } from '@/features/auth/store/authStore';
import { useApprovalsStore } from '../store';
import type { ApprovalRequest } from '../types';
import { RejectApprovalModal } from './RejectApprovalModal';
import { errorMessage, humanize, priorityTone, slaInfo, statusTone, stepTone } from './approvalFormat';

export interface ApprovalDetailModalProps {
  /** The row that was clicked; the modal loads the full record by its id. */
  request: ApprovalRequest | null;
  onClose: () => void;
}

function SectionTitle({ children }: { children: string }) {
  return <h3 className="text-sm font-semibold text-ink-primary">{children}</h3>;
}

export function ApprovalDetailModal({ request, onClose }: ApprovalDetailModalProps) {
  const selectRequest = useApprovalsStore((s) => s.selectRequest);
  const selected = useApprovalsStore((s) => s.selectedRequest);
  const loading = useApprovalsStore((s) => s.selectedRequestLoading);
  const processApproval = useApprovalsStore((s) => s.processApproval);
  const user = useAuthStore((s) => s.user);
  const decidedBy = user?.email ?? user?.id ?? 'unknown-reviewer';

  const [approving, setApproving] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  // Review time is measured from opening the request until the decision.
  const openedAt = useRef(Date.now());

  const requestId = request?.id ?? null;
  useEffect(() => {
    openedAt.current = Date.now();
    void selectRequest(requestId);
  }, [requestId, selectRequest]);

  const approval = selected && selected.id === requestId ? selected : request;
  if (!approval) return null;

  const currentStep = approval.steps?.find((s) => s.status === 'awaiting');
  const actionable = Boolean(currentStep) && (approval.status === 'pending' || approval.status === 'in_progress' || approval.status === 'escalated');
  const sla = slaInfo(approval);
  const reviewSec = () => Math.max(1, Math.round((Date.now() - openedAt.current) / 1000));

  const approve = async () => {
    if (!currentStep) return;
    const effect = approval.blocksExecution ? 'the blocked task runs' : 'the change takes effect';
    const more = (approval.steps?.filter((s) => s.status === 'pending').length ?? 0) > 0;
    const ok = await confirm({
      title: 'Approve this request?',
      description: more
        ? `Your approval as ${humanize(currentStep.approverRole)} moves ${approval.requestNumber} to the next approver. Your decision is logged with your name for the audit trail.`
        : `${approval.requestNumber} is released and ${effect}. Your decision is logged with your name for the audit trail.`,
      confirmLabel: 'Approve',
    });
    if (!ok) return;
    setApproving(true);
    try {
      await processApproval(approval.id, currentStep.id, {
        decision: 'approve',
        decidedBy,
        reviewDurationSec: reviewSec(),
        competenceVerified: true,
      });
      toast.success('Request approved', { description: approval.requestNumber });
      onClose();
    } catch (err) {
      toast.error("Couldn't approve request", { description: errorMessage(err) });
    } finally {
      setApproving(false);
    }
  };

  const reject = async (reason: string) => {
    if (!currentStep) return;
    await processApproval(approval.id, currentStep.id, {
      decision: 'reject',
      decidedBy,
      decisionNotes: reason,
      reviewDurationSec: reviewSec(),
      competenceVerified: true,
    });
    onClose();
  };

  const footer = actionable ? (
    <>
      <Button variant="secondary" leftIcon={<X className="h-4 w-4" strokeWidth={1.75} />} onClick={() => setRejectOpen(true)} disabled={approving}>
        Reject…
      </Button>
      <Button leftIcon={<Check className="h-4 w-4" strokeWidth={1.75} />} onClick={() => void approve()} isLoading={approving} loadingText="Approving…">
        Approve
      </Button>
    </>
  ) : (
    <Button variant="secondary" onClick={onClose}>Close</Button>
  );

  return (
    <>
      <Modal isOpen={Boolean(request) && !rejectOpen} onClose={onClose} size="lg" title={approval.requestNumber} description={humanize(approval.entityType)} footer={footer}>
        <div className="flex flex-col gap-6">
          <div className="flex flex-wrap items-center gap-2">
            <StatusTag tone={statusTone(approval.status)}>{humanize(approval.status)}</StatusTag>
            <StatusTag tone={priorityTone(approval.priority)}>{humanize(approval.priority)}</StatusTag>
            <StatusTag tone={sla.tone}>{sla.label}</StatusTag>
          </div>

          <p className="max-w-[70ch] text-sm text-ink-secondary">{approval.requestReason}</p>

          <KeyValueList
            items={[
              { label: 'Entity', value: approval.entityId, mono: true },
              { label: 'Requested by', value: approval.requestedByUser?.name ?? approval.requestedBy },
              { label: 'Requested', value: new Date(approval.createdAt).toLocaleString() },
              { label: 'SLA deadline', value: new Date(approval.slaDeadline).toLocaleString() },
              { label: 'Affected robot', value: approval.affectedRobotId ?? undefined, mono: true },
              { label: 'Affected worker', value: approval.affectedUser?.name ?? approval.affectedUserId ?? undefined },
              { label: 'Blocks execution', value: approval.blocksExecution ? 'Yes, the task waits for this decision' : 'No' },
              { label: 'Rollback plan', value: approval.rollbackPlan?.description },
            ]}
          />

          <section className="flex flex-col gap-3">
            <SectionTitle>Approver chain</SectionTitle>
            {loading && !approval.steps ? (
              <SkeletonText lines={2} />
            ) : approval.steps && approval.steps.length > 0 ? (
              <ol className="flex flex-col divide-y divide-line-subtle rounded-control border border-line-subtle">
                {approval.steps.map((step, i) => (
                  <li key={step.id} className="flex flex-wrap items-start justify-between gap-2 px-4 py-3">
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-ink-primary">
                        {i + 1}. {humanize(step.approverRole)}
                      </div>
                      {step.decidedBy && (
                        <div className="text-[13px] text-ink-tertiary">
                          {step.decidedByUser?.name ?? step.decidedBy}
                          {step.decidedAt ? ` · ${new Date(step.decidedAt).toLocaleString()}` : ''}
                        </div>
                      )}
                      {step.decisionNotes && <p className="mt-1 text-[13px] text-ink-secondary">“{step.decisionNotes}”</p>}
                    </div>
                    <StatusTag tone={stepTone(step.status)}>{humanize(step.status)}</StatusTag>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-[13px] text-ink-tertiary">No approver chain recorded.</p>
            )}
          </section>

          {approval.workerViewpoint && (
            <section className="flex flex-col gap-2">
              <SectionTitle>Worker viewpoint</SectionTitle>
              <div className="rounded-control bg-inset p-4 text-sm text-ink-secondary">
                {approval.workerViewpoint.statement}
                <div className="mt-2 text-[13px] text-ink-tertiary">
                  Submitted {new Date(approval.workerViewpoint.submittedAt).toLocaleString()}
                </div>
              </div>
            </section>
          )}

          {approval.statusHistory && approval.statusHistory.length > 0 && (
            <section className="flex flex-col gap-2">
              <SectionTitle>History</SectionTitle>
              <ul className="flex flex-col gap-2">
                {approval.statusHistory.map((h) => (
                  <li key={h.id} className="flex flex-wrap items-baseline gap-x-2 text-[13px]">
                    <span className="text-ink-tertiary">{new Date(h.timestamp).toLocaleString()}</span>
                    <span className="text-ink-secondary">
                      {h.fromStatus ? `${humanize(h.fromStatus)} → ` : ''}
                      {humanize(h.toStatus)}
                      {h.changedBy ? ` by ${h.changedBy}` : ''}
                      {h.reason ? ` — ${h.reason}` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </Modal>

      <RejectApprovalModal
        isOpen={rejectOpen}
        requestNumber={approval.requestNumber}
        onClose={() => setRejectOpen(false)}
        onReject={async (reason) => {
          await reject(reason);
          setRejectOpen(false);
        }}
      />
    </>
  );
}
