/**
 * @file TwinZoneFormModal.tsx
 * @description FormModal for creating/editing an L2 twin zone — name, type
 *   (keepout | workcell | charging | speed | room), colour, and the floor/ceiling
 *   heights (minZ/maxZ). The polygon itself is captured by the authoring
 *   overlay; this modal just attaches metadata. Toasts the result.
 *
 *   TASK-200: a `room` (and a `keepout`, which is a place the robot must NOT
 *   stand in) also carries a `placeType` in `metadata` — the vocabulary the
 *   robot's place graph is expressed in. Places are HAND-AUTHORED here rather
 *   than derived from the twin-builder's DBSCAN clusters: a cluster is a blob of
 *   geometry with no name, and "AISLE-3" is a name a human uses out loud.
 * @feature digitaltwin
 */

import { useEffect, useState } from 'react';
import { FormField, FormModal, Input, Select, toast } from '@/shared/components/ui';
import { useTwinZoneStore, TWIN_ZONE_COLORS } from '../store/twinZoneStore';
import { TWIN_PLACE_TYPES } from '../types/twin.types';
import type { TwinZoneDTO, TwinZoneType, TwinPlaceType, TwinPoint } from '../types/twin.types';
import { ZONE_TYPE_LABELS } from './ZoneLegend';

const TYPE_OPTIONS = (Object.keys(ZONE_TYPE_LABELS) as TwinZoneType[]).map((value) => ({ value, label: ZONE_TYPE_LABELS[value] }));

/** Zone types that become entries in the robot's place graph. */
const PLACE_BEARING_TYPES: ReadonlySet<TwinZoneType> = new Set<TwinZoneType>(['room', 'keepout']);

const PLACE_TYPE_LABELS: Record<TwinPlaceType, string> = {
  aisle: 'Aisle',
  rack_face: 'Rack face',
  dock: 'Dock',
  staging: 'Staging',
  cell: 'Work cell',
  charging: 'Charging',
  corridor: 'Corridor',
  office: 'Office',
  unknown: 'Unclassified',
};
const PLACE_OPTIONS = TWIN_PLACE_TYPES.map((t) => ({ value: t, label: PLACE_TYPE_LABELS[t] }));

interface FormData {
  name: string;
  type: TwinZoneType;
  placeType: TwinPlaceType;
  color: string;
  minZ: string;
  maxZ: string;
}

const DEFAULT_FORM: FormData = { name: '', type: 'keepout', placeType: 'unknown', color: '', minZ: '0', maxZ: '2' };

/** Read `metadata.placeType` back out of a saved zone, defaulting honestly. */
function readPlaceType(zone: TwinZoneDTO): TwinPlaceType {
  const raw = zone.metadata?.placeType;
  return typeof raw === 'string' && (TWIN_PLACE_TYPES as readonly string[]).includes(raw) ? (raw as TwinPlaceType) : 'unknown';
}

export interface TwinZoneFormModalProps {
  /** The twin (used only for context; the store knows its twinId). */
  twinId: string;
}

/**
 * Driven entirely by the twin zone store: opens when `showFormModal` is true,
 * in create mode (with `pendingPolygon`) or edit mode (with `editingZone`).
 */
