/**
 * @file ModelsPage.tsx
 * @description Model registry — every registered model version, its details,
 *              and the "Register model" form for an externally trained
 *              fine-tune (TASK-238, TASK-266)
 * @feature deployment
 */

import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { Button, PageHeader, confirm, toast } from '@/shared/components/ui';
import { getErrorMessage } from '@/shared/utils';
import { deploymentApi } from '../api';
import { useDeploymentStore, selectSkills } from '../store';
import { useModelVersionsAutoFetch } from '../hooks/useModelVersions';
import { ModelBrowser } from '../components/ModelBrowser';
import { EditModelModal } from '../components/models/EditModelModal';
import { RegisterModelModal } from '../components/models/RegisterModelModal';
import { ModelDetailsModal } from '../components/models/ModelDetailsModal';
import { getModelDisplayName, resolveSkillName } from '../components/models/modelDisplay';
import type { ModelVersion } from '../types';

export function ModelsPage() {
  const navigate = useNavigate();
  const { modelVersions, isLoading, fetchModelVersions } = useModelVersionsAutoFetch();
  const fetchSkills = useDeploymentStore((s) => s.fetchSkills);
  const skills = useDeploymentStore(selectSkills);
  const [openId, setOpenId] = useState<string | null>(null);
  const [showRegister, setShowRegister] = useState(false);
  const [editing, setEditing] = useState<ModelVersion | null>(null);

  // The register form offers the skills as a dropdown and the table names
  // them, so load them with the page.
  useEffect(() => {
    fetchSkills();
  }, [fetchSkills]);

  const skillNamesById = useMemo(() => new Map(skills.map((s) => [s.id, s.name])), [skills]);
  const open = modelVersions.find((v) => v.id === openId) ?? null;
  const openParent = open?.parentModelVersionId
    ? open.parent ?? modelVersions.find((v) => v.id === open.parentModelVersionId) ?? null
    : null;

  const copyUri = async (v: ModelVersion) => {
    try {
      await navigator.clipboard.writeText(v.artifactUri);
      toast.success('Artifact URI copied', { description: v.artifactUri });
    } catch (err) {
      toast.error("Couldn't copy the artifact URI", { description: getErrorMessage(err) });
    }
  };

  const archive = async (v: ModelVersion) => {
    const name = getModelDisplayName(v);
    const ok = await confirm({
      title: `Archive ${name}?`,
      description: 'It leaves the deploy list, so no new rollout can use it. The artifact and its history are kept.',
      confirmLabel: 'Archive',
      tone: 'danger',
    });
    if (!ok) return;
    try {
      await deploymentApi.updateModelVersion(v.id, { deploymentStatus: 'archived' });
      toast.success('Model archived', { description: name });
      await fetchModelVersions();
    } catch (err) {
      toast.error("Couldn't archive the model", { description: getErrorMessage(err) });
    }
  };

  const registerButton = (
    <Button leftIcon={<Plus className="h-4 w-4" />} onClick={() => setShowRegister(true)}>
      Register model
    </Button>
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Build"
        title="Model Registry"
        description="Every model version this system knows — trained here, imported, or derived from another."
        actions={registerButton}
      />

      <ModelBrowser
        modelVersions={modelVersions}
        isLoading={isLoading}
        onSelectVersion={(v) => setOpenId(v.id)}
        onDeploy={(v) => navigate(`/deployments?new=${v.id}`)}
        onCopyUri={(v) => void copyUri(v)}
        onEdit={setEditing}
        onArchive={(v) => void archive(v)}
        emptyAction={registerButton}
      />

      <EditModelModal version={editing} onClose={() => setEditing(null)} onSaved={() => fetchModelVersions()} />

      <ModelDetailsModal
        version={open}
        skillName={open ? resolveSkillName(open, skillNamesById) : null}
        parentName={
          open?.parentModelVersionId
            ? openParent ? getModelDisplayName(openParent) : `Model ${open.parentModelVersionId.slice(0, 8)}`
            : null
        }
        onClose={() => setOpenId(null)}
      />

      <RegisterModelModal
        isOpen={showRegister}
        onClose={() => setShowRegister(false)}
        onRegistered={() => fetchModelVersions()}
        modelVersions={modelVersions}
      />
    </div>
  );
}
