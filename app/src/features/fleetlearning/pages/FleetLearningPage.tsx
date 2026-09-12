/**
 * @file FleetLearningPage.tsx
 * @description Fleet learning (federated learning): rounds, convergence,
 *              privacy budgets and ROHE, one tab each in ?tab=
 * @feature fleetlearning
 */

import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { Button, PageHeader, Tabs, toast } from '@/shared/components/ui';
import { useModelVersionsAutoFetch } from '@/features/deployment/hooks/useModelVersions';
import { RoundsSection, shortRoundId } from '../components/RoundsSection';
import { ConvergenceChart } from '../components/ConvergenceChart';
import { PrivacyBudgetView } from '../components/PrivacyBudgetView';
import { ROHEDashboard } from '../components/ROHEDashboard';
import { CreateRoundModal } from '../components/CreateRoundModal';
import { useRobotNames } from '../components/useRobotNames';
import { useConvergenceData, useCreateRound, usePrivacyBudgets, useROHEMetrics } from '../hooks/fleetlearning';
import { useFleetLearningStore } from '../store/fleetlearningStore';
import type { CreateFederatedRoundRequest } from '../types/fleetlearning.types';

const TABS = [
  { id: 'rounds', label: 'Rounds' },
  { id: 'convergence', label: 'Convergence' },
  { id: 'privacy', label: 'Privacy' },
  { id: 'rohe', label: 'ROHE' },
] as const;
type TabId = (typeof TABS)[number]['id'];

function ConvergenceTab() {
  const { data, isLoading, error, fetchData } = useConvergenceData();
  return <ConvergenceChart data={data} isLoading={isLoading} error={error} onRetry={() => void fetchData()} />;
}

function PrivacyTab() {
  const { budgets, isLoading, error, fetchBudgets } = usePrivacyBudgets();
  const robotName = useRobotNames();
  return <PrivacyBudgetView budgets={budgets} isLoading={isLoading} error={error} onRetry={() => void fetchBudgets()} robotName={robotName} />;
}

function RoheTab() {
  const { metrics, isLoading, error, fetchMetrics } = useROHEMetrics();
  const robotName = useRobotNames();
  return <ROHEDashboard metrics={metrics} isLoading={isLoading} error={error} onRetry={() => void fetchMetrics()} robotName={robotName} />;
}

export function FleetLearningPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const raw = params.get('tab');
  const tab: TabId = TABS.some((t) => t.id === raw) ? (raw as TabId) : 'rounds';
  const setTab = (id: string) =>
    setParams((p) => { if (id === 'rounds') p.delete('tab'); else p.set('tab', id); return p; }, { replace: true });

  const total = useFleetLearningStore((s) => s.pagination.total);
  const [creating, setCreating] = useState(false);
  const { createRound } = useCreateRound();
  const { modelVersions } = useModelVersionsAutoFetch();
  // Keyed by model id, not by version: two models can carry the same version
  // string, and identical option values collide as React keys and make the two
  // entries indistinguishable. The round records the version, so the picked id
  // is resolved back to one on submit.
  const modelOptions = useMemo(
    () => modelVersions.map((v) => ({ value: v.id, label: `${v.name || `Model ${v.version}`} · v${v.version}` })),
    [modelVersions],
  );

  const handleCreate = async (data: CreateFederatedRoundRequest) => {
    const picked = modelVersions.find((v) => v.id === data.globalModelVersion);
    const round = await createRound(picked ? { ...data, globalModelVersion: picked.version } : data);
    toast.success('Round created', { description: `Round ${shortRoundId(round.id)} · ${round.globalModelVersion}` });
    setCreating(false);
    navigate(`/fleet-learning/rounds/${round.id}`);
  };

  const newButton = (
    <Button leftIcon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>New round</Button>
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Build"
        title="Fleet learning"
        description="Train one model across many robots without moving their data. Each round selects robots, trains locally and aggregates."
        actions={tab === 'rounds' ? newButton : undefined}
      />
      <Tabs
        label="Fleet learning sections"
        tabs={TABS.map((t) => ({ id: t.id, label: t.label, ...(t.id === 'rounds' && total ? { count: total } : {}) }))}
        activeTab={tab}
        onTabChange={setTab}
      />
      {tab === 'rounds' && <RoundsSection newAction={newButton} />}
      {tab === 'convergence' && <ConvergenceTab />}
      {tab === 'privacy' && <PrivacyTab />}
      {tab === 'rohe' && <RoheTab />}

      <CreateRoundModal isOpen={creating} onClose={() => setCreating(false)} onSubmit={handleCreate} availableModels={modelOptions} />
    </div>
  );
}
