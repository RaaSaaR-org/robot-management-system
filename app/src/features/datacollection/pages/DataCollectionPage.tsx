/**
 * @file DataCollectionPage.tsx
 * @description Data collection: recording sessions, collection priorities
 *              and uncertainty analysis, as tabs in the URL (?tab=).
 * @feature datacollection
 */

import { useCallback, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Database, Plus } from 'lucide-react';
import { LinkButton, NextStepBanner, PageHeader, Tabs } from '@/shared/components/ui';
import { SessionList } from '../components/SessionList';
import { PriorityDashboard } from '../components/PriorityDashboard';
import { UncertaintyHeatmap } from '../components/UncertaintyHeatmap';
import { useTeleoperationSessions, useCollectionPriorities } from '../hooks/datacollection';
import type { TeleoperationSession } from '../types/datacollection.types';
import type { RegisteredModel } from '@/features/training/types';

const TABS = [
  { id: 'sessions', label: 'Sessions' },
  { id: 'priorities', label: 'Priorities' },
  { id: 'uncertainty', label: 'Uncertainty' },
] as const;
type TabId = (typeof TABS)[number]['id'];

// TASK-142: the MLflow registry is gone, so no model can be selected; the
// active-learning tabs still render with an empty model list.
const NO_MODELS: RegisteredModel[] = [];

export function DataCollectionPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const raw = params.get('tab');
  const tab: TabId = TABS.some((t) => t.id === raw) ? (raw as TabId) : 'sessions';
  const setTab = (id: string) =>
    setParams((p) => { if (id === 'sessions') p.delete('tab'); else p.set('tab', id); return p; }, { replace: true });

  const [selectedModelId, setSelectedModelId] = useState<string | null>(null);

  const {
    sessions, filters, pagination, isLoading, error, fetchSessions, setFilters, clearFilters, setPage,
  } = useTeleoperationSessions();
  const { priorities, isLoading: prioritiesLoading } = useCollectionPriorities(selectedModelId ?? undefined);

  const openSession = useCallback((s: TeleoperationSession) => navigate(`/data-collection/${s.id}`), [navigate]);
  const newSession = useCallback(() => navigate('/data-collection/new'), [navigate]);
  const hasCompleted = sessions.some((s) => s.status === 'completed');

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Build"
        title="Data collection"
        description="Record teleoperated demonstrations a policy can learn from."
        actions={
          <LinkButton to="/data-collection/new" leftIcon={<Plus className="h-4 w-4" strokeWidth={1.75} />}>
            New session
          </LinkButton>
        }
      />

      <Tabs
        tabs={TABS.map((t) => ({ id: t.id, label: t.label, count: t.id === 'sessions' ? pagination.total || undefined : undefined }))}
        activeTab={tab}
        onTabChange={setTab}
        label="Data collection sections"
      />

      {tab === 'sessions' && (
        <SessionList
          sessions={sessions}
          filters={filters}
          pagination={pagination}
          isLoading={isLoading}
          error={error}
          onRetry={() => void fetchSessions()}
          onFilterChange={setFilters}
          onClearFilters={clearFilters}
          onPageChange={setPage}
          onSessionClick={openSession}
          onNewSession={newSession}
          onExport={openSession}
        />
      )}
      {tab === 'priorities' && (
        <PriorityDashboard
          priorities={priorities}
          isLoading={prioritiesLoading}
          models={NO_MODELS}
          selectedModelId={selectedModelId}
          onModelChange={setSelectedModelId}
        />
      )}
      {tab === 'uncertainty' && (
        <UncertaintyHeatmap models={NO_MODELS} selectedModelId={selectedModelId} onModelChange={setSelectedModelId} />
      )}

      {tab === 'sessions' && hasCompleted && (
        <NextStepBanner
          variant="subtle"
          title="Package your recordings"
          description="Turn completed sessions into a LeRobot dataset, then train a policy on it."
          ctaLabel="Open datasets"
          ctaHref="/datasets"
          icon={<Database className="h-4 w-4" strokeWidth={1.75} />}
        />
      )}
    </div>
  );
}