export function TwinZoneFormModal(_props: TwinZoneFormModalProps) {
  const showFormModal = useTwinZoneStore((s) => s.showFormModal);
  const editingZone = useTwinZoneStore((s) => s.editingZone) as TwinZoneDTO | null;
  const pendingPolygon = useTwinZoneStore((s) => s.pendingPolygon) as TwinPoint[] | null;
  const isLoading = useTwinZoneStore((s) => s.isLoading);
  const createZone = useTwinZoneStore((s) => s.createZone);
  const updateZone = useTwinZoneStore((s) => s.updateZone);
  const closeFormModal = useTwinZoneStore((s) => s.closeFormModal);

  const [form, setForm] = useState<FormData>(DEFAULT_FORM);
  const [nameError, setNameError] = useState<string>();
  const [formError, setFormError] = useState<string>();

  useEffect(() => {
    if (!showFormModal) return;
    setForm(
      editingZone
        ? {
            name: editingZone.name,
            type: editingZone.type,
            placeType: readPlaceType(editingZone),
            color: editingZone.color ?? '',
            minZ: String(editingZone.minZ),
            maxZ: String(editingZone.maxZ),
          }
        : DEFAULT_FORM,
    );
    setNameError(undefined);
    setFormError(undefined);
  }, [showFormModal, editingZone]);

  const handleSubmit = async () => {
    const name = form.name.trim();
    if (!name) {
      setNameError('Give the zone a name.');
      return;
    }
    const minZ = parseFloat(form.minZ);
    const maxZ = parseFloat(form.maxZ);
    // Merge, never replace: `metadata` also carries keys this form knows
    // nothing about (speedLimit, placeId, floor), and clobbering them here
    // would silently re-floor a place on every unrelated colour edit.
    const metadata: Record<string, unknown> = { ...(editingZone?.metadata ?? {}) };
    if (PLACE_BEARING_TYPES.has(form.type)) metadata.placeType = form.placeType;
    else delete metadata.placeType;

    const body = {
      name,
      type: form.type,
      color: form.color || undefined,
      minZ: Number.isFinite(minZ) ? minZ : 0,
      maxZ: Number.isFinite(maxZ) ? maxZ : 2,
      metadata,
    };

    setFormError(undefined);
    if (editingZone) {
      const saved = await updateZone(editingZone.id, body);
      if (saved) toast.success('Zone updated', { description: name });
      else setFormError(useTwinZoneStore.getState().error ?? "Couldn't update the zone.");
    } else if (pendingPolygon && pendingPolygon.length >= 3) {
      const saved = await createZone({ ...body, points: pendingPolygon });
      if (saved) toast.success('Zone created', { description: name });
      else setFormError(useTwinZoneStore.getState().error ?? "Couldn't create the zone.");
    }
  };

  // Zone colours are data (the 3D volumes and the legend use the same
  // palette); the picker needs a concrete colour value to show.
  const previewColor = form.color || TWIN_ZONE_COLORS[form.type] || TWIN_ZONE_COLORS.room;

  return (
    <FormModal
      isOpen={showFormModal}
      onClose={closeFormModal}
      title={editingZone ? `Edit ${editingZone.name}` : 'New zone'}
      description={!editingZone && pendingPolygon ? `${pendingPolygon.length} vertices captured on the floor plan.` : undefined}
      submitLabel={editingZone ? 'Save changes' : 'Create zone'}
      submittingLabel={editingZone ? 'Saving…' : 'Creating…'}
      isSubmitting={isLoading}
      error={formError}
      onSubmit={handleSubmit}
      noValidate
    >
      <FormField label="Name" required error={nameError}>
        <Input
          value={form.name}
          onChange={(e) => {
            setForm((f) => ({ ...f, name: e.target.value }));
            if (nameError) setNameError(undefined);
          }}
          placeholder="e.g. Loading dock"
        />
      </FormField>

      <FormField label="Type">
        <Select options={TYPE_OPTIONS} value={form.type} onChange={(e) => setForm((f) => ({ ...f, type: e.target.value as TwinZoneType }))} />
      </FormField>

      {PLACE_BEARING_TYPES.has(form.type) && (
        <FormField label="Place type" hint="How the robot names this region out loud. Rooms and keep-outs are published to the robot as its place graph.">
          <Select options={PLACE_OPTIONS} value={form.placeType} onChange={(e) => setForm((f) => ({ ...f, placeType: e.target.value as TwinPlaceType }))} />
        </FormField>
      )}

      <div className="grid grid-cols-2 gap-4">
        <FormField label="Floor height" aside="m">
          <Input type="number" step="0.1" value={form.minZ} onChange={(e) => setForm((f) => ({ ...f, minZ: e.target.value }))} />
        </FormField>
        <FormField label="Ceiling height" aside="m">
          <Input type="number" step="0.1" value={form.maxZ} onChange={(e) => setForm((f) => ({ ...f, maxZ: e.target.value }))} />
        </FormField>
      </div>

      <FormField label="Colour" hint="Defaults to the type colour when unset.">
        <input
          type="color"
          value={previewColor}
          onChange={(e) => setForm((f) => ({ ...f, color: e.target.value }))}
          className="h-9 w-12 cursor-pointer rounded-control border border-line bg-field"
          aria-label="Zone colour"
        />
      </FormField>
    </FormModal>
  );
}
