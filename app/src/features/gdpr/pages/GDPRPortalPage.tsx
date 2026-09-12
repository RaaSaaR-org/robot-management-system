/**
 * @file GDPRPortalPage.tsx
 * @description Data privacy section of /compliance: requests, consent, records of processing (?view=)
 * @feature gdpr
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { Button, SearchInput, SegmentedControl, Select, Toolbar } from '@/shared/components/ui';
import { RopaTab } from '@/features/compliance/components/RopaTab';
import { useGDPRStore } from '../store';
import { RequestTable } from '../components/RequestTable';
import { RequestDetailModal } from '../components/RequestDetailModal';
import { NewRequestModal } from '../components/NewRequestModal';
import { ConsentManager } from '../components/ConsentManager';
import { RIGHTS } from '../components/RequestTypeCard';
import { GDPRRequestStatuses, GDPRRequestTypes, REQUEST_STATUS_LABELS, type GDPRRequest, type ConsentType } from '../types';

type View = 'requests' | 'consent' | 'ropa';
const VIEWS: { value: View; label: string }[] = [
  { value: 'requests', label: 'Requests' },
  { value: 'consent', label: 'Consent' },
  { value: 'ropa', label: 'Records of processing' },
];
const sentence = (s: string) => s.charAt(0) + s.slice(1).toLowerCase();
const STATUS_OPTIONS = GDPRRequestStatuses.map((s) => ({ value: s, label: sentence(REQUEST_STATUS_LABELS[s]) }));
const TYPE_OPTIONS = GDPRRequestTypes.map((t) => ({ value: t, label: RIGHTS[t].label }));

/** GDPR data-subject rights (Art. 15–22), consent and the Art. 30 register, hosted as a tab section. */
export function GDPRPortalPage() {
  const [params, setParams] = useSearchParams();
  const view = VIEWS.some((v) => v.value === params.get('view')) ? (params.get('view') as View) : VIEWS[0].value;
  const setView = (v: View) =>
    setParams((p) => { if (v === VIEWS[0].value) p.delete('view'); else p.set('view', v); return p; }, { replace: true });

  const { requests, consents, isLoading, isLoadingConsents, error, fetchMyRequests, fetchRequest, fetchConsents, updateConsent } =
    useGDPRStore();
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');
  const [type, setType] = useState('');
  const [open, setOpen] = useState<GDPRRequest | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    void fetchMyRequests();
  }, [fetchMyRequests]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return requests.filter(
      (r) =>
        (!status || r.status === status) &&
        (!type || r.requestType === type) &&
        (!q || [r.id, RIGHTS[r.requestType]?.label ?? r.requestType].some((v) => v.toLowerCase().includes(q))),
    );
  }, [requests, query, status, type]);

  const openRequest = (r: GDPRRequest) => {
    setOpen(r);
    void fetchRequest(r.id);
  };
  const loadConsents = useCallback(() => void fetchConsents(), [fetchConsents]);
  const toggleConsent = useCallback((t: ConsentType, granted: boolean) => updateConsent(t, granted), [updateConsent]);
  const clearFilters = () => { setQuery(''); setStatus(''); setType(''); };

  const switcher = (
    <div className="max-w-full overflow-x-auto">
      <SegmentedControl label="Data privacy view" size="sm" options={VIEWS} value={view} onChange={setView} />
    </div>
  );

  return (
    <div className="flex flex-col gap-4">
      {switcher}
      {view === 'requests' && (
        <Toolbar
          search={<SearchInput value={query} onChange={setQuery} placeholder="Search type or reference" />}
          filters={
            <>
              <Select aria-label="Status" fullWidth={false} className="w-44" placeholder="All statuses" options={STATUS_OPTIONS}
                value={status} onChange={(e) => setStatus(e.target.value)} />
              <Select aria-label="Type" fullWidth={false} className="w-44" placeholder="All types" options={TYPE_OPTIONS}
                value={type} onChange={(e) => setType(e.target.value)} />
            </>
          }
          actions={
            <Button leftIcon={<Plus className="h-4 w-4" strokeWidth={1.75} />} onClick={() => setCreating(true)}>New request</Button>
          }
        />
      )}

      {view === 'requests' && (
        <RequestTable
          rows={rows}
          isLoading={isLoading}
          error={requests.length ? null : error}
          onRetry={() => void fetchMyRequests()}
          onOpen={openRequest}
          onCreate={() => setCreating(true)}
          hasFilters={Boolean(query || status || type)}
          onClearFilters={clearFilters}
        />
      )}
      {view === 'consent' && (
        <ConsentManager consents={consents} onToggle={toggleConsent} onLoad={loadConsents} isLoading={isLoadingConsents} error={error} />
      )}
      {view === 'ropa' && <RopaTab />}

      <RequestDetailModal request={open} onClose={() => setOpen(null)} />
      <NewRequestModal isOpen={creating} onClose={() => setCreating(false)} />
    </div>
  );
}
