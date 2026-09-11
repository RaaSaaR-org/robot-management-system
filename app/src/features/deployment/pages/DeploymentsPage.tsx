/**
 * @file DeploymentsPage.tsx
 * @description Deployments: model rollouts (tab Deployments) and the skill library (tab Skills)
 * @feature deployment
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Plus, Rocket } from 'lucide-react';
import { DemoFeaturePlaceholder } from '@/components/demo/DemoFeaturePlaceholder';
import { Button, PageHeader, PipelineBreadcrumb, Tabs, toast } from '@/shared/components/ui';
import { useRobots } from '@/features/robots/hooks/useRobots';
import { useDeploymentStore } from '../store';
import type { CreateDeploymentInput } from '../types';
import { DeploymentsSection } from '../components/DeploymentsSection';
import { DeploymentFormModal } from '../components/DeploymentFormModal';
import { SkillsSection } from '../components/SkillsSection';
import { useDeploymentActs } from '../components/useDeploymentActs';
import { ACTIVE_DEPLOYMENT_STATUSES, modelName } from '../components/deploymentHelpers';

type PageTab = 'deployments' | 'skills';

const DESCRIPTIONS: Record<PageTab, string> = {
  deployments: 'Roll trained models out to the fleet, watch the canary, promote or roll back.',
  skills: 'Skills robots can execute. Train new ones in Skill training, sequence them in automations.',
};

/** Robot types every G1-first fleet can target even before a robot of that type is registered. */
const KNOWN_ROBOT_TYPES = ['g1', 'g1_edu', 'h1', 'so101'];

export function DeploymentsPage() {
  if (import.meta.env.VITE_DEMO_MODE === 'true') {
    return (
      <DemoFeaturePlaceholder
        featureName="Deployment Manager"
        icon={<Rocket className="w-12 h-12" />}
        description="Manage model deployments across your robot fleet. Track rollout status, rollback failed deployments, and monitor deployment health."
        capabilities={[
          'Deploy models to individual robots or entire fleet',
          'Canary deployments with automatic rollback',
          'Track deployment history and success rates',
          'A/B test model versions in production',
        ]}
        docsSlug="deployment"
      />
    );
  }
  return <DeploymentsPageLive />;
}

function DeploymentsPageLive() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const tab: PageTab = params.get('tab') === 'skills' ? 'skills' : 'deployments';
  const setTab = (id: string) =>
    setParams(
      (p) => {
        if (id === 'deployments') p.delete('tab');
        else p.set('tab', id);
        p.delete('view');
        return p;
      },
      { replace: true },
    );

  const deployments = useDeploymentStore((s) => s.deployments);
  const isLoading = useDeploymentStore((s) => s.deploymentsLoading);
  const error = useDeploymentStore((s) => s.deploymentsError);
  const skills = useDeploymentStore((s) => s.skills);
  const modelVersions = useDeploymentStore((s) => s.modelVersions);
  const modelsLoading = useDeploymentStore((s) => s.modelVersionsLoading);
  const fetchDeployments = useDeploymentStore((s) => s.fetchDeployments);
  const fetchModelVersions = useDeploymentStore((s) => s.fetchModelVersions);
  const fetchSkills = useDeploymentStore((s) => s.fetchSkills);
  const createDeployment = useDeploymentStore((s) => s.createDeployment);
  const { robots, fetchRobots } = useRobots();

  const [deploymentFormOpen, setDeploymentFormOpen] = useState(false);
  const [skillFormOpen, setSkillFormOpen] = useState(false);
  const [prefillModelId, setPrefillModelId] = useState<string>();

  const refresh = useCallback(() => void fetchDeployments(), [fetchDeployments]);
  const acts = useDeploymentActs(refresh);

  useEffect(() => {
    void fetchDeployments();
    void fetchModelVersions();
    void fetchSkills();
    void fetchRobots();
  }, [fetchDeployments, fetchModelVersions, fetchSkills, fetchRobots]);

  // /deployments?new=<modelVersionId> (from /models → Deploy) opens the form prefilled, then drops the param.
  const newParam = params.get('new');
  useEffect(() => {
    if (!newParam) return;
    setPrefillModelId(newParam);
    setDeploymentFormOpen(true);
    setParams(
      (p) => {
        p.delete('new');
        p.delete('tab');
        return p;
      },
      { replace: true },
    );
  }, [newParam, setParams]);

  const robotTypes = useMemo(() => {
    const fromFleet = robots
      .map((r) => r.metadata?.robotType)
      .filter((t): t is string => typeof t === 'string' && t.length > 0);
    return Array.from(new Set([...KNOWN_ROBOT_TYPES, ...fromFleet])).sort();
  }, [robots]);

  const stagingModels = useMemo(
    () => modelVersions.filter((v) => v.deploymentStatus === 'staging'),
    [modelVersions],
  );

  const handleCreate = async (input: CreateDeploymentInput) => {
    const created = await createDeployment(input); // throws → the modal shows the error
    const model = stagingModels.find((m) => m.id === input.modelVersionId);
    toast.success('Deployment created', {
      description: model ? `${modelName(model)} — start it when you are ready.` : undefined,
    });
    navigate(`/deployments/${created.id}`);
  };

  const openDeploymentForm = () => {
    setPrefillModelId(undefined);
    setDeploymentFormOpen(true);
  };

  const plus = <Plus className="h-4 w-4" strokeWidth={1.75} />;
  const activeCount = deployments.filter((d) => ACTIVE_DEPLOYMENT_STATUSES.includes(d.status)).length;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Build"
        title="Deployments"
        description={DESCRIPTIONS[tab]}
        actions={
          tab === 'deployments' ? (
            <Button leftIcon={plus} onClick={openDeploymentForm}>New deployment</Button>
          ) : (
            <Button leftIcon={plus} onClick={() => setSkillFormOpen(true)}>New skill</Button>
          )
        }
      >
        <PipelineBreadcrumb stage="deploy" />
      </PageHeader>

      <Tabs
        label="Deployments sections"
        tabs={[
          { id: 'deployments', label: 'Deployments', count: activeCount },
          { id: 'skills', label: 'Skills', count: skills.length },
        ]}
        activeTab={tab}
        onTabChange={setTab}
      />

      {tab === 'deployments' ? (
        <DeploymentsSection
          deployments={deployments}
          isLoading={isLoading}
          error={error}
          onRetry={refresh}
          onCreate={openDeploymentForm}
          acts={acts}
        />
      ) : (
        <SkillsSection createOpen={skillFormOpen} onCreateOpenChange={setSkillFormOpen} />
      )}

      <DeploymentFormModal
        isOpen={deploymentFormOpen}
        onClose={() => setDeploymentFormOpen(false)}
        onSubmit={handleCreate}
        modelVersions={stagingModels}
        modelsLoading={modelsLoading}
        initialModelVersionId={prefillModelId}
        robotTypes={robotTypes}
      />
      {acts.rollbackModal}
    </div>
  );
}
