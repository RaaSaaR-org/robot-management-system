/**
 * @file ModelRegistryService.ts
 * @description Registry writes that span two rows — a ModelVersion and the
 *   SkillDefinition that resolves it. `ModelVersion.skillId` says which skill a
 *   model belongs to (a skill has many model versions);
 *   `SkillDefinition.linkedModelVersionId` says which single one the skill runs,
 *   and is what SkillExecutionService and the Skill Library card read. Writing
 *   only the first edge leaves the second stale, so the registry write API goes
 *   through here. (TASK-238)
 * @feature deployment
 */
import {
  deploymentRepository,
  modelVersionRepository,
  skillDefinitionRepository,
} from '../repositories/index.js';
import type {
  CreateModelVersionInput,
  DeploymentStatus,
  ModelVersion,
  UpdateModelVersionInput,
} from '../types/vla.types.js';
import { ConflictError, NotFoundError } from '../utils/errors.js';

/** A deployment in one of these states no longer holds its model in place. */
const FINISHED_DEPLOYMENT_STATUSES: readonly DeploymentStatus[] = ['failed', 'rolled_back', 'cancelled'];

export class ModelRegistryService {
  /**
   * Register a model version. A registration that names a skill also makes
   * that skill resolve the model — registering against a skill and then
   * finding the skill still resolves nothing is the bug this closes.
   */
  async register(input: CreateModelVersionInput): Promise<ModelVersion> {
    const modelVersion = await modelVersionRepository.create(input);
    if (modelVersion.skillId) {
      await this.syncSkillLink(modelVersion.id, modelVersion.skillId);
    }
    return modelVersion;
  }

  /**
   * Amend a registered model, keeping both link edges in agreement.
   * Returns null when the repository rejected the write.
   */
  async update(id: string, input: UpdateModelVersionInput): Promise<ModelVersion | null> {
    const modelVersion = await modelVersionRepository.update(id, input);
    if (!modelVersion) return null;

    // `undefined` means the caller never mentioned skillId, so neither edge
    // moved; `null` is an explicit unlink and must clear the back-pointer.
    if (input.skillId !== undefined) {
      await this.syncSkillLink(id, input.skillId);
    }
    return modelVersion;
  }

  /**
   * Archive a model version — the registry's delete (TASK-272). A model is
   * never removed: deployments, evaluation episodes, checkpoints, lineage and
   * research publications all point at it. Refused while a deployment of it is
   * not finished, or while a skill still runs it. Idempotent on an archived one.
   * Returns the version as it was before, for the audit log.
   */
  async archive(id: string): Promise<{ before: ModelVersion; modelVersion: ModelVersion }> {
    const before = await modelVersionRepository.findById(id);
    if (!before) {
      throw new NotFoundError('Model version', id);
    }
    if (before.deploymentStatus === 'archived') {
      return { before, modelVersion: before };
    }

    const live = (await deploymentRepository.findByModelVersion(id)).filter(
      (deployment) => !FINISHED_DEPLOYMENT_STATUSES.includes(deployment.status)
    );
    if (live.length > 0) {
      throw new ConflictError(
        `Model is in ${live.length} deployment(s) that are not finished (${live[0].status}) — ` +
          'roll them back or cancel them first, then archive it'
      );
    }

    const runningSkills = await skillDefinitionRepository.findAll({ linkedModelVersionId: id });
    if (runningSkills.data.length > 0) {
      throw new ConflictError(
        `Skill "${runningSkills.data[0].name}" runs this model — link it to another model first, then archive it`
      );
    }

    const modelVersion = await modelVersionRepository.update(id, { deploymentStatus: 'archived' });
    if (!modelVersion) {
      throw new ConflictError('Archive rejected by the registry');
    }
    return { before, modelVersion };
  }

  /**
   * Point `skillId` at this model and clear the pointer on any other skill
   * that still claims it.
   *
   * The clear is not cosmetic: `SkillDefinition.linkedModelVersionId` has no
   * foreign key, so a skill left pointing at a model that no longer claims it
   * would keep executing that model with nothing in the registry saying so.
   */
  private async syncSkillLink(modelVersionId: string, skillId: string | null): Promise<void> {
    const claiming = await skillDefinitionRepository.findAll({
      linkedModelVersionId: modelVersionId,
    });

    for (const skill of claiming.data) {
      if (skill.id !== skillId) {
        await skillDefinitionRepository.update(skill.id, { linkedModelVersionId: null });
      }
    }

    if (skillId) {
      await skillDefinitionRepository.update(skillId, { linkedModelVersionId: modelVersionId });
    }
  }
}

export const modelRegistryService = new ModelRegistryService();
