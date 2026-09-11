/**
 * @file AlertsPage.tsx
 * @description Alerts: active alerts to triage, alert history, and regulatory incidents
 * @feature alerts
 */

import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CheckCheck, Plus } from 'lucide-react';
import { cn } from '@/shared/utils/cn';
import {
  Button,
  PageHeader,
  Panel,
  SearchInput,
  Select,
  StatRow,
  StatTile,
  Tabs,
  Toolbar,
  confirm,
  toast,
} from '@/shared/components/ui';
import { IncidentsPage } from '@/features/incidents/pages/IncidentsPage';
import { ReportIncidentModal } from '@/features/incidents/components/ReportIncidentModal';
import { useAlertHistory, useAlerts } from '../hooks/useAlerts';
import { useAlertsStore } from '../store/alertsStore';
import { AlertList } from '../components/AlertList';
import { AlertHistoryPanel } from '../components/AlertHistoryPanel';
import type { AlertSeverity } from '../types/alerts.types';
import { ALERT_SEVERITY_LABELS } from '../types/alerts.types';

export interface AlertsPageProps {
  /** Additional class names */
  className?: string;
}

const TAB_IDS = ['active', 'history', 'incidents'] as const;
type TabId = (typeof TAB_IDS)[number];

const SEVERITY_OPTIONS = (['critical', 'error', 'warning', 'info'] as AlertSeverity[]).map((s) => ({
  value: s,
  label: ALERT_SEVERITY_LABELS[s],
}));

const IS_DEMO = import.meta.env.VITE_DEMO_MODE === 'true';

/**
 * AlertsPage - triage active alerts, look back at history, work incidents.
 * Tabs live in ?tab= (active is the default and carries no param).
 */
export function AlertsPage({ className }: AlertsPageProps) {
  const [params, setParams] = useSearchParams();
  const raw = params.get('tab');
  const tab: TabId = TAB_IDS.includes(raw as TabId) ? (raw as TabId) : 'active';
  const setTab = (id: string) =>
    setParams(
      (p) => {
        if (id === 'active') p.delete('tab');
        else p.set('tab', id);
        return p;
      },
      { replace: true }
    );

  const { unacknowledgedAlerts, unacknowledgedCount, acknowledgeAlertAsync, isLoading } = useAlerts();
  const { pagination } = useAlertHistory(false);
  const [query, setQuery] = useState('');
  const [severity, setSeverity] = useState<AlertSeverity | ''>('');
  const [reportOpen, setReportOpen] = useState(false);
  const [ackAllPending, setAckAllPending] = useState(false);

  const counts = useMemo(() => {
    const by: Record<AlertSeverity, number> = { critical: 0, error: 0, warning: 0, info: 0 };
    for (const a of unacknowledgedAlerts) by[a.severity] += 1;
    return by;
  }, [unacknowledgedAlerts]);

  const acknowledgeAll = async () => {
    const targets = [...unacknowledgedAlerts];
    const n = targets.length;
    const ok = await confirm({
      title: `Acknowledge ${n} alert${n === 1 ? '' : 's'}?`,
      description: 'They move to History. Critical alerts stay listed on the robot until it recovers.',
      confirmLabel: 'Acknowledge all',
    });
    if (!ok) return;
    setAckAllPending(true);
    let failed = 0;
    for (const a of targets) {
      await acknowledgeAlertAsync(a.id);
      if (useAlertsStore.getState().error) failed += 1;
    }
    setAckAllPending(false);
    const done = n - failed;
    if (done > 0) toast.success(`${done} alert${done === 1 ? '' : 's'} acknowledged`);
    if (failed > 0) toast.error(`Couldn't acknowledge ${failed} alert${failed === 1 ? '' : 's'}`, {
      description: useAlertsStore.getState().error ?? undefined,
    });
  };

  const actions =
    tab === 'active' && unacknowledgedCount > 0 ? (
      <Button
        variant="secondary"
        leftIcon={<CheckCheck className="h-4 w-4" strokeWidth={1.75} />}
        isLoading={ackAllPending}
        onClick={() => void acknowledgeAll()}
      >
        Acknowledge all
      </Button>
    ) : tab === 'incidents' && !IS_DEMO ? (
      <Button leftIcon={<Plus className="h-4 w-4" strokeWidth={1.75} />} onClick={() => setReportOpen(true)}>
        Report incident
      </Button>
    ) : undefined;

  const tile = (label: string, value: number, tone: 'stopped' | 'danger' | 'gated' | 'sim') => (
    <StatTile
      label={label}
      value={value}
      tone={value > 0 ? tone : 'neutral'}
      hint="Unacknowledged"
      isLoading={isLoading && unacknowledgedAlerts.length === 0}
    />
  );

  return (
    <div className={cn('flex flex-col gap-6', className)}>
      <PageHeader
        eyebrow="Operate"
        title="Alerts"
        description="What the fleet raised, and what you have already handled."
        actions={actions}
      />

      <Tabs
        tabs={[
          { id: 'active', label: 'Active', count: unacknowledgedCount },
          { id: 'history', label: 'History', count: pagination.total || undefined },
          { id: 'incidents', label: 'Incidents' },
        ]}
        activeTab={tab}
        onTabChange={setTab}
      />

      {tab === 'active' && (
        <>
          <StatRow columns={4}>
            {tile('Critical', counts.critical, 'stopped')}
            {tile('Errors', counts.error, 'danger')}
            {tile('Warnings', counts.warning, 'gated')}
            {tile('Info', counts.info, 'sim')}
          </StatRow>
          <Toolbar
            search={<SearchInput value={query} onChange={setQuery} placeholder="Search alerts or robots" />}
            filters={
              <Select
                aria-label="Severity"
                fullWidth={false}
                className="w-40"
                placeholder="All severities"
                options={SEVERITY_OPTIONS}
                value={severity}
                onChange={(e) => setSeverity(e.target.value as AlertSeverity | '')}
              />
            }
          />
          <Panel padding="none">
            <AlertList
              showAcknowledged={false}
              query={query}
              severity={severity}
              onClearFilters={() => {
                setQuery('');
                setSeverity('');
              }}
            />
          </Panel>
        </>
      )}

      {tab === 'history' && <AlertHistoryPanel autoFetch />}

      {tab === 'incidents' && <IncidentsPage embedded onReport={() => setReportOpen(true)} />}

      <ReportIncidentModal isOpen={reportOpen} onClose={() => setReportOpen(false)} />
    </div>
  );
}
