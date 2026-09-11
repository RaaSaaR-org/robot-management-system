/**
 * @file IncidentsPage.tsx
 * @description Regulatory incidents: state tiles, toolbar and the incident table.
 *              Embedded as the Alerts page's Incidents tab (no header of its own).
 * @feature incidents
 */

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, Plus } from 'lucide-react';
import { DemoFeaturePlaceholder } from '@/components/demo/DemoFeaturePlaceholder';
import {
  Button,
  InfoIcon,
  PageHeader,
  Panel,
  SearchInput,
  SegmentedControl,
  StatRow,
  StatTile,
  Toolbar,
} from '@/shared/components/ui';
import { IncidentList } from '../components/IncidentList';
import { IncidentFilters } from '../components/IncidentFilters';
import { ReportIncidentModal } from '../components/ReportIncidentModal';
import { useIncidents, useIncidentDashboard } from '../hooks/useIncidents';

export interface IncidentsPageProps {
  /**
   * True when rendered inside another page (the Alerts page's Incidents tab):
   * no PageHeader, and the host opens the report modal.
   */
  embedded?: boolean;
  /** Opens the host's report modal (embedded mode) */
  onReport?: () => void;
}

const DEADLINES =
  'EU AI Act Art. 73: 2, 10 or 15 days · GDPR Art. 33: 72 h · NIS2 Art. 23: 24 h early warning, 72 h notification · CRA Art. 14: 24 h';

function resolutionTime(hours: number | null | undefined): { value: string | number; unit?: string } {
  if (hours === null || hours === undefined) return { value: '—' };
  if (hours < 24) return { value: Math.round(hours * 10) / 10, unit: 'h' };
  return { value: Math.round(hours / 24), unit: 'd' };
}

function IncidentsSection({ onReport }: { onReport: () => void }) {
  const navigate = useNavigate();
  const { filters, setFilters, fetchIncidents } = useIncidents(false);
  const { stats, isLoading: statsLoading } = useIncidentDashboard();
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState<'open' | 'all'>('open');

  useEffect(() => {
    void fetchIncidents(1);
  }, [fetchIncidents]);

  const hasFilters = Boolean(filters.severity?.length || filters.type?.length);
  const resolution = resolutionTime(stats?.averageResolutionTimeHours);
  const tilesLoading = statsLoading && !stats;
  const open = stats?.openIncidents ?? 0;
  const overdue = stats?.overdueNotifications ?? 0;

  return (
    <>
      <StatRow columns={4}>
        <StatTile label="Open incidents" value={open} tone={open > 0 ? 'gated' : 'neutral'} hint="Not yet closed" isLoading={tilesLoading} />
        <StatTile
          label="Overdue notifications"
          value={overdue}
          tone={overdue > 0 ? 'stopped' : 'neutral'}
          hint={
            <span className="inline-flex items-center gap-1">
              Past the legal deadline
              <InfoIcon content={DEADLINES} label="Notification deadlines" />
            </span>
          }
          isLoading={tilesLoading}
        />
        <StatTile label="Pending notifications" value={stats?.pendingNotifications ?? 0} hint="Awaiting action" isLoading={tilesLoading} />
        <StatTile label="Avg resolution" value={resolution.value} unit={resolution.unit} hint="Resolved incidents" isLoading={tilesLoading} />
      </StatRow>

      <Toolbar
        search={<SearchInput value={query} onChange={setQuery} placeholder="Search incidents" />}
        filters={
          <>
            <SegmentedControl
              label="Show"
              options={[
                { value: 'open', label: 'Open' },
                { value: 'all', label: 'All' },
              ]}
              value={scope}
              onChange={(v) => setScope(v as 'open' | 'all')}
            />
            <IncidentFilters filters={filters} onFiltersChange={setFilters} />
          </>
        }
      />

      <Panel padding="none">
        <IncidentList
          showOnlyOpen={scope === 'open'}
          query={query}
          hasFilters={hasFilters}
          onClearFilters={() => {
            setQuery('');
            setFilters({});
          }}
          onIncidentClick={(i) => navigate(`/incidents/${i.id}`)}
          onReport={onReport}
        />
      </Panel>
    </>
  );
}

/**
 * Incident management and regulatory reporting.
 */
export function IncidentsPage({ embedded = false, onReport }: IncidentsPageProps) {
  const [reportOpen, setReportOpen] = useState(false);

  if (import.meta.env.VITE_DEMO_MODE === 'true') {
    return (
      <DemoFeaturePlaceholder
        featureName="Incident Management"
        icon={<AlertTriangle className="w-12 h-12" />}
        description="Track and resolve robot incidents. Log failures, analyze root causes, and implement corrective actions."
        capabilities={[
          'Automatic incident creation from robot errors',
          'Root cause analysis with AI assistance',
          'Track corrective actions and resolutions',
          'Generate incident reports for compliance',
        ]}
        docsSlug="architecture"
      />
    );
  }

  const report = onReport ?? (() => setReportOpen(true));

  if (embedded) return <IncidentsSection onReport={report} />;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Operate"
        title="Incidents"
        description="Regulatory incidents and the notification deadlines they start."
        actions={
          <Button leftIcon={<Plus className="h-4 w-4" strokeWidth={1.75} />} onClick={report}>
            Report incident
          </Button>
        }
      />
      <IncidentsSection onReport={report} />
      <ReportIncidentModal isOpen={reportOpen} onClose={() => setReportOpen(false)} />
    </div>
  );
}
