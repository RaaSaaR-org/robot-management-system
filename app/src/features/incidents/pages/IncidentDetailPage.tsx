/**
 * @file IncidentDetailPage.tsx
 * @description One incident: move it through its lifecycle, meet its
 *              notification deadlines, read what happened
 * @feature incidents
 */

import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { ArrowRight, Pencil } from 'lucide-react';
import {
  Button, ErrorState, Modal,
  PageHeader, Panel, RowActions,
  SkeletonText, confirm,
  errorMessage, toast,
  type RowActionItem,
} from '@/shared/components/ui';
import { SeverityBadge } from '../components/SeverityBadge';
import { StatusBadge } from '../components/StatusBadge';
import { IncidentDetailBody } from '../components/IncidentDetailBody';
import { ReportIncidentModal } from '../components/ReportIncidentModal';
import { useIncident } from '../hooks/useIncidents';
import { useIncidentsStore } from '../store/incidentsStore';
import { humanizeMachineText } from '../utils/humanize';
import { OTHER_TRANSITIONS, PRIMARY_TRANSITION, type IncidentTransition } from '../utils/tones';
import type { IncidentNotification } from '../types/incidents.types';
import { AUTHORITY_LABELS, INCIDENT_STATUS_LABELS, INCIDENT_TYPE_LABELS, REGULATION_LABELS } from '../types/incidents.types';

const BACK = { to: '/alerts?tab=incidents', label: 'Incidents' };

/** Detail page for one incident. */
export function IncidentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { incident, isLoading, fetchIncident, update, markNotificationSent, generateNotificationContent } = useIncident(id);
  const [pending, setPending] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [generated, setGenerated] = useState<{ title: string; text: string } | null>(null);

  const current = incident && incident.id === id ? incident : null;

  if (!current && isLoading) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader eyebrow="Operate" back={BACK} title="Loading…" />
        <Panel>
          <SkeletonText lines={4} />
        </Panel>
      </div>
    );
  }

  if (!current) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader eyebrow="Operate" back={BACK} title="Incident" />
        <Panel>
          <ErrorState
            title="Couldn't load this incident"
            message="It may have been deleted, or the server is not reachable."
            onRetry={id ? () => void fetchIncident(id) : undefined}
          />
        </Panel>
      </div>
    );
  }

  const text = humanizeMachineText(current.description);

  const transition = async (t: IncidentTransition) => {
    const ok = await confirm({
      title: `${t.verb} ${current.incidentNumber}?`,
      description: 'The status changes for everyone and the change is logged for the regulator.',
      confirmLabel: t.verb,
    });
    if (!ok) return;
    setPending(true);
    try {
      const updated = await update({ status: t.to });
      if (!updated) throw new Error('The server did not accept the change.');
      toast.success('Incident updated', { description: `Now ${INCIDENT_STATUS_LABELS[t.to].toLowerCase()}` });
    } catch (err) {
      toast.error("Couldn't update incident", { description: errorMessage(err) });
    } finally {
      setPending(false);
    }
  };

  const askMarkSent = async (n: IncidentNotification) => {
    const ok = await confirm({
      title: `Mark ${REGULATION_LABELS[n.regulation]} notification as sent?`,
      description: 'Record that the authority was notified. This is logged and cannot be undone.',
      confirmLabel: 'Mark sent',
    });
    if (!ok) return;
    await markNotificationSent(n.id);
    const fresh = useIncidentsStore.getState().selectedIncident?.notifications?.find((x) => x.id === n.id);
    if (fresh && (fresh.status === 'sent' || fresh.status === 'acknowledged')) {
      toast.success('Notification marked sent', { description: AUTHORITY_LABELS[n.authority] });
    } else {
      toast.error("Couldn't mark the notification as sent");
    }
  };

  const generate = async (n: IncidentNotification) => {
    const content = await generateNotificationContent(n.id);
    if (content) setGenerated({ title: `${AUTHORITY_LABELS[n.authority]} notification`, text: content });
    else toast.error("Couldn't generate the notification text");
  };

  const copy = async () => {
    if (!generated) return;
    try {
      await navigator.clipboard.writeText(generated.text);
      toast.success('Copied');
    } catch {
      toast.error("Couldn't copy", { description: 'Select the text and copy it by hand.' });
    }
  };

  const primary = PRIMARY_TRANSITION[current.status];
  const others: RowActionItem[] = (OTHER_TRANSITIONS[current.status] ?? []).map((t) => ({
    label: t.verb,
    onSelect: () => void transition(t),
  }));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Operate"
        back={BACK}
        title={current.title}
        description={text.summary}
        meta={
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[13px] tabular-nums text-ink-tertiary">{current.incidentNumber}</span>
            <SeverityBadge severity={current.severity} />
            <StatusBadge status={current.status} />
            <span className="text-[13px] text-ink-tertiary">{INCIDENT_TYPE_LABELS[current.type]}</span>
          </div>
        }
        actions={
          <>
            <Button variant="secondary" leftIcon={<Pencil className="h-4 w-4" strokeWidth={1.75} />} onClick={() => setEditOpen(true)}>
              Edit details
            </Button>
            {primary && (
              <Button
                isLoading={pending}
                rightIcon={<ArrowRight className="h-4 w-4" strokeWidth={1.75} />}
                onClick={() => void transition(primary)}
              >
                {primary.verb}
              </Button>
            )}
            {others.length > 0 && <RowActions label="More actions" items={others} />}
          </>
        }
      />
      <IncidentDetailBody
        incident={current}
        summary={text.summary}
        raw={text.raw}
        onMarkSent={(n) => void askMarkSent(n)}
        onGenerate={(n) => void generate(n)}
      />
      <ReportIncidentModal isOpen={editOpen} onClose={() => setEditOpen(false)} incident={current} />
      <Modal
        isOpen={generated !== null}
        onClose={() => setGenerated(null)}
        title="Notification text"
        description={generated?.title}
        size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={() => setGenerated(null)}>Close</Button>
            <Button onClick={() => void copy()}>Copy to clipboard</Button>
          </>
        }
      >
        <pre className="max-h-[60vh] overflow-y-auto whitespace-pre-wrap break-words rounded-control bg-inset p-4 font-sans text-sm text-ink-primary">
          {generated?.text}
        </pre>
      </Modal>
    </div>
  );
}
