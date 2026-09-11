/**
 * @file ReportIncidentModal.tsx
 * @description FormModal to report a new incident, or edit an existing one's details
 * @feature incidents
 */

import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FormField, FormModal, Input, Select, Textarea, toast } from '@/shared/components/ui';
import { useRobotsStore, selectRobots } from '@/features/robots/store/robotsStore';
import { useIncidentsStore } from '../store/incidentsStore';
import type { Incident, IncidentSeverity, IncidentType } from '../types/incidents.types';
import { INCIDENT_SEVERITY_LABELS, INCIDENT_TYPE_LABELS } from '../types/incidents.types';

export interface ReportIncidentModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** When set, the modal edits this incident instead of reporting a new one */
  incident?: Incident | null;
}

const TYPE_OPTIONS = (Object.keys(INCIDENT_TYPE_LABELS) as IncidentType[]).map((t) => ({
  value: t,
  label: INCIDENT_TYPE_LABELS[t],
}));
const SEVERITY_OPTIONS = (Object.keys(INCIDENT_SEVERITY_LABELS) as IncidentSeverity[]).map((s) => ({
  value: s,
  label: INCIDENT_SEVERITY_LABELS[s],
}));

interface FieldErrors {
  title?: string;
  type?: string;
  description?: string;
}

/** Report (create) or edit an incident. */
export function ReportIncidentModal({ isOpen, onClose, incident = null }: ReportIncidentModalProps) {
  const navigate = useNavigate();
  const createIncident = useIncidentsStore((s) => s.createIncident);
  const updateIncident = useIncidentsStore((s) => s.updateIncident);
  const robots = useRobotsStore(selectRobots);
  const fetchRobots = useRobotsStore((s) => s.fetchRobots);
  const isEdit = incident !== null;

  const [title, setTitle] = useState('');
  const [type, setType] = useState<IncidentType | ''>('');
  const [severity, setSeverity] = useState<IncidentSeverity>('medium');
  const [robotId, setRobotId] = useState('');
  const [description, setDescription] = useState('');
  const [detectedAt, setDetectedAt] = useState('');
  const [rootCause, setRootCause] = useState('');
  const [resolution, setResolution] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string>();
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setTitle(incident?.title ?? '');
    setType(incident?.type ?? '');
    setSeverity(incident?.severity ?? 'medium');
    setRobotId(incident?.robotId ?? '');
    setDescription(incident?.description ?? '');
    setDetectedAt('');
    setRootCause(incident?.rootCause ?? '');
    setResolution(incident?.resolution ?? '');
    setErrors({});
    setFormError(undefined);
    if (!incident && robots.length === 0) void fetchRobots();
    // Reset only when the modal opens or the target changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, incident]);

  const robotOptions = useMemo(() => robots.map((r) => ({ value: r.id, label: r.name })), [robots]);

  const handleSubmit = async () => {
    const next: FieldErrors = {};
    if (!title.trim()) next.title = 'Give the incident a title.';
    if (!isEdit && !type) next.type = 'Choose what kind of incident this is.';
    if (!description.trim()) next.description = 'Describe what happened.';
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    setSaving(true);
    setFormError(undefined);
    try {
      if (incident) {
        const updated = await updateIncident(incident.id, {
          title: title.trim(),
          severity,
          description: description.trim(),
          rootCause: rootCause.trim() || undefined,
          resolution: resolution.trim() || undefined,
        });
        if (!updated) throw new Error('The server did not accept the change.');
        toast.success('Incident updated', { description: updated.incidentNumber });
        onClose();
      } else {
        const created = await createIncident({
          title: title.trim(),
          type: type as IncidentType,
          severity,
          description: description.trim(),
          robotId: robotId || undefined,
          detectedAt: detectedAt ? new Date(detectedAt).toISOString() : undefined,
        });
        toast.success('Incident reported', { description: created.incidentNumber });
        onClose();
        navigate(`/incidents/${created.id}`);
      }
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <FormModal
      isOpen={isOpen}
      onClose={onClose}
      title={isEdit ? `Edit ${incident?.incidentNumber ?? 'incident'}` : 'Report incident'}
      description={
        isEdit
          ? undefined
          : 'Opens a regulatory incident and starts its notification deadlines.'
      }
      submitLabel={isEdit ? 'Save changes' : 'Report incident'}
      submittingLabel={isEdit ? 'Saving…' : 'Reporting…'}
      isSubmitting={saving}
      error={formError}
      onSubmit={handleSubmit}
      noValidate
    >
      <FormField label="Title" required error={errors.title}>
        <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Robot touched a person in Hall B" />
      </FormField>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {!isEdit && (
          <FormField label="Type" required error={errors.type}>
            <Select
              placeholder="Choose a type…"
              options={TYPE_OPTIONS}
              value={type}
              onChange={(e) => setType(e.target.value as IncidentType | '')}
            />
          </FormField>
        )}
        <FormField label="Severity" required>
          <Select
            options={SEVERITY_OPTIONS}
            value={severity}
            onChange={(e) => setSeverity(e.target.value as IncidentSeverity)}
          />
        </FormField>
      </div>
      {!isEdit && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField label="Robot" aside="Optional">
            <Select placeholder="No robot" options={robotOptions} value={robotId} onChange={(e) => setRobotId(e.target.value)} />
          </FormField>
          <FormField label="Detected at" aside="Optional" hint="Defaults to now.">
            <Input type="datetime-local" value={detectedAt} onChange={(e) => setDetectedAt(e.target.value)} />
          </FormField>
        </div>
      )}
      <FormField label="Description" required error={errors.description}>
        <Textarea rows={4} value={description} onChange={(e) => setDescription(e.target.value)} />
      </FormField>
      {isEdit && (
        <>
          <FormField label="Root cause" aside="Optional">
            <Textarea rows={3} value={rootCause} onChange={(e) => setRootCause(e.target.value)} />
          </FormField>
          <FormField label="Resolution" aside="Optional">
            <Textarea rows={3} value={resolution} onChange={(e) => setResolution(e.target.value)} />
          </FormField>
        </>
      )}
    </FormModal>
  );
}
