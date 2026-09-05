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
import { modelVersionRepository, skillDefinitionRepository } from '../repositories/index.js';
import type {
  CreateModelVersionInput,
  ModelVersion,
  UpdateModelVersionInput,
} from '../types/vla.types.js';

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
