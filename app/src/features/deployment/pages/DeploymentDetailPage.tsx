/**
 * @file DeploymentDetailPage.tsx
 * @description One rollout: canary stage, robots and metrics, with start/promote/roll back/cancel
 * @feature deployment
 */

import { useCallback, useEffect, useMemo } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowUpCircle, Play, Undo2, XCircle } from 'lucide-react';
import {
  Button,
  ErrorState,
  PageHeader,
  Panel,
  RowActions,
  SkeletonText,
  StatRow,
  StatTile,
  StatusTag,
  Tabs,
  type RowActionItem,
} from '@/shared/components/ui';
import { formatDateTime } from '@/shared/utils';
import { useRobots } from '@/features/robots/hooks/useRobots';
import { useDeployment } from '../hooks/useDeployment';
import { useDeploymentMetrics } from '../hooks/useDeploymentMetrics';
import { useDeploymentProgress } from '../hooks/useDeploymentProgress';
import { DeploymentMetricsPanel } from '../components/DeploymentMetricsPanel';
import { DeploymentOverview } from '../components/DeploymentOverview';
import { DeploymentProgress } from '../components/DeploymentProgress';
import { useDeploymentActs } from '../components/useDeploymentActs';
import {
  canCancel,
  canPromote,
  canRollBack,
  deploymentName,
  deployToneFor,
  isMoving,
  reachedStages,
  strategyLabel,
} from '../components/deploymentHelpers';

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'robots', label: 'Robots' },
  { id: 'metrics', label: 'Metrics' },
] as const;
type TabId = (typeof TABS)[number]['id'];

const icon = 'h-4 w-4';
const back = { to: '/deployments', label: 'Deployments' };

export function DeploymentDetailPage() {
  const { id = '' } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const tab: TabId = TABS.some((t) => t.id === params.get('tab')) ? (params.get('tab') as TabId) : 'overview';
  const setTab = (next: string) =>
    setParams((p) => { if (next === 'overview') p.delete('tab'); else p.set('tab', next); return p; }, { replace: true });

  const { deployment, isLoading, error, fetchDeployment } = useDeployment(id);
  const { metrics, isLoading: metricsLoading, startPolling, stopPolling } = useDeploymentMetrics(id);
  const { robots, fetchRobots } = useRobots();
  useDeploymentProgress();

  const onChanged = useCallback(
    (act: 'start' | 'promote' | 'rollback' | 'cancel') => {
      if (act === 'cancel') navigate('/deployments');
      else void fetchDeployment();
    },
    [fetchDeployment, navigate],
  );
  const acts = useDeploymentActs(onChanged);

  useEffect(() => {
    if (id) void fetchDeployment();
  }, [id, fetchDeployment]);
  useEffect(() => {
    void fetchRobots();
  }, [fetchRobots]);

  const polling = deployment ? ['deploying', 'canary', 'production'].includes(deployment.status) : false;
  useEffect(() => {
    if (!polling) return;
    startPolling();
    return () => stopPolling();
  }, [polling, startPolling, stopPolling]);

  const robotNames = useMemo(() => Object.fromEntries(robots.map((r) => [r.id, r.name])), [robots]);

  if (!deployment) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader eyebrow="Build" back={back} title={isLoading || !error ? 'Loading…' : 'Deployment'} />
        <Panel>
          {error ? (
            <ErrorState title="Couldn't load this deployment" message={error} onRetry={() => void fetchDeployment()} />
          ) : (
            <SkeletonText lines={4} />
          )}
        </Panel>
      </div>
    );
  }

  const d = deployment;
  const name = deploymentName(d);
  const stages = d.canaryConfig?.stages.length ?? 0;
  const version = d.modelVersion ? `v${d.modelVersion.version} · ` : '';
  const description = `${version}${strategyLabel(d.strategy)} · ${
    d.startedAt ? `started ${formatDateTime(d.startedAt)}` : 'not started'
  }`;

  const primary =
    d.status === 'pending' ? (
      <Button leftIcon={<Play className={icon} strokeWidth={1.75} />} onClick={() => void acts.start(d)}>Start rollout</Button>
    ) : canPromote(d) ? (
      <Button leftIcon={<ArrowUpCircle className={icon} strokeWidth={1.75} />} onClick={() => void acts.promote(d)}>Promote</Button>
    ) : null;

  const more: RowActionItem[] = [];
  if (canRollBack(d)) more.push({ label: 'Roll back', icon: <Undo2 className={icon} />, onSelect: () => acts.openRollback(d) });
  if (canCancel(d))
    more.push({
      label: 'Cancel deployment',
      icon: <XCircle className={icon} />,
      tone: 'danger',
      separatorBefore: more.length > 0,
      onSelect: () => void acts.cancel(d),
    });

  const failed = d.failedRobotIds.length;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Build"
        back={back}
        title={name}
        description={description}
        meta={<StatusTag status={d.status} tone={deployToneFor(d.status)} dot pulse={isMoving(d.status)} />}
        actions={
          primary || more.length > 0 ? (
            <>
              {primary}
              {more.length > 0 && <RowActions label="More actions" items={more} />}
            </>
          ) : undefined
        }
      />

      <StatRow columns={4}>
        <StatTile label="Traffic" value={d.trafficPercentage} unit="%" progress={d.trafficPercentage} hint="Share on the new model" />
        <StatTile
          label="Canary stage"
          value={stages > 0 ? reachedStages(d) : '—'}
          unit={stages > 0 ? `/ ${stages}` : undefined}
          hint={stages > 0 ? 'Stages reached' : 'No canary stages'}
        />
        <StatTile label="Robots deployed" value={d.deployedRobotIds.length} tone="live" hint="Running the new model" />
        <StatTile
          label="Robots failed"
          value={failed}
          tone={failed > 0 ? 'stopped' : 'neutral'}
          hint={failed > 0 ? 'See the Robots tab' : 'None so far'}
        />
      </StatRow>

      <Tabs label="Deployment sections" tabs={TABS.map((t) => ({ id: t.id, label: t.label }))} activeTab={tab} onTabChange={setTab} />

      {tab === 'overview' && <DeploymentOverview deployment={d} />}
      {tab === 'robots' && (
        <DeploymentProgress deployment={d} robotNames={robotNames} onRobotClick={(rid) => navigate(`/robots/${rid}`)} />
      )}
      {tab === 'metrics' && (
        <DeploymentMetricsPanel metrics={metrics} thresholds={d.rollbackThresholds} isLoading={metricsLoading} />
      )}

      {acts.rollbackModal}
    </div>
  );
}
