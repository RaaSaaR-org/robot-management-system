/**
 * @file ExportDialog.tsx
 * @description "Export log" form: date range, event types and decryption,
 *              then downloads the signed JSON export and toasts the result.
 * @feature compliance
 */

import { useEffect, useState } from 'react';
import {
  Checkbox, FormField, FormModal, Input, Select, ToggleChip, toast,
} from '@/shared/components/ui';
import { useComplianceStore } from '../store';
import type { ComplianceEventType } from '../types';
import { EVENT_TYPE_OPTIONS, errorMessage } from './complianceFormat';

export interface ExportDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

function download(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/** Export of the audit log for regulators and auditors. */
export function ExportDialog({ isOpen, onClose }: ExportDialogProps) {
  const exportLogs = useComplianceStore((s) => s.exportLogs);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [types, setTypes] = useState<ComplianceEventType[]>([]);
  const [decrypted, setDecrypted] = useState(false);
  const [rangeError, setRangeError] = useState<string>();
  const [formError, setFormError] = useState<string>();
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setStartDate(''); setEndDate(''); setTypes([]); setDecrypted(false);
    setRangeError(undefined); setFormError(undefined);
  }, [isOpen]);

  const toggle = (t: ComplianceEventType) =>
    setTypes((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]));

  const submit = async () => {
    if (startDate && endDate && startDate > endDate) { setRangeError('The start date is after the end date.'); return; }
    setRangeError(undefined);
    setExporting(true);
    setFormError(undefined);
    try {
      const result = await exportLogs({
        startDate: startDate || undefined,
        endDate: endDate || undefined,
        eventTypes: types.length ? types : undefined,
        includeDecrypted: decrypted,
      });
      download(result.filename, result.data);
      toast.success('Export ready', { description: `${result.recordCount.toLocaleString()} entries · ${result.filename}` });
      onClose();
    } catch (err) {
      setFormError(errorMessage(err));
    } finally {
      setExporting(false);
    }
  };

  return (
    <FormModal
      isOpen={isOpen}
      onClose={onClose}
      title="Export log"
      description="A JSON file with every matching entry and its hashes, ready for a regulator. The export itself is logged."
      submitLabel="Export"
      submittingLabel="Exporting…"
      isSubmitting={exporting}
      error={formError}
      onSubmit={submit}
      noValidate
    >
      <FormField label="Format">
        <Select options={[{ value: 'json', label: 'JSON (with hash chain)' }]} value="json" onChange={() => undefined} />
      </FormField>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FormField label="From" aside="Optional" error={rangeError}>
          <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        </FormField>
        <FormField label="To" aside="Optional">
          <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
        </FormField>
      </div>
      <FormField label="Event types" hint={types.length ? `${types.length} selected` : 'None selected exports every type.'}>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Event types">
          {EVENT_TYPE_OPTIONS.map((o) => (
            <ToggleChip key={o.value} size="sm" active={types.includes(o.value)} onClick={() => toggle(o.value)}>
              {o.label}
            </ToggleChip>
          ))}
        </div>
      </FormField>
      <Checkbox
        label="Include decrypted payloads"
        description="Needs the right permission. Without it, payloads are exported as hashes only."
        checked={decrypted}
        onChange={(e) => setDecrypted(e.target.checked)}
      />
    </FormModal>
  );
}
