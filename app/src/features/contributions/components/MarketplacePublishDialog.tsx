/**
 * @file MarketplacePublishDialog.tsx
 * @description "Publish listing" FormModal — publishes a skill or dataset to the marketplace
 * @feature marketplace
 */

import { useEffect, useState } from 'react';
import {
  Divider, FormField, FormModal, Input, SegmentedControl, Select, Textarea, toast,
} from '@/shared/components/ui';
import { getErrorMessage } from '@/shared/utils';
import {
  LICENSE_TIER_LABELS,
  type BaseModelType,
  type CreateListingInput,
  type MarketplaceItemType,
  type MarketplaceLicenseTier,
  type RobotHardwareType,
} from '../types/marketplace.types';
import { BASE_MODELS, ROBOT_TYPES } from './marketplaceUi';
import {
  INITIAL_TIERS, LICENSE_TIERS, PublishPriceTiers, TIER_DESCRIPTIONS, type TierFormState,
} from './PublishPriceTiers';

export interface MarketplacePublishDialogProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (input: CreateListingInput) => Promise<void>;
  isSubmitting: boolean;
}

type FieldErrors = Partial<Record<'title' | 'shortDescription' | 'fullDescription' | 'tiers', string>>;

export function MarketplacePublishDialog({ open, onClose, onSubmit, isSubmitting }: MarketplacePublishDialogProps) {
  const [type, setType] = useState<MarketplaceItemType>('skill');
  const [title, setTitle] = useState('');
  const [shortDescription, setShortDescription] = useState('');
  const [fullDescription, setFullDescription] = useState('');
  const [robotType, setRobotType] = useState<RobotHardwareType>('Unitree G1');
  const [baseModel, setBaseModel] = useState<BaseModelType>('SmolVLA');
  const [tags, setTags] = useState('');
  const [taskCategory, setTaskCategory] = useState('');
  const [successRate, setSuccessRate] = useState('');
  const [adapterSizeMB, setAdapterSizeMB] = useState('');
  const [episodeCount, setEpisodeCount] = useState('');
  const [frameCount, setFrameCount] = useState('');
  const [datasetSizeGB, setDatasetSizeGB] = useState('');
  const [collectionMethod, setCollectionMethod] = useState('');
  const [tiers, setTiers] = useState<Record<MarketplaceLicenseTier, TierFormState>>(INITIAL_TIERS);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [tierErrors, setTierErrors] = useState<Partial<Record<MarketplaceLicenseTier, string>>>({});
  const [formError, setFormError] = useState<string>();

  // Reset the form each time the dialog opens
  useEffect(() => {
    if (!open) return;
    setType('skill'); setTitle(''); setShortDescription(''); setFullDescription('');
    setRobotType('Unitree G1'); setBaseModel('SmolVLA'); setTags('');
    setTaskCategory(''); setSuccessRate(''); setAdapterSizeMB('');
    setEpisodeCount(''); setFrameCount(''); setDatasetSizeGB(''); setCollectionMethod('');
    setTiers(INITIAL_TIERS); setErrors({}); setTierErrors({}); setFormError(undefined);
  }, [open]);

  const setTier = (tier: MarketplaceLicenseTier, update: Partial<TierFormState>) =>
    setTiers((prev) => ({ ...prev, [tier]: { ...prev[tier], ...update } }));

  const handleSubmit = async () => {
    const nextErrors: FieldErrors = {};
    if (!title.trim()) nextErrors.title = 'Give the listing a title.';
    if (!shortDescription.trim()) nextErrors.shortDescription = 'Add a one-line summary.';
    if (!fullDescription.trim()) nextErrors.fullDescription = 'Describe what buyers get.';

    const enabled = LICENSE_TIERS.filter((t) => tiers[t].enabled);
    const nextTierErrors: Partial<Record<MarketplaceLicenseTier, string>> = {};
    if (enabled.length === 0) nextErrors.tiers = 'Enable at least one license tier.';
    const priceTiers = enabled.map((tier) => {
      const price = Number(tiers[tier].priceCredits);
      if (!Number.isFinite(price) || price <= 0) {
        nextTierErrors[tier] = `Enter a positive price for the ${LICENSE_TIER_LABELS[tier]} tier.`;
      }
      return { tier, priceCredits: Math.round(price), description: TIER_DESCRIPTIONS[tier] };
    });

    setErrors(nextErrors);
    setTierErrors(nextTierErrors);
    if (Object.keys(nextErrors).length > 0 || Object.keys(nextTierErrors).length > 0) return;
    setFormError(undefined);

    const input: CreateListingInput = {
      type,
      title: title.trim(),
      shortDescription: shortDescription.trim(),
      fullDescription: fullDescription.trim(),
      robotType,
      baseModel,
      tags: Array.from(new Set(splitTags(tags))),
      priceTiers,
      ...(type === 'skill'
        ? {
            taskCategory: taskCategory.trim() || undefined,
            successRate: toOptionalNumber(successRate),
            adapterSizeMB: toOptionalNumber(adapterSizeMB),
          }
        : {
            episodeCount: toOptionalNumber(episodeCount),
            frameCount: toOptionalNumber(frameCount),
            datasetSizeGB: toOptionalNumber(datasetSizeGB),
            collectionMethod: collectionMethod.trim() || undefined,
          }),
    };

    try {
      await onSubmit(input);
      toast.success('Listing published', { description: input.title });
      onClose();
    } catch (error) {
      // getErrorMessage also reads the API client's plain { message } rejection.
      setFormError(getErrorMessage(error));
    }
  };

  return (
    <FormModal
      isOpen={open}
      onClose={onClose}
      title="Publish listing"
      description="Share a skill or dataset with other teams. Buyers pay in credits."
      submitLabel="Publish listing"
      submittingLabel="Publishing…"
      isSubmitting={isSubmitting}
      error={formError}
      onSubmit={handleSubmit}
      size="lg"
      noValidate
    >
      <SegmentedControl
        label="Listing type"
        options={[
          { value: 'skill', label: 'Skill' },
          { value: 'dataset', label: 'Dataset' },
        ]}
        value={type}
        onChange={(v) => setType(v as MarketplaceItemType)}
      />
      <FormField label="Title" required error={errors.title}>
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={type === 'skill' ? 'e.g. Precise grasping, table objects' : 'e.g. SO-101 kitchen tasks, 480 episodes'}
        />
      </FormField>
      <FormField label="Summary" required error={errors.shortDescription} hint="One line, shown on the listing card.">
        <Input value={shortDescription} onChange={(e) => setShortDescription(e.target.value)} />
      </FormField>
      <FormField label="Description" required error={errors.fullDescription}>
        <Textarea
          rows={4}
          value={fullDescription}
          onChange={(e) => setFullDescription(e.target.value)}
          placeholder="Training data, supported hardware, evaluation results…"
        />
      </FormField>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FormField label="Robot type" required>
          <Select
            options={ROBOT_TYPES.map((r) => ({ value: r, label: r }))}
            value={robotType}
            onChange={(e) => setRobotType(e.target.value as RobotHardwareType)}
          />
        </FormField>
        <FormField label="Base model" required>
          <Select
            options={BASE_MODELS.map((m) => ({ value: m, label: m }))}
            value={baseModel}
            onChange={(e) => setBaseModel(e.target.value as BaseModelType)}
          />
        </FormField>
      </div>
      <FormField label="Tags" aside="Optional" hint="Comma-separated, e.g. grasping, tabletop">
        <Input value={tags} onChange={(e) => setTags(e.target.value)} />
      </FormField>

      <Divider label={type === 'skill' ? 'Skill details' : 'Dataset details'} />
      {type === 'skill' ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <FormField label="Task category" aside="Optional">
            <Input value={taskCategory} onChange={(e) => setTaskCategory(e.target.value)} placeholder="Manipulation" />
          </FormField>
          <FormField label="Success rate (%)" aside="Optional">
            <Input type="number" min={0} max={100} value={successRate} onChange={(e) => setSuccessRate(e.target.value)} placeholder="94" />
          </FormField>
          <FormField label="Adapter size (MB)" aside="Optional">
            <Input type="number" min={0} value={adapterSizeMB} onChange={(e) => setAdapterSizeMB(e.target.value)} placeholder="142" />
          </FormField>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField label="Episodes" aside="Optional">
            <Input type="number" min={0} value={episodeCount} onChange={(e) => setEpisodeCount(e.target.value)} placeholder="480" />
          </FormField>
          <FormField label="Frames" aside="Optional">
            <Input type="number" min={0} value={frameCount} onChange={(e) => setFrameCount(e.target.value)} placeholder="576000" />
          </FormField>
          <FormField label="Size (GB)" aside="Optional">
            <Input type="number" min={0} step="0.1" value={datasetSizeGB} onChange={(e) => setDatasetSizeGB(e.target.value)} placeholder="12.4" />
          </FormField>
          <FormField label="Collection method" aside="Optional">
            <Input value={collectionMethod} onChange={(e) => setCollectionMethod(e.target.value)} placeholder="Kinesthetic teaching" />
          </FormField>
        </div>
      )}

      <Divider label="License tiers" />
      {errors.tiers && (
        <p role="alert" className="text-xs text-signal-stopped">{errors.tiers}</p>
      )}
      <PublishPriceTiers tiers={tiers} onChange={setTier} errors={tierErrors} />
    </FormModal>
  );
}

function splitTags(raw: string): string[] {
  return raw.split(',').map((t) => t.trim()).filter(Boolean);
}

function toOptionalNumber(raw: string): number | undefined {
  if (!raw.trim()) return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}
