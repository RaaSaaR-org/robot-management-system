/**
 * @file MarketplacePublishDialog.tsx
 * @description Dialog for publishing a new skill or dataset listing to the marketplace
 * @feature marketplace
 */

import { useEffect, useRef, useState } from 'react';
import { X, Brain, Database, Plus, Loader2, AlertTriangle, Tag } from 'lucide-react';
import { cn } from '@/shared/utils/cn';
import {
  LICENSE_TIER_LABELS,
  type MarketplaceItemType,
  type MarketplaceLicenseTier,
  type RobotHardwareType,
  type BaseModelType,
  type CreateListingInput,
} from '../types/marketplace.types';

export interface MarketplacePublishDialogProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (input: CreateListingInput) => Promise<void>;
  isSubmitting: boolean;
}

const ROBOT_TYPES: RobotHardwareType[] = ['Unitree G1', 'SO-101', 'Unitree H1', 'Generic'];
const BASE_MODELS: BaseModelType[] = ['SmolVLA', 'Pi0.5', 'OpenVLA', 'None'];
const LICENSE_TIERS: MarketplaceLicenseTier[] = ['research', 'per_robot', 'per_fleet', 'enterprise'];

const TIER_DESCRIPTIONS: Record<MarketplaceLicenseTier, string> = {
  research: 'Non-commercial use only',
  per_robot: 'One robot instance',
  per_fleet: 'Unlimited robots in one org',
  enterprise: 'Unlimited + redistribution rights',
};

interface TierFormState {
  enabled: boolean;
  priceCredits: string;
}

const INITIAL_TIERS: Record<MarketplaceLicenseTier, TierFormState> = {
  research: { enabled: true, priceCredits: '200' },
  per_robot: { enabled: false, priceCredits: '' },
  per_fleet: { enabled: false, priceCredits: '' },
  enterprise: { enabled: false, priceCredits: '' },
};

