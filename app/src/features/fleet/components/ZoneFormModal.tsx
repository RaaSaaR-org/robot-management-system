/**
 * @file ZoneFormModal.tsx
 * @description Create and edit a zone: the kit FormModal with name, type,
 *   floor, colour, description and bounds. Toasts on success; errors stay in
 *   the modal.
 * @feature fleet
 * @dependencies @/shared/components/ui, @/features/fleet/hooks, @/features/fleet/utils
 */

import { useState, useEffect } from 'react';
import { FormField, FormModal, Input, Select, Textarea, errorMessage, toast } from '@/shared/components/ui';
import { useZoneManagement, useZoneEditor } from '../hooks';
import type { Zone, ZoneType, ZoneBounds } from '../types/fleet.types';
import { ZONE_COLOR_OPTIONS, ZONE_TYPE_LABEL } from '../utils/mapColors';

export interface ZoneFormModalProps {
  /** Whether modal is open */
  isOpen: boolean;
  /** Zone being edited (null for create mode) */
  zone: Zone | null;
  /** Default bounds for a new zone (e.g. drawn on the map) */
  defaultBounds?: ZoneBounds;
  /** Current floor */
  currentFloor: string;
  /** Close handler */
  onClose: () => void;
  /** Success handler */
  onSuccess?: (zone: Zone) => void;
}

interface FormState {
  name: string;
  type: ZoneType;
  floor: string;
  x: string;
  y: string;
  width: string;
  height: string;
  color: string;
  description: string;
}

type FieldErrors = Partial<Record<keyof FormState, string>>;

const TYPE_OPTIONS = (Object.keys(ZONE_TYPE_LABEL) as ZoneType[]).map((value) => ({
  value,
  label: ZONE_TYPE_LABEL[value],
}));

function initialState(zone: Zone | null, bounds: ZoneBounds | undefined, floor: string): FormState {
  const b = zone?.bounds ?? bounds ?? { x: 0, y: 0, width: 10, height: 10 };
  const knownColor = ZONE_COLOR_OPTIONS.some((o) => o.value === zone?.color);
  return {
    name: zone?.name ?? '',
    type: zone?.type ?? 'operational',
    floor: zone?.floor ?? floor,
    x: String(b.x),
    y: String(b.y),
    width: String(b.width),
    height: String(b.height),
    // A legacy hex colour is kept as-is unless the user picks another one.
    color: zone?.color && !knownColor ? zone.color : zone?.color ?? '',
    description: zone?.description ?? '',
  };
}

function validate(form: FormState): FieldErrors {
  const errors: FieldErrors = {};
  if (!form.name.trim()) errors.name = 'Give the zone a name.';
  if (!form.floor.trim()) errors.floor = 'Say which floor the zone is on.';
  if (Number.isNaN(parseFloat(form.x))) errors.x = 'Enter a number.';
  if (Number.isNaN(parseFloat(form.y))) errors.y = 'Enter a number.';
  if (!(parseFloat(form.width) > 0)) errors.width = 'Must be above 0.';
  if (!(parseFloat(form.height) > 0)) errors.height = 'Must be above 0.';
  return errors;
}

/**
 * Zone create/edit modal.
 *
 * @example
 * ```tsx
 * <ZoneFormModal isOpen={open} zone={editing} currentFloor="1" onClose={close} />
 * ```
 */
export function ZoneFormModal({ isOpen, zone, defaultBounds, currentFloor, onClose, onSuccess }: ZoneFormModalProps) {
  const { createZone, updateZone } = useZoneManagement();
  const { closeFormModal } = useZoneEditor();
  const [form, setForm] = useState<FormState>(() => initialState(zone, defaultBounds, currentFloor));
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string>();
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setForm(initialState(zone, defaultBounds, currentFloor));
    setErrors({});
    setFormError(undefined);
  }, [isOpen, zone, defaultBounds, currentFloor]);

  const set = (field: keyof FormState) => (e: { target: { value: string } }) => {
    const value = e.target.value;
    setForm((prev) => ({ ...prev, [field]: value }));
    if (errors[field]) setErrors((prev) => ({ ...prev, [field]: undefined }));
  };

  const handleClose = () => {
    closeFormModal();
    onClose();
  };

  const handleSubmit = async () => {
    const nextErrors = validate(form);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    const payload = {
      name: form.name.trim(),
      type: form.type,
      floor: form.floor.trim(),
      bounds: {
        x: parseFloat(form.x),
        y: parseFloat(form.y),
        width: parseFloat(form.width),
        height: parseFloat(form.height),
      },
      color: form.color || undefined,
      description: form.description.trim() || undefined,
    };

    setSaving(true);
    setFormError(undefined);
    try {
      let saved: Zone;
      if (zone) {
        const updated = await updateZone(zone.id, payload);
        if (!updated) throw new Error('The server did not return the zone.');
        saved = updated;
        toast.success('Zone updated', { description: saved.name });
      } else {
        saved = await createZone(payload);
        toast.success('Zone created', { description: saved.name });
      }
      onSuccess?.(saved);
      handleClose();
    } catch (err) {
      setFormError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const colorOptions =
    form.color && !ZONE_COLOR_OPTIONS.some((o) => o.value === form.color)
      ? [...ZONE_COLOR_OPTIONS, { value: form.color, label: `Custom (${form.color})` }]
      : ZONE_COLOR_OPTIONS;

  return (
    <FormModal
      isOpen={isOpen}
      onClose={handleClose}
      title={zone ? `Edit ${zone.name}` : 'New zone'}
      description={zone ? undefined : 'An area robots treat by its type: work, charge, service or keep out.'}
      submitLabel={zone ? 'Save changes' : 'Create zone'}
      submittingLabel={zone ? 'Saving…' : 'Creating…'}
      isSubmitting={saving}
      error={formError}
      onSubmit={handleSubmit}
      noValidate
    >
      <FormField label="Name" required error={errors.name}>
        <Input value={form.name} onChange={set('name')} placeholder="e.g. Loading dock" />
      </FormField>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FormField label="Type">
          <Select options={TYPE_OPTIONS} value={form.type} onChange={set('type')} />
        </FormField>
        <FormField label="Floor" required error={errors.floor}>
          <Input value={form.floor} onChange={set('floor')} placeholder="1" />
        </FormField>
      </div>
      <FormField label="Colour" hint="Leave on “By zone type” to colour the zone by what it is.">
        <Select options={colorOptions} value={form.color} onChange={set('color')} />
      </FormField>
      <FormField label="Description" aside="Optional">
        <Textarea rows={2} value={form.description} onChange={set('description')} />
      </FormField>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-[13px] font-medium text-ink-secondary">Bounds (map units)</legend>
        <div className="grid grid-cols-2 gap-4">
          <FormField label="X" error={errors.x}>
            <Input type="number" inputMode="decimal" value={form.x} onChange={set('x')} />
          </FormField>
          <FormField label="Y" error={errors.y}>
            <Input type="number" inputMode="decimal" value={form.y} onChange={set('y')} />
          </FormField>
          <FormField label="Width" error={errors.width}>
            <Input type="number" inputMode="decimal" min={0} value={form.width} onChange={set('width')} />
          </FormField>
          <FormField label="Height" error={errors.height}>
            <Input type="number" inputMode="decimal" min={0} value={form.height} onChange={set('height')} />
          </FormField>
        </div>
      </fieldset>
    </FormModal>
  );
}
