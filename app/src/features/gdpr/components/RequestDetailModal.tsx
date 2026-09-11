/**
 * @file RequestDetailModal.tsx
 * @description Detail of one GDPR request: facts, status timeline, export download and cancel
 * @feature gdpr
 */

import { useState } from 'react';
import { Download, XCircle } from 'lucide-react';
import { Button, KeyValueList, Modal, SkeletonText, StatusTag, confirm, humanizeStatus, toast } from '@/shared/components/ui';
import { useGDPRStore } from '../store';
import { REQUEST_TYPE_LABELS, formatDateTime, type GDPRRequest } from '../types';
import { errorMessage } from './errorMessage';
import { StatusBadge } from './StatusBadge';
import { SLABadge } from './SLABadge';

export interface RequestDetailModalProps {
  request: GDPRRequest | null;
  onClose: () => void;
}

const errMsg = (err: unknown) => errorMessage(err);

export function RequestDetailModal({ request, onClose }: RequestDetailModalProps) {
  const { selectedRequest, requestHistory, isLoadingRequest, cancelRequest, downloadExport, fetchMyRequests } = useGDPRStore();
  const [busy, setBusy] = useState<'cancel' | 'download' | null>(null);
  if (!request) return null;

  const r = selectedRequest?.id === request.id ? selectedRequest : request;
  const history = selectedRequest?.id === request.id ? requestHistory : [];
  const canCancel = ['pending', 'acknowledged'].includes(r.status);
  const canDownload = r.status === 'completed' && (r.requestType === 'access' || r.requestType === 'portability');
  const details = r.requestData && Object.keys(r.requestData).length > 0 ? r.requestData : null;

  const cancel = async () => {
    const ok = await confirm({
      title: 'Cancel this request?',
      description: 'Processing stops and the request is closed. You can file a new request at any time.',
      confirmLabel: 'Cancel request',
      cancelLabel: 'Keep request',
      tone: 'danger',
    });
    if (!ok) return;
    setBusy('cancel');
    try {
      await cancelRequest(r.id);
      toast.success('Request cancelled', { description: REQUEST_TYPE_LABELS[r.requestType] });
      void fetchMyRequests();
      onClose();
    } catch (err) {
      toast.error("Couldn't cancel request", { description: errMsg(err) });
    } finally {
      setBusy(null);
    }
  };

  const download = async () => {
    setBusy('download');
    try {
      const data = await downloadExport(r.id);
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `gdpr-export-${r.id}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success('Export ready', { description: a.download });
    } catch (err) {
      toast.error("Couldn't download export", { description: errMsg(err) });
    } finally {
      setBusy(null);
    }
  };

  return (
    <Modal
      isOpen
      onClose={onClose}
      size="lg"
      title={REQUEST_TYPE_LABELS[r.requestType]}
      description={`Submitted ${formatDateTime(r.submittedAt)}`}
      footer={
        <>
          {canCancel && (
            <Button variant="danger" leftIcon={<XCircle className="h-4 w-4" strokeWidth={1.75} />} isLoading={busy === 'cancel'} onClick={() => void cancel()}>
              Cancel request
            </Button>
          )}
          {canDownload && (
            <Button variant="secondary" leftIcon={<Download className="h-4 w-4" strokeWidth={1.75} />} isLoading={busy === 'download'} onClick={() => void download()}>
              Download export
            </Button>
          )}
          <Button variant="secondary" onClick={onClose}>Close</Button>
        </>
      }
    >
      <div className="flex flex-col gap-6">
        <KeyValueList
          items={[
            { label: 'Status', value: <StatusBadge status={r.status} /> },
            { label: 'SLA', value: <SLABadge request={r} /> },
            { label: 'Deadline', value: formatDateTime(r.slaDeadline) },
            { label: 'Acknowledged', value: r.acknowledgedAt ? formatDateTime(r.acknowledgedAt) : null },
            { label: 'Completed', value: r.completedAt ? formatDateTime(r.completedAt) : null },
            { label: 'Reference', value: r.id, mono: true },
          ]}
        />
        {r.rejectionReason && (
          <section className="flex flex-col gap-1">
            <h3 className="text-sm font-semibold text-ink-primary">Rejection reason</h3>
            <p className="text-sm text-ink-secondary">{r.rejectionReason}</p>
          </section>
        )}
        {details && (
          <section className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold text-ink-primary">Request details</h3>
            <pre className="overflow-x-auto rounded-control bg-inset p-3 font-mono text-xs text-ink-secondary">{JSON.stringify(details, null, 2)}</pre>
          </section>
        )}
        <section className="flex flex-col gap-3">
          <h3 className="text-sm font-semibold text-ink-primary">Status history</h3>
          {isLoadingRequest && history.length === 0 ? (
            <SkeletonText lines={2} />
          ) : history.length === 0 ? (
            <p className="text-sm text-ink-tertiary">No status changes yet.</p>
          ) : (
            <ol className="flex flex-col gap-3 border-l border-line pl-4">
              {history.map((h) => (
                <li key={h.id} className="flex flex-col gap-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusTag status={h.toStatus} size="sm">{humanizeStatus(h.toStatus)}</StatusTag>
                    <span className="text-[13px] text-ink-tertiary">{formatDateTime(h.timestamp)}</span>
                  </div>
                  {h.reason && <p className="text-[13px] text-ink-secondary">{h.reason}</p>}
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
    </Modal>
  );
}