export function MarketplacePublishDialog({
  open,
  onClose,
  onSubmit,
  isSubmitting,
}: MarketplacePublishDialogProps) {
  const [type, setType] = useState<MarketplaceItemType>('skill');
  const [title, setTitle] = useState('');
  const [shortDescription, setShortDescription] = useState('');
  const [fullDescription, setFullDescription] = useState('');
  const [robotType, setRobotType] = useState<RobotHardwareType>('Unitree G1');
  const [baseModel, setBaseModel] = useState<BaseModelType>('SmolVLA');
  const [tagInput, setTagInput] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  // Skill-specific
  const [taskCategory, setTaskCategory] = useState('');
  const [successRate, setSuccessRate] = useState('');
  const [adapterSizeMB, setAdapterSizeMB] = useState('');
  // Dataset-specific
  const [episodeCount, setEpisodeCount] = useState('');
  const [frameCount, setFrameCount] = useState('');
  const [datasetSizeGB, setDatasetSizeGB] = useState('');
  const [collectionMethod, setCollectionMethod] = useState('');
  // Pricing
  const [tiers, setTiers] = useState<Record<MarketplaceLicenseTier, TierFormState>>(INITIAL_TIERS);
  const [formError, setFormError] = useState<string | null>(null);
  const errorRef = useRef<HTMLDivElement | null>(null);

  // Reset the form each time the dialog opens
  useEffect(() => {
    if (open) {
      setType('skill');
      setTitle('');
      setShortDescription('');
      setFullDescription('');
      setRobotType('Unitree G1');
      setBaseModel('SmolVLA');
      setTagInput('');
      setTags([]);
      setTaskCategory('');
      setSuccessRate('');
      setAdapterSizeMB('');
      setEpisodeCount('');
      setFrameCount('');
      setDatasetSizeGB('');
      setCollectionMethod('');
      setTiers(INITIAL_TIERS);
      setFormError(null);
    }
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  // The dialog body scrolls; make sure a validation error is actually seen
  useEffect(() => {
    if (formError) {
      errorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [formError]);

  if (!open) return null;

  const commitTagInput = (raw: string) => {
    const parts = raw
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
    if (parts.length === 0) return;
    setTags((prev) => [...prev, ...parts.filter((p) => !prev.includes(p))]);
    setTagInput('');
  };

  const handleTagKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      commitTagInput(tagInput);
    }
  };

  const removeTag = (tag: string) => {
    setTags((prev) => prev.filter((t) => t !== tag));
  };

  const setTier = (tier: MarketplaceLicenseTier, update: Partial<TierFormState>) => {
    setTiers((prev) => ({ ...prev, [tier]: { ...prev[tier], ...update } }));
  };

  const handleSubmit = async () => {
    // Client-side validation
    if (!title.trim() || !shortDescription.trim() || !fullDescription.trim()) {
      setFormError('Title, short description, and full description are required.');
      return;
    }
    const enabledTiers = LICENSE_TIERS.filter((t) => tiers[t].enabled);
    if (enabledTiers.length === 0) {
      setFormError('Enable at least one license tier.');
      return;
    }
    const priceTiers = [];
    for (const tier of enabledTiers) {
      const price = Number(tiers[tier].priceCredits);
      if (!Number.isFinite(price) || price <= 0) {
        setFormError(`Enter a positive credit price for the ${LICENSE_TIER_LABELS[tier]} tier.`);
        return;
      }
      priceTiers.push({ tier, priceCredits: Math.round(price), description: TIER_DESCRIPTIONS[tier] });
    }
    setFormError(null);

    const input: CreateListingInput = {
      type,
      title: title.trim(),
      shortDescription: shortDescription.trim(),
      fullDescription: fullDescription.trim(),
      robotType,
      baseModel,
      tags: Array.from(new Set([...tags, ...splitTags(tagInput)])),
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
      onClose();
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Failed to publish listing');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      {/* Modal */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="List a Skill or Dataset"
        className="relative w-full max-w-xl max-h-[90vh] flex flex-col rounded-2xl bg-theme-card border border-theme shadow-2xl"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-theme shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-cobalt-500/10 flex items-center justify-center">
              <Plus size={20} className="text-cobalt-500 dark:text-cobalt-300" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-theme-primary">List a Skill or Dataset</h2>
              <p className="text-xs text-theme-tertiary">Publish to the marketplace and earn credits</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="p-1.5 rounded-brand hover:bg-theme-hover text-theme-secondary hover:text-theme-primary transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4 overflow-y-auto">
          {/* Type toggle */}
          <div className="flex items-center gap-1 bg-theme-elevated rounded-brand p-1 w-fit">
            {([
              { value: 'skill', label: 'Skill', icon: Brain },
              { value: 'dataset', label: 'Dataset', icon: Database },
            ] as const).map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setType(option.value)}
                className={cn(
                  'flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors',
                  type === option.value ? 'bg-cobalt-500 text-white' : 'text-theme-secondary hover:text-theme-primary'
                )}
              >
                <option.icon size={14} />
                {option.label}
              </button>
            ))}
          </div>

          {/* Title */}
          <Field label="Title" required>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={type === 'skill' ? 'e.g. Precise Grasping — Table Objects' : 'e.g. SO-101 Kitchen Tasks — 480 Episodes'}
              className={inputClass}
            />
          </Field>

          {/* Short description */}
          <Field label="Short description" required>
            <input
              type="text"
              value={shortDescription}
              onChange={(e) => setShortDescription(e.target.value)}
              placeholder="One-line summary shown on the listing card"
              className={inputClass}
            />
          </Field>

          {/* Full description */}
          <Field label="Full description" required>
            <textarea
              value={fullDescription}
              onChange={(e) => setFullDescription(e.target.value)}
              rows={4}
              placeholder="Training data, supported hardware, evaluation results..."
              className={cn(inputClass, 'resize-none')}
            />
          </Field>

          {/* Robot / base model */}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Robot type" required>
              <select
                value={robotType}
                onChange={(e) => setRobotType(e.target.value as RobotHardwareType)}
                className={inputClass}
              >
                {ROBOT_TYPES.map((rt) => (
                  <option key={rt} value={rt}>{rt}</option>
                ))}
              </select>
            </Field>
            <Field label="Base model" required>
              <select
                value={baseModel}
                onChange={(e) => setBaseModel(e.target.value as BaseModelType)}
                className={inputClass}
              >
                {BASE_MODELS.map((bm) => (
                  <option key={bm} value={bm}>{bm}</option>
                ))}
              </select>
            </Field>
          </div>

          {/* Tags */}
          <Field label="Tags">
            <div className="flex flex-wrap items-center gap-2 mb-2">
              {tags.map((tag) => (
                <span
                  key={tag}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-theme-elevated text-xs text-theme-secondary border border-theme"
                >
                  <Tag size={10} className="text-theme-tertiary" />
                  {tag}
                  <button
                    type="button"
                    onClick={() => removeTag(tag)}
                    className="text-theme-tertiary hover:text-theme-primary transition-colors"
                    aria-label={`Remove tag ${tag}`}
                  >
                    <X size={10} />
                  </button>
                </span>
              ))}
            </div>
            <input
              type="text"
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={handleTagKeyDown}
              onBlur={() => commitTagInput(tagInput)}
              placeholder="Comma-separated, e.g. grasping, tabletop"
              className={inputClass}
            />
          </Field>

          {/* Type-specific fields */}
          {type === 'skill' ? (
            <div className="grid grid-cols-3 gap-3">
              <Field label="Task category">
                <input
                  type="text"
                  value={taskCategory}
                  onChange={(e) => setTaskCategory(e.target.value)}
                  placeholder="Manipulation"
                  className={inputClass}
                />
              </Field>
              <Field label="Success rate (%)">
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={successRate}
                  onChange={(e) => setSuccessRate(e.target.value)}
                  placeholder="94"
                  className={inputClass}
                />
              </Field>
              <Field label="Adapter size (MB)">
                <input
                  type="number"
                  min={0}
                  value={adapterSizeMB}
                  onChange={(e) => setAdapterSizeMB(e.target.value)}
                  placeholder="142"
                  className={inputClass}
                />
              </Field>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Episodes">
                <input
                  type="number"
                  min={0}
                  value={episodeCount}
                  onChange={(e) => setEpisodeCount(e.target.value)}
                  placeholder="480"
                  className={inputClass}
                />
              </Field>
              <Field label="Frames">
                <input
                  type="number"
                  min={0}
                  value={frameCount}
                  onChange={(e) => setFrameCount(e.target.value)}
                  placeholder="576000"
                  className={inputClass}
                />
              </Field>
              <Field label="Size (GB)">
                <input
                  type="number"
                  min={0}
                  step="0.1"
                  value={datasetSizeGB}
                  onChange={(e) => setDatasetSizeGB(e.target.value)}
                  placeholder="12.4"
                  className={inputClass}
                />
              </Field>
              <Field label="Collection method">
                <input
                  type="text"
                  value={collectionMethod}
                  onChange={(e) => setCollectionMethod(e.target.value)}
                  placeholder="Kinesthetic teaching"
                  className={inputClass}
                />
              </Field>
            </div>
          )}

          {/* Pricing */}
          <div>
            <p className="text-xs font-medium text-theme-secondary mb-2">
              License tiers <span className="text-cobalt-500 dark:text-cobalt-300">*</span>
              <span className="text-theme-muted font-normal ml-1">(enable at least one)</span>
            </p>
            <div className="space-y-2">
              {LICENSE_TIERS.map((tier) => (
                <div
                  key={tier}
                  className={cn(
                    'flex items-center gap-3 p-3 rounded-brand border transition-colors',
                    tiers[tier].enabled
                      ? 'bg-cobalt-500/5 border-cobalt-500/30'
                      : 'bg-theme-elevated border-theme'
                  )}
                >
                  <input
                    type="checkbox"
                    id={`tier-${tier}`}
                    checked={tiers[tier].enabled}
                    onChange={(e) => setTier(tier, { enabled: e.target.checked })}
                    className="accent-cobalt-500"
                  />
                  <label htmlFor={`tier-${tier}`} className="flex-1 min-w-0 cursor-pointer">
                    <span className="block text-sm font-medium text-theme-primary">{LICENSE_TIER_LABELS[tier]}</span>
                    <span className="block text-xs text-theme-tertiary">{TIER_DESCRIPTIONS[tier]}</span>
                  </label>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <input
                      type="number"
                      min={1}
                      value={tiers[tier].priceCredits}
                      onChange={(e) => setTier(tier, { priceCredits: e.target.value })}
                      disabled={!tiers[tier].enabled}
                      placeholder="0"
                      className={cn(
                        'w-24 px-2 py-1.5 rounded-brand bg-theme-elevated border border-theme text-sm text-theme-primary text-right',
                        'placeholder:text-theme-muted focus:outline-none focus:border-cobalt-500/50',
                        !tiers[tier].enabled && 'opacity-40 cursor-not-allowed'
                      )}
                    />
                    <span className="text-xs text-theme-tertiary">credits</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Error */}
          {formError && (
            <div
              ref={errorRef}
              role="alert"
              className="p-3 rounded-lg bg-red-500/10 border border-red-500/30 flex items-start gap-2"
            >
              <AlertTriangle size={14} className="text-red-400 mt-0.5 shrink-0" />
              <p className="text-xs text-red-400">{formError}</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 p-5 border-t border-theme shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-brand bg-theme-elevated border border-theme text-sm text-theme-secondary hover:text-theme-primary transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={isSubmitting}
            onClick={handleSubmit}
            className={cn(
              'px-4 py-2 rounded-brand text-sm font-medium transition-colors flex items-center gap-2',
              isSubmitting
                ? 'bg-theme-elevated text-theme-muted cursor-not-allowed'
                : 'bg-cobalt-500 text-white hover:bg-cobalt-600'
            )}
          >
            {isSubmitting && <Loader2 size={14} className="animate-spin" />}
            {isSubmitting ? 'Publishing...' : 'Publish Listing'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// HELPERS
// ============================================================================

const inputClass =
  'w-full px-3 py-2 rounded-brand bg-theme-elevated border border-theme text-sm text-theme-primary placeholder:text-theme-muted focus:outline-none focus:border-cobalt-500/50';

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p className="text-xs font-medium text-theme-secondary mb-1.5">
        {label} {required && <span className="text-cobalt-500 dark:text-cobalt-300">*</span>}
      </p>
      {children}
    </div>
  );
}

function splitTags(raw: string): string[] {
  return raw
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
}

function toOptionalNumber(raw: string): number | undefined {
  if (!raw.trim()) return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}
